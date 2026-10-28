import { createClientId } from "@/lib/client-id";
import { http } from "@/services/api/request";
import type { RemoteResource } from "@/services/api/resources";
import type { GenerationTask } from "@/services/api/task-center";

const SOCIAL_VIDEO_HOSTS: ReadonlyMap<string, { platform: "douyin" | "tiktok"; short: boolean }> = new Map([
    ["v.douyin.com", { platform: "douyin", short: true }],
    ["douyin.com", { platform: "douyin", short: false }],
    ["www.douyin.com", { platform: "douyin", short: false }],
    ["m.douyin.com", { platform: "douyin", short: false }],
    ["www.iesdouyin.com", { platform: "douyin", short: false }],
    ["vm.tiktok.com", { platform: "tiktok", short: true }],
    ["vt.tiktok.com", { platform: "tiktok", short: true }],
    ["tiktok.com", { platform: "tiktok", short: false }],
    ["www.tiktok.com", { platform: "tiktok", short: false }],
    ["m.tiktok.com", { platform: "tiktok", short: false }],
]);
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

export type SocialVideoImportResult = {
    platform: "douyin" | "tiktok";
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

export function socialVideoURLFromText(text: string) {
    const trimmed = text.trim();
    if (!trimmed || new TextEncoder().encode(trimmed).byteLength > SOCIAL_VIDEO_TEXT_MAX_BYTES) return null;
    const matches = trimmed.match(/https?:\/\/[^\s<>]+/gu) || [];
    if (matches.length !== 1) return null;
    const raw = matches[0].replace(TRAILING_SHARE_PUNCTUATION, "");
    try {
        const parsed = new URL(raw);
        if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash || (parsed.port && parsed.port !== "443")) return null;
        const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
        const source = SOCIAL_VIDEO_HOSTS.get(hostname);
        if (!source) return null;
        const path = parsed.pathname || "/";
        if (source.short ? !path.replace(/^\/+|\/+$/g, "") : !SOCIAL_VIDEO_ID_PATH.test(path) && !(source.platform === "tiktok" && TIKTOK_VIDEO_PATH.test(path))) return null;
        parsed.protocol = "https:";
        parsed.host = hostname;
        return parsed.toString();
    } catch {
        return null;
    }
}

export function createSocialVideoImport(url: string, projectId?: string, signal?: AbortSignal) {
    return http.post<GenerationTask>("/social-video/imports", { url, ...(projectId ? { projectId } : {}) }, { signal, headers: { "X-Idempotency-Key": createClientId() } });
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
        (result.platform !== "douyin" && result.platform !== "tiktok") ||
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
