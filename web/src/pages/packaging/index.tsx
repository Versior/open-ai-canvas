import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useBlocker, useSearchParams } from "react-router";
import { Download, FolderOpen, LayoutPanelLeft, PackageOpen, Plus, Save, Settings2, X, Undo2, Redo2, Printer } from "lucide-react";
import { App } from "antd";
import { AppModal } from "@/components/ui/product/app-modal";
import { compilePackaging } from "@/lib/packaging/geometry";
import { downloadPackaging, packagingProjectZip } from "@/lib/packaging/delivery";
import { validatePackagingParameters } from "@/lib/packaging/types";
import { PackagingDieline } from "./packaging-dieline";
import { PackagingParametersPanel } from "./packaging-parameters";
import { PackagingViewport } from "./packaging-viewport";
import { usePackagingProject } from "./use-packaging-project";
import { PackagingProduction } from "./packaging-production";
import "./packaging.css";

export default function PackagingPage() {
    const state = usePackagingProject();
    const { modal } = App.useApp();
    const [search, setSearch] = useSearchParams();
    const [selected, setSelected] = useState("");
    const [history, setHistory] = useState(false);
    const [parameters, setParameters] = useState(false);
    const [production, setProduction] = useState(false);
    const [split, setSplit] = useState(50);
    const panels = useRef<HTMLDivElement>(null);
    const importer = useRef<HTMLInputElement>(null);
    const busy = state.status !== "ready";
    const blocker = useBlocker(({ currentLocation, nextLocation }) => state.dirty && currentLocation.pathname !== nextLocation.pathname);
    const doc = state.project?.document;
    const geometry = useMemo(() => {
        if (!doc) return { layout: undefined, error: "" };
        try {
            validatePackagingParameters(doc.parameters);
            return { layout: compilePackaging(doc), error: "" };
        } catch (e) {
            return { layout: undefined, error: e instanceof Error ? e.message : "结构参数无效" };
        }
    }, [doc?.parameters, doc?.template]);
    const restored = useRef(false);
    useEffect(() => {
        if (!state.catalog || restored.current) return;
        restored.current = true;
        const id = search.get("project");
        if (id) void state.load(id).catch((e: unknown) => state.setError(e instanceof Error ? e.message : "项目读取失败"));
    }, [state.catalog]);
    useEffect(() => {
        if (state.project?.id) setSearch({ project: state.project.id }, { replace: true });
    }, [state.project?.id]);
    useEffect(() => {
        if (!state.dirty) return;
        const warn = (e: BeforeUnloadEvent) => {
            e.preventDefault();
            e.returnValue = "";
        };
        window.addEventListener("beforeunload", warn);
        return () => window.removeEventListener("beforeunload", warn);
    }, [state.dirty]);
    useEffect(() => {
        if (blocker.state !== "blocked") return;
        modal.confirm({ title: "离开包装刀板", content: "当前编辑尚未保存，离开后将放弃这些修改。", okText: "放弃并离开", cancelText: "继续编辑", onOk: () => blocker.proceed(), onCancel: () => blocker.reset() });
    }, [blocker.state]);
    useEffect(() => {
        const shortcut = (e: KeyboardEvent) => {
            if (busy || !(e.metaKey || e.ctrlKey) || e.altKey || !(e.target instanceof HTMLElement) || e.target.closest("input, textarea, select, [contenteditable='true'], [role='dialog']")) return;
            if (e.key.toLowerCase() === "z") {
                e.preventDefault();
                if (e.shiftKey) state.redo();
                if (!e.shiftKey) state.undo();
            }
            if (e.key.toLowerCase() === "y") {
                e.preventDefault();
                state.redo();
            }
        };
        window.addEventListener("keydown", shortcut);
        return () => window.removeEventListener("keydown", shortcut);
    }, [busy, state.undo, state.redo]);
    const execute = (operation: () => void | Promise<void>) => {
        void Promise.resolve()
            .then(operation)
            .catch((e: unknown) => state.setError(e instanceof Error ? e.message : "操作失败"));
    };
    const switchProject = (operation: () => void | Promise<void>) => {
        if (!state.dirty) {
            execute(operation);
            return;
        }
        modal.confirm({ title: "当前修改尚未保存", content: "切换后会放弃当前未保存的编辑。可先保存或另存副本。", okText: "放弃并切换", cancelText: "继续编辑", onOk: operation });
    };
    const changeTemplate = (id: string) => {
        const template = state.catalog!.templates.find((t) => t.id === id)!;
        const apply = () => {
            state.updateDocument((d) => ({ ...d, template: structuredClone(template), parameters: { ...template.defaults, thickness: d.material.thickness }, artworks: [], view: { ...d.view, fold: 1, open: 0 } }));
            setSelected("");
        };
        if (doc?.artworks.length) {
            modal.confirm({ title: "切换包装结构", content: "各面的结构与尺寸将更新，当前贴图会移出此方案。原上传素材仍保留。", okText: "切换结构", onOk: apply });
            return;
        }
        apply();
    };
    if (state.status === "loading")
        return (
            <div className="pkg-empty" role="status">
                正在读取包装刀板目录…
            </div>
        );
    if (!state.catalog || !doc || !state.project)
        return (
            <div className="pkg-empty">
                <PackageOpen size={32} />
                <h2>包装刀板</h2>
                <p>{state.error || "后台尚未提供启用的盒型和材料。"}</p>
                <button type="button" onClick={() => window.location.reload()}>
                    重新读取
                </button>
                {state.catalog ? (
                    <div className="pkg-project-list">
                        <p>已有包装项目</p>
                        {state.projects.map((p) => (
                            <button type="button" key={p.id} onClick={() => execute(() => state.load(p.id))}>
                                {p.name} · v{p.revision}
                            </button>
                        ))}
                        <div className="pkg-toolbar">
                            <button type="button" disabled={state.page <= 1} onClick={() => execute(() => state.loadPage(state.page - 1))}>
                                上一页
                            </button>
                            <span>共 {state.total} 个</span>
                            <button type="button" disabled={state.page * 30 >= state.total} onClick={() => execute(() => state.loadPage(state.page + 1))}>
                                下一页
                            </button>
                        </div>
                    </div>
                ) : null}
            </div>
        );
    return (
        <main className={`pkg-workbench ${parameters ? "show-parameters" : ""}`}>
            <div className="pkg-page-header">
                <div className="pkg-page-identity">
                    <PackageOpen size={22} />
                    <div>
                        <h1>包装刀板</h1>
                        <input aria-label="包装项目名称" maxLength={120} value={state.project.name} onChange={(e) => state.edit((p) => ({ ...p, name: e.target.value }), "project-name")} />
                    </div>
                </div>
                <span className="pkg-save-state">{state.status === "saving" ? "保存中" : state.dirty ? "有未保存修改" : state.project.id ? `已保存到服务器 · v${state.project.revision}` : "新方案"}</span>
                <div className="pkg-toolbar">
                    <button type="button" aria-label="撤销包装编辑" title="撤销 · Ctrl/Cmd+Z" disabled={busy || !state.canUndo} onClick={state.undo}>
                        <Undo2 size={16} />
                    </button>
                    <button type="button" aria-label="重做包装编辑" title="重做 · Ctrl/Cmd+Shift+Z" disabled={busy || !state.canRedo} onClick={state.redo}>
                        <Redo2 size={16} />
                    </button>
                    <button type="button" className="pkg-mobile-settings" onClick={() => setParameters((v) => !v)}>
                        <Settings2 size={16} />
                        参数
                    </button>
                    <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                            switchProject(() => {
                                state.newProject(state.catalog!.templates[0]);
                                setSearch({}, { replace: true });
                                setSelected("");
                            })
                        }
                    >
                        <Plus size={16} />
                        新建
                    </button>
                    <button type="button" onClick={() => setHistory(true)}>
                        <FolderOpen size={16} />
                        项目
                    </button>
                    <button type="button" disabled={busy} onClick={() => importer.current?.click()}>
                        导入
                    </button>
                    <button type="button" disabled={busy || !geometry.layout || !state.catalog.enabled} className="pkg-primary" onClick={() => execute(() => state.save())}>
                        <Save size={16} />
                        保存
                    </button>
                    <button type="button" disabled={busy || !geometry.layout || !state.catalog.enabled} onClick={() => execute(() => state.save(true))}>
                        另存
                    </button>
                </div>
            </div>
            {!state.catalog.enabled ? <div className="pkg-notice">包装刀板当前未开放写入。已有方案可查看和导出。</div> : null}
            {state.error ? (
                <div className="pkg-error" role="alert">
                    <span>{state.error}</span>
                    <button type="button" className="pkg-icon" aria-label="关闭错误提示" onClick={() => state.setError("")}>
                        <X size={16} />
                    </button>
                </div>
            ) : null}
            <div className="pkg-body">
                <PackagingParametersPanel
                    catalog={state.catalog}
                    document={doc}
                    layout={geometry.layout}
                    selected={selected}
                    onSelect={setSelected}
                    onDocument={state.updateDocument}
                    onTemplate={changeTemplate}
                    onUpload={(file, panelId, role) => execute(() => state.upload(file, panelId, role))}
                    busy={busy}
                />
                <div className="pkg-main">
                    <div className="pkg-workspace-toolbar">
                        <div className="pkg-toolbar">
                            {(
                                [
                                    ["split", "并排"],
                                    ["dieline", "刀版"],
                                    ["model", "3D"],
                                ] as const
                            ).map(([layout, label]) => (
                                <button type="button" key={layout} aria-pressed={doc.view.layout === layout} onClick={() => state.updateDocument((d) => ({ ...d, view: { ...d.view, layout } }))}>
                                    {layout === "split" ? <LayoutPanelLeft size={15} /> : null}
                                    {label}
                                </button>
                            ))}
                        </div>
                        <span>
                            {state.project.document.template.name} · {doc.parameters.length} × {doc.parameters.width} × {doc.parameters.height} mm
                        </span>
                        <button type="button" disabled={!geometry.layout || busy} onClick={() => setProduction(true)}>
                            <Printer size={15} />
                            生产试算
                        </button>
                        <button
                            type="button"
                            disabled={!geometry.layout || busy}
                            onClick={() =>
                                execute(async () => {
                                    if (doc.artworks.some((a) => !state.resources.has(a.resourceId))) throw new Error("图稿未加载完成，不能导出完整方案包");
                                    const used = new Map([...state.resources].filter(([id]) => doc.artworks.some((a) => a.resourceId === id)));
                                    downloadPackaging(await packagingProjectZip(state.project!.name, doc, used, geometry.layout!), state.project!.name, "zip");
                                })
                            }
                        >
                            <Download size={15} />
                            方案包
                        </button>
                    </div>
                    {geometry.error ? (
                        <div className="pkg-empty" role="alert">
                            <p>{geometry.error}</p>
                            <span>修正左侧参数后继续预览。</span>
                        </div>
                    ) : geometry.layout ? (
                        <div className={`pkg-panels is-${doc.view.layout}`} ref={panels} style={{ "--pkg-split": `${split}%` } as CSSProperties}>
                            {doc.view.layout !== "model" ? (
                                <PackagingDieline
                                    document={doc}
                                    layout={geometry.layout}
                                    selected={selected}
                                    onSelect={setSelected}
                                    onArtwork={(id, change) => state.updateDocument((d) => ({ ...d, artworks: d.artworks.map((a) => (a.id === id ? { ...a, ...change } : a)) }), `drag-${id}`)}
                                    onInteractionEnd={state.endHistoryGroup}
                                    onUpload={(file) => execute(() => state.upload(file, selected))}
                                    name={state.project.name}
                                    resources={state.resources}
                                    onError={state.setError}
                                />
                            ) : null}
                            {doc.view.layout === "split" ? (
                                <div
                                    className="pkg-divider"
                                    role="separator"
                                    aria-label="调整刀版与模型宽度"
                                    aria-valuenow={split}
                                    tabIndex={0}
                                    onKeyDown={(e) => {
                                        if (e.key === "ArrowLeft") setSplit((v) => Math.max(25, v - 5));
                                        if (e.key === "ArrowRight") setSplit((v) => Math.min(75, v + 5));
                                    }}
                                    onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
                                    onPointerMove={(e) => {
                                        if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
                                        const b = panels.current!.getBoundingClientRect();
                                        setSplit(Math.min(75, Math.max(25, ((e.clientX - b.left) / b.width) * 100)));
                                    }}
                                    onPointerUp={(e) => e.currentTarget.releasePointerCapture(e.pointerId)}
                                />
                            ) : null}
                            {doc.view.layout !== "dieline" ? (
                                <PackagingViewport
                                    document={doc}
                                    layout={geometry.layout}
                                    images={state.images}
                                    imageRevision={state.imageRevision}
                                    onChange={(view) => state.updateDocument((d) => ({ ...d, view: { ...d.view, ...view } }), `view-${Object.keys(view).sort().join("-")}`)}
                                    onError={state.setError}
                                    name={state.project.name}
                                />
                            ) : null}
                        </div>
                    ) : null}
                    <footer className="pkg-statusbar">
                        <span>{geometry.layout ? `面板 ${geometry.layout.panels.length} · 用纸面积 ${(geometry.layout.areaMm2 / 1_000_000).toFixed(3)} m² · 出血 ${doc.parameters.bleed} mm` : "参数待修正"}</span>
                        <details>
                            <summary>结构核对</summary>
                            {geometry.layout?.warnings.map((v) => (
                                <p key={v}>{v}</p>
                            ))}
                        </details>
                    </footer>
                </div>
            </div>
            <AppModal open={production} onCancel={() => setProduction(false)} title="白样打印与用纸试算" width={760} footer={null} centered styles={{ body: { maxHeight: "calc(100dvh - 128px)", overflowY: "auto" } }} destroyOnHidden>
                {geometry.layout ? <PackagingProduction layout={geometry.layout} name={state.project.name} onError={state.setError} /> : null}
            </AppModal>
            <AppModal open={history} onCancel={() => setHistory(false)} title="包装项目" width={720} footer={null}>
                <div className="pkg-project-list">
                    {state.projects.length ? (
                        state.projects.map((p) => (
                            <button
                                type="button"
                                key={p.id}
                                disabled={busy}
                                onClick={() =>
                                    switchProject(async () => {
                                        await state.load(p.id);
                                        setHistory(false);
                                        setSelected("");
                                    })
                                }
                            >
                                <strong>{p.name}</strong>
                                <span>
                                    {p.templateId} · v{p.revision}
                                </span>
                                <small>{new Date(p.updatedAt).toLocaleString()}</small>
                            </button>
                        ))
                    ) : (
                        <p>尚未保存包装项目。</p>
                    )}
                    <div className="pkg-toolbar">
                        <button type="button" disabled={state.page <= 1} onClick={() => execute(() => state.loadPage(state.page - 1))}>
                            上一页
                        </button>
                        <span>
                            {state.page} · 共 {state.total} 个
                        </span>
                        <button type="button" disabled={state.page * 30 >= state.total} onClick={() => execute(() => state.loadPage(state.page + 1))}>
                            下一页
                        </button>
                        {state.project.id ? (
                            <button
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                    modal.confirm({
                                        title: `删除「${state.project!.name}」`,
                                        content: "删除此项目记录，上传图稿仍保留在素材库。",
                                        okText: "删除项目",
                                        okButtonProps: { danger: true },
                                        onOk: async () => {
                                            await state.remove();
                                            setHistory(false);
                                            setSearch({});
                                        },
                                    })
                                }
                            >
                                删除当前项目
                            </button>
                        ) : null}
                    </div>
                </div>
            </AppModal>
            <input
                ref={importer}
                type="file"
                accept=".zip"
                hidden
                onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) switchProject(() => state.importProject(file));
                    e.target.value = "";
                }}
            />
        </main>
    );
}
