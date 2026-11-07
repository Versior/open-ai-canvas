import { useEffect, useState } from "react";
import { formatCompactCredits } from "@/constant/credits";
import { DEFAULT_ECOMMERCE_BRIEF } from "@/lib/ecommerce/ecommerce-capabilities";
import { buildEcommerceImageGeneration } from "@/lib/ecommerce/ecommerce-image-generation";
import { studioImageRequest } from "@/lib/ecommerce-studio/image-options";
import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import { modelQuoteRequest, requestCreditCost } from "@/lib/model-pricing";
import { quoteModel } from "@/services/api/logical-models";
import { modelOptionName, resolveModelChannel, useEffectiveConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

type Estimate = { credits: number | null; tone: "quote" | "local" | "loading" | "usage" | "unavailable" };

/**
 * 「本次预计消耗」：按一张图的报价乘以张数。系统渠道先用服务端报价，取不到时用本地价格表；
 * 按用量结算的模型不给固定数字。未开启积分时不显示。
 */
export function useStudioEstimate({ model, images, references, quality, resolution, ratio }: { model: string; images: number; references: number; quality: string; resolution: string; ratio: string }) {
    const config = useEffectiveConfig();
    const creditsEnabled = useUserStore((state) => state.features.creditsEnabled);
    const [estimate, setEstimate] = useState<Estimate>({ credits: null, tone: "unavailable" });

    useEffect(() => {
        if (!creditsEnabled || !model || images < 1) {
            setEstimate({ credits: null, tone: "unavailable" });
            return;
        }
        const profile = modelCapabilityConfigFor(config, model).image;
        const request = studioImageRequest(profile, quality, ratio, resolution);
        const input = { textCount: 1, imageCount: references, referenceImageCount: references, videoCount: 0, audioCount: 0, characterCount: 0 };
        let generation: ReturnType<typeof buildEcommerceImageGeneration>["config"];
        try {
            const node = { id: "studio-estimate", type: CanvasNodeType.Image, title: "", width: 0, height: 0, position: { x: 0, y: 0 }, metadata: { model } } as CanvasNodeData;
            generation = buildEcommerceImageGeneration(config, node, { ...DEFAULT_ECOMMERCE_BRIEF, ...(request.aspectRatio ? { aspectRatio: request.aspectRatio } : {}), imageSettings: request.imageSettings }, input).config;
        } catch {
            setEstimate({ credits: null, tone: "unavailable" });
            return;
        }
        const requirements = {
            capability: "image" as const,
            input,
            imageSize: generation.size,
            options: { size: generation.size, quality: generation.quality, ...(profile?.resolution.supported ? { imageResolution: generation.imageResolution } : {}), count: 1 },
        };
        const channel = resolveModelChannel(config, model);
        const unit = requestCreditCost({ channelMode: channel.scope === "system" ? "remote" : "local", modelCosts: channel.modelCosts, model: modelOptionName(model), count: 1, capability: "image", config: generation, requirements });
        const local = unit === null ? null : unit * images;
        const quoteRequest = modelQuoteRequest({ ...generation, count: "1" }, model, "image", requirements);
        if (!quoteRequest) {
            setEstimate({ credits: local, tone: local === null ? "usage" : "local" });
            return;
        }
        const controller = new AbortController();
        setEstimate(local === null ? { credits: null, tone: "loading" } : { credits: local, tone: "local" });
        quoteModel(quoteRequest, controller.signal)
            .then(({ quote }) => setEstimate({ credits: (quote.amountMicrocredits / 1_000_000) * images, tone: "quote" }))
            .catch(() => {
                if (!controller.signal.aborted) setEstimate({ credits: local, tone: local === null ? "unavailable" : "local" });
            });
        return () => controller.abort();
    }, [config, creditsEnabled, images, model, quality, ratio, references, resolution]);

    if (!creditsEnabled) return "";
    if (estimate.credits !== null) return `预计约 ${formatCompactCredits(estimate.credits * 1_000_000)} 积分`;
    if (estimate.tone === "loading") return "正在计算积分…";
    if (estimate.tone === "usage") return "按实际用量计费";
    return model ? "暂时算不出积分" : "";
}
