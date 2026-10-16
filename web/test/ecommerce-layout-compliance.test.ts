import { describe, expect, test } from "bun:test";

import { checkEcommerceCompliance, checkEcommerceCopy, checkEcommerceText, ecommerceComplianceBlocked } from "@/lib/ecommerce/ecommerce-compliance";
import { createEcommerceCopy, createEcommerceSellingPoint } from "@/lib/ecommerce/ecommerce-contract";
import {
    ECOMMERCE_LAYOUT_PRESETS,
    createEcommerceLayout,
    createEcommerceLayoutBlock,
    createEcommerceLayoutFromPreset,
    ecommerceLayoutBlockStyle,
    ecommerceLayoutFieldLabel,
    ecommerceLayoutPreset,
    ecommerceLayoutVisibleBlocks,
    ecommerceRatioValue,
} from "@/lib/ecommerce/ecommerce-layout";
import { ecommerceExportSize } from "@/lib/ecommerce/ecommerce-rasterize";

describe("ecommerce layout", () => {
    test("blocks are positioned by anchor and scale off the short side", () => {
        const square = { width: 400, height: 400 };
        const tall = { width: 400, height: 800 };

        const block = { ...createEcommerceLayoutBlock("headline", "bottom-left"), size: 10, inset: 5 };
        const squareStyle = ecommerceLayoutBlockStyle(block, square) as Record<string, string | number>;
        const tallStyle = ecommerceLayoutBlockStyle(block, tall) as Record<string, string | number>;

        expect(squareStyle.fontSize).toBe("40px");
        // 短边取 min(宽,高)：竖版字号不该跟着高度放大，否则同一套版式换画幅就变味
        expect(tallStyle.fontSize).toBe("40px");
        // 边距用数字返回，React 按 px 处理
        expect(squareStyle.bottom).toBe(20);
        expect(squareStyle.left).toBe(20);
        expect(squareStyle.position).toBe("absolute");
    });

    test("centre anchors translate instead of snapping to an edge", () => {
        const style = ecommerceLayoutBlockStyle({ ...createEcommerceLayoutBlock("headline", "middle-center") }, { width: 400, height: 400 }) as Record<string, string | number>;
        expect(style.left).toBe("50%");
        expect(String(style.transform)).toContain("translate");
    });

    test("only blocks whose copy is filled are drawn", () => {
        const layout = createEcommerceLayoutFromPreset("bottom-bar")!;
        const copy = { ...createEcommerceCopy(), headline: "一次装够一天的水" };

        const visible = ecommerceLayoutVisibleBlocks(layout, copy);
        expect(visible.map((block) => block.field)).toEqual(["headline"]);
        expect(ecommerceLayoutVisibleBlocks(layout, createEcommerceCopy())).toEqual([]);
        expect(ecommerceLayoutVisibleBlocks(undefined, copy)).toEqual([]);
        expect(ecommerceLayoutVisibleBlocks(layout, undefined)).toEqual([]);
    });

    test("every preset names itself and binds only real copy fields", () => {
        const fields = ["headline", "subhead", "cta", "price"];
        expect(ECOMMERCE_LAYOUT_PRESETS.length).toBeGreaterThanOrEqual(5);
        for (const preset of ECOMMERCE_LAYOUT_PRESETS) {
            const layout = createEcommerceLayoutFromPreset(preset.id)!;
            expect(layout.name).toBe(preset.layout.name);
            expect(layout.blocks.length).toBeGreaterThan(0);
            expect(preset.hint.trim()).not.toBe("");
            for (const block of layout.blocks) expect(fields).toContain(block.field);
            expect(ecommerceLayoutPreset(preset.id)).toBe(preset);
        }
        expect(createEcommerceLayoutFromPreset("不存在")).toBeUndefined();
    });

    test("ratios parse and unknown ones fall back to square", () => {
        expect(ecommerceRatioValue("1:1")).toBe(1);
        expect(ecommerceRatioValue("9:16")).toBeCloseTo(0.5625);
        expect(ecommerceRatioValue("乱写")).toBe(1);
    });

    test("export size keeps the long side fixed so no ratio loses resolution", () => {
        expect(ecommerceExportSize("1:1", 1600)).toEqual({ width: 1600, height: 1600 });
        expect(ecommerceExportSize("16:9", 1600)).toEqual({ width: 1600, height: 900 });
        expect(ecommerceExportSize("9:16", 1600)).toEqual({ width: 900, height: 1600 });
    });

    test("field labels are human, not raw keys", () => {
        expect(ecommerceLayoutFieldLabel("headline")).toBe("标题");
        expect(ecommerceLayoutFieldLabel("price")).toBe("价格");
    });
});

describe("ecommerce compliance", () => {
    test("absolute superlatives are blocked, not merely warned", () => {
        const issues = checkEcommerceText("全网最低价，销量第一", "标题");
        expect(issues.length).toBeGreaterThan(0);
        expect(ecommerceComplianceBlocked(issues)).toBe(true);
        expect(issues.every((issue) => issue.level === "block")).toBe(true);
    });

    test("covers the variants people actually type", () => {
        expect(checkEcommerceText("国家级品质", "x")[0]?.term).toBe("国家级");
        expect(checkEcommerceText("世界级工艺", "x")[0]?.term).toBe("世界级");
        expect(checkEcommerceText("顶级材质", "x")[0]?.term).toBe("顶级");
        expect(checkEcommerceText("唯一选择", "x")[0]?.term).toBe("唯一");
        expect(checkEcommerceText("100%有效", "x").length).toBeGreaterThan(0);
        expect(checkEcommerceText("根治", "x")[0]?.reason).toContain("治疗");
    });

    test("soft claims warn without blocking generation", () => {
        const issues = checkEcommerceText("纯天然配方", "副文案");
        expect(issues).toHaveLength(1);
        expect(issues[0].level).toBe("warn");
        expect(ecommerceComplianceBlocked(issues)).toBe(false);
    });

    test("clean copy produces nothing", () => {
        expect(checkEcommerceText("304 不锈钢，保温 12 小时", "副文案")).toEqual([]);
        expect(checkEcommerceText("", "标题")).toEqual([]);
        expect(checkEcommerceCompliance({})).toEqual([]);
    });

    test("scans every copy field and labels where the hit came from", () => {
        const issues = checkEcommerceCopy({ ...createEcommerceCopy(), headline: "最好的保温杯", price: "原价 ¥299" });
        expect(issues.map((issue) => issue.field)).toContain("标题");
        expect(issues.map((issue) => issue.field)).toContain("价格");
        expect(issues.find((issue) => issue.field === "价格")?.reason).toContain("七日");
    });

    test("scans selling points and the product category", () => {
        const issues = checkEcommerceCompliance({
            sellingPoints: [createEcommerceSellingPoint("销量第一", "某榜单")],
            profile: { name: "x", category: "顶级保温杯", appearance: "", marks: "", forbidden: "", views: {} },
        });
        expect(issues.map((issue) => issue.field)).toContain("卖点 1");
        expect(issues.map((issue) => issue.field)).toContain("品类");
    });

    test("the same term in the same field is reported once, not once per rule", () => {
        const issues = checkEcommerceText("最好的顶级产品", "标题");
        const keys = issues.map((issue) => `${issue.field}:${issue.term}`);
        expect(new Set(keys).size).toBe(keys.length);
    });
});
