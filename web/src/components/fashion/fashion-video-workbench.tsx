import { App, Button, Checkbox, Input, InputNumber, Select } from "antd";
import { Download, History, ImagePlus, Video, X, Shirt, Users, Layers, ScanFace, UserRound, Move, Play, Scissors } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { FashionWorkbenchShell } from "./fashion-workbench-shell";
import { ModelPicker } from "@/components/model-picker";
import { GenerationCostNotice, TaskSettlement } from "@/components/generation-cost-notice";
import {
    FASHION_VIDEO_TOOLS,
    emptyFashionVideoDraft,
    fashionVideoProblem,
    fashionVideoRanges,
    fashionVideoRenderMatches,
    fashionVideoTimeline,
    fashionVideoTool,
    planFashionVideos,
    type FashionVideoDraft,
    type FashionVideoTool,
    type FashionVideoUnit,
    type FashionVideoWork,
} from "@/lib/fashion/video-workflow";
import type { FashionImage } from "@/lib/fashion/workflow";
import { modelCapabilityConfigFor, videoDurationOptions } from "@/lib/model-capabilities";
import { productVideoDefaultRatio } from "@/lib/product-video/media";
import { captureVideoPoster } from "@/lib/video-poster";
import { getActiveUserScope } from "@/lib/user-scope";
import { uploadStudioPhoto } from "@/pages/ecommerce-studio/studio-upload";
import { listFashionVideoWorks, saveFashionVideoWork } from "@/services/api/fashion-video";
import { resourceFileUrl, uploadResourceFile } from "@/services/api/resources";
import { queryGenerationTask } from "@/services/api/task-center";
import { downloadBrowserMedia } from "@/services/browser-download";
import { newFashionId } from "@/services/fashion-generation";
import { fashionVideoGenerationConfig, fashionVideoRequirements, fashionVideoSegmentLimit, runFashionVideoWork } from "@/services/fashion-video-generation";
import { useEffectiveConfig } from "@/stores/use-config-store";
import "./fashion.css";
import "./fashion-video.css";

const ICONS = { tryon: Shirt, "multi-garment": Layers, "multi-model": Users, face: ScanFace, head: UserRound, motion: Move, print: Scissors, showcase: Play };
const STATUSES = { pending: "待提交", submitting: "确认提交中", running: "视频生成中", rendering: "处理声音与交付", succeeded: "已交付", failed: "原任务已结束" };

