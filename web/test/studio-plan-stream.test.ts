import { describe, expect, test } from "bun:test";
import { createStudioPlanStreamReader } from "@/lib/ecommerce-studio/plan-stream";

const first = { title: "真实首屏", purpose: "看清商品", headline: "方框与银饰", subline: "可见结构", visual: '主标题写“方框”，避免把 { } 和 "screens":[] 当结构', elements: { nested: ["A", "B"] } };
const second = { title: "局部细节", purpose: "看清连接处", visual: "银色铰链微距" };

describe("studio incremental plan preview", () => {
    test("emits a closed screen before the second screen and design system finish", () => {
        const reader = createStudioPlanStreamReader("template");
        const beginning = '{"summary":"看清外观","concept":"编辑画册","screens":[';
        expect(reader.read(beginning).screens).toEqual([]);
        const draft = `${beginning}${JSON.stringify(first)},`;
        expect(reader.read(draft)).toMatchObject({
            summary: "看清外观",
            concept: "编辑画册",
            screens: [{ index: 0, title: first.title, purpose: first.purpose, visual: first.visual }],
        });
        expect(reader.read(`${draft}${JSON.stringify(second).slice(0, -1)}`).screens).toHaveLength(1);
        expect(reader.read(`${draft}${JSON.stringify(second)}],"style":"整组规范"}`).screens).toMatchObject([{ index: 0 }, { index: 1, title: second.title }]);
    });

    test("ordinary detail streams only the purchase summary and content brief even if legacy art direction is returned", () => {
        const reader = createStudioPlanStreamReader("detail");
        const screen = {
            ...first,
            purchaseQuestion: "买家怎样抽出第一张纸？",
            displayContent: "手从包装开口抽出一张纸",
            visualBeat: "被提起的纸张和抽取动作主导画面",
            visualFocus: "开口与纸巾之间的关系",
            evidence: [" appearance:1 "],
            composition: "editorial",
            imagePrompt: "左右分栏",
            negativePrompt: "不要场景",
            aspectRatio: "1:1",
        };
        const opened = '{"summary":"从识别商品到理解用法","concept":"重复包装墙","screens":[';
        expect(reader.read(opened).screens).toEqual([]);
        expect(reader.read(`${opened}${JSON.stringify(screen)},`)).toMatchObject({ summary: "从识别商品到理解用法", concept: "", screens: [{ visualBeat: screen.visualBeat }] });
        expect(reader.read(`${opened}${JSON.stringify(screen)}]}`).screens).toEqual([{ index: 0, purpose: screen.purchaseQuestion, visual: screen.displayContent, visualBeat: screen.visualBeat, elements: screen.visualFocus, evidence: ["appearance:1"] }]);
        expect(reader.read(JSON.stringify({ screens: [{ ...second, elements: "每屏使用固定文字栏" }] })).screens).toEqual([{ index: 0, purpose: second.purpose, visual: second.visual }]);
    });

    test("handles every-character chunks, escaped braces, wrappers and nested objects without duplicate screens", () => {
        const raw = `\`\`\`json\n${JSON.stringify({ summary: '带有 "引号" 的说明', screens: [first, second], artDirection: { screens: [{ title: "不是详情屏" }] } })}\n\`\`\``;
        const reader = createStudioPlanStreamReader("detail");
        for (let cursor = 1; cursor < raw.length; cursor++) reader.read(raw.slice(0, cursor));
        expect(reader.read(raw).screens).toHaveLength(2);
        expect(reader.read(raw).screens[0].visual).toBe(first.visual);
    });

    test("a replaced final result resets drafts instead of appending old screens", () => {
        const reader = createStudioPlanStreamReader("detail");
        reader.read(JSON.stringify({ screens: [first, second] }));
        expect(reader.read(JSON.stringify({ screens: [second] })).screens).toEqual([{ index: 0, purpose: second.purpose, visual: second.visual }]);
    });

    test("invalid closed screen stays out of previews and does not break final validation flow", () => {
        const reader = createStudioPlanStreamReader("detail");
        expect(() => reader.read('{"screens":[{"title":"坏屏", nope:1},')).not.toThrow();
        expect(reader.read(`{"screens":[{"title":"坏屏", nope:1},${JSON.stringify(second)}]}`).screens).toMatchObject([{ index: 1, purpose: second.purpose }]);
    });
});
