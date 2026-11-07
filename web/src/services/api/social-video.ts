import { createClientId } from "@/lib/client-id";
import { getActiveUserScope } from "@/lib/user-scope";
import { http } from "@/services/api/request";
import type { RemoteResource } from "@/services/api/resources";
import type { GenerationTask } from "@/services/api/task-center";

const SOCIAL_VIDEO_ID_PATH = /^\/(?:video|share\/video)\/[0-9]+\/?$/;
const TIKTOK_VIDEO_PATH = /^\/@[^/]+\/video\/[0-9]+\/?$/;
const SOCIAL_VIDEO_CANONICAL_ID = /^[A-Za-z0-9_-]{1,160}$/;
const TRAILING_SHARE_PUNCTUATION = /[.,!?;:，。！？；：、)\]}>"']+$/u;
const SOCIAL_VIDEO_TEXT_MAX_BYTES = 4 << 10;
const SOCIAL_VIDEO_MAX_BYTES = 50 << 20;
const SOCIAL_VIDEO_MAX_DURATION_MS = 180_000;
const SOCIAL_VIDEO_MAX_DIMENSION = 16_384;
const SOCIAL_VIDEO_MAX_PIXELS = 134_217_728;
const SOCIAL_VIDEO_MIME_TYPE = /^video\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*$/;
const SOCIAL_VIDEO_PLATFORM_ID = /^[a-z0-9]{2,24}$/;
const PLATFORM_CACHE_MS = 60_000;

/** 可导入的短视频平台：分享链接的域名、是否走抖音 / TikTok 的严格单视频规则，以及后台有没有开着的解析接口。 */
export type SocialVideoPlatform = { id: string; name: string; hosts: string[]; shortHosts: string[]; strict: boolean; available: boolean };

/** 还没拿到后台平台列表（或请求失败）时用的内置规则：只认抖音和 TikTok。 */
export const BUILTIN_SOCIAL_VIDEO_PLATFORMS: readonly SocialVideoPlatform[] = [
    { id: "douyin", name: "抖音", hosts: ["douyin.com", "www.douyin.com", "m.douyin.com", "www.iesdouyin.com"], shortHosts: ["v.douyin.com"], strict: true, available: true },
    { id: "tiktok", name: "TikTok", hosts: ["tiktok.com", "www.tiktok.com", "m.tiktok.com"], shortHosts: ["vm.tiktok.com", "vt.tiktok.com"], strict: true, available: true },
];

export type SocialVideoLink = { url: string; platform: SocialVideoPlatform; short: boolean };

export type SocialVideoImportResult = {
    platform: string;
    canonicalId: string;
    title: string;
    resourceId: string;
    width: number;
    height: number;
    durationMs: number;
    mimeType: string;
    size: number;
};

function positiveIntegerAtMost(value: unknown, maximum: number) {
    return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= maximum;
}

function validDimensions(width: unknown, height: unknown) {
    return positiveIntegerAtMost(width, SOCIAL_VIDEO_MAX_DIMENSION) && positiveIntegerAtMost(height, SOCIAL_VIDEO_MAX_DIMENSION) && (width as number) * (height as number) <= SOCIAL_VIDEO_MAX_PIXELS;
}

/**
 * 从分享文字里认出唯一的视频链接和平台，规则与服务端一致：抖音 / TikTok 只认 HTTPS 单视频地址，
 * 其他平台只认域名（分享里常见的 http 短链升级成 https），具体能不能解析交给后台的解析接口。
 */
export function socialVideoLinkFromText(text: string, platforms: readonly SocialVideoPlatform[] = BUILTIN_SOCIAL_VIDEO_PLATFORMS): SocialVideoLink | null {
    const trimmed = text.trim();
    if (!trimmed || new TextEncoder().encode(trimmed).byteLength > SOCIAL_VIDEO_TEXT_MAX_BYTES) return null;
    const matches = trimmed.match(/https?:\/\/[^\s<>]+/gu) || [];
    if (matches.length !== 1) return null;
    const raw = matches[0].replace(TRAILING_SHARE_PUNCTUATION, "");
    try {
        const parsed = new URL(raw);
        const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
        const platform = platforms.find((item) => item.shortHosts?.includes(hostname) || item.hosts?.includes(hostname));
        if (!platform) return null;
        const short = Boolean(platform.shortHosts?.includes(hostname));
        if (parsed.protocol !== "https:" && (platform.strict || parsed.protocol !== "http:")) return null;
        if (parsed.username || parsed.password || parsed.hash || (parsed.port && parsed.port !== "443")) return null;
        const path = parsed.pathname || "/";
        if (short || !platform.strict) {
            if (!path.replace(/^\/+|\/+$/g, "") && !parsed.search) return null;
        } else if (!SOCIAL_VIDEO_ID_PATH.test(path) && !(platform.id === "tiktok" && TIKTOK_VIDEO_PATH.test(path))) return null;
        parsed.protocol = "https:";
        parsed.host = hostname;
        return { url: parsed.toString(), platform, short };
    } catch {
        return null;
    }
}

