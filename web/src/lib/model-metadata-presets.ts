import { defaultModelCapabilityConfig, type ModelCapabilityConfig } from "./model-capabilities";

export type ModelMetadataPreset = {
    provider?: string; id: string; name: string; context: number; output: number;
    reasoning: boolean; vision: boolean; maxImages?: number;
};
export type ModelMetadataCatalog = { source: string; fetchedAt: string; sha256: string; models: ModelMetadataPreset[] };

export const presetKey = (preset: ModelMetadataPreset) => preset.id;

// One configuration per exact model ID. Disagreeing entries use their safe intersection.
export function consolidateModelPresets(models: ModelMetadataPreset[]): ModelMetadataPreset[] {
    const grouped = new Map<string, ModelMetadataPreset>();
    for (const { provider: _provider, ...model } of models) {
        const existing = grouped.get(model.id);
        if (!existing) {
            grouped.set(model.id, { ...model });
            continue;
        }
        const counts = [existing.maxImages, model.maxImages].filter((count): count is number => count !== undefined);
        grouped.set(model.id, {
            ...existing,
            name: existing.name.localeCompare(model.name, "en") <= 0 ? existing.name : model.name,
            context: Math.min(existing.context, model.context), output: Math.min(existing.output, model.output),
            reasoning: existing.reasoning && model.reasoning, vision: existing.vision && model.vision,
            ...(counts.length ? { maxImages: Math.min(...counts) } : {}),
        });
    }
    return [...grouped.values()];
}

