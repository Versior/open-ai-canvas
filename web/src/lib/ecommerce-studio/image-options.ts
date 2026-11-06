import { imageQualityLabel } from "@/lib/image-quality";
import { imagePresetForRatio, imagePresetValue, imageQualityForTier, imageResolutionTiers, imageResolutionUsesQuality, imageSizePresets, imageTierAvailable } from "@/lib/image-size-presets";
import type { ImageCapabilityConfig } from "@/lib/model-capabilities";
import { studioNearestRatio } from "./brief";

/**
 * 表单里「质量」「比例」两个下拉框的选项，全部从当前图片模型的能力配置里取，
 * 选中的值再交给 ecommerceImageSettings 换成模型真正接受的尺寸参数。
 */
export type StudioQualityOption = { value: string; label: string };

const TIER_ORDER = ["1k", "1.5k", "2k", "4k"];

/**
 * 生图台可用的尺寸预设。画布对按参数声明的模型只给默认档位（通常 1K）；
 * 生图台按模型声明接受的尺寸放开其余档位：预设的尺寸在模型的尺寸取值里，或者模型允许自定义尺寸。
 */
function studioSizePresets(profile: ImageCapabilityConfig) {
    const presets = profile.size.parameter === "size" ? profile.size.presets : undefined;
    if (!presets?.length) return imageSizePresets(profile);
    return presets.filter((preset) => profile.size.allowCustom || profile.size.values.includes(preset.size));
}

/** 按像素尺寸出图的模型：尺寸预设分了几档清晰度（1K、2K…），按档位排好。 */
function sizeTiers(profile: ImageCapabilityConfig) {
    if (profile.size.parameter !== "size") return [];
    const tiers = [...new Set(studioSizePresets(profile).map((preset) => String(preset.tier)))];
    return tiers.sort((a, b) => (TIER_ORDER.indexOf(a) + 1 || 99) - (TIER_ORDER.indexOf(b) + 1 || 99));
}

/**
 * 「质量」选的是哪种参数：独立分辨率参数、质量档，或者——质量只声明了 auto 的按尺寸出图模型（如 GPT Image）——
 * 尺寸预设的清晰度档位，选中档位后按比例落到这一档的具体尺寸。
 */
function qualityMode(profile: ImageCapabilityConfig): "resolution" | "quality" | "tier" | "none" {
    if (profile.resolution.supported) return "resolution";
    if (profile.quality.supported && profile.quality.values.length >= 2) return "quality";
    return sizeTiers(profile).length >= 2 ? "tier" : "none";
}

/** 这个模型「质量」下拉框的选项：有独立分辨率参数时选分辨率，有多档质量时选质量，否则选尺寸档位；都没有时为空。 */
export function studioQualityOptions(profile: ImageCapabilityConfig | undefined): StudioQualityOption[] {
    if (!profile) return [];
    const mode = qualityMode(profile);
    if (mode === "resolution") return profile.resolution.values.map((value) => ({ value, label: imageQualityLabel(value) }));
    if (mode === "tier") return sizeTiers(profile).map((tier) => ({ value: tier, label: tier.toUpperCase() }));
    if (mode === "none") return [];
    const tiered = imageResolutionUsesQuality(profile);
    return profile.quality.values.map((value) => {
        const tier = tiered ? imageResolutionTiers(profile).find((item) => imageQualityForTier(profile, item) === value) : undefined;
        return { value, label: tier ? tier.toUpperCase() : imageQualityLabel(value) };
    });
}

export function studioDefaultQuality(profile: ImageCapabilityConfig | undefined) {
    if (!profile) return "";
    const mode = qualityMode(profile);
    if (mode === "resolution") return profile.resolution.default;
    if (mode === "tier") {
        // 质量只有 auto、靠尺寸档位分清晰度的模型（如部分渠道的 GPT Image 2）：和「清晰度」一样用生图台默认档位，不跟模型默认尺寸走。
        const tiers = sizeTiers(profile);
        if (tiers.includes(STUDIO_PREFERRED_TIER)) return STUDIO_PREFERRED_TIER;
        const preset = studioSizePresets(profile).find((item) => item.size === profile.size.default);
        return preset && tiers.includes(String(preset.tier)) ? String(preset.tier) : tiers[0];
    }
    return profile.quality.supported ? profile.quality.default : "";
}

/** 选中的质量在当前模型下无效时（比如换了模型）回到模型默认值。 */
export function studioEffectiveQuality(profile: ImageCapabilityConfig | undefined, quality: string) {
    const options = studioQualityOptions(profile);
    return options.some((option) => option.value === quality) ? quality : studioDefaultQuality(profile);
}

/** 生图台默认的清晰度：模型有 1K 档时用 1K，要更清楚时由用户在下拉框里选 2K、4K。 */
export const STUDIO_PREFERRED_TIER = "1k";

/**
 * 「清晰度」下拉框：模型同时有多档质量和多档尺寸（如 GPT Image 的 low/medium/high 加 1K/2K/4K）时，
 * 质量选质量，清晰度单独选尺寸档位；其他模型的清晰度已经在「质量」里，这里为空。
 */
export function studioResolutionOptions(profile: ImageCapabilityConfig | undefined): StudioQualityOption[] {
    if (!profile || qualityMode(profile) !== "quality") return [];
    const tiers = sizeTiers(profile);
    return tiers.length >= 2 ? tiers.map((tier) => ({ value: tier, label: tier.toUpperCase() })) : [];
}

