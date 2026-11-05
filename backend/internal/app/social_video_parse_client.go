package app

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gabriel-vasile/mimetype"
	"yingce/backend/internal/outbound"
)

const (
	socialVideoParseResponseLimit = 1 << 20
	socialVideoParsePreviewLimit  = 4 << 10
	socialVideoMediaSniffBytes    = 64 << 10
	socialVideoDownloadTimeout    = 5 * time.Minute
	// 下载 CDN 视频时默认带的浏览器标识；不少平台的视频地址拒绝非浏览器请求。
	socialVideoDownloadUserAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
)

var socialVideoParsePlaceholder = regexp.MustCompile(`\{(url|platform|key)\}`)

// socialVideoParseStageError 记下接口在哪一步失败（request / response / mapping / media / download / probe），写进调用记录。
type socialVideoParseStageError struct {
	Stage   string
	Message string
}

func (e *socialVideoParseStageError) Error() string { return e.Message }

func parseStageError(stage, format string, args ...any) error {
	return &socialVideoParseStageError{Stage: stage, Message: fmt.Sprintf(format, args...)}
}

// socialVideoContentError 表示视频本身不符合要求（太长、太大），换接口也没用，不计入接口失败。
type socialVideoContentError struct{ Message string }

func (e *socialVideoContentError) Error() string { return e.Message }

// socialVideoParseResult 是从接口返回里取出的字段。
type socialVideoParseResult struct {
	VideoURL     string `json:"videoUrl"`
	Title        string `json:"title"`
	Cover        string `json:"cover"`
	ID           string `json:"id"`
	DurationMs   int64  `json:"durationMs"`
	VideoURLPath string `json:"videoUrlPath"`
}

func renderSocialVideoParseTemplate(template string, vars map[string]string, encode func(string) string) string {
	return socialVideoParsePlaceholder.ReplaceAllStringFunc(template, func(match string) string {
		return encode(vars[match[1:len(match)-1]])
	})
}

func socialVideoJSONEscape(value string) string {
	encoded, _ := json.Marshal(value)
	return string(encoded[1 : len(encoded)-1])
}

func socialVideoHeaderValue(value string) string {
	return strings.NewReplacer("\r", "", "\n", "").Replace(value)
}

func (s *Service) socialVideoParseClient(timeout time.Duration) *http.Client {
	if s.socialVideoParseHTTPClient != nil {
		return s.socialVideoParseHTTPClient(timeout)
	}
	return outbound.OutboundHTTPClient(timeout)
}

func (s *Service) validateSocialVideoParseURL(raw string) error {
	validator := s.socialVideoParseURLValidator
	if validator == nil {
		validator = ValidateOutboundURL
	}
	_, err := validator(raw)
	return err
}

// buildSocialVideoParseRequest 按接口模板拼出请求；api.Secret 必须是已解密的明文。
func (s *Service) buildSocialVideoParseRequest(ctx context.Context, api socialVideoParseAPI, videoURL, platform string) (*http.Request, error) {
	vars := map[string]string{"url": videoURL, "platform": platform, "key": api.Secret}
	target := renderSocialVideoParseTemplate(api.URL, vars, url.QueryEscape)
	if err := s.validateSocialVideoParseURL(target); err != nil {
		return nil, parseStageError("request", "接口地址不可访问：%s", socialVideoShortError(err))
	}
	var body io.Reader
	contentType := ""
	switch api.BodyType {
	case "json":
		body = strings.NewReader(renderSocialVideoParseTemplate(api.Body, vars, socialVideoJSONEscape))
		contentType = "application/json"
	case "form":
		body = strings.NewReader(renderSocialVideoParseTemplate(api.Body, vars, url.QueryEscape))
		contentType = "application/x-www-form-urlencoded"
	}
	req, err := http.NewRequestWithContext(ctx, api.Method, target, body)
	if err != nil {
		return nil, parseStageError("request", "接口地址无效")
	}
	req.Header.Set("Accept", "application/json, text/plain, */*")
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	for _, header := range api.Headers {
		req.Header.Set(header.Name, socialVideoHeaderValue(renderSocialVideoParseTemplate(header.Value, vars, func(value string) string { return value })))
	}
	outbound.ApplyDefaultOutboundHeaders(req)
	return req, nil
}

