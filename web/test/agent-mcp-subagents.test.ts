import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { agentToolCategory, friendlyAgentToolSummary } from "@/lib/canvas/agent-tool-presentation";

const api = readFileSync(new URL("../src/services/api/agent.ts", import.meta.url), "utf8");
const panel = readFileSync(new URL("../src/components/canvas/canvas-cloud-agent-panel.tsx", import.meta.url), "utf8");
const settings = readFileSync(new URL("../src/components/canvas/canvas-cloud-agent-settings.tsx", import.meta.url), "utf8");

describe("canvas Agent MCP and subagents", () => {
    it("exposes managed MCP server types and request fields", () => {
        expect(api).toContain("export type AgentMCPServer");
        expect(api).toContain("export function getAgentMCPServers");
        expect(api).toContain("mcpServerIds?: string[]");
        expect(api).toContain("maxSubagents?: number");
    });

    it("loads MCP servers, lets the user select them, and submits the selection", () => {
        expect(panel).toContain("getAgentMCPServers");
        expect(panel).toContain("selectedMCPServerIds");
        expect(panel).toContain("mcpServerIds: selectedMCPServerIds");
        expect(panel).toContain("maxSubagents: Number(maxSubagents)");
        expect(settings).toContain("MCP Server");
        expect(settings).toContain("onMCPServerToggle");
        expect(settings).not.toContain("自定义 MCP 暂未开放");
    });

    it("presents MCP and subagent activity with specific language", () => {
        expect(agentToolCategory("mcp_list_tools", { eventType: "tool_completed" })).toBe("read");
        expect(agentToolCategory("mcp_call", { eventType: "tool_completed" })).toBe("operate");
        expect(agentToolCategory("delegate_task", { eventType: "subagent_started" })).toBe("think");
        expect(friendlyAgentToolSummary("mcp_list_tools", "", { eventType: "tool_completed", serverName: "资料库" })).toBe("已读取 MCP 工具 · 资料库");
        expect(friendlyAgentToolSummary("mcp_call", "", { eventType: "tool_completed", toolName: "search" })).toBe("MCP 工具调用完成 · search");
        expect(friendlyAgentToolSummary("delegate_task", "", { eventType: "subagent_started", roleLabel: "连续性审核" })).toBe("连续性审核正在处理");
        expect(friendlyAgentToolSummary("delegate_task", "", { eventType: "subagent_completed", roleLabel: "连续性审核" })).toBe("连续性审核已完成");
    });
});
