import { expect, test } from "bun:test";
import { ecommerceBriefBlock, ecommerceBriefRows, ecommerceBriefSlicePlatform } from "../src/lib/ecommerce/ecommerce-brief";
import { ECOMMERCE_ONE_CLICK_FLOWS } from "../src/lib/ecommerce/ecommerce-oneclick";
import { ecommerceSliceSpec } from "../src/lib/ecommerce/ecommerce-slice";
import { ecommerceSuiteDraftPrompt } from "../src/lib/ecommerce/ecommerce-suite";
import { ecommercePlatformGuidance } from "../src/lib/ecommerce/ecommerce-platform-guidance";
import { ecommercePlatform } from "../src/lib/ecommerce/ecommerce-platform-specs";

test("no guidance role ever calls unverified platform numbers a hard rule", () => {
    for (const platform of ["Amazon", "京东", "淘宝", "小红书", "TikTok Shop", "Shopify", "自定义平台"]) {
        for (const flowId of ["main", "seed", "detail"] as const) {
            const guidance = ecommercePlatformGuidance(platform, flowId);
            expect(guidance).not.toContain("当前角色硬规则");
            expect(guidance).toContain("参考规范（未核验官方出处，仅作自查建议）");
        }
    }
});

test("main and ad notes forbid added text without forbidding the product's own branding", () => {
    for (const [platformId, role] of [["jd", "main"], ["amazon", "main"], ["amazon", "ad"]] as const) {
        const note = ecommercePlatform(platformId)!.roles[role]!.note;
        // 模糊的「禁 LOGO」会被模型理解成「把商品本体商标擦掉」，必须收窄成「不额外叠加」。
        for (const vague of ["禁文字、LOGO", "首图不许文字与 LOGO", "禁文字、图形、LOGO"]) expect(note).not.toContain(vague);
        expect(note).toContain("额外");
        expect(note).toContain("商品本体");
    }
});

test("unverified JD logo placement is a to-confirm note instead of a guaranteed fact", () => {
    const jdMain = ecommercePlatform("jd")!.roles.main!.note;
    expect(jdMain).not.toContain("系统自动加");
    expect(jdMain).toContain("上架后台确认");
});

test("supplementary information enters analysis with real line breaks", () => {
    const brief = { platform: "Amazon", imageCount: 6, language: "English", sellingPoints: "confirmed capacity", forbidden: "no certifications", style: "warm light" };
    const block = ecommerceBriefBlock(brief, "detail");
    expect(block.split(String.fromCharCode(10)).length).toBeGreaterThan(7);
    expect(block).toContain("第 2–9 位放场景、卖点、尺寸、细节、对比、包装");
    expect(block).not.toContain("纯白 RGB(255,255,255)");
    expect(block).not.toContain("主图文字");
    expect(block).toContain("仅用于画面规划");
    for (const value of ["Amazon", "6", "English", "confirmed capacity", "no certifications", "warm light"]) expect(block).toContain(value);
});

test("guidance wording matches what the checker can actually enforce", () => {
    const brief = { platform: "Amazon" };
    // 内置数值没有可核验官方出处，检查只给 warn，指导文本就不能自称硬规则
    expect(ecommerceBriefBlock(brief, "detail")).toContain("参考规范（未核验官方出处，仅作自查建议）");
    expect(ecommerceBriefBlock(brief, "detail")).not.toContain("硬规则（当前内置规范）");
    // 项目自身十屏 3:4 是自定要求，不因平台口径未核验而降级
    expect(ecommerceBriefBlock(brief, "detail")).toContain("本项目自身要求：详情页默认十屏");
    expect(ecommerceBriefBlock(brief, "detail")).toContain("每屏 3:4 竖版");
});

test("detail guidance keeps default suite count separate from the current image", () => {
    for (const platform of ["Amazon", "自定义平台"]) {
        const guidance = ecommercePlatformGuidance(platform, "detail");
        expect(guidance).toContain("详情页默认十屏");
        expect(guidance).toContain("用户确认的行计划优先");
        expect(guidance).toContain("不补回删掉的屏");
        expect(guidance).toContain("每屏 3:4 竖版");
        expect(guidance).toContain("单张生图只生成当前屏");
        expect(guidance).toContain("不把整套拼进一张图");
    }
    expect(ecommercePlatformGuidance("Amazon", "main")).not.toContain("详情页默认十屏");
});

test("image count preserves existing edits and adds unique slots", () => {
    const flow = ECOMMERCE_ONE_CLICK_FLOWS[0];
    const rows = [{ slotId: "detail-extra-2", title: "My title", duty: "My duty", prompt: "Edited" }];
    const expanded = ecommerceBriefRows(flow, rows, { imageCount: 3 });
    expect(expanded).toHaveLength(3);
    expect(expanded[0]).toBe(rows[0]);
    expect(new Set(expanded.map((row) => row.slotId)).size).toBe(3);
    expect(ecommerceBriefRows(flow, expanded, { imageCount: 1 })).toEqual(rows);
    for (const imageCount of [0, 31, 1.5, NaN]) expect(() => ecommerceBriefRows(flow, rows, { imageCount })).toThrow();
});

test("server-injected analysis omits director text but retains the output contract", () => {
    const prompt = ecommerceSuiteDraftPrompt(ECOMMERCE_ONE_CLICK_FLOWS[0], undefined, [], null);
    expect(prompt).not.toContain("你是电商出图导演");
    expect(prompt).toContain("槽位id");
});

test("slice specifications resolve known platforms and never disguise generic exports as Taobao", () => {
    expect(ecommerceBriefSlicePlatform({ platform: "Amazon", slicePlatform: "jd" }, "taobao")).toBe("jd");
    expect(ecommerceBriefSlicePlatform({ platform: "京东" }, "taobao")).toBe("jd");
    expect(ecommerceBriefSlicePlatform({ platform: "Amazon" }, "douyin")).toBe("generic");
    expect(ecommerceBriefSlicePlatform({ platform: "Shopify" })).toBe("generic");
    expect(ecommerceBriefSlicePlatform(undefined, "抖店")).toBe("douyin");
    expect(ecommerceBriefSlicePlatform(undefined, "unknown")).toBe("generic");
    expect(ecommerceBriefSlicePlatform()).toBe("generic");
    expect(ecommerceSliceSpec(ecommerceBriefSlicePlatform())?.note).toContain("不是任何平台审核硬规则");
});
