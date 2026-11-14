import { useEffect, useMemo, useState } from "react";
import { App, Button, Input, InputNumber, Table, Tag } from "antd";
import { Plus, RefreshCw, Save } from "lucide-react";
import { nanoid } from "nanoid";
import { AppModal } from "@/components/ui/product/app-modal";
import { packagingApi } from "@/services/api/packaging";
import { adminResourceFileUrl } from "@/services/api/admin-storage";
import { captureUserSession, assertCurrentUserSession } from "@/lib/user-scope";
import { compilePackaging } from "@/lib/packaging/geometry";
import { newPackagingDocument, type PackagingCatalog, type PackagingMaterial, type PackagingParameters, type PackagingProject, type PackagingProjectSummary, type PackagingTemplate } from "@/lib/packaging/types";
import { PackagingDieline } from "@/pages/packaging/packaging-dieline";
import { PackagingViewport } from "@/pages/packaging/packaging-viewport";
import { AdminPageFrame } from "../components/admin-shell";
import { AdminCallout, AdminSegmented, AdminSelect, AdminSwitch } from "../ui/controls";
import "@/pages/packaging/packaging.css";
import "./packaging-admin.css";

type Tab = "overview" | "projects" | "templates" | "materials" | "settings";
const tabs: { value: Tab; label: string }[] = [
    { value: "overview", label: "概览" },
    { value: "projects", label: "项目管理" },
    { value: "templates", label: "盒型目录" },
    { value: "materials", label: "材料库" },
    { value: "settings", label: "开放与配额" },
];
const parameterLabels: Record<keyof PackagingParameters, string> = {
    length: "外长",
    width: "外宽",
    height: "外高",
    thickness: "厚度",
    bleed: "出血",
    glue: "粘口 / 封边",
    tab: "插舌",
    gap: "间隙",
    frontHeight: "展示前沿",
    windowWidth: "开窗宽",
    windowHeight: "开窗高",
    inflation: "袋体鼓胀",
    spoutRadius: "吸嘴半径",
};

function ProjectPreview({ project, onError }: { project: PackagingProject; onError: (message: string) => void }) {
    const [doc, setDoc] = useState(project.document);
    const [selected, setSelected] = useState("");
    const [loaded, setLoaded] = useState({ resources: new Map<string, Blob>(), images: new Map<string, HTMLImageElement>() });
    const layout = useMemo(() => compilePackaging(doc), [doc.parameters, doc.template]);
    useEffect(() => {
        const controller = new AbortController();
        const session = captureUserSession();
        const resources = new Map<string, Blob>();
        const images = new Map<string, HTMLImageElement>();
        Promise.all(
            [...new Set(doc.artworks.map((a) => a.resourceId))].map(async (id) => {
                const response = await fetch(adminResourceFileUrl(id), { credentials: "include", signal: controller.signal });
                if (!response.ok) throw new Error(`图稿读取失败（${response.status}）`);
                const blob = await response.blob();
                const url = URL.createObjectURL(blob);
                try {
                    const image = new Image();
                    image.src = url;
                    await image.decode();
                    resources.set(id, blob);
                    images.set(id, image);
                } finally {
                    URL.revokeObjectURL(url);
                }
            }),
        )
            .then(() => {
                assertCurrentUserSession(session);
                if (!controller.signal.aborted) setLoaded({ resources, images });
            })
            .catch((e: unknown) => {
                if (!controller.signal.aborted && !session.signal.aborted) onError(e instanceof Error ? e.message : "预览读取失败");
            });
        return () => controller.abort();
    }, [project.id]);
    return (
        <div className="pkg-admin-preview pkg-workbench">
            <div className="pkg-panels">
                <PackagingDieline
                    document={doc}
                    layout={layout}
                    selected={selected}
                    onSelect={setSelected}
                    onArtwork={() => {}}
                    onUpload={() => {}}
                    name={project.name}
                    resources={loaded.resources}
                    onError={onError}
                    readOnly
                    resourceUrl={adminResourceFileUrl}
                />
                <PackagingViewport document={doc} layout={layout} images={loaded.images} imageRevision={loaded.images.size} onChange={(view) => setDoc((d) => ({ ...d, view: { ...d.view, ...view } }))} onError={onError} name={project.name} />
            </div>
            <p className="pkg-help">
                预览开合仅在此窗口生效。记录版本 v{project.revision}；用户 ID：{project.userId}
            </p>
        </div>
    );
}

