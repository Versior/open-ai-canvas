import { App, Form, Input, Radio, Select, Tooltip } from "antd";
import { FolderPlus, PencilLine, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WorkspacePage } from "@/components/layout/workspace-page";
import { WorkspaceErrorState, WorkspaceLoadingState } from "@/components/layout/workspace-state";
import { SegmentedControl } from "@/components/ui/base/segmented-control";
import { AppModal } from "@/components/ui/product/app-modal";
import { downloadBrowserMedia } from "@/services/browser-download";
import { resourceStorageKey } from "@/services/api/resources";
import { generateInterior, getInteriorCatalog, type InteriorCatalog, type InteriorMode, type InteriorProjectKind, type InteriorRound, type InteriorRoundItem, type InteriorSurface } from "@/services/api/interior";
import { useEffectiveConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { InteriorBoard, InteriorViewer, type InteriorOutputTarget } from "./interior-board";
import { InteriorComposer, interiorCountLimit, interiorDraftProblem, uploadInteriorImage, visibleInteriorModes, type InteriorDraft, type InteriorUpload } from "./interior-composer";
import { interiorDownloadName, interiorImageModelOptions, interiorInitialModel, interiorModelRef, newInteriorId } from "./interior-models";
import { InteriorSceneStudio, type InteriorRenderHandoff, type InteriorSceneHandoff } from "./interior-scene-studio";
import { InteriorUnsavedError, useInteriorProjects, type InteriorSaveState } from "./use-interior-project";
import { useInteriorTasks } from "./use-interior-tasks";
import { InteriorRenovation } from "./interior-renovation";
import { availableInteriorTasks, InteriorNavigator, type InteriorWorkspace } from "./interior-navigator";
import { DEFAULT_RENOVATION, renovationProblem, type RenovationSpec } from "@/lib/interior/renovation";
import "./interior.css";

const SURFACE_KEY = "interior:surface";
const WORKSPACE_KEY = "interior:workspace";
const TEXT_EDIT_MODE = "text-edit";
/** 3D 模型截图出效果图时用的出图方式（白模渲染）。 */
const SKETCH_RENDER_MODE = "sketch-render";
const DOWNLOAD_GAP_MS = 400;
const SAVE_LABEL: Record<InteriorSaveState, string> = { saved: "已保存", saving: "保存中…", error: "保存失败，点击重试" };

function errorText(error: unknown, fallback: string) {
    return error instanceof Error && error.message ? error.message : fallback;
}

function initialSurface(catalog: InteriorCatalog): InteriorSurface {
    if (!catalog.settings.allowSurfaceSwitch) return catalog.settings.defaultSurface;
    const stored = window.localStorage.getItem(SURFACE_KEY);
    return stored === "quick" || stored === "pro" ? stored : catalog.settings.defaultSurface;
}

function defaultParams(mode: InteriorMode) {
    return Object.fromEntries(mode.params.map((param) => [param.key, param.default]));
}

/** 沿用旧轮次的参数，只保留当前出图方式里仍然存在的参数和选项。 */
function reusableParams(mode: InteriorMode, previous: Record<string, string>) {
    return Object.fromEntries(mode.params.map((param) => [param.key, param.options.some((option) => option.value === previous[param.key]) ? previous[param.key] : param.default]));
}

function emptyDraft(mode: InteriorMode | undefined, modelValue: string): InteriorDraft {
    return { modeId: mode?.id || "", roomKey: "", styleKeys: [], params: mode ? defaultParams(mode) : {}, notes: "", count: 1, size: "auto", quality: "auto", modelValue, source: null, references: [] };
}

function surfaceFor(mode: InteriorMode, current: InteriorSurface): InteriorSurface {
    if (mode.audience === "both" || mode.audience === current) return current;
    return mode.audience;
}

function delay(ms: number) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
}

type ProjectDialog = { mode: "create" | "rename"; name: string; kind: InteriorProjectKind } | null;

/** 效果图（生图）和 3D 模型（文本模型搭三维场景）共用项目，页面上切换。 */
function initialWorkspace(): InteriorWorkspace {
    const value = window.localStorage.getItem(WORKSPACE_KEY);
    return value === "scene" || value === "materials" ? value : "images";
}