// callSocialVideoParseAPI 调一次接口，返回状态码和最多 1 MiB 的响应正文。
func (s *Service) callSocialVideoParseAPI(ctx context.Context, api socialVideoParseAPI, videoURL, platform string) (int, []byte, error) {
	timeout := time.Duration(max(api.TimeoutSeconds, 3)) * time.Second
	callCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	req, err := s.buildSocialVideoParseRequest(callCtx, api, videoURL, platform)
	if err != nil {
		return 0, nil, err
	}
	resp, err := s.socialVideoParseClient(timeout).Do(req)
	if err != nil {
		if callCtx.Err() != nil && ctx.Err() == nil {
			return 0, nil, parseStageError("request", "接口 %d 秒内没有响应", int(timeout.Seconds()))
		}
		return 0, nil, parseStageError("request", "接口请求失败：%s", socialVideoShortError(err))
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, socialVideoParseResponseLimit+1))
	if err != nil {
		return resp.StatusCode, nil, parseStageError("response", "读取接口返回失败")
	}
	if len(raw) > socialVideoParseResponseLimit {
		return resp.StatusCode, nil, parseStageError("response", "接口返回超过 1 MiB")
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		if message := socialVideoParseUpstreamMessage(raw, api.Mapping.MessagePath, api.Secret); message != "" {
			return resp.StatusCode, raw, parseStageError("response", "接口返回 HTTP %d：%s", resp.StatusCode, message)
		}
		return resp.StatusCode, raw, parseStageError("response", "接口返回 HTTP %d", resp.StatusCode)
	}
	return resp.StatusCode, raw, nil
}

// socialVideoParseUpstreamMessage 从出错的返回里找一句说明：先看配置的错误信息字段，再看常见的 msg / message / error。
func socialVideoParseUpstreamMessage(raw []byte, messagePath, secret string) string {
	var root any
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	if decoder.Decode(&root) != nil {
		return ""
	}
	paths := []string{"msg", "message", "error.message", "error", "errmsg", "error_msg", "detail"}
	if messagePath != "" {
		paths = append([]string{messagePath}, paths...)
	}
	for _, path := range paths {
		if value, ok := socialVideoJSONPath(root, path); ok {
			if text, isText := value.(string); isText && strings.TrimSpace(text) != "" {
				return trimmedRunes(redactSocialVideoSecret(strings.TrimSpace(text), secret), 80)
			}
		}
	}
	return ""
}

// redactSocialVideoSecret 把接口回显的密钥换成 ***：错误说明会写进调用记录，也会显示给导入链接的用户。
// 要在截断之前调用，否则截到一半的密钥换不掉。
func redactSocialVideoSecret(text, secret string) string {
	if secret == "" || text == "" {
		return text
	}
	return strings.ReplaceAll(text, secret, "***")
}