/** 选中的清晰度在当前模型下无效时，优先 1K，没有 1K 时用模型默认尺寸所在的档位。 */
export function studioEffectiveResolution(profile: ImageCapabilityConfig | undefined, resolution: string) {
    const options = studioResolutionOptions(profile);
    if (!profile || !options.length) return "";
    if (options.some((option) => option.value === resolution)) return resolution;
    if (options.some((option) => option.value === STUDIO_PREFERRED_TIER)) return STUDIO_PREFERRED_TIER;
    const preset = studioSizePresets(profile).find((item) => item.size === profile.size.default);
    return preset && options.some((option) => option.value === String(preset.tier)) ? String(preset.tier) : options[0].value;
}

function presetTier(profile: ImageCapabilityConfig, quality: string, resolution: string) {
    if (profile.resolution.supported) return quality.toLowerCase() || profile.resolution.default.toLowerCase();
    if (qualityMode(profile) === "tier") return quality || studioDefaultQuality(profile);
    return studioEffectiveResolution(profile, resolution) || profile.size.defaultTier || studioSizePresets(profile).find((preset) => preset.size === profile.size.default)?.tier;
}

/** 这个模型在所选质量和清晰度下能出的比例；不接受尺寸参数的模型返回空数组，由模型自己决定。 */
export function studioRatioOptions(profile: ImageCapabilityConfig | undefined, quality: string, resolution = ""): string[] {
    if (!profile || profile.size.parameter === "none") return [];
    if (profile.size.parameter === "aspect_ratio") return profile.size.values.filter((value) => /^\d+:\d+$/.test(value));
    const tier = presetTier(profile, quality, resolution);
    const presets = studioSizePresets(profile).filter((preset) => imageTierAvailable(profile, preset.tier) && (!tier || preset.tier === tier));
    return [...new Set(presets.map((preset) => preset.ratio))];
}

/** 按像素尺寸出图、且允许自定义尺寸的模型：自定义比例按所选档位算出具体尺寸，不用落到最接近的预设比例。 */
export function studioCustomRatioSupported(profile: ImageCapabilityConfig | undefined) {
    return Boolean(profile && profile.size.parameter === "size" && profile.size.allowCustom);
}

/** 把想要的比例落到模型支持的比例上：完全支持就用原值，否则取最接近的一个。 */
export function studioSupportedRatio(ratio: string, options: string[]) {
    if (!options.length) return undefined;
    if (options.includes(ratio)) return ratio;
    const [width, height] = ratio.split(":").map(Number);
    return studioNearestRatio(width, height, options) || options[0];
}

/** 自定义比例在这一档的具体尺寸（16 的倍数，长边不超过 3840）；比例不合法时返回 undefined。 */
function customSize(tier: string, ratio: string) {
    try {
        return imagePresetForRatio(tier as Parameters<typeof imagePresetForRatio>[0], ratio).size;
    } catch {
        return undefined;
    }
}

/**
 * 提交时的生图参数：比例写进 aspectRatio，质量按模型协议写进 quality 或 imageResolution。
 * 选了清晰度时直接给这一档对应比例的具体尺寸；不给尺寸时上游会按模型默认档位（通常是 1K）出。
 */
export type StudioImageRequest = { aspectRatio?: string; imageSettings: { quality?: string; imageResolution?: string; size?: string } };

export function studioImageRequest(profile: ImageCapabilityConfig | undefined, quality: string, ratio: string, resolution = ""): StudioImageRequest {
    const effective = studioEffectiveQuality(profile, quality);
    const tierChoice = studioEffectiveResolution(profile, resolution);
    const options = studioRatioOptions(profile, effective, tierChoice);
    const aspectRatio = studioSupportedRatio(ratio, options);
    if (profile && effective && qualityMode(profile) === "tier") {
        // 选的是尺寸档位：直接给这一档里对应比例的具体尺寸，模型的质量参数保持默认。
        const preset = studioSizePresets(profile).find((item) => String(item.tier) === effective && item.ratio === aspectRatio);
        const custom = !options.includes(ratio) && studioCustomRatioSupported(profile) ? customSize(effective, ratio) : undefined;
        // 按自定义尺寸出时比例就是用户写的比例；否则是落到的预设比例。
        if (custom) return { aspectRatio: ratio, imageSettings: { size: custom } };
        return { ...(aspectRatio ? { aspectRatio } : {}), imageSettings: preset ? { size: imagePresetValue(profile, preset) } : {} };
    }
    const imageSettings: { quality?: string; imageResolution?: string; size?: string } = !profile || !effective ? {} : profile.resolution.supported ? { imageResolution: effective } : profile.quality.supported ? { quality: effective } : {};
    if (profile && tierChoice) {
        const custom = !options.includes(ratio) && studioCustomRatioSupported(profile) ? customSize(tierChoice, ratio) : undefined;
        const preset = studioSizePresets(profile).find((item) => String(item.tier) === tierChoice && item.ratio === aspectRatio);
        const size = custom || (preset ? imagePresetValue(profile, preset) : undefined);
        if (size) imageSettings.size = size;
        if (custom) return { aspectRatio: ratio, imageSettings };
    }
    return { ...(aspectRatio ? { aspectRatio } : {}), imageSettings };
}
