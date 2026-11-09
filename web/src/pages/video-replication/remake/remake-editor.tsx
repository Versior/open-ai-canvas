import { App, Button, Checkbox } from "antd";
import { Download, Redo2, Save, Undo2, Upload, Library } from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { EditorStoreProvider } from "@/components/editor/editor-context";
import { EditorTimelinePanel } from "@/lib/plugins/builtin/editor/editor-timeline-panel";
import { EditorPreviewMonitor } from "@/lib/plugins/builtin/editor/editor-preview-monitor";
import { EditorInspector } from "@/lib/plugins/builtin/editor/editor-inspector";
import { EditorSubtitleTools } from "@/lib/plugins/builtin/editor/editor-subtitle-tools";
import { remakeRenderSize } from "@/lib/remake/timeline";
import type { RemakeJob } from "@/lib/remake/job";
import { getActiveUserScope } from "@/lib/user-scope";
import { createEditorStore, type EditorStore } from "@/stores/editor/editor-store";
import type { StoreApi, UseBoundStore } from "zustand";
import { createTimelineRenderTask, type TimelineRenderResult } from "@/services/api/timeline-tasks";
import { queryGenerationTask, waitForGenerationTask } from "@/services/api/task-center";
import { getResource, resourceStorageKey, uploadResourceFile, type RemoteResource } from "@/services/api/resources";
import { probeMediaDurationMs } from "@/lib/media-metadata";
import type { PickedWorkbenchAsset } from "@/pages/workbench/workbench-asset-picker";
import { nanoid } from "nanoid";
import { drawRemakeSubtitle } from "./remake-subtitles";
import type { TimelineClip } from "@/types/timeline";
import { downloadBrowserMedia } from "@/services/browser-download";
import { readRemake, updateRemake } from "../replace/use-product-video-store";
import "@/lib/plugins/builtin/editor/editor-shell.css";
import { EditorLutTools } from "@/components/editor/editor-lut-tools";
import { timelineLutSignature } from "@/lib/timeline/timeline-lut";

