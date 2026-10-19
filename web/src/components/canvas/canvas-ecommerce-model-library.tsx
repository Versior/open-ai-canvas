import { App } from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, Check, ImagePlus, LoaderCircle, Save, Search, Sparkles, Star, Trash2, Upload, UserRound, X } from "lucide-react";

import { AppModal } from "@/components/ui/product/app-modal";
import {
    createEcommerceModel,
    ecommerceModelById,
    ecommerceModelCoverRef,
    filterEcommerceModels,
    ecommerceModelReady,
    ecommerceModelRefCount,
    type EcommerceModel,
} from "@/lib/ecommerce/ecommerce-models";
import { resolveImageUrl, uploadImage } from "@/services/image-storage";
import { useEcommerceModelLibrary, type EcommerceModelPatch } from "@/stores/use-ecommerce-model-library";
import { getActiveUserScope } from "@/lib/user-scope";
import "./canvas-ecommerce-model-library.css";

type ModelLibraryModalProps = {
    open: boolean;
    onClose: () => void;
    /** 选中一个模特。传了它才是「挑选」模式，否则只是管理。 */
    onSelect?: (model: EcommerceModel) => Promise<void> | void;
    /** 当前已选的模特 id，用于回显。 */
    activeModelId?: string;
    imageToAdd?: { storageKey: string; name: string };
};

/**
 * 模特库——「出这个商品的图上，人是谁」。
 *
 * 只管理用户上传或从画布图保存的模特，不再提供内置记录。
 *
 * 模特就是一张（或几张）图加一个名字。这里没有性别、体型、年龄、姿势这些输入框：
 * 那些要么在图上，要么该由参考图决定。让用户抄一遍只会抄出与图不符的描述，
 * 而描述一旦和图打架，模型听谁的都错。
 */