// mapSocialVideoParseResponse 按字段映射从返回里取视频地址等信息；没配视频地址路径时自动识别。
// secret 是这条接口的明文密钥，只用来从接口回显的错误信息里抹掉它。
func mapSocialVideoParseResponse(raw []byte, mapping SocialVideoParseMapping, secret string) (socialVideoParseResult, error) {
	var root any
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	if err := decoder.Decode(&root); err != nil {
		return socialVideoParseResult{}, parseStageError("mapping", "接口返回的不是 JSON")
	}
	if mapping.SuccessPath != "" {
		value, found := socialVideoJSONPath(root, mapping.SuccessPath)
		actual := socialVideoJSONString(value)
		if !found || !socialVideoParseSuccessValue(actual, mapping.SuccessValues) {
			message := ""
			if mapping.MessagePath != "" {
				if text, ok := socialVideoJSONPath(root, mapping.MessagePath); ok {
					message = trimmedRunes(redactSocialVideoSecret(socialVideoJSONString(text), secret), 120)
				}
			}
			if message == "" {
				message = fmt.Sprintf("%s = %s", mapping.SuccessPath, trimmedRunes(redactSocialVideoSecret(actual, secret), 40))
			}
			return socialVideoParseResult{}, parseStageError("mapping", "接口返回失败：%s", message)
		}
	}
	result := socialVideoParseResult{}
	if mapping.VideoURLPath != "" {
		value, found := socialVideoJSONPath(root, mapping.VideoURLPath)
		if !found {
			return result, parseStageError("mapping", "接口返回里没有 %s", mapping.VideoURLPath)
		}
		result.VideoURL, result.VideoURLPath = socialVideoJSONString(value), mapping.VideoURLPath
	} else {
		result.VideoURL, result.VideoURLPath = detectSocialVideoURL(root)
		if result.VideoURL == "" {
			return result, parseStageError("mapping", "没在接口返回里找到视频地址，请填写视频地址字段")
		}
	}
	videoURL, err := normalizeSocialVideoMediaURL(result.VideoURL)
	if err != nil {
		return result, err
	}
	result.VideoURL = videoURL
	if mapping.TitlePath != "" {
		if value, ok := socialVideoJSONPath(root, mapping.TitlePath); ok {
			result.Title = trimmedRunes(socialVideoJSONString(value), 200)
		}
	} else {
		result.Title = detectSocialVideoTitle(root)
	}
	if mapping.CoverPath != "" {
		if value, ok := socialVideoJSONPath(root, mapping.CoverPath); ok {
			if cover, err := normalizeSocialVideoMediaURL(socialVideoJSONString(value)); err == nil {
				result.Cover = cover
			}
		}
	}
	if mapping.IDPath != "" {
		if value, ok := socialVideoJSONPath(root, mapping.IDPath); ok {
			if id := strings.TrimSpace(socialVideoJSONString(value)); socialVideoCanonicalID.MatchString(id) {
				result.ID = id
			}
		}
	}
	if mapping.DurationPath != "" {
		if value, ok := socialVideoJSONPath(root, mapping.DurationPath); ok {
			if number, err := strconv.ParseFloat(socialVideoJSONString(value), 64); err == nil && number > 0 && !math.IsInf(number, 0) {
				if mapping.DurationUnit != "ms" {
					number *= 1000
				}
				result.DurationMs = int64(math.Round(number))
			}
		}
	}
	return result, nil
}

func socialVideoParseSuccessValue(actual, accepted string) bool {
	actual = strings.ToLower(strings.TrimSpace(actual))
	for _, candidate := range strings.Split(accepted, ",") {
		if strings.ToLower(strings.TrimSpace(candidate)) == actual {
			return true
		}
	}
	return false
}

func normalizeSocialVideoMediaURL(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if strings.HasPrefix(raw, "//") {
		raw = "https:" + raw
	}
	parsed, err := url.Parse(raw)
	if raw == "" || len(raw) > 4096 || err != nil || !parsed.IsAbs() || parsed.Hostname() == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.User != nil {
		return "", parseStageError("mapping", "接口给的视频地址无效")
	}
	return parsed.String(), nil
}

// socialVideoJSONPath 按 a.b[0].c 这样的路径取值，数组下标也可以写成 a.b.0.c。
func socialVideoJSONPath(root any, path string) (any, bool) {
	path = strings.TrimPrefix(strings.TrimSpace(path), "$")
	path = strings.NewReplacer("[", ".", "]", "").Replace(path)
	current := root
	for _, part := range strings.Split(path, ".") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		switch node := current.(type) {
		case map[string]any:
			value, ok := node[part]
			if !ok {
				return nil, false
			}
			current = value
		case []any:
			index, err := strconv.Atoi(part)
			if err != nil || index < 0 || index >= len(node) {
				return nil, false
			}
			current = node[index]
		default:
			return nil, false
		}
	}
	return current, true
}

func socialVideoJSONString(value any) string {
	switch typed := value.(type) {
	case nil:
		return ""
	case string:
		return typed
	case json.Number:
		return typed.String()
	case bool:
		return strconv.FormatBool(typed)
	case float64:
		return strconv.FormatFloat(typed, 'f', -1, 64)
	default:
		encoded, _ := json.Marshal(typed)
		return string(encoded)
	}
}

type socialVideoURLCandidate struct {
	value string
	path  string
	score int
}

var (
	socialVideoKeyPositive = []string{"nwm", "nowatermark", "no_watermark", "video", "play", "mp4", "download"}
	socialVideoKeyWeak     = []string{"url", "src", "link", "addr"}
	socialVideoKeyNegative = []string{"cover", "image", "img", "pic", "avatar", "thumb", "music", "audio", "author", "icon", "poster", "logo", "share", "origin"}
)

