import { App, Form, Input, Radio, Select, Tooltip } from "antd";
import { FolderPlus, PencilLine, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
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
import { interiorDownloadName, interiorImageModelOptions, interiorModelRef, newInteriorId } from "./interior-models";
import { useInteriorProjects, type InteriorSaveState } from "./use-interior-project";
import { useInteriorTasks } from "./use-interior-tasks";
import "./interior.css";

const SURFACE_KEY = "interior:surface";
const TEXT_EDIT_MODE = "text-edit";
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

function emptyDraft(mode: InteriorMode | undefined, modelValue: string): InteriorDraft {
    return { modeId: mode?.id || "", roomKey: "", styleKeys: [], params: mode ? defaultParams(mode) : {}, notes: "", count: 1, size: "auto", quality: "auto", modelValue, source: null, references: [] };
}

type ProjectDialog = { mode: "create" | "rename"; name: string; kind: InteriorProjectKind } | null;

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

    const projects = useInteriorProjects(user?.id || "");
    const { current } = projects;
    const tasks = useInteriorTasks(current, projects.update);

    const modelOptions = useMemo(() => interiorImageModelOptions(config), [config]);
    const preferredModel = useMemo(() => {
        const configured = config.imageModel || config.model;
        return modelOptions.find((item) => item.value === configured)?.value || modelOptions[0]?.value || "";
    }, [config.imageModel, config.model, modelOptions]);

    const loadCatalog = useCallback(async () => {
        setCatalogError("");
        try {
            const next = await getInteriorCatalog();
            const nextSurface = initialSurface(next);
            setCatalog(next);
            setSurface(nextSurface);
            setDraft((value) => (value.modeId ? value : emptyDraft(visibleInteriorModes(next, nextSurface)[0], preferredModel)));
        } catch (error) {
            setCatalogError(errorText(error, "室内设计目录读取失败"));
        }
    }, [preferredModel]);

    useEffect(() => {
        void loadCatalog();
        // 目录只在进入页面时读取；模型目录稍后到达时由下面的 effect 补上默认模型。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (!draft.modelValue && preferredModel) setDraft((value) => ({ ...value, modelValue: preferredModel }));
    }, [draft.modelValue, preferredModel]);

    const modes = useMemo(() => (catalog ? visibleInteriorModes(catalog, surface) : []), [catalog, surface]);
    const mode = modes.find((item) => item.id === draft.modeId);

    const patchDraft = useCallback((patch: Partial<InteriorDraft>) => {
        setSubmitError("");
        setDraft((value) => ({ ...value, ...patch }));
    }, []);

    const selectMode = useCallback(
        (next: InteriorMode) => {
            if (!catalog) return;
            const limit = interiorCountLimit(catalog, next);
            const hasReference = next.slots.some((slot) => slot.key === "reference");
            setSubmitError("");
            setDraft((value) => ({
                ...value,
                modeId: next.id,
                params: defaultParams(next),
                styleKeys: next.requiresStyle ? value.styleKeys : [],
                references: hasReference ? value.references : [],
                count: Math.min(value.count, limit),
            }));
        },
        [catalog],
    );

    const changeSurface = (next: InteriorSurface) => {
        if (!catalog) return;
        setSurface(next);
        window.localStorage.setItem(SURFACE_KEY, next);
        const available = visibleInteriorModes(catalog, next);
        if (!available.some((item) => item.id === draft.modeId) && available[0]) selectMode(available[0]);
    };

    const upload = useCallback(async (file: File, apply: (value: InteriorUpload | null) => void) => {
        const previewUrl = URL.createObjectURL(file);
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

    const ensureProject = async () => {
        if (current) return current;
        return projects.create(surface === "pro" ? "未命名方案" : "我的家", surface === "pro" ? "client" : "home");
    };

    const submit = async () => {
        if (!catalog || !mode || !draft.source || busy) return;
        const problem = interiorDraftProblem(draft, mode, surface, config);
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
            const result = await generateInterior({
                surface,
                modeId: mode.id,
                ...(draft.roomKey ? { roomKey: draft.roomKey } : {}),
                ...(mode.requiresStyle ? { styleKeys: draft.styleKeys } : {}),
                params: draft.params,
                ...(draft.notes.trim() ? { notes: draft.notes.trim() } : {}),
                sourceResourceId: sourceRef.resourceId,
                ...(references.length ? { referenceResourceIds: references.map((item) => item.resourceId) } : {}),
                count: draft.count,
                ...(draft.size !== "auto" ? { size: draft.size } : {}),
                ...(surface === "pro" && draft.quality !== "auto" ? { quality: draft.quality } : {}),
                ...(model ? { model } : {}),
                projectId: project.id,
                roundId,
            });
            const round: InteriorRound = {
                id: roundId,
                createdAt: new Date().toISOString(),
                surface,
                modeKey: mode.key,
                modeName: mode.name,
                ...(room ? { roomKey: room.key, roomName: room.name } : {}),
                params: result.params,
                ...(draft.notes.trim() ? { notes: draft.notes.trim() } : {}),
                count: result.count,
                ...(draft.size !== "auto" ? { size: draft.size } : {}),
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

    /** 把效果图当作新原图；有「文字微调」模式时直接切过去，方便一句话改局部。 */
    const continueFrom = (target: InteriorOutputTarget) => {
        setViewing(null);
        const editMode = modes.find((item) => item.key === TEXT_EDIT_MODE);
        if (editMode) selectMode(editMode);
        setDraft((value) => ({ ...value, source: { ...target.output, name: "效果图" }, notes: editMode ? "" : value.notes }));
        message.info(editMode ? "已把这张图作为原图，写下要改的地方就能生成" : "已把这张图作为原图");
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
        try {
            if (dialog.mode === "create") await projects.create(name, dialog.kind);
            else await projects.rename(name);
            setDialog(null);
        } catch (error) {
            message.error(errorText(error, dialog.mode === "create" ? "新建项目失败" : "重命名失败"));
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

    return (
        <WorkspacePage scroll={false} className="itd-page">
            <div className="itd-shell">
                <InteriorComposer
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
                    <header className="itd-board-head">
                        <div className="itd-project-bar">
                            <Select
                                className="itd-project-select"
                                value={current?.id}
                                placeholder={projects.projects?.length ? "选择项目" : "第一次出图时自动新建项目"}
                                options={(projects.projects || []).map((item) => ({ value: item.id, label: `${item.kind === "client" ? "客户 · " : ""}${item.name}` }))}
                                onChange={(id: string) => void projects.open(id)}
                                loading={projects.projectLoading}
                                disabled={busy}
                                aria-label="当前项目"
                            />
                            <Tooltip title="新建项目">
                                <button type="button" className="itd-icon-button" aria-label="新建项目" onClick={() => setDialog({ mode: "create", name: "", kind: surface === "pro" ? "client" : "home" })}>
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
                                        <button type="button" className="itd-icon-button" aria-label="删除项目" onClick={deleteProject}>
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
                        {catalog.settings.allowSurfaceSwitch ? (
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
                        ) : null}
                    </header>
                    <div className="itd-board-scroll thin-scrollbar">
                        {projects.listError ? <WorkspaceErrorState compact title="项目列表读取失败" description={projects.listError} onRetry={() => void projects.reloadList()} /> : null}
                        {projects.projectError ? <WorkspaceErrorState compact title="项目读取失败" description={projects.projectError} onRetry={() => (current ? void projects.open(current.id) : void projects.reloadList())} /> : null}
                        {projects.projectLoading && !current ? (
                            <WorkspaceLoadingState label="正在读取项目" rows={2} />
                        ) : (
                            <InteriorBoard document={current?.document || { version: 1, rounds: [] }} stalled={tasks.stalled} onRetryWatch={tasks.retry} onOpen={setViewing} onDownload={download} onContinue={continueFrom} onDeleteRound={deleteRound} />
                        )}
                    </div>
                </section>
            </div>
            <InteriorViewer target={viewing} onClose={() => setViewing(null)} onDownload={download} onContinue={continueFrom} />
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
        </WorkspacePage>
    );
}
