import { useEffect, useMemo, useState } from "react";
import { modelQuoteRequest } from "@/lib/model-pricing";
import { productVideoShotSeconds, type ProductVideoModelLimits } from "@/lib/product-video/media";
import type { ProductVideoAudio } from "@/lib/product-video/job";
import { quoteModel } from "@/services/api/logical-models";
import { useEffectiveConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { productVideoGenerationConfig, productVideoRequirements } from "./product-video-config";

type Estimate = { credits: number | null; state: "idle" | "loading" | "ready" | "unavailable" };

/**
 * 「积分起」：按每段的生成时长分别向服务端报价再相加。还没切段时按选段均分估计段数，
 * 参考视频按段计入；报价是预估，按用量结算的模型以实际用量为准。未开启积分时不显示。
 */
export function useProductVideoEstimate({
    model,
    ratio,
    resolution,
    audio,
    imageCount,
    segments,
    limits,
}: {
    model: string;
    ratio: string;
    resolution: string;
    audio: ProductVideoAudio;
    imageCount: number;
    segments: number[];
    limits?: ProductVideoModelLimits;
}) {
    const config = useEffectiveConfig();
    const creditsEnabled = useUserStore((state) => state.features.creditsEnabled);
    const [estimate, setEstimateState] = useState<Estimate>({ credits: null, state: "idle" });
    const setEstimate = (next: Estimate) => setEstimateState((current) => (current.credits === next.credits && current.state === next.state ? current : next));
    const secondsList = useMemo(() => (limits ? segments.map((durationMs) => productVideoShotSeconds(durationMs, limits.durations)) : []), [limits, segments]);
    const key = secondsList.join(",");
    useEffect(() => {
        if (!creditsEnabled || !model || !limits || !secondsList.length) {
            setEstimate({ credits: null, state: "idle" });
            return;
        }
        const counts = new Map<number, number>();
        for (const seconds of secondsList) counts.set(seconds, (counts.get(seconds) || 0) + 1);
        const requests = [...counts.entries()].map(([seconds, times]) => {
            const generation = productVideoGenerationConfig(config, { model, ratio, resolution, seconds, audio });
            return { times, request: modelQuoteRequest(generation, model, "video", productVideoRequirements(generation, imageCount)) };
        });
        if (requests.some((item) => !item.request)) {
            setEstimate({ credits: null, state: "unavailable" });
            return;
        }
        const controller = new AbortController();
        setEstimate({ credits: null, state: "loading" });
        Promise.all(requests.map(({ times, request }) => quoteModel(request!, controller.signal).then(({ quote }) => (quote.amountMicrocredits / 1_000_000) * times)))
            .then((values) => setEstimate({ credits: values.reduce((sum, value) => sum + value, 0), state: "ready" }))
            .catch(() => {
                if (!controller.signal.aborted) setEstimate({ credits: null, state: "unavailable" });
            });
        return () => controller.abort();
        // secondsList 由 key 表示，避免数组引用变化重复报价。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [audio, config, creditsEnabled, imageCount, key, limits, model, ratio, resolution]);
    return { enabled: creditsEnabled, ...estimate };
}

export function formatProductVideoCredits(credits: number) {
    return credits.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
}
