import { App, Button, Input, Select, Tooltip } from "antd";
import { BookOpen, Box, History, Info, LoaderCircle, Plus, SlidersHorizontal, Sparkles, Trash2, Wand2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ModelPicker } from "@/components/model-picker";
import { buildSceneEditPrompt, knowledgeLines, SCENE_SCOPES, type InteriorSceneScope } from "@/lib/interior/scene-3d";
import { sceneStats } from "@/lib/interior/scene-compile";
import { buildSceneSpecEditPrompt, buildSceneSpecPrompt, type InteriorSceneData } from "@/lib/interior/scene-spec";
import { modelCompatibilityError } from "@/lib/model-selection";
import { cn } from "@/lib/utils";
import type { InteriorCatalog, InteriorImageRef, InteriorProject, InteriorProjectDocument, InteriorSceneItem } from "@/services/api/interior";
import { selectableModelsByCapability, type AiConfig } from "@/stores/use-config-store";
import { groupPresets, uploadInteriorImage, UploadSlot, type InteriorUpload } from "./interior-composer";
import { interiorImageUrl, newInteriorId, patchInteriorScene } from "./interior-models";
import { InteriorSceneBuildStage } from "./interior-scene-build";
import { catalogKeys, fetchSceneKnowledge, loadSceneFile, sceneModelProblem, sceneModelRequirements, submitSceneTask } from "./interior-scene-tasks";
import { InteriorSceneViewer } from "./interior-scene-viewer";
import { InteriorSceneDelivery } from "./interior-scene-delivery";
import { useInteriorSceneTasks } from "./use-interior-scene-tasks";
import { applySceneLocalEdit, buildSceneLocalEditPrompt, sceneEditOptions } from "@/lib/interior/scene-local-edit";
import { getActiveUserScope } from "@/lib/user-scope";
import { saveSceneFile } from "./interior-scene-tasks";
import { InteriorLocalControls } from "./interior-local-controls";
import { GenerationCostNotice, TaskSettlement } from "@/components/generation-cost-notice";

/** 一个项目最多保存的 3D 模型数。 */
const MAX_SCENES = 30;