export function CanvasEcommerceModelLibraryModal({ open, onClose, onSelect, activeModelId, imageToAdd }: ModelLibraryModalProps) {
    const { message, modal } = App.useApp();
    const [editingId, setEditingId] = useState<string | null>(null);
    const [uploading, setUploading] = useState(false);
    const [search, setSearch] = useState("");
    const [order, setOrder] = useState("recent");
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [previewRef, setPreviewRef] = useState("");
    const [loadError, setLoadError] = useState("");
    const fileRef = useRef<HTMLInputElement>(null);

    const models = useEcommerceModelLibrary((state) => state.models);
    const hydrated = useEcommerceModelLibrary((state) => state.hydrated);
    const hydrate = useEcommerceModelLibrary((state) => state.hydrate);
    const addModel = useEcommerceModelLibrary((state) => state.addModel);
    const updateModel = useEcommerceModelLibrary((state) => state.updateModel);
    const removeModels = useEcommerceModelLibrary((state) => state.removeModels);

    const editing = useMemo(() => ecommerceModelById(editingId || undefined, models), [editingId, models]);
    const visible = useMemo(() => filterEcommerceModels(models, search, order), [models, search, order]);
    useEffect(() => {
        if (!open) {
            setPreviewRef("");
            setSelected(new Set());
            return;
        }
        setLoadError("");
        let cancelled = false;
        void hydrate().catch((error) => {
            if (!cancelled) setLoadError(error instanceof Error ? error.message : "模特库加载失败");
        });
        return () => { cancelled = true; };
    }, [open, hydrate]);

    const createModel = async () => {
        try {
            const model = createEcommerceModel(imageToAdd?.name || "新模特", imageToAdd ? [imageToAdd.storageKey] : []);
            await addModel(model);
            setEditingId(model.id);
            message.success("已新建模特");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存失败");
        }
    };

    /** 上传一张图存成新模特。存 storageKey——url 在直传失败退回本机时是会失效的 blob URL。 */
    const handleUpload = async (file: File | undefined) => {
        if (!file) return;
        const scope = getActiveUserScope();
        setUploading(true);
        try {
            const image = await uploadImage(file);
            if (scope !== getActiveUserScope()) throw new Error("账号已切换，请重新上传");
            const model = createEcommerceModel(file.name.replace(/\.[^.]+$/, "") || "新模特", [image.storageKey]);
            await addModel(model);
            setEditingId(model.id);
            message.success("已存为模特，改个名字就能用了");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "上传失败");
        } finally {
            setUploading(false);
            if (fileRef.current) fileRef.current.value = "";
        }
    };

    const useModel = async (model: EcommerceModel) => {
        if (!imageToAdd && !ecommerceModelReady(model)) {
            setEditingId(model.id);
            return;
        }
        try {
            if (imageToAdd) {
                await updateModel(model.id, (current) => ({ refs: [...new Set([...current.refs, imageToAdd.storageKey])] }));
                message.success(`已加入「${model.name}」`);
            } else {
                await onSelect?.(model);
            }
            onClose();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存失败");
        }
    };

    const deleteModels = (ids: string[]) => {
        modal.confirm({
            title: `删除 ${ids.length} 个模特？`,
            content: "使用这些模特的画布需要重新选择。原始图片不会删除。",
            okText: "删除", cancelText: "保留", okButtonProps: { danger: true },
            onOk: async () => {
                try {
                    await removeModels(ids);
                    setSelected(new Set());
                    if (editingId && ids.includes(editingId)) setEditingId(null);
                } catch (error) {
                    message.error(error instanceof Error ? error.message : "删除失败");
                    throw error;
                }
            },
        });
    };

    return (
        <>
        <AppModal open={open} onCancel={onClose} footer={null} width={880} centered destroyOnHidden title={null} closable={false} flush className="ecom-model-modal">
            <div className="ecom-model-shell">
                <header className="ecom-model-head">
                    <div className="min-w-0">
                        <span className="ecom-model-kicker">电商 / 模特库</span>
                        <h2 className="ecom-model-title">模特库</h2>
                    </div>
                    <button type="button" className="ecom-model-icon" onClick={onClose} aria-label="关闭模特库" title="关闭"><X className="size-4" /></button>
                </header>

                <div className="ecom-model-body">
                    {imageToAdd ? <div className="ecom-model-source"><ModelImage refKey={imageToAdd.storageKey} /><span>{imageToAdd.name}</span></div> : null}
                            <div className="ecom-model-bar">
                                <span className="ecom-model-count">{models.length} 位我的模特</span>
                                <button type="button" className="ecom-model-primary" disabled={uploading || !hydrated} onClick={() => fileRef.current?.click()}>
                                    <Upload className="size-3.5" />
                                    {uploading ? "上传中…" : "上传保存为模特"}
                                </button>
                                <button type="button" className="ecom-model-ghost" disabled={!hydrated} onClick={() => void createModel()}>
                                    <ImagePlus className="size-3.5" />
                                    新建模特
                                </button>
                            </div>
                            <div className="ecom-model-filters">
                                <label className="ecom-model-search"><Search className="size-4" /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索名称或标签" aria-label="搜索模特" /></label>
                                <select className="ecom-model-input ecom-model-sort" value={order} onChange={(event) => setOrder(event.target.value)} aria-label="模特排序"><option value="recent">最近使用</option><option value="name">按名称</option></select>
                            </div>
                            <div className="ecom-model-selection">
                                <label><input type="checkbox" checked={Boolean(visible.length && visible.every((model) => selected.has(model.id)))} onChange={(event) => setSelected(event.target.checked ? new Set(visible.map((model) => model.id)) : new Set())} />全选当前列表</label>
                                {selected.size ? <button type="button" className="ecom-model-ghost" onClick={() => deleteModels([...selected])}><Trash2 className="size-3.5" />删除 {selected.size} 个</button> : null}
                            </div>
                            {loadError ? <p role="alert">{loadError}</p> : !hydrated ? <div className="ecom-model-empty"><LoaderCircle className="size-5 animate-spin" />正在加载</div> : visible.length ? (
                                <div className="ecom-model-grid">
                                    {visible.map((model) => (
                                        <ModelCard
                                            key={model.id}
                                            model={model}
                                            active={model.id === activeModelId}
                                            onUse={onSelect || imageToAdd ? () => void useModel(model) : undefined}
                                            addingImage={Boolean(imageToAdd)}
                                            selected={selected.has(model.id)}
                                            onSelect={() => setSelected((current) => { const next = new Set(current); if (next.has(model.id)) next.delete(model.id); else next.add(model.id); return next; })}
                                            onPreview={cover => setPreviewRef(cover)}
                                            onEdit={() => setEditingId(model.id)}
                                            onDelete={() => deleteModels([model.id])}
                                        />
                                    ))}
                                </div>
                            ) : (
                                <div className="ecom-model-empty">
                                    <UserRound className="size-6" />
                                    <p>{search ? "没有匹配的模特" : "暂无模特"}</p>
                                </div>
                            )}

                    {editing ? (
                        <ModelEditor
                            model={editing}
                            onChange={(patch) => updateModel(editing.id, patch)}
                            onPreview={setPreviewRef}
                            onClose={() => setEditingId(null)}
                        />
                    ) : null}
                </div>

                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(event) => void handleUpload(event.target.files?.[0])} />
            </div>
        </AppModal>
        <AppModal open={Boolean(previewRef)} onCancel={() => setPreviewRef("")} footer={null} title="模特参考图" width={960} destroyOnHidden>
            {previewRef ? <div className="ecom-model-full-preview"><ModelImage refKey={previewRef} /></div> : null}
        </AppModal>
        </>
    );
}

