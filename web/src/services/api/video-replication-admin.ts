import { compactApiParams, http } from "@/services/api/request";
import type { GenerationTask } from "@/services/api/task-center";
import type { VideoReplicationRecord } from "@/services/api/video-replication";

/** 后台「视频复刻」：使用统计、所有用户的拆解记录和视频复刻设置。接口说明见 docs/content/docs/backend/http-api.mdx。 */

export type VideoReplicationSettings = { maxDurationSeconds: number; maxShots: number; transcribeEnabled: boolean };

/** 拆解时能不能识别口播：后台允许、字幕转写已开放、服务器配置了转写服务，三样都有才可用。 */
export type VideoReplicationTranscription = { enabled: boolean; featureEnabled: boolean; serviceConfigured: boolean; available: boolean; note?: string };

export type VideoReplicationTaskStats = { total: number; queued: number; running: number; succeeded: number; failed: number; cancelled: number; users: number; last7Days: number; today: number };

export type VideoReplicationPlatformStat = { platform: string; name: string; total: number; succeeded: number; failed: number };

/** 一个 UTC 自然日里新建的拆解和链接导入任务数，failed 是其中已失败的。 */
export type VideoReplicationDay = { date: string; teardowns: number; imports: number; failed: number };

export type AdminUserReference = { id: string; username?: string; displayName?: string };

export type VideoReplicationFailure = { id: string; kind: "teardown" | "import"; platform?: string; user: AdminUserReference; error: string; createdAt: string };

export type AdminVideoReplicationOverview = {
    settings: VideoReplicationSettings;
    transcription: VideoReplicationTranscription;
    teardowns: VideoReplicationTaskStats;
    imports: VideoReplicationTaskStats;
    analyzed: number;
    importPlatforms: VideoReplicationPlatformStat[];
    daily: VideoReplicationDay[];
    recentFailures: VideoReplicationFailure[];
};

export type AdminVideoReplicationRecord = VideoReplicationRecord & {
    user: AdminUserReference;
    projectId?: string;
    /** 口播来源：asr 为语音转写，none 为没有转写；任务没完成时省略。 */
    transcript?: "asr" | "none";
    warnings?: string[];
    completedAt?: string;
};

export type AdminVideoReplicationPage = { records: AdminVideoReplicationRecord[]; total: number; page: number; pageSize: number };

export type AdminVideoReplicationQuery = { status?: string; keyword?: string; page?: number; pageSize?: number };

/** 一条记录的全部内容：拆解任务（resultJson 是镜头事实）、保存过的分析原文和记录的主人。 */
export type AdminVideoReplicationDetail = { task: GenerationTask; analysis?: unknown; analyzedAt?: string; user: AdminUserReference };

export function getAdminVideoReplicationOverview(signal?: AbortSignal) {
    return http.get<AdminVideoReplicationOverview>("/admin/video-replication/overview", { signal });
}

export function listAdminVideoReplications(query: AdminVideoReplicationQuery, signal?: AbortSignal) {
    return http.get<AdminVideoReplicationPage>("/admin/video-replication/teardowns", { params: compactApiParams({ ...query, status: query.status === "all" ? undefined : query.status }), signal });
}

export function getAdminVideoReplication(id: string, signal?: AbortSignal) {
    return http.get<AdminVideoReplicationDetail>(`/admin/video-replication/teardowns/${encodeURIComponent(id)}`, { signal });
}

/** 设置页单独读取的内容：当前设置和口播识别状态；保存设置也返回同一份。 */
export type AdminVideoReplicationSettingsView = { settings: VideoReplicationSettings; transcription: VideoReplicationTranscription };

export function getAdminVideoReplicationSettings(signal?: AbortSignal) {
    return http.get<AdminVideoReplicationSettingsView>("/admin/video-replication/settings", { signal });
}

export function updateVideoReplicationSettings(settings: Partial<VideoReplicationSettings>) {
    return http.patch<AdminVideoReplicationSettingsView>("/admin/video-replication/settings", settings);
}

/** 后台用户名展示：有昵称时「昵称（用户名）」，用户已删除时显示 ID。 */
export function adminUserLabel(user: AdminUserReference) {
    if (!user.username) return user.id ? `已删除的用户 ${user.id.slice(0, 8)}` : "未知用户";
    return user.displayName && user.displayName !== user.username ? `${user.displayName}（${user.username}）` : user.username;
}
