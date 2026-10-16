import { App } from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, Check, ImagePlus, LoaderCircle, Sparkles, Trash2, Upload, UserRound, WandSparkles, X } from "lucide-react";

import { AppModal } from "@/components/ui/product/app-modal";
import {
    ECOMMERCE_MODEL_PRESETS,
    createEcommerceModel,
    ecommerceModelById,
    ecommerceModelCoverRef,
    ecommerceModelPresetPrompt,
    ecommerceModelReady,
    ecommerceModelRefCount,
    type EcommerceModel,
    type EcommerceModelPreset,
} from "@/lib/ecommerce/ecommerce-models";
import { resolveImageUrl, uploadImage } from "@/services/image-storage";
import { useEcommerceModelLibrary } from "@/stores/use-ecommerce-model-library";
import "./canvas-ecommerce-model-library.css";

type ModelLibraryModalProps = {
    open: boolean;
    onClose: () => void;
    /** 选中一个模特。传了它才是「挑选」模式，否则只是管理。 */
    onSelect?: (model: EcommerceModel) => void;
    /** 当前已选的模特 id，用于回显。 */
    activeModelId?: string;
    /**
     * 公共起手式生成参考图。
     *
     * 这一步必须落回画布：出图是要花积分的模型调用，得让用户在画布上看见它、
     * 能重出、能删。在弹窗里悄悄生成再塞进库里，出了问题用户找不到那张图。
     */
    onGeneratePreset?: (preset: EcommerceModelPreset) => Promise<void> | void;
};

/**
 * 模特库——「出这个商品的图上，人是谁」。
 *
 * 分两个库：**我的模特**是用户自己上传或从画布图存下来的，
 * **公共模特库**是十二个起手式——手上还没有模特实拍的人，先生成一张参考图。
 *
 * 模特就是一张（或几张）图加一个名字。这里没有性别、体型、年龄、姿势这些输入框：
 * 那些要么在图上，要么该由参考图决定。让用户抄一遍只会抄出与图不符的描述，
 * 而描述一旦和图打架，模型听谁的都错。
 */