/**
 * 参考图按 storageKey 解析后显示。
 *
 * 不直接存 url：上传直传失败时会退回本机、url 是个重启就失效的 blob URL，
 * 存它等于模特库过一夜全部变空白。
 */
function ModelImage({ refKey }: { refKey: string }) {
    const [src, setSrc] = useState("");
    useEffect(() => {
        let cancelled = false;
        void resolveImageUrl(refKey, "").then((url) => { if (!cancelled) setSrc(url); }).catch(() => { if (!cancelled) setSrc(""); });
        return () => { cancelled = true; };
    }, [refKey]);
    if (!src) return <span className="ecom-model-image-pending" aria-hidden />;
    return <img src={src} alt="" loading="lazy" draggable={false} />;
}

function ModelCard({ model, active, onUse, onEdit, onDelete, selected, onSelect, addingImage, onPreview }: {
    model: EcommerceModel;
    active: boolean;
    onUse?: () => void;
    selected: boolean;
    onSelect: () => void;
    addingImage: boolean;
    onPreview: (ref: string) => void;
    onEdit: () => void;
    onDelete?: () => void;
}) {
    const cover = ecommerceModelCoverRef(model);
    const refs = ecommerceModelRefCount(model);
    const ready = ecommerceModelReady(model);
    return (
        <div className="ecom-model-card" data-active={active ? "true" : undefined}>
            <div className="ecom-model-cover" onDoubleClick={() => cover && onPreview(cover)}>
                <label className="ecom-model-select"><input type="checkbox" checked={selected} onChange={onSelect} aria-label={`选择 ${model.name}`} /></label>
                {cover ? <ModelImage refKey={cover} /> : (
                    <span className="ecom-model-cover-empty">
                        <Camera className="size-5" />
                        还没有参考图
                    </span>
                )}
            </div>
            <div className="ecom-model-card-body">
                <div className="ecom-model-card-head">
                    <span className="ecom-model-card-name" title={model.name}>{model.name}</span>
                    {onDelete ? (
                        <button type="button" className="ecom-model-icon" aria-label={`删除 ${model.name}`} onClick={onDelete}>
                            <Trash2 className="size-3" />
                        </button>
                    ) : null}
                </div>
                <span className="ecom-model-card-stats tabular-nums">
                    {refs ? `${refs} 张参考图` : "待加参考图"}
                    {model.tags.length ? ` · ${model.tags.join("/")}` : ""}
                </span>
                {!ready ? <span className="ecom-model-card-warn">没有参考图，锁不住人</span> : null}
            </div>
            <div className="ecom-model-card-actions">
                {onUse ? <button type="button" className="ecom-model-card-action" disabled={!ready && !addingImage} onClick={onUse} title={addingImage ? "将图片加入此模特" : "使用此模特"}>
                    <Sparkles className="size-3" />
                    {addingImage ? "加入此模特" : "用这个"}
                </button> : null}
                {cover ? <button type="button" className="ecom-model-card-action" onClick={() => onPreview(cover)}>查看图片</button> : null}
                <button type="button" className="ecom-model-card-action ecom-model-card-action-wide" onClick={onEdit}>
                    <ImagePlus className="size-3" />
                    {ready ? "改名字 / 加图" : "加参考图"}
                </button>
            </div>
        </div>
    );
}