// detectSocialVideoURL 在返回里挑最像视频文件的地址：看字段名（video、play、nwm）和地址（.mp4、/play/），排除封面、头像、音乐。
func detectSocialVideoURL(root any) (string, string) {
	var best socialVideoURLCandidate
	var walk func(node any, path, key string, depth int)
	walk = func(node any, path, key string, depth int) {
		if depth > 8 {
			return
		}
		switch typed := node.(type) {
		case map[string]any:
			keys := make([]string, 0, len(typed))
			for name := range typed {
				keys = append(keys, name)
			}
			sort.Strings(keys)
			for _, name := range keys {
				walk(typed[name], joinSocialVideoPath(path, name), name, depth+1)
			}
		case []any:
			for index, item := range typed {
				walk(item, fmt.Sprintf("%s[%d]", path, index), key, depth+1)
			}
		case string:
			lowered := strings.ToLower(strings.TrimSpace(typed))
			if !strings.HasPrefix(lowered, "http://") && !strings.HasPrefix(lowered, "https://") && !strings.HasPrefix(lowered, "//") {
				return
			}
			score := socialVideoURLScore(strings.ToLower(key), lowered)
			if score > best.score {
				best = socialVideoURLCandidate{value: typed, path: path, score: score}
			}
		}
	}
	walk(root, "", "", 0)
	if best.score < 3 {
		return "", ""
	}
	return best.value, best.path
}

func joinSocialVideoPath(path, name string) string {
	if path == "" {
		return name
	}
	return path + "." + name
}

func socialVideoURLScore(key, value string) int {
	score := 0
	for _, word := range socialVideoKeyNegative {
		if strings.Contains(key, word) {
			score -= 6
		}
	}
	for _, word := range socialVideoKeyPositive {
		if strings.Contains(key, word) {
			score += 3
			break
		}
	}
	for _, word := range socialVideoKeyWeak {
		if strings.Contains(key, word) {
			score++
			break
		}
	}
	pathPart, _, _ := strings.Cut(value, "?")
	switch {
	case strings.HasSuffix(pathPart, ".mp4"), strings.HasSuffix(pathPart, ".mov"), strings.HasSuffix(pathPart, ".webm"), strings.HasSuffix(pathPart, ".m4v"):
		score += 4
	case strings.Contains(value, "/play/") || strings.Contains(value, "video") || strings.Contains(value, "mime_type=video"):
		score += 2
	}
	for _, suffix := range []string{".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic", ".image", ".mp3", ".m4a", ".aac", ".m3u8"} {
		if strings.HasSuffix(pathPart, suffix) {
			score -= 6
		}
	}
	if strings.Contains(value, "~tplv-") {
		score -= 6
	}
	return score
}

// detectSocialVideoTitle 在前三层里找 title / desc / caption 作为标题。
func detectSocialVideoTitle(root any) string {
	queue := []struct {
		node  any
		depth int
	}{{root, 0}}
	for len(queue) > 0 {
		item := queue[0]
		queue = queue[1:]
		object, ok := item.node.(map[string]any)
		if !ok || item.depth > 3 {
			continue
		}
		for _, name := range []string{"title", "desc", "caption", "text"} {
			if text, ok := object[name].(string); ok && strings.TrimSpace(text) != "" {
				return trimmedRunes(text, 200)
			}
		}
		keys := make([]string, 0, len(object))
		for name := range object {
			keys = append(keys, name)
		}
		sort.Strings(keys)
		for _, name := range keys {
			if child, ok := object[name].(map[string]any); ok {
				queue = append(queue, struct {
					node  any
					depth int
				}{child, item.depth + 1})
			}
		}
	}
	return ""
}

func (s *Service) socialVideoMediaRequest(ctx context.Context, api socialVideoParseAPI, mediaURL string) (*http.Request, error) {
	if err := s.validateSocialVideoParseURL(mediaURL); err != nil {
		return nil, parseStageError("media", "视频地址不可访问：%s", socialVideoShortError(err))
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, mediaURL, nil)
	if err != nil {
		return nil, parseStageError("media", "视频地址无效")
	}
	req.Header.Set("User-Agent", socialVideoDownloadUserAgent)
	req.Header.Set("Accept", "*/*")
	for _, header := range api.DownloadHeaders {
		req.Header.Set(header.Name, socialVideoHeaderValue(header.Value))
	}
	return req, nil
}

