package trends

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
)

type marketingTransport func(*http.Request) (*http.Response, error)

func (fn marketingTransport) RoundTrip(req *http.Request) (*http.Response, error) { return fn(req) }

func TestMarketingOfficialRequestAndTopicContract(t *testing.T) {
	for _, source := range []string{"qianchuan", "oceanengine"} {
		t.Run(source, func(t *testing.T) {
			input := MarketingConnection{AdvertiserID: "123", ProjectID: "456", AccessToken: "YOUR_API_KEY_HERE"}
			client := &http.Client{Transport: marketingTransport(func(req *http.Request) (*http.Response, error) {
				if req.URL.Host != "api.oceanengine.com" || req.Header.Get("Access-Token") != input.AccessToken || strings.Contains(req.URL.String(), input.AccessToken) {
					t.Fatal("incorrect credential boundary")
				}
				data := `{"code":0,"data":{"list":[{"filename":"杯子实拍","url":"https://v3-default.douyinvod.com/video.mp4"}]}}`
				if source == "qianchuan" {
					if req.Method != http.MethodGet || req.URL.Path != "/open_api/v1.0/qianchuan/video/get/" || req.URL.Query().Get("advertiser_id") != "123" || req.URL.Query().Get("page_size") != "20" {
						t.Fatal("incorrect qianchuan contract")
					}
				} else {
					var body map[string]int64
					if json.NewDecoder(req.Body).Decode(&body) != nil || body["advertiser_id"] != 123 || body["project_id"] != 456 || req.Method != http.MethodPost || req.URL.Path != "/open_api/v3.0/recommend/video/list/" {
						t.Fatal("incorrect recommendation contract")
					}
					data = `{"code":0,"data":{"recommend_video_list":[{"title":"广告推荐","item_id":789,"video_play_url":"https://invalid.example/video"}]}}`
				}
				return &http.Response{StatusCode: 200, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(data))}, nil
			})}
			board, err := FetchMarketing(context.Background(), source, input, client)
			if err != nil || board.Status != "api" || board.Description == "" || len(board.Topics) != 1 {
				t.Fatalf("read failed: %v", err)
			}
			if !ValidTopicURL(source, board.Topics[0].URL) {
				t.Fatal("returned topic cannot be saved in a creative work")
			}
			if source == "oceanengine" && board.Topics[0].URL != "https://www.douyin.com/video/789" {
				t.Fatal("stable item link missing")
			}
		})
	}
}

func TestMarketingFailuresDoNotLeakCredentialsOrBecomeEmptySuccess(t *testing.T) {
	for _, raw := range []string{`{"code":401,"message":"YOUR_API_KEY_HERE"}`, `{"code":0}`, `{"code":0,"data":{"list":[{"filename":"x","url":"https://127.0.0.1/video"}]}}`, `{"data":{}}`, strings.Repeat("x", (2<<20)+1)} {
		client := &http.Client{Transport: marketingTransport(func(*http.Request) (*http.Response, error) {
			return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(raw))}, nil
		})}
		_, err := FetchMarketing(context.Background(), "qianchuan", MarketingConnection{AdvertiserID: "1", AccessToken: "YOUR_API_KEY_HERE"}, client)
		if err == nil || strings.Contains(err.Error(), "YOUR_API_KEY_HERE") {
			t.Fatal("failed response exposed token or became success")
		}
	}
	for _, value := range []MarketingConnection{{AdvertiserID: "0", AccessToken: "YOUR_API_KEY_HERE"}, {AdvertiserID: "9223372036854775808", AccessToken: "YOUR_API_KEY_HERE"}, {AdvertiserID: "1", AccessToken: strings.Join([]string{"invalid", "header"}, string(rune(10)))}} {
		if ValidateConnection("qianchuan", value) == nil {
			t.Fatal("invalid connection accepted")
		}
	}
	if ValidateConnection("douhot", MarketingConnection{AdvertiserID: "1", AccessToken: "YOUR_API_KEY_HERE"}) == nil || ValidateConnection("oceanengine", MarketingConnection{AdvertiserID: "1", AccessToken: "YOUR_API_KEY_HERE"}) == nil {
		t.Fatal("unsupported source or missing project accepted")
	}
	for _, link := range []string{"https://douyinvod.com.evil.example/video", "https://v3-default.douyinvod.com:8080/video", "https://v3-default.douyinvod.com/video?access_token=FAKE", "https://127.0.0.1/video", "http://v3-default.douyinvod.com/video"} {
		if ValidTopicURL("qianchuan", link) {
			t.Fatal("unsafe media link accepted")
		}
	}
	if ValidTopicURL("douhot", "https://v3-default.douyinvod.com/video") {
		t.Fatal("media scope widened for unrelated source")
	}
}

func TestMarketingDoesNotForwardTokenOnRedirect(t *testing.T) {
	calls := 0
	client := &http.Client{Transport: marketingTransport(func(*http.Request) (*http.Response, error) {
		calls++
		return &http.Response{StatusCode: 302, Header: http.Header{"Location": {"https://other.example/"}}, Body: io.NopCloser(strings.NewReader(""))}, nil
	})}
	_, err := FetchMarketing(context.Background(), "qianchuan", MarketingConnection{AdvertiserID: "1", AccessToken: "YOUR_API_KEY_HERE"}, client)
	if err == nil || calls != 1 {
		t.Fatal("platform redirect forwarded credential")
	}
}
