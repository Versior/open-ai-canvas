import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { AgentPetSprite } from "../src/components/canvas/agent-pet-sprite";
import { agentPetFrameDuration, agentPetLauncherHeight, agentPetLookCell, agentPetRowForState, agentPetSheetRows, agentPetTopRow, countAgentPetFrames, DEFAULT_AGENT_PET_FRAMES } from "../src/lib/canvas/agent-pet";

describe("agent pet atlas math", () => {
    test("look directions start at 12 o'clock and go clockwise across rows 9 and 10", () => {
        expect(agentPetLookCell(0, -100)).toEqual({ row: 9, column: 0 });
        expect(agentPetLookCell(100, -100)).toEqual({ row: 9, column: 2 });
        expect(agentPetLookCell(100, 0)).toEqual({ row: 9, column: 4 });
        expect(agentPetLookCell(0, 100)).toEqual({ row: 10, column: 0 });
        expect(agentPetLookCell(-100, 0)).toEqual({ row: 10, column: 4 });
        expect(agentPetLookCell(-100, -100)).toEqual({ row: 10, column: 6 });
        // 接近正上方的左侧角度回绕到第 0 格。
        expect(agentPetLookCell(-5, -100)).toEqual({ row: 9, column: 0 });
    });

    test("assistant states map to atlas rows with valid overrides only", () => {
        expect(agentPetRowForState("running")).toBe("running");
        expect(agentPetRowForState("waiting_approval")).toBe("waiting");
        expect(agentPetRowForState("queued")).toBe("review");
        expect(agentPetRowForState("running", { running: "review" })).toBe("review");
        expect(agentPetRowForState("running", { running: "dance" as never })).toBe("running");
        expect(agentPetSheetRows(1)).toBe(9);
        expect(agentPetSheetRows(2)).toBe(11);
    });

    test("frame timing follows the spec and stretches to longer rows", () => {
        expect(DEFAULT_AGENT_PET_FRAMES).toEqual([6, 8, 8, 4, 5, 8, 6, 6, 6]);
        expect(agentPetFrameDuration("idle", 0, 6)).toBe(280);
        expect(agentPetFrameDuration("idle", 5, 6)).toBe(320);
        expect(agentPetFrameDuration("idle", 5, 7)).toBe(140);
        expect(agentPetFrameDuration("idle", 6, 7)).toBe(320);
        expect(agentPetFrameDuration("waving", 3, 4)).toBe(280);
    });

    test("head top is the highest opaque row across the idle frames", () => {
        const opaque = new Set(["1:9", "0:12", "2:6"]);
        expect(agentPetTopRow((column, y) => opaque.has(`${column}:${y}`), 2, 52)).toBe(9);
        expect(agentPetTopRow((column, y) => opaque.has(`${column}:${y}`), 3, 52)).toBe(6);
        expect(agentPetTopRow(() => false, 3, 52)).toBeNull();
    });

    test("frame counts use leading filled cells and fall back for empty rows", () => {
        const filled = new Set(["0:0", "1:0", "2:0", "0:1", "2:1", "0:3", "1:3", "2:3", "3:3", "4:3", "5:3", "6:3", "7:3"]);
        const counts = countAgentPetFrames((column, row) => filled.has(`${column}:${row}`), 4);
        expect(counts).toEqual([3, 1, 8, 8]);
    });

    test("automatic launcher stays small while explicit sizes remain available", () => {
        const desktop = { width: 1440, height: 900 };
        expect(agentPetLauncherHeight("auto", 260, desktop, true)).toBe(96);
        expect(agentPetLauncherHeight("auto", 160, desktop, false)).toBe(96);
        expect(agentPetLauncherHeight("auto", 64, desktop, true)).toBe(64);
        // 选了档位：画布外也按所选高度，只受视口约束。
        expect(agentPetLauncherHeight("s", 260, desktop, true)).toBe(96);
        expect(agentPetLauncherHeight("xl", 120, desktop, false)).toBe(208);
        expect(agentPetLauncherHeight("xl", 120, { width: 390, height: 844 }, false)).toBe(76);
        expect(agentPetLauncherHeight("auto", 160, { width: 390, height: 844 }, false)).toBe(76);
        expect(agentPetLauncherHeight("huge" as never, 160, desktop, true)).toBe(96);
    });
});

describe("AgentPetSprite markup", () => {
    test("窗边探头使用朝页面内部的视线，不横切半张脸", () => {
        const right = renderToStaticMarkup(<AgentPetSprite src="/a.webp" version={2} state="idle" width={96} height={104} peekSide="right" />);
        const left = renderToStaticMarkup(<AgentPetSprite src="/a.webp" version={2} state="idle" width={96} height={104} peekSide="left" />);
        expect(right).toContain('data-pet-row="look"');
        expect(right).toContain("background-position:-480px -1040px");
        expect(left).toContain("background-position:-288px -936px");
        expect(renderToStaticMarkup(<AgentPetSprite src="/a.webp" version={1} state="idle" width={96} height={104} peekSide="right" />)).toContain('data-pet-row="idle"');
    });
    test("positions the background on the mapped row without bleeding between cells", () => {
        const markup = renderToStaticMarkup(<AgentPetSprite src="/api/agent-pets/pingo/spritesheet?v=1" version={2} state="running" width={96} height={104} />);
        expect(markup).toContain('data-pet-row="running"');
        expect(markup).toContain("width:96px;height:104px");
        expect(markup).toContain("background-size:768px 1144px");
        expect(markup).toContain("background-position:0px -728px");
        expect(markup).toContain('aria-hidden="true"');
    });

    test("completed state rests on idle until a run actually completes, and previews can force a row", () => {
        expect(renderToStaticMarkup(<AgentPetSprite src="/a.webp" version={1} state="completed" width={96} height={104} />)).toContain('data-pet-row="idle"');
        const forced = renderToStaticMarkup(<AgentPetSprite src="/a.webp" version={1} state="idle" row="waving" width={96} height={104} pixelated label="预览" />);
        expect(forced).toContain("background-position:0px -312px");
        expect(forced).toContain("image-rendering:pixelated");
        expect(forced).toContain('role="img"');
        expect(forced).toContain("background-size:768px 936px");
    });

    test("list thumbnails show the one-frame preview until the full sheet is needed and loaded", () => {
        const still = renderToStaticMarkup(<AgentPetSprite src="/sheet.webp" preview="/preview.png" version={2} state="idle" width={96} height={104} paused />);
        expect(still).toContain("/preview.png");
        expect(still).not.toContain("/sheet.webp");
        expect(still).toContain("background-size:96px 104px");
        expect(still).toContain("background-position:0px 0px");
        expect(still).toContain('data-pet-preview="true"');
        // 开始播放时图集还没加载完，继续显示缩略图，不闪空白。
        const playing = renderToStaticMarkup(<AgentPetSprite src="/sheet.webp" preview="/preview.png" version={2} state="idle" width={96} height={104} />);
        expect(playing).toContain("/preview.png");
        // 懒加载的格子滚到附近之前，缩略图也不加载。
        const offscreen = renderToStaticMarkup(<AgentPetSprite src="/sheet.webp" preview="/preview.png" version={2} state="idle" width={96} height={104} paused lazy />);
        expect(offscreen).not.toContain("background-image");
        // 没有缩略图时照旧直接用图集。
        expect(renderToStaticMarkup(<AgentPetSprite src="/sheet.webp" version={2} state="idle" width={96} height={104} paused />)).toContain("/sheet.webp");
    });
});
