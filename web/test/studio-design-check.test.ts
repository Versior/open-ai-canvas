import { expect, test } from "bun:test";
import { buildStudioDesignCheckPrompt } from "@/lib/ecommerce-studio/design-check";
import { createStudioProduct } from "@/lib/ecommerce-studio/product";
import { compileStudioPrompt } from "@/lib/ecommerce-studio/prompt-compiler";
import type { StudioShot } from "@/lib/ecommerce-studio/types";

const screen: StudioShot = {
    id: "screen",
    role: "detail-closeup",
    title: "镜架细节",
    ratio: "3:4",
    screenIndex: 3,
    screenCount: 6,
    composition: "left",
    visual: "展示透明镜框边缘",
    headline: "",
    subline: "",
    lines: [],
    tweaks: [],
    attempts: [],
    sellingPointIds: [],
};

test("detail artwork checks use the submitted readable-copy requirement without a text whitelist or a draft layout", () => {
    const product = createStudioProduct("artwork-check");
    product.brief.outputType = "detail-set";
    const execution = compileStudioPrompt({ product, shot: screen, pageKind: "detail", model: "gpt-image-2" });
    const prompt = buildStudioDesignCheckPrompt(product, screen, true, execution);
    expect(prompt).toContain("第 3/6 屏");
    expect(prompt).toMatch(/必须[^。\n]*清楚可读[^。\n]*简体中文短文案/);
    expect(prompt).toContain("按实际要求检查文字是否清楚可读、回答本屏问题");
    expect(prompt).not.toContain("保持无字");
    expect(prompt).not.toContain("允许文案");
    expect(prompt).not.toContain("逐字核对以下定稿");
    expect(prompt).not.toContain("构图方向：");
});

test("artwork checks honor the submitted no-text requirement even when the draft has copy", () => {
    const product = createStudioProduct("artwork-check-no-text");
    const textless = { ...screen, headline: "不要采用这句草稿", noText: true };
    const execution = compileStudioPrompt({ product, shot: textless, pageKind: "detail", model: "gpt-image-2" });
    const prompt = buildStudioDesignCheckPrompt(product, textless, true, execution);
    expect(prompt).toContain("画面中不添加任何文字，只保留商品自带的标识和印字");
    expect(prompt).not.toContain(textless.headline);
    expect(prompt).not.toContain("必须在成品里排入");
    expect(prompt).not.toContain("允许文案");
});

test("artwork checks compare submitted locked copy without reading later edits as the original wording", () => {
    const product = createStudioProduct("artwork-check-locked");
    const locked = { ...screen, headline: "透明前框", copySource: "user" as const };
    const execution = compileStudioPrompt({ product, shot: locked, pageKind: "detail", model: "gpt-image-2" });
    const prompt = buildStudioDesignCheckPrompt(product, { ...screen, headline: "后来更新的标题" }, true, execution);
    expect(prompt).toContain('逐字核对以下定稿：["透明前框"]');
    expect(prompt).not.toContain("后来更新的标题");
});
