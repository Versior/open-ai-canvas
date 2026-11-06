import { Button, Input, Select } from "antd";
import { ImagePlus, LoaderCircle, Sparkles, X } from "lucide-react";
import { useMemo, useRef, useState, type DragEvent } from "react";
import { ModelPicker } from "@/components/model-picker";
import { SegmentedControl } from "@/components/ui/base/segmented-control";
import { cn } from "@/lib/utils";
import { uploadResourceFile } from "@/services/api/resources";
import type { InteriorCatalog, InteriorImageRef, InteriorMode, InteriorModelRef, InteriorPreset, InteriorSurface } from "@/services/api/interior";
import type { AiConfig } from "@/stores/use-config-store";
import { interiorImageUrl, interiorModelPermitted, interiorModelRef } from "./interior-models";
import { useInteriorEstimate } from "./use-interior-estimate";

export type InteriorUpload = InteriorImageRef & { name: string; uploading?: boolean; error?: string; previewUrl?: string };

export type InteriorDraft = {
    modeId: string;
    roomKey: string;
    styleKeys: string[];
    params: Record<string, string>;
    notes: string;
    count: number;
    size: string;
    quality: string;
    modelValue: string;
    source: InteriorUpload | null;
    references: InteriorUpload[];
};

const SIZE_OPTIONS = ["auto", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3", "1:1"].map((value) => ({ value, label: value === "auto" ? "跟随原图" : value }));
const QUALITY_OPTIONS = [
    { value: "auto", label: "自动" },
    { value: "low", label: "草图" },
    { value: "medium", label: "标准" },
    { value: "high", label: "精细" },
];

async function imageSize(file: File): Promise<{ width?: number; height?: number }> {
    if (typeof createImageBitmap !== "function") return {};
    try {
        const bitmap = await createImageBitmap(file);
        const size = { width: bitmap.width, height: bitmap.height };
        bitmap.close();
        return size;
    } catch {
        return {};
    }
}

export async function uploadInteriorImage(file: File): Promise<InteriorImageRef> {
    const size = await imageSize(file);
    const resource = await uploadResourceFile(file, "image", { fileName: file.name, ...size });
    const width = resource.width || size.width;
    const height = resource.height || size.height;
    return { resourceId: resource.id, ...(width ? { width } : {}), ...(height ? { height } : {}) };
}

export function visibleInteriorModes(catalog: InteriorCatalog, surface: InteriorSurface) {
    return catalog.modes.filter((mode) => mode.audience === "both" || mode.audience === surface);
}

export function interiorCountLimit(catalog: InteriorCatalog, mode: InteriorMode | undefined) {
    return Math.max(1, Math.min(mode?.maxCount || 1, catalog.settings.maxCountPerStyle || 1));
}

/** 提交前的阻断原因；返回空串表示可以提交。 */
export function interiorDraftProblem(draft: InteriorDraft, mode: InteriorMode | undefined, surface: InteriorSurface, config: AiConfig, siteDefault?: InteriorModelRef) {
    if (!mode) return "请选择出图方式";
    if (!draft.source) return `请上传${mode.slots.find((slot) => slot.key === "source")?.name || "原图"}`;
    if (draft.source.uploading || draft.references.some((item) => item.uploading)) return "图片还在上传";
    if (draft.source.error || draft.references.some((item) => item.error)) return "请移除上传失败的图片";
    const referenceSlot = mode.slots.find((slot) => slot.key === "reference");
    if (referenceSlot?.required && !draft.references.length) return `请上传${referenceSlot.name}`;
    if (mode.requiresRoom && !draft.roomKey) return "请选择空间";
    if (mode.requiresStyle && !draft.styleKeys.length) return "请至少选择一个风格";
    if (mode.notesRequired && !draft.notes.trim()) return "请写下要修改的内容";
    if (surface === "pro") {
        const ref = interiorModelRef(config, draft.modelValue);
        if (!ref && !(mode.defaultModel || siteDefault)) return "请选择出图模型";
        if (ref && !interiorModelPermitted(mode, siteDefault, ref)) return "所选模型不在这个出图方式的可选范围内";
    }
    return "";
}

export function groupPresets(items: InteriorPreset[]) {
    const groups = new Map<string, InteriorPreset[]>();
    for (const item of items) {
        const key = item.groupName || "其他";
        groups.set(key, [...(groups.get(key) || []), item]);
    }
    return [...groups.entries()];
}

export function UploadSlot({ label, value, onPick, onClear, disabled }: { label: string; value: InteriorUpload | null; onPick: (file: File) => void; onClear: () => void; disabled?: boolean }) {
    const input = useRef<HTMLInputElement>(null);
    const [dragging, setDragging] = useState(false);
    const drop = (event: DragEvent<HTMLElement>) => {
        event.preventDefault();
        setDragging(false);
        const file = Array.from(event.dataTransfer.files).find((item) => item.type.startsWith("image/"));
        if (file) onPick(file);
    };
    const preview = value?.previewUrl || (value?.resourceId ? interiorImageUrl(value.resourceId, true) : "");
    return (
        <div
            className={cn("itd-upload", dragging && "is-dragging", value && "has-image")}
            onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={drop}
        >
            {value && preview ? (
                <>
                    <img src={preview} alt={label} />
                    {value.uploading ? (
                        <span className="itd-upload-state">
                            <LoaderCircle className="size-4 motion-safe:animate-spin" aria-hidden />
                            上传中
                        </span>
                    ) : null}
                    {value.error ? <span className="itd-upload-state is-error">{value.error}</span> : null}
                    <button type="button" className="itd-upload-clear" aria-label={`移除${label}`} onClick={onClear} disabled={disabled}>
                        <X className="size-3.5" aria-hidden />
                    </button>
                </>
            ) : (
                <button type="button" className="itd-upload-empty" onClick={() => input.current?.click()} disabled={disabled}>
                    <ImagePlus className="size-5" aria-hidden />
                    <span>{label}</span>
                    <small>点击、拖入或 Ctrl+V 粘贴</small>
                </button>
            )}
            <input
                ref={input}
                type="file"
                accept="image/*"
                hidden
                onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file) onPick(file);
                }}
            />
        </div>
    );
}

