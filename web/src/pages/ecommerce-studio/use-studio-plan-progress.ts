import { create } from "zustand";
import type { StudioPlanStreamSnapshot } from "@/lib/ecommerce-studio/plan-stream";
import type { StudioPlanScope } from "@/lib/ecommerce-studio/types";

export type StudioPlanProgress = StudioPlanStreamSnapshot & {
    attemptId: string;
    taskId?: string;
    startedAt: number;
    totalScreens: number;
    unit: "屏" | "张";
    scope: StudioPlanScope;
    inputSignature: string;
    phase: "preparing" | "queued" | "writing" | "validating" | "failed" | "completed";
};

export const useStudioPlanProgress = create<{ items: Record<string, StudioPlanProgress | undefined> }>(() => ({ items: {} }));

export function studioPlanProgressKey(scope: string, productId: string) {
    return JSON.stringify([scope, productId]);
}