export function normalizedModelName(id: string): string {
    return (id.trim().split("/").pop() || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function baseModelName(id: string): string {
    return normalizedModelName(id).replace(/-(?:high|medium|low|xhigh|thinking|nothinking|latest)$/, "").replace(/-(?:20\d{2}-?\d{2}-?\d{2}|\d{4})$/, "");
}

// A family fallback is allowed for local price templates, never for model limits.
export function modelMatchScore(id: string, candidate: string, allowFamily = false): number {
    if (!id.trim() || !candidate.trim()) return 0;
    if (id.trim().toLowerCase() === candidate.trim().toLowerCase()) return 4;
    if (normalizedModelName(id) === normalizedModelName(candidate)) return 3;
    const a = baseModelName(id), b = baseModelName(candidate);
    if (a === b) return 2;
    const family = (name: string) => name.replace(/\d+/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "");
    return allowFamily && /\d/.test(a) && /\d/.test(b) && family(a) === family(b) && family(a).length >= 3 ? 1 : 0;
}

export function matchingModelPresets(models: ModelMetadataPreset[], id: string) {
    const scored = models.map((model) => ({ model, score: Math.max(modelMatchScore(id, model.id), modelMatchScore(id, model.name)) }));
    const best = Math.max(0, ...scored.map(({ score }) => score));
    if (!best) return [];
    let matches = scored.filter(({ score }) => score === best).map(({ model }) => model).sort((a, b) => a.id.localeCompare(b.id, "en"));
    if (matches.some((model) => !model.id.includes("/"))) matches = matches.filter((model) => !model.id.includes("/"));
    if (new Set(matches.map((model) => baseModelName(model.id))).size !== 1) return [];
    // Aliases of the same normalized model use the same conservative intersection.
    return consolidateModelPresets(matches.map((model) => ({ ...model, id: matches[0].id })));
}

let catalogPromise: Promise<ModelMetadataPreset[]> | undefined;
export function loadModelMetadataPresets(): Promise<ModelMetadataPreset[]> {
    return catalogPromise ??= import("./data/model-metadata-presets.json").then((data) => consolidateModelPresets(data.default.models)).catch((error) => { catalogPromise = undefined; throw error; });
}

export function presetApplicationError(preset: ModelMetadataPreset, capability: string) {
    if (capability !== "text") return "此目录提供文本模型能力，图片输入不代表图片生成能力。";
    if (preset.context < 4096 || preset.context > 10_000_000 || preset.output < 256 || preset.output > 1_000_000 || preset.output >= preset.context) {
        return "该条目的窗口或输出口径超出当前能力配置范围，请参考原始数据手动设置；不会自动截断参数。";
    }
    return "";
}

export function presetModelIcon(preset: Pick<ModelMetadataPreset, "id" | "provider">): string {
    return modelFamilyIdentity(preset.id)?.icon || "";
}

// Identity is inferred from the model name, independently of capability limits or channel vendor.
export function modelFamilyIdentity(id: string): { category: string; icon: string } | undefined {
    const name = normalizedModelName(id);
    const families: [RegExp, string, string][] = [
        [/^claude(?:-|$)/, "Claude", "Claude"], [/^gemini(?:-|$)/, "Gemini", "Gemini"], [/^gemma(?:-|$)/, "Gemma", "Gemma"],
        [/^(?:gpt|chatgpt)(?:-|$)|^o[134](?:-|$)/, "GPT", "OpenAI"], [/^deepseek(?:-|$)/, "DeepSeek", "DeepSeek"],
        [/^qwen(?:[0-9]|-|$)/, "Qwen", "Qwen"], [/^kimi(?:-|$)/, "Kimi", "Moonshot"], [/^glm(?:-|$)/, "GLM", "ZAI"],
        [/^minimax(?:-|$)/, "MiniMax", "Minimax"], [/^grok(?:-|$)/, "Grok", "Grok"],
        [/^(?:mistral|magistral|pixtral|devstral|ministral)(?:-|$)/, "Mistral", "Mistral"],
        [/^llama(?:[0-9]|-|$)/, "Llama", "Meta"], [/^mimo(?:-|$)/, "MiMo", "XiaomiMiMo"], [/^step(?:[0-9]|-|$)/, "Step", "Stepfun"],
        [/^flux(?:[0-9]|-|$)/, "FLUX", "Flux"], [/^(?:midjourney|mj)(?:-|$)/, "Midjourney", "Midjourney"],
        [/^ideogram(?:-|$)/, "Ideogram", "Ideogram"], [/^recraft(?:-|$)/, "Recraft", "Recraft"],
        [/^(?:stable-diffusion|sdxl)(?:-|$)/, "Stable Diffusion", "Stability"],
        [/^sora(?:-|$)/, "Sora", "Sora"], [/^veo(?:-|$)/, "Veo", "Gemini"],
        [/^kling(?:-|$)/, "Kling", "Kling"], [/^vidu(?:-|$)/, "Vidu", "Vidu"], [/^hailuo(?:-|$)/, "Hailuo", "Hailuo"],
        [/^seedance(?:-|$)/, "Seedance", "Doubao"], [/^seedream(?:-|$)/, "Seedream", "Doubao"],
        [/^doubao(?:-|$)/, "Doubao", "Doubao"], [/^jimeng(?:-|$)/, "Jimeng", "Jimeng"],
        [/^hunyuan(?:-|$)/, "Hunyuan", "Hunyuan"], [/^suno(?:-|$)/, "Suno", "Suno"],
    ];
    const match = families.find(([pattern]) => pattern.test(name));
    return match ? { category: match[1], icon: match[2] } : undefined;
}

// Applying is an explicit form operation. Never change identity, pricing, protocol or enablement.
export function applyModelMetadataPreset<T extends { capability: string; capabilityConfig?: ModelCapabilityConfig; protocol?: string; modelKey: string; providerModelKey?: string; icon?: string }>(values: T, preset: ModelMetadataPreset): T {
    const error = presetApplicationError(preset, values.capability);
    if (error) throw new Error(error);
    const profile = values.capabilityConfig || defaultModelCapabilityConfig(values.protocol, values.providerModelKey || values.modelKey);
    const text = profile.text || defaultModelCapabilityConfig().text!;
    return {
        ...values,
        icon: values.icon?.trim() ? values.icon : presetModelIcon(preset),
        capabilityConfig: {
            ...profile,
            text: {
                ...text, contextWindowTokens: preset.context, maxOutputTokens: preset.output,
                references: {
                    ...text.references,
                    // Unknown counts use one image as an explicit application policy, not a provider limit.
                    maxImages: preset.vision ? Math.min(100, preset.maxImages || text.references.maxImages || 1) : 0,
                },
            },
        },
    };
}
