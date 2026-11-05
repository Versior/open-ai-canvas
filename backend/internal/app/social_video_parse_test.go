package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"yingce/backend/internal/model"
)

func TestRenderSocialVideoParseTemplateEscapesByContext(t *testing.T) {
	t.Parallel()
	vars := map[string]string{"url": `https://v.douyin.com/a b/?x=1&y="2"`, "platform": "douyin", "key": "k&1"}
	if got := renderSocialVideoParseTemplate("https://api.example.com/p?url={url}&key={key}&p={platform}", vars, url.QueryEscape); got != "https://api.example.com/p?url=https%3A%2F%2Fv.douyin.com%2Fa+b%2F%3Fx%3D1%26y%3D%222%22&key=k%261&p=douyin" {
		t.Fatalf("url template = %q", got)
	}
	body := renderSocialVideoParseTemplate(`{"url":"{url}","keep":"{unknown}"}`, vars, socialVideoJSONEscape)
	var decoded map[string]string
	if err := json.Unmarshal([]byte(body), &decoded); err != nil || decoded["url"] != vars["url"] || decoded["keep"] != "{unknown}" {
		t.Fatalf("json body = %s (%v)", body, err)
	}
}

func TestNormalizeSocialVideoParseAPIRequestValidatesDefinition(t *testing.T) {
	t.Parallel()
	valid := SocialVideoParseAPIRequest{Name: " 接口 ", Platforms: []string{"douyin", "douyin", "kuaishou"}, URL: "https://api.example.com/parse?url={url}", Headers: []SocialVideoParseHeader{{Name: "X-Token", Value: "{key}"}}}
	got, err := normalizeSocialVideoParseAPIRequest(valid)
	if err != nil {
		t.Fatalf("normalize valid request: %v", err)
	}
	if got.Name != "接口" || len(got.Platforms) != 2 || got.Method != "GET" || got.BodyType != "none" || got.TimeoutSeconds != 15 || got.Weight != 10 || got.Mapping.DurationUnit != "s" {
		t.Fatalf("normalized = %#v", got)
	}
	for name, mutate := range map[string]func(*SocialVideoParseAPIRequest){
		"missing name":       func(r *SocialVideoParseAPIRequest) { r.Name = "" },
		"unknown platform":   func(r *SocialVideoParseAPIRequest) { r.Platforms = []string{"myspace"} },
		"no url placeholder": func(r *SocialVideoParseAPIRequest) { r.URL = "https://api.example.com/parse" },
		"relative url":       func(r *SocialVideoParseAPIRequest) { r.URL = "/parse?url={url}" },
		"get with json body": func(r *SocialVideoParseAPIRequest) { r.BodyType, r.Body = "json", `{"url":"{url}"}` },
		"invalid json body":  func(r *SocialVideoParseAPIRequest) { r.Method, r.BodyType, r.Body = "POST", "json", `{"url":{url}}` },
		"blocked header":     func(r *SocialVideoParseAPIRequest) { r.Headers = []SocialVideoParseHeader{{Name: "Host", Value: "x"}} },
		"header injection": func(r *SocialVideoParseAPIRequest) {
			r.Headers = []SocialVideoParseHeader{{Name: "X-A", Value: "a\r\nX-B: b"}}
		},
		"bad duration unit":    func(r *SocialVideoParseAPIRequest) { r.Mapping.DurationUnit = "minutes" },
		"unsupported method":   func(r *SocialVideoParseAPIRequest) { r.Method = "DELETE" },
		"credentials in url":   func(r *SocialVideoParseAPIRequest) { r.URL = "https://user:pass@api.example.com/?url={url}" },
		"non http url scheme":  func(r *SocialVideoParseAPIRequest) { r.URL = "ftp://api.example.com/?url={url}" },
		"too many header rows": func(r *SocialVideoParseAPIRequest) { r.Headers = make([]SocialVideoParseHeader, 21) },
	} {
		request := valid
		request.Headers = append([]SocialVideoParseHeader(nil), valid.Headers...)
		mutate(&request)
		if _, err := normalizeSocialVideoParseAPIRequest(request); err == nil {
			t.Errorf("%s: want validation error", name)
		}
	}
	post := valid
	post.Method, post.BodyType, post.Body = "POST", "json", `{"url":"{url}","platform":"{platform}"}`
	if _, err := normalizeSocialVideoParseAPIRequest(post); err != nil {
		t.Fatalf("post json body: %v", err)
	}
}