// SocialVideoMediaCheck 是测试时对视频地址的检查结果：只读开头 64 KiB 看是不是视频。
type SocialVideoMediaCheck struct {
	Status      int    `json:"status"`
	ContentType string `json:"contentType"`
	MimeType    string `json:"mimeType"`
	Bytes       int    `json:"bytes"`
}

func (s *Service) checkSocialVideoMedia(ctx context.Context, api socialVideoParseAPI, mediaURL string) (SocialVideoMediaCheck, error) {
	checkCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	req, err := s.socialVideoMediaRequest(checkCtx, api, mediaURL)
	if err != nil {
		return SocialVideoMediaCheck{}, err
	}
	req.Header.Set("Range", fmt.Sprintf("bytes=0-%d", socialVideoMediaSniffBytes-1))
	resp, err := s.socialVideoParseClient(30 * time.Second).Do(req)
	if err != nil {
		return SocialVideoMediaCheck{}, parseStageError("media", "打不开视频地址：%s", socialVideoShortError(err))
	}
	defer resp.Body.Close()
	head, _ := io.ReadAll(io.LimitReader(resp.Body, socialVideoMediaSniffBytes))
	check := SocialVideoMediaCheck{Status: resp.StatusCode, ContentType: resp.Header.Get("Content-Type"), MimeType: mimetype.Detect(head).String(), Bytes: len(head)}
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusPartialContent {
		return check, parseStageError("media", "视频地址返回 HTTP %d", resp.StatusCode)
	}
	if !strings.HasPrefix(check.MimeType, "video/") {
		return check, parseStageError("media", "视频地址打开的不是视频文件（%s）", check.MimeType)
	}
	return check, nil
}

// downloadSocialVideoMedia 把视频下载到 path，超过 maxBytes 立即停下。
func (s *Service) downloadSocialVideoMedia(ctx context.Context, api socialVideoParseAPI, mediaURL, path string, maxBytes int64) (int64, error) {
	downloadCtx, cancel := context.WithTimeout(ctx, socialVideoDownloadTimeout)
	defer cancel()
	req, err := s.socialVideoMediaRequest(downloadCtx, api, mediaURL)
	if err != nil {
		return 0, err
	}
	resp, err := s.socialVideoParseClient(socialVideoDownloadTimeout).Do(req)
	if err != nil {
		if downloadCtx.Err() != nil && ctx.Err() == nil {
			return 0, parseStageError("download", "视频下载超时")
		}
		return 0, parseStageError("download", "视频下载失败：%s", socialVideoShortError(err))
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return 0, parseStageError("download", "视频地址返回 HTTP %d", resp.StatusCode)
	}
	contentType := strings.ToLower(resp.Header.Get("Content-Type"))
	if strings.HasPrefix(contentType, "text/html") || strings.HasPrefix(contentType, "application/json") {
		return 0, parseStageError("download", "视频地址打开的是网页或 JSON，不是视频文件")
	}
	if resp.ContentLength > maxBytes {
		return 0, &socialVideoContentError{Message: "视频文件超过导入大小限制"}
	}
	file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return 0, errors.New("无法创建视频下载文件")
	}
	written, copyErr := io.Copy(file, io.LimitReader(resp.Body, maxBytes+1))
	closeErr := file.Close()
	switch {
	case written > maxBytes:
		return 0, &socialVideoContentError{Message: "视频文件超过导入大小限制"}
	case copyErr != nil:
		if downloadCtx.Err() != nil && ctx.Err() == nil {
			return 0, parseStageError("download", "视频下载超时")
		}
		return 0, parseStageError("download", "视频下载中断：%s", socialVideoShortError(copyErr))
	case closeErr != nil:
		return 0, errors.New("视频下载文件写入失败")
	case written == 0:
		return 0, parseStageError("download", "视频地址返回了空文件")
	}
	return written, nil
}

// socialVideoShortError 只保留错误的最后一段，避免把带密钥的完整地址写进记录。
func socialVideoShortError(err error) string {
	if err == nil {
		return ""
	}
	var appErr *AppError
	if errors.As(err, &appErr) && appErr.Message != "" {
		return trimmedRunes(appErr.Message, 120)
	}
	var urlErr *url.Error
	if errors.As(err, &urlErr) && urlErr.Err != nil {
		err = urlErr.Err
	}
	return trimmedRunes(err.Error(), 120)
}
