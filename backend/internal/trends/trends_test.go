package trends

import (
	"context"
	"strings"
	"testing"
)

func TestBusinessSourcesCannotUsePublicBoardFetcher(t *testing.T) {
	for _, source := range []string{"douhot", "qianchuan", "oceanengine"} {
		board, err := Fetch(context.Background(), source)
		if err == nil || len(board.Topics) != 0 || !board.FetchedAt.IsZero() {
			t.Fatalf("invented board for %s: %#v %v", source, board, err)
		}
	}
}

func TestImportedTopicSourceBoundary(t *testing.T) {
	if !ValidTopicURL("qianchuan", "https://www.douyin.com/video/123") {
		t.Fatal("official material source rejected")
	}
	for _, value := range []string{"https://www.douyin.com.evil.test/video/123", "http://www.douyin.com/video/123", "https://qianchuan.jinritemai.com/?access_token=FAKE", "https://qianchuan.jinritemai.com/?state=FAKE", "https://www.baidu.com/s?wd=test"} {
		if ValidTopicURL("qianchuan", value) {
			t.Fatalf("unsafe source accepted: %s", value)
		}
	}
}

func TestParseBaiduBoard(t *testing.T) {
	items, err := parse("baidu", []byte(`page<!--s-data:{"data":{"cards":[{"content":[{"word":"美食制作"},{"word":"美食制作"},{"word":"  "},{"word":"城市漫游"}]}]}}-->end`))
	if err != nil || len(items) != 2 || items[0].Rank != 1 || items[1].Rank != 4 || !strings.HasPrefix(items[0].URL, "https://www.baidu.com/s?wd=") {
		t.Fatalf("unexpected parse: %#v, %v", items, err)
	}
	for _, body := range []string{"blocked", "<!--s-data:{}-->", "<!--s-data:{"} {
		if _, err := parse("baidu", []byte(body)); err == nil {
			t.Fatal("broken board accepted")
		}
	}
}

func TestParseBilibiliBoard(t *testing.T) {
	items, err := parse("bilibili", []byte(`{"code":0,"data":{"trending":{"list":[{"keyword":"动画故事"}]}}}`))
	if err != nil || len(items) != 1 || !strings.HasPrefix(items[0].URL, "https://search.bilibili.com/all?keyword=") {
		t.Fatalf("unexpected board: %#v %v", items, err)
	}
	if _, err := parse("bilibili", []byte(`{"code":-412}`)); err == nil {
		t.Fatal("upstream failure accepted")
	}
}
