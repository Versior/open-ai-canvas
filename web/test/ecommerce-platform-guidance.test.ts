import { expect, test } from "bun:test";
import { ECOMMERCE_ONE_CLICK_FLOWS } from "../src/lib/ecommerce/ecommerce-oneclick";
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
    for (const [platformId, role] of [
        ["jd", "main"],
        ["amazon", "main"],
        ["amazon", "ad"],
    ] as const) {
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

test("server-injected analysis omits director text but retains the output contract", () => {
    const prompt = ecommerceSuiteDraftPrompt(ECOMMERCE_ONE_CLICK_FLOWS[0], undefined, [], null);
    expect(prompt).not.toContain("你是电商出图导演");
    expect(prompt).toContain("槽位id");
});
