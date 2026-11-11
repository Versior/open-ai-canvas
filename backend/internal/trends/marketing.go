package trends

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// MarketingConnection is stored encrypted by the application; never returned to clients.
type MarketingConnection struct {
	AdvertiserID     string    `json:"advertiserId"`
	ProjectID        string    `json:"projectId,omitempty"`
	AccessToken      string    `json:"accessToken"`
	AppID            string    `json:"appId,omitempty"`
	RefreshToken     string    `json:"refreshToken,omitempty"`
	ExpiresAt        time.Time `json:"expiresAt,omitzero"`
	RefreshExpiresAt time.Time `json:"refreshExpiresAt,omitzero"`
	AdvertiserIDs    []string  `json:"advertiserIds,omitempty"`
	RefreshLease     time.Time `json:"refreshLease,omitzero"`
}

func MarketingSource(source string) bool { return source == "qianchuan" || source == "oceanengine" }

func ValidateConnection(source string, value MarketingConnection) error {
	if !MarketingSource(source) {
		return fmt.Errorf("该来源没有可用的 Marketing API 接入")
	}
	if id, err := strconv.ParseInt(value.AdvertiserID, 10, 64); err != nil || id <= 0 {
		return fmt.Errorf("请填写有效的广告主 ID")
	}
	if source == "oceanengine" {
		if id, err := strconv.ParseInt(value.ProjectID, 10, 64); err != nil || id <= 0 {
			return fmt.Errorf("项目推荐需要有效的广告项目 ID")
		}
	}
	if strings.TrimSpace(value.AccessToken) == "" || len(value.AccessToken) > 4096 || strings.ContainsAny(value.AccessToken, "\r\n\x00") {
		return fmt.Errorf("请填写有效的应用访问令牌")
	}
	return nil
}

// FetchMarketing uses the official SDK contracts. Account assets and project
// recommendations have different meanings; neither is a public hot ranking.
func FetchMarketing(ctx context.Context, source string, connection MarketingConnection, client *http.Client) (Board, error) {
	if err := ValidateConnection(source, connection); err != nil {
		return Board{}, err
	}
	endpoint := "https://api.oceanengine.com/open_api/v1.0/qianchuan/video/get/"
	method := http.MethodGet
	var body io.Reader
	if source == "qianchuan" {
		query := url.Values{"advertiser_id": {connection.AdvertiserID}, "page": {"1"}, "page_size": {"20"}}
		endpoint += "?" + query.Encode()
	} else {
		endpoint = "https://api.oceanengine.com/open_api/v3.0/recommend/video/list/"
		method = http.MethodPost
		advertiser, _ := strconv.ParseInt(connection.AdvertiserID, 10, 64)
		project, _ := strconv.ParseInt(connection.ProjectID, 10, 64)
		encoded, _ := json.Marshal(map[string]int64{"advertiser_id": advertiser, "project_id": project})
		body = bytes.NewReader(encoded)
	}
	req, err := http.NewRequestWithContext(ctx, method, endpoint, body)
	if err != nil {
		return Board{}, err
	}
	req.Header.Set("Access-Token", connection.AccessToken)
	req.Header.Set("Content-Type", "application/json")
	// Access-Token must never follow an upstream redirect to another service.
	securedClient := *client
	securedClient.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	res, err := securedClient.Do(req)
	if err != nil {
		return Board{}, fmt.Errorf("官方素材接口暂时无法连接")
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return Board{}, fmt.Errorf("官方素材接口返回 HTTP %d，请检查应用授权", res.StatusCode)
	}
	raw, err := io.ReadAll(io.LimitReader(res.Body, (2<<20)+1))
	if err != nil || len(raw) > 2<<20 {
		return Board{}, fmt.Errorf("官方素材响应读取失败")
	}
	var result struct {
		Code *int `json:"code"`
		Data *struct {
			List []struct {
				Filename string `json:"filename"`
				URL      string `json:"url"`
			} `json:"list"`
			Recommendations []struct {
				Title  string `json:"title"`
				URL    string `json:"video_play_url"`
				ItemID int64  `json:"item_id"`
			} `json:"recommend_video_list"`
		} `json:"data"`
	}
	if json.Unmarshal(raw, &result) != nil || result.Code == nil {
		return Board{}, fmt.Errorf("官方素材响应格式无效")
	}
	if *result.Code != 0 {
		return Board{}, fmt.Errorf("平台拒绝读取（错误码 %d），请检查应用、广告主和接口权限", *result.Code)
	}
	if result.Data == nil {
		return Board{}, fmt.Errorf("官方素材响应缺少数据")
	}
	board := Board{Source: source, Status: "api", FetchedAt: time.Now().UTC(), Topics: []Topic{}, Description: "千川账户视频素材，按接口返回顺序"}
	skipped := 0
	seen := map[string]bool{}
	appendTopic := func(title, link string) {
		title = strings.TrimSpace(title)
		link = strings.TrimSpace(link)
		if title == "" || strings.ContainsAny(title, "\x00\r\n") || !ValidTopicURL(source, link) {
			skipped++
			return
		}
		if seen[link] || len(board.Topics) >= 50 {
			return
		}
		seen[link] = true
		runes := []rune(title)
		if len(runes) > 100 {
			title = string(runes[:100])
		}
		board.Topics = append(board.Topics, Topic{Title: title, URL: link, Rank: len(board.Topics) + 1})
	}
	if source == "qianchuan" {
		for _, item := range result.Data.List {
			appendTopic(item.Filename, item.URL)
		}
	} else {
		board.Description = "广告项目推荐视频，由 Marketing API 提供"
		for _, item := range result.Data.Recommendations {
			link := item.URL
			if item.ItemID > 0 {
				link = "https://www.douyin.com/video/" + strconv.FormatInt(item.ItemID, 10)
			}
			appendTopic(item.Title, link)
		}
	}
	if skipped > 0 {
		if len(board.Topics) == 0 {
			return Board{}, fmt.Errorf("平台返回的素材缺少可用标题或受支持的官方内容链接")
		}
		board.Description += fmt.Sprintf("；%d 条缺少可用标题或官方内容链接，未展示", skipped)
	}
	return board, nil
}
