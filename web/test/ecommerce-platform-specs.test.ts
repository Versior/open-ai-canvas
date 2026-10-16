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
} from "@/lib/ecommerce/ecommerce-platform-specs";
import { ecommerceDiagramBoxes, ecommerceShotDiagram } from "@/lib/ecommerce/ecommerce-shot-diagram";

describe("platform specs", () => {
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
        expect(ecommerceSpecBlocked(generated)).toBe(true);
        expect(generated[0].message).toContain("AI-generated");
    });

    test("a video slot accepts either of its allowed ratios and rejects the rest", () => {
        const ok = checkImageAgainstSpec({ platformId: "amazon", role: "video", facts: { width: 1920, height: 1080 } });
        expect(ok).toEqual([]);
        const portrait = checkImageAgainstSpec({ platformId: "amazon", role: "video", facts: { width: 1080, height: 1920 } });
        expect(portrait).toEqual([]);
        const square = checkImageAgainstSpec({ platformId: "amazon", role: "video", facts: { width: 1080, height: 1080 } });
        expect(ecommerceSpecBlocked(square)).toBe(true);
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

    test("undersized images are blocked, not warned", () => {
        const issues = checkImageAgainstSpec({ platformId: "taobao", role: "main", facts: { width: 600, height: 600 } });
        expect(ecommerceSpecBlocked(issues)).toBe(true);
        expect(issues[0].message).toContain("800");
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
        expect(ecommerceSpecBlocked(dirty)).toBe(true);
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
        expect(ecommerceSpecBlocked(issues)).toBe(true);
        expect(issues[0].message).toContain("不允许出现文字");
    });

    test("taobao allows a little text but blocks past double the limit", () => {
        const warned = checkImageAgainstSpec({ platformId: "taobao", role: "main", facts: { width: 800, height: 800, audit: { textRatio: 0.15 } } });
        expect(warned[0].level).toBe("warn");
        const blocked = checkImageAgainstSpec({ platformId: "taobao", role: "main", facts: { width: 800, height: 800, audit: { textRatio: 0.25 } } });
        expect(blocked[0].level).toBe("block");
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