func TestMapSocialVideoParseResponseReadsConfiguredAndDetectedFields(t *testing.T) {
	t.Parallel()
	raw := []byte(`{"code":200,"msg":"ok","data":{"title":"开箱","cover":"https://p3.example.com/c.jpeg~tplv-noop.image","music":{"url":"https://m.example.com/a.mp3"},"author":{"avatar_url":"https://p.example.com/a.jpg"},"video":{"play_addr":"https://v.example.com/obj/video/abc.mp4?sig=1"},"aweme_id":"7391234567890123456","duration":15200}}`)
	detected, err := mapSocialVideoParseResponse(raw, SocialVideoParseMapping{SuccessPath: "code", SuccessValues: "200", IDPath: "data.aweme_id", DurationPath: "data.duration", DurationUnit: "ms"}, "")
	if err != nil {
		t.Fatalf("map detected: %v", err)
	}
	if detected.VideoURL != "https://v.example.com/obj/video/abc.mp4?sig=1" || detected.VideoURLPath != "data.video.play_addr" || detected.Title != "开箱" || detected.ID != "7391234567890123456" || detected.DurationMs != 15200 {
		t.Fatalf("detected = %#v", detected)
	}
	configured, err := mapSocialVideoParseResponse([]byte(`{"status":"success","result":{"items":[{"url":"//cdn.example.com/x"}],"len":"12.5"}}`), SocialVideoParseMapping{SuccessPath: "status", SuccessValues: "SUCCESS", VideoURLPath: "result.items[0].url", DurationPath: "result.len"}, "")
	if err != nil {
		t.Fatalf("map configured: %v", err)
	}
	if configured.VideoURL != "https://cdn.example.com/x" || configured.DurationMs != 12500 {
		t.Fatalf("configured = %#v", configured)
	}
	for name, test := range map[string]struct {
		raw     string
		mapping SocialVideoParseMapping
		want    string
	}{
		"failure flag with message": {`{"code":500,"msg":"链接已失效"}`, SocialVideoParseMapping{SuccessPath: "code", SuccessValues: "200", MessagePath: "msg"}, "链接已失效"},
		"missing configured path":   {`{"data":{}}`, SocialVideoParseMapping{VideoURLPath: "data.url"}, "data.url"},
		"no video url detected":     {`{"data":{"cover":"https://p.example.com/a.jpg"}}`, SocialVideoParseMapping{}, "视频地址"},
		"not json":                  {`<html>blocked</html>`, SocialVideoParseMapping{}, "不是 JSON"},
		"invalid media url":         {`{"data":{"url":"javascript:alert(1)"}}`, SocialVideoParseMapping{VideoURLPath: "data.url"}, "视频地址无效"},
	} {
		if _, err := mapSocialVideoParseResponse([]byte(test.raw), test.mapping, ""); err == nil || !strings.Contains(err.Error(), test.want) {
			t.Errorf("%s: err = %v, want containing %q", name, err, test.want)
		}
	}
}

