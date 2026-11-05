import { describe, expect, test } from "bun:test";
import { ECOMMERCE_DELIVERABLE_SETS, ECOMMERCE_DETAIL_PAGE_SET, ECOMMERCE_MAIN_IMAGE_SET } from "@/lib/ecommerce/ecommerce-deliverables";
describe("industry deliverable structure", () => {
    test("the five main images follow the trade-standard breakdown", () => {
        const slots = ECOMMERCE_MAIN_IMAGE_SET.slots;
        expect(slots).toHaveLength(5);
        // 顺序是行业共识：核心展示 → 卖点 → 场景 → 细节 → 规格
        expect(slots[0].title).toContain("核心展示");
        expect(slots[1].title).toContain("卖点");
        expect(slots[2].title).toContain("场景");
        expect(slots[3].title).toContain("细节");
        expect(slots[4].title).toContain("规格");
        // 第一张决定点击率，职责里必须写清楚
        expect(slots[0].duty).toContain("点击率");
    });

    test("the detail page follows the ten-screen production order", () => {
        const slots = ECOMMERCE_DETAIL_PAGE_SET.slots;
        expect(slots).toHaveLength(10);
        expect(slots.map((slot) => slot.title)).toEqual([
            "详情01 · 品牌主视觉",
            "详情02 · 核心卖点一",
            "详情03 · 核心卖点二",
            "详情04 · 核心卖点三",
            "详情05 · 多场景展示",
            "详情06 · 产品细节",
            "详情07 · 参数可视化",
            "详情08 · 适用人群",
            "详情09 · 品质背书",
            "详情10 · 购买理由总结",
        ]);
    });

    test("every slot names a duty and a real shot preset", () => {
        for (const set of ECOMMERCE_DELIVERABLE_SETS) {
            expect(set.slots.length).toBeGreaterThan(0);
            for (const slot of set.slots) {
                expect(slot.title.trim()).not.toBe("");
                expect(slot.duty.trim()).not.toBe("");
                expect(slot.presetId.trim()).not.toBe("");
            }
            const ids = set.slots.map((slot) => slot.id);
            expect(new Set(ids).size).toBe(ids.length);
        }
    });

    test("the full listing set is the main images plus the detail page plus extras", () => {
        const full = ECOMMERCE_DELIVERABLE_SETS.find((set) => set.id === "full-listing")!;
        expect(full.slots.length).toBe(ECOMMERCE_MAIN_IMAGE_SET.slots.length + ECOMMERCE_DETAIL_PAGE_SET.slots.length + 2);
        expect(full.slots.filter((slot) => slot.id.startsWith("detail-"))).toHaveLength(10);
    });
});
