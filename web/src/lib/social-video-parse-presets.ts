import { emptySocialVideoParseAPIInput, type SocialVideoParseAPIInput } from "@/services/api/social-video-parse";

export type SocialParsePreset = { id: string; name: string; source: string; requirement: string; definition: SocialVideoParseAPIInput; instance?: boolean };
const SDK_SOURCE = "https://github.com/hostinger-bot/btch-downloader";
const TIKHUB_SOURCE = "https://github.com/TikHub/TikHub-API-Python-SDK";

function getPreset(id: string, name: string, platforms: string[], url: string, source: string, requirement: string, headers: SocialVideoParseAPIInput["headers"] = []): SocialParsePreset {
    return { id, name, source, requirement, definition: { ...emptySocialVideoParseAPIInput(platforms), name, url, enabled: false, headers, timeoutSeconds: 30, remark: `${requirement}；来源：${source}` } };
}

/** 依据公开 SDK 的请求合同收录，添加为停用草稿，测试成功后才启用。 */
export const SOCIAL_PARSE_PRESETS: SocialParsePreset[] = [
    ...[
        { endpoint: "short_videos", name: "多平台聚合", platforms: ["douyin", "tiktok", "kuaishou", "xiaohongshu", "bilibili", "youtube", "xigua", "haokan", "weishi", "zhihu", "twitter", "instagram", "wechat"] },
        { endpoint: "svparse", name: "聚合解析 2", platforms: ["douyin", "xiaohongshu", "instagram"] },
        { endpoint: "bilibili", name: "B站单视频", platforms: ["bilibili"] },
        { endpoint: "douyin", name: "抖音原画", platforms: ["douyin"] },
        { endpoint: "kuaishou", name: "快手", platforms: ["kuaishou"] },
        { endpoint: "weibo", name: "微博", platforms: ["weibo"] },
        { endpoint: "weibo_v", name: "微博备用", platforms: ["weibo"] },
        { endpoint: "wxsph", name: "微信视频号", platforms: ["wechat"] },
    ].map(({ endpoint, name, platforms }) => {
        const preset = getPreset(`bugpk-${endpoint}`, `BugPk · ${name}`, platforms, `https://api.bugpk.com/api/${endpoint}?url={url}`, `https://api.bugpk.com/doc-${endpoint}.html`, "公开文档标注免费；只导入单视频，本站须测试后启用");
        preset.definition.mapping = { ...preset.definition.mapping, successPath: "code", successValues: "200", videoUrlPath: "data.url", titlePath: "data.title", messagePath: "msg" };
        return preset;
    }),
    ...[
        ["douyin", "抖音", "douyin"],
        ["tiktok", "TikTok", "ttdl"],
        ["xiaohongshu", "小红书", "rednote"],
        ["kuaishou", "快手", "kuaishou"],
        ["youtube", "YouTube", "youtube"],
        ["instagram", "Instagram", "igdl"],
        ["facebook", "Facebook", "fbdown"],
        ["twitter", "X / Twitter", "twitter"],
        ["threads", "Threads", "threads"],
        ["snackvideo", "SnackVideo", "snackvideo"],
        ["cocofun", "Cocofun", "cocofun"],
    ].map(([platform, name, endpoint]) =>
        getPreset(`btch-${platform}`, `BTCH · ${name}`, [platform], `https://backend1.tioo.eu.org/${endpoint}?url={url}`, SDK_SOURCE, "公开服务，限流与可用性以服务方为准", [
            { name: "User-Agent", value: "btch/6.4.0" },
            { name: "X-Client-Version", value: "6.4.0" },
        ]),
    ),
    getPreset("tikhub-douyin", "TikHub · 抖音分享解析", ["douyin"], "https://api.tikhub.io/api/v1/douyin/web/fetch_one_video_by_share_url?share_url={url}", TIKHUB_SOURCE, "需要 TikHub 密钥，调用可能计费", [
        { name: "Authorization", value: "Bearer {key}" },
    ]),
    getPreset("tikhub-douyin-hq", "TikHub · 抖音高清地址", ["douyin"], "https://api.tikhub.io/api/v1/douyin/web/fetch_video_high_quality_play_url?share_url={url}", TIKHUB_SOURCE, "需要 TikHub 密钥，调用可能计费", [
        { name: "Authorization", value: "Bearer {key}" },
    ]),
    getPreset("tikhub-kuaishou", "TikHub · 快手分享解析", ["kuaishou"], "https://api.tikhub.io/api/v1/kuaishou/web/fetch_one_video_by_url?url={url}", TIKHUB_SOURCE, "需要 TikHub 密钥，调用可能计费", [{ name: "Authorization", value: "Bearer {key}" }]),
    ...[
        ["tiktok-v1", "TikTok 分享解析", "tiktok", "/api/v1/tiktok/app/v3/fetch_one_video_by_share_url?share_url={url}"],
        ["tiktok-v2", "TikTok 分享解析 V2", "tiktok", "/api/v1/tiktok/app/v3/fetch_one_video_by_share_url_v2?share_url={url}"],
        ["xiaohongshu", "小红书视频笔记", "xiaohongshu", "/api/v1/xiaohongshu/app_v2/get_video_note_detail?share_text={url}"],
        ["instagram", "Instagram 作品", "instagram", "/api/v1/instagram/v3/get_post_info?url={url}"],
        ["youtube", "YouTube 视频流", "youtube", "/api/v1/youtube/web_v2/get_video_streams?video_url={url}"],
    ].map(([id, name, platform, endpoint]) => getPreset(`tikhub-${id}`, `TikHub · ${name}`, [platform], `https://api.tikhub.io${endpoint}`, TIKHUB_SOURCE, "需要 TikHub 密钥，调用可能计费", [{ name: "Authorization", value: "Bearer {key}" }])),
    {
        id: "cobalt",
        name: "Cobalt · 自部署多平台",
        source: "https://github.com/imputnet/cobalt/blob/main/docs/api.md",
        requirement: "填写自己的 Cobalt 实例地址，公共官网不作为默认接口",
        instance: true,
        definition: {
            ...emptySocialVideoParseAPIInput(["tiktok", "youtube", "bilibili", "instagram", "facebook", "twitter", "vimeo", "pinterest"]),
            name: "Cobalt · 自部署多平台",
            enabled: false,
            method: "POST",
            url: "",
            bodyType: "json",
            body: '{"url":"{url}","videoQuality":"1080","downloadMode":"auto"}',
            headers: [{ name: "Accept", value: "application/json" }],
            mapping: { ...emptySocialVideoParseAPIInput().mapping, successPath: "status", successValues: "tunnel,redirect", videoUrlPath: "url", messagePath: "error.code" },
            remark: "仅连接自己的实例；返回 picker 的图集不作为单视频。来源：https://github.com/imputnet/cobalt/blob/main/docs/api.md",
        },
    },
];

export function socialParsePresetInput(preset: SocialParsePreset, instanceUrl = ""): SocialVideoParseAPIInput {
    const definition = structuredClone(preset.definition);
    if (preset.instance) {
        const parsed = new URL(instanceUrl);
        if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error("实例地址须为无凭据和查询参数的 HTTPS 地址");
        definition.url = parsed.toString();
    }
    return definition;
}