/** 只按内置的抖音 / TikTok 规则取链接，给拿不到后台平台列表的地方用。 */
export function socialVideoURLFromText(text: string) {
    return socialVideoLinkFromText(text)?.url ?? null;
}

/** 平台名称串，用在「只支持……的链接」这类提示里；只列后台有接口的平台，一个都没有时列全部。 */
export function socialVideoPlatformNames(platforms: readonly SocialVideoPlatform[]) {
    const available = platforms.filter((platform) => platform.available);
    return (available.length ? available : platforms).map((platform) => platform.name).join("、");
}

export function listSocialVideoPlatforms(signal?: AbortSignal) {
    return http.get<{ platforms: SocialVideoPlatform[] }>("/social-video/platforms", { signal }).then((data) => (Array.isArray(data?.platforms) ? data.platforms : []));
}

const platformCache = new Map<string, { at: number; promise: Promise<readonly SocialVideoPlatform[]> }>();

/** 带一分钟缓存的平台列表，按账号区分；请求失败或返回空时退回内置规则，下次再重取。 */
export function loadSocialVideoPlatforms(): Promise<readonly SocialVideoPlatform[]> {
    const scope = getActiveUserScope();
    const cached = platformCache.get(scope);
    if (cached && Date.now() - cached.at < PLATFORM_CACHE_MS) return cached.promise;
    const promise: Promise<readonly SocialVideoPlatform[]> = listSocialVideoPlatforms()
        .then((platforms) => {
            if (!platforms.length) throw new Error("empty platform list");
            return platforms;
        })
        .catch(() => {
            if (platformCache.get(scope)?.promise === promise) platformCache.delete(scope);
            return BUILTIN_SOCIAL_VIDEO_PLATFORMS;
        });
    platformCache.set(scope, { at: Date.now(), promise });
    return promise;
}

/** maxDurationSeconds：这次导入能接受的最长秒数（视频复刻按后台的时长上限传）；超长的视频在服务端就失败，不存成资源。 */
export function createSocialVideoImport(url: string, projectId?: string, signal?: AbortSignal, options: { maxDurationSeconds?: number } = {}) {
    const body = { url, ...(projectId ? { projectId } : {}), ...(options.maxDurationSeconds ? { maxDurationSeconds: options.maxDurationSeconds } : {}) };
    return http.post<GenerationTask>("/social-video/imports", body, { signal, headers: { "X-Idempotency-Key": createClientId() } });
}

export function parseSocialVideoImportResult(task: GenerationTask): SocialVideoImportResult {
    let value: unknown;
    try {
        value = JSON.parse(task.resultJson || "");
    } catch {
        throw new Error("平台视频导入结果无效");
    }
    const result = value as Partial<SocialVideoImportResult> | null;
    if (
        !result ||
        typeof result.platform !== "string" ||
        !SOCIAL_VIDEO_PLATFORM_ID.test(result.platform) ||
        typeof result.canonicalId !== "string" ||
        !SOCIAL_VIDEO_CANONICAL_ID.test(result.canonicalId) ||
        typeof result.title !== "string" ||
        typeof result.resourceId !== "string" ||
        !result.resourceId ||
        result.resourceId !== result.resourceId.trim() ||
        !validDimensions(result.width, result.height) ||
        !positiveIntegerAtMost(result.durationMs, SOCIAL_VIDEO_MAX_DURATION_MS) ||
        typeof result.mimeType !== "string" ||
        !SOCIAL_VIDEO_MIME_TYPE.test(result.mimeType) ||
        !positiveIntegerAtMost(result.size, SOCIAL_VIDEO_MAX_BYTES)
    )
        throw new Error("平台视频导入结果无效");
    return result as SocialVideoImportResult;
}

export function validateSocialVideoResource(result: SocialVideoImportResult, resource: RemoteResource) {
    if (resource.id !== result.resourceId || resource.kind !== "video" || resource.status !== "ready") throw new Error("平台视频资源身份或状态无效");
    if (resource.mimeType !== result.mimeType || !SOCIAL_VIDEO_MIME_TYPE.test(resource.mimeType)) throw new Error("平台视频资源类型不匹配");
    if (!positiveIntegerAtMost(resource.size, SOCIAL_VIDEO_MAX_BYTES) || !positiveIntegerAtMost(resource.durationMs, SOCIAL_VIDEO_MAX_DURATION_MS)) throw new Error("平台视频资源信息无效");
    const [width, height] = validDimensions(resource.width, resource.height) ? [resource.width as number, resource.height as number] : [result.width, result.height];
    return {
        id: resource.id,
        width,
        height,
        durationMs: resource.durationMs,
        size: resource.size,
        mimeType: resource.mimeType,
    };
}