func TestOrderSocialVideoParseAPIsFollowsStrategy(t *testing.T) {
	base := time.Now()
	apis := []socialVideoParseAPI{
		{ID: "c", Priority: 3, CreatedAt: base},
		{ID: "a", Priority: 1, CreatedAt: base},
		{ID: "b", Priority: 2, CreatedAt: base},
	}
	state := socialVideoParseState{APIs: map[string]*SocialVideoParseAPIState{"a": {AvgLatencyMs: 900}, "b": {AvgLatencyMs: 100}}}
	ids := func(list []socialVideoParseAPI) string {
		out := []string{}
		for _, api := range list {
			out = append(out, api.ID)
		}
		return strings.Join(out, ",")
	}
	if got := ids(orderSocialVideoParseAPIs(apis, state, SocialVideoParseStrategyPriority, "douyin")); got != "a,b,c" {
		t.Fatalf("priority order = %s", got)
	}
	if got := ids(orderSocialVideoParseAPIs(apis, state, SocialVideoParseStrategyFastest, "douyin")); got != "b,a,c" {
		t.Fatalf("fastest order = %s", got)
	}
	platform := fmt.Sprintf("rr-%d", time.Now().UnixNano())
	first := ids(orderSocialVideoParseAPIs(apis, state, SocialVideoParseStrategyRoundRobin, platform))
	second := ids(orderSocialVideoParseAPIs(apis, state, SocialVideoParseStrategyRoundRobin, platform))
	if first != "a,b,c" || second != "b,c,a" {
		t.Fatalf("round robin = %s then %s", first, second)
	}
	if got := orderSocialVideoParseAPIs(apis, state, SocialVideoParseStrategyWeighted, "douyin"); len(got) != 3 {
		t.Fatalf("weighted order lost entries: %v", ids(got))
	}
}

func TestCompareAndSwapSystemSettingRejectsStaleWrites(t *testing.T) {
	svc, _ := newSocialVideoImportTestService(t)
	if swapped, err := svc.repo.CompareAndSwapSystemSetting("cas-key", "", false, `{"v":1}`, ""); err != nil || !swapped {
		t.Fatalf("insert = %v, %v", swapped, err)
	}
	if swapped, err := svc.repo.CompareAndSwapSystemSetting("cas-key", "", false, `{"v":9}`, ""); err != nil || swapped {
		t.Fatalf("second insert = %v, %v; want lost race", swapped, err)
	}
	if swapped, err := svc.repo.CompareAndSwapSystemSetting("cas-key", `{"v":0}`, true, `{"v":2}`, ""); err != nil || swapped {
		t.Fatalf("stale update = %v, %v; want rejected", swapped, err)
	}
	if swapped, err := svc.repo.CompareAndSwapSystemSetting("cas-key", `{"v":1}`, true, `{"v":2}`, ""); err != nil || !swapped {
		t.Fatalf("fresh update = %v, %v", swapped, err)
	}
	value, err := readSettingJSON[map[string]int](svc, "cas-key")
	if err != nil || value["v"] != 2 {
		t.Fatalf("stored = %#v, %v", value, err)
	}
}

func TestRecordSocialVideoParseOutcomeAutoDisablesAndRecovers(t *testing.T) {
	svc, _ := newSocialVideoImportTestService(t)
	api := socialVideoParseAPI{ID: "api-1", Name: "接口一", Platforms: []string{"douyin"}, Enabled: true, Method: "GET", URL: "https://parse.example.com/?url={url}"}
	seedSocialVideoParseAPIs(t, svc, api)
	failure := parseStageError("response", "接口返回 HTTP 502")
	for range 3 {
		svc.recordSocialVideoParseOutcome(api, "douyin", "import", 120*time.Millisecond, failure, true)
	}
	state, _ := svc.socialVideoParseState()
	current := state.APIs[api.ID]
	if current == nil || !current.AutoDisabled || current.ConsecutiveFailures != 3 || !strings.Contains(current.AutoDisabledReason, "连续失败 3 次") || len(current.Recent) != 3 {
		t.Fatalf("state after failures = %#v", current)
	}
	if len(state.Logs) != 3 || state.Logs[0].Stage != "response" || !strings.Contains(state.Logs[0].Message, "已自动停用") {
		t.Fatalf("logs = %#v", state.Logs)
	}
	candidates, _, err := svc.socialVideoParseCandidates("douyin")
	if err != nil || len(candidates) != 1 || candidates[0].ID != api.ID {
		t.Fatalf("half-open candidates = %#v, %v", candidates, err)
	}
	svc.recordSocialVideoParseOutcome(api, "douyin", "import", 80*time.Millisecond, &socialVideoContentError{Message: "视频时长超过 3 分钟"}, false)
	state, _ = svc.socialVideoParseState()
	if state.APIs[api.ID].ConsecutiveFailures != 3 || state.APIs[api.ID].FailureCount != 3 {
		t.Fatalf("content error must not count against the API: %#v", state.APIs[api.ID])
	}
	svc.recordSocialVideoParseOutcome(api, "douyin", "health", 100*time.Millisecond, nil, false)
	state, _ = svc.socialVideoParseState()
	current = state.APIs[api.ID]
	if current.AutoDisabled || current.ConsecutiveFailures != 0 || current.SuccessCount != 1 || current.AvgLatencyMs != 100 || state.Logs[0].Message != "调用成功，已自动恢复" {
		t.Fatalf("state after recovery = %#v, log = %#v", current, state.Logs[0])
	}
}

