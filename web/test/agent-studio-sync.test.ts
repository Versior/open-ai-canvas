import { expect, test } from "bun:test";
import { studioAgentChange } from "@/services/agent-studio-sync";
import type { AgentEvent } from "@/services/api/agent";

const event = (type: string, payload: Record<string, unknown>): AgentEvent => ({ eventId: "e", runId: "r", seq: 1, type, payload, createdAt: "2026-11-01T00:00:00.000Z" });

test("only completed studio writes ask the studio page to reload a product", () => {
    expect(studioAgentChange(event("tool_completed", { toolName: "studio_update_dossier", result: { productId: "p_cup", revision: 3 } }))).toEqual({ productId: "p_cup", toolName: "studio_update_dossier" });
    expect(studioAgentChange(event("tool_completed", { toolName: "studio_request_generation", result: { productId: "p_cup" } }))?.toolName).toBe("studio_request_generation");
    for (const ignored of [
        event("tool_completed", { toolName: "studio_get_state", result: { productId: "p_cup" } }),
        event("tool_failed", { toolName: "studio_plan_shots", result: { productId: "p_cup" } }),
        event("tool_completed", { toolName: "canvas_apply_ops", result: { productId: "p_cup" } }),
        event("tool_completed", { toolName: "studio_plan_shots", result: { error: "商品已在页面上被修改" } }),
    ]) {
        expect(studioAgentChange(ignored)).toBeNull();
    }
});