/**
 * 模特编辑：名字 + 参考图。
 *
 * 就这两样。早先这里有性别、体型、年龄、姿势类型、六个角度槽——
 * 那些字段没有一个会真的改变生成结果，却让「加一个模特」变成填一张表。
 */
function ModelEditor({ model, onChange, onClose, onPreview }: { model: EcommerceModel; onChange: (patch: EcommerceModelPatch) => Promise<void>; onClose: () => void; onPreview: (ref: string) => void }) {
    const fileRef = useRef<HTMLInputElement>(null);
    const [uploading, setUploading] = useState(false);
    const [name, setName] = useState(model.name);
    const [tags, setTags] = useState(model.tags.join("，"));
    const { message } = App.useApp();
    useEffect(() => { setName(model.name); setTags(model.tags.join("，")); }, [model.id, model.name, model.tags]);

    const commit = async (patch: EcommerceModelPatch) => {
        try {
            await onChange(patch);
            return true;
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存失败");
            return false;
        }
    };

    const addRef = async (file: File | undefined) => {
        if (!file) return;
        const scope = getActiveUserScope();
        setUploading(true);
        try {
            const image = await uploadImage(file);
            if (scope !== getActiveUserScope()) throw new Error("账号已切换，请重新上传");
            const current = useEcommerceModelLibrary.getState().models.find((item) => item.id === model.id);
            if (!current) throw new Error("模特已删除");
            if (current.refs.includes(image.storageKey)) {
                message.info("这张图已经在这个模特身上了");
                return;
            }
            if (await commit((latest) => ({ refs: [...new Set([...latest.refs, image.storageKey])] }))) message.success("已加一张参考图");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "上传失败");
        } finally {
            setUploading(false);
            if (fileRef.current) fileRef.current.value = "";
        }
    };

    return (
        <div className="ecom-model-editor">
            <header className="ecom-model-editor-head">
                <span className="ecom-model-editor-title">{model.name}</span>
                <button type="button" className="ecom-model-icon" aria-label="收起编辑" onClick={onClose}>
                    <X className="size-3.5" />
                </button>
            </header>

            <label className="ecom-model-field">
                <span className="ecom-model-label">名字</span>
                <input className="ecom-model-input" value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <label className="ecom-model-field"><span className="ecom-model-label">标签</span><input className="ecom-model-input" value={tags} onChange={(event) => setTags(event.target.value)} placeholder="用逗号分隔" /></label>
            <button type="button" className="ecom-model-ghost" onClick={() => {
                if (!name.trim()) { message.warning("请填写模特名称"); return; }
                void commit({ name: name.trim(), tags: [...new Set(tags.split(/[,，]/).map((item) => item.trim()).filter(Boolean))] }).then((saved) => { if (saved) message.success("已保存修改"); });
            }}><Save className="size-3.5" />保存修改</button>

            <div className="ecom-model-field">
                <span className="ecom-model-label">
                    参考图
                </span>
                <div className="ecom-model-refs">
                    {model.refs.map((ref, index) => (
                        <span key={ref} className="ecom-model-ref">
                            <ModelImage refKey={ref} />
                            <button type="button" className="ecom-model-ref-preview" aria-label={`查看第 ${index + 1} 张参考图`} title="查看图片" onClick={() => onPreview(ref)} />
                            {index === 0 ? <span className="ecom-model-ref-flag">主图</span> : null}
                            {index > 0 ? <button type="button" className="ecom-model-ref-primary" title="设为主图" aria-label={`将第 ${index + 1} 张设为主图`} onClick={() => void commit((current) => ({ refs: [ref, ...current.refs.filter((item) => item !== ref)] }))}><Star className="size-3" /></button> : null}
                            <button
                                type="button"
                                className="ecom-model-ref-remove"
                                aria-label={`移除第 ${index + 1} 张参考图`}
                                onClick={() => void commit((current) => ({ refs: current.refs.filter((item) => item !== ref) }))}
                            >
                                <X className="size-3" />
                            </button>
                        </span>
                    ))}
                    <button type="button" className="ecom-model-ref-add" disabled={uploading} onClick={() => fileRef.current?.click()}>
                        {uploading ? <LoaderCircle className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
                        <span>{uploading ? "上传中…" : "加图"}</span>
                    </button>
                </div>
            </div>

            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(event) => void addRef(event.target.files?.[0])} />
        </div>
    );
}
