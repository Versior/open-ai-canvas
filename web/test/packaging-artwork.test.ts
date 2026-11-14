import { describe, expect, test } from "bun:test";
import { artworkBounds, artworkHandles, artworkPoint, movePackagingArtwork, resizePackagingArtwork, rotatePackagingArtwork, packagingMaskLuminance } from "../src/lib/packaging/artwork";
import type { PackagingArtwork, Point } from "../src/lib/packaging/types";

const artwork: PackagingArtwork = { id: "a", resourceId: "r", name: "图稿", panelId: "", role: "artwork", x: -13, y: 27, width: 120, height: 80, rotation: 0, opacity: 1 };

describe("图稿直接变换", () => {
    test("八个手柄在任意旋转下固定对面锚点，四角等比，边点自由缩放", () => {
        for (const rotation of [0, 15, 90, -145, 180]) {
            const art = { ...artwork, rotation };
            for (const handle of artworkHandles) {
                const original = artworkPoint(art, (-handle[0] * art.width) / 2, (-handle[1] * art.height) / 2);
                const changed = { ...art, ...resizePackagingArtwork(art, handle, [12, -8], true) };
                const anchor = artworkPoint(changed, (-handle[0] * changed.width) / 2, (-handle[1] * changed.height) / 2);
                expect(anchor[0]).toBeCloseTo(original[0], 9);
                expect(anchor[1]).toBeCloseTo(original[1], 9);
                if (handle[0] && handle[1]) expect(changed.width / changed.height).toBeCloseTo(1.5, 9);
                if (!handle[0]) expect(changed.width).toBe(art.width);
                if (!handle[1]) expect(changed.height).toBe(art.height);
            }
        }
    });
    test("穿过锚点不翻转；极大拖动受合同尺寸限制，Alt 可解除角点比例", () => {
        for (const delta of [
            [-10000, -10000],
            [10000, 10000],
        ] satisfies Point[]) {
            const scaled = resizePackagingArtwork(artwork, [1, 1], delta, true);
            expect(scaled.width).toBeGreaterThanOrEqual(0.1);
            expect(scaled.height).toBeGreaterThanOrEqual(0.1);
            expect(scaled.width).toBeLessThanOrEqual(8000);
            expect(scaled.height).toBeLessThanOrEqual(8000);
            expect(scaled.width / scaled.height).toBeCloseTo(1.5, 9);
        }
        expect(resizePackagingArtwork(artwork, [1, 1], [30, 0], false).width).toBe(150);
        expect(resizePackagingArtwork(artwork, [1, 1], [30, 0], false).height).toBe(80);
    });
    test("旋转跨越 atan2 分界，15°吸附，旋转矩形外框", () => {
        expect(rotatePackagingArtwork(artwork, [48, 0], [114, 68], true).rotation).toBe(90);
        const start: Point = [-100, 68];
        const end: Point = [-100, 66];
        expect(Math.abs(rotatePackagingArtwork(artwork, start, end, false).rotation)).toBeLessThan(1);
        const bounds = artworkBounds({ ...artwork, rotation: 90 });
        expect(bounds.width).toBeCloseTo(80, 8);
        expect(bounds.height).toBeCloseTo(120, 8);
        expect(bounds.x).toBeCloseTo(7, 8);
    });
    test("优先吸附目标面边缘/中心，超出容差用毫米网格，关闭后完全连续", () => {
        const target = { x: 0, y: 0, width: 300, height: 200 };
        const snapped = movePackagingArtwork(artwork, [14, -25], target, 3, true);
        expect(snapped.x).toBe(0);
        expect(snapped.y).toBe(0);
        expect(snapped.guides).toEqual([
            { axis: "x", value: 0 },
            { axis: "y", value: 0 },
        ]);
        const free = movePackagingArtwork(artwork, [14.27, -25.32], target, 3, false);
        expect(free.x).toBeCloseTo(1.27);
        expect(free.y).toBeCloseTo(1.68);
        expect(free.guides).toHaveLength(0);
    });
    test("工艺按统一亮度计算，白色生效，黑色无作用", () => {
        expect(packagingMaskLuminance(255, 255, 255)).toBe(255);
        expect(packagingMaskLuminance(0, 0, 0)).toBe(0);
        expect(packagingMaskLuminance(255, 0, 0)).toBe(54);
        expect(packagingMaskLuminance(0, 255, 0)).toBe(182);
    });
});