type ComposerProps = {
    catalog: InteriorCatalog;
    config: AiConfig;
    surface: InteriorSurface;
    draft: InteriorDraft;
    busy: boolean;
    error: string;
    onChange: (patch: Partial<InteriorDraft>) => void;
    onModeChange: (mode: InteriorMode) => void;
    onPickSource: (file: File) => void;
    onPickReference: (file: File) => void;
    onSubmit: () => void;
};

export function InteriorComposer({ catalog, config, surface, draft, busy, error, onChange, onModeChange, onPickSource, onPickReference, onSubmit }: ComposerProps) {
    const modes = useMemo(() => visibleInteriorModes(catalog, surface), [catalog, surface]);
    const mode = modes.find((item) => item.id === draft.modeId);
    const sourceSlot = mode?.slots.find((slot) => slot.key === "source");
    const referenceSlot = mode?.slots.find((slot) => slot.key === "reference");
    const params = (mode?.params || []).filter((param) => surface === "pro" || !param.proOnly);
    const showRoom = Boolean(mode && (mode.requiresRoom || mode.requiresStyle));
    const maxStyles = Math.max(1, catalog.settings.maxStylesPerRun || 1);
    const countLimit = interiorCountLimit(catalog, mode);
    const siteDefault = catalog.settings.defaultModel;
    const recommended = mode?.defaultModel || siteDefault;
    const problem = interiorDraftProblem(draft, mode, surface, config, siteDefault);
    const total = (mode?.requiresStyle ? Math.max(1, draft.styleKeys.length) : 1) * draft.count;
    const estimate = useInteriorEstimate(
        !problem && mode && draft.source
            ? {
                  surface,
                  modeId: mode.id,
                  sourceResourceId: draft.source.resourceId,
                  count: draft.count,
                  ...(draft.roomKey ? { roomKey: draft.roomKey } : {}),
                  ...(mode.requiresStyle ? { styleKeys: draft.styleKeys } : {}),
                  params: draft.params,
                  notes: draft.notes.trim(),
                  referenceResourceIds: draft.references.map((item) => item.resourceId),
                  ...(surface === "pro" ? { size: draft.size === "auto" ? "" : draft.size, quality: draft.quality === "auto" ? "" : draft.quality, model: interiorModelRef(config, draft.modelValue) || undefined } : {}),
              }
            : null,
    );
    const modelFilter = (value: string) => Boolean(mode) && interiorModelPermitted(mode!, siteDefault, interiorModelRef(config, value));

    const toggleStyle = (key: string) => {
        if (draft.styleKeys.includes(key)) onChange({ styleKeys: draft.styleKeys.filter((item) => item !== key) });
        else if (draft.styleKeys.length < maxStyles) onChange({ styleKeys: [...draft.styleKeys, key] });
        else if (maxStyles === 1) onChange({ styleKeys: [key] });
    };

    return (
        <aside className="itd-composer" aria-label="出图设置">
            <div className="itd-composer-scroll thin-scrollbar">
                <section className="itd-section">
                    <h2 className="itd-section-title">出图方式</h2>
                    {modes.length ? (
                        <div className="itd-mode-grid" role="radiogroup" aria-label="出图方式">
                            {modes.map((item) => (
                                <button
                                    key={item.id}
                                    type="button"
                                    role="radio"
                                    aria-checked={item.id === draft.modeId}
                                    className={cn("itd-mode", item.id === draft.modeId && "is-active", item.coverUrl && "has-cover")}
                                    onClick={() => onModeChange(item)}
                                    disabled={busy}
                                >
                                    {item.coverUrl ? <img src={item.coverUrl} alt="" aria-hidden loading="lazy" /> : null}
                                    <strong>{item.name}</strong>
                                    <span>{item.subtitle}</span>
                                </button>
                            ))}
                        </div>
                    ) : (
                        <p className="itd-muted-note is-left">{surface === "pro" ? "专业模式下暂时没有开放的出图方式。" : "暂时没有开放的出图方式。"}</p>
                    )}
                </section>

                {mode ? (
                    <section className="itd-section">
                        <h2 className="itd-section-title">图片</h2>
                        <div className={cn("itd-upload-row", referenceSlot && "has-reference")}>
                            <UploadSlot label={sourceSlot?.name || "原图"} value={draft.source} onPick={onPickSource} onClear={() => onChange({ source: null })} disabled={busy} />
                            {referenceSlot ? <UploadSlot label={referenceSlot.name} value={draft.references[0] || null} onPick={onPickReference} onClear={() => onChange({ references: [] })} disabled={busy} /> : null}
                        </div>
                    </section>
                ) : null}

                {showRoom ? (
                    <section className="itd-section">
                        <h2 className="itd-section-title">空间{mode?.requiresRoom ? null : <small>可选</small>}</h2>
                        {groupPresets(catalog.rooms).map(([group, rooms]) => (
                            <div key={group} className="itd-chip-group">
                                <span className="itd-chip-group-label">{group}</span>
                                <div className="itd-chips">
                                    {rooms.map((room) => (
                                        <button key={room.key} type="button" className="itd-chip" aria-pressed={draft.roomKey === room.key} onClick={() => onChange({ roomKey: draft.roomKey === room.key ? "" : room.key })} disabled={busy}>
                                            {room.name}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </section>
                ) : null}

                {mode?.requiresStyle ? (
                    <section className="itd-section">
                        <h2 className="itd-section-title">
                            风格<small>{maxStyles > 1 ? `最多选 ${maxStyles} 个对比，已选 ${draft.styleKeys.length}` : "选 1 个"}</small>
                        </h2>
                        {groupPresets(catalog.styles).map(([group, styles]) => (
                            <div key={group} className="itd-chip-group">
                                <span className="itd-chip-group-label">{group}</span>
                                <div className="itd-chips">
                                    {styles.map((style) => {
                                        const selected = draft.styleKeys.includes(style.key);
                                        return (
                                            <button
                                                key={style.key}
                                                type="button"
                                                className={cn("itd-chip", style.coverUrl && "has-cover")}
                                                aria-pressed={selected}
                                                title={style.summary}
                                                onClick={() => toggleStyle(style.key)}
                                                disabled={busy || (!selected && draft.styleKeys.length >= maxStyles && maxStyles > 1)}
                                            >
                                                {style.coverUrl ? <img src={style.coverUrl} alt="" aria-hidden /> : null}
                                                {style.name}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
                    </section>
                ) : null}

                {params.length ? (
                    <section className="itd-section">
                        {params.map((param) => (
                            <div key={param.key} className="itd-field">
                                <span className="itd-field-label">{param.label}</span>
                                <SegmentedControl<string>
                                    size="sm"
                                    ariaLabel={param.label}
                                    value={draft.params[param.key] || param.default}
                                    options={param.options.map((option) => ({ value: option.value, label: option.label }))}
                                    onChange={(value) => onChange({ params: { ...draft.params, [param.key]: value } })}
                                    disabled={busy}
                                />
                            </div>
                        ))}
                    </section>
                ) : null}

                {mode ? (
                    <section className="itd-section">
                        <label className="itd-field is-block">
                            <span className="itd-field-label">{mode.notesRequired ? "要改什么" : "补充要求"}</span>
                            <Input.TextArea
                                value={draft.notes}
                                maxLength={500}
                                showCount
                                autoSize={{ minRows: 2, maxRows: 5 }}
                                placeholder={mode.notesRequired ? "例如：把沙发换成浅灰色布艺，茶几换成圆形大理石" : "例如：保留原来的木地板，多一些收纳"}
                                onChange={(event) => onChange({ notes: event.target.value })}
                                disabled={busy}
                            />
                        </label>
                    </section>
                ) : null}

                {mode ? (
                    <section className="itd-section">
                        <div className="itd-field">
                            <span className="itd-field-label">{mode.requiresStyle ? "每个风格出图" : "出图张数"}</span>
                            <SegmentedControl<string>
                                size="sm"
                                ariaLabel="出图张数"
                                value={String(draft.count)}
                                options={Array.from({ length: countLimit }, (_, index) => ({ value: String(index + 1), label: `${index + 1} 张` }))}
                                onChange={(value) => onChange({ count: Number(value) })}
                                disabled={busy}
                            />
                        </div>
                        {surface === "pro" ? (
                            <>
                                <div className="itd-field">
                                    <span className="itd-field-label">画面比例</span>
                                    <Select size="small" className="itd-select" value={draft.size} options={SIZE_OPTIONS} onChange={(size) => onChange({ size })} disabled={busy} />
                                </div>
                                <div className="itd-field">
                                    <span className="itd-field-label">画质</span>
                                    <Select size="small" className="itd-select" value={draft.quality} options={QUALITY_OPTIONS} onChange={(quality) => onChange({ quality })} disabled={busy} />
                                </div>
                                <div className="itd-field is-block">
                                    <span className="itd-field-label">出图模型{recommended ? <small>推荐 {recommended.label || recommended.model}</small> : null}</span>
                                    <ModelPicker
                                        config={config}
                                        value={draft.modelValue}
                                        onChange={(modelValue) => onChange({ modelValue })}
                                        capability="image"
                                        variant="creation"
                                        fullWidth
                                        className="creation-model-picker itd-model-picker"
                                        showSelectedPrice={false}
                                        showOptionPrices
                                        placeholder="选择图片模型"
                                        modelFilter={modelFilter}
                                    />
                                </div>
                            </>
                        ) : null}
                    </section>
                ) : null}
            </div>
            <footer className="itd-composer-foot">
                {estimate ? (
                    <p className="itd-muted-note" role="status">
                        {estimate}
                    </p>
                ) : null}
                {error ? (
                    <p className="itd-inline-error" role="alert">
                        {error}
                    </p>
                ) : null}
                <Button type="primary" size="large" block icon={busy ? <LoaderCircle className="size-4 motion-safe:animate-spin" aria-hidden /> : <Sparkles className="size-4" aria-hidden />} disabled={Boolean(problem) || busy} onClick={onSubmit}>
                    {busy ? "正在提交" : `生成效果图 · ${total} 张`}
                </Button>
                {problem && !busy ? <p className="itd-muted-note">{problem}</p> : null}
            </footer>
        </aside>
    );
}
