import { describe, expect, test } from "bun:test";

import { createEcommerceShot } from "@/lib/ecommerce/ecommerce-contract";
import {
    ECOMMERCE_PLATFORMS,
    aspectRatioLabel,
    checkImageAcrossPlatforms,
    checkImageAgainstSpec,
    ecommerceFileName,
    ecommercePlatform,
    ecommerceRoleSpec,
    ecommerceSpecBlocked,
    ecommercePlatformChoiceTier,
    ecommercePlatformChoiceLabel,
    resolveEcommercePlatformId,
} from "@/lib/ecommerce/ecommerce-platform-specs";
import { ecommerceDiagramBoxes, ecommerceShotDiagram } from "@/lib/ecommerce/ecommerce-shot-diagram";
import { ECOMMERCE_BRIEF_CHOICES, ecommerceChoiceOptions } from "@/components/canvas/ecommerce-choice-input";

describe("platform specs", () => {
    test("resolves platform ids from ids, display names and common aliases", () => {
        expect([
            "淘宝",
            "天猫",
            "淘宝 / 天猫",
            "京东",
            "拼多多",
            "抖店",
            "小红书",
            "Amazon",
            "Shopify",
            "独立站",
            "TikTok Shop",
        ].map(resolveEcommercePlatformId)).toEqual(["taobao", "taobao", "taobao", "jd", "pdd", "douyin", "xiaohongshu", "amazon", "shopify", "shopify", "tiktokshop"]);
        expect(resolveEcommercePlatformId("custom marketplace")).toBeUndefined();
        expect(resolveEcommercePlatformId()).toBeUndefined();
    });

    test("platform choices say whether they carry built-in specs, and other choices say nothing", () => {
        // 有内置角色的算专属规格，其余（快手、1688、eBay……）只走通用建议
        for (const value of ["淘宝", "天猫", "京东", "Amazon", "TikTok Shop", "独立站"]) expect(ecommercePlatformChoiceTier(value)).toBe("专属规格");
        for (const value of ["快手", "微信小店", "1688", "得物", "eBay", "Temu", "SHEIN", "我自己的小店", ""]) expect(ecommercePlatformChoiceTier(value)).toBe("通用建议");
    });

    test("platform dropdown labels carry the tier while the stored value stays untouched", () => {
        expect(ecommercePlatformChoiceLabel("淘宝")).toBe("淘宝 · 专属规格");
        expect(ecommercePlatformChoiceLabel("快手")).toBe("快手 · 通用建议");
        // 用户自己填的平台不清空、不改写
        expect(ecommercePlatformChoiceLabel("我自己的小店")).toBe("我自己的小店 · 通用建议");
        expect(ecommercePlatformChoiceLabel("")).toBe("");
    });

    test("only the platform field annotates its dropdown; market and language stay as they are", () => {
        // 平台候选：显示文案带口径，提交值仍是原文
        expect(ecommerceChoiceOptions(["淘宝", "快手"], "", true)).toEqual([
            { value: "淘宝", label: "淘宝 · 专属规格" },
            { value: "快手", label: "快手 · 通用建议" },
        ]);
        // 市场与语言一字不加，过滤行为不变
        expect(ecommerceChoiceOptions(["中国", "美国"], "美", false)).toEqual([{ value: "美国", label: "美国" }]);
        expect(ecommerceChoiceOptions(ECOMMERCE_BRIEF_CHOICES.language, "", false).map((option) => option.label)).toEqual([...ECOMMERCE_BRIEF_CHOICES.language]);
    });

    test("covers both the domestic and the overseas platforms this product ships to", () => {
        expect(ECOMMERCE_PLATFORMS.map((platform) => platform.id)).toEqual(["taobao", "jd", "pdd", "douyin", "xiaohongshu", "amazon", "walmart", "etsy", "tiktokshop", "shopify"]);
        for (const platform of ECOMMERCE_PLATFORMS) {
            expect(Object.keys(platform.roles).length).toBeGreaterThan(0);
            for (const spec of Object.values(platform.roles)) {
                expect(spec!.note.trim()).not.toBe("");
            }
        }
    });

    test("every main image slot on every platform is described in full", () => {
        // 主图是唯一每个平台都有的角色，也是驳回率最高的位置——缺字段就等于缺校验
        for (const platform of ECOMMERCE_PLATFORMS) {
            expect(platform.roles.main).toBeDefined();
        }
    });

    test("amazon's main image is the strictest spec in the set", () => {
        const main = ecommerceRoleSpec("amazon", "main")!;
        expect(main.whiteBackground).toBe(true);
        expect(main.noText).toBe(true);
        // 主体 85% 是亚马逊独有的硬线，比国内任何平台都高
        expect(main.minSubjectRatio).toBe(0.85);
        // 1600px 以上才在桌面与移动端都能放大，所以最低给到 1000（放大镜门槛）
        expect(main.minWidth).toBe(1000);
        expect(main.note).toContain("255,255,255");
    });

    test("amazon ads forbid the white background the main image requires", () => {
        // 把主图直接复用成品牌推广图是最常见的错——两者规范正好相反
        const ad = ecommerceRoleSpec("amazon", "ad")!;
        expect(ad.whiteBackground).toBeUndefined();
        expect(ad.ratio).toBe("1.91:1");
        expect(ad.note).toContain("不许用白底");
    });

    test("tiktok shop flags generated imagery for disclosure", () => {
        const main = ecommerceRoleSpec("tiktokshop", "main")!;
        expect(main.requiresAiDisclosure).toBe(true);
        // 没标 generated 就不报——测不了的项不能靠猜
        expect(checkImageAgainstSpec({ platformId: "tiktokshop", role: "main", facts: { width: 1200, height: 1200 } })).toEqual([]);
        const generated = checkImageAgainstSpec({ platformId: "tiktokshop", role: "main", facts: { width: 1200, height: 1200, audit: { generated: true } } });
        expect(generated).toHaveLength(1);
        expect(generated[0].message).toContain("AI-generated");
    });

    test("a video slot accepts either of its allowed ratios and rejects the rest", () => {
        const ok = checkImageAgainstSpec({ platformId: "amazon", role: "video", facts: { width: 1920, height: 1080 } });
        expect(ok).toEqual([]);
        const portrait = checkImageAgainstSpec({ platformId: "amazon", role: "video", facts: { width: 1080, height: 1920 } });
        expect(portrait).toEqual([]);
        const square = checkImageAgainstSpec({ platformId: "amazon", role: "video", facts: { width: 1080, height: 1080 } });
        expect(square).toHaveLength(1);
        expect(square[0].message).toContain("16:9 或 9:16");
    });

    test("delivery filenames switch to the platform's own role words overseas", () => {
        // 跨境交付清单要直接进 Amazon 后台上传，中文名会被拒
        expect(ecommerceFileName({ code: "A001", role: "main", index: 1, platformId: "amazon" })).toBe("A001_MAIN_01_amazon_v1.jpg");
        expect(ecommerceFileName({ code: "A001", role: "main", index: 1, platformId: "taobao" })).toBe("A001_主图_01_taobao_v1.jpg");
        expect(ecommerceFileName({ code: "A001", role: "detail", index: 3 })).toBe("A001_详情_03_v1.jpg");
    });

    test("every white-background spec requires pure white and no text", () => {
        for (const platform of ECOMMERCE_PLATFORMS) {
            const white = platform.roles.white;
            if (!white) continue;
            expect(white.whiteBackground).toBe(true);
            expect(white.noText).toBe(true);
            expect(white.minSubjectRatio).toBeGreaterThan(0);
        }
    });

    test("undersized images are reported against the built-in spec without claiming platform approval", () => {
        const issues = checkImageAgainstSpec({ platformId: "taobao", role: "main", facts: { width: 600, height: 600 } });
        // 600×600 比例仍是 1:1，只差在宽高两条
        expect(issues).toHaveLength(2);
        // 没有可核验出处，只算建议；但仍要说清差在哪
        expect(issues.every((issue) => issue.level === "warn")).toBe(true);
        expect(issues.map((issue) => issue.message).join(" ")).toContain("800");
        expect(issues[0].scope).toContain("淘宝");
    });

    test("a compliant main image passes", () => {
        expect(checkImageAgainstSpec({ platformId: "taobao", role: "main", facts: { width: 1200, height: 1200, bytes: 900 * 1024 } })).toEqual([]);
    });

    test("oversized files and wrong ratios are caught", () => {
        const issues = checkImageAgainstSpec({ platformId: "jd", role: "main", facts: { width: 1200, height: 900, bytes: 2 * 1024 * 1024 } });
        expect(issues.map((issue) => issue.message).join(" ")).toContain("比例");
        expect(issues.map((issue) => issue.message).join(" ")).toContain("超过上限");
    });

    test("white-background checks stay silent until the image has actually been audited", () => {
        // 没检测就不报——不能用猜测填满报告
        expect(checkImageAgainstSpec({ platformId: "taobao", role: "white", facts: { width: 800, height: 800 } })).toEqual([]);
        const dirty = checkImageAgainstSpec({ platformId: "taobao", role: "white", facts: { width: 800, height: 800, audit: { whiteEdgeRatio: 0.42, cornerColor: "#8A8A8A" } } });
        expect(dirty).toHaveLength(1);
        expect(dirty[0].level).toBe("warn");
        expect(dirty[0].message).toContain("#8A8A8A");
    });

    test("subject and text ratios are only judged when the model supplied them", () => {
        const clean = checkImageAgainstSpec({ platformId: "taobao", role: "white", facts: { width: 800, height: 800, audit: { whiteEdgeRatio: 1, subjectRatio: 0.75, textRatio: 0 } } });
        expect(clean).toEqual([]);

        const crowded = checkImageAgainstSpec({ platformId: "taobao", role: "white", facts: { width: 800, height: 800, audit: { whiteEdgeRatio: 1, subjectRatio: 0.4 } } });
        expect(crowded[0].message).toContain("主体占画面 40%");
    });

    test("douyin's first main image forbids any text at all", () => {
        const issues = checkImageAgainstSpec({ platformId: "douyin", role: "main", facts: { width: 800, height: 800, audit: { textRatio: 0.03 } } });
        expect(issues).toHaveLength(1);
        expect(issues[0].message).toContain("不允许出现文字");
    });

    test("taobao allows a little text but reports both the over-limit and the far-over-limit case", () => {
        const warned = checkImageAgainstSpec({ platformId: "taobao", role: "main", facts: { width: 800, height: 800, audit: { textRatio: 0.15 } } });
        expect(warned[0].level).toBe("warn");
        const blocked = checkImageAgainstSpec({ platformId: "taobao", role: "main", facts: { width: 800, height: 800, audit: { textRatio: 0.25 } } });
        expect(blocked[0].level).toBe("warn");
        expect(blocked[0].message).toContain("文字面积");
    });

    test("one image can be checked against several platforms at once", () => {
        const issues = checkImageAcrossPlatforms({ width: 800, height: 800 }, [
            { platformId: "taobao", role: "main" },
            { platformId: "xiaohongshu", role: "cover" },
        ]);
        expect(issues.some((issue) => issue.scope.includes("小红书"))).toBe(true);
    });

    test("ratios reduce to lowest terms", () => {
        expect(aspectRatioLabel(1200, 1200)).toBe("1:1");
        expect(aspectRatioLabel(750, 1000)).toBe("3:4");
        expect(aspectRatioLabel(0, 100)).toBe("");
    });

    test("decimal and non-exact ratios pass within the project's own 1% tolerance", () => {
        // 1200×628 是 Amazon 品牌推广图的标准尺寸，1.91:1 是小数比例，按最简整数比永远对不上
        expect(checkImageAgainstSpec({ platformId: "amazon", role: "ad", facts: { width: 1200, height: 628 } })).toEqual([]);
        // 小红书封面 1242×1660 化简是 621:830，与 3:4 只差 0.24%，在 1% 容差内算通过
        expect(checkImageAgainstSpec({ platformId: "xiaohongshu", role: "cover", facts: { width: 1242, height: 1660 } })).toEqual([]);
        // 容差不是放水：4:3 对 1:1 差 33%，照样报出来（未核验所以是提醒，不是拦截）
        const wrong = checkImageAgainstSpec({ platformId: "jd", role: "main", facts: { width: 1200, height: 900 } });
        expect(wrong.map((issue) => issue.message).join(" ")).toContain("比例 4:3");
    });

    test("no slot carries both ratio and allowedRatios, so the ratio check never double-blocks", () => {
        for (const platform of ECOMMERCE_PLATFORMS) {
            for (const spec of Object.values(platform.roles)) expect(Boolean(spec!.ratio && spec!.allowedRatios?.length)).toBe(false);
        }
    });

    test("unusable dimensions are never treated as a pass", () => {
        for (const [width, height] of [[Number.NaN, 628], [Number.POSITIVE_INFINITY, 628], [1200, 0]]) {
            const issues = checkImageAgainstSpec({ platformId: "amazon", role: "ad", facts: { width, height } });
            expect(issues.length).toBeGreaterThan(0);
            expect(issues.every((issue) => issue.level === "warn")).toBe(true);
            // 交付清单会原样抄这句话，NaN 不能漏到用户眼前
            expect(issues.map((issue) => issue.message).join(" ")).not.toContain("NaN");
        }
    });

    test("unknown platform or role produces no issues instead of crashing", () => {
        expect(ecommercePlatform("taobao")?.name).toBe("淘宝 / 天猫");
        expect(ecommerceRoleSpec("taobao", "cover")).toBeUndefined();
    });

    test("delivery filenames follow the trade convention and never say final", () => {
        const name = ecommerceFileName({ code: "A001", role: "main", index: 2, variant: "文字", version: 3 });
        expect(name).toBe("A001_主图_02_文字_v3.jpg");
        expect(name).not.toContain("最终");
        // 版本号只增不减——名字里必须带 v
        expect(ecommerceFileName({ code: "A001", role: "white", index: 1 })).toContain("_v1");
        expect(ecommerceFileName({ code: "", role: "detail", index: 9, platformId: "douyin" })).toBe("ITEM_详情_09_douyin_v1.jpg");
    });
});

