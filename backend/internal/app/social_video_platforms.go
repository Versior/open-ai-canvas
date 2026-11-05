package app

import (
	"crypto/sha256"
	"encoding/hex"
	"net/url"
	"strings"
)

// socialVideoPlatformInfo 是一个可导入的短视频平台：识别分享链接用的域名，以及是否走抖音 / TikTok 的严格规则。
// Strict 平台沿用单视频路径校验，并在导入前展开短链拿到视频 ID；其他平台只认域名，链接原样交给解析接口。
type socialVideoPlatformInfo struct {
	ID         string
	Name       string
	Hosts      []string
	ShortHosts []string
	Strict     bool
}

var socialVideoPlatforms = []socialVideoPlatformInfo{
	{ID: "douyin", Name: "抖音", Hosts: []string{"douyin.com", "www.douyin.com", "m.douyin.com", "www.iesdouyin.com"}, ShortHosts: []string{"v.douyin.com"}, Strict: true},
	{ID: "tiktok", Name: "TikTok", Hosts: []string{"tiktok.com", "www.tiktok.com", "m.tiktok.com"}, ShortHosts: []string{"vm.tiktok.com", "vt.tiktok.com"}, Strict: true},
	{ID: "kuaishou", Name: "快手", Hosts: []string{"kuaishou.com", "www.kuaishou.com", "m.kuaishou.com", "v.m.chenzhongtech.com", "m.gifshow.com", "www.gifshow.com"}, ShortHosts: []string{"v.kuaishou.com"}},
	// 小红书 iOS 新版分享出来的是 xhslink.cn，旧分享和网页端是 xhslink.com。
	{ID: "xiaohongshu", Name: "小红书", Hosts: []string{"xiaohongshu.com", "www.xiaohongshu.com"}, ShortHosts: []string{"xhslink.com", "xhslink.cn"}},
	{ID: "bilibili", Name: "哔哩哔哩", Hosts: []string{"bilibili.com", "www.bilibili.com", "m.bilibili.com"}, ShortHosts: []string{"b23.tv"}},
	{ID: "weibo", Name: "微博", Hosts: []string{"weibo.com", "www.weibo.com", "m.weibo.cn", "video.weibo.com"}},
	{ID: "youtube", Name: "YouTube", Hosts: []string{"youtube.com", "www.youtube.com", "m.youtube.com"}, ShortHosts: []string{"youtu.be"}},
}

// SocialVideoPlatformView 给前端识别链接和后台分类用；Available 表示后台有开着的解析接口。
type SocialVideoPlatformView struct {
	ID         string   `json:"id"`
	Name       string   `json:"name"`
	Hosts      []string `json:"hosts"`
	ShortHosts []string `json:"shortHosts"`
	Strict     bool     `json:"strict"`
	Available  bool     `json:"available"`
}

func socialVideoPlatformByID(id string) *socialVideoPlatformInfo {
	for index := range socialVideoPlatforms {
		if socialVideoPlatforms[index].ID == id {
			return &socialVideoPlatforms[index]
		}
	}
	return nil
}

func socialVideoPlatformForHost(host string) (*socialVideoPlatformInfo, bool) {
	for index := range socialVideoPlatforms {
		platform := &socialVideoPlatforms[index]
		for _, candidate := range platform.ShortHosts {
			if host == candidate {
				return platform, true
			}
		}
		for _, candidate := range platform.Hosts {
			if host == candidate {
				return platform, false
			}
		}
	}
	return nil, false
}

// socialVideoPlatform 按域名认平台，short 表示短链域名。
func socialVideoPlatform(host string) (platform string, short bool) {
	info, short := socialVideoPlatformForHost(host)
	if info == nil {
		return "", false
	}
	return info.ID, short
}

func socialVideoPlatformNames() string {
	names := make([]string, 0, len(socialVideoPlatforms))
	for _, platform := range socialVideoPlatforms {
		names = append(names, platform.Name)
	}
	return strings.Join(names, "、")
}

// socialVideoCanonicalIDFromURL 从单视频地址里取稳定的视频 ID，用来给同一条视频去重；取不到时用链接摘要。
func socialVideoCanonicalIDFromURL(platform, raw string) string {
	parsed, err := url.Parse(raw)
	if err != nil {
		return socialVideoURLDigest(raw)
	}
	if platform == "youtube" {
		if id := parsed.Query().Get("v"); socialVideoCanonicalID.MatchString(id) {
			return id
		}
	}
	segments := strings.Split(strings.Trim(parsed.EscapedPath(), "/"), "/")
	for index := len(segments) - 1; index >= 0; index-- {
		segment := segments[index]
		if platform == "weibo" {
			segment = strings.ReplaceAll(segment, ":", "_")
		}
		if len(segment) >= 6 && socialVideoCanonicalID.MatchString(segment) {
			return segment
		}
	}
	if platform == "weibo" {
		if fid := strings.ReplaceAll(parsed.Query().Get("fid"), ":", "_"); socialVideoCanonicalID.MatchString(fid) {
			return fid
		}
	}
	return socialVideoURLDigest(raw)
}

func socialVideoURLDigest(raw string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(raw)))
	return "u" + hex.EncodeToString(sum[:15])
}

// SocialVideoPlatforms 列出能导入的平台；登录用户都能看，用来在前端识别分享链接。
func (s *Service) SocialVideoPlatforms() ([]SocialVideoPlatformView, error) {
	apis, err := s.socialVideoParseAPIs()
	if err != nil {
		return nil, err
	}
	available := map[string]bool{}
	for _, api := range apis {
		if !api.Enabled {
			continue
		}
		for _, platform := range api.Platforms {
			available[platform] = true
		}
	}
	views := make([]SocialVideoPlatformView, 0, len(socialVideoPlatforms))
	for _, platform := range socialVideoPlatforms {
		views = append(views, SocialVideoPlatformView{ID: platform.ID, Name: platform.Name, Hosts: platform.Hosts, ShortHosts: platform.ShortHosts, Strict: platform.Strict, Available: available[platform.ID]})
	}
	return views, nil
}