export function CanvasEcommerceModelLibraryModal({ open, onClose, onSelect, activeModelId, onGeneratePreset }: ModelLibraryModalProps) {
    const { message } = App.useApp();
    const [tab, setTab] = useState<"mine" | "public">("mine");
    const [editingId, setEditingId] = useState<string | null>(null);
    const [uploading, setUploading] = useState(false);
    const [generatingPreset, setGeneratingPreset] = useState<string | null>(null);
    const fileRef = useRef<HTMLInputElement>(null);

    const models = useEcommerceModelLibrary((state) => state.models);
    const addModel = useEcommerceModelLibrary((state) => state.addModel);
    const updateModel = useEcommerceModelLibrary((state) => state.updateModel);
    const removeModel = useEcommerceModelLibrary((state) => state.removeModel);

    const editing = useMemo(() => ecommerceModelById(editingId || undefined, models), [editingId, models]);

    /** 上传一张图存成新模特。存 storageKey——url 在直传失败退回本机时是会失效的 blob URL。 */
    const handleUpload = async (file: File | undefined) => {
        if (!file) return;
        setUploading(true);
        try {
            const image = await uploadImage(file);
            const model = createEcommerceModel(`模特 · ${models.length + 1}`, [image.storageKey]);
            addModel(model);
            setTab("mine");
            setEditingId(model.id);
            message.success("已存为模特，改个名字就能用了");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "上传失败");
        } finally {
            setUploading(false);
            if (fileRef.current) fileRef.current.value = "";
        }
    };

    const useModel = (model: EcommerceModel) => {
        if (!ecommerceModelReady(model)) {
            setEditingId(model.id);
            setTab("mine");
            message.info("这个模特还没有参考图——没有图就锁不住人，先加一张");
            return;
        }
        onSelect?.(model);
        onClose();
    };

    const generatePreset = async (preset: EcommerceModelPreset) => {
        if (!onGeneratePreset) return;
        setGeneratingPreset(preset.id);
        try {
            await onGeneratePreset(preset);
            onClose();
        } finally {
            setGeneratingPreset(null);
        }
    };

    return (
        <AppModal open={open} onCancel={onClose} footer={null} width={880} centered destroyOnHidden title={null} className="ecom-model-modal">
            <div className="ecom-model-shell">
                <header className="ecom-model-head">
                    <div className="min-w-0">
                        <span className="ecom-model-kicker">电商 / 模特库</span>
                        <h2 className="ecom-model-title">模特库</h2>
                    </div>
                    <div className="ecom-model-tabs" role="tablist">
                        <button type="button" role="tab" aria-selected={tab === "mine"} className="ecom-model-tab" onClick={() => setTab("mine")}>
                            我的模特
                            <span className="tabular-nums">{models.length}</span>
                        </button>
                        <button type="button" role="tab" aria-selected={tab === "public"} className="ecom-model-tab" onClick={() => setTab("public")}>
                            公共模特库
                            <span className="tabular-nums">{ECOMMERCE_MODEL_PRESETS.length}</span>
                        </button>
                    </div>
                </header>

                <div className="ecom-model-body">
                    {tab === "mine" ? (
                        <>
                            <div className="ecom-model-bar">
                                <span className="ecom-model-count">{models.length} 位我的模特</span>
                                <button type="button" className="ecom-model-primary" disabled={uploading} onClick={() => fileRef.current?.click()}>
                                    <Upload className="size-3.5" />
                                    {uploading ? "上传中…" : "上传保存为模特"}
                                </button>
                                <button type="button" className="ecom-model-ghost" onClick={() => { const model = createEcommerceModel(`模特 · ${models.length + 1}`); addModel(model); setEditingId(model.id); }}>
                                    <ImagePlus className="size-3.5" />
                                    手动新建
                                </button>
                            </div>
                            {models.length ? (
                                <div className="ecom-model-grid">
                                    {models.map((model) => (
                                        <ModelCard
                                            key={model.id}
                                            model={model}
                                            active={model.id === activeModelId}
                                            onUse={() => useModel(model)}
                                            onEdit={() => setEditingId(model.id)}
                                            onDelete={() => { removeModel(model.id); if (editingId === model.id) setEditingId(null); }}
                                        />
                                    ))}
                                </div>
                            ) : (
                                <div className="ecom-model-empty">
                                    <UserRound className="size-6" />
                                    <p>还没有自己的模特。</p>
                                    <p className="ecom-model-empty-hint">
                                        上传一张模特图（全身正面最好，它定身高与身材比例），
                                        或者在画布上右键任意一张图存为模特。
                                        有了它，同一款商品的九屏详情页才会是同一个人。
                                    </p>
                                </div>
                            )}
                        </>
                    ) : (
                        <>
                            <div className="ecom-model-bar">
                                <span className="ecom-model-count">{ECOMMERCE_MODEL_PRESETS.length} 个起手式</span>
                                <span className="ecom-model-hint">点一下在画布上出一张模特参考图，出完存进我的模特就能用</span>
                            </div>
                            <div className="ecom-model-grid">
                                {ECOMMERCE_MODEL_PRESETS.map((preset) => (
                                    <PresetCard
                                        key={preset.id}
                                        preset={preset}
                                        busy={generatingPreset === preset.id}
                                        disabled={!onGeneratePreset || Boolean(generatingPreset)}
                                        onGenerate={() => void generatePreset(preset)}
                                    />
                                ))}
                            </div>
                        </>
                    )}

                    {editing ? (
                        <ModelEditor
                            model={editing}
                            onChange={(patch) => updateModel(editing.id, patch)}
                            onClose={() => setEditingId(null)}
                        />
                    ) : null}
                </div>

                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(event) => void handleUpload(event.target.files?.[0])} />
            </div>
        </AppModal>
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

