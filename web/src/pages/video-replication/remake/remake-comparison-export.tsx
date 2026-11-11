import { App, Button, Progress, Select } from "antd";
import { Columns2, Download } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { remakeComparison, type ComparisonAudio } from "@/lib/remake/comparison";
import type { RemakeJob } from "@/lib/remake/job";
import { getActiveUserScope } from "@/lib/user-scope";
import { resourceStorageKey } from "@/services/api/resources";
import { queryGenerationTask, waitForGenerationTask } from "@/services/api/task-center";
import { createTimelineRenderTask, type TimelineRenderResult } from "@/services/api/timeline-tasks";
import { downloadBrowserMedia } from "@/services/browser-download";
import { readRemake, updateRemake } from "../replace/use-product-video-store";

export function RemakeComparisonExport({ job, disabled }: { job: RemakeJob; disabled: boolean }) {
    const { message } = App.useApp();
    const scope = useRef(getActiveUserScope()).current;
    const submitting = useRef(false);
    const [creating, setCreating] = useState(false);
    const [audio, setAudio] = useState<ComparisonAudio>(job.comparisonRender?.audio || "render");
    const [progress, setProgress] = useState({ percent: 0, stage: "等待队列调度" });
    const request = useMemo(() => {
        try {
            const timeline = remakeComparison(job, audio);
            return { timeline, signature: JSON.stringify(timeline), error: "" };
        } catch (error) {
            return { signature: "", error: error instanceof Error ? error.message : "无法导出对比" };
        }
    }, [job, audio]);
    const saved = job.comparisonRender;
    const current = saved?.signature === request.signature ? saved : undefined;
    const pending = Boolean(saved?.taskId && !saved.resourceId && !saved.error);
    const busy = creating || pending;

    // 已提交任务先保存在作品中；刷新、离开再回来继续查询，不重复渲染。
    useEffect(() => {
        if (!saved?.taskId || saved.resourceId || saved.error) return;
        const controller = new AbortController();
        const taskId = saved.taskId;
        const signature = saved.signature;
        void waitForGenerationTask(taskId, { signal: controller.signal, timeoutMs: 62 * 60_000, onTaskUpdate: (task) => setProgress({ percent: task.progress || 0, stage: task.stage || "正在合成对比" }) })
            .then(async (task) => {
                const result = JSON.parse(task.resultJson || "{}") as TimelineRenderResult;
                if (!result.resourceId) throw new Error("任务完成但未返回对比视频，请到任务中心核对");
                if (getActiveUserScope() !== scope) return;
                await updateRemake(job.id, (latest) =>
                    latest.comparisonRender?.signature === signature && latest.comparisonRender.taskId === taskId
                        ? { ...latest, comparisonRender: { ...latest.comparisonRender, resourceId: result.resourceId, durationMs: result.durationMs, width: result.width, height: result.height, error: undefined } }
                        : latest,
                );
            })
            .catch(async (error) => {
                if (controller.signal.aborted || getActiveUserScope() !== scope) return;
                const detail = error instanceof Error ? error.message : "对比导出失败";
                try {
                    await updateRemake(job.id, (latest) => (latest.comparisonRender?.taskId === taskId ? { ...latest, comparisonRender: { ...latest.comparisonRender, error: detail } } : latest));
                } catch {
                    message.error(`导出状态未保存：${detail}`);
                }
            });
        return () => controller.abort();
    }, [job.id, saved?.taskId, saved?.resourceId, saved?.error, saved?.signature, scope, message]);

    const exportVideo = async () => {
        if (submitting.current || busy || !request.timeline || disabled) return;
        submitting.current = true;
        setCreating(true);
        try {
            if (current?.resourceId) {
                await downloadBrowserMedia({ fileName: `${job.title || "复刻"} · 原片对比.mp4`, storageKey: resourceStorageKey(current.resourceId) });
                return;
            }
            const latest = readRemake(job.id);
            let task = latest?.comparisonRender?.taskId ? await queryGenerationTask(latest.comparisonRender.taskId) : undefined;
            if (task && (task.status === "queued" || task.status === "running")) {
                await updateRemake(job.id, (value) => ({ ...value, comparisonRender: { ...value.comparisonRender!, error: undefined } }));
                return;
            }
            if (current?.taskId && task?.status === "succeeded") {
                const result = JSON.parse(task.resultJson || "{}") as TimelineRenderResult;
                if (!result.resourceId) throw new Error("任务没有返回对比视频");
                await updateRemake(job.id, (value) => ({ ...value, comparisonRender: { ...value.comparisonRender!, resourceId: result.resourceId, error: undefined } }));
                return;
            }
            task = await createTimelineRenderTask({ projectId: "", timeline: request.timeline });
            if (getActiveUserScope() !== scope) return;
            await updateRemake(job.id, (value) => ({ ...value, comparisonRender: { taskId: task.id, signature: request.signature, audio } }));
            setProgress({ percent: task.progress || 0, stage: task.stage || "等待队列调度" });
        } catch (error) {
            message.error(error instanceof Error ? error.message : "对比导出失败");
        } finally {
            submitting.current = false;
            setCreating(false);
        }
    };
    if (!job.source) return null;
    return (
        <section className="rw-comparison-export" aria-label="对比视频导出">
            <h3>
                <Columns2 size={16} aria-hidden /> 左右对比导出
            </h3>
            <p className="rw-hint">左侧原片 · 右侧复刻，同步跳过删除镜头，等比保留画面。</p>
            <label>
                对比视频声音
                <Select
                    aria-label="对比视频声音"
                    value={audio}
                    disabled={busy || disabled}
                    onChange={setAudio}
                    options={[
                        { value: "render", label: "复刻声音" },
                        { value: "reference", label: "原片声音" },
                        { value: "mute", label: "静音" },
                    ]}
                />
            </label>
            {busy ? (
                <div role="status">
                    <Progress percent={progress.percent} size="small" />
                    <p className="rw-hint">{progress.stage}，可离开页面，任务会继续。</p>
                </div>
            ) : null}
            {request.error || current?.error ? (
                <p className="rw-warn" role="alert">
                    {request.error || current?.error}
                </p>
            ) : null}
            <Button block icon={current?.resourceId ? <Download size={14} /> : <Columns2 size={14} />} loading={busy} disabled={disabled || Boolean(request.error)} onClick={() => void exportVideo()}>
                {current?.resourceId ? "下载对比视频" : current?.error ? "重试对比导出" : "导出左右对比 MP4"}
            </Button>
            {current?.resourceId ? (
                <p className="rw-hint" role="status">
                    对比视频已就绪 · {current.width} × {current.height}
                </p>
            ) : null}
        </section>
    );
}
