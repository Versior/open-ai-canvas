import { useEffect, useMemo, useState } from "react";
import { modelQuoteRequest } from "@/lib/model-pricing";
import { productVideoShotSeconds, type ProductVideoModelLimits } from "@/lib/product-video/media";
import type { RemakeJob } from "@/lib/remake/job";
import type { RemakeUnit } from "@/lib/remake/job";
import { quoteModel } from "@/services/api/logical-models";
import { useEffectiveConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { productVideoGenerationConfig, productVideoRequirements } from "../replace/product-video-config";

type Estimate = { credits: number | null; state: "idle" | "loading" | "ready" | "unavailable" };

/**
 * 「积分起」：每个生成单元按它的生成时长、有没有参考视频、要不要出声分别报价再相加。
 * 已经有候选的单元不再计入（只算还要生成的）。报价是预估，按用量结算的模型以实际用量为准。
 */
export function useRemakeEstimate(job: RemakeJob, units: readonly RemakeUnit[], limits: ProductVideoModelLimits | undefined) {
    const config = useEffectiveConfig();
    const creditsEnabled = useUserStore((state) => state.features.creditsEnabled);
    const [estimate, setEstimateState] = useState<Estimate>({ credits: null, state: "idle" });
    const setEstimate = (next: Estimate) => setEstimateState((current) => (current.credits === next.credits && current.state === next.state ? current : next));
    const imageCount = job.product.images.length + (job.people === "model" ? job.models.length : 0) + job.backgrounds.length;
    const items = useMemo(() => {
        if (!limits) return [];
        return units
            .filter((unit) => !unit.takes.length)
            .map((unit) => {
                const length = unit.treatment === "replace" ? unit.clipEndMs - unit.clipStartMs : unit.endMs - unit.startMs;
                const speaks = job.audio === "rewrite" && job.shots.some((shot) => unit.shotIndexes.includes(shot.index) && shot.dialogue.trim());
                return { seconds: productVideoShotSeconds(length, limits.durations), video: unit.treatment === "replace", speaks };
            });
    }, [job.audio, job.shots, limits, units]);
    const key = items.map((item) => `${item.seconds}${item.video ? "v" : ""}${item.speaks ? "s" : ""}`).join(",");
    useEffect(() => {
        if (!creditsEnabled || !job.model || !limits || !items.length) {
            setEstimate({ credits: null, state: "idle" });
            return;
        }
        const groups = new Map<string, { item: (typeof items)[number]; times: number }>();
        for (const item of items) {
            const groupKey = `${item.seconds}-${item.video}-${item.speaks}`;
            groups.set(groupKey, { item, times: (groups.get(groupKey)?.times || 0) + 1 });
        }
        const requests = [...groups.values()].map(({ item, times }) => {
            const generation = productVideoGenerationConfig(config, { model: job.model, ratio: job.ratio, resolution: job.resolution, seconds: item.seconds, audio: item.speaks ? "model" : "mute" });
            const requirements = productVideoRequirements(generation, imageCount);
            if (!item.video && requirements.input) requirements.input = { ...requirements.input, videoCount: 0 };
            return { times, request: modelQuoteRequest(generation, job.model, "video", requirements) };
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
        // items 由 key 表示，避免数组引用变化重复报价。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [config, creditsEnabled, imageCount, job.model, job.ratio, job.resolution, key, limits]);
    return { enabled: creditsEnabled, ...estimate, units: items.length };
}
