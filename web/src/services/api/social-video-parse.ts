import { http } from "@/services/api/request";
import type { SocialVideoPlatform } from "@/services/api/social-video";

/** 后台「视频复刻 · 解析接口」：第三方解析接口池、订阅源和全局设置。接口与字段说明见 docs/content/docs/backend/http-api.mdx。 */

export type SocialVideoParseStrategy = "priority" | "round_robin" | "weighted" | "fastest";

export type SocialVideoParseSettings = {
    strategy: SocialVideoParseStrategy;
    maxAttempts: number;
    failureThreshold: number;
    autoRecover: boolean;
    recoverAfterMinutes: number;
    healthCheckMinutes: number;
    sampleLinks: Record<string, string>;
};

export type SocialVideoParseHeader = { name: string; value: string };

export type SocialVideoParseMapping = {
    successPath: string;
    successValues: string;
    videoUrlPath: string;
    titlePath: string;
    coverPath: string;
    idPath: string;
    durationPath: string;
    durationUnit: "s" | "ms";
    messagePath: string;
};

/** 新建、修改、导入一条接口时提交的定义；secret 只写不读，留空表示不改。 */
export type SocialVideoParseAPIInput = {
    category?: string;
    name: string;
    platforms: string[];
    enabled: boolean;
    priority: number;
    weight: number;
    method: "GET" | "POST";
    url: string;
    bodyType: "none" | "json" | "form";
    body: string;
    headers: SocialVideoParseHeader[];
    secret?: string;
    clearSecret?: boolean;
    timeoutSeconds: number;
    mapping: SocialVideoParseMapping;
    downloadHeaders: SocialVideoParseHeader[];
    remark: string;
};

export type SocialVideoParseAPIState = {
    consecutiveFailures: number;
    autoDisabled: boolean;
    autoDisabledAt?: string;
    autoDisabledReason?: string;
    successCount: number;
    failureCount: number;
    lastSuccessAt?: string;
    lastFailureAt?: string;
    lastCheckedAt?: string;
    lastError?: string;
    lastLatencyMs: number;
    avgLatencyMs: number;
    recent: boolean[];
};

export type SocialVideoParseStatus = "active" | "auto_disabled" | "disabled";

export type SocialVideoParseAPI = Omit<SocialVideoParseAPIInput, "secret" | "clearSecret"> & {
    id: string;
    hasSecret: boolean;
    sourceId?: string;
    createdAt: string;
    updatedAt: string;
    status: SocialVideoParseStatus;
    state: SocialVideoParseAPIState;
};

export type SocialVideoParseLog = {
    at: string;
    apiId: string;
    apiName: string;
    platform: string;
    kind: "import" | "test" | "health";
    ok: boolean;
    stage?: string;
    latencyMs: number;
    message?: string;
};

export type SocialVideoParseSource = {
    id: string;
    name: string;
    url: string;
    enabled: boolean;
    intervalHours: number;
    autoEnable: boolean;
    lastSyncedAt?: string;
    lastError?: string;
    lastTotal: number;
    lastCreated: number;
    lastUpdated: number;
    createdAt: string;
    updatedAt: string;
};

export type SocialVideoParseSourceInput = Pick<SocialVideoParseSource, "name" | "url" | "enabled" | "intervalHours" | "autoEnable">;

export type SocialVideoParseOverview = {
    settings: SocialVideoParseSettings;
    apis: SocialVideoParseAPI[];
    sources: SocialVideoParseSource[];
    platforms: SocialVideoPlatform[];
    logs: SocialVideoParseLog[];
};

export type SocialVideoParseTestResult = {
    id?: string;
    name?: string;
    ok: boolean;
    stage?: string;
    message: string;
    platform: string;
    testUrl: string;
    latencyMs: number;
    httpStatus?: number;
    result?: { videoUrl: string; title: string; cover: string; id: string; durationMs: number; videoUrlPath: string };
    media?: { status: number; contentType: string; mimeType: string; bytes: number };
    responsePreview?: string;
};

export type SocialVideoParseBatchTestResult = { results: SocialVideoParseTestResult[]; skipped: string[] };

export type SocialVideoParseImportResult = { created: number; updated: number; enabled: number; errors: string[] };

export const SOCIAL_VIDEO_PARSE_EXPORT_FORMAT = "yingce.social-video-parse-apis";

export type SocialVideoParseExport = { format: typeof SOCIAL_VIDEO_PARSE_EXPORT_FORMAT; version: number; exportedAt: string; apis: SocialVideoParseAPIInput[] };

export function getSocialVideoParseOverview(signal?: AbortSignal) {
    return http.get<SocialVideoParseOverview>("/admin/social-video/parse", { signal });
}

export function updateSocialVideoParseSettings(settings: SocialVideoParseSettings) {
    return http.patch<{ settings: SocialVideoParseSettings }>("/admin/social-video/parse/settings", settings).then((data) => data.settings);
}