describe("shot composition diagram", () => {
    test("reads the product position out of the composition text", () => {
        expect(ecommerceShotDiagram({ ...createEcommerceShot("x"), composition: "商品完整入画，居中构图" }).product).toBe("center");
        expect(ecommerceShotDiagram({ ...createEcommerceShot("x"), composition: "商品偏左放置" }).product).toBe("left");
        expect(ecommerceShotDiagram({ ...createEcommerceShot("x"), composition: "商品偏右，右侧留白" }).product).toBe("right");
    });

    test("reads the copy zone, including the no-copy case", () => {
        expect(ecommerceShotDiagram({ ...createEcommerceShot("x"), copyZone: "顶部留出标题位" }).copyZone).toBe("top");
        expect(ecommerceShotDiagram({ ...createEcommerceShot("x"), copyZone: "底部留出文案位" }).copyZone).toBe("bottom");
        expect(ecommerceShotDiagram({ ...createEcommerceShot("x"), copyZone: "四周预留标题与价格位置" }).copyZone).toBe("around");
        expect(ecommerceShotDiagram({ ...createEcommerceShot("x"), copyZone: "不预留文案位" }).copyZone).toBeNull();
    });

    test("reads the key light direction", () => {
        expect(ecommerceShotDiagram({ ...createEcommerceShot("x"), lighting: "主光位于右上方 45°" }).light).toBe("right");
        expect(ecommerceShotDiagram({ ...createEcommerceShot("x"), lighting: "侧逆光" }).light).toBe("back");
        expect(ecommerceShotDiagram({ ...createEcommerceShot("x"), lighting: "柔和均匀棚拍布光" }).light).toBe("front");
    });

    test("close-ups draw a bigger product frame", () => {
        const close = ecommerceShotDiagram({ ...createEcommerceShot("x"), lens: "100mm 微距" });
        const wide = ecommerceShotDiagram({ ...createEcommerceShot("x"), lens: "35mm" });
        expect(close.closeUp).toBe(true);
        expect(ecommerceDiagramBoxes(close).product.width).toBeGreaterThan(ecommerceDiagramBoxes(wide).product.width);
    });

    test("an empty recipe falls back to the neutral frame instead of guessing", () => {
        const diagram = ecommerceShotDiagram(createEcommerceShot("空"));
        expect(diagram).toEqual({ product: "center", copyZone: null, light: "front", closeUp: false });
        expect(ecommerceShotDiagram(undefined).product).toBe("center");
    });

    test("every box stays inside the frame", () => {
        for (const preset of ["center", "left", "right"] as const) {
            for (const copyZone of ["top", "bottom", "left", "right", "around", null] as const) {
                const { product, copy } = ecommerceDiagramBoxes({ product: preset, copyZone, light: "front", closeUp: false });
                expect(product.left).toBeGreaterThanOrEqual(0);
                expect(product.left + product.width).toBeLessThanOrEqual(100);
                if (copy) {
                    expect(copy.left).toBeGreaterThanOrEqual(0);
                    expect(copy.left + copy.width).toBeLessThanOrEqual(100);
                    expect(copy.top + copy.height).toBeLessThanOrEqual(100);
                }
            }
        }
    });
});
