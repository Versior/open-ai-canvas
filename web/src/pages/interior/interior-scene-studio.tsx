import { App, Button, Input, Tooltip } from "antd";
import { BookOpen, Box, LoaderCircle, RefreshCw, Sparkles, Trash2, Wand2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ModelPicker } from "@/components/model-picker";
import { buildSceneAnalysisPrompt, buildSceneEditPrompt, SCENE_SCOPES, type InteriorScene3D, type InteriorSceneScope } from "@/lib/interior/scene-3d";
import { modelCompatibilityError } from "@/lib/model-selection";
import { cn } from "@/lib/utils";
import type { InteriorCatalog, InteriorImageRef, InteriorProject, InteriorProjectDocument, InteriorSceneItem } from "@/services/api/interior";
import { selectableModelsByCapability, type AiConfig } from "@/stores/use-config-store";
import { groupPresets, uploadInteriorImage, UploadSlot, type InteriorUpload } from "./interior-composer";
import { newInteriorId, patchInteriorScene } from "./interior-models";
import { catalogKeys, fetchSceneKnowledge, loadSceneFile, sceneModelProblem, sceneModelRequirements, submitSceneTask } from "./interior-scene-tasks";
import { InteriorSceneViewer } from "./interior-scene-viewer";
import { useInteriorSceneTasks } from "./use-interior-scene-tasks";

/** 一个项目最多保存的 3D 模型数。 */
const MAX_SCENES = 30;

const STAGE_LABELS: Record<NonNullable<InteriorSceneItem["stage"]>, string> = { analyze: "AI 正在分析方案", plan: "正在规划", parts: "正在分部分搭", edit: "正在改" };

type ScopeChoice = InteriorSceneScope | "auto";

const SCOPE_CHOICES: { value: ScopeChoice; label: string; hint: string }[] = [{ value: "auto", label: "AI 判断", hint: "传张图或写一句话，AI 判断是房间、户型还是建筑" }, ...SCENE_SCOPES];

/** 从效果图带过来的内容：那张图当参考图，空间、风格和补充要求跟着带上。 */
export type InteriorSceneHandoff = { id: string; image: InteriorImageRef; roomKey?: string; styleKey?: string; description?: string };

/** 带去出效果图的内容：模型截图当白模原图，空间、风格和方案分析里的效果图要求跟着带上。 */
export type InteriorRenderHandoff = { image: InteriorImageRef; roomKey?: string; styleKey?: string; notes?: string };

function errorText(error: unknown, fallback: string) {
    return error instanceof Error && error.message ? error.message : fallback;
}