func socialVideoTestMP4(t *testing.T) []byte {
	t.Helper()
	for _, tool := range []string{"ffmpeg", "ffprobe"} {
		if _, err := exec.LookPath(tool); err != nil {
			t.Skipf("需要 %s", tool)
		}
	}
	path := filepath.Join(t.TempDir(), "sample.mp4")
	output, err := exec.Command("ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=160x120:r=10:d=1", "-pix_fmt", "yuv420p", path).CombinedOutput()
	if err != nil {
		t.Fatalf("ffmpeg: %v %s", err, output)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

// newSocialVideoParseServer 起一个本地假解析接口：/bad 返回 500，/good 返回 JSON，/media.mp4 是视频，/long 声明 200 秒。
func newSocialVideoParseServer(t *testing.T, media []byte) (*httptest.Server, *atomic.Value) {
	t.Helper()
	lastURL := &atomic.Value{}
	mux := http.NewServeMux()
	var server *httptest.Server
	mux.HandleFunc("/bad", func(w http.ResponseWriter, r *http.Request) {
		lastURL.Store(r.URL.Query().Get("url"))
		http.Error(w, "upstream down", http.StatusBadGateway)
	})
	mux.HandleFunc("/good", func(w http.ResponseWriter, r *http.Request) {
		lastURL.Store(r.URL.Query().Get("url"))
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprintf(w, `{"code":200,"data":{"title":"测试视频","cover":"%[1]s/cover.jpg","video":{"play":"%[1]s/media.mp4"},"aweme_id":"7391234567890123456"}}`, server.URL)
	})
	mux.HandleFunc("/long", func(w http.ResponseWriter, r *http.Request) {
		_, _ = fmt.Fprintf(w, `{"code":200,"data":{"url":"%s/media.mp4","duration":200}}`, server.URL)
	})
	mux.HandleFunc("/media.mp4", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "video/mp4")
		http.ServeContent(w, r, "media.mp4", time.Time{}, strings.NewReader(string(media)))
	})
	server = httptest.NewServer(mux)
	t.Cleanup(server.Close)
	return server, lastURL
}

func useLocalSocialVideoParseNetwork(svc *Service) {
	svc.socialVideoParseHTTPClient = func(timeout time.Duration) *http.Client { return &http.Client{Timeout: timeout} }
	svc.socialVideoParseURLValidator = url.Parse
	svc.socialVideoURLValidator = url.Parse
}

func TestDownloadSocialVideoWithPoolFallsBackToNextAPI(t *testing.T) {
	media := socialVideoTestMP4(t)
	server, lastURL := newSocialVideoParseServer(t, media)
	svc, _ := newSocialVideoImportTestService(t)
	useLocalSocialVideoParseNetwork(svc)
	now := time.Now().UTC()
	seedSocialVideoParseAPIs(t, svc,
		socialVideoParseAPI{ID: "api-bad", Name: "坏接口", Platforms: []string{"douyin"}, Enabled: true, Priority: 1, Method: "GET", URL: server.URL + "/bad?url={url}", TimeoutSeconds: 5, CreatedAt: now},
		socialVideoParseAPI{ID: "api-good", Name: "好接口", Platforms: []string{"douyin"}, Enabled: true, Priority: 2, Method: "GET", URL: server.URL + "/good?url={url}", TimeoutSeconds: 5, Mapping: SocialVideoParseMapping{SuccessPath: "code", SuccessValues: "200", IDPath: "data.aweme_id"}, CreatedAt: now},
	)
	shareURL := "https://www.douyin.com/video/7391234567890123456"
	outcome, err := svc.downloadSocialVideoWithPool(context.Background(), socialVideoParseJob{Platform: "douyin", URL: shareURL, WorkDir: t.TempDir(), MaxBytes: 10 << 20})
	if err != nil {
		t.Fatalf("downloadSocialVideoWithPool() error = %v", err)
	}
	if outcome.API.ID != "api-good" || outcome.Result.Title != "测试视频" || outcome.Result.ID != "7391234567890123456" || outcome.Probe.Width != 160 || outcome.Probe.Height != 120 || outcome.Size != int64(len(media)) {
		t.Fatalf("outcome = %#v", outcome)
	}
	if got := lastURL.Load(); got != shareURL {
		t.Fatalf("parse API received url %v, want %s", got, shareURL)
	}
	state, _ := svc.socialVideoParseState()
	if bad := state.APIs["api-bad"]; bad == nil || bad.ConsecutiveFailures != 1 || bad.AutoDisabled {
		t.Fatalf("bad api state = %#v", bad)
	}
	if good := state.APIs["api-good"]; good == nil || good.SuccessCount != 1 {
		t.Fatalf("good api state = %#v", good)
	}
	if len(state.Logs) != 2 || !state.Logs[0].OK || state.Logs[1].OK || state.Logs[1].Stage != "response" {
		t.Fatalf("logs = %#v", state.Logs)
	}
}

