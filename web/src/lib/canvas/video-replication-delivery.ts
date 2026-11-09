import { deliveryCsv, deliverySrt } from "@/lib/delivery-text";
import type { VideoTeardownBundle } from "@/services/api/video-replication";
import { REPLICA_TREATMENTS, type VideoReplicaPlan } from "./video-replica-plan";
import { videoTeardownReportMarkdown, videoTeardownStoryboardRows, type VideoTeardownAnalysis } from "./video-teardown";

/** 原片事实与方案时间码一起交付；跳过镜头后只压缩方案时间，保留原片时间以便剪辑回查。 */
export function replicationDeliveryFiles(bundle: VideoTeardownBundle, analysis: VideoTeardownAnalysis, plan: VideoReplicaPlan) {
    let cursor = 0;
    const planned = new Map(plan.shots.map((shot) => [shot.shotNumber, shot]));
    const rows = new Map(analysis.rows.map((row) => [row.shotNumber, row]));
    const shots = bundle.shots.map((shot) => {
        const item = planned.get(shot.index);
        if (!item) throw new Error(`方案缺少镜头 ${shot.index}，请重新打开方案`);
        const durationMs = shot.endMs - shot.startMs;
        const startMs = item.treatment === "skip" ? null : cursor;
        if (startMs !== null) cursor += durationMs;
        return {
            shotNumber: shot.index,
            sourceStartMs: shot.startMs,
            sourceEndMs: shot.endMs,
            startMs,
            endMs: startMs === null ? null : cursor,
            durationMs,
            treatment: item.treatment,
            dialogue: item.dialogue,
            onScreenText: item.onScreenText,
            imagePrompt: item.imagePrompt,
            videoPrompt: item.videoPrompt,
            director: item.director,
            keyframeResourceId: shot.keyframeResourceId,
            plot: rows.get(shot.index)?.plotDescription || "",
        };
    });
    const subtitles = shots.flatMap((shot) => (shot.startMs === null || shot.endMs === null ? [] : [{ text: shot.dialogue, startMs: shot.startMs, endMs: shot.endMs }]));
    const warnings = shots.filter((shot) => shot.treatment !== "skip" && shot.dialogue.replace(/\s/g, "").length > (shot.durationMs / 1000) * 5).map((shot) => `镜头 ${shot.shotNumber} 口播可能超过镜头时长，请调整台词或配音语速`);
    if (plan.shots.some((shot) => shot.treatment === "original") && !plan.authorized) warnings.push("沿用原片画面尚未确认授权，请在生成前确认");
    return [
        { name: "拆解报告.md", data: videoTeardownReportMarkdown(bundle, analysis, videoTeardownStoryboardRows(bundle, analysis.rows)) },
        {
            name: "逐镜计划.csv",
            data: deliveryCsv([
                ["镜头", "原片起点ms", "原片终点ms", "方案起点ms", "方案终点ms", "做法", "口播", "画面文字", "首帧提示词", "视频提示词"],
                ...shots.map((shot) => [
                    shot.shotNumber,
                    shot.sourceStartMs,
                    shot.sourceEndMs,
                    shot.startMs,
                    shot.endMs,
                    REPLICA_TREATMENTS.find((item) => item.value === shot.treatment)?.label,
                    shot.dialogue,
                    shot.onScreenText,
                    shot.imagePrompt,
                    shot.videoPrompt,
                ]),
            ]),
        },
        { name: "方案口播.srt", data: deliverySrt(subtitles) },
        {
            name: "分镜.json",
            data: JSON.stringify(
                {
                    version: 1,
                    title: analysis.title,
                    source: bundle.source,
                    plannedDurationMs: cursor,
                    authorized: plan.authorized,
                    product: plan.product,
                    campaign: plan.campaign,
                    strategy: plan.scripts.find((script) => script.id === plan.activeScriptId)?.strategy,
                    shots,
                    warnings,
                },
                null,
                2,
            ),
        },
        {
            name: "交付说明.md",
            data: `# ${analysis.title} · 剪辑交付\n\n本包是当前复刻方案快照，包含原片关键帧、拆解报告、逐镜计划和口播字幕。方案口播.srt 使用删镜后的连续时间轴；原片时间码在 CSV/JSON 中保留。字幕时长沿用镜头时长，实际配音与成片需重新校准。成片与剪映草稿请在复刻工作台导出。\n\n${warnings.map((warning) => `- ${warning}`).join("\n") || "没有检测到口播时长问题。"}\n\n授权仅记录方案勾选状态；商品外观、人物与声音使用权限仍需人工确认。`,
        },
    ];
}
