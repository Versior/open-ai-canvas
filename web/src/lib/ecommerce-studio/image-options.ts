import { imageQualityLabel } from "@/lib/image-quality";
import { imagePresetValue, imageQualityForTier, imageResolutionTiers, imageResolutionUsesQuality, imageSizePresets, imageTierAvailable } from "@/lib/image-size-presets";
import type { ImageCapabilityConfig } from "@/lib/model-capabilities";
import { studioNearestRatio } from "./brief";

/**
 * 表单里「质量」「比例」两个下拉框的选项，全部从当前图片模型的能力配置里取，
 * 选中的值再交给 ecommerceImageSettings 换成模型真正接受的尺寸参数。
 */
export type StudioQualityOption = { value: string; label: string };

const TIER_ORDER = ["1k", "1.5k", "2k", "4k"];

/** 按像素尺寸出图的模型：尺寸预设分了几档清晰度（1K、2K…），按档位排好。 */
function sizeTiers(profile: ImageCapabilityConfig) {
    if (profile.size.parameter !== "size") return [];
    const tiers = [...new Set(imageSizePresets(profile).map((preset) => String(preset.tier)))];
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
        const tiers = sizeTiers(profile);
        const preset = imageSizePresets(profile).find((item) => item.size === profile.size.default);
        return preset && tiers.includes(String(preset.tier)) ? String(preset.tier) : tiers[0];
    }
    return profile.quality.supported ? profile.quality.default : "";
}

/** 选中的质量在当前模型下无效时（比如换了模型）回到模型默认值。 */
export function studioEffectiveQuality(profile: ImageCapabilityConfig | undefined, quality: string) {
    const options = studioQualityOptions(profile);
    return options.some((option) => option.value === quality) ? quality : studioDefaultQuality(profile);
}

function presetTier(profile: ImageCapabilityConfig, quality: string) {
    if (profile.resolution.supported) return quality.toLowerCase() || profile.resolution.default.toLowerCase();
    if (qualityMode(profile) === "tier") return quality || studioDefaultQuality(profile);
    return profile.size.defaultTier || imageSizePresets(profile).find((preset) => preset.size === profile.size.default)?.tier;
}

/** 这个模型在所选质量下能出的比例；不接受尺寸参数的模型返回空数组，由模型自己决定。 */
export function studioRatioOptions(profile: ImageCapabilityConfig | undefined, quality: string): string[] {
    if (!profile || profile.size.parameter === "none") return [];
    if (profile.size.parameter === "aspect_ratio") return profile.size.values.filter((value) => /^\d+:\d+$/.test(value));
    const tier = presetTier(profile, quality);
    const presets = imageSizePresets(profile).filter((preset) => imageTierAvailable(profile, preset.tier) && (!tier || preset.tier === tier));
    return [...new Set(presets.map((preset) => preset.ratio))];
}

/** 把想要的比例落到模型支持的比例上：完全支持就用原值，否则取最接近的一个。 */
export function studioSupportedRatio(ratio: string, options: string[]) {
    if (!options.length) return undefined;
    if (options.includes(ratio)) return ratio;
    const [width, height] = ratio.split(":").map(Number);
    return studioNearestRatio(width, height, options) || options[0];
}

/** 提交时的生图参数：比例写进 aspectRatio，质量按模型协议写进 quality 或 imageResolution。 */
export function studioImageRequest(profile: ImageCapabilityConfig | undefined, quality: string, ratio: string) {
    const effective = studioEffectiveQuality(profile, quality);
    const aspectRatio = studioSupportedRatio(ratio, studioRatioOptions(profile, effective));
    if (profile && effective && qualityMode(profile) === "tier") {
        // 选的是尺寸档位：直接给这一档里对应比例的具体尺寸，模型的质量参数保持默认。
        const preset = imageSizePresets(profile).find((item) => String(item.tier) === effective && item.ratio === aspectRatio);
        return { ...(aspectRatio ? { aspectRatio } : {}), imageSettings: preset ? { size: imagePresetValue(profile, preset) } : {} };
    }
    const imageSettings = !profile || !effective ? {} : profile.resolution.supported ? { imageResolution: effective } : profile.quality.supported ? { quality: effective } : {};
    return { ...(aspectRatio ? { aspectRatio } : {}), imageSettings };
}