export function FashionVideoWorkbench({ initialTool = "tryon", onClose, inline, onBusyChange }: { initialTool?: FashionVideoTool; onClose: () => void; inline?: boolean; onBusyChange?: (busy: boolean) => void }) {
    const { message } = App.useApp();
    const config = useEffectiveConfig();
    const [draft, setDraft] = useState<FashionVideoDraft>(() => ({ ...emptyFashionVideoDraft(), tool: initialTool }));
    const [model, setModel] = useState(config.videoModel);
    const [ratio, setRatio] = useState("");
    const [resolution, setResolution] = useState("");
    const [work, setWork] = useState<FashionVideoWork>();
    const [history, setHistory] = useState<FashionVideoWork[]>([]);
    const [view, setView] = useState<"new" | "history">("new");
    const [busy, setBusy] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState("");
    const [renderId, setRenderId] = useState("");
    useEffect(() => {
        onBusyChange?.(busy || uploading);
    }, [busy, uploading, onBusyChange]);
    useEffect(() => {
        setDraft((value) => ({ ...value, tool: initialTool, ...(initialTool === "showcase" && value.audio === "original" ? { audio: "mute" } : {}) }));
        setWork(undefined);
        setView("new");
    }, [initialTool]);
    const scope = useRef(getActiveUserScope()).current;
    const alive = useRef(true);
    const controller = useRef<AbortController | undefined>(undefined);
    const tool = fashionVideoTool(draft.tool);
    const profile = model ? modelCapabilityConfigFor(config, model).video : undefined;
    const locked = busy || uploading;
    const check = () => {
        if (!alive.current || getActiveUserScope() !== scope) throw new Error("会话已切换，任务与结果保留在原账号");
    };
    useEffect(() => {
        alive.current = true;
        const signal = new AbortController();
        void listFashionVideoWorks(signal.signal)
            .then((items) => {
                if (alive.current && getActiveUserScope() === scope) setHistory(items);
            })
            .catch((e) => {
                if (!signal.signal.aborted) setError(e instanceof Error ? e.message : "读取视频作品失败");
            });
        return () => {
            alive.current = false;
            signal.abort();
            controller.current?.abort();
        };
    }, [scope]);
    useEffect(() => {
        if (!profile || locked || work) return;
        const durations = videoDurationOptions(profile).filter((seconds) => seconds >= 4 && seconds <= 30 && (!tool.source || !profile.references.maxVideoDurationSeconds || seconds <= profile.references.maxVideoDurationSeconds));
        if (!tool.source && !durations.includes(draft.seconds) && durations.length) setDraft((value) => ({ ...value, seconds: durations[0] }));
        if (!profile.ratios.includes(ratio)) setRatio(productVideoDefaultRatio(profile.ratios, draft.source?.width || draft.models[0]?.width || 1080, draft.source?.height || draft.models[0]?.height || 1920, profile.defaultRatio));
        if (!profile.resolutions.includes(resolution)) setResolution(profile.defaultResolution || profile.resolutions[0] || "");
    }, [profile, draft.seconds, draft.source, draft.models, ratio, resolution, locked, tool.source, work]);
    const imageCount = draft.tool === "multi-model" ? 2 : 1;
    const referenceCount = imageCount + Number(tool.source && draft.tool !== "motion");
    const requirements = useMemo(() => {
        try {
            return fashionVideoRequirements({ draft }, referenceCount, profile);
        } catch {
            return fashionVideoRequirements({ draft }, referenceCount);
        }
    }, [draft, referenceCount, profile]);
    const settings = { model, ratio, resolution, draft };
    let problem = fashionVideoProblem(draft);
    try {
        fashionVideoGenerationConfig(config, settings, referenceCount);
    } catch (e) {
        problem ||= e instanceof Error ? e.message : "模型不能执行此操作";
    }
    const count = draft.tool === "multi-model" || draft.tool === "showcase" ? draft.models.length : draft.tool === "multi-garment" ? draft.garments.length : 1;
    let parts = 1;
    try {
        if (profile && tool.source) parts = fashionVideoRanges(draft, fashionVideoSegmentLimit(profile)).length;
    } catch (e) {
        problem ||= e instanceof Error ? e.message : "无法规划切段";
    }
    const save = async (next: FashionVideoWork) => {
        check();
        const saved = await saveFashionVideoWork(next);
        check();
        setWork(saved);
        setHistory((items) => [saved, ...items.filter((item) => item.id !== saved.id)]);
        return saved;
    };
    const uploadImage = async (slot: "models" | "garments" | "faces", files: FileList | null) => {
        if (!files || locked) return;
        const selected = Array.from(files);
        if (selected.length + draft[slot].length > 6 || selected.some((file) => !file.type.startsWith("image/") || file.size > 20 * 1024 * 1024)) {
            setError("每类最多6张图片，每张最多20MB");
            return;
        }
        setUploading(true);
        setError("");
        const images: FashionImage[] = [];
        try {
            for (const file of selected) {
                const image = await uploadStudioPhoto(file, 0);
                check();
                images.push({ resourceId: image.resourceId, name: file.name, width: image.width, height: image.height });
            }
        } catch (e) {
            if (alive.current) setError(e instanceof Error ? e.message : "图片上传失败");
        } finally {
            if (alive.current && getActiveUserScope() === scope) {
                setDraft((value) => ({ ...value, [slot]: [...value[slot], ...images] }));
                setWork(undefined);
                setUploading(false);
            }
        }
    };
    const uploadVideo = async (file?: File) => {
        if (!file || locked) return;
        if (!file.type.startsWith("video/") || file.size > 200 * 1024 * 1024) {
            setError("请上传不超过200MB的MP4或MOV视频");
            return;
        }
        setUploading(true);
        setError("");
        const url = URL.createObjectURL(file);
        try {
            const meta = await captureVideoPoster(url);
            if (!meta.durationMs || meta.durationMs < 4000) throw new Error("无法读取有效视频时长，或视频不足4秒");
            const resource = await uploadResourceFile(file, "video", { fileName: file.name, durationMs: meta.durationMs, width: meta.width, height: meta.height }, undefined, { expectedScope: scope });
            check();
            setDraft((value) => ({
                ...value,
                source: { resourceId: resource.id, name: file.name, width: resource.width || meta.width, height: resource.height || meta.height, durationMs: resource.durationMs || meta.durationMs!, hasAudio: meta.hasAudio },
                startMs: 0,
                seconds: Math.min(120000, resource.durationMs || meta.durationMs!) / 1000,
            }));
            setRatio(productVideoDefaultRatio(profile?.ratios || [], resource.width || meta.width, resource.height || meta.height, profile?.defaultRatio));
            setWork(undefined);
        } catch (e) {
            if (alive.current) setError(e instanceof Error ? e.message : "视频上传失败");
        } finally {
            URL.revokeObjectURL(url);
            if (alive.current) setUploading(false);
        }
    };
    const run = async (existing?: FashionVideoWork) => {
        if (locked) return;
        setBusy(true);
        setError("");
        controller.current = new AbortController();
        try {
            let next = existing;
            if (!next) {
                const units = planFashionVideos(draft, newFashionId);
                units.forEach((unit) => fashionVideoGenerationConfig(config, settings, unit.references.length + Number(tool.source && draft.tool !== "motion")));
                next = await save({
                    kind: "fashion-video",
                    id: `fashion_video_${newFashionId()}`,
                    revision: 0,
                    title: `${tool.title} · ${draft.source?.name || draft.models[0]?.name || "新作品"}`.slice(0, 120),
                    createdAt: new Date().toISOString(),
                    model,
                    ratio,
                    resolution,
                    draft,
                    units,
                });
            } else if (next.revision === 0) next = await save(next);
            await runFashionVideoWork(next, config, save, controller.current.signal, scope);
        } catch (e) {
            if (alive.current && getActiveUserScope() === scope) setError(e instanceof Error ? e.message : "视频处理失败");
        } finally {
            if (alive.current && getActiveUserScope() === scope) setBusy(false);
        }
    };
    const newVersion = async (unit: FashionVideoUnit) => {
        if (!work || locked) return;
        try {
            fashionVideoGenerationConfig(config, work, unit.references.length + Number(fashionVideoTool(work.draft.tool).source && work.draft.tool !== "motion"));
            const id = newFashionId();
            const parts =
                unit.status === "failed"
                    ? unit.parts?.map((part, index) =>
                          part.status === "succeeded"
                              ? part
                              : { id: `${id}_part_${index + 1}`, title: part.title, prompt: part.prompt, references: part.references, status: "pending" as const, startMs: part.startMs, endMs: part.endMs, clipResourceId: part.clipResourceId },
                      )
                    : undefined;
            const next: FashionVideoWork = {
                ...work,
                id: `fashion_video_${newFashionId()}`,
                revision: 0,
                createdAt: new Date().toISOString(),
                title: `${work.title.slice(0, 108)} · 新版本`,
                units: [{ id, title: unit.title, prompt: unit.prompt, references: unit.references, status: "pending", ...(parts ? { parts } : {}) }],
            };
            await run(next);
        } catch (e) {
            setError(e instanceof Error ? e.message : "创建新版本失败");
        }
    };
    const associateRender = async (unit: FashionVideoUnit) => {
        if (!work || locked || !renderId.trim()) return;
        setBusy(true);
        try {
            const task = await queryGenerationTask(renderId.trim());
            check();
            const input = JSON.parse(task.inputJson || "{}");
            const part = work.units.flatMap((item) => item.parts || []).find((item) => item.id === unit.id);
            const renderWork = part ? { ...work, draft: { ...work.draft, startMs: part.startMs, seconds: (part.endMs - part.startMs) / 1000 }, clip: { key: `clip_${part.id}`, resourceId: part.clipResourceId, hasAudio: work.clip?.hasAudio } } : work;
            if (task.type !== "timeline_render" || !fashionVideoRenderMatches(input.timeline, fashionVideoTimeline(renderWork, unit))) throw new Error("此任务的片段、时长、比例或声音与当前视频不一致，不能关联");
            const patch = (item: FashionVideoUnit) => ({ ...item, render: { started: true as const, taskId: task.id }, error: undefined });
            await save({ ...work, units: work.units.map((item) => (item.id === unit.id ? patch(item) : { ...item, ...(item.parts ? { parts: item.parts.map((part) => (part.id === unit.id ? { ...part, ...patch(part) } : part)) } : {}) })) });
            setRenderId("");
        } catch (e) {
            if (alive.current && getActiveUserScope() === scope) setError(e instanceof Error ? e.message : "关联任务失败");
        } finally {
            if (alive.current && getActiveUserScope() === scope) setBusy(false);
        }
    };
    const patchDraft = (patch: Partial<FashionVideoDraft>) => {
        setDraft((value) => ({ ...value, ...patch }));
        setWork(undefined);
    };
    return (
        <FashionWorkbenchShell inline={inline} width={1180} onClose={onClose}>
            <div className="fashion-workbench fashion-video-workbench">
                <header className="fashion-head">
                    {!inline ? <h2>服装与人物 · 视频</h2> : null}
                    {view === "new" ? (
                        <div className="fashion-tool-grid" role="group" aria-label="视频处理方式">
                            {FASHION_VIDEO_TOOLS.map((item) => {
                                const Icon = ICONS[item.id];
                                return (
                                    <button
                                        key={item.id}
                                        type="button"
                                        title={item.text}
                                        aria-pressed={draft.tool === item.id}
                                        disabled={locked}
                                        onClick={() => patchDraft({ tool: item.id, ...(item.id === "showcase" && draft.audio === "original" ? { audio: "mute" } : {}) })}
                                    >
                                        <Icon aria-hidden />
                                        <strong>{item.title}</strong>
                                    </button>
                                );
                            })}
                        </div>
                    ) : (
                        <div>
                            <h2>视频作品</h2>
                        </div>
                    )}
                    <Button type="text" size="small" icon={<History size={15} />} disabled={locked} onClick={() => setView(view === "new" ? "history" : "new")}>
                        {view === "new" ? "视频作品" : "返回创作"}
                    </Button>
                    {!inline ? <Button type="text" aria-label="关闭视频工作台" icon={<X size={18} />} onClick={onClose} /> : null}
                </header>
                {view === "new" ? (
                    <p className="fashion-tool-hint" role="status">
                        {tool.text}
                    </p>
                ) : null}
                {error ? (
                    <p role="alert" className="fashion-error">
                        {error}
                    </p>
                ) : null}
                {view === "history" ? (
                    <div className="fashion-history">
                        {history.length ? (
                            history.map((item) => (
                                <button
                                    className="fv-history-item"
                                    key={item.id}
                                    onClick={() => {
                                        setWork(item);
                                        setDraft(item.draft);
                                        setModel(item.model);
                                        setRatio(item.ratio);
                                        setResolution(item.resolution);
                                        setView("new");
                                    }}
                                >
                                    <Video />
                                    <strong>{item.title}</strong>
                                    <span>
                                        {item.units.filter((unit) => unit.render?.resourceId).length}/{item.units.length} 段 · {new Date(item.createdAt).toLocaleString()}
                                    </span>
                                </button>
                            ))
                        ) : (
                            <p>暂无视频作品</p>
                        )}
                    </div>
                ) : (
                    <>
                        <div className="fashion-columns">
                            <section className="fashion-inputs">
                                {tool.source ? (
                                    <div className="fashion-slot">
                                        <label>
                                            <strong>{draft.tool === "motion" ? "动作参考视频" : "待修改原视频"}</strong>
                                            <span className="fashion-upload-action">
                                                <Video size={16} />
                                                {uploading ? "正在上传" : "添加视频 · MP4 / MOV"}
                                            </span>
                                            <input
                                                type="file"
                                                accept="video/mp4,video/quicktime"
                                                className="fashion-file-input"
                                                aria-label="上传原视频"
                                                disabled={locked}
                                                onChange={(e) => {
                                                    void uploadVideo(e.target.files?.[0]);
                                                    e.target.value = "";
                                                }}
                                            />
                                        </label>
                                        {draft.source ? (
                                            <>
                                                <video className="fv-source" controls preload="metadata" src={`${resourceFileUrl(draft.source.resourceId)}#t=${draft.startMs / 1000},${draft.startMs / 1000 + draft.seconds}`} />
                                                <p>
                                                    {draft.source.name} · {(draft.source.durationMs / 1000).toFixed(1)}秒{` · ${draft.source.width} × ${draft.source.height}`}
                                                </p>
                                                <label>
                                                    片段起点（秒）
                                                    <InputNumber
                                                        aria-label="原视频片段起点"
                                                        min={0}
                                                        max={Math.max(0, (draft.startMs + Math.round(draft.seconds * 1000)) / 1000 - 4)}
                                                        step={0.001}
                                                        precision={3}
                                                        value={draft.startMs / 1000}
                                                        disabled={locked}
                                                        onChange={(value) => {
                                                            const startMs = Math.round((value || 0) * 1000);
                                                            const endMs = Math.round(draft.startMs + draft.seconds * 1000);
                                                            patchDraft({ startMs, seconds: (endMs - startMs) / 1000 });
                                                        }}
                                                    />
                                                </label>
                                                <label>
                                                    片段终点（秒）
                                                    <InputNumber
                                                        aria-label="原视频片段终点"
                                                        min={draft.startMs / 1000 + 4}
                                                        max={Math.min(draft.source.durationMs, draft.startMs + 120000) / 1000}
                                                        step={0.001}
                                                        precision={3}
                                                        value={(draft.startMs + Math.round(draft.seconds * 1000)) / 1000}
                                                        disabled={locked}
                                                        onChange={(value) => {
                                                            if (value !== null) patchDraft({ seconds: (Math.round(value * 1000) - draft.startMs) / 1000 });
                                                        }}
                                                    />
                                                </label>
                                                <Button disabled={locked || draft.source.durationMs > 120000} onClick={() => patchDraft({ startMs: 0, seconds: draft.source!.durationMs / 1000 })}>
                                                    处理整段原片
                                                </Button>
                                                <p className="fv-hint">
                                                    选中 {draft.seconds.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")} 秒 · 每个版本分 {parts} 段生成，按原视频比例合成。
                                                </p>
                                            </>
                                        ) : (
                                            <p>先选原视频，再设置要处理的片段。上传完整视频，模型只收到选定片段。</p>
                                        )}
                                    </div>
                                ) : null}
                                {tool.needs.map((slot) => (
                                    <div className="fashion-slot" key={slot}>
                                        <label>
                                            <strong>{slot === "models" ? "目标人物 / 角色图" : slot === "faces" ? "面部 / 头部身份参考" : draft.tool === "print" ? "平面印花参考" : "指定服装参考"}</strong>
                                            <span className="fashion-upload-action">
                                                <ImagePlus size={16} />
                                                添加参考图片
                                            </span>
                                            <input
                                                className="fashion-file-input"
                                                type="file"
                                                multiple
                                                accept="image/*"
                                                disabled={locked}
                                                aria-label={slot === "models" ? "上传人物参考图" : slot === "faces" ? "上传身份参考图" : draft.tool === "print" ? "上传印花参考图" : "上传服装参考图"}
                                                onChange={(e) => {
                                                    void uploadImage(slot, e.target.files);
                                                    e.target.value = "";
                                                }}
                                            />
                                        </label>
                                        <div className="fashion-refs">
                                            {draft[slot].map((image) => (
                                                <div key={image.resourceId}>
                                                    <img src={resourceFileUrl(image.resourceId)} alt={image.name} />
                                                    <span>{image.name}</span>
                                                    <button disabled={locked} aria-label={`移除${image.name}`} onClick={() => patchDraft({ [slot]: draft[slot].filter((item) => item !== image) })}>
                                                        <X size={13} />
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                                <ModelPicker
                                    config={config}
                                    capability="video"
                                    value={model}
                                    onChange={(value) => {
                                        setModel(value);
                                        setWork(undefined);
                                    }}
                                    requirements={requirements}
                                    fullWidth
                                    placeholder="选择支持当前素材的视频模型"
                                    modelDisabledReason={() => (locked ? "正在处理作品" : "")}
                                />
                                <div className="fv-settings">
                                    <label>
                                        {tool.source ? "选段时长" : "片段时长"}
                                        {tool.source ? (
                                            draft.source ? (
                                                <InputNumber
                                                    aria-label="选段时长（秒）"
                                                    min={4}
                                                    max={Math.min(120, (draft.source.durationMs - draft.startMs) / 1000)}
                                                    step={0.001}
                                                    precision={3}
                                                    value={draft.seconds}
                                                    disabled={locked}
                                                    onChange={(seconds) => {
                                                        if (seconds !== null) patchDraft({ seconds });
                                                    }}
                                                />
                                            ) : (
                                                <span className="fv-hint">上传后可选 4–120 秒，默认整段</span>
                                            )
                                        ) : (
                                            <Select
                                                aria-label="视频片段时长"
                                                disabled={locked}
                                                value={draft.seconds}
                                                onChange={(seconds) => patchDraft({ seconds })}
                                                options={(profile ? videoDurationOptions(profile) : [5]).filter((seconds) => seconds >= 4 && seconds <= 30).map((value) => ({ value, label: `${value} 秒` }))}
                                            />
                                        )}
                                    </label>
                                    <label>
                                        {tool.source ? "模型生成画幅" : "画幅"}
                                        <Select
                                            aria-label="视频画幅"
                                            disabled={locked}
                                            value={ratio}
                                            onChange={(value) => {
                                                setRatio(value);
                                                setWork(undefined);
                                            }}
                                            options={(profile?.ratios || []).map((value) => ({ value, label: value }))}
                                        />
                                    </label>
                                    <label>
                                        清晰度
                                        <Select
                                            aria-label="视频清晰度"
                                            disabled={locked}
                                            value={resolution}
                                            onChange={(value) => {
                                                setResolution(value);
                                                setWork(undefined);
                                            }}
                                            options={(profile?.resolutions || []).map((value) => ({ value, label: value }))}
                                        />
                                    </label>
                                    <label>
                                        声音
                                        <Select
                                            aria-label="视频声音"
                                            disabled={locked}
                                            value={draft.audio}
                                            onChange={(audio) => patchDraft({ audio })}
                                            options={[
                                                { value: "mute", label: "成片静音" },
                                                { value: "model", label: "模型生成声音" },
                                                { value: "original", label: "保留原片声音", disabled: !tool.source || draft.source?.hasAudio === false },
                                            ]}
                                        />
                                    </label>
                                </div>
                                {["tryon", "multi-model", "multi-garment", "print"].includes(draft.tool) ? (
                                    <label>
                                        衣物处理区域
                                        <Select
                                            aria-label="服装区域"
                                            disabled={locked}
                                            value={draft.region}
                                            onChange={(region) => patchDraft({ region })}
                                            options={[
                                                { value: "upper", label: "上身" },
                                                { value: "lower", label: "下身" },
                                                { value: "dress", label: "连衣裙" },
                                            ]}
                                        />
                                    </label>
                                ) : null}
                                {draft.tool === "showcase" ? (
                                    <Input.TextArea aria-label="展示动作" maxLength={300} disabled={locked} value={draft.motion} onChange={(e) => patchDraft({ motion: e.target.value })} placeholder="一镜内可完成的动作与机位" />
                                ) : null}
                                <Input.TextArea aria-label="视频补充要求" maxLength={600} disabled={locked} value={draft.note} onChange={(e) => patchDraft({ note: e.target.value })} placeholder="例如：保持图案大小与位置，遮挡后不换脸" />
                                <Checkbox disabled={locked} checked={draft.authorized} onChange={(e) => patchDraft({ authorized: e.target.checked })}>
                                    确认这些视频、服装和人物形象可用于本次创作
                                </Checkbox>
                                <p className="fv-hint">{problem || `将生成${count}个版本，共${count * parts}个片段。各版本共用原片布光参考，按原时长和原比例交付。`}</p>
                                <GenerationCostNotice config={config} model={model} capability="video" requirements={requirements} count={Math.max(1, count * parts)} label="视频生成" />
                                <Button type="primary" block disabled={locked || Boolean(problem)} onClick={() => void run()} icon={<Video size={16} />}>
                                    生成{count > 1 ? ` ${count} 段` : ""}视频
                                </Button>
                                <p className="fv-hint">生成后检查遮挡、图案文字和人物一致性。</p>
                            </section>
                            <section className="fashion-output">
                                {work ? (
                                    <>
                                        <div className="fashion-result-head">
                                            <h3>{work.title}</h3>
                                            {busy ? (
                                                <Button onClick={() => controller.current?.abort()}>停止等待</Button>
                                            ) : work.units.some((unit) => !["succeeded", "failed"].includes(unit.status)) ? (
                                                <Button onClick={() => void run(work)}>恢复原任务</Button>
                                            ) : null}
                                        </div>
                                        <TaskSettlement ids={work.units.flatMap((unit) => [unit.taskId || "", unit.render?.taskId || "", ...(unit.parts || []).flatMap((part) => [part.taskId || "", part.render?.taskId || ""])])} />
                                        <div className="fv-results">
                                            {work.units.map((unit) => (
                                                <article key={unit.id}>
                                                    <header>
                                                        <strong>{unit.title}</strong>
                                                        <span>{STATUSES[unit.status]}</span>
                                                    </header>
                                                    {unit.render?.resourceId || unit.resourceId ? (
                                                        <video controls preload="metadata" src={resourceFileUrl(unit.render?.resourceId || unit.resourceId!)} />
                                                    ) : (
                                                        <div className="fv-pending">
                                                            <Video />
                                                            <span>{STATUSES[unit.status]}</span>
                                                        </div>
                                                    )}
                                                    {unit.resourceId && !unit.render?.resourceId ? <p role="status">这是模型原始视频，声音与交付尚未完成。</p> : null}
                                                    {unit.error ? <p role="alert">{unit.error}</p> : null}
                                                    {unit.parts ? (
                                                        <details open={!unit.render?.resourceId}>
                                                            <summary>
                                                                片段进度 · {unit.parts.filter((part) => part.status === "succeeded").length}/{unit.parts.length}
                                                            </summary>
                                                            {unit.parts.map((part) => (
                                                                <div key={part.id}>
                                                                    <p>
                                                                        {(part.startMs / 1000).toFixed(3)}–{(part.endMs / 1000).toFixed(3)} 秒 · {STATUSES[part.status]}
                                                                    </p>
                                                                    {part.error ? <p role="alert">{part.error}</p> : null}
                                                                    {part.render?.started && !part.render.taskId ? (
                                                                        <div className="fv-render-link">
                                                                            <Input aria-label={`片段${part.id}原渲染任务ID`} value={renderId} onChange={(e) => setRenderId(e.target.value)} placeholder="从任务中心复制原渲染任务ID" />
                                                                            <Button disabled={locked} onClick={() => void associateRender(part)}>
                                                                                关联原任务
                                                                            </Button>
                                                                        </div>
                                                                    ) : null}
                                                                </div>
                                                            ))}
                                                        </details>
                                                    ) : null}
                                                    {unit.render?.started && !unit.render.taskId ? (
                                                        <div className="fv-render-link">
                                                            <Input aria-label="原渲染任务ID" value={renderId} onChange={(e) => setRenderId(e.target.value)} placeholder="从任务中心复制原渲染任务ID" />
                                                            <Button disabled={locked} onClick={() => void associateRender(unit)}>
                                                                关联原任务
                                                            </Button>
                                                        </div>
                                                    ) : null}
                                                    <div className="fv-result-actions">
                                                        {unit.render?.resourceId ? (
                                                            <Button
                                                                icon={<Download size={14} />}
                                                                onClick={() =>
                                                                    void downloadBrowserMedia({ fileName: `${unit.title}.mp4`, storageKey: `resource:${unit.render!.resourceId}` }).catch((e) => message.error(e instanceof Error ? e.message : "下载失败"))
                                                                }
                                                            >
                                                                下载成片
                                                            </Button>
                                                        ) : null}
                                                        {["succeeded", "failed"].includes(unit.status) ? (
                                                            <Button disabled={locked} onClick={() => void newVersion(unit)}>
                                                                {unit.status === "failed" && unit.parts ? "保留成功片段，重做失败片段" : "保留原版，生成新版本"}
                                                            </Button>
                                                        ) : null}
                                                    </div>
                                                    <details>
                                                        <summary>逐帧验收与执行记录</summary>
                                                        <ul>
                                                            <li>开头、中段、结尾人物身份与头发一致。</li>
                                                            <li>转身和遮挡后衣物轮廓、颜色、印花位置保持。</li>
                                                            <li>动作、手部接触、边缘与光线连续，无闪烁。</li>
                                                            <li>原片声音或静音方式与所选片段一致。</li>
                                                        </ul>
                                                        <p>{unit.prompt}</p>
                                                        <p>模型任务：{unit.taskId || "提交尚未确认"}</p>
                                                        <p>合成任务：{unit.render?.taskId || "尚未提交"}</p>
                                                    </details>
                                                </article>
                                            ))}
                                        </div>
                                    </>
                                ) : (
                                    <div className="fashion-empty">
                                        <Video size={32} />
                                        <h3>暂无视频作品</h3>
                                        <p>选择素材和处理方式，生成后在这里预览。</p>
                                    </div>
                                )}
                            </section>
                        </div>
                    </>
                )}
            </div>
        </FashionWorkbenchShell>
    );
}
