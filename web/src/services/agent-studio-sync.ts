import type { AgentEvent } from "@/services/api/agent";

/** 助手改了生图台商品时在 window 上广播；生图台页面据此取回最新版本，面板与页面互不依赖。 */
export const STUDIO_AGENT_CHANGE_EVENT = "ecommerce-studio:agent-change";

export type StudioAgentChange = { productId: string; toolName: string };

const STUDIO_WRITE_TOOLS = new Set(["studio_update_dossier", "studio_plan_shots", "studio_request_generation"]);

export function studioAgentChange(event: AgentEvent): StudioAgentChange | null {
    if (event.type !== "tool_completed") return null;
    const toolName = String(event.payload?.toolName ?? "");
    if (!STUDIO_WRITE_TOOLS.has(toolName)) return null;
    const result = event.payload?.result as { productId?: unknown } | undefined;
    const productId = typeof result?.productId === "string" ? result.productId : "";
    return productId ? { productId, toolName } : null;
}

export function notifyStudioAgentEvent(event: AgentEvent) {
    const change = studioAgentChange(event);
    if (change && typeof window !== "undefined") window.dispatchEvent(new CustomEvent<StudioAgentChange>(STUDIO_AGENT_CHANGE_EVENT, { detail: change }));
}
