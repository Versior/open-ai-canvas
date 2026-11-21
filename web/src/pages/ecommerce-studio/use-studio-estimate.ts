import { useEffect, useState } from "react";
import { formatCompactCredits } from "@/constant/credits";
import { buildStudioImageGeneration, studioImageInputCount } from "@/lib/ecommerce-studio/generation-input";
import type { StudioAttempt } from "@/lib/ecommerce-studio/types";
import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import { modelQuoteRequest, requestCreditCost, systemModelQuoteRequest } from "@/lib/model-pricing";
import { quoteModel } from "@/services/api/logical-models";
import { modelOptionName, resolveModelChannel, useEffectiveConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";

type Estimate = { credits: number | null; tone: "quote" | "local" | "loading" | "usage" | "reserve" | "unavailable" };
const unavailable: Estimate = { credits: null, tone: "unavailable" };

function describeEstimate(value: Estimate) {
    if (value.tone === "reserve") return `最多冻结 ${formatCompactCredits(value.credits! * 1_000_000)} 积分，按实际用量结算`;
    if (value.credits !== null) return `预计约 ${formatCompactCredits(value.credits * 1_000_000)} 积分`;
    if (value.tone === "loading") return "正在计算积分…";
    return value.tone === "usage" ? "按实际用量计费" : "暂时算不出积分";
}

/**
 * 「本次预计消耗」：按每张实际尺寸、质量和参考图报价求和，相同规格共用一次报价。
 * 按用量结算的模型不给固定数字。未开启积分时不显示。
 */
export function useStudioEstimate({ model, inputs }: { model: string; inputs: NonNullable<StudioAttempt["input"]>[] }) {
    const config = useEffectiveConfig();
    const creditsEnabled = useUserStore((state) => Boolean(state.user) && state.features.creditsEnabled);
    const [estimate, setEstimate] = useState({ first: unavailable, all: unavailable });
    // 商品的任务状态和文案更新不影响报价，只跟踪实际计价输入。
    const inputKey = JSON.stringify(inputs.map((input) => ({ request: input.request, references: studioImageInputCount(input) })));

    useEffect(() => {
        if (!creditsEnabled || !model || !inputs.length) {
            setEstimate({ first: unavailable, all: unavailable });
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
            setEstimate({ first: unavailable, all: unavailable });
            return;
        }
        const items = [...groups.values()];
        const apply = (values: Estimate[]) => {
            const unknown = values.find((item) => item.credits === null);
            const all: Estimate = unknown || { credits: values.reduce((total, value, index) => total + value.credits! * items[index].count, 0), tone: values.some((value) => value.tone === "reserve") ? "reserve" : "quote" };
            setEstimate({ first: values[0], all });
        };
        const controller = new AbortController();
        apply(items.map(({ local }) => ({ credits: local, tone: local === null ? "loading" : "local" })));
        void Promise.all(
            items.map(async (item): Promise<Estimate> => {
                if (!item.request) return { credits: item.local, tone: item.local === null ? "usage" : "local" };
                try {
                    const { quote } = await quoteModel(item.request, controller.signal);
                    return { credits: quote.amountMicrocredits / 1_000_000, tone: quote.billingMode === "image_usage" ? "reserve" : "quote" };
                } catch {
                    return { credits: item.local, tone: item.local === null ? "unavailable" : "local" };
                }
            }),
        ).then((results) => {
            if (controller.signal.aborted) return;
            apply(results);
        });
        return () => controller.abort();
    }, [config, creditsEnabled, inputKey, model]);

    return creditsEnabled && model ? { first: describeEstimate(estimate.first), all: describeEstimate(estimate.all) } : { first: "", all: "" };
}

export function useStudioTextEstimate(model: string, imageCount: number | null) {
    const config = useEffectiveConfig();
    const enabled = useUserStore((state) => Boolean(state.user) && state.features.creditsEnabled);
    const [label, setLabel] = useState("");
    useEffect(() => {
        if (!enabled || imageCount === null || !model) {
            setLabel("");
            return;
        }
        const requirements = { capability: "text" as const, input: { textCount: 0, imageCount, referenceImageCount: imageCount, videoCount: 0, audioCount: 0, characterCount: 0 } };
        const request = systemModelQuoteRequest(config, model, "text", requirements);
        if (!request) {
            setLabel(resolveModelChannel(config, model).scope === "system" ? "暂无法报价" : "按所选渠道计费");
            return;
        }
        const controller = new AbortController();
        setLabel("报价中…");
        void quoteModel(request, controller.signal).then(
            ({ quote }) => {
                if (!controller.signal.aborted) setLabel(`${formatCompactCredits(quote.amountMicrocredits)} 积分${quote.billingMode === "token" ? "（预估，按实际用量结算）" : ""}`);
            },
            () => {
                if (!controller.signal.aborted) setLabel("暂无法报价");
            },
        );
        return () => controller.abort();
    }, [config, enabled, imageCount, model]);
    return enabled && imageCount !== null ? label : "";
}