/** 室内设计：房间照片、毛坯、线稿出装修效果图；快速出图给业主，专业模式给设计师和装企。 */
export default function InteriorPage() {
    const { message, modal } = App.useApp();
    const user = useUserStore((state) => state.user);
    const config = useEffectiveConfig();
    const [catalog, setCatalog] = useState<InteriorCatalog | null>(null);
    const [catalogError, setCatalogError] = useState("");
    const [surface, setSurface] = useState<InteriorSurface>("quick");
    const [draft, setDraft] = useState<InteriorDraft>(() => emptyDraft(undefined, ""));
    const [busy, setBusy] = useState(false);
    const [submitError, setSubmitError] = useState("");
    const [viewing, setViewing] = useState<InteriorOutputTarget | null>(null);
    const [dialog, setDialog] = useState<ProjectDialog>(null);
    const [dialogBusy, setDialogBusy] = useState(false);
    const [downloadingRound, setDownloadingRound] = useState("");
    const [workspace, setWorkspace] = useState<InteriorWorkspace>(initialWorkspace);
    const [useMaterials, setUseMaterials] = useState(false);
    // 效果图带去 3D 模型时的预填内容；3D 模型页用完就清掉。
    const [sceneHandoff, setSceneHandoff] = useState<InteriorSceneHandoff | null>(null);
    // 本地预览用的 blob 地址，离开页面时统一释放。
    const previewUrls = useRef(new Set<string>());

    const projects = useInteriorProjects(user?.id || "");
    const { current } = projects;
    const tasks = useInteriorTasks(current, projects.update);

    const modelOptions = useMemo(() => interiorImageModelOptions(config), [config]);
    const preferredModel = useMemo(() => {
        const configured = config.imageModel || config.model;
        return modelOptions.find((item) => item.value === configured)?.value || modelOptions[0]?.value || "";
    }, [config.imageModel, config.model, modelOptions]);

    const modes = useMemo(() => (catalog ? visibleInteriorModes(catalog, surface) : []), [catalog, surface]);
    const mode = modes.find((item) => item.id === draft.modeId);
    const siteDefault = catalog?.settings.defaultModel;

    const loadCatalog = useCallback(async () => {
        setCatalogError("");
        try {
            const next = await getInteriorCatalog();
            const nextSurface = initialSurface(next);
            setCatalog(next);
            setSurface(nextSurface);
            setDraft((value) => (value.modeId ? value : emptyDraft(visibleInteriorModes(next, nextSurface)[0], "")));
        } catch (error) {
            setCatalogError(errorText(error, "室内设计目录读取失败"));
        }
    }, []);

    useEffect(() => {
        void loadCatalog();
    }, [loadCatalog]);

    // 模型目录可能比室内设计目录晚到；草稿还没有模型时按推荐规则补上。
    useEffect(() => {
        if (draft.modelValue || !modelOptions.length) return;
        const next = mode ? interiorInitialModel(config, mode, siteDefault, preferredModel, surface) : preferredModel;
        if (next) setDraft((value) => (value.modelValue ? value : { ...value, modelValue: next }));
    }, [config, draft.modelValue, mode, modelOptions.length, preferredModel, siteDefault, surface]);

    useEffect(() => {
        const urls = previewUrls.current;
        return () => {
            for (const url of urls) URL.revokeObjectURL(url);
            urls.clear();
        };
    }, []);

    const changeWorkspace = (next: InteriorWorkspace) => {
        setWorkspace(next);
        window.localStorage.setItem(WORKSPACE_KEY, next);
    };

    const patchDraft = useCallback((patch: Partial<InteriorDraft>) => {
        setSubmitError("");
        setDraft((value) => ({ ...value, ...patch }));
    }, []);

    // targetSurface 显式传入：切换交互模式时 setSurface 还没生效，不能读闭包里的旧值。
    const selectMode = useCallback(
        (next: InteriorMode, targetSurface: InteriorSurface = surface) => {
            if (!catalog) return;
            const limit = interiorCountLimit(catalog, next);
            const hasReference = next.slots.some((slot) => slot.key === "reference");
            setUseMaterials(false);
            const usesRoom = next.requiresRoom || next.requiresStyle;
            setSubmitError("");
            setDraft((value) => ({
                ...value,
                modeId: next.id,
                params: defaultParams(next),
                roomKey: usesRoom ? value.roomKey : "",
                styleKeys: next.requiresStyle ? value.styleKeys : [],
                references: hasReference ? value.references : [],
                count: Math.min(value.count, limit),
                modelValue: interiorInitialModel(config, next, catalog.settings.defaultModel, value.modelValue || preferredModel, targetSurface),
            }));
        },
        [catalog, config, preferredModel, surface],
    );

    const changeSurface = (next: InteriorSurface) => {
        if (!catalog) return;
        setSurface(next);
        window.localStorage.setItem(SURFACE_KEY, next);
        const available = visibleInteriorModes(catalog, next);
        const kept = available.find((item) => item.id === draft.modeId);
        // 出图方式不变也要按新模式重新预选模型（快速出图跟推荐走，专业模式保留用户的选择）。
        if (kept || available[0]) selectMode(kept || available[0], next);
    };

    const openDesignTask = (next: InteriorMode) => {
        if (!catalog || !availableInteriorTasks(catalog, surface).some((mode) => mode.id === next.id)) {
            message.error("当前交互模式不支持该出图方式，请联系管理员调整模式设置");
            return false;
        }
        const nextSurface = surfaceFor(next, surface);
        setSurface(nextSurface);
        window.localStorage.setItem(SURFACE_KEY, nextSurface);
        selectMode(next, nextSurface);
        return true;
    };

    const upload = useCallback(async (file: File, apply: (value: InteriorUpload | null) => void) => {
        const previewUrl = URL.createObjectURL(file);
        previewUrls.current.add(previewUrl);
        apply({ resourceId: "", name: file.name, uploading: true, previewUrl });
        try {
            const image = await uploadInteriorImage(file);
            apply({ ...image, name: file.name, previewUrl });
        } catch (error) {
            apply({ resourceId: "", name: file.name, previewUrl, error: errorText(error, "上传失败") });
        }
    }, []);

    const pickSource = (file: File) => void upload(file, (source) => setDraft((value) => ({ ...value, source })));
    const pickReference = (file: File) => void upload(file, (reference) => setDraft((value) => ({ ...value, references: reference ? [reference] : [] })));

    // Ctrl+V 粘贴图片：没有原图时填原图；已有原图且出图方式要参考图时填参考图。
    const pasteRef = useRef<(file: File) => boolean>(() => false);
    pasteRef.current = (file) => {
        if (busy || !mode || workspace !== "images") return false;
        const needsReference = mode.slots.some((slot) => slot.key === "reference") && !draft.references.length;
        if (draft.source && needsReference) pickReference(file);
        else pickSource(file);
        return true;
    };
    useEffect(() => {
        const onPaste = (event: ClipboardEvent) => {
            const target = event.target instanceof Element ? event.target : null;
            // 弹窗里的粘贴交给弹窗；在输入框里粘贴文字（Office 复制的文字会同时带一张位图）不当成图片。
            if (target?.closest(".ant-modal-wrap")) return;
            if (target?.closest("input, textarea, [contenteditable]") && event.clipboardData?.types.includes("text/plain")) return;
            const file = Array.from(event.clipboardData?.files || []).find((item) => item.type.startsWith("image/"));
            if (file && pasteRef.current(file)) event.preventDefault();
        };
        window.addEventListener("paste", onPaste);
        return () => window.removeEventListener("paste", onPaste);
    }, []);

    /** 当前项目存不上时询问是否放弃；保存失败多半是网络问题，先给重试的机会。 */
    const confirmDiscard = (action: string, proceed: () => Promise<unknown>) => {
        modal.confirm({
            title: "当前项目有出图记录没保存成功",
            content: `可以先关掉这个提示，点项目栏的「保存失败，点击重试」。如果项目已在别的窗口删掉、怎么也存不上，可以放弃这些记录再${action}；生成的图片仍在资产里。`,
            okText: `放弃并${action}`,
            okButtonProps: { danger: true },
            cancelText: "先不切换",
            onOk: () => proceed().catch((error: unknown) => message.error(errorText(error, `${action}失败`))),
        });
    };

    const openProject = (id: string) => {
        void projects.open(id).catch((error: unknown) => {
            if (error instanceof InteriorUnsavedError) confirmDiscard("切换", () => projects.open(id, true));
            else message.error(errorText(error, "切换项目失败"));
        });
    };

    const ensureProject = async () => {
        if (current) return current;
        return projects.create(surface === "pro" ? "未命名方案" : "我的家", surface === "pro" ? "client" : "home");
    };

    const submit = async () => {
        if (!catalog || !mode || !draft.source || busy) return;
        const professional = useMaterials ? current?.document.professional : undefined;
        const problem = (professional && renovationProblem(professional)) || interiorDraftProblem(draft, mode, surface, config, siteDefault);
        if (problem) {
            setSubmitError(problem);
            return;
        }
        setBusy(true);
        setSubmitError("");
        try {
            const project = await ensureProject();
            const roundId = newInteriorId();
            const room = catalog.rooms.find((item) => item.key === draft.roomKey);
            const sourceRef = { resourceId: draft.source.resourceId, ...(draft.source.width ? { width: draft.source.width } : {}), ...(draft.source.height ? { height: draft.source.height } : {}) };
            const references = draft.references.filter((item) => item.resourceId).map((item) => ({ resourceId: item.resourceId }));
            const model = interiorModelRef(config, draft.modelValue);
            const notes = draft.notes.trim();
            // 比例和画质只在专业模式里显示，快速出图不提交，避免带上切换前的旧选择。
            const size = surface === "pro" && draft.size !== "auto" ? draft.size : "";
            const result = await generateInterior({
                ...(professional ? { professional } : {}),
                surface,
                modeId: mode.id,
                ...(draft.roomKey ? { roomKey: draft.roomKey } : {}),
                ...(mode.requiresStyle ? { styleKeys: draft.styleKeys } : {}),
                params: draft.params,
                ...(notes ? { notes } : {}),
                sourceResourceId: sourceRef.resourceId,
                ...(references.length ? { referenceResourceIds: references.map((item) => item.resourceId) } : {}),
                count: draft.count,
                ...(size ? { size } : {}),
                ...(surface === "pro" && draft.quality !== "auto" ? { quality: draft.quality } : {}),
                ...(model ? { model } : {}),
                projectId: project.id,
                roundId,
            });
            const round: InteriorRound = {
                ...(professional ? { professional } : {}),
                id: roundId,
                createdAt: new Date().toISOString(),
                surface,
                modeKey: mode.key,
                modeName: mode.name,
                ...(room ? { roomKey: room.key, roomName: room.name } : {}),
                params: result.params,
                ...(notes ? { notes } : {}),
                count: result.count,
                ...(size ? { size } : {}),
                model: result.model.label || result.model.model,
                source: sourceRef,
                references,
                items: result.items.map((item): InteriorRoundItem => ({
                    id: newInteriorId(),
                    ...(item.styleKey ? { styleKey: item.styleKey } : {}),
                    ...(item.styleName ? { styleName: item.styleName } : {}),
                    ...(item.task ? { taskId: item.task.id } : {}),
                    status: item.task ? "pending" : "failed",
                    ...(item.error ? { error: item.error } : {}),
                    outputs: [],
                })),
            };
            projects.update(project.id, (document) => ({ ...document, rounds: [round, ...document.rounds] }));
            window.dispatchEvent(new CustomEvent("wallet:updated"));
            const failed = result.items.filter((item) => item.error).length;
            if (failed) message.warning(`${failed} 个风格没有提交成功，原因见出图记录`);
        } catch (error) {
            setSubmitError(errorText(error, "提交失败，请稍后重试"));
        } finally {
            setBusy(false);
        }
    };

    const download = (target: InteriorOutputTarget) => {
        void downloadBrowserMedia({ fileName: interiorDownloadName(target.round, target.item, target.index), storageKey: resourceStorageKey(target.output.resourceId) }).catch((error: unknown) => message.error(errorText(error, "下载失败")));
    };

    /** 整轮下载：逐张交给浏览器，中间留一点间隔，避免浏览器把连续下载当成弹窗拦掉。 */
    const downloadRound = async (round: InteriorRound) => {
        const targets = round.items.flatMap((item) => (item.status === "succeeded" ? item.outputs.map((output, index) => ({ round, item, output, index })) : []));
        if (!targets.length || downloadingRound) return;
        setDownloadingRound(round.id);
        try {
            for (const [index, target] of targets.entries()) {
                if (index) await delay(DOWNLOAD_GAP_MS);
                await downloadBrowserMedia({ fileName: interiorDownloadName(target.round, target.item, target.index), storageKey: resourceStorageKey(target.output.resourceId) });
            }
        } catch (error) {
            message.error(errorText(error, "下载失败"));
        } finally {
            setDownloadingRound("");
        }
    };

    /** 把效果图当作新原图；有「文字微调」模式时直接切过去，方便一句话改局部。 */
    const continueFrom = (target: InteriorOutputTarget) => {
        setViewing(null);
        const editMode = modes.find((item) => item.key === TEXT_EDIT_MODE);
        if (editMode) selectMode(editMode);
        setDraft((value) => ({ ...value, source: { ...target.output, name: "效果图" }, notes: editMode ? "" : value.notes }));
        message.info(editMode ? "已把这张图作为原图，写下要改的地方就能生成" : "已把这张图作为原图");
    };

    /** 用这张效果图生成 3D 模型：切到 3D 模型页并预填参考图、空间和风格；不自动生成（要计费）。 */
    const to3D = (target: InteriorOutputTarget) => {
        setViewing(null);
        setSceneHandoff({
            id: newInteriorId(),
            image: target.output,
            ...(target.round.roomKey ? { roomKey: target.round.roomKey } : {}),
            ...(target.item.styleKey ? { styleKey: target.item.styleKey } : {}),
            ...(target.round.notes ? { description: target.round.notes } : {}),
        });
        changeWorkspace("scene");
    };
    const clearSceneHandoff = useCallback(() => setSceneHandoff(null), []);

    /** 3D 模型截图出效果图：截图当白模原图，切到「线稿/白模渲染」并带上空间、风格和方案分析里的要求。 */
    const renderFrom3D = (handoff: InteriorRenderHandoff) => {
        if (!catalog) return;
        const target = catalog.modes.find((item) => item.key === SKETCH_RENDER_MODE);
        const targetSurface = target ? surfaceFor(target, surface) : surface;
        const usable = target && (targetSurface === surface || catalog.settings.allowSurfaceSwitch) && visibleInteriorModes(catalog, targetSurface).some((item) => item.id === target.id);
        changeWorkspace("images");
        if (usable) {
            if (targetSurface !== surface) {
                setSurface(targetSurface);
                window.localStorage.setItem(SURFACE_KEY, targetSurface);
            }
            selectMode(target, targetSurface);
        }
        const enabledStyles = new Set(catalog.styles.map((item) => item.key));
        const enabledRooms = new Set(catalog.rooms.map((item) => item.key));
        setDraft((value) => ({
            ...value,
            source: { ...handoff.image, name: "3D 模型截图" },
            styleKeys: handoff.styleKey && enabledStyles.has(handoff.styleKey) ? [handoff.styleKey] : value.styleKeys,
            roomKey: handoff.roomKey && enabledRooms.has(handoff.roomKey) ? handoff.roomKey : value.roomKey,
            notes: handoff.notes || value.notes,
        }));
        message.info(usable ? "已把模型截图作为白模原图，确认风格后点生成" : "已把模型截图作为原图；当前没有开放「线稿/白模渲染」，请选一个出图方式");
    };

    /** 用某一轮的设置回填左侧表单；styleKey 只重试这一个风格。不自动提交，用户确认后再点生成。 */
    const reuseRound = (round: InteriorRound, styleKey?: string) => {
        if (!catalog || busy) return;
        const target = catalog.modes.find((item) => item.key === round.modeKey);
        if (!target) {
            message.warning("这一轮用的出图方式已经下架");
            return;
        }
        if (current && round.professional) projects.update(current.id, (document) => ({ ...document, professional: round.professional }));
        setUseMaterials(Boolean(round.professional));
        // 优先回到这一轮当时用的交互模式，比例、画质和模型才和当时一致。
        const roundSurface = catalog.settings.allowSurfaceSwitch && (target.audience === "both" || target.audience === round.surface) ? round.surface : surface;
        const nextSurface = surfaceFor(target, roundSurface);
        if (nextSurface !== surface) {
            if (!catalog.settings.allowSurfaceSwitch) {
                message.warning("当前模式下不能使用这个出图方式");
                return;
            }
            setSurface(nextSurface);
            window.localStorage.setItem(SURFACE_KEY, nextSurface);
        }
        const enabledStyles = new Set(catalog.styles.map((item) => item.key));
        const previousStyles = styleKey ? [styleKey] : round.items.map((item) => item.styleKey || "");
        const styleKeys = target.requiresStyle ? previousStyles.filter((key) => enabledStyles.has(key)).slice(0, Math.max(1, catalog.settings.maxStylesPerRun)) : [];
        const hasReference = target.slots.some((slot) => slot.key === "reference");
        const roomKey = round.roomKey && catalog.rooms.some((item) => item.key === round.roomKey) ? round.roomKey : "";
        setSubmitError("");
        setDraft((value) => ({
            ...value,
            modeId: target.id,
            roomKey,
            styleKeys,
            params: reusableParams(target, round.params),
            notes: round.notes || "",
            count: Math.min(Math.max(1, round.count), interiorCountLimit(catalog, target)),
            size: round.size || "auto",
            source: { ...round.source, name: "原图" },
            references: hasReference ? round.references.map((item) => ({ ...item, name: "参考图" })) : [],
            modelValue: interiorInitialModel(config, target, catalog.settings.defaultModel, value.modelValue || preferredModel, nextSurface),
        }));
        message.info(styleKey ? "已填好这个风格的设置，确认后点生成" : "已填好这一轮的设置，确认后点生成");
    };

    const deleteRound = (round: InteriorRound) => {
        if (!current) return;
        modal.confirm({
            title: "删除这一轮出图记录？",
            content: "只删除记录，生成的图片仍保留在资产里。",
            okText: "删除",
            okButtonProps: { danger: true },
            cancelText: "取消",
            onOk: () => projects.removeRound(current.id, round.id),
        });
    };

    const deleteProject = () => {
        if (!current) return;
        modal.confirm({
            title: `删除项目「${current.name}」？`,
            content: "只删除项目和出图记录，生成的图片仍保留在资产里。",
            okText: "删除",
            okButtonProps: { danger: true },
            cancelText: "取消",
            onOk: () => projects.remove(current.id).catch((error: unknown) => message.error(errorText(error, "删除失败"))),
        });
    };

    const submitDialog = async () => {
        if (!dialog) return;
        const name = dialog.name.trim();
        if (!name) {
            message.warning("请填写项目名称");
            return;
        }
        setDialogBusy(true);
        const { kind } = dialog;
        try {
            if (dialog.mode === "create") await projects.create(name, kind);
            else await projects.rename(name);
            setDialog(null);
        } catch (error) {
            if (dialog.mode === "create" && error instanceof InteriorUnsavedError) {
                confirmDiscard("新建", async () => {
                    await projects.create(name, kind, true);
                    setDialog(null);
                });
            } else message.error(errorText(error, dialog.mode === "create" ? "新建项目失败" : "重命名失败"));
        } finally {
            setDialogBusy(false);
        }
    };

    if (catalogError) {
        return (
            <WorkspacePage>
                <WorkspaceErrorState title="无法打开室内设计" description={catalogError} onRetry={() => void loadCatalog()} />
            </WorkspacePage>
        );
    }
    if (!catalog) {
        return (
            <WorkspacePage>
                <WorkspaceLoadingState label="正在打开室内设计" rows={4} />
            </WorkspacePage>
        );
    }

    const projectBar = (
        <div className="itd-project-bar">
            <Select
                className="itd-project-select"
                value={current?.id}
                placeholder={projects.projects?.length ? "选择项目" : "第一次出图时自动新建项目"}
                options={(projects.projects || []).map((item) => ({ value: item.id, label: `${item.kind === "client" ? "客户 · " : ""}${item.name}` }))}
                onChange={(id: string) => openProject(id)}
                loading={projects.projectLoading}
                disabled={busy}
                aria-label="当前项目"
            />
            <Tooltip title="新建项目">
                <button type="button" className="itd-icon-button" aria-label="新建项目" disabled={busy} onClick={() => setDialog({ mode: "create", name: "", kind: surface === "pro" ? "client" : "home" })}>
                    <FolderPlus className="size-4" aria-hidden />
                </button>
            </Tooltip>
            {current ? (
                <>
                    <Tooltip title="重命名">
                        <button type="button" className="itd-icon-button" aria-label="重命名项目" onClick={() => setDialog({ mode: "rename", name: current.name, kind: current.kind })}>
                            <PencilLine className="size-4" aria-hidden />
                        </button>
                    </Tooltip>
                    <Tooltip title="删除项目">
                        <button type="button" className="itd-icon-button" aria-label="删除项目" disabled={busy} onClick={deleteProject}>
                            <Trash2 className="size-4" aria-hidden />
                        </button>
                    </Tooltip>
                    {projects.saveState === "error" ? (
                        <Tooltip title={projects.saveError}>
                            <button type="button" className="itd-save is-error" onClick={projects.retrySave}>
                                {SAVE_LABEL.error}
                            </button>
                        </Tooltip>
                    ) : (
                        <span className="itd-save" role="status">
                            {SAVE_LABEL[projects.saveState]}
                        </span>
                    )}
                </>
            ) : null}
        </div>
    );
    const workspaceSwitch = (
        <SegmentedControl<InteriorWorkspace>
            size="sm"
            ariaLabel="出图还是 3D 模型"
            value={workspace}
            onChange={changeWorkspace}
            disabled={busy}
            options={[
                { value: "images", label: "效果图" },
                { value: "scene", label: "3D 模型" },
                { value: "materials", label: "装修 / 石材" },
            ]}
        />
    );
    // 快速出图 / 专业模式只管效果图；3D 模型不分交互模式。
    const surfaceSwitch =
        catalog.settings.allowSurfaceSwitch && workspace === "images" ? (
            <SegmentedControl<InteriorSurface>
                size="sm"
                ariaLabel="交互模式"
                value={surface}
                onChange={changeSurface}
                disabled={busy}
                options={[
                    { value: "quick", label: "快速出图" },
                    { value: "pro", label: "专业模式" },
                ]}
            />
        ) : null;
    const boardHeader = (
        <header className="itd-board-head">
            {projectBar}
            <div className="itd-board-switches">
                {workspaceSwitch}
                {surfaceSwitch}
            </div>
        </header>
    );

    const navigator = (
        <InteriorNavigator
            catalog={catalog}
            surface={surface}
            workspace={workspace}
            modeId={draft.modeId}
            disabled={busy || projects.projectLoading}
            rounds={current?.document.rounds.length || 0}
            hasMaterial={Boolean(current?.document.professional)}
            sourceReady={Boolean(draft.source?.resourceId && !draft.source.uploading && !draft.source.error)}
            outputs={current?.document.rounds.flatMap((round) => round.items.flatMap((item) => item.outputs)).length || 0}
            sceneReady={Boolean(current?.document.scenes?.some((scene) => scene.sceneFile?.resourceId))}
            onWorkspace={changeWorkspace}
            onMode={openDesignTask}
        />
    );

    const projectDialog = (
        <AppModal
            open={Boolean(dialog)}
            title={dialog?.mode === "rename" ? "重命名项目" : "新建项目"}
            okText={dialog?.mode === "rename" ? "保存" : "新建"}
            cancelText="取消"
            confirmLoading={dialogBusy}
            onOk={() => void submitDialog()}
            onCancel={() => setDialog(null)}
        >
            {dialog ? (
                <Form layout="vertical" onFinish={() => void submitDialog()}>
                    <Form.Item label="项目名称" required>
                        <Input autoFocus maxLength={120} value={dialog.name} placeholder={dialog.kind === "client" ? "例如：张女士 · 滨江花园 3-2-1801" : "例如：我的新家"} onChange={(event) => setDialog({ ...dialog, name: event.target.value })} />
                    </Form.Item>
                    {dialog.mode === "create" ? (
                        <Form.Item label="项目类型">
                            <Radio.Group value={dialog.kind} onChange={(event) => setDialog({ ...dialog, kind: event.target.value as InteriorProjectKind })}>
                                <Radio value="home">我的房子</Radio>
                                <Radio value="client">客户方案</Radio>
                            </Radio.Group>
                        </Form.Item>
                    ) : null}
                </Form>
            ) : null}
        </AppModal>
    );

    if (workspace === "materials") {
        const createMaterialPlan = async () => {
            try {
                const project = await ensureProject();
                projects.update(project.id, (document) => ({ ...document, professional: { ...DEFAULT_RENOVATION } }));
            } catch (error) {
                message.error(errorText(error, "材料方案保存失败"));
            }
        };
        const renderMaterials = (professional: RenovationSpec) => {
            const next = catalog.modes.find((item) => item.enabled && item.key === (professional.scope === "room" ? (professional.stage === "new" ? "rough-to-finished" : "style-redesign") : "text-edit"));
            if (!next) {
                message.error("对应的材料出图方式尚未启用，请联系管理员启用局部微调或风格改造");
                return;
            }
            if (!openDesignTask(next)) return;
            setUseMaterials(true);
            if (current) projects.update(current.id, (document) => ({ ...document, professional }));
            changeWorkspace("images");
            message.info("材料参数与实板照片会随生成提交；请上传空间原图并确认出图设置");
        };
        return (
            <WorkspacePage scroll={false} fluid className="itd-page">
                <section className="itd-board">
                    {boardHeader}
                    <div className="itd-board-scroll thin-scrollbar">
                        {navigator}
                        <InteriorRenovation
                            key={current?.id || "new"}
                            value={current?.document.professional}
                            disabled={busy || projects.projectLoading}
                            onCreate={() => void createMaterialPlan()}
                            onChange={(professional) => {
                                if (current) projects.update(current.id, (document) => ({ ...document, professional }));
                            }}
                            onRender={renderMaterials}
                        />
                    </div>
                </section>
                {projectDialog}
            </WorkspacePage>
        );
    }

    if (workspace === "scene") {
        return (
            <WorkspacePage scroll={false} fluid className="itd-page">
                <InteriorSceneStudio
                    catalog={catalog}
                    config={config}
                    project={current}
                    header={
                        <>
                            {boardHeader}
                            {navigator}
                        </>
                    }
                    ensureProject={ensureProject}
                    update={projects.update}
                    saveProject={projects.ensureSaved}
                    onBusyChange={setBusy}
                    removeScene={projects.removeScene}
                    handoff={sceneHandoff}
                    onHandoffUsed={clearSceneHandoff}
                    onRender={renderFrom3D}
                />
                {projectDialog}
            </WorkspacePage>
        );
    }

    return (
        <WorkspacePage scroll={false} fluid className="itd-page">
            <div className="itd-shell">
                <InteriorComposer
                    professional={current?.document.professional}
                    useProfessional={useMaterials}
                    onUseProfessional={setUseMaterials}
                    catalog={catalog}
                    config={config}
                    surface={surface}
                    draft={draft}
                    busy={busy}
                    error={submitError}
                    onChange={patchDraft}
                    onModeChange={selectMode}
                    onPickSource={pickSource}
                    onPickReference={pickReference}
                    onSubmit={() => void submit()}
                />
                <section className="itd-board" aria-label="出图记录">
                    {boardHeader}
                    <div className="itd-board-scroll thin-scrollbar">
                        {navigator}
                        {projects.listError ? <WorkspaceErrorState compact title="项目列表读取失败" description={projects.listError} onRetry={() => void projects.reloadList()} /> : null}
                        {projects.projectError ? <WorkspaceErrorState compact title="项目读取失败" description={projects.projectError} onRetry={() => (current ? openProject(current.id) : void projects.reloadList())} /> : null}
                        {projects.projectLoading && !current ? (
                            <WorkspaceLoadingState label="正在读取项目" rows={2} />
                        ) : (
                            <InteriorBoard
                                document={current?.document || { version: 1, rounds: [] }}
                                stalled={tasks.stalled}
                                busy={busy}
                                downloadingRound={downloadingRound}
                                onRetryWatch={tasks.retry}
                                onOpen={setViewing}
                                onDownload={download}
                                onDownloadRound={(round) => void downloadRound(round)}
                                onContinue={continueFrom}
                                onTo3D={to3D}
                                onReuse={reuseRound}
                                onDeleteRound={deleteRound}
                            />
                        )}
                    </div>
                </section>
            </div>
            <InteriorViewer target={viewing} onClose={() => setViewing(null)} onDownload={download} onContinue={continueFrom} onTo3D={to3D} />
            {projectDialog}
        </WorkspacePage>
    );
}
