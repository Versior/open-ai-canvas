import { useEffect, useState } from "react";
import { estimateInterior, type InteriorGenerateInput } from "@/services/api/interior";
import { useUserStore } from "@/stores/use-user-store";

/** 全部风格按服务端实际模型和参数报价；报价失败不伪造零积分，也不改变任务状态。 */
export function useInteriorEstimate(input: InteriorGenerateInput | null) {
    const enabled = useUserStore((state) => state.features.creditsEnabled);
    const [label, setLabel] = useState("");
    const key = JSON.stringify(input);
    useEffect(() => {
        if (!enabled || key === "null") {
            setLabel("");
            return;
        }
        const controller = new AbortController();
        setLabel("正在计算积分…");
        const timer = window.setTimeout(() => {
            void estimateInterior(JSON.parse(key) as InteriorGenerateInput, controller.signal)
                .then((estimate) => {
                    if (controller.signal.aborted) return;
                    setLabel(`${estimate.images} 张${estimate.estimated ? "预估" : "预计"}消耗 ${(estimate.amountMicrocredits / 1_000_000).toLocaleString("zh-CN", { maximumFractionDigits: 6 })} 积分${estimate.estimated ? "，按实际用量结算" : ""}`);
                })
                .catch((error: unknown) => {
                    if (!controller.signal.aborted) setLabel(`积分估算暂不可用：${error instanceof Error ? error.message : "请稍后重试"}`);
                });
        }, 600);
        return () => {
            window.clearTimeout(timer);
            controller.abort();
        };
    }, [enabled, key]);
    return label;
}
