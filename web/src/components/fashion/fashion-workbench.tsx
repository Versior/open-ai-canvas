import { App, Button, Input, Select } from "antd";
import { Download, History, ImagePlus, Shirt, Video, X, Users, Layers, Move, ScanFace, Sparkles, UserRound, Scissors, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppModal } from "@/components/ui/product/app-modal";
import { ModelPicker } from "@/components/model-picker";
import {
    FASHION_TOOLS,
    FASHION_SLOT_LABEL,
    emptyFashionDraft,
    fashionDraftProblem,
    fashionVideoPrompt,
    planFashion,
    newFashionVersion,
    type FashionDraft,
    type FashionImage,
    type FashionSlot,
    type FashionUnit,
    type FashionWork,
} from "@/lib/fashion/workflow";
import { modelCapabilityConfigFor, videoDurationOptions } from "@/lib/model-capabilities";
import { getActiveUserScope } from "@/lib/user-scope";
import { uploadStudioPhoto } from "@/pages/ecommerce-studio/studio-upload";
import { listFashionWorks, saveFashionWork } from "@/services/api/fashion";
import { deleteProductVideo } from "@/services/api/product-video";
import { resourceFileUrl } from "@/services/api/resources";
import { downloadBrowserMedia } from "@/services/browser-download";
import { fashionImageConfig, fashionVideoConfig, generateFashion, newFashionId } from "@/services/fashion-generation";
import { isGenerationTaskTerminalError } from "@/services/api/task-center";
import { selectableModelsByCapability, useEffectiveConfig } from "@/stores/use-config-store";
import "./fashion.css";

const TOOL_ICONS = { tryon: Shirt, "multi-model": Users, "multi-garment": Layers, pose: Move, face: ScanFace, "smart-face": Sparkles, head: UserRound, print: Scissors };

