import { App, Button, Checkbox, Input, InputNumber, Select } from "antd";
import { Download, History, ImagePlus, Video, X, Shirt, Users, Layers, ScanFace, UserRound, Move, Play, Scissors } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppModal } from "@/components/ui/product/app-modal";
import { ModelPicker } from "@/components/model-picker";
import { GenerationCostNotice, TaskSettlement } from "@/components/generation-cost-notice";
import { FASHION_VIDEO_TOOLS, emptyFashionVideoDraft, fashionVideoProblem, fashionVideoTool, planFashionVideos, type FashionVideoDraft, type FashionVideoTool, type FashionVideoUnit, type FashionVideoWork } from "@/lib/fashion/video-workflow";
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
import { fashionVideoGenerationConfig, fashionVideoRequirements, runFashionVideoWork } from "@/services/fashion-video-generation";
import { useEffectiveConfig } from "@/stores/use-config-store";
import "./fashion.css";
import "./fashion-video.css";

const ICONS = { tryon: Shirt, "multi-garment": Layers, "multi-model": Users, face: ScanFace, head: UserRound, motion: Move, print: Scissors, showcase: Play };
const STATUSES = { pending: "待提交", submitting: "确认提交中", running: "视频生成中", rendering: "处理声音与交付", succeeded: "已交付", failed: "原任务已结束" };

export function FashionVideoWorkbench({ initialTool = "tryon", onClose }: { initialTool?: FashionVideoTool; onClose: () => void }) {
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
        if (!durations.includes(draft.seconds) && durations.length) setDraft((value) => ({ ...value, seconds: durations[0] }));
        if (!profile.ratios.includes(ratio)) setRatio(productVideoDefaultRatio(profile.ratios, draft.source?.width || draft.models[0]?.width || 1080, draft.source?.height || draft.models[0]?.height || 1920, profile.defaultRatio));
        if (!profile.resolutions.includes(resolution)) setResolution(profile.defaultResolution || profile.resolutions[0] || "");
    }, [profile, draft.seconds, draft.source, draft.models, ratio, resolution, locked, tool.source, work]);
    const imageCount = draft.tool === "multi-model" ? 2 : 1;
    const requirements = useMemo(() => fashionVideoRequirements({ draft }, imageCount), [draft, imageCount]);
    const settings = { model, ratio, resolution, draft };
    let problem = fashionVideoProblem(draft);
    try {
        fashionVideoGenerationConfig(config, settings, imageCount);
    } catch (e) {
        problem ||= e instanceof Error ? e.message : "模型不能执行此操作";
    }
    const count = draft.tool === "multi-model" || draft.tool === "showcase" ? draft.models.length : draft.tool === "multi-garment" ? draft.garments.length : 1;
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
            }));
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
                units.forEach((unit) => fashionVideoGenerationConfig(config, settings, unit.references.length));
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
            fashionVideoGenerationConfig(config, work, unit.references.length);
            const next: FashionVideoWork = {
                ...work,
                id: `fashion_video_${newFashionId()}`,
                revision: 0,
                createdAt: new Date().toISOString(),
                title: `${work.title.slice(0, 108)} · 新版本`,
                units: [{ id: newFashionId(), title: unit.title, prompt: unit.prompt, references: unit.references, status: "pending" }],
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
            if (task.type !== "timeline_render" || !input.timeline?.clips?.some((clip: { directMedia?: { storageKey?: string } }) => clip.directMedia?.storageKey === `resource:${unit.resourceId}`)) throw new Error("此任务不是当前生成视频的合成任务");
            await save({ ...work, units: work.units.map((item) => (item.id === unit.id ? { ...item, render: { started: true, taskId: task.id }, error: undefined } : item)) });
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
        <AppModal open centered closable={false} onCancel={onClose} footer={null} width={1180} flush title={null} rootClassName="fashion-modal">
            <div className="fashion-workbench fashion-video-workbench">
                <header className="fashion-head">
                    <div>
                        <small>VIDEO FASHION & IDENTITY</small>
                        <h2>服饰与人物视频工作台</h2>
                        <p>原视频编辑、动作参考与图生展示分别执行。每个版本保存输入、任务和成片。</p>
                    </div>
                    <Button icon={<History size={15} />} disabled={locked} onClick={() => setView(view === "new" ? "history" : "new")}>
                        {view === "new" ? "视频作品" : "返回创作"}
                    </Button>
                    <Button type="text" aria-label="关闭视频工作台" icon={<X size={18} />} onClick={onClose} />
                </header>
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
                        <div className="fashion-tool-grid" role="group" aria-label="视频处理方式">
                            {FASHION_VIDEO_TOOLS.map((item) => {
                                const Icon = ICONS[item.id];
                                return (
                                    <button key={item.id} aria-pressed={draft.tool === item.id} disabled={locked} onClick={() => patchDraft({ tool: item.id, ...(item.id === "showcase" && draft.audio === "original" ? { audio: "mute" } : {}) })}>
                                        <Icon />
                                        <strong>{item.title}</strong>
                                        <span>{item.text}</span>
                                    </button>
                                );
                            })}
                        </div>
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
                                                    {draft.source.name} · {(draft.source.durationMs / 1000).toFixed(1)}秒
                                                </p>
                                                <label>
                                                    片段起点（秒）
                                                    <InputNumber
                                                        aria-label="原视频片段起点"
                                                        min={0}
                                                        max={Math.max(0, draft.source.durationMs / 1000 - draft.seconds)}
                                                        step={0.1}
                                                        value={draft.startMs / 1000}
                                                        disabled={locked}
                                                        onChange={(value) => patchDraft({ startMs: Math.round((value || 0) * 1000) })}
                                                    />
                                                </label>
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
                                                aria-label={`上传${slot}`}
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
                                        片段时长
                                        <Select
                                            aria-label="视频片段时长"
                                            disabled={locked}
                                            value={draft.seconds}
                                            onChange={(seconds) => patchDraft({ seconds })}
                                            options={(profile ? videoDurationOptions(profile) : [5]).filter((seconds) => seconds >= 4 && seconds <= 30).map((value) => ({ value, label: `${value} 秒` }))}
                                        />
                                    </label>
                                    <label>
                                        画幅
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
                                <p className="fv-hint">{problem || `将独立生成${count}段视频。先切所选片段，再提交视频模型，最后处理声音。`}</p>
                                <GenerationCostNotice config={config} model={model} capability="video" requirements={requirements} count={Math.max(1, count)} label="视频生成" />
                                <Button type="primary" block disabled={locked || Boolean(problem)} onClick={() => void run()} icon={<Video size={16} />}>
                                    生成{count > 1 ? ` ${count} 段` : ""}视频
                                </Button>
                                <p className="fv-hint">原片编辑需要接受视频与图片参考的模型；图生展示不等于原视频换装。复杂遮挡、文字和身份一致性须在成片检查。</p>
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
                                        <TaskSettlement ids={work.units.flatMap((unit) => [unit.taskId || "", unit.render?.taskId || ""])} />
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
                                                                保留原版，生成新版本
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
                                        <h3>这里显示真实视频任务与成片</h3>
                                        <p>原片编辑保留所选视频的时间结构。展示视频从已确认人物图起拍，两个流程各用对应模型能力。</p>
                                    </div>
                                )}
                            </section>
                        </div>
                    </>
                )}
            </div>
        </AppModal>
    );
}
