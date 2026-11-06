import { replicationDeliveryFiles } from "@/lib/canvas/video-replication-delivery";
import type { VideoReplicaPlan } from "@/lib/canvas/video-replica-plan";
import type { VideoTeardownAnalysis } from "@/lib/canvas/video-teardown";
import { getActiveUserScope } from "@/lib/user-scope";
import { createZip } from "@/lib/zip";
import { getResourceBlob, resourceStorageKey } from "@/services/api/resources";
import type { VideoTeardownBundle } from "@/services/api/video-replication";

export async function exportReplicationDelivery(bundle: VideoTeardownBundle, analysis: VideoTeardownAnalysis, plan: VideoReplicaPlan) {
    const scope = getActiveUserScope();
    const files: { name: string; data: BlobPart }[] = replicationDeliveryFiles(bundle, analysis, plan);
    for (const shot of bundle.shots) {
        if (scope !== getActiveUserScope()) throw new DOMException("账号已切换，导出已停止", "AbortError");
        const blob = await getResourceBlob(resourceStorageKey(shot.keyframeResourceId));
        if (!blob) throw new Error(`镜头 ${shot.index} 的关键帧读取失败，未导出不完整的交付包`);
        const ext = blob.type.includes("jpeg") ? "jpg" : blob.type.includes("webp") ? "webp" : "png";
        files.push({ name: `关键帧/镜头${String(shot.index).padStart(3, "0")}.${ext}`, data: blob });
    }
    if (scope !== getActiveUserScope()) throw new DOMException("账号已切换，导出已停止", "AbortError");
    const zip = await createZip(files);
    if (scope !== getActiveUserScope()) throw new DOMException("账号已切换，导出已停止", "AbortError");
    return zip;
}