export function FashionWorkbench({ onClose, initialTool, onUse }: { onClose: () => void; initialTool?: FashionDraft["tool"]; onUse?: (image: FashionImage) => void }) {
    const { message, modal } = App.useApp();
    const config = useEffectiveConfig();
    const [draft, setDraft] = useState<FashionDraft>(() => ({ ...emptyFashionDraft(), ...(initialTool ? { tool: initialTool } : {}) }));
    const [model, setModel] = useState(config.imageModel || "");
    const [videoModel, setVideoModel] = useState(config.videoModel || "");
    const [seconds, setSeconds] = useState(5);
    const [motion, setMotion] = useState("");
    const [work, setWork] = useState<FashionWork>();
    const [history, setHistory] = useState<FashionWork[]>([]);
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [view, setView] = useState<"new" | "history">("new");
    const scope = getActiveUserScope();
    const controller = useRef<AbortController | undefined>(undefined);
    const alive = useRef(true);
    const tools = FASHION_TOOLS.find((item) => item.id === draft.tool)!;
    const profile = modelCapabilityConfigFor(config, videoModel).video;
    const durations = profile ? videoDurationOptions(profile) : [];
    useEffect(() => {
        const images = selectableModelsByCapability(config, "image");
        if (!model && images[0]) setModel(images[0]);
    }, [config, model]);
    useEffect(() => {
        if (durations.length && !durations.includes(seconds)) setSeconds(durations[0]);
    }, [durations.join(","), seconds]);
    useEffect(() => {
        alive.current = true;
        setWork(undefined);
        setHistory([]);
        setDraft({ ...emptyFashionDraft(), ...(initialTool ? { tool: initialTool } : {}) });
        setError("");
        setBusy(false);
        setUploading(false);
        const abort = new AbortController();
        void listFashionWorks(abort.signal)
            .then((items) => {
                if (!abort.signal.aborted) setHistory(items);
            })
            .catch((e: unknown) => {
                if (!abort.signal.aborted) setError(e instanceof Error ? e.message : "历史作品读取失败");
            });
        return () => {
            alive.current = false;
            abort.abort();
            controller.current?.abort();
        };
    }, [scope]);
    const problem = useMemo(() => fashionDraftProblem(draft), [draft]);
    const checkScope = () => {
        if (getActiveUserScope() !== scope || !alive.current) throw new Error("会话已切换，任务保留在任务中心");
    };
    const save = async (next: FashionWork) => {
        checkScope();
        const saved = await saveFashionWork(next);
        checkScope();
        setWork(saved);
        setHistory((items) => [saved, ...items.filter((item) => item.id !== saved.id)]);
        return saved;
    };
    const upload = async (slot: FashionSlot, files: FileList | null) => {
        if (!files || uploading) return;
        const selected = Array.from(files);
        if (draft[slot].length + selected.length > 6 || selected.some((file) => !file.type.startsWith("image/") || file.size > 20 * 1024 * 1024)) {
            setError("每类最多 6 张图片，每张不超过 20MB");
            return;
        }
        setUploading(true);
        setError("");
        const uploaded: FashionImage[] = [];
        try {
            for (const file of selected) {
                const image = await uploadStudioPhoto(file, 0);
                checkScope();
                uploaded.push({ resourceId: image.resourceId, name: file.name, width: image.width, height: image.height });
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : "上传失败");
        } finally {
            if (getActiveUserScope() === scope && alive.current) {
                setDraft((value) => ({ ...value, [slot]: [...value[slot], ...uploaded] }));
                setUploading(false);
            }
        }
    };
    const process = async (initial: FashionWork) => {
        let current = initial;
        controller.current = new AbortController();
        for (const original of current.units) {
            if (original.status === "succeeded" || original.status === "failed") continue;
            checkScope();
            const generation = original.taskId ? config : fashionImageConfig(config, current.model, original.references.length);
            const patch = async (change: Partial<FashionUnit>) => {
                current = await save({ ...current, units: current.units.map((unit) => (unit.id === original.id ? { ...unit, ...change } : unit)) });
            };
            await patch({ status: original.taskId ? "running" : "submitting" });
            try {
                const image = await generateFashion(
                    original,
                    generation,
                    "image",
                    async (task) => {
                        await patch({ taskId: task.id, status: "running" });
                    },
                    controller.current.signal,
                );
                await patch({ resourceId: image.resourceId, status: "succeeded", error: undefined });
            } catch (e) {
                if (controller.current.signal.aborted) throw e;
                // 保留 taskId 和幂等键；监听超时或提交结果未确认时只能恢复，不自动重提新任务。
                const terminal = isGenerationTaskTerminalError(e) && e.task.billing?.status !== "uncertain" && e.task.providerCancelStatus !== "requested" && e.task.providerCancelStatus !== "uncertain";
                await patch({ ...(terminal ? { status: "failed" } : {}), error: e instanceof Error ? e.message : "生成失败" });
                if (!terminal) throw e;
            }
        }
    };
    const run = async (resume?: FashionWork) => {
        if (busy) return;
        setBusy(true);
        setError("");
        try {
            let next = resume;
            if (!next) {
                const units = planFashion(draft, newFashionId);
                units.forEach((unit) => fashionImageConfig(config, model, unit.references.length));
                next = await save({ kind: "fashion", id: `fashion_${newFashionId()}`, revision: 0, title: tools.title, createdAt: new Date().toISOString(), model, draft, units });
            }
            await process(next);
        } catch (e) {
            if (alive.current && getActiveUserScope() === scope) setError(e instanceof Error ? e.message : "生成失败");
        } finally {
            if (alive.current && getActiveUserScope() === scope) setBusy(false);
        }
    };
    const regenerate = async (unit: FashionUnit) => {
        if (!work || busy) return;
        setBusy(true);
        setError("");
        try {
            fashionImageConfig(config, work.model, unit.references.length);
            const next = await save(newFashionVersion(work, unit, newFashionId));
            await process(next);
        } catch (e) {
            if (alive.current && getActiveUserScope() === scope) setError(e instanceof Error ? e.message : "新版本生成失败");
        } finally {
            if (alive.current && getActiveUserScope() === scope) setBusy(false);
        }
    };
    const makeVideo = async (unit: FashionUnit) => {
        if (!work || busy || !unit.resourceId) return;
        setBusy(true);
        setError("");
        controller.current = new AbortController();
        let current = work;
        const patch = async (video: NonNullable<FashionUnit["video"]>) => {
            current = await save({ ...current, units: current.units.map((item) => (item.id === unit.id ? { ...item, video } : item)) });
        };
        try {
            const video = unit.video || { model: videoModel, seconds, prompt: fashionVideoPrompt(motion, work.draft.tool === "print"), status: "pending" as const };
            const generation = video.taskId ? config : fashionVideoConfig(config, video.model, video.seconds);
            await patch(video);
            const result = await generateFashion(
                { ...unit, video },
                generation,
                "video",
                async (task) => {
                    await patch({ ...video, taskId: task.id, status: "running", error: undefined });
                },
                controller.current.signal,
            );
            await patch({ ...current.units.find((item) => item.id === unit.id)!.video!, resourceId: result.resourceId, status: "succeeded", error: undefined });
        } catch (e) {
            const video = current.units.find((item) => item.id === unit.id)?.video;
            if (video && !controller.current.signal.aborted) {
                const terminal = isGenerationTaskTerminalError(e) && e.task.billing?.status !== "uncertain" && e.task.providerCancelStatus !== "requested" && e.task.providerCancelStatus !== "uncertain";
                try {
                    await patch({ ...video, ...(terminal ? { status: "failed" } : {}), error: e instanceof Error ? e.message : "视频生成失败" });
                } catch (saveError) {
                    if (alive.current && getActiveUserScope() === scope) setError(saveError instanceof Error ? saveError.message : "视频状态保存失败，请从任务中心检查原任务");
                    return;
                }
            }
            if (alive.current && getActiveUserScope() === scope) setError(e instanceof Error ? e.message : "视频生成失败");
        } finally {
            if (alive.current && getActiveUserScope() === scope) setBusy(false);
        }
    };
    const download = (resourceId: string, title: string, video = false) =>
        void downloadBrowserMedia({ fileName: `${title}.${video ? "mp4" : "png"}`, url: resourceFileUrl(resourceId) }).catch((e: unknown) => message.error(e instanceof Error ? e.message : "下载失败"));
    const remove = (item: FashionWork) => {
        modal.confirm({
            title: "删除这份模特作品记录？",
            content: "此操作释放作品数量，已生成的素材和原任务保留在素材库与任务中心。",
            okText: "删除记录",
            cancelText: "保留",
            onOk: async () => {
                try {
                    checkScope();
                    await deleteProductVideo(item.id);
                    checkScope();
                    setHistory((items) => items.filter((entry) => entry.id !== item.id));
                    if (work?.id === item.id) setWork(undefined);
                } catch (error) {
                    message.error(error instanceof Error ? error.message : "删除作品记录失败");
                    throw error;
                }
            },
        });
    };
    return (
        <AppModal open centered closable={false} onCancel={onClose} footer={null} width={1120} flush title={null} rootClassName="fashion-modal">
            <div className="fashion-workbench">
                <header className="fashion-head">
                    <div>
                        <small>FASHION & IDENTITY STUDIO</small>
                        <h2>模特与服饰工作台</h2>
                        <p>先确认图片，再生成展示视频。素材、分组与任务进度保存到账号。</p>
                    </div>
                    <Button icon={<History size={15} />} onClick={() => setView(view === "new" ? "history" : "new")} disabled={busy}>
                        {view === "new" ? "历史作品" : "返回创作"}
                    </Button>
                    <Button type="text" aria-label="关闭模特工作台" icon={<X size={18} />} onClick={onClose} />
                </header>
                {error ? (
                    <div role="alert" className="fashion-error">
                        {error}
                        <Button
                            size="small"
                            onClick={() => {
                                setError("");
                                void listFashionWorks()
                                    .then((items) => {
                                        checkScope();
                                        setHistory(items);
                                    })
                                    .catch((e: unknown) => {
                                        if (alive.current && getActiveUserScope() === scope) setError(e instanceof Error ? e.message : "读取失败");
                                    });
                            }}
                        >
                            重新读取历史
                        </Button>
                    </div>
                ) : null}
                {view === "history" ? (
                    <div className="fashion-history">
                        {history.length ? (
                            history.map((item) => (
                                <div key={item.id} className="fashion-history-row">
                                    <button
                                        type="button"
                                        key={item.id}
                                        onClick={() => {
                                            setWork(item);
                                            setDraft(item.draft);
                                            setModel(item.model);
                                            setView("new");
                                        }}
                                    >
                                        <Shirt aria-hidden />
                                        <strong>{item.title}</strong>
                                        <span>
                                            {item.units.filter((unit) => unit.resourceId).length} / {item.units.length} 张 · {new Date(item.createdAt).toLocaleString()}
                                        </span>
                                    </button>
                                    <Button type="text" icon={<Trash2 size={15} />} aria-label={`删除作品记录：${item.title}`} disabled={busy} onClick={() => remove(item)} />
                                </div>
                            ))
                        ) : (
                            <p>暂无保存的模特作品</p>
                        )}
                    </div>
                ) : (
                    <>
                        <div className="fashion-tool-grid" role="group" aria-label="模特处理方式">
                            {FASHION_TOOLS.map((tool) => {
                                const Icon = TOOL_ICONS[tool.id];
                                return (
                                    <button
                                        key={tool.id}
                                        type="button"
                                        aria-pressed={draft.tool === tool.id}
                                        disabled={busy || uploading}
                                        onClick={() => {
                                            setDraft((value) => ({ ...value, tool: tool.id }));
                                            setWork(undefined);
                                        }}
                                    >
                                        <Icon aria-hidden />
                                        <strong>{tool.title}</strong>
                                        <span>{tool.text}</span>
                                    </button>
                                );
                            })}
                        </div>
                        <div className="fashion-columns">
                            <section className="fashion-inputs">
                                {tools.needs.map((slot) => (
                                    <div className="fashion-slot" key={slot}>
                                        <label>
                                            <span>{FASHION_SLOT_LABEL[slot]}</span>
                                            <span className="fashion-upload-action">
                                                <ImagePlus size={16} aria-hidden />
                                                {uploading ? "正在上传…" : "点击添加图片 · 可多选"}
                                            </span>
                                            <input
                                                className="fashion-file-input"
                                                type="file"
                                                multiple
                                                accept="image/*"
                                                aria-label={FASHION_SLOT_LABEL[slot]}
                                                disabled={busy || uploading}
                                                onChange={(e) => {
                                                    void upload(slot, e.target.files);
                                                    e.target.value = "";
                                                }}
                                            />
                                        </label>
                                        <div className="fashion-refs">
                                            {draft[slot].map((image, index) => (
                                                <div key={`${image.resourceId}-${index}`}>
                                                    <img src={resourceFileUrl(image.resourceId)} alt={image.name} />
                                                    <span>{image.name}</span>
                                                    <button type="button" aria-label={`移除${image.name}`} disabled={busy} onClick={() => setDraft((value) => ({ ...value, [slot]: value[slot].filter((_, i) => i !== index) }))}>
                                                        <X size={12} />
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                                <Input.TextArea
                                    aria-label="服饰处理补充要求"
                                    placeholder="保留要求、面料细节、构图与背景…"
                                    maxLength={600}
                                    value={draft.note}
                                    disabled={busy || uploading}
                                    onChange={(e) => setDraft((value) => ({ ...value, note: e.target.value }))}
                                    autoSize={{ minRows: 2, maxRows: 5 }}
                                />
                                <ModelPicker
                                    config={config}
                                    value={model}
                                    onChange={setModel}
                                    capability="image"
                                    fullWidth
                                    requirements={{ capability: "image", input: { textCount: 1, imageCount: tools.needs.length, referenceImageCount: tools.needs.length, videoCount: 0, audioCount: 0, characterCount: 0 } }}
                                />
                                <p className="fashion-hint">{problem || `本次生成 ${draft.tool === "multi-model" ? draft.models.length : draft.tool === "multi-garment" ? draft.garments.length : 1} 张图片，每张按所选模型计费。`}</p>
                                <Button type="primary" icon={<ImagePlus size={16} />} loading={busy && !work?.units.some((unit) => unit.video)} disabled={busy || uploading || Boolean(problem) || !model} onClick={() => void run()}>
                                    保存方案并生成图片
                                </Button>
                                <p className="fashion-hint">图片编辑由所选模型执行。请复核身份、衣物和印花细节；印花输出为白底图，不能作为原始矢量文件或未核验的生产稿。</p>
                            </section>
                            <section className="fashion-results" aria-label="模特处理结果">
                                {work ? (
                                    <>
                                        <div className="fashion-result-head">
                                            <strong>
                                                {work.title} · {work.units.filter((unit) => unit.resourceId).length}/{work.units.length}
                                            </strong>
                                            {work.units.some((unit) => unit.status !== "succeeded" && unit.status !== "failed") ? (
                                                <Button disabled={busy} onClick={() => void run(work)}>
                                                    恢复原任务
                                                </Button>
                                            ) : null}
                                        </div>
                                        <div className="fashion-result-grid">
                                            {work.units.map((unit) => (
                                                <article key={unit.id}>
                                                    {unit.resourceId ? (
                                                        <img src={resourceFileUrl(unit.resourceId)} alt={unit.title} />
                                                    ) : (
                                                        <div className="fashion-result-empty">
                                                            <Shirt />
                                                            <span>{unit.status === "pending" ? "等待提交" : unit.taskId ? "任务已提交，可恢复进度" : "提交结果尚未确认"}</span>
                                                        </div>
                                                    )}
                                                    <strong>{unit.title}</strong>
                                                    {unit.error ? <p role="alert">{unit.error}</p> : null}
                                                    {unit.status === "failed" ? <p>原图片任务已结束，可按原方案生成新版本。</p> : null}
                                                    {unit.status === "succeeded" || unit.status === "failed" ? (
                                                        <Button size="small" disabled={busy} onClick={() => void regenerate(unit)}>
                                                            生成新版本 · 另计费
                                                        </Button>
                                                    ) : null}
                                                    {unit.resourceId ? (
                                                        <div className="fashion-result-actions">
                                                            <Button size="small" icon={<Download size={13} />} onClick={() => download(unit.resourceId!, unit.title)}>
                                                                下载
                                                            </Button>
                                                            {onUse ? (
                                                                <Button size="small" onClick={() => onUse({ resourceId: unit.resourceId!, name: unit.title })}>
                                                                    用作生图素材
                                                                </Button>
                                                            ) : null}
                                                            {!unit.video?.resourceId && unit.video?.status !== "failed" ? (
                                                                <Button size="small" disabled={busy || (!unit.video && !videoModel)} icon={<Video size={13} />} onClick={() => void makeVideo(unit)}>
                                                                    {unit.video ? "恢复视频任务" : "生成展示视频"}
                                                                </Button>
                                                            ) : null}
                                                        </div>
                                                    ) : null}
                                                    {unit.video?.error ? (
                                                        <p role="alert">
                                                            {unit.video.error}
                                                            {unit.video.status === "failed" ? "。原视频任务已结束，可生成图片新版本后重新拍摄。" : "。请恢复原视频任务确认状态。"}
                                                        </p>
                                                    ) : null}
                                                    {unit.video?.resourceId ? (
                                                        <>
                                                            <video controls src={resourceFileUrl(unit.video.resourceId)} />
                                                            <Button size="small" onClick={() => download(unit.video!.resourceId!, unit.title, true)}>
                                                                下载视频
                                                            </Button>
                                                        </>
                                                    ) : null}
                                                    <details>
                                                        <summary>查看处理要求与任务</summary>
                                                        <p>{unit.prompt}</p>
                                                        <p>{unit.taskId || "未取得任务 ID"}</p>
                                                    </details>
                                                </article>
                                            ))}
                                        </div>
                                    </>
                                ) : (
                                    <div className="fashion-empty">
                                        <Shirt />
                                        <h3>{draft.tool === "print" ? "从清晰原图中提取已有印花" : "给目标与处理素材各一张清晰参考"}</h3>
                                        <p>{draft.tool === "print" ? "提取成品可下载、用于生图素材，也可以生成图案展示视频。" : "按上方素材类型上传参考。批量操作拆成独立任务，便于逐张核对。"}</p>
                                    </div>
                                )}
                                {work ? (
                                    <div className="fashion-video-controls">
                                        <h3>{work.draft.tool === "print" ? "把印花拍成图案展示视频" : "把选定图片拍成展示视频"}</h3>
                                        <ModelPicker
                                            config={config}
                                            value={videoModel}
                                            onChange={setVideoModel}
                                            capability="video"
                                            fullWidth
                                            requirements={{ capability: "video", input: { textCount: 1, imageCount: 1, referenceImageCount: 1, videoCount: 0, audioCount: 0, characterCount: 0 } }}
                                        />
                                        <Select aria-label="展示视频时长" value={seconds} options={durations.map((value) => ({ value, label: `${value} 秒` }))} onChange={setSeconds} disabled={busy} />
                                        <Input aria-label="服装展示动作" maxLength={300} placeholder="例如：轻微转身，保持印花可见" value={motion} disabled={busy} onChange={(e) => setMotion(e.target.value)} />
                                        <p>点击每张成品的「生成展示视频」提交，视频另外计费。{work.draft.tool === "print" ? "以提取的平面图案展示细节，提交时保留图案和文字约束。" : "这里是图生视频，不会对已有整段视频执行精确换脸。"}</p>
                                    </div>
                                ) : null}
                            </section>
                        </div>
                    </>
                )}
            </div>
        </AppModal>
    );
}
