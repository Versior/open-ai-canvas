import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = (path: string) => readFileSync(resolve(import.meta.dir, `../${path}`), "utf8").replace(/\r\n/g, "\n");

describe("Agent automatic skill routing", () => {
    it("does not send or expose a per-run skill selection", () => {
        const panel = source("src/components/canvas/canvas-cloud-agent-panel.tsx");
        const requestInput = panel.slice(panel.indexOf("const input = {"), panel.indexOf("const fingerprint"));

        expect(requestInput).not.toContain("skillIds");
        expect(panel).not.toContain("selectedSkillIds");
        expect(panel).not.toContain("resolveSkillMentions");
        expect(panel).not.toContain("slashSkills=");
        expect(panel).not.toContain("<AgentSceneCapsules");
    });

    it("tells users that Agent matches skills automatically", () => {
        const welcome = source("src/components/canvas/canvas-agent-welcome.tsx");
        const controls = source("src/components/canvas/canvas-cloud-agent-panel-parts.tsx");
        const settings = source("src/components/canvas/canvas-cloud-agent-settings.tsx");

        expect(welcome).toContain("Agent 会按任务自动查找技能");
        expect(welcome).not.toContain("选择技能");
        expect(controls).toContain("Skills 自动匹配");
        expect(controls).not.toContain("selectedSkillCount");
        expect(settings).toContain("Agent 按任务自动搜索并读取");
        expect(settings).not.toContain("本轮启用");
        expect(settings).not.toContain("全选当前");
        expect(settings).not.toContain("onSkillToggle");
    });
});