func TestSocialVideoParseErrorsQuoteUpstreamMessageWithoutSecret(t *testing.T) {
	const secret = "sk-live-secret"
	mux := http.NewServeMux()
	mux.HandleFunc("/down", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
		_, _ = fmt.Fprintf(w, `{"code":502,"error":{"message":"额度用完：%s"}}`, r.URL.Query().Get("key"))
	})
	mux.HandleFunc("/plain", func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "upstream down", http.StatusServiceUnavailable)
	})
	mux.HandleFunc("/refused", func(w http.ResponseWriter, r *http.Request) {
		_, _ = fmt.Fprintf(w, `{"code":401,"msg":"密钥 %s 无效"}`, r.URL.Query().Get("key"))
	})
	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)
	svc, _ := newSocialVideoImportTestService(t)
	useLocalSocialVideoParseNetwork(svc)
	link := "https://www.douyin.com/video/7391234567890123456"
	call := func(path string) error {
		api := socialVideoParseAPI{ID: "api-1", Name: "接口一", Platforms: []string{"douyin"}, Enabled: true, Method: "GET", URL: server.URL + path + "?url={url}&key={key}", Secret: secret, TimeoutSeconds: 5}
		_, _, err := svc.callSocialVideoParseAPI(context.Background(), api, link, "douyin")
		return err
	}
	if err := call("/down"); err == nil || err.Error() != "接口返回 HTTP 502：额度用完：***" {
		t.Fatalf("down error = %v", err)
	}
	if err := call("/plain"); err == nil || err.Error() != "接口返回 HTTP 503" {
		t.Fatalf("plain error = %v", err)
	}
	// 成功标记不对时，从配置的错误信息字段取说明，同样不能带出密钥；这也是导入失败时用户看到的原因。
	seedSocialVideoParseAPIs(t, svc, socialVideoParseAPI{ID: "api-refused", Name: "拒绝接口", Platforms: []string{"douyin"}, Enabled: true, Method: "GET", URL: server.URL + "/refused?url={url}&key={key}", Secret: secret, TimeoutSeconds: 5, Mapping: SocialVideoParseMapping{SuccessPath: "code", SuccessValues: "200", MessagePath: "msg"}})
	_, err := svc.downloadSocialVideoWithPool(context.Background(), socialVideoParseJob{Platform: "douyin", URL: link, WorkDir: t.TempDir(), MaxBytes: 10 << 20})
	if err == nil || strings.Contains(err.Error(), secret) || !strings.Contains(err.Error(), "密钥 *** 无效") {
		t.Fatalf("pool error = %v", err)
	}
	state, _ := svc.socialVideoParseState()
	if encoded, _ := json.Marshal(state); strings.Contains(string(encoded), secret) {
		t.Fatalf("call log leaks the secret: %s", encoded)
	}
}

