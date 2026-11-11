import { http } from "./request";
import type { VideoTrendBoard } from "./video-trends";

export type SiteTrendSource = "douhot" | "qianchuan" | "oceanengine";
export type AdminVideoTrendSource = {
    source: SiteTrendSource;
    enabled: boolean;
    configured: boolean;
    oauthAvailable: boolean;
    authorized: boolean;
    cookieConfigured: boolean;
    advertiserId?: string;
    projectId?: string;
    advertiserIds?: string[];
    expiresAt?: string;
    board?: VideoTrendBoard;
    lastError?: string;
};
export type AdminVideoTrendInput = { enabled: boolean; advertiserId?: string; projectId?: string; accessToken?: string; cookie?: string };
const route = (source: SiteTrendSource) => `/admin/video-replication/trends/${source}`;
export const getAdminVideoTrendSources = (signal?: AbortSignal) => http.get<AdminVideoTrendSource[]>("/admin/video-replication/trends", { signal });
export const connectAdminVideoTrends = (source: SiteTrendSource, input: AdminVideoTrendInput, signal?: AbortSignal) => http.put<VideoTrendBoard>(`${route(source)}/connection`, input, { signal });
export const authorizeAdminVideoTrends = (source: Exclude<SiteTrendSource, "douhot">, signal?: AbortSignal) => http.post<{ url: string }>(`${route(source)}/oauth`, {}, { signal });
export const refreshAdminVideoTrends = (source: SiteTrendSource, signal?: AbortSignal) => http.post<VideoTrendBoard>(`${route(source)}/refresh`, {}, { signal });
export const setAdminVideoTrendVisibility = (source: SiteTrendSource, enabled: boolean, signal?: AbortSignal) => http.patch<AdminVideoTrendSource>(route(source), { enabled }, { signal });
export const disconnectAdminVideoTrends = (source: SiteTrendSource, signal?: AbortSignal) => http.delete(`${route(source)}/connection`, { signal });