const STAGE_LABELS: Record<NonNullable<InteriorSceneItem["stage"]>, string> = { analyze: "AI 正在分析方案", spec: "AI 正在读图建模", plan: "正在规划", parts: "正在分部分搭", edit: "正在改" };

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
    saveProject: () => Promise<void>;
    onBusyChange: (busy: boolean) => void;
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
export function InteriorSceneStudio({ catalog, config, project, header, ensureProject, update, saveProject, onBusyChange, removeScene, handoff, onHandoffUsed, onRender }: Props) {
    const { message, modal } = App.useApp();
    const [scope, setScope] = useState<ScopeChoice>("auto");
    const [composerOpen, setComposerOpen] = useState(false);
    const [panel, setPanel] = useState<"edit" | "history" | "info" | null>(null);
    const [rendering, setRendering] = useState(false);
    const [description, setDescription] = useState("");
    const [roomKey, setRoomKey] = useState("");
    const [styleKey, setStyleKey] = useState("");
    const [reference, setReference] = useState<InteriorUpload | null>(null);
    const [instruction, setInstruction] = useState("");
    const [targetKey, setTargetKey] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [readingKnowledge, setReadingKnowledge] = useState(false);
    const knowledgeRequest = useRef(false);
    const busy = submitting || readingKnowledge;
    useEffect(() => {
        onBusyChange(busy);
        return () => onBusyChange(false);
    }, [busy, onBusyChange]);
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
        setComposerOpen(true);
        setPanel(null);
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
    const [loaded, setLoaded] = useState<{ resourceId: string; scene?: InteriorSceneData; error?: string } | null>(null);
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
    useEffect(() => {
        if (selectedScene) setComposerOpen(false);
    }, [selectedScene]);
    const editOptions = useMemo(() => (selectedScene ? sceneEditOptions(selectedScene) : []), [selectedScene]);
    const editOption = targetKey === "whole" ? undefined : editOptions.find((item) => item.value === targetKey) || editOptions[0];
    useEffect(() => {
        setTargetKey("");
        setInstruction("");
    }, [selectedFile]);
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
        const account = getActiveUserScope();
        try {
            target = await ensureProject();
            const entry: InteriorSceneItem = { ...item, id, createdAt: new Date().toISOString(), status: "pending", model };
            update(target.id, (document) => ({ ...document, scenes: [entry, ...(document.scenes || [])] }));
            setSelectedId(id);
            await saveProject();
            if (getActiveUserScope() !== account) throw new Error("账号已切换，未提交生成");
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

    /**
     * 先查知识库，再一次提交「读图 + 出方案」：模型先写读图记录，再写轴网、房间、门窗和家具，
     * 页面边收边搭（以前要先等一轮方案分析，再等一轮方案，两次看图）。
     */
    const generate = async () => {
        if (busy || knowledgeRequest.current) return;
        if (problem) {
            setError(problem);
            return;
        }
        const image = reference?.resourceId ? { resourceId: reference.resourceId, ...(reference.width ? { width: reference.width } : {}), ...(reference.height ? { height: reference.height } : {}) } : undefined;
        let found: Awaited<ReturnType<typeof fetchSceneKnowledge>>;
        const account = getActiveUserScope();
        knowledgeRequest.current = true;
        setReadingKnowledge(true);
        try {
            found = await fetchSceneKnowledge({ scope: scope === "auto" ? undefined : scope, roomKey: room?.key, styleKey: style?.key, text: description });
            if (getActiveUserScope() !== account) throw new Error("账号已切换，未提交建模");
        } catch (cause) {
            setError(`读取室内设计知识库失败：${errorText(cause, "请稍后重试")}`);
            return;
        } finally {
            knowledgeRequest.current = false;
            setReadingKnowledge(false);
        }
        const item: Omit<InteriorSceneItem, "id" | "createdAt" | "status" | "model"> = {
            scope: scope === "auto" ? "room" : scope,
            ...(scope === "auto" ? { autoScope: true } : {}),
            description: description.trim(),
            stage: "spec",
            knowledge: found.refs,
            ...(room ? { roomKey: room.key, roomName: room.name } : {}),
            ...(style ? { styleKey: style.key, styleName: style.name, ...(style.summary ? { styleHint: style.summary } : {}) } : {}),
            ...(image ? { reference: image } : {}),
        };
        void start(item, buildSceneSpecPrompt({ scope, description, roomName: room?.name, styleName: style?.name, stylePrompt: style?.summary, hasReference: Boolean(image), knowledge: found.knowledge, ...catalogKeys(catalog) }));
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
        if (busy || knowledgeRequest.current || !selected?.sceneFile || !selectedScene || !instruction.trim()) return;
        const editProblem = sceneModelProblem(config, model, 0);
        if (editProblem) {
            setError(editProblem);
            return;
        }
        let found: Awaited<ReturnType<typeof fetchSceneKnowledge>>;
        const account = getActiveUserScope();
        knowledgeRequest.current = true;
        setReadingKnowledge(true);
        try {
            found = await fetchSceneKnowledge({ scope: selected.scope, roomKey: selected.roomKey, styleKey: selected.styleKey, text: instruction });
            if (getActiveUserScope() !== account) throw new Error("账号已切换，未提交调整");
        } catch (cause) {
            setError(`读取室内设计知识库失败：${errorText(cause, "请稍后重试")}`);
            return;
        } finally {
            knowledgeRequest.current = false;
            setReadingKnowledge(false);
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
                knowledge: found.refs,
                ...(editOption ? { editTarget: editOption.target } : {}),
            },
            editOption
                ? buildSceneLocalEditPrompt(selectedScene, editOption.target, instruction, found.knowledge)
                : [selectedScene.version === 2 ? buildSceneSpecEditPrompt(selectedScene.spec, instruction) : buildSceneEditPrompt(selectedScene, instruction), ...knowledgeLines(found.knowledge)].filter(Boolean).join("\n\n"),
        );
        if (ok) setInstruction("");
    };

    const applyManual = async (patch: Record<string, unknown>) => {
        if (busy || !selected || !selectedScene || !editOption || !project) throw new Error("请先选择已完成的模型和调整目标");
        if (scenes.length >= MAX_SCENES) throw new Error(`一个项目最多保存 ${MAX_SCENES} 个模型，请先整理历史版本`);
        const scene = applySceneLocalEdit(selectedScene, editOption.target, patch);
        const account = getActiveUserScope();
        setSubmitting(true);
        try {
            await saveProject();
            if (getActiveUserScope() !== account) throw new Error("账号已切换，未应用修改");
            const sceneFile = await saveSceneFile(scene);
            if (getActiveUserScope() !== account) throw new Error("账号已切换，未更新项目");
            const id = newInteriorId();
            const entry: InteriorSceneItem = {
                ...selected,
                id,
                createdAt: new Date().toISOString(),
                parentId: selected.id,
                instruction: `手动调整：${editOption.label}`,
                editTarget: editOption.target,
                taskId: undefined,
                status: "succeeded",
                stage: "edit",
                sceneFile,
                title: scene.title,
                summary: scene.summary,
                stats: sceneStats(scene),
                error: undefined,
                notice: undefined,
            };
            update(project.id, (document) => ({ ...document, scenes: [entry, ...(document.scenes || [])] }));
            await saveProject();
            if (getActiveUserScope() !== account) throw new Error("账号已切换，未确认新版本保存");
            setSelectedId(id);
            message.success("局部调整已保存为新版本，可在历史中查看上一版");
        } finally {
            setSubmitting(false);
        }
    };

    const remove = (item: InteriorSceneItem) => {
        if (!project || busy || knowledgeRequest.current) return;
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
    const stalledText = selected ? tasks.stalled[selected.id] : "";
    const referenceUrl = selected?.reference?.resourceId ? interiorImageUrl(selected.reference.resourceId) : undefined;
    const sceneWarning = Boolean(selected?.failedParts?.length || selected?.dropped || selected?.notice);
    const showComposer = !scenes.length || composerOpen;
    const togglePanel = (next: NonNullable<typeof panel>) => {
        setComposerOpen(false);
        setPanel((current) => (current === next ? null : next));
    };

    return (
        <div className={cn("itd-shell itd-model-shell", !showComposer && "is-model-focused")}>
            {showComposer ? (
                <aside className="itd-composer" aria-label="3D 模型设置">
                    {scenes.length ? (
                        <Button type="text" icon={<X className="size-4" aria-hidden />} onClick={() => setComposerOpen(false)}>
                            收起新建设置
                        </Button>
                    ) : null}
                    <div className="itd-composer-scroll thin-scrollbar">
                        <section className="itd-section">
                            <h2 className="itd-section-title">做什么</h2>
                            <div className="itd-mode-grid" role="radiogroup" aria-label="模型范围">
                                {SCOPE_CHOICES.map((item) => (
                                    <button key={item.value} type="button" role="radio" aria-checked={scope === item.value} className={cn("itd-mode", scope === item.value && "is-active")} onClick={() => setScope(item.value)} disabled={busy}>
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
                                    disabled={busy}
                                />
                            </label>
                        </section>
                        <section className="itd-section">
                            <h2 className="itd-section-title">
                                户型图或照片<small>可选，模型要能看图</small>
                            </h2>
                            <div className="itd-upload-row">
                                <UploadSlot label="户型图 / 现场照片" value={reference} onPick={pickReference} onClear={() => setReference(null)} disabled={busy} />
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
                                                <button key={item.key} type="button" className="itd-chip" aria-pressed={roomKey === item.key} onClick={() => setRoomKey(roomKey === item.key ? "" : item.key)} disabled={busy}>
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
                                            <button key={item.key} type="button" className="itd-chip" aria-pressed={styleKey === item.key} title={item.summary} onClick={() => setStyleKey(styleKey === item.key ? "" : item.key)} disabled={busy}>
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
                                <ModelPicker
                                    config={config}
                                    capability="text"
                                    value={model}
                                    onChange={(next) => {
                                        if (!busy) setModel(next);
                                    }}
                                    modelDisabledReason={() => (busy ? "正在读取知识或提交模型" : "")}
                                    requirements={requirements}
                                    variant="creation"
                                    fullWidth
                                    className="creation-model-picker itd-model-picker"
                                    placeholder="选择文本模型"
                                />
                            </div>
                        </section>
                    </div>
                    <footer className="itd-composer-foot">
                        <GenerationCostNotice config={config} model={model} capability="text" requirements={requirements} label="生成三维模型" />
                        {error ? (
                            <p className="itd-inline-error" role="alert">
                                {error}
                            </p>
                        ) : null}
                        <Button
                            type="primary"
                            size="large"
                            block
                            icon={busy ? <LoaderCircle className="size-4 motion-safe:animate-spin" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}
                            disabled={Boolean(problem) || busy}
                            onClick={() => void generate()}
                        >
                            {readingKnowledge ? "正在读取知识" : submitting ? "正在提交" : reference?.resourceId && !description.trim() ? "AI 分析并生成 3D 模型" : "生成 3D 模型"}
                        </Button>
                        <p className="itd-muted-note">{problem && !busy ? problem : "AI 看图读尺寸、查知识库出方案，边写边搭出墙体、门窗和家具，过程实时可见；按所选文本模型计费。"}</p>
                    </footer>
                </aside>
            ) : null}
            <section className="itd-board" aria-label="3D 模型">
                {header}
                <div className="itd-model-actions" aria-label="模型工作区工具">
                    <strong title={selected ? sceneTitle(selected) : "3D 模型"}>{selected ? sceneTitle(selected) : "3D 模型"}</strong>
                    <Button
                        size="small"
                        icon={<Plus className="size-3.5" aria-hidden />}
                        aria-pressed={showComposer}
                        onClick={() => {
                            setPanel(null);
                            setComposerOpen(!showComposer);
                        }}
                    >
                        新建
                    </Button>
                    <Button size="small" icon={<SlidersHorizontal className="size-3.5" aria-hidden />} aria-pressed={panel === "edit"} disabled={!selectedScene} onClick={() => togglePanel("edit")}>
                        局部调整
                    </Button>
                    <Button size="small" icon={<History className="size-3.5" aria-hidden />} aria-pressed={panel === "history"} disabled={!scenes.length} onClick={() => togglePanel("history")}>{`版本 ${scenes.length}`}</Button>
                    <Button size="small" icon={<BookOpen className="size-3.5" aria-hidden />} aria-pressed={panel === "info"} disabled={!selectedScene} onClick={() => togglePanel("info")}>
                        {sceneWarning ? "方案需核对" : selected?.knowledge?.length ? `知识 ${selected.knowledge.length}` : "方案信息"}
                    </Button>
                </div>
                {error && !showComposer ? (
                    <p className="itd-error" role="alert">
                        {error}
                    </p>
                ) : null}
                <div className={cn("itd-scene-body", panel && "has-panel")}>
                    <div className="itd-scene-stage">
                        {!selected ? (
                            <div className="itd-scene-empty">
                                <Box className="size-6" aria-hidden />
                                <strong>还没有 3D 模型</strong>
                                <span>写一句想要的房子，或者传一张户型图，生成后可以拖动旋转、滚轮缩放，下载 GLB 到 Blender、SketchUp 里继续改。</span>
                            </div>
                        ) : selected.status === "succeeded" ? (
                            selectedScene ? (
                                <InteriorSceneViewer
                                    scene={selectedScene}
                                    editTarget={editOption?.target}
                                    onRoomSelect={(name, elevation) => {
                                        if (!busy && selectedScene.version === 2) {
                                            const option = editOptions.find((item) => {
                                                if (item.target.kind !== "room" || item.target.room !== name) return false;
                                                const bottom = selectedScene.spec.floors.slice(0, item.target.floor).reduce((sum, floor) => sum + floor.height, 0);
                                                return elevation >= bottom && elevation < bottom + selectedScene.spec.floors[item.target.floor].height;
                                            });
                                            if (option) {
                                                setTargetKey(option.value);
                                                setComposerOpen(false);
                                                setPanel("edit");
                                            }
                                        }
                                    }}
                                    onError={(text) => message.error(text)}
                                    onSnapshot={(blob) => void render(blob)}
                                    snapshotBusy={rendering}
                                    referenceUrl={referenceUrl}
                                />
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
                            <InteriorSceneBuildStage
                                key={selected.id}
                                text={tasks.live[selected.id] || ""}
                                scope={selected.autoScope ? "auto" : selected.scope}
                                startedAt={selected.createdAt}
                                stage={selected.stage}
                                stalled={stalledText || undefined}
                                referenceUrl={referenceUrl}
                                onRetry={() => tasks.retry(selected.id)}
                            />
                        ) : (
                            <div className="itd-scene-empty is-error" role="alert">
                                <strong>这次没有搭出来</strong>
                                <span>{selected.error || "生成失败"}</span>
                            </div>
                        )}
                    </div>
                    {panel ? (
                        <aside className="itd-model-panel thin-scrollbar" aria-label={panel === "edit" ? "局部调整面板" : panel === "history" ? "模型版本" : "方案与知识"}>
                            <header>
                                <strong>{panel === "edit" ? "局部调整" : panel === "history" ? "模型版本" : "方案与知识"}</strong>
                                <Button type="text" size="small" aria-label="收起模型工具" icon={<X className="size-4" aria-hidden />} onClick={() => setPanel(null)} />
                            </header>
                            {panel === "info" && selected?.status === "succeeded" && selectedScene ? (
                                <div className="itd-scene-meta">
                                    <div className="itd-scene-meta-copy">
                                        <strong>{selectedScene.title}</strong>
                                        <span>{[selectedScene.summary, sceneStats(selectedScene), selected.instruction ? `在「${parent ? sceneTitle(parent) : "上一版"}」上改：${selected.instruction}` : ""].filter(Boolean).join(" · ")}</span>
                                        {selected.knowledge?.length ? (
                                            <details>
                                                <summary className="itd-scene-knowledge">
                                                    <BookOpen className="size-3.5" aria-hidden />
                                                    {`参考知识 ${selected.knowledge.length} 条`}
                                                </summary>
                                                <ul>
                                                    {selected.knowledge.map((item) => (
                                                        <li key={item.id}>
                                                            {item.title}
                                                            <small> · {item.kindName}</small>
                                                        </li>
                                                    ))}
                                                </ul>
                                            </details>
                                        ) : null}
                                        {selected.failedParts?.length || selected.dropped || selected.notice ? (
                                            <span className="itd-scene-warning">
                                                {[selected.notice || "", selected.failedParts?.length ? `「${selected.failedParts.join("、")}」没搭出来，已跳过` : "", selected.dropped ? `${selected.dropped} 个物体读不懂，已去掉` : ""]
                                                    .filter(Boolean)
                                                    .join("；")}
                                            </span>
                                        ) : null}
                                    </div>
                                </div>
                            ) : null}
                            {panel === "edit" && selectedScene ? (
                                <>
                                    <div className="itd-scene-edit">
                                        <label className="itd-field is-block">
                                            <span className="itd-field-label">调整范围</span>
                                            <Select
                                                aria-label="局部调整目标"
                                                value={editOption?.value || "whole"}
                                                disabled={busy}
                                                showSearch
                                                optionFilterProp="label"
                                                options={[...editOptions.map(({ value, label }) => ({ value, label })), { value: "whole", label: "整套方案（可调整结构）" }]}
                                                onChange={setTargetKey}
                                            />
                                        </label>
                                        <Input.TextArea
                                            value={instruction}
                                            maxLength={300}
                                            placeholder={editOption ? "例如：只把这里的沙发换成 L 型，其他家具保留" : "例如：二层加一个露台"}
                                            onChange={(event) => setInstruction(event.target.value)}
                                            autoSize={{ minRows: 2, maxRows: 5 }}
                                            disabled={busy}
                                            aria-label="修改要求"
                                        />
                                        <GenerationCostNotice config={config} model={model} capability="text" label={editOption ? "局部对话" : "整套方案调整"} />
                                        <Button icon={<Wand2 className="size-4" aria-hidden />} disabled={!instruction.trim() || busy || Boolean(sceneModelProblem(config, model, 0))} loading={busy} onClick={() => void edit()}>
                                            {editOption ? "对话调整局部" : "调整整套方案"}
                                        </Button>
                                        <Tooltip title={editOption ? "只改选定目标，其余房间与结构保留；可点击模型房间标注选取目标。" : "整体调整允许改变结构，请核对新版本。"}>
                                            <span className="itd-muted-note">
                                                <Info className="size-3" aria-hidden />
                                                {editOption ? "仅修改选定目标" : "允许修改整体结构"}
                                            </span>
                                        </Tooltip>
                                        {parent ? (
                                            <Button size="small" onClick={() => setSelectedId(parent.id)} disabled={busy}>
                                                查看上一版
                                            </Button>
                                        ) : null}
                                    </div>
                                </>
                            ) : null}
                            {panel === "edit" && selected?.status === "succeeded" && selectedScene && editOption ? (
                                <InteriorLocalControls key={`${selected.id}:${editOption.value}`} scene={selectedScene} target={editOption.target} disabled={busy} onApply={applyManual} />
                            ) : null}
                            {panel === "info" && selected?.taskId ? <TaskSettlement ids={[selected.taskId]} /> : null}
                            {panel === "info" && selected?.status === "succeeded" && selectedScene?.version === 2 ? <InteriorSceneDelivery spec={selectedScene.spec} onError={(text) => message.error(text)} /> : null}
                            {panel === "history" && scenes.length ? (
                                <ul className="itd-scene-list thin-scrollbar" aria-label="这个项目的 3D 模型">
                                    {scenes.map((item) => (
                                        <li key={item.id}>
                                            <button type="button" disabled={busy} className={cn("itd-scene-card", item.id === selected?.id && "is-active")} aria-pressed={item.id === selected?.id} onClick={() => setSelectedId(item.id)}>
                                                <strong>{sceneTitle(item)}</strong>
                                                <span>{item.status === "pending" ? STAGE_LABELS[item.stage || "plan"] : item.status === "failed" ? "失败" : item.stats || `${item.objectCount || 0} 个物体`}</span>
                                                <small>{[item.instruction ? "改过一版" : SCENE_SCOPES.find((scope) => scope.value === item.scope)?.label, formatTime(item.createdAt)].filter(Boolean).join(" · ")}</small>
                                            </button>
                                            <button type="button" className="itd-scene-card-remove" aria-label={`删除「${sceneTitle(item)}」`} disabled={busy} onClick={() => remove(item)}>
                                                <Trash2 className="size-3.5" aria-hidden />
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            ) : null}
                        </aside>
                    ) : null}
                </div>
            </section>
        </div>
    );
}