func TestDownloadSocialVideoWithPoolStopsOnTooLongVideoWithoutPenalty(t *testing.T) {
	server, _ := newSocialVideoParseServer(t, []byte("unused"))
	svc, _ := newSocialVideoImportTestService(t)
	useLocalSocialVideoParseNetwork(svc)
	seedSocialVideoParseAPIs(t, svc,
		socialVideoParseAPI{ID: "api-long", Name: "长视频接口", Platforms: []string{"kuaishou"}, Enabled: true, Method: "GET", URL: server.URL + "/long?url={url}", TimeoutSeconds: 5, Mapping: SocialVideoParseMapping{DurationPath: "data.duration", DurationUnit: "s"}},
		socialVideoParseAPI{ID: "api-next", Name: "不会被调用", Platforms: []string{"kuaishou"}, Enabled: true, Priority: 5, Method: "GET", URL: server.URL + "/good?url={url}", TimeoutSeconds: 5},
	)
	_, err := svc.downloadSocialVideoWithPool(context.Background(), socialVideoParseJob{Platform: "kuaishou", URL: "https://v.kuaishou.com/AbCd12", WorkDir: t.TempDir(), MaxBytes: 10 << 20})
	var appErr *AppError
	if !errors.As(err, &appErr) || appErr.Message != "视频时长超过 3 分钟" {
		t.Fatalf("error = %v, want duration limit", err)
	}
	state, _ := svc.socialVideoParseState()
	if current := state.APIs["api-long"]; current == nil || current.ConsecutiveFailures != 0 || current.FailureCount != 0 {
		t.Fatalf("content error penalized the API: %#v", current)
	}
	if _, called := state.APIs["api-next"]; called {
		t.Fatal("pool kept trying other APIs after a content error")
	}
}

func TestAdminSocialVideoParseAPIsHideSecretsAndRequireAdmin(t *testing.T) {
	svc, _ := newSocialVideoImportTestService(t)
	admin := &model.User{ID: "admin-1", Role: model.UserRoleAdmin}
	if _, err := svc.AdminSocialVideoParseOverview(&model.User{ID: "user-1", Role: "user"}); err == nil {
		t.Fatal("non-admin read the parse pool")
	}
	created, err := svc.CreateSocialVideoParseAPI(admin, SocialVideoParseAPIRequest{Name: "带密钥", Platforms: []string{"douyin"}, Enabled: true, URL: "https://parse.example.com/?url={url}&key={key}", Secret: "sk-live-secret"})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if !created.HasSecret || created.Status != socialVideoParseStatusActive {
		t.Fatalf("created = %#v", created)
	}
	row, err := svc.repo.SystemSetting(socialVideoParseAPIsKey)
	if err != nil || strings.Contains(row.ValueJSON, "sk-live-secret") {
		t.Fatalf("secret stored in plaintext or missing: %v", err)
	}
	overview, err := svc.AdminSocialVideoParseOverview(admin)
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(overview)
	if strings.Contains(string(encoded), "sk-live-secret") || strings.Contains(string(encoded), encryptedSettingPrefix) {
		t.Fatalf("overview leaks the secret: %s", encoded)
	}
	updated, err := svc.UpdateSocialVideoParseAPI(admin, created.ID, SocialVideoParseAPIRequest{Name: "改名", Platforms: []string{"douyin", "tiktok"}, Enabled: true, URL: "https://parse.example.com/?url={url}&key={key}"})
	if err != nil || !updated.HasSecret || updated.Name != "改名" || len(updated.Platforms) != 2 {
		t.Fatalf("update keeping secret = %#v, %v", updated, err)
	}
	apis, _ := svc.socialVideoParseAPIs()
	if secret, err := svc.decryptSettingSecret(apis[0].Secret); err != nil || secret != "sk-live-secret" {
		t.Fatalf("stored secret = %q, %v", secret, err)
	}
	disabled, err := svc.SetSocialVideoParseAPIEnabled(admin, created.ID, false)
	if err != nil || disabled.Enabled || disabled.Status != socialVideoParseStatusDisabled {
		t.Fatalf("disable = %#v, %v", disabled, err)
	}
	copied, err := svc.DuplicateSocialVideoParseAPI(admin, created.ID)
	if err != nil || copied.Enabled || !copied.HasSecret || copied.Name != "改名 副本" {
		t.Fatalf("duplicate = %#v, %v", copied, err)
	}
	exported, err := svc.ExportSocialVideoParseAPIs(admin, nil)
	if err != nil || len(exported.APIs) != 2 || exported.Format != socialVideoParseExportFormat {
		t.Fatalf("export = %#v, %v", exported, err)
	}
	if encoded, _ := json.Marshal(exported); strings.Contains(string(encoded), "sk-live-secret") || strings.Contains(string(encoded), encryptedSettingPrefix) {
		t.Fatalf("export leaks the secret: %s", encoded)
	}
	cleared, err := svc.UpdateSocialVideoParseAPI(admin, copied.ID, SocialVideoParseAPIRequest{Name: "改名 副本", Platforms: []string{"douyin"}, URL: "https://parse.example.com/?url={url}", ClearSecret: true})
	if err != nil || cleared.HasSecret {
		t.Fatalf("clear secret = %#v, %v", cleared, err)
	}
	if err := svc.DeleteSocialVideoParseAPI(admin, copied.ID); err != nil {
		t.Fatal(err)
	}
	if err := svc.DeleteSocialVideoParseAPI(admin, copied.ID); err == nil {
		t.Fatal("deleting a missing API should fail")
	}
}

