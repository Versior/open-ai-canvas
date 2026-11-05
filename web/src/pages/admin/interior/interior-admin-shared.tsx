import { ImageOff } from "lucide-react";
import { useState } from "react";
import type { AdminStatusTone } from "@/pages/admin/components/admin-ui";
import { cn } from "@/lib/utils";
import { adminResourceFileUrl } from "@/services/api/admin-storage";
import type { AdminInteriorGeneration } from "@/services/api/interior";

const STATUS_META: Record<AdminInteriorGeneration["status"], { label: string; tone: AdminStatusTone }> = {
    queued: { label: "排队中", tone: "neutral" },
    running: { label: "生成中", tone: "info" },
    succeeded: { label: "已完成", tone: "success" },
    failed: { label: "失败", tone: "error" },
    cancelled: { label: "已取消", tone: "neutral" },
};

/** 出图任务状态的文字和颜色；没见过的状态原样显示，不让整行渲染失败。 */
export function interiorStatusMeta(status: string, progress?: number) {
    const meta = STATUS_META[status as AdminInteriorGeneration["status"]] ?? { label: status || "未知", tone: "neutral" as const };
    return status === "running" && typeof progress === "number" && progress > 0 ? { ...meta, label: `${meta.label} ${progress}%` } : meta;
}

export function interiorInProgress(status: string) {
    return status === "queued" || status === "running";
}

export const INTERIOR_STATUS_FILTERS = [
    { value: "all", label: "全部状态" },
    { value: "succeeded", label: "已完成" },
    { value: "failed", label: "失败" },
    { value: "running", label: "生成中" },
    { value: "queued", label: "排队中" },
    { value: "cancelled", label: "已取消" },
];

export const INTERIOR_SURFACE_LABELS: Record<string, string> = { quick: "快速出图", pro: "专业模式" };

/** 模型可能带系统渠道前缀（CHANNEL_000005::gpt-image-2），列表只显示模型名。 */
export function interiorModelLabel(model?: string) {
    if (!model) return "";
    const separator = model.lastIndexOf("::");
    return separator >= 0 ? model.slice(separator + 2) : model;
}

export function interiorPercent(part: number, total: number) {
    return total > 0 ? Math.round((part / total) * 100) : null;
}

export function formatInteriorTime(value?: string) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/** 后台看用户的原图和效果图走管理员资源接口；图片在框里按原比例完整显示。 */
export function InteriorAdminThumb({ id, label, className }: { id?: string; label: string; className?: string }) {
    const [failed, setFailed] = useState(false);
    if (!id || failed) {
        return (
            <span className={cn("itd-admin-thumb is-empty", className)} role="img" aria-label={`${label}（无法显示）`}>
                <ImageOff aria-hidden="true" />
            </span>
        );
    }
    return <img className={cn("itd-admin-thumb", className)} src={adminResourceFileUrl(id)} alt={label} loading="lazy" decoding="async" onError={() => setFailed(true)} />;
}