type Store = UseBoundStore<StoreApi<EditorStore>>;
const AssetPicker = lazy(() => import("@/pages/workbench/workbench-asset-picker").then((module) => ({ default: module.WorkbenchAssetPicker })));
export function RemakeEditor({ job, onReady, onUploadingChange, initialPanel = "inspector" }: { job: RemakeJob; onReady: (store: Store | undefined) => void; onUploadingChange?: (busy: boolean) => void; initialPanel?: "inspector" | "lut" }) {
    const { message } = App.useApp();
    const [store] = useState(() => {
        const value = createEditorStore({
            saveTimeline: async (editTimeline) => {
                await updateRemake(job.id, (latest) => ({ ...latest, editTimeline }));
            },
        });
        value.getState().load(job.editTimeline!);
        return value;
    });
    const state = store();
    const lutChanged = Boolean(job.editRender?.resourceId && (job.editRender.lutSignature || "") !== timelineLutSignature(state.project?.colorLut));
    const [panel, setPanel] = useState<"inspector" | "subtitles" | "lut">(initialPanel);
    const [rendering, setRendering] = useState(false);
    const [renderError, setRenderError] = useState("");
    const [stage, setStage] = useState("");
    const [burnSubtitles, setBurnSubtitles] = useState(job.editBurnSubtitles ?? job.subtitles.burn);
    const [importing, setImporting] = useState(false);
    const [lutBusy, setLutBusy] = useState(false);
    const [picking, setPicking] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    useEffect(() => {
        onUploadingChange?.(importing || lutBusy);
    }, [importing, lutBusy, onUploadingChange]);
    const controller = useRef<AbortController | undefined>(undefined);
    const scope = useRef(getActiveUserScope()).current;
    const readyRef = useRef(onReady);
    readyRef.current = onReady;
    const save = async () => {
        await store.getState().flushSave();
        if (store.getState().saveError) throw new Error(store.getState().saveError!);
    };
    const addResource = (resource: RemoteResource, kind: "video" | "audio" | "image", title: string) => {
        if (getActiveUserScope() !== scope) throw new Error("账号已切换");
        if (kind !== "image" && !resource.durationMs) throw new Error(`“${title}”还没有可用时长，无法加入时间线，请确认格式与资源状态`);
        const current = store.getState();
        const track = current.project!.tracks.find((track) => track.kind === kind && !track.locked);
        if (!track) current.dispatch({ op: "addTrack", payload: { kind } });
        const target =
            track ||
            store
                .getState()
                .project!.tracks.filter((track) => track.kind === kind)
                .at(-1)!;
        const id = nanoid(12);
        current.dispatch({
            op: "addClip",
            payload: {
                clip: {
                    id,
                    nodeId: id,
                    trackId: target.id,
                    kind,
                    title,
                    startMs: kind === "audio" ? current.transportMs : current.project!.durationMs,
                    durationMs: kind === "image" ? 3000 : resource.durationMs!,
                    sourceDurationMs: resource.durationMs,
                    sourceStartMs: 0,
                    directMedia: { id: resource.id, kind, title, storageKey: resourceStorageKey(resource.id), durationMs: resource.durationMs, width: resource.width, height: resource.height },
                },
            },
        });
        if (store.getState().saveError) throw new Error(store.getState().saveError!);
    };
    const upload = async (files: File[]) => {
        setImporting(true);
        try {
            for (const file of files) {
                const kind = file.type.startsWith("video/") ? "video" : file.type.startsWith("audio/") ? "audio" : file.type.startsWith("image/") ? "image" : undefined;
                if (!kind) throw new Error(`“${file.name}”不是音视频或图片`);
                const durationMs = await probeMediaDurationMs(file);
                const resource = await uploadResourceFile(file, kind, { fileName: file.name, durationMs });
                addResource(resource, kind, file.name);
            }
            await save();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "素材导入失败");
        } finally {
            setImporting(false);
        }
    };
    const pick = async (assets: PickedWorkbenchAsset[]) => {
        setPicking(false);
        setImporting(true);
        try {
            for (const asset of assets) addResource(await getResource(asset.resourceId), asset.kind, asset.name);
            await save();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "素材导入失败");
        } finally {
            setImporting(false);
        }
    };
    const awaitRender = async (taskId: string, signal: AbortSignal) => {
        const task = await waitForGenerationTask(taskId, { signal, timeoutMs: 62 * 60_000, onTaskUpdate: (value) => setStage(value.stage || "正在导出") });
        const result = JSON.parse(task.resultJson || "{}") as TimelineRenderResult;
        if (!result.resourceId) throw new Error("导出完成但没有视频资源，请到任务中心核对");
        if (getActiveUserScope() !== scope) throw new Error("账号已切换");
        await updateRemake(job.id, (latest) => ({ ...latest, editRender: { ...latest.editRender, taskId, resourceId: result.resourceId, durationMs: result.durationMs } }));
    };
    useEffect(() => {
        readyRef.current(store);
        return () => {
            readyRef.current(undefined);
            controller.current?.abort();
            void store
                .getState()
                .flushSave()
                .then(() => {
                    if (store.getState().saveError) message.error(`剪辑未保存：${store.getState().saveError}`);
                });
        };
    }, [store, message]);
    // 页面刷新只查询已保存的导出任务，不重新创建渲染任务。
    useEffect(() => {
        if (job.editRender?.resourceId) {
            setRendering(false);
            setStage("导出完成");
            return;
        }
        if (!job.editRender?.taskId) return;
        const abort = new AbortController();
        controller.current = abort;
        setRendering(true);
        void awaitRender(job.editRender.taskId, abort.signal)
            .catch((error) => {
                if (!abort.signal.aborted) setRenderError(error instanceof Error ? error.message : "导出失败");
            })
            .finally(() => {
                if (!abort.signal.aborted) setRendering(false);
            });
        return () => abort.abort();
        // 已保存任务身份变化才恢复轮询，草稿编辑不重新启动。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [job.editRender?.taskId, job.editRender?.resourceId]);
    const render = async () => {
        if (rendering || lutBusy) return;
        setRendering(true);
        setRenderError("");
        const abort = new AbortController();
        controller.current = abort;
        try {
            await save();
            const latest = readRemake(job.id)!;
            if (latest.editRender?.taskId && !latest.editRender.resourceId) {
                const previous = await queryGenerationTask(latest.editRender.taskId);
                if (!["failed", "cancelled"].includes(previous.status)) {
                    await awaitRender(previous.id, abort.signal);
                    return;
                }
            }
            const size = remakeRenderSize(latest);
            const timeline = store.getState().project!;
            const overlays: TimelineClip[] = [];
            const hidden = new Set(timeline.tracks.filter((track) => track.visible === false).map((track) => track.id));
            if (burnSubtitles) {
                for (const clip of timeline.clips.filter((clip) => clip.kind === "subtitle" && clip.text?.trim() && !hidden.has(clip.trackId))) {
                    abort.signal.throwIfAborted();
                    setStage("正在绘制字幕…");
                    const png = await drawRemakeSubtitle(clip.text!, size);
                    const resource = await uploadResourceFile(new File([png], "剪辑字幕.png", { type: "image/png" }), "image", size, undefined, { signal: abort.signal });
                    overlays.push({
                        id: `burn-${clip.id}`,
                        nodeId: `burn-${clip.id}`,
                        kind: "image",
                        trackId: "edit-burn",
                        startMs: clip.startMs,
                        durationMs: clip.durationMs,
                        overlay: true,
                        directMedia: { id: resource.id, kind: "image", title: "字幕", storageKey: resourceStorageKey(resource.id) },
                    });
                }
            }
            if (getActiveUserScope() !== scope) throw new Error("账号已切换");
            await updateRemake(job.id, (value) => ({ ...value, editBurnSubtitles: burnSubtitles, editSubtitleImages: overlays.map((clip) => ({ resourceId: clip.directMedia!.id })) }));
            const renderTimeline = { ...timeline, ...size, fit: "pad", tracks: [...timeline.tracks, { id: "edit-burn", kind: "image" as const, label: "烧录字幕", order: timeline.tracks.length }], clips: [...timeline.clips, ...overlays] };
            const created = await createTimelineRenderTask({ projectId: "", timeline: renderTimeline }, abort.signal);
            await updateRemake(job.id, (value) => ({ ...value, editRender: { taskId: created.id, ...size, lutSignature: timelineLutSignature(timeline.colorLut) } }));
            // 保存任务后交给恢复 effect 查询同一个任务。
        } catch (error) {
            if (!abort.signal.aborted) setRenderError(error instanceof Error ? error.message : "导出失败");
            setRendering(false);
        }
    };
    const download = async () => {
        try {
            await downloadBrowserMedia({ fileName: `${job.title} · 剪辑版.mp4`, storageKey: resourceStorageKey(job.editRender!.resourceId!) });
        } catch (error) {
            message.error(error instanceof Error ? error.message : "下载失败");
        }
    };
    return (
        <EditorStoreProvider store={store} host={{ projectId: "", assets: [], refreshAssets: async () => [] }}>
            <section className="rw-editor editor-workbench" aria-label="复刻剪辑台">
                <header className="rw-editor-toolbar">
                    <strong>剪辑台</strong>
                    <span role="status">{state.saveError ? `未保存：${state.saveError}` : state.saving ? "保存中…" : state.isDirty ? "有未保存修改" : "已保存"}</span>
                    <Button size="small" aria-label="撤销剪辑" icon={<Undo2 size={14} />} onClick={state.undo} disabled={!state.history?.undoStack.length || state.inPreview} />
                    <Button size="small" aria-label="重做剪辑" icon={<Redo2 size={14} />} onClick={state.redo} disabled={!state.history?.redoStack.length || state.inPreview} />
                    <Button size="small" icon={<Save size={14} />} onClick={() => void save().catch((error) => message.error(error.message))}>
                        保存
                    </Button>
                    <Button size="small" loading={importing} icon={<Upload size={14} />} onClick={() => inputRef.current?.click()}>
                        上传素材
                    </Button>
                    <Button size="small" disabled={importing} icon={<Library size={14} />} onClick={() => setPicking(true)}>
                        素材库
                    </Button>
                    <Checkbox
                        checked={burnSubtitles}
                        disabled={rendering}
                        onChange={(event) => {
                            const next = event.target.checked;
                            setBurnSubtitles(next);
                            void updateRemake(job.id, (latest) => ({ ...latest, editBurnSubtitles: next })).catch((error) => {
                                setBurnSubtitles(!next);
                                message.error(error.message);
                            });
                        }}
                    >
                        烧录字幕
                    </Checkbox>
                    <Button size="small" loading={rendering} disabled={importing || lutBusy || state.inPreview || !state.project?.clips.some((clip) => clip.kind === "video" || clip.kind === "image")} onClick={() => void render()}>
                        导出剪辑成片
                    </Button>
                    {job.editRender?.resourceId ? (
                        <Button size="small" icon={<Download size={14} />} onClick={() => void download()}>
                            {lutChanged ? "下载上次剪辑版" : "下载剪辑版"}
                        </Button>
                    ) : null}
                    {lutChanged ? <span className="rw-hint">LUT 已更改，重新导出后更新成片</span> : null}
                    {renderError ? (
                        <span role="alert" className="rw-warn">
                            {renderError}
                        </span>
                    ) : rendering ? (
                        <span>{stage || "正在导出"}</span>
                    ) : null}
                </header>
                <div className="rw-editor-monitor">
                    <EditorPreviewMonitor />
                </div>
                <aside className="rw-editor-inspector">
                    <div className="rw-editor-tabs">
                        <Button size="small" aria-pressed={panel === "inspector"} onClick={() => setPanel("inspector")}>
                            片段属性
                        </Button>
                        <Button size="small" aria-pressed={panel === "subtitles"} onClick={() => setPanel("subtitles")}>
                            字幕
                        </Button>
                        <Button size="small" aria-pressed={panel === "lut"} onClick={() => setPanel("lut")}>
                            LUT 滤镜
                        </Button>
                    </div>
                    <div className="rw-editor-panel">{panel === "inspector" ? <EditorInspector /> : panel === "subtitles" ? <EditorSubtitleTools /> : <EditorLutTools disabled={rendering || state.inPreview} onBusyChange={setLutBusy} />}</div>
                </aside>
                <div className="rw-editor-timeline">
                    <EditorTimelinePanel />
                </div>
                <input
                    ref={inputRef}
                    type="file"
                    accept="video/*,audio/*,image/*"
                    multiple
                    hidden
                    onChange={(event) => {
                        void upload(Array.from(event.target.files || []));
                        event.target.value = "";
                    }}
                />
                {picking ? (
                    <Suspense fallback={null}>
                        <AssetPicker open accept={["video", "audio", "image"]} maxCount={8} onClose={() => setPicking(false)} onPick={(assets) => void pick(assets)} />
                    </Suspense>
                ) : null}
            </section>
        </EditorStoreProvider>
    );
}