func TestImportAndSyncSocialVideoParseAPIsDedupeAndAutoEnable(t *testing.T) {
	media := socialVideoTestMP4(t)
	server, _ := newSocialVideoParseServer(t, media)
	svc, _ := newSocialVideoImportTestService(t)
	useLocalSocialVideoParseNetwork(svc)
	admin := &model.User{ID: "admin-1", Role: model.UserRoleAdmin}
	if _, err := svc.UpdateSocialVideoParseSettings(admin, SocialVideoParseSettings{SampleLinks: map[string]string{"douyin": "https://www.douyin.com/video/7391234567890123456"}}); err != nil {
		t.Fatalf("settings: %v", err)
	}
	if _, err := svc.CreateSocialVideoParseAPI(admin, SocialVideoParseAPIRequest{Name: "已有", Platforms: []string{"douyin"}, URL: server.URL + "/good?url={url}"}); err != nil {
		t.Fatal(err)
	}
	result, err := svc.ImportSocialVideoParseAPIs(context.Background(), admin, SocialVideoParseImportRequest{Format: socialVideoParseExportFormat, AutoEnable: true, APIs: []SocialVideoParseAPIRequest{
		{Name: "已有（新名字）", Platforms: []string{"douyin"}, URL: server.URL + "/good?url={url}"},
		{Name: "新的好接口", Platforms: []string{"douyin"}, URL: server.URL + "/good?url={url}&v=2", Mapping: SocialVideoParseMapping{SuccessPath: "code", SuccessValues: "200"}},
		{Name: "新的坏接口", Platforms: []string{"douyin"}, URL: server.URL + "/bad?url={url}"},
		{Name: "", Platforms: []string{"douyin"}, URL: server.URL + "/good?url={url}"},
	}})
	if err != nil {
		t.Fatalf("import: %v", err)
	}
	if result.Created != 2 || result.Updated != 1 || result.Enabled != 1 || len(result.Errors) != 2 {
		t.Fatalf("import result = %#v", result)
	}
	apis, _ := svc.socialVideoParseAPIs()
	enabled := map[string]bool{}
	for _, api := range apis {
		enabled[api.Name] = api.Enabled
	}
	if !enabled["新的好接口"] || enabled["新的坏接口"] || len(apis) != 3 {
		t.Fatalf("enabled after import = %#v", enabled)
	}

	document := SocialVideoParseExport{Format: socialVideoParseExportFormat, Version: 1, APIs: []SocialVideoParseAPIRequest{{Name: "订阅来的", Platforms: []string{"douyin", "kuaishou"}, URL: server.URL + "/good?url={url}&from=feed"}}}
	feed := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(document)
	}))
	defer feed.Close()
	source, err := svc.CreateSocialVideoParseSource(admin, SocialVideoParseSourceRequest{Name: "接口订阅", URL: feed.URL, Enabled: true, AutoEnable: true})
	if err != nil {
		t.Fatalf("create source: %v", err)
	}
	synced, err := svc.SyncSocialVideoParseSource(context.Background(), admin, source.ID)
	if err != nil || synced.Created != 1 || synced.Enabled != 1 {
		t.Fatalf("sync = %#v, %v", synced, err)
	}
	again, err := svc.SyncSocialVideoParseSource(context.Background(), admin, source.ID)
	if err != nil || again.Created != 0 || again.Updated != 1 {
		t.Fatalf("second sync = %#v, %v", again, err)
	}
	sources, _ := svc.socialVideoParseSources()
	if len(sources) != 1 || sources[0].LastTotal != 1 || sources[0].LastSyncedAt == nil || sources[0].LastError != "" {
		t.Fatalf("source status = %#v", sources)
	}
	if err := svc.DeleteSocialVideoParseSource(admin, source.ID, true); err != nil {
		t.Fatal(err)
	}
	if apis, _ := svc.socialVideoParseAPIs(); len(apis) != 3 {
		t.Fatalf("APIs after removing source = %d, want 3", len(apis))
	}
}