function ModelCard({ model, active, onUse, onEdit, onDelete }: {
    model: EcommerceModel;
    active: boolean;
    onUse: () => void;
    onEdit: () => void;
    onDelete?: () => void;
}) {
    const cover = ecommerceModelCoverRef(model);
    const refs = ecommerceModelRefCount(model);
    const ready = ecommerceModelReady(model);
    return (
        <div className="ecom-model-card" data-active={active ? "true" : undefined}>
            <div className="ecom-model-cover">
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
                <button type="button" className="ecom-model-card-action" disabled={!ready} onClick={onUse} title={ready ? "用这个模特出图" : "先加一张参考图"}>
                    <Sparkles className="size-3" />
                    用这个
                </button>
                <button type="button" className="ecom-model-card-action ecom-model-card-action-wide" onClick={onEdit}>
                    <ImagePlus className="size-3" />
                    {ready ? "改名字 / 加图" : "加参考图"}
                </button>
            </div>
        </div>
    );
}

function PresetCard({ preset, busy, disabled, onGenerate }: {
    preset: EcommerceModelPreset;
    busy: boolean;
    disabled: boolean;
    onGenerate: () => void;
}) {
    return (
        <div className="ecom-model-card">
            <div className="ecom-model-cover">
                <span className="ecom-model-cover-empty">
                    <WandSparkles className="size-5" />
                    点下方出一张
                </span>
            </div>
            <div className="ecom-model-card-body">
                <div className="ecom-model-card-head">
                    <span className="ecom-model-card-name" title={preset.name}>{preset.name}</span>
                </div>
                <span className="ecom-model-card-meta">{preset.hint}</span>
                <span className="ecom-model-card-stats" title={ecommerceModelPresetPrompt(preset)}>
                    {preset.brief.slice(0, 28)}…
                </span>
            </div>
            <div className="ecom-model-card-actions">
                <button type="button" className="ecom-model-card-action ecom-model-card-action-wide" disabled={disabled} onClick={onGenerate} title="在画布上落一张参考图并提交生成">
                    {busy ? <LoaderCircle className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
                    {busy ? "已提交" : "生成参考图"}
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
function ModelEditor({ model, onChange, onClose }: { model: EcommerceModel; onChange: (patch: Partial<EcommerceModel>) => void; onClose: () => void }) {
    const fileRef = useRef<HTMLInputElement>(null);
    const [uploading, setUploading] = useState(false);
    const { message } = App.useApp();

    const addRef = async (file: File | undefined) => {
        if (!file) return;
        setUploading(true);
        try {
            const image = await uploadImage(file);
            if (model.refs.includes(image.storageKey)) {
                message.info("这张图已经在这个模特身上了");
                return;
            }
            onChange({ refs: [...model.refs, image.storageKey] });
            message.success("已加一张参考图");
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
                <input className="ecom-model-input" value={model.name} onChange={(event) => onChange({ name: event.target.value })} />
            </label>

            <div className="ecom-model-field">
                <span className="ecom-model-label">
                    参考图
                    <span className="ecom-model-label-hint">
                        第一张是主图，全身正面最好——它定身高与身材比例。多张不同角度一起送进去，模型才锁得住脸与身材。
                    </span>
                </span>
                <div className="ecom-model-refs">
                    {model.refs.map((ref, index) => (
                        <span key={ref} className="ecom-model-ref">
                            <ModelImage refKey={ref} />
                            {index === 0 ? <span className="ecom-model-ref-flag">主图</span> : null}
                            <button
                                type="button"
                                className="ecom-model-ref-remove"
                                aria-label={`移除第 ${index + 1} 张参考图`}
                                onClick={() => onChange({ refs: model.refs.filter((item) => item !== ref) })}
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
                {model.refs.length ? (
                    <span className="ecom-model-label-hint">
                        <Check className="inline size-3" /> 有图就能锁人。出图时这些图会作为参考图一起送进去。
                    </span>
                ) : null}
            </div>

            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(event) => void addRef(event.target.files?.[0])} />
        </div>
    );
}
