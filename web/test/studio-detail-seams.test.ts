import { expect, test } from "bun:test";
import { studioDetailJoinGuide, studioBackgroundJoin, studioDetailEdgeColors, verifiedStudioOverlap } from "@/lib/ecommerce-studio/detail-seams";
import { studioShotPreview } from "@/lib/ecommerce-studio/product";
import type { StudioShot } from "@/lib/ecommerce-studio/types";

const width = 32;
const height = 12;

function strip(paint: (column: number, row: number) => number) {
    return Uint8ClampedArray.from({ length: width * height * 4 }, (_, index) => (index % 4 === 3 ? 255 : paint(Math.floor(index / 4) % width, Math.floor(index / (4 * width)))));
}

function texture(column: number, row: number) {
    return 64 + ((column * column * 3 + row * row * 5 + column * row * 7 + column * 11 + row * 23) % 113);
}

test("常规续画保留全宽色调，但不把细线、小块前景或文字送进下一屏", () => {
    const width = 54;
    const height = 12;
    const pixels = Uint8ClampedArray.from({ length: width * height * 4 }, (_, index) => {
        if (index % 4 === 3) return 255;
        const column = Math.floor(index / 4) % width;
        const row = Math.floor(index / (width * 4));
        if (column === 25 || (column < 22 && row < 3)) return 30;
        return 150 + Math.floor(column / 6) * 5 + (index % 4) * 2;
    });
    expect(studioDetailEdgeColors(pixels, width, height)).toEqual(Array.from({ length: 9 }, (_, index) => [150 + index * 5, 152 + index * 5, 154 + index * 5]));
});

test("只删除按原坐标复现的重叠像素，不把同色摄影当成重复边缘", () => {
    const prior = strip(texture);
    expect(verifiedStudioOverlap(prior, prior, width, height)).toBe(true);
    expect(
        verifiedStudioOverlap(
            prior,
            strip((column, row) => texture(column, row) + 1),
            width,
            height,
        ),
    ).toBe(true);
    expect(
        verifiedStudioOverlap(
            prior,
            strip((column, row) => texture(width - 1 - column, row)),
            width,
            height,
        ),
    ).toBe(false);
    const flat = strip(() => 225);
    expect(verifiedStudioOverlap(flat, flat, width, height)).toBe(false);
    const changed = prior.slice();
    for (let index = width * 4 * 3; index < width * 4 * 6; index += 4) if (index % (width * 4) < 8 * 4) changed.set([15, 15, 15], index);
    expect(verifiedStudioOverlap(prior, changed, width, height)).toBe(false);
    changed.set(prior);
    changed[3] = 0;
    expect(verifiedStudioOverlap(prior, changed, width, height)).toBe(false);
});

test("平滑坡度、重复织纹和局部相同的标记都不能证明全幅重叠", () => {
    for (const ambiguous of [strip((column, row) => 120 + column * 2 + row * 3), strip((column, row) => texture(column % 8, row % 4)), strip((column, row) => (column < width / 4 ? texture(column, row) : 180))]) {
        expect(verifiedStudioOverlap(ambiguous, ambiguous, width, height)).toBe(false);
    }
});

test("续画只认当前采用的上一屏和当前候选的生成凭证", () => {
    const shot = {
        attempts: [
            {
                outputs: [{ resourceId: "old-second" }],
                input: { compiled: { continuity: { guide: "positioned", previousScreen: 1, anchor: { sourceResourceId: "first", height: 136 }, reference: { resourceId: "guide", width: 1024, height: 1360 } } } },
            },
            {
                outputs: [{ resourceId: "second" }],
                input: { compiled: { continuity: { guide: "background", previousScreen: 1, anchor: { sourceResourceId: "first" }, reference: { resourceId: "sample", width: 640, height: 160 } } } },
            },
            {
                outputs: [{ resourceId: "continued" }],
                input: { compiled: { continuity: { guide: "context", previousScreen: 1, anchor: { sourceResourceId: "first" }, reference: { resourceId: "real-bottom", width: 1024, height: 684 } } } },
            },
        ],
    } as unknown as StudioShot;
    expect(studioDetailJoinGuide(shot, "old-second", "first", 1)).toEqual({ kind: "positioned", height: 136, width: 1024 });
    expect(studioDetailJoinGuide(shot, "second", "first", 1)).toEqual({ kind: "background" });
    expect(studioDetailJoinGuide(shot, "continued", "first", 1)).toEqual({ kind: "context" });
    expect(studioDetailJoinGuide(shot, "continued", "other-first", 1)).toBeUndefined();
    expect(studioDetailJoinGuide(shot, "second", "other-first", 1)).toBeUndefined();
    expect(studioDetailJoinGuide(shot, "other-second", "first", 1)).toBeUndefined();
    expect(studioDetailJoinGuide(shot, "second", "first", 2)).toBeUndefined();
});