function formatTime(value: string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function sceneTitle(item: InteriorSceneItem) {
    if (item.title) return item.title;
    return [item.roomName, item.styleName, SCENE_SCOPES.find((scope) => scope.value === item.scope)?.label].filter(Boolean).join(" · ") || "3D 模型";
}

type Props = {
    catalog: InteriorCatalog;
    config: AiConfig;
    project: InteriorProject | null;
    header: ReactNode;
    ensureProject: () => Promise<InteriorProject>;
    update: (projectId: string, mutate: (document: InteriorProjectDocument) => InteriorProjectDocument) => void;
    removeScene: (projectId: string, sceneId: string) => void;
    handoff: InteriorSceneHandoff | null;
    onHandoffUsed: () => void;
    onRender: (handoff: InteriorRenderHandoff) => void;
};

/**
 * 室内设计的「3D 模型」：传一张户型图、照片或效果图，或者写一句话，AI 先查知识库做方案分析，再搭出三维场景，
 * 在页面里旋转、缩放查看，还能一句话改一版、按当前视角出效果图。场景和效果图共用项目，存在项目文档的 scenes 里。
 * 生成按所选文本模型计费。
 */
export function InteriorSceneStudio({ catalog, config, project, header, ensureProject, update, removeScene, handoff, onHandoffUsed, onRender }: Props) {
    const { message, modal } = App.useApp();
    const [scope, setScope] = useState<ScopeChoice>("auto");
    const [rendering, setRendering] = useState(false);
    const [description, setDescription] = useState("");
    const [roomKey, setRoomKey] = useState("");
    const [styleKey, setStyleKey] = useState("");
    const [reference, setReference] = useState<InteriorUpload | null>(null);
    const [instruction, setInstruction] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState("");
    const [selectedId, setSelectedId] = useState("");
    const previewUrls = useRef(new Set<string>());
    const textModels = useMemo(() => selectableModelsByCapability(config, "text"), [config]);
    const requirements = useMemo(() => sceneModelRequirements(config, reference?.resourceId ? 1 : 0), [config, reference?.resourceId]);
    const [model, setModel] = useState("");
    const tasks = useInteriorSceneTasks(project, update, config, catalog);
    // 从效果图带过来：把那张图当参考图，空间和风格跟着填好，用户点生成就行。
    useEffect(() => {
        if (!handoff) return;
        setReference({ ...handoff.image, name: "效果图" });
        setRoomKey(handoff.roomKey || "");
        setStyleKey(handoff.styleKey || "");
        setScope(handoff.roomKey ? "room" : "auto");
        setDescription(handoff.description || "");
        setError("");
        onHandoffUsed();
        message.info("已带上这张效果图和它的空间、风格，点「生成 3D 模型」就行");
    }, [handoff, message, onHandoffUsed]);

    useEffect(() => {
        const urls = previewUrls.current;
        return () => {
            for (const url of urls) URL.revokeObjectURL(url);
        };
    }, []);
    // 默认选当前的文本模型；不合适（例如附了图但不能看图）时换第一个合适的。
    useEffect(() => {
        if (model && !modelCompatibilityError(config, model, requirements)) return;
        const next = [config.textModel, ...textModels].find((item) => item && !modelCompatibilityError(config, item, requirements));
        if (next && next !== model) setModel(next);
    }, [config, model, requirements, textModels]);

    const scenes = project?.document.scenes || [];
    const selected = scenes.find((item) => item.id === selectedId) || scenes[0];
    const selectedFile = selected?.status === "succeeded" ? selected.sceneFile?.resourceId || "" : "";
    const [loaded, setLoaded] = useState<{ resourceId: string; scene?: InteriorScene3D; error?: string } | null>(null);
    useEffect(() => {
        if (!selectedFile) return;
        let cancelled = false;
        void loadSceneFile(selectedFile)
            .then((scene) => !cancelled && setLoaded({ resourceId: selectedFile, scene }))
            .catch((cause: unknown) => !cancelled && setLoaded({ resourceId: selectedFile, error: errorText(cause, "读取 3D 模型失败") }));
        return () => {
            cancelled = true;
        };
    }, [selectedFile]);
    const selectedLoad = loaded?.resourceId === selectedFile ? loaded : null;
    const selectedScene = selectedLoad?.scene;
    const room = catalog.rooms.find((item) => item.key === roomKey);
    const style = catalog.styles.find((item) => item.key === styleKey);
    const modelProblem = sceneModelProblem(config, model, reference?.resourceId ? 1 : 0);
    const problem = reference?.uploading ? "图片还在上传" : reference?.error ? "请移除上传失败的图片" : !description.trim() && !room && !style && !reference?.resourceId ? "传一张户型图或照片、写一句话，或者选个空间和风格" : modelProblem;

    const pickReference = (file: File) => {
        const previewUrl = URL.createObjectURL(file);
        previewUrls.current.add(previewUrl);
        setReference({ resourceId: "", name: file.name, uploading: true, previewUrl });
        void uploadInteriorImage(file)
            .then((image) => setReference({ ...image, name: file.name, previewUrl }))
            .catch((cause: unknown) => setReference({ resourceId: "", name: file.name, previewUrl, error: errorText(cause, "上传失败") }));
    };

    /** 记一条生成中的模型，再提交第一步的文本任务；任务 ID 写回后由监听接着往下走。 */
    const start = async (item: Omit<InteriorSceneItem, "id" | "createdAt" | "status" | "model">, prompt: string) => {
        if (submitting) return false;
        if (scenes.length >= MAX_SCENES) {
            setError(`一个项目最多保存 ${MAX_SCENES} 个 3D 模型，先删掉不要的，或者新建一个项目`);
            return false;
        }
        setSubmitting(true);
        setError("");
        let target: InteriorProject | null = null;
        const id = newInteriorId();
        try {
            target = await ensureProject();
            const entry: InteriorSceneItem = { ...item, id, createdAt: new Date().toISOString(), status: "pending", model };
            update(target.id, (document) => ({ ...document, scenes: [entry, ...(document.scenes || [])] }));
            setSelectedId(id);
            const task = await submitSceneTask(config, model, prompt, item.stage || "plan", item.reference);
            update(target.id, (document) => patchInteriorScene(document, id, { taskId: task.id }));
            window.dispatchEvent(new CustomEvent("wallet:updated"));
            return true;
        } catch (cause) {
            const text = errorText(cause, "提交失败，请稍后重试");
            setError(text);
            if (target) update(target.id, (document) => patchInteriorScene(document, id, { status: "failed", error: text }));
            return false;
        } finally {
            setSubmitting(false);
        }
    };

    /** 先查知识库，再提交 AI 方案分析；分析完成后由监听接着规划、分部分搭。 */
    const generate = async () => {
        if (problem) {
            setError(problem);
            return;
        }
        const image = reference?.resourceId ? { resourceId: reference.resourceId, ...(reference.width ? { width: reference.width } : {}), ...(reference.height ? { height: reference.height } : {}) } : undefined;
        const item: Omit<InteriorSceneItem, "id" | "createdAt" | "status" | "model"> = {
            scope: scope === "auto" ? "room" : scope,
            ...(scope === "auto" ? { autoScope: true } : {}),
            description: description.trim(),
            stage: "analyze",
            ...(room ? { roomKey: room.key, roomName: room.name } : {}),
            ...(style ? { styleKey: style.key, styleName: style.name, ...(style.summary ? { styleHint: style.summary } : {}) } : {}),
            ...(image ? { reference: image } : {}),
        };
        let knowledge;
        try {
            ({ knowledge } = await fetchSceneKnowledge({ scope: scope === "auto" ? undefined : scope, roomKey: room?.key, styleKey: style?.key, text: description }));
        } catch (cause) {
            setError(`读取室内设计知识库失败：${errorText(cause, "请稍后重试")}`);
            return;
        }
        const keys = catalogKeys(catalog);
        void start(item, buildSceneAnalysisPrompt({ scope, description, roomName: room?.name, styleName: style?.name, hasReference: Boolean(image), rooms: keys.rooms, styles: keys.styles, knowledge }));
    };

    /** 按当前视角截一张图存成素材，带去「效果图」用白模渲染出图。 */
    const render = async (blob: Blob) => {
        if (!selected) return;
        setRendering(true);
        try {
            const image = await uploadInteriorImage(new File([blob], `${sceneTitle(selected)}-白模.png`, { type: "image/png" }));
            onRender({ image, roomKey: selected.roomKey, styleKey: selected.styleKey, notes: selected.brief?.renderNotes });
        } catch (cause) {
            message.error(errorText(cause, "截图保存失败"));
        } finally {
            setRendering(false);
        }
    };

    const edit = async () => {
        if (!selected?.sceneFile || !selectedScene || !instruction.trim()) return;
        if (modelProblem) {
            setError(modelProblem);
            return;
        }
        const ok = await start(
            {
                scope: selected.scope,
                description: selected.description,
                stage: "edit",
                ...(selected.roomKey ? { roomKey: selected.roomKey, roomName: selected.roomName } : {}),
                ...(selected.styleKey ? { styleKey: selected.styleKey, styleName: selected.styleName, styleHint: selected.styleHint } : {}),
                parentId: selected.id,
                instruction: instruction.trim(),
            },
            buildSceneEditPrompt(selectedScene, instruction),
        );
        if (ok) setInstruction("");
    };

    const remove = (item: InteriorSceneItem) => {
        if (!project) return;
        modal.confirm({
            title: `删除「${sceneTitle(item)}」？`,
            content: item.status === "pending" ? "还在生成的任务会继续跑完并照常计费，只是结果不再保存。" : "删除后不能恢复。",
            okText: "删除",
            okButtonProps: { danger: true },
            cancelText: "取消",
            onOk: () => removeScene(project.id, item.id),
        });
    };

    const parent = selected?.parentId ? scenes.find((item) => item.id === selected.parentId) : undefined;
    const pendingLabel = selected?.status === "pending" ? STAGE_LABELS[selected.stage || "plan"] : "";
    const stalledText = selected ? tasks.stalled[selected.id] : "";

    return (
        <div className="itd-shell">
            <aside className="itd-composer" aria-label="3D 模型设置">
                <div className="itd-composer-scroll thin-scrollbar">
                    <section className="itd-section">
                        <h2 className="itd-section-title">做什么</h2>
                        <div className="itd-mode-grid" role="radiogroup" aria-label="模型范围">
                            {SCOPE_CHOICES.map((item) => (
                                <button key={item.value} type="button" role="radio" aria-checked={scope === item.value} className={cn("itd-mode", scope === item.value && "is-active")} onClick={() => setScope(item.value)} disabled={submitting}>
                                    <strong>{item.label}</strong>
                                    <span>{item.hint}</span>
                                </button>
                            ))}
                        </div>
                    </section>
                    <section className="itd-section">
                        <label className="itd-field is-block">
                            <span className="itd-field-label">描述</span>
                            <Input.TextArea
                                value={description}
                                maxLength={500}
                                showCount
                                autoSize={{ minRows: 3, maxRows: 6 }}
                                placeholder={
                                    scope === "building"
                                        ? "例如：三层新中式别墅，带前院和围墙，一层大落地窗，二层露台，坡屋顶"
                                        : scope === "home"
                                          ? "例如：三室两厅，客厅朝南带阳台，开放式厨房，主卧带衣帽间"
                                          : "例如：20 平米的客厅，L 型沙发、电视墙、落地窗和一张大地毯"
                                }
                                onChange={(event) => setDescription(event.target.value)}
                                disabled={submitting}
                            />
                        </label>
                    </section>
                    <section className="itd-section">
                        <h2 className="itd-section-title">
                            户型图或照片<small>可选，模型要能看图</small>
                        </h2>
                        <div className="itd-upload-row">
                            <UploadSlot label="户型图 / 现场照片" value={reference} onPick={pickReference} onClear={() => setReference(null)} disabled={submitting} />
                        </div>
                    </section>
                    {scope !== "building" ? (
                        <section className="itd-section">
                            <h2 className="itd-section-title">
                                空间<small>可选</small>
                            </h2>
                            {groupPresets(catalog.rooms).map(([group, rooms]) => (
                                <div key={group} className="itd-chip-group">
                                    <span className="itd-chip-group-label">{group}</span>
                                    <div className="itd-chips">
                                        {rooms.map((item) => (
                                            <button key={item.key} type="button" className="itd-chip" aria-pressed={roomKey === item.key} onClick={() => setRoomKey(roomKey === item.key ? "" : item.key)} disabled={submitting}>
                                                {item.name}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </section>
                    ) : null}
                    <section className="itd-section">
                        <h2 className="itd-section-title">
                            风格<small>可选</small>
                        </h2>
                        {groupPresets(catalog.styles).map(([group, styles]) => (
                            <div key={group} className="itd-chip-group">
                                <span className="itd-chip-group-label">{group}</span>
                                <div className="itd-chips">
                                    {styles.map((item) => (
                                        <button key={item.key} type="button" className="itd-chip" aria-pressed={styleKey === item.key} title={item.summary} onClick={() => setStyleKey(styleKey === item.key ? "" : item.key)} disabled={submitting}>
                                            {item.name}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </section>
                    <section className="itd-section">
                        <div className="itd-field is-block">
                            <span className="itd-field-label">
                                搭模型用的文本模型<small>越强的模型搭得越细</small>
                            </span>
                            <ModelPicker config={config} capability="text" value={model} onChange={setModel} requirements={requirements} variant="creation" fullWidth className="creation-model-picker itd-model-picker" placeholder="选择文本模型" />
                        </div>
                    </section>
                </div>
                <footer className="itd-composer-foot">
                    {error ? (
                        <p className="itd-inline-error" role="alert">
                            {error}
                        </p>
                    ) : null}
                    <Button
                        type="primary"
                        size="large"
                        block
                        icon={submitting ? <LoaderCircle className="size-4 motion-safe:animate-spin" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}
                        disabled={Boolean(problem) || submitting}
                        onClick={() => void generate()}
                    >
                        {submitting ? "正在提交" : reference?.resourceId && !description.trim() ? "AI 分析并生成 3D 模型" : "生成 3D 模型"}
                    </Button>
                    <p className="itd-muted-note">{problem && !submitting ? problem : "AI 先看图读需求、查知识库补全方案，再用基础几何体搭出示意模型；按所选文本模型计费。"}</p>
                </footer>
            </aside>
            <section className="itd-board" aria-label="3D 模型">
                {header}
                <div className="itd-scene-body">
                    <div className="itd-scene-stage">
                        {!selected ? (
                            <div className="itd-scene-empty">
                                <Box className="size-6" aria-hidden />
                                <strong>还没有 3D 模型</strong>
                                <span>写一句想要的房子，或者传一张户型图，生成后可以拖动旋转、滚轮缩放，下载 GLB 到 Blender、SketchUp 里继续改。</span>
                            </div>
                        ) : selected.status === "succeeded" ? (
                            selectedScene ? (
                                <InteriorSceneViewer scene={selectedScene} onError={(text) => message.error(text)} onSnapshot={(blob) => void render(blob)} snapshotBusy={rendering} />
                            ) : selectedLoad?.error ? (
                                <div className="itd-scene-empty is-error" role="alert">
                                    <strong>打不开这个模型</strong>
                                    <span>{selectedLoad.error}</span>
                                </div>
                            ) : (
                                <div className="itd-scene-empty" role="status">
                                    <LoaderCircle className="size-6 motion-safe:animate-spin" aria-hidden />
                                    <span>正在读取模型</span>
                                </div>
                            )
                        ) : selected.status === "pending" ? (
                            <div className="itd-scene-empty" role="status">
                                <LoaderCircle className="size-6 motion-safe:animate-spin" aria-hidden />
                                <strong>{stalledText ? "查询结果中断" : pendingLabel}</strong>
                                <span>
                                    {stalledText ||
                                        (selected.stage === "parts" && selected.plan
                                            ? `分 ${selected.plan.parts.length} 部分同时搭：${selected.plan.parts.map((part) => part.group).join("、")}。一般 1–3 分钟，离开页面不会中断。`
                                            : selected.stage === "analyze"
                                              ? "AI 正在看图、读需求、查知识库补全方案，接着规划和分部分搭。离开页面不会中断。"
                                              : "正在规划整体尺寸和分几部分，接着分部分细搭。离开页面不会中断，回来接着看。")}
                                </span>
                                {stalledText ? (
                                    <Button size="small" icon={<RefreshCw className="size-3.5" aria-hidden />} onClick={() => tasks.retry(selected.id)}>
                                        重新查询
                                    </Button>
                                ) : null}
                            </div>
                        ) : (
                            <div className="itd-scene-empty is-error" role="alert">
                                <strong>这次没有搭出来</strong>
                                <span>{selected.error || "生成失败"}</span>
                            </div>
                        )}
                    </div>
                    {selected?.status === "succeeded" && selectedScene ? (
                        <div className="itd-scene-meta">
                            <div className="itd-scene-meta-copy">
                                <strong>{selectedScene.title}</strong>
                                <span>{[selectedScene.summary, `${selectedScene.objects.length} 个物体`, selected.instruction ? `在「${parent ? sceneTitle(parent) : "上一版"}」上改：${selected.instruction}` : ""].filter(Boolean).join(" · ")}</span>
                                {selected.knowledge?.length ? (
                                    <Tooltip title={selected.knowledge.map((item) => `【${item.kindName}】${item.title}`).join("\n")} styles={{ root: { maxWidth: 360, whiteSpace: "pre-line" } }}>
                                        <span className="itd-scene-knowledge" tabIndex={0}>
                                            <BookOpen className="size-3.5" aria-hidden />
                                            {`参考了知识库 ${selected.knowledge.length} 条`}
                                        </span>
                                    </Tooltip>
                                ) : null}
                                {selected.failedParts?.length || selected.dropped ? (
                                    <span className="itd-scene-warning">
                                        {[selected.failedParts?.length ? `「${selected.failedParts.join("、")}」没搭出来，已跳过` : "", selected.dropped ? `${selected.dropped} 个物体读不懂，已去掉` : ""].filter(Boolean).join("；")}
                                    </span>
                                ) : null}
                            </div>
                            <div className="itd-scene-edit">
                                <Input
                                    value={instruction}
                                    maxLength={300}
                                    placeholder="一句话改：把沙发换成 L 型、二层加一个露台、墙面换成浅灰色"
                                    onChange={(event) => setInstruction(event.target.value)}
                                    onPressEnter={() => void edit()}
                                    disabled={submitting}
                                    aria-label="修改要求"
                                />
                                <Button icon={<Wand2 className="size-4" aria-hidden />} disabled={!instruction.trim() || submitting || Boolean(modelProblem)} loading={submitting} onClick={() => void edit()}>
                                    改一版
                                </Button>
                            </div>
                        </div>
                    ) : null}
                    {scenes.length ? (
                        <ul className="itd-scene-list thin-scrollbar" aria-label="这个项目的 3D 模型">
                            {scenes.map((item) => (
                                <li key={item.id}>
                                    <button type="button" className={cn("itd-scene-card", item.id === selected?.id && "is-active")} aria-pressed={item.id === selected?.id} onClick={() => setSelectedId(item.id)}>
                                        <strong>{sceneTitle(item)}</strong>
                                        <span>{item.status === "pending" ? STAGE_LABELS[item.stage || "plan"] : item.status === "failed" ? "失败" : `${item.objectCount || 0} 个物体`}</span>
                                        <small>{[item.instruction ? "改过一版" : SCENE_SCOPES.find((scope) => scope.value === item.scope)?.label, formatTime(item.createdAt)].filter(Boolean).join(" · ")}</small>
                                    </button>
                                    <button type="button" className="itd-scene-card-remove" aria-label={`删除「${sceneTitle(item)}」`} onClick={() => remove(item)}>
                                        <Trash2 className="size-3.5" aria-hidden />
                                    </button>
                                </li>
                            ))}
                        </ul>
                    ) : null}
                </div>
            </section>
        </div>
    );
}
