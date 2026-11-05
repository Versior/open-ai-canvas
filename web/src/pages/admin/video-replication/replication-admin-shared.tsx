import { ImageOff } from "lucide-react";
import { useState } from "react";
import type { AdminStatusTone } from "@/pages/admin/components/admin-ui";
import { cn } from "@/lib/utils";
import { adminResourceFileUrl } from "@/services/api/admin-storage";
import type { TaskStatus } from "@/services/api/task-center";

export const TEARDOWN_STATUS_META: Record<TaskStatus, { label: string; tone: AdminStatusTone }> = {
    queued: { label: "排队中", tone: "neutral" },
    running: { label: "拆解中", tone: "info" },
    succeeded: { label: "已完成", tone: "success" },
    failed: { label: "失败", tone: "error" },
    cancelled: { label: "已取消", tone: "neutral" },
};

export const TEARDOWN_STATUS_FILTERS: { value: "all" | TaskStatus; label: string }[] = [
    { value: "all", label: "全部状态" },
    { value: "succeeded", label: "已完成" },
    { value: "failed", label: "失败" },
    { value: "running", label: "拆解中" },
    { value: "queued", label: "排队中" },
    { value: "cancelled", label: "已取消" },
];

export const TRANSCRIPT_LABELS: Record<"asr" | "none", string> = { asr: "语音转写", none: "画面字幕" };

/** 分析记下的模型可能带系统渠道前缀（CHANNEL_000005::deepseek-v4），列表只显示模型名，完整值放在悬停提示里。 */
export function modelLabel(model?: string) {
    if (!model) return "";
    const separator = model.lastIndexOf("::");
    return separator >= 0 ? model.slice(separator + 2) : model;
}

/** 占比的整数百分数；分母为 0 时返回 null，页面显示「—」而不是 0%。 */
export function percentOf(part: number, total: number) {
    return total > 0 ? Math.round((part / total) * 100) : null;
}

/** 后台看用户的关键帧、宫格和原视频都走管理员资源接口，不借用户的访问授权。 */
export function AdminResourceThumb({ id, className, label }: { id?: string; className?: string; label: string }) {
    const [failed, setFailed] = useState(false);
    if (!id || failed) {
        return (
            <span className={cn("admin-vr-thumb is-empty", className)} role="img" aria-label={`${label}（无法显示）`}>
                <ImageOff aria-hidden="true" />
            </span>
        );
    }
    return <img className={cn("admin-vr-thumb", className)} src={adminResourceFileUrl(id)} alt={label} loading="lazy" decoding="async" onError={() => setFailed(true)} />;
}
