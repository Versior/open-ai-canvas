import { useId, useRef, useState } from "react";
import { Button, Input, InputNumber } from "antd";
import { Check, Plus } from "lucide-react";
import { Switch } from "@/components/ui/base/switch";
import { AppModal } from "@/components/ui/product/app-modal";
import "./image-size-picker.css";
import type { ImageCapabilityConfig } from "@/lib/model-capabilities";
import { DEFAULT_IMAGE_RATIOS, IMAGE_RATIOS, imageResolutionTiers, imagePresetForRatio, imageResolutionUsesQuality, imageSizeConfigWithPresets, imageSizePresets, imageTierAvailable } from "@/lib/image-size-presets";
import { parseImageDimensions, validateImageSize } from "@/services/api/image-validation";
import { imageRatioForSize, type ImageResolutionOption, type ImageResolutionTier } from "@/lib/image-resolution-tiers";

type SizeEditorProps = {
    profile: ImageCapabilityConfig;
    disabled?: boolean;
    onChange: (size: ImageCapabilityConfig["size"]) => void;
    onClearDefault?: () => void;
};

export function ImageDefaultOutput({ profile, disabled, onChange, onClearDefault }: SizeEditorProps) {
    const { size } = profile;
    const field = profile.parameters?.find((p) => p.name === "size");
    const pixels = field?.encoding ? field.encoding === "pixels" : size.parameter === "size";
    const current = field ? field.default : size.default;
    const exact = typeof current === "string" ? parseImageDimensions(current) : null;
    const presets = imageSizePresets(profile);
    const tier = profile.resolution.supported && profile.resolution.default !== "auto" ? profile.resolution.default : size.defaultTier;
    const inTier = (item: ImageResolutionOption) => !tier || item.tier === tier;
    const options = new Map<string, string>();
    // Labels are a projection only. The value sent when selecting a ratio must still belong to the field's contract.
    for (const value of size.values) {
        if (parseImageDimensions(value)) continue;
        if (!presets.some((p) => p.ratio === value) || presets.some((p) => inTier(p) && p.ratio === value)) options.set(value, value);
    }
    if (pixels) {
        for (const p of presets.filter(inTier)) {
            if (p.size && !options.has(p.ratio) && (!size.values.length || size.values.includes(p.size))) options.set(p.ratio, p.size);
        }
        for (const value of size.values) {
            if (!parseImageDimensions(value) || (size.presets ?? presets).some((p) => p.size === value)) continue;
            const ratio = imageRatioForSize(value);
            if (ratio && !options.has(ratio)) options.set(ratio, value);
        }
    }
    const [draft, setDraft] = useState<{ width: string; height: string } | null>(null);
    const [error, setError] = useState("");
    const customButton = useRef<HTMLButtonElement>(null);
    const id = useId();
    const customSelected = Boolean(exact && ![...options.values()].includes(String(current)));
    const select = (value: string) => {
        onChange({ ...size, default: value, values: size.values.length && !size.values.includes(value) ? [...size.values, value] : size.values });
        setDraft(null);
    };
    const apply = () => {
        if (!draft) return;
        try {
            const width = Number(draft.width),
                height = Number(draft.height);
            if (!/^\d+$/.test(draft.width) || !/^\d+$/.test(draft.height) || width <= 0 || height <= 0) throw new Error("宽度和高度都必须是正整数");
            const value = `${width}x${height}`;
            const mapped = (size.presets ?? presets).filter((p) => p.size === value);
            // Model-declared sizes remain selectable; generic custom-size limits apply only to new sizes.
            if (!mapped.length && !size.values.includes(value)) validateImageSize(width, height, !field);
            if (tier && mapped.length && !mapped.some(inTier)) throw new Error(`此尺寸不属于 ${tier.toUpperCase()} 档，请先切换默认分辨率`);
            if (field?.maxLength !== undefined && value.length > field.maxLength) throw new Error("尺寸超出协议长度限制");
            select(value);
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : "像素尺寸无效");
        }
    };
    return (
        <div className="image-size-defaults">
            <strong id={`${id}-label`}>默认输出</strong>
            <div className="image-size-default-options" role="group" aria-labelledby={`${id}-label`} aria-label="默认输出">
                {onClearDefault && (
                    <button
                        type="button"
                        disabled={disabled}
                        aria-pressed={current === undefined}
                        onClick={() => {
                            setDraft(null);
                            onClearDefault();
                        }}
                    >
                        跟随模型默认
                    </button>
                )}
                {[...options].map(([label, value]) => (
                    <button key={label} type="button" disabled={disabled} aria-pressed={current === value} title={value !== label ? value : undefined} onClick={() => select(value)}>
                        {label === "auto" ? "自动" : label}
                    </button>
                ))}
                {pixels && (
                    <button
                        ref={customButton}
                        type="button"
                        disabled={disabled}
                        aria-pressed={customSelected}
                        aria-haspopup="dialog"
                        aria-expanded={Boolean(draft)}
                        onClick={() => {
                            setError("");
                            setDraft({ width: exact ? String(exact.width) : "", height: exact ? String(exact.height) : "" });
                        }}
                    >
                        自定义尺寸{customSelected && exact && ` · ${exact.width} × ${exact.height}`}
                    </button>
                )}
            </div>
            {pixels && (
                <AppModal
                    open={Boolean(draft)}
                    title="自定义尺寸"
                    width={360}
                    centered
                    mask={{ closable: false }}
                    okText="应用尺寸"
                    cancelText="取消"
                    okButtonProps={{ disabled }}
                    onOk={apply}
                    onCancel={() => setDraft(null)}
                    afterClose={() => customButton.current?.focus({ preventScroll: true })}
                >
                    {draft && (
                        <div className="image-size-custom-default">
                            {(
                                [
                                    ["width", "宽度"],
                                    ["height", "高度"],
                                ] as const
                            ).map(([key, label]) => (
                                <label key={key}>
                                    <span>{label}（px）</span>
                                    <Input
                                        inputMode="numeric"
                                        autoComplete="off"
                                        disabled={disabled}
                                        value={draft[key]}
                                        aria-invalid={Boolean(error)}
                                        aria-describedby={error ? `${id}-error` : undefined}
                                        onChange={(event) => {
                                            setDraft({ ...draft, [key]: event.target.value });
                                            setError("");
                                        }}
                                        onPressEnter={(event) => {
                                            event.preventDefault();
                                            if (!event.nativeEvent.isComposing) apply();
                                        }}
                                    />
                                </label>
                            ))}
                            {error && (
                                <p id={`${id}-error`} role="alert" className="image-size-error">
                                    {error}
                                </p>
                            )}
                        </div>
                    )}
                </AppModal>
            )}
        </div>
    );
}