func TestRecoverSocialVideoParseAPIsReleasesAfterCooldownWithoutSampleLink(t *testing.T) {
	svc, _ := newSocialVideoImportTestService(t)
	api := socialVideoParseAPI{ID: "api-1", Name: "接口一", Platforms: []string{"weibo"}, Enabled: true, Method: "GET", URL: "https://parse.example.com/?url={url}"}
	seedSocialVideoParseAPIs(t, svc, api)
	disabledAt := time.Now().UTC().Add(-2 * time.Hour)
	raw, _ := json.Marshal(socialVideoParseState{APIs: map[string]*SocialVideoParseAPIState{api.ID: {AutoDisabled: true, AutoDisabledAt: &disabledAt, ConsecutiveFailures: 5}}})
	if err := svc.repo.SaveSystemSetting(&model.SystemSetting{Key: socialVideoParseStateKey, ValueJSON: string(raw)}); err != nil {
		t.Fatal(err)
	}
	svc.recoverSocialVideoParseAPIs(context.Background())
	state, _ := svc.socialVideoParseState()
	if current := state.APIs[api.ID]; current.AutoDisabled || current.ConsecutiveFailures != 2 || len(state.Logs) != 1 || state.Logs[0].Kind != "health" {
		t.Fatalf("state after cooldown = %#v logs=%#v", current, state.Logs)
	}
}

func TestSocialVideoPlatformsReportAvailability(t *testing.T) {
	svc, _ := newSocialVideoImportTestService(t)
	seedSocialVideoParseAPIs(t, svc,
		socialVideoParseAPI{ID: "a", Platforms: []string{"kuaishou"}, Enabled: true},
		socialVideoParseAPI{ID: "b", Platforms: []string{"douyin"}, Enabled: false},
	)
	platforms, err := svc.SocialVideoPlatforms()
	if err != nil {
		t.Fatal(err)
	}
	available := map[string]bool{}
	for _, platform := range platforms {
		available[platform.ID] = platform.Available
	}
	if !available["kuaishou"] || available["douyin"] || len(platforms) != len(socialVideoPlatforms) {
		t.Fatalf("platforms = %#v", platforms)
	}
	if got := socialVideoCanonicalIDFromURL("youtube", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"); got != "dQw4w9WgXcQ" {
		t.Fatalf("youtube id = %q", got)
	}
	if got := socialVideoCanonicalIDFromURL("bilibili", "https://www.bilibili.com/video/BV1xx411c7mD/"); got != "BV1xx411c7mD" {
		t.Fatalf("bilibili id = %q", got)
	}
	if got := socialVideoCanonicalIDFromURL("weibo", "https://video.weibo.com/show?fid=1034:4890123456789"); got != "1034_4890123456789" {
		t.Fatalf("weibo id = %q", got)
	}
	if got := socialVideoCanonicalIDFromURL("xiaohongshu", "https://xhslink.com/a/"); !strings.HasPrefix(got, "u") {
		t.Fatalf("fallback id = %q", got)
	}
}