export function createSocialVideoParseAPI(input: SocialVideoParseAPIInput) {
    return http.post<{ api: SocialVideoParseAPI }>("/admin/social-video/parse-apis", input).then((data) => data.api);
}

export function updateSocialVideoParseAPI(id: string, input: SocialVideoParseAPIInput) {
    return http.patch<{ api: SocialVideoParseAPI }>(`/admin/social-video/parse-apis/${encodeURIComponent(id)}`, input).then((data) => data.api);
}

export function setSocialVideoParseAPIEnabled(id: string, enabled: boolean) {
    return http.put<{ api: SocialVideoParseAPI }>(`/admin/social-video/parse-apis/${encodeURIComponent(id)}/enabled`, { enabled }).then((data) => data.api);
}

export function duplicateSocialVideoParseAPI(id: string) {
    return http.post<{ api: SocialVideoParseAPI }>(`/admin/social-video/parse-apis/${encodeURIComponent(id)}/duplicate`).then((data) => data.api);
}

export function resetSocialVideoParseAPI(id: string) {
    return http.post<{ api: SocialVideoParseAPI }>(`/admin/social-video/parse-apis/${encodeURIComponent(id)}/reset`).then((data) => data.api);
}

export function deleteSocialVideoParseAPI(id: string) {
    return http.delete<{ ok: boolean }>(`/admin/social-video/parse-apis/${encodeURIComponent(id)}`);
}

export function testSocialVideoParseAPI(request: { id?: string; api?: SocialVideoParseAPIInput; url?: string; platform?: string }) {
    return http.post<SocialVideoParseTestResult>("/admin/social-video/parse-apis/test", request);
}

export function testSocialVideoParseAPIs(request: { platform?: string; ids?: string[] }) {
    return http.post<SocialVideoParseBatchTestResult>("/admin/social-video/parse-apis/test-all", request);
}

export function exportSocialVideoParseAPIs(ids?: string[]) {
    return http.post<SocialVideoParseExport>("/admin/social-video/parse-apis/export", { ids: ids || [] });
}

export function importSocialVideoParseAPIs(payload: { format?: string; version?: number; apis: SocialVideoParseAPIInput[]; autoEnable: boolean; skipExisting?: boolean }) {
    return http.post<SocialVideoParseImportResult>("/admin/social-video/parse-apis/import", payload);
}

export function createSocialVideoParseSource(input: SocialVideoParseSourceInput) {
    return http.post<{ source: SocialVideoParseSource }>("/admin/social-video/parse-sources", input).then((data) => data.source);
}

export function updateSocialVideoParseSource(id: string, input: SocialVideoParseSourceInput) {
    return http.patch<{ source: SocialVideoParseSource }>(`/admin/social-video/parse-sources/${encodeURIComponent(id)}`, input).then((data) => data.source);
}

export function deleteSocialVideoParseSource(id: string, removeApis: boolean) {
    return http.delete<{ ok: boolean }>(`/admin/social-video/parse-sources/${encodeURIComponent(id)}`, { params: removeApis ? { removeApis: "1" } : undefined });
}

export function syncSocialVideoParseSource(id: string) {
    return http.post<SocialVideoParseImportResult>(`/admin/social-video/parse-sources/${encodeURIComponent(id)}/sync`);
}

export const EMPTY_SOCIAL_VIDEO_PARSE_MAPPING: SocialVideoParseMapping = { successPath: "", successValues: "", videoUrlPath: "", titlePath: "", coverPath: "", idPath: "", durationPath: "", durationUnit: "s", messagePath: "" };

/** 一条新接口的默认值：GET、15 秒超时、自动识别视频地址。 */
export function emptySocialVideoParseAPIInput(platforms: string[] = []): SocialVideoParseAPIInput {
    return { name: "", platforms, enabled: true, priority: 10, weight: 10, method: "GET", url: "", bodyType: "none", body: "", headers: [], timeoutSeconds: 15, mapping: { ...EMPTY_SOCIAL_VIDEO_PARSE_MAPPING }, downloadHeaders: [], remark: "" };
}

/** 把一条已保存的接口转回可编辑的定义（不含密钥）。 */
export function socialVideoParseAPIInput(api: SocialVideoParseAPI): SocialVideoParseAPIInput {
    return {
        name: api.name,
        category: api.category || "",
        platforms: [...api.platforms],
        enabled: api.enabled,
        priority: api.priority,
        weight: api.weight,
        method: api.method,
        url: api.url,
        bodyType: api.bodyType,
        body: api.body,
        headers: api.headers.map((header) => ({ ...header })),
        timeoutSeconds: api.timeoutSeconds,
        mapping: { ...EMPTY_SOCIAL_VIDEO_PARSE_MAPPING, ...api.mapping },
        downloadHeaders: api.downloadHeaders.map((header) => ({ ...header })),
        remark: api.remark,
    };
}
