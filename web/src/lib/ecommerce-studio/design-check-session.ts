import type { StudioDesignCheck } from "./design-check";
import { scopedStorageKey } from "@/lib/user-scope";

export type StudioCheckState = { operationId: string; taskId?: string; running?: boolean; error?: string; result?: StudioDesignCheck };

/** 同一标签页刷新后仍查询原任务。提交前必须记住操作编号，不能因缓存失败重复创建收费任务。 */
export function readStudioCheckSession(scope: string, key: string): StudioCheckState | undefined {
    if (typeof window === "undefined") return undefined;
    const raw = window.sessionStorage.getItem(scopedStorageKey(`studio-design-check:${key}`, scope));
    if (!raw) return undefined;
    const state = JSON.parse(raw) as StudioCheckState;
    if (!state || typeof state.operationId !== "string" || !state.operationId) throw new Error("成品检查记录无效，请到任务中心核对，避免重复检查");
    return { ...state, running: false };
}

export function saveStudioCheckSession(scope: string, key: string, state: StudioCheckState) {
    if (typeof window === "undefined") throw new Error("当前环境无法保存成品检查任务");
    window.sessionStorage.setItem(scopedStorageKey(`studio-design-check:${key}`, scope), JSON.stringify({ ...state, running: false }));
}