test("全幅平缓且底色近似只标背景接近，不调色也不宣称内容已对齐", () => {
    const before = strip((column, row) => 188 + Math.floor(column / 8) + row);
    const after = strip((column, row) => 202 + Math.floor(column / 8) + row);
    const original = after.slice();
    expect(studioBackgroundJoin(before, after, width, height)).toEqual({ status: "compatible" });
    expect(
        studioBackgroundJoin(
            before,
            strip((column, row) => 214 + Math.floor(column / 8) + row),
            width,
            height,
        ),
    ).toEqual({ status: "unmatched" });
    expect(after).toEqual(original);
});

test("多处不重复的轮廓延续到下屏时，按真实像素判断，不裁行", () => {
    const before = strip((column) => texture(column, 2));
    const after = strip((column) => texture(column, 2) + 1);
    expect(studioBackgroundJoin(before, after, width, height)).toEqual({ status: "matched" });
    const repeating = strip((column) => texture(column % 5, 2));
    expect(studioBackgroundJoin(repeating, repeating, width, height)).toEqual({ status: "unmatched" });
});

test("上屏的细微非周期纹理在下屏消失时不能声称结构吻合", () => {
    const marks = "01001110101110011011001111000100";
    const textured = strip((column) => (marks[column] === "1" ? 138 : 118));
    const plain = strip(() => 128);
    expect(studioBackgroundJoin(textured, plain, width, height)).toEqual({ status: "unmatched" });
    expect(studioBackgroundJoin(plain, textured, width, height)).toEqual({ status: "unmatched" });
});

test("仅一行颜色相同但两侧主体交换，不算通过", () => {
    const before = strip((column, row) => (row === height - 1 ? 200 : column < width / 2 ? 20 : 240));
    const after = strip((column, row) => (row === 0 ? 200 : column < width / 2 ? 240 : 20));
    expect(studioBackgroundJoin(before, after, width, height)).toEqual({ status: "unmatched" });
    expect(
        studioBackgroundJoin(
            strip(texture),
            strip((column, row) => texture(column, height - 1 - row)),
            width,
            height,
        ),
    ).toEqual({ status: "unmatched" });
});

test("接边精修完成后仍使用原成品，只有采用候选才切换", () => {
    const original = { resourceId: "original", url: "" };
    const repaired = { resourceId: "repaired", url: "" };
    const shot = {
        attempts: [
            { status: "succeeded", outputs: [original] },
            { status: "succeeded", outputs: [repaired], input: { compiled: { continuity: { guide: "edge", repair: true } } } },
        ],
    } as unknown as StudioShot;
    expect(studioShotPreview(shot)).toEqual(original);
    expect(studioShotPreview({ ...shot, adopted: repaired })).toEqual(repaired);
});

test("边缘有文字、主体边界、透明区或明显跳色时不改图", () => {
    const before = strip((column, row) => 188 + Math.floor(column / 8) + row);
    const safe = strip((column, row) => 200 + Math.floor(column / 8) + row);
    expect(studioBackgroundJoin(before, safe, width, height)).toEqual({ status: "compatible" });
    const edge = strip((column, row) => (column > 10 && column < 15 && row > 2 ? 145 : 214));
    expect(studioBackgroundJoin(before, edge, width, height)).toEqual({ status: "unmatched" });
    expect(studioBackgroundJoin(edge, safe, width, height)).toEqual({ status: "unmatched" });
    expect(
        studioBackgroundJoin(
            before,
            strip(() => 245),
            width,
            height,
        ),
    ).toEqual({ status: "unmatched" });
    safe[3] = 254;
    expect(studioBackgroundJoin(before, safe, width, height)).toEqual({ status: "unmatched" });
});
