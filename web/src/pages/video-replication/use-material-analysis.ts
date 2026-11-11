import { useEffect, useRef, useState } from "react";
import { buildEcommerceAnalysisGeneration } from "@/lib/ecommerce/ecommerce-analysis-generation";
import { buildCreativeMaterialPrompt, parseCreativeMaterialSuggestion, type CreativeMaterialSuggestion } from "@/lib/remake/materials";
import type { CreativeBrief } from "@/lib/remake/creative";
import type { RemakeProduct } from "@/lib/remake/job";
import { getActiveUserScope } from "@/lib/user-scope";
import { runBackendGenerationTask } from "@/services/api/generation-task";
import { resourceStorageKey } from "@/services/api/resources";
import type { AiConfig } from "@/stores/use-config-store";
import { replicaScriptImageCount, replicaScriptModelError } from "./replication-script";

export const materialAnalysisDependencies = { run: runBackendGenerationTask };

/** 素材变化时识别一次；失败由用户重试，旧素材或旧账号的结果不会回填。 */
export function useMaterialAnalysis({ config, model, product, brief, paused, onResult }: { config: AiConfig; model: string; product: RemakeProduct; brief: CreativeBrief; paused: boolean; onResult: (result: CreativeMaterialSuggestion) => void }) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [questions, setQuestions] = useState<string[]>([]);
    const [attempt, setAttempt] = useState(0);
    const [recognized, setRecognized] = useState(false);
    const latest = useRef({ config, product, brief, onResult });
    latest.current = { config, product, brief, onResult };
    const tried = useRef("");
    const scope = getActiveUserScope();
    const images = product.images.map((image) => image.resourceId).join("|");
    const count = replicaScriptImageCount(config, model, product.images.length);
    const problem = replicaScriptModelError(config, model) || (!count ? "请选择能看图的分析模型" : "");
    useEffect(() => {
        setError("");
        setQuestions([]);
        setRecognized(false);
    }, [scope, images, model, attempt]);
    useEffect(() => {
        setBusy(false);
        if (paused || scope === "guest" || !images || problem) return;
        const key = JSON.stringify([scope, images, model, attempt]);
        if (tried.current === key) return;
        const controller = new AbortController();
        let completed = false;
        setBusy(true);
        const timer = window.setTimeout(() => {
            tried.current = key;
            setBusy(true);
            const input = latest.current;
            const photos = input.product.images.slice(0, count);
            void (async () => {
                try {
                    const generation = buildEcommerceAnalysisGeneration(input.config, model, { textCount: 1, imageCount: photos.length, videoCount: 0, audioCount: 0, characterCount: 0 });
                    const result = await materialAnalysisDependencies.run({
                        mode: "text",
                        config: generation,
                        prompt: buildCreativeMaterialPrompt({ ...input.product, images: photos }, input.brief),
                        expectedUserScope: scope,
                        signal: controller.signal,
                        streamText: false,
                        referenceImages: photos.map((image) => ({ id: image.id, name: "主体参考", type: "image/png", dataUrl: "", storageKey: resourceStorageKey(image.resourceId), width: image.width, height: image.height })),
                        metadata: { source: "product-video-creative", stage: "material-analysis", ecommerceCapability: "dossier", ecommerceAnalysisFlow: "cap:dossier" },
                    });
                    if (controller.signal.aborted || scope !== getActiveUserScope()) return;
                    const suggestion = parseCreativeMaterialSuggestion(result.text || "", model);
                    latest.current.onResult(suggestion);
                    setQuestions(suggestion.questions);
                    setRecognized(true);
                } catch (cause) {
                    if (!controller.signal.aborted && scope === getActiveUserScope()) setError(cause instanceof Error ? cause.message : "素材识别失败");
                } finally {
                    completed = true;
                    if (!controller.signal.aborted) setBusy(false);
                }
            })();
        }, 350);
        return () => {
            window.clearTimeout(timer);
            controller.abort();
            if (tried.current === key && !completed) setError("识别已中断，可在任务中心查看；需要时点击重新识别。");
        };
    }, [scope, images, model, attempt, paused, problem, count]);
    return { busy, error, questions, recognized, retry: () => setAttempt((value) => value + 1) };
}