export function ImageSizePresetsEditor({
    profile,
    disabled,
    onChange,
    onClearDefault,
    tiers,
    ratios: allowedRatios,
    allowCustomRatio = true,
    grouped = true,
    defaultPresets = [],
}: SizeEditorProps & {
    tiers?: string[];
    ratios?: string[];
    allowCustomRatio?: boolean;
    grouped?: boolean;
    defaultPresets?: ImageResolutionOption[];
}) {
    const IMAGE_RESOLUTIONS = tiers ?? imageResolutionTiers(profile);
    const presets = imageSizePresets(profile);
    const id = useId();
    const [drafts, setDrafts] = useState<Partial<Record<ImageResolutionTier, string>>>({});
    const [errors, setErrors] = useState<Partial<Record<ImageResolutionTier, string>>>({});
    const candidate = (tier: string, ratio: string) => {
        const existing = presets.find((preset) => preset.tier === tier && preset.ratio === ratio) || defaultPresets.find((preset) => preset.tier === tier && preset.ratio === ratio);
        if (existing) return existing;
        try {
            return imagePresetForRatio(tier, ratio);
        } catch {
            return { tier, ratio, width: 0, height: 0, size: "" };
        }
    };
    const toggleTier = (tier: ImageResolutionTier, ratios: string[], enabled: boolean) => {
        if (disabled) return;
        update(tier, enabled ? ratios : []);
    };
    const update = (tier: ImageResolutionTier, ratios: string[]) => {
        if (disabled) return false;
        try {
            const next = [
                ...new Map(
                    ratios.map((ratio) => {
                        if (!/^\d+[:：]\d+$/.test(ratio) || ratio.split(/[:：]/).some((part) => Number(part) <= 0)) throw new Error("请输入正数比例，例如 16:9");
                        const preset = candidate(tier, ratio);
                        return [preset.ratio, preset] as const;
                    }),
                ).values(),
            ];
            onChange(imageSizeConfigWithPresets(profile, [...presets.filter((preset) => preset.tier !== tier), ...next]));
            setErrors((current) => ({ ...current, [tier]: "" }));
            return true;
        } catch (reason) {
            setErrors((current) => ({ ...current, [tier]: reason instanceof Error ? reason.message : "比例格式无效" }));
            return false;
        }
    };
    const editDimensions = (tier: ImageResolutionTier, ratio: string, field: "width" | "height", rawValue: number | null) => {
        if (disabled) return;
        const value = rawValue == null ? NaN : Math.round(rawValue);
        const selected = presets.find((preset) => preset.tier === tier && preset.ratio === ratio);
        if (!selected || !Number.isInteger(value) || value <= 0) {
            setErrors((current) => ({ ...current, [tier]: "请输入正整数像素" }));
            return;
        }
        const width = field === "width" ? value : selected.width;
        const height = field === "height" ? value : selected.height;
        try {
            if (width > 0 && height > 0) validateImageSize(width, height, !profile.parameters);
            const next = presets.map((preset) => (preset === selected ? { ...preset, width, height, size: `${width}x${height}` } : preset));
            onChange(imageSizeConfigWithPresets(profile, next));
            setErrors((current) => ({ ...current, [tier]: "" }));
        } catch (reason) {
            setErrors((current) => ({ ...current, [tier]: reason instanceof Error ? reason.message : "像素尺寸无效" }));
        }
    };
    const addRatio = (tier: ImageResolutionTier) => {
        const ratios = (drafts[tier] || "")
            .split(/[,，\n]/)
            .map((value) => value.trim())
            .filter(Boolean);
        if (!ratios.length) return;
        if (update(tier, [...presets.filter((preset) => preset.tier === tier).map((preset) => preset.ratio), ...ratios])) {
            setDrafts((current) => ({ ...current, [tier]: "" }));
        }
    };
    const mappings = (
        <details className="image-size-mappings" open={presets.some((preset) => !preset.width || !preset.height || !preset.size) || undefined}>
            <summary>编辑比例与像素映射</summary>
            {IMAGE_RESOLUTIONS.map((tier) => {
                const items = presets.filter((preset) => preset.tier === tier);
                const ratios = [...new Set([...(allowedRatios ?? IMAGE_RATIOS), ...items.map((item) => item.ratio)])];
                return (
                    <section key={tier} className={`image-size-preset-group${grouped ? "" : " is-ungrouped"}`} aria-label={grouped ? undefined : "比例配置"} aria-labelledby={grouped ? `${id}-${tier}-title` : undefined}>
                        {grouped ? (
                            <header className="image-size-preset-heading">
                                <div className="image-size-preset-heading-label">
                                    <strong id={`${id}-${tier}-title`}>{tier.toUpperCase()}</strong>
                                    <span>{items.length ? `${items.length} 个比例` : "未启用"}</span>
                                    {!profile.parameters ? <Switch size="sm" checked={items.length > 0} disabled={disabled} aria-label={`启用 ${tier.toUpperCase()} 规格`} onChange={(enabled) => toggleTier(tier, ratios, enabled)} /> : null}
                                </div>
                                {!items.length && DEFAULT_IMAGE_RATIOS.some((ratio) => ratios.includes(ratio)) ? (
                                    <Button
                                        size="small"
                                        disabled={disabled}
                                        onClick={() =>
                                            update(
                                                tier,
                                                DEFAULT_IMAGE_RATIOS.filter((ratio) => ratios.includes(ratio)),
                                            )
                                        }
                                    >
                                        选择常用比例
                                    </Button>
                                ) : null}
                            </header>
                        ) : null}
                        <div className="image-size-preset-body">
                            {items.some((item) => !item.width || !item.height || !item.size) ? (
                                <p role="alert" className="image-size-error">
                                    请填写所选比例的宽度和高度，完成像素尺寸配置后再保存。
                                </p>
                            ) : null}
                            {imageResolutionUsesQuality(profile) && !imageTierAvailable(profile, tier) ? <p className="image-size-hint">需先配置此档位对应的质量值，用户端才会开放。</p> : null}
                            <div className="image-size-preset-options" role="group" aria-label={grouped ? `${tier.toUpperCase()} 支持的宽高比` : "支持的宽高比"}>
                                {ratios.map((ratio) => {
                                    const selected = items.find((item) => item.ratio === ratio);
                                    const dimensions = selected || candidate(tier, ratio);
                                    return (
                                        <div key={ratio} className="image-size-preset-option-wrap">
                                            <button
                                                type="button"
                                                disabled={disabled}
                                                aria-pressed={Boolean(selected)}
                                                aria-label={grouped ? `${tier.toUpperCase()} ${ratio}` : ratio}
                                                className="image-size-preset-option"
                                                title={`${ratio}${dimensions.width && dimensions.height ? ` · ${dimensions.width} × ${dimensions.height} px` : ""}${selected ? " · 点击移除" : " · 点击添加"}`}
                                                onClick={() => update(tier, selected ? items.filter((item) => item.ratio !== ratio).map((item) => item.ratio) : [...items.map((item) => item.ratio), ratio])}
                                            >
                                                <span className="image-size-preset-option-label">
                                                    <span>{ratio}</span>
                                                    {selected ? <Check size={12} aria-hidden="true" /> : <Plus size={12} aria-hidden="true" />}
                                                </span>
                                                <small>{dimensions.width && dimensions.height ? `${dimensions.width} × ${dimensions.height}` : "设置尺寸"}</small>
                                            </button>
                                            {selected ? (
                                                <div className="image-size-preset-dimensions" aria-label={`${tier.toUpperCase()} ${ratio} 精确像素`}>
                                                    <label>
                                                        <span>宽</span>
                                                        <InputNumber
                                                            controls={false}
                                                            min={1}
                                                            precision={0}
                                                            value={selected.width || null}
                                                            disabled={disabled}
                                                            aria-label={`${grouped ? tier.toUpperCase() + " " : ""}${ratio} 宽度像素`}
                                                            onChange={(value) => editDimensions(tier, ratio, "width", value)}
                                                        />
                                                    </label>
                                                    <span aria-hidden="true">×</span>
                                                    <label>
                                                        <span>高</span>
                                                        <InputNumber
                                                            controls={false}
                                                            min={1}
                                                            precision={0}
                                                            value={selected.height || null}
                                                            disabled={disabled}
                                                            aria-label={`${grouped ? tier.toUpperCase() + " " : ""}${ratio} 高度像素`}
                                                            onChange={(value) => editDimensions(tier, ratio, "height", value)}
                                                        />
                                                    </label>
                                                </div>
                                            ) : null}
                                        </div>
                                    );
                                })}
                            </div>
                            {allowCustomRatio ? (
                                <div className="image-size-preset-add">
                                    <Input
                                        aria-label={`${tier.toUpperCase()} 自定义比例`}
                                        aria-invalid={Boolean(errors[tier])}
                                        aria-describedby={errors[tier] ? `${id}-${tier}-error` : undefined}
                                        disabled={disabled}
                                        placeholder="其他比例，如 17:11"
                                        value={drafts[tier] || ""}
                                        onChange={(event) => {
                                            setDrafts((current) => ({ ...current, [tier]: event.target.value }));
                                            setErrors((current) => ({ ...current, [tier]: "" }));
                                        }}
                                        onPressEnter={(event) => {
                                            event.preventDefault();
                                            event.stopPropagation();
                                            addRatio(tier);
                                        }}
                                    />
                                    <Button disabled={disabled || !drafts[tier]?.trim()} icon={<Plus size={14} />} onClick={() => addRatio(tier)} aria-label={`添加 ${tier.toUpperCase()} 比例`}>
                                        添加
                                    </Button>
                                </div>
                            ) : null}
                            {errors[tier] ? (
                                <p id={`${id}-${tier}-error`} role="alert" className="image-size-error">
                                    {errors[tier]}
                                </p>
                            ) : null}
                        </div>
                    </section>
                );
            })}
        </details>
    );
    return (
        <div className="image-size-presets-editor">
            <ImageDefaultOutput profile={profile} disabled={disabled} onChange={onChange} onClearDefault={onClearDefault} />
            {mappings}
        </div>
    );
}
