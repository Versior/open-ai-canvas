import { describe, expect, test } from "bun:test";

import { AGENT_PET_BUBBLE_BULGE, AGENT_PET_BUBBLE_MARGIN, AGENT_PET_BUBBLE_TAIL, agentPetBubbleTailPath, agentPetCloudPath, layoutAgentPetBubble } from "../src/lib/canvas/agent-pet-bubble-layout";
import { agentPetBubbleDuration, agentPetGreeting, agentPetIdleLine, agentPetPersona, agentPetStateLine, dayPeriod, formatAgentPetTime } from "../src/lib/canvas/agent-pet-lines";

const viewport = { width: 1440, height: 900 };
const edge = AGENT_PET_BUBBLE_MARGIN + AGENT_PET_BUBBLE_BULGE;

describe("agent pet bubble layout", () => {
    test("sits above the head with the tail tip pointing at the head top", () => {
        const anchor = { left: 1100, top: 600, width: 192, height: 208, headTop: 0.1 };
        const layout = layoutAgentPetBubble(anchor, { width: 200, height: 60 }, viewport);
        expect(layout.placement).toBe("top");
        expect(layout.left).toBe(1096);
        expect(layout.top + 60 + AGENT_PET_BUBBLE_TAIL).toBeCloseTo(600 + 20.8 - 2, 5);
        expect(layout.left + layout.tail.tipX).toBe(1196);
        expect(layout.tail.tipY).toBe(60 + AGENT_PET_BUBBLE_TAIL);
        // 气泡整体在头顶之上，不压住形象。
        expect(layout.top + 60).toBeLessThan(anchor.top + anchor.height * anchor.headTop);
    });

    test("stays inside the viewport near the right edge and bends the tail toward the head", () => {
        const anchor = { left: 1300, top: 600, width: 192, height: 208, headTop: 0.1 };
        const layout = layoutAgentPetBubble(anchor, { width: 200, height: 60 }, viewport);
        expect(layout.left + 200).toBeLessThanOrEqual(viewport.width - edge);
        expect(layout.left + layout.tail.tipX).toBeCloseTo(1396, 5);
        expect(layout.tail.tipX).toBeGreaterThan(layout.tail.baseX - 1);
    });

    test("moves beside the pet when there is no room above, never over it", () => {
        const anchor = { left: 900, top: 4, width: 192, height: 208, headTop: 0.1 };
        const left = layoutAgentPetBubble(anchor, { width: 200, height: 80 }, viewport);
        expect(left.placement).toBe("left");
        expect(left.left + 200).toBeLessThanOrEqual(anchor.left + anchor.width * 0.2 - AGENT_PET_BUBBLE_TAIL + 0.001);
        expect(left.top).toBeGreaterThanOrEqual(edge);
        expect(left.tail.tipX).toBe(200 + AGENT_PET_BUBBLE_TAIL);

        const right = layoutAgentPetBubble({ left: 0, top: 4, width: 120, height: 130, headTop: 0.1 }, { width: 200, height: 80 }, { width: 390, height: 844 });
        expect(right.placement).toBe("right");
        expect(right.left).toBeGreaterThanOrEqual(120 * 0.8 + AGENT_PET_BUBBLE_TAIL);
        expect(right.tail.tipX).toBe(-AGENT_PET_BUBBLE_TAIL);
    });

    test("never leaves the viewport for launchers anywhere on small and large screens", () => {
        for (const screen of [viewport, { width: 390, height: 844 }, { width: 768, height: 1024 }]) {
            for (const [x, y] of [
                [0, 0],
                [0.5, 0.5],
                [1, 1],
                [0, 1],
                [1, 0],
            ]) {
                const size = { width: Math.min(232, screen.width - 2 * edge), height: 90 };
                const anchor = { left: (screen.width - 120) * x, top: (screen.height - 130) * y, width: 120, height: 130, headTop: 0.12 };
                const layout = layoutAgentPetBubble(anchor, size, screen);
                expect(layout.left).toBeGreaterThanOrEqual(edge - 0.001);
                expect(layout.left + size.width).toBeLessThanOrEqual(screen.width - edge + 0.001);
                expect(layout.top).toBeGreaterThanOrEqual(edge - 0.001);
                expect(layout.top + size.height).toBeLessThanOrEqual(screen.height - edge + 0.001);
            }
        }
    });

    test("draws the outline as a ring of outward bubbles plus a closed tail", () => {
        const path = agentPetCloudPath(200, 60);
        const arcs = path.match(/ A /g)?.length ?? 0;
        expect(path.startsWith("M ")).toBe(true);
        expect(path.endsWith(" Z")).toBe(true);
        expect(arcs).toBeGreaterThanOrEqual(8);
        expect(arcs).toBeLessThanOrEqual(22);
        expect(path).toContain(" 0 0 1 ");
        expect(agentPetCloudPath(400, 160).match(/ A /g)!.length).toBeGreaterThan(arcs);
        const tail = agentPetBubbleTailPath(layoutAgentPetBubble({ left: 1100, top: 600, width: 192, height: 208, headTop: 0.1 }, { width: 200, height: 60 }, viewport));
        expect(tail).toMatch(/^M .+ Q .+ Q .+ Z$/);
    });
});

