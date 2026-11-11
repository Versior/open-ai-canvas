package trends

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestDouhotServerHTTPContractAndCacheRotation(t *testing.T) {
	calls := 0
	client := &http.Client{Transport: marketingTransport(func(req *http.Request) (*http.Response, error) {
		calls++
		var body map[string]any
		if json.NewDecoder(req.Body).Decode(&body) != nil || req.Method != http.MethodPost || req.URL.String() != "https://douhot.douyin.com/douhot/v1/material/video_billboard" || req.Header.Get("Cookie") == "" || strings.Contains(req.URL.String(), "SESSION") || body["sub_type"] != float64(1001) || body["date_window"] != float64(24) || body["tag_version"] != "v2" {
			t.Fatal("incorrect server request contract")
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"code":0,"data":{"objs":[{"item_title":"榜单标题","item_id":"7594075655595994400"},{"item_title":"重复条目","item_id":7594075655595994400}]}}`))}, nil
	})}
	for _, cookie := range []string{"sessionid=EXAMPLE_SESSION_A", "sessionid=EXAMPLE_SESSION_A", "sessionid=EXAMPLE_SESSION_B"} {
		board, err := FetchDouhot(context.Background(), cookie, client)
		if err != nil || board.Status != "web_api" || len(board.Topics) != 1 || board.Topics[0].URL != "https://www.douyin.com/video/7594075655595994400" {
			t.Fatal("incorrect topic or rounded video ID")
		}
	}
	if calls != 2 {
		t.Fatal("cache ignored credential rotation or repeated same request")
	}
}

func TestDouhotFailuresDoNotLeakCredentialOrBecomeEmptySuccess(t *testing.T) {
	for _, raw := range []string{`{"code":8,"data":"EXAMPLE_SECRET_SESSION"}`, `{"code":429,"data":"EXAMPLE_SECRET_SESSION"}`, `{"code":0}`, `{"code":0,"data":{}}`, `{"data":{"objs":[]}}`, `<html>EXAMPLE_SECRET_SESSION</html>`, `{"code":0,"data":{"objs":[{"item_title":"x","item_id":-1}]}}`} {
		client := &http.Client{Transport: marketingTransport(func(*http.Request) (*http.Response, error) {
			return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(raw))}, nil
		})}
		_, err := fetchDouhot(context.Background(), "sessionid=EXAMPLE_SECRET_SESSION", client)
		if err == nil || strings.Contains(err.Error(), "EXAMPLE_SECRET_SESSION") {
			t.Fatal("upstream failure became success or exposed credential")
		}
	}
	for _, cookie := range []string{"", "invalid", "sessionid=x\r\nHeader: bad"} {
		if _, err := FetchDouhot(context.Background(), cookie, &http.Client{}); err == nil {
			t.Fatal("invalid credential accepted")
		}
	}
	calls := 0
	client := &http.Client{Transport: marketingTransport(func(*http.Request) (*http.Response, error) {
		calls++
		return &http.Response{StatusCode: 302, Header: http.Header{"Location": {"https://other.example/"}}, Body: io.NopCloser(strings.NewReader(""))}, nil
	})}
	if _, err := fetchDouhot(context.Background(), "sessionid=EXAMPLE_SECRET_SESSION", client); err == nil || calls != 1 {
		t.Fatal("redirect forwarded credential")
	}
}
