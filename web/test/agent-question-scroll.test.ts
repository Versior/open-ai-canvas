import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const panel = readFileSync(new URL("../src/components/canvas/canvas-cloud-agent-panel.tsx", import.meta.url), "utf8");
const conversation = panel.slice(panel.indexOf("function AgentConversation("), panel.indexOf("function ComposerControls("));

test("decision choices belong to the conversation scroll content, not the fixed composer area", () => {
    expect(conversation).toContain("<AgentQuestionBar");
    expect(conversation.indexOf("<AgentQuestionBar")).toBeGreaterThan(conversation.indexOf('className="agent-conversation-messages"'));
    expect(panel.slice(0, panel.indexOf("function AgentConversation("))).not.toContain("<AgentQuestionBar");
    expect(conversation).toContain("data-canvas-wheel-scroll");
});