describe("agent pet lines", () => {
    const fixed = () => 0;
    const cat = agentPetPersona({ name: "小虎斑", tone: "kitty", lines: ["呼噜呼噜，今天也要元气满满。"] });

    test("time of day and greetings follow the skin's voice", () => {
        expect([5, 11, 13, 18, 23, 2].map(dayPeriod)).toEqual(["morning", "noon", "afternoon", "evening", "night", "night"]);
        expect(formatAgentPetTime(new Date(2026, 10, 1, 9, 5))).toBe("09:05");
        expect(agentPetGreeting(cat, new Date(2026, 10, 1, 9, 5)).text).toBe("早安喵～现在 09:05，伸个懒腰再开工！");
        const robot = agentPetPersona({ name: "ruPet", tone: "robot", lines: [] });
        expect(agentPetGreeting(robot, new Date(2026, 10, 1, 23, 30)).text).toContain("23:30");
        expect(agentPetStateLine(cat, "waiting_approval")?.text).toContain("面板");
        expect(agentPetStateLine(cat, "idle")).toBeNull();
    });

    test("idle lines mix reminders, tips and signature lines in the persona's tone", () => {
        const now = new Date(2026, 10, 1, 15, 0);
        const tasks = agentPetIdleLine(cat, { now, context: { activeTasks: 3 }, kinds: ["tasks"], random: fixed });
        expect(tasks.text).toBe("📌还有 3 个生成任务在跑，我帮你盯着喵～");
        const drama = agentPetIdleLine(cat, { now, context: { unfinishedDramas: 1, dramaTitle: "雨夜" }, kinds: ["dramas"], random: fixed });
        expect(drama.text).toContain("短剧《雨夜》还没做完");
        const tip = agentPetIdleLine(cat, { now, kinds: ["tip"], random: fixed });
        expect(tip.text.startsWith("💡")).toBe(true);
        expect(tip.text.endsWith("喵～")).toBe(true);
        expect(agentPetIdleLine(cat, { now, kinds: ["signature"], random: fixed }).text).toBe("呼噜呼噜，今天也要元气满满。");
        expect(agentPetIdleLine(cat, { now, longSessionMinutes: 75, random: fixed }).text).toContain("75 分钟");
        // 没有专属台词和项目数据时，不会选到这些类别。
        const plain = agentPetPersona({ name: "上传形象", tone: "", lines: [] });
        expect(plain.tone).toBe("gentle");
        for (let index = 0; index < 20; index += 1) {
            expect(["care", "tip", "time"]).toContain(agentPetIdleLine(plain, { now }).kind);
        }
    });

    test("bubble duration grows with text and is capped", () => {
        expect(agentPetBubbleDuration("嗨")).toBe(5000);
        expect(agentPetBubbleDuration("字".repeat(40))).toBe(8300);
        expect(agentPetBubbleDuration("字".repeat(200))).toBe(12000);
    });
});
