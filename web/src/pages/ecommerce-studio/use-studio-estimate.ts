import { useEffect, useState } from "react";
import { formatCompactCredits } from "@/constant/credits";
import { buildStudioImageGeneration, studioImageInputCount } from "@/lib/ecommerce-studio/generation-input";
import type { StudioAttempt } from "@/lib/ecommerce-studio/types";
import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import { modelQuoteRequest, requestCreditCost } from "@/lib/model-pricing";
import { quoteModel } from "@/services/api/logical-models";
import { modelOptionName, resolveModelChannel, useEffectiveConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";

type Estimate = { credits: number | null; tone: "quote" | "local" | "loading" | "usage" | "unavailable" };

/**
 * 「本次预计消耗」：按每张实际尺寸、质量和参考图报价求和，相同规格共用一次报价。
 * 按用量结算的模型不给固定数字。未开启积分时不显示。
 */
export function useStudioEstimate({ model, inputs }: { model: string; inputs: NonNullable<StudioAttempt["input"]>[] }) {
    const config = useEffectiveConfig();
    const creditsEnabled = useUserStore((state) => state.features.creditsEnabled);
    const [estimate, setEstimate] = useState<Estimate>({ credits: null, tone: "unavailable" });
    // 商品的任务状态和文案更新不影响报价，只跟踪实际计价输入。
    const inputKey = JSON.stringify(inputs.map((input) => ({ request: input.request, references: studioImageInputCount(input) })));

    useEffect(() => {
        if (!creditsEnabled || !model || !inputs.length) {
            setEstimate({ credits: null, tone: "unavailable" });
            return;
        }
        const profile = modelCapabilityConfigFor(config, model).image;
        const channel = resolveModelChannel(config, model);
        const groups = new Map<string, { request: ReturnType<typeof modelQuoteRequest>; local: number | null; count: number }>();
        try {
            for (const input of inputs) {
                const generation = buildStudioImageGeneration(config, model, input, "estimate");
                const references = studioImageInputCount(input);
                const requirements = {
                    capability: "image" as const,
                    input: { textCount: 1, imageCount: references, referenceImageCount: references, videoCount: 0, audioCount: 0, characterCount: 0 },
                    imageSize: generation.size,
                    options: { size: generation.size, quality: generation.quality, ...(profile?.resolution.supported ? { imageResolution: generation.imageResolution } : {}), count: 1 },
                };
                const local = requestCreditCost({ channelMode: channel.scope === "system" ? "remote" : "local", modelCosts: channel.modelCosts, model: modelOptionName(model), count: 1, capability: "image", config: generation, requirements });
                const request = modelQuoteRequest({ ...generation, count: "1" }, model, "image", requirements);
                const key = JSON.stringify({ request, local });
                const previous = groups.get(key);
                if (previous) previous.count++;
                else groups.set(key, { request, local, count: 1 });
            }
        } catch {
            setEstimate({ credits: null, tone: "unavailable" });
            return;
        }
        const items = [...groups.values()];
        const sum = (values: (number | null)[]) => (values.some((value) => value === null) ? null : values.reduce<number>((total, value) => total + value!, 0));
        const local = sum(items.map((item) => (item.local === null ? null : item.local * item.count)));
        const controller = new AbortController();
        setEstimate(local === null ? { credits: null, tone: "loading" } : { credits: local, tone: "local" });
        void Promise.all(
            items.map(async (item): Promise<Estimate> => {
                if (!item.request) return { credits: item.local === null ? null : item.local * item.count, tone: item.local === null ? "usage" : "local" };
                try {
                    const { quote } = await quoteModel(item.request, controller.signal);
                    return { credits: (quote.amountMicrocredits / 1_000_000) * item.count, tone: "quote" };
                } catch {
                    return { credits: item.local === null ? null : item.local * item.count, tone: item.local === null ? "unavailable" : "local" };
                }
            }),
        ).then((results) => {
            if (controller.signal.aborted) return;
            const credits = sum(results.map((result) => result.credits));
            const tone = credits === null ? (results.some((result) => result.tone === "unavailable") ? "unavailable" : "usage") : results.every((result) => result.tone === "quote") ? "quote" : "local";
            setEstimate({ credits, tone });
        });
        return () => controller.abort();
    }, [config, creditsEnabled, inputKey, model]);

    if (!creditsEnabled) return "";
    if (estimate.credits !== null) return `预计约 ${formatCompactCredits(estimate.credits * 1_000_000)} 积分`;
    if (estimate.tone === "loading") return "正在计算积分…";
    if (estimate.tone === "usage") return "按实际用量计费";
    return model ? "暂时算不出积分" : "";
}
