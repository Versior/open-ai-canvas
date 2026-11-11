package trends

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

var douhotCache struct {
	sync.Mutex
	credential [32]byte
	board      Board
}

// FetchDouhot reads the site administrator's video board through the website
// contract, not OAuth. Only this public ranking is shared with site users.
func FetchDouhot(ctx context.Context, cookie string, client *http.Client) (Board, error) {
	cookie = strings.TrimSpace(cookie)
	if cookie == "" || len(cookie) > 16384 || strings.ContainsAny(cookie, "\r\n\x00") || len((&http.Request{Header: http.Header{"Cookie": {cookie}}}).Cookies()) == 0 {
		return Board{}, fmt.Errorf("热点宝服务器登录凭据未配置或格式无效")
	}
	douhotCache.Lock()
	defer douhotCache.Unlock()
	hash := sha256.Sum256([]byte(cookie))
	if douhotCache.credential == hash && time.Since(douhotCache.board.FetchedAt) < 5*time.Minute {
		return douhotCache.board, nil
	}
	board, err := fetchDouhot(ctx, cookie, client)
	if err == nil {
		douhotCache.credential, douhotCache.board = hash, board
	}
	return board, err
}

func fetchDouhot(ctx context.Context, cookie string, client *http.Client) (Board, error) {
	const endpoint = "https://douhot.douyin.com/douhot/v1/material/video_billboard"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(`{"sub_type":1001,"date_window":24,"page":1,"page_size":20,"tag_version":"v2"}`))
	if err != nil {
		return Board{}, fmt.Errorf("创建热点宝请求失败")
	}
	req.Header.Set("Cookie", cookie)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Origin", "https://douhot.douyin.com")
	req.Header.Set("Referer", "https://douhot.douyin.com/square/hotspot?active_tab=hotspot_all")
	req.Header.Set("User-Agent", "Mozilla/5.0")
	secured := *client
	secured.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	res, err := secured.Do(req)
	if err != nil {
		return Board{}, fmt.Errorf("热点宝服务器请求失败，请检查网络和平台访问限制")
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return Board{}, fmt.Errorf("热点宝返回HTTP %d，请检查服务器访问限制；本次不自动重试", res.StatusCode)
	}
	raw, err := io.ReadAll(io.LimitReader(res.Body, (2<<20)+1))
	var result struct {
		Code *int            `json:"code"`
		Data json.RawMessage `json:"data"`
	}
	if err != nil || len(raw) > 2<<20 || json.Unmarshal(raw, &result) != nil || result.Code == nil {
		return Board{}, fmt.Errorf("热点宝响应格式无效，可能被平台访问限制拦截")
	}
	if *result.Code == 8 {
		return Board{}, fmt.Errorf("热点宝服务器登录凭据已失效，请管理员更新")
	}
	if *result.Code != 0 {
		return Board{}, fmt.Errorf("热点宝拒绝读取（错误码%d）", *result.Code)
	}
	var data struct {
		Items *[]struct {
			Title string      `json:"item_title"`
			ID    json.Number `json:"item_id"`
		} `json:"objs"`
	}
	if json.Unmarshal(result.Data, &data) != nil || data.Items == nil || len(*data.Items) > 1000 {
		return Board{}, fmt.Errorf("热点宝视频榜字段已变化或缺失")
	}
	board := Board{Source: "douhot", Status: "web_api", FetchedAt: time.Now().UTC(), PageURL: "https://douhot.douyin.com/square/hotspot", Description: "热点宝近24小时视频榜 · 服务器站点账号读取 · 网页接口", Topics: []Topic{}}
	seen := map[string]bool{}
	skipped := 0
	for index, item := range *data.Items {
		title := strings.TrimSpace(item.Title)
		id, err := strconv.ParseInt(string(item.ID), 10, 64)
		if err != nil || id <= 0 || title == "" || strings.ContainsAny(title, "\r\n\x00") || utf8.RuneCountInString(title) > 100 {
			skipped++
			continue
		}
		if seen[string(item.ID)] {
			continue
		}
		seen[string(item.ID)] = true
		board.Topics = append(board.Topics, Topic{Title: title, URL: "https://www.douyin.com/video/" + string(item.ID), Rank: index + 1})
		if len(board.Topics) == 50 {
			break
		}
	}
	if skipped > 0 {
		if len(board.Topics) == 0 {
			return Board{}, fmt.Errorf("热点宝视频榜没有有效的标题和视频ID")
		}
		board.Description += fmt.Sprintf("；%d条格式无效，未展示", skipped)
	}
	return board, nil
}
