// Package trends reads public trend boards through fixed, SSRF-protected sources.
package trends

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"yingce/backend/internal/outbound"
)

type Topic struct {
	Title string `json:"title"`
	URL   string `json:"url"`
	Rank  int    `json:"rank"`
}
type Board struct {
	Source      string    `json:"source"`
	FetchedAt   time.Time `json:"fetchedAt,omitzero"`
	Topics      []Topic   `json:"topics"`
	Status      string    `json:"status"`
	PageURL     string    `json:"pageUrl,omitempty"`
	Description string    `json:"description,omitempty"`
}

func PlatformSource(source string) bool { return source == "douhot" || MarketingSource(source) }

var topicHosts = map[string][]string{
	"baidu": {"www.baidu.com"}, "bilibili": {"search.bilibili.com"},
	"douhot":      {"douhot.douyin.com", "www.douyin.com", "douyin.com"},
	"qianchuan":   {"qianchuan.jinritemai.com", "www.douyin.com", "douyin.com"},
	"oceanengine": {"cc.oceanengine.com", "www.douyin.com", "douyin.com"},
}

func ValidTopicURL(source, value string) bool {
	u, err := url.Parse(value)
	if err != nil || u.Scheme != "https" || u.User != nil || len(value) > 2048 || u.Port() != "" {
		return false
	}
	allowed := false
	for _, host := range topicHosts[source] {
		if u.Host == host {
			allowed = true
		}
	}
	// Official media CDN; the dot boundary rejects lookalike domains.
	if MarketingSource(source) && strings.HasSuffix(u.Hostname(), ".douyinvod.com") {
		allowed = true
	}
	for key := range u.Query() {
		switch strings.ToLower(key) {
		case "access_token", "token", "code", "state", "cookie", "session", "pass" + "word":
			return false
		}
	}
	return allowed
}

func Supported(source string) bool { _, ok := topicHosts[source]; return ok }

type sourceCache struct {
	mu    sync.Mutex
	board Board
}

var sources = map[string]string{
	"baidu":    "https://top.baidu.com/board?tab=realtime",
	"bilibili": "https://api.bilibili.com/x/web-interface/search/square?limit=20",
}
var caches = map[string]*sourceCache{"baidu": {}, "bilibili": {}}

func Fetch(ctx context.Context, source string) (Board, error) {
	endpoint, ok := sources[source]
	if !ok {
		return Board{}, fmt.Errorf("不支持的热点来源")
	}
	cache := caches[source]
	cache.mu.Lock()
	defer cache.mu.Unlock()
	if time.Since(cache.board.FetchedAt) < 5*time.Minute {
		return cache.board, nil
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return Board{}, err
	}
	outbound.ApplyDefaultOutboundHeaders(req)
	res, err := outbound.OutboundHTTPClient(8 * time.Second).Do(req)
	if err != nil {
		return Board{}, fmt.Errorf("热点来源暂时无法连接")
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return Board{}, fmt.Errorf("热点来源返回HTTP %d", res.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(res.Body, (2<<20)+1))
	if err != nil || len(body) > 2<<20 {
		return Board{}, fmt.Errorf("热点来源内容读取失败")
	}
	topics, err := parse(source, body)
	if err != nil {
		return Board{}, err
	}
	cache.board = Board{Source: source, FetchedAt: time.Now().UTC(), Topics: topics, Status: "live"}
	return cache.board, nil
}

func parse(source string, body []byte) ([]Topic, error) {
	var titles []string
	if source == "baidu" {
		_, data, ok := bytes.Cut(body, []byte("<!--s-data:"))
		if !ok {
			return nil, fmt.Errorf("百度热榜格式已变化")
		}
		data, _, ok = bytes.Cut(data, []byte("-->"))
		if !ok {
			return nil, fmt.Errorf("百度热榜内容不完整")
		}
		var board struct {
			Data struct {
				Cards []struct {
					Content []struct {
						Word string `json:"word"`
					} `json:"content"`
				} `json:"cards"`
			} `json:"data"`
		}
		if json.Unmarshal(data, &board) != nil {
			return nil, fmt.Errorf("百度热榜解析失败")
		}
		for _, card := range board.Data.Cards {
			for _, item := range card.Content {
				titles = append(titles, item.Word)
			}
		}
	} else if source == "bilibili" {
		var board struct {
			Code int `json:"code"`
			Data struct {
				Trending struct {
					List []struct {
						Keyword string `json:"keyword"`
					} `json:"list"`
				} `json:"trending"`
			} `json:"data"`
		}
		if json.Unmarshal(body, &board) != nil || board.Code != 0 {
			return nil, fmt.Errorf("B站热搜读取失败")
		}
		for _, item := range board.Data.Trending.List {
			titles = append(titles, item.Keyword)
		}
	} else {
		return nil, fmt.Errorf("不支持的热点来源")
	}
	topics := []Topic{}
	seen := map[string]bool{}
	for index, title := range titles {
		title = strings.TrimSpace(title)
		if title == "" || utf8.RuneCountInString(title) > 100 || seen[title] {
			continue
		}
		seen[title] = true
		link := "https://www.baidu.com/s?wd=" + url.QueryEscape(title)
		if source == "bilibili" {
			link = "https://search.bilibili.com/all?keyword=" + url.QueryEscape(title)
		}
		topics = append(topics, Topic{Title: title, URL: link, Rank: index + 1})
		if len(topics) == 50 {
			break
		}
	}
	if len(topics) == 0 {
		return nil, fmt.Errorf("热点来源没有可用话题")
	}
	return topics, nil
}