export default function PackagingAdminPage() {
    const { modal, message } = App.useApp();
    const [tab, setTab] = useState<Tab>("overview");
    const [catalog, setCatalog] = useState<PackagingCatalog>();
    const [dirty, setDirty] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [stats, setStats] = useState<Awaited<ReturnType<typeof packagingApi.overview>>>();
    const [list, setList] = useState<Awaited<ReturnType<typeof packagingApi.projects>>>();
    const [userFilter, setUserFilter] = useState("");
    const [templateFilter, setTemplateFilter] = useState("");
    const [preview, setPreview] = useState<PackagingProject>();
    const [template, setTemplate] = useState<PackagingTemplate>();
    const [material, setMaterial] = useState<PackagingMaterial>();
    const run = async (action: () => Promise<void>) => {
        setBusy(true);
        setError("");
        try {
            await action();
        } catch (e) {
            setError(e instanceof Error ? e.message : "后台操作失败");
        } finally {
            setBusy(false);
        }
    };
    const loadProjects = async (page = 1) => {
        const session = captureUserSession();
        const value = await packagingApi.projects(page, true, { userId: userFilter, templateId: templateFilter }, session.signal);
        assertCurrentUserSession(session);
        setList(value);
    };
    const reload = async () => {
        const session = captureUserSession();
        const [c, s, p] = await Promise.all([packagingApi.catalog(session.signal, true), packagingApi.overview(), packagingApi.projects(1, true, {}, session.signal)]);
        assertCurrentUserSession(session);
        setCatalog(c);
        setStats(s);
        setList(p);
        setDirty(false);
    };
    useEffect(() => {
        void run(reload);
    }, []);
    const updateCatalog = (change: (c: PackagingCatalog) => PackagingCatalog) => {
        setCatalog((c) => (c ? change(c) : c));
        setDirty(true);
    };
    const saveCatalog = async () => {
        const session = captureUserSession();
        const saved = await packagingApi.saveCatalog(catalog!);
        assertCurrentUserSession(session);
        setCatalog(saved);
        setDirty(false);
        void message.success("盒型、材料与配额已保存到服务器");
    };
    const removeProject = (p: PackagingProjectSummary) =>
        modal.confirm({
            title: `删除「${p.name}」`,
            content: "删除用户的包装项目记录。原始素材保留；操作会写入管理员审计。",
            okText: "删除项目",
            okButtonProps: { danger: true },
            onOk: async () => {
                const session = captureUserSession();
                await packagingApi.remove(p.id, p.revision, session.signal, true);
                assertCurrentUserSession(session);
                setPreview(undefined);
                await reload();
            },
        });
    return (
        <AdminPageFrame
            title="包装刀板管理"
            description="管理包装项目、参数化盒型与材料。目录保存采用版本校验，停用后保留历史项目读取和导出。"
            scroll
            actions={
                <div className="pkg-admin-actions">
                    <Button
                        icon={<RefreshCw size={14} />}
                        loading={busy}
                        onClick={() => {
                            if (dirty) {
                                modal.confirm({ title: "重新读取目录", content: "将放弃当前未保存的后台配置。", onOk: () => run(reload) });
                                return;
                            }
                            void run(reload);
                        }}
                    >
                        重新读取
                    </Button>
                    <Button type="primary" icon={<Save size={14} />} disabled={!dirty || busy} onClick={() => void run(saveCatalog)}>
                        保存配置
                    </Button>
                </div>
            }
        >
            <div className="pkg-admin">
                <AdminSegmented<Tab> ariaLabel="包装刀板管理视图" value={tab} onChange={setTab} options={tabs} />
                {error ? <AdminCallout tone="error">{error}</AdminCallout> : null}
                {dirty ? <AdminCallout tone="warning">目录修改尚未保存。点击顶部「保存配置」后才会影响用户页面。</AdminCallout> : null}
                {!catalog ? (
                    <p role="status">{busy ? "读取目录中…" : "目录读取失败，请重新读取。"}</p>
                ) : (
                    <>
                        {tab === "overview" && stats ? (
                            <>
                                <div className="pkg-admin-stats">
                                    {[
                                        ["已保存项目", stats.projects],
                                        ["使用用户", stats.users],
                                        ["近七天新建", stats.last7Days],
                                        ["启用盒型", catalog.templates.filter((t) => t.enabled).length],
                                    ].map(([label, count]) => (
                                        <article key={label}>
                                            <span>{label}</span>
                                            <strong>{count}</strong>
                                        </article>
                                    ))}
                                </div>
                                <Table
                                    rowKey="templateId"
                                    pagination={false}
                                    dataSource={stats.byTemplate || []}
                                    columns={[
                                        { title: "盒型", dataIndex: "templateId", render: (id: string) => catalog.templates.find((t) => t.id === id)?.name || id },
                                        { title: "项目数", dataIndex: "total" },
                                    ]}
                                />
                            </>
                        ) : null}
                        {tab === "projects" ? (
                            <>
                                <div className="pkg-admin-actions">
                                    <Input aria-label="按用户 ID 筛选包装项目" placeholder="用户 ID（精确匹配）" value={userFilter} onChange={(e) => setUserFilter(e.target.value)} />
                                    <AdminSelect ariaLabel="按盒型筛选项目" value={templateFilter} options={[{ value: "", label: "全部盒型" }, ...catalog.templates.map((t) => ({ value: t.id, label: t.name }))]} onChange={setTemplateFilter} />
                                    <Button disabled={busy} onClick={() => void run(() => loadProjects())}>
                                        查询
                                    </Button>
                                </div>
                                <Table<PackagingProjectSummary>
                                    rowKey="id"
                                    loading={busy}
                                    dataSource={list?.items}
                                    scroll={{ x: 760 }}
                                    pagination={{ current: list?.page || 1, total: list?.total || 0, pageSize: 30, showSizeChanger: false, onChange: (page) => void run(() => loadProjects(page)) }}
                                    columns={[
                                        { title: "项目", dataIndex: "name" },
                                        { title: "盒型", dataIndex: "templateId", render: (id: string) => catalog.templates.find((t) => t.id === id)?.name || id },
                                        { title: "用户", dataIndex: "userId" },
                                        { title: "版本", dataIndex: "revision" },
                                        { title: "更新", dataIndex: "updatedAt", render: (date: string) => new Date(date).toLocaleString() },
                                        {
                                            title: "操作",
                                            render: (_, p) => (
                                                <div className="pkg-admin-actions">
                                                    <Button
                                                        size="small"
                                                        onClick={() =>
                                                            void run(async () => {
                                                                const session = captureUserSession();
                                                                const item = await packagingApi.project(p.id, session.signal, true);
                                                                assertCurrentUserSession(session);
                                                                setPreview(item);
                                                            })
                                                        }
                                                    >
                                                        查看 / 导出
                                                    </Button>
                                                    <Button size="small" danger onClick={() => removeProject(p)}>
                                                        删除
                                                    </Button>
                                                </div>
                                            ),
                                        },
                                    ]}
                                />
                            </>
                        ) : null}
                        {tab === "templates" ? (
                            <>
                                <Button icon={<Plus size={14} />} onClick={() => setTemplate({ ...structuredClone(catalog.templates[0]), id: `template-${nanoid(10)}`, name: "新包装盒型" })}>
                                    新增盒型
                                </Button>
                                <Table<PackagingTemplate>
                                    rowKey="id"
                                    pagination={false}
                                    dataSource={catalog.templates}
                                    columns={[
                                        { title: "名称", dataIndex: "name" },
                                        { title: "分类", dataIndex: "category" },
                                        { title: "结构", dataIndex: "structure" },
                                        { title: "状态", render: (_, t) => <AdminSwitch checked={t.enabled} onChange={(enabled) => updateCatalog((c) => ({ ...c, templates: c.templates.map((v) => (v.id === t.id ? { ...v, enabled } : v)) }))} /> },
                                        {
                                            title: "操作",
                                            render: (_, t) => (
                                                <div className="pkg-admin-actions">
                                                    <Button size="small" onClick={() => setTemplate(structuredClone(t))}>
                                                        编辑
                                                    </Button>
                                                    <Button size="small" onClick={() => setTemplate({ ...structuredClone(t), id: `template-${nanoid(10)}`, name: `${t.name} 副本` })}>
                                                        复制
                                                    </Button>
                                                    <Button
                                                        size="small"
                                                        danger
                                                        disabled={catalog.templates.length === 1}
                                                        onClick={() =>
                                                            modal.confirm({
                                                                title: `移除盒型「${t.name}」`,
                                                                content: "历史项目保留结构快照。用户须重新选择启用盒型才能再次保存。",
                                                                onOk: () => updateCatalog((c) => ({ ...c, templates: c.templates.filter((v) => v.id !== t.id) })),
                                                            })
                                                        }
                                                    >
                                                        移除
                                                    </Button>
                                                </div>
                                            ),
                                        },
                                    ]}
                                />
                            </>
                        ) : null}
                        {tab === "materials" ? (
                            <>
                                <Button icon={<Plus size={14} />} onClick={() => setMaterial({ ...structuredClone(catalog.materials[0]), id: `material-${nanoid(10)}`, name: "新材料" })}>
                                    新增材料
                                </Button>
                                <Table<PackagingMaterial>
                                    rowKey="id"
                                    pagination={false}
                                    dataSource={catalog.materials}
                                    columns={[
                                        { title: "材料", dataIndex: "name" },
                                        { title: "厚度 mm", dataIndex: "thickness" },
                                        { title: "颜色", render: (_, m) => <Tag color={m.color}>{m.color}</Tag> },
                                        { title: "启用", render: (_, m) => <AdminSwitch checked={m.enabled} onChange={(enabled) => updateCatalog((c) => ({ ...c, materials: c.materials.map((v) => (v.id === m.id ? { ...v, enabled } : v)) }))} /> },
                                        {
                                            title: "操作",
                                            render: (_, m) => (
                                                <div className="pkg-admin-actions">
                                                    <Button size="small" onClick={() => setMaterial(structuredClone(m))}>
                                                        编辑
                                                    </Button>
                                                    <Button size="small" danger disabled={catalog.materials.length === 1} onClick={() => updateCatalog((c) => ({ ...c, materials: c.materials.filter((v) => v.id !== m.id) }))}>
                                                        移除
                                                    </Button>
                                                </div>
                                            ),
                                        },
                                    ]}
                                />
                            </>
                        ) : null}
                        {tab === "settings" ? (
                            <div className="pkg-admin-form">
                                <label>
                                    允许新建与保存
                                    <AdminSwitch checked={catalog.enabled} onChange={(enabled) => updateCatalog((c) => ({ ...c, enabled }))} />
                                </label>
                                <label>
                                    每用户项目配额（1–500）
                                    <InputNumber
                                        min={1}
                                        max={500}
                                        value={catalog.maxProjects}
                                        onChange={(value) => {
                                            if (value !== null) updateCatalog((c) => ({ ...c, maxProjects: value }));
                                        }}
                                    />
                                </label>
                                <p>当前目录版本 v{catalog.revision}。关闭写入不会删除项目或上传素材。</p>
                            </div>
                        ) : null}
                    </>
                )}
            </div>
            <AppModal
                title={template?.name || "盒型编辑"}
                open={!!template}
                onCancel={() => setTemplate(undefined)}
                width={680}
                onOk={() => {
                    if (!template) return;
                    try {
                        compilePackaging(newPackagingDocument(template, catalog!.materials[0]));
                        updateCatalog((c) => ({ ...c, templates: [...c.templates.filter((t) => t.id !== template.id), template] }));
                        setTemplate(undefined);
                    } catch (e) {
                        void message.error(e instanceof Error ? e.message : "参数无效");
                    }
                }}
                okText="加入待保存配置"
            >
                <div className="pkg-admin-form">
                    {template ? (
                        <>
                            <label>
                                名称
                                <Input maxLength={80} value={template.name} onChange={(e) => setTemplate({ ...template, name: e.target.value })} />
                            </label>
                            <label>
                                结构
                                <AdminSelect
                                    value={template.structure}
                                    options={["tuck", "reverse-tuck", "mailer", "tray", "display", "lid-base", "drawer", "book", "double-door", "pillow", "pouch", "spout-pouch"].map((value) => ({ value, label: value }))}
                                    onChange={(structure) => setTemplate({ ...template, structure: structure as PackagingTemplate["structure"] })}
                                />
                            </label>
                            <label>
                                分类
                                <AdminSelect value={template.category} options={["折叠纸盒", "礼盒", "托盘展示", "软包装"].map((value) => ({ value, label: value }))} onChange={(category) => setTemplate({ ...template, category })} />
                            </label>
                            <label>
                                描述
                                <Input.TextArea maxLength={800} value={template.description} onChange={(e) => setTemplate({ ...template, description: e.target.value })} />
                            </label>
                            <div className="pkg-admin-parameter-grid">
                                {(Object.keys(parameterLabels) as (keyof PackagingParameters)[]).map((key) => (
                                    <label key={key}>
                                        {parameterLabels[key]}
                                        <InputNumber
                                            value={template.defaults[key]}
                                            step={0.1}
                                            onChange={(value) => {
                                                if (value !== null) setTemplate({ ...template, defaults: { ...template.defaults, [key]: value } });
                                            }}
                                        />
                                    </label>
                                ))}
                            </div>
                            <p>结构由参数化引擎生成。新增盒型复用上述十二种结构；投产前须核对白样。</p>
                        </>
                    ) : null}
                </div>
            </AppModal>
            <AppModal
                title="材料编辑"
                open={!!material}
                onCancel={() => setMaterial(undefined)}
                onOk={() => {
                    if (!material) return;
                    updateCatalog((c) => ({ ...c, materials: [...c.materials.filter((m) => m.id !== material.id), material] }));
                    setMaterial(undefined);
                }}
                okText="加入待保存配置"
            >
                <div className="pkg-admin-form">
                    {material ? (
                        <>
                            <label>
                                名称
                                <Input maxLength={80} value={material.name} onChange={(e) => setMaterial({ ...material, name: e.target.value })} />
                            </label>
                            <label>
                                外侧颜色
                                <input type="color" value={material.color} onChange={(e) => setMaterial({ ...material, color: e.target.value })} />
                            </label>
                            <label>
                                内侧颜色
                                <input type="color" value={material.insideColor} onChange={(e) => setMaterial({ ...material, insideColor: e.target.value })} />
                            </label>
                            {(
                                [
                                    ["thickness", "厚度 mm", 0.05, 10],
                                    ["roughness", "粗糙度", 0, 1],
                                    ["metalness", "金属度", 0, 1],
                                ] as const
                            ).map(([key, label, min, max]) => (
                                <label key={key}>
                                    {label}
                                    <InputNumber
                                        value={material[key]}
                                        min={min}
                                        max={max}
                                        step={0.05}
                                        onChange={(value) => {
                                            if (value !== null) setMaterial({ ...material, [key]: value });
                                        }}
                                    />
                                </label>
                            ))}
                        </>
                    ) : null}
                </div>
            </AppModal>
            <AppModal title={preview?.name} open={!!preview} onCancel={() => setPreview(undefined)} width="min(1400px, 96vw)" footer={null}>
                {preview ? <ProjectPreview key={preview.id} project={preview} onError={setError} /> : null}
            </AppModal>
        </AdminPageFrame>
    );
}
