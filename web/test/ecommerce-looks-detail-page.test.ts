import { describe, expect, test } from "bun:test";

import { ECOMMERCE_BUILTIN_PRESETS, CANVAS_BUILTIN_PRESETS } from "@/lib/prompts";
import { ECOMMERCE_LOOKS, ECOMMERCE_LOOK_GROUPS, ECOMMERCE_STYLE_LOOKS, ecommerceLooksByGroup } from "@/lib/ecommerce/ecommerce-looks";
import { ecommerceSlicePlan } from "@/lib/ecommerce/ecommerce-slice";
import { ECOMMERCE_REPLICA_PURPOSES, createEcommerceReplica, ecommerceReplicaBlock, ecommerceReplicaReady } from "@/lib/ecommerce/ecommerce-replica";

describe("出图风格：电商画布那颗按钮给的是拍法", () => {
    test("每条风格都编译出了非空提示词", () => {
        expect(ECOMMERCE_LOOKS.length).toBeGreaterThanOrEqual(12);
        for (const look of ECOMMERCE_LOOKS) {
            expect(look.prompt.trim().length).toBeGreaterThan(0);
            expect(look.name.trim().length).toBeGreaterThan(0);
        }
    });

    test("分组按「这张图拿去干什么」排，不按摄影术语", () => {
        const groups = ecommerceLooksByGroup().map((entry) => entry.group);
        expect(groups).toContain("主图");
        expect(groups).toContain("场景");
        expect(groups).toContain("人物");
        expect(groups).toContain("种草");
        expect(groups).toContain("品牌调性");
        // 每个分组都要有内容——空分组会在弹层里留一个孤零零的标题
        for (const entry of ecommerceLooksByGroup()) expect(entry.looks.length).toBeGreaterThan(0);
        expect([...groups].sort()).toEqual([...ECOMMERCE_LOOK_GROUPS].filter((group) => groups.includes(group)).sort());
    });

    test("模特上身与白底主图必须在——服装类目最关键的两张", () => {
        const names = ECOMMERCE_LOOKS.map((look) => look.name);
        expect(names).toContain("模特上身");
        expect(names).toContain("白底棚拍");
        expect(names).toContain("买家秀");
    });

    test("品牌调性来自六套风格预设，色板进了提示词", () => {
        expect(ECOMMERCE_STYLE_LOOKS).toHaveLength(6);
        const minimal = ECOMMERCE_STYLE_LOOKS.find((look) => look.name === "极简白");
        expect(minimal).toBeDefined();
        expect(minimal!.prompt).toContain("#FFFFFF");
    });
});

describe("预设按画布种类分流", () => {
    test("影视侧那批都标了 scope，不会漏进电商画布", () => {
        expect(CANVAS_BUILTIN_PRESETS.length).toBeGreaterThan(0);
        for (const preset of CANVAS_BUILTIN_PRESETS) {
            expect(preset.scope).toBe("film");
        }
    });

    test("电商侧那批都是 image 模式可用，且带电商硬约束", () => {
        expect(ECOMMERCE_BUILTIN_PRESETS.length).toBeGreaterThanOrEqual(6);
        for (const preset of ECOMMERCE_BUILTIN_PRESETS) {
            expect(preset.scope).toBe("ecommerce");
            expect(preset.modes).toContain("image");
            expect(preset.prompt.trim().length).toBeGreaterThan(20);
        }
        const ids = ECOMMERCE_BUILTIN_PRESETS.map((preset) => preset.id);
        // 这几件是电商创作里最常重复的事，缺一件都会让人回去手写
        for (const id of ["ecom-product-lock", "ecom-main-white", "ecom-detail-screen", "ecom-long-detail", "ecom-model-wear", "ecom-seed-photo"]) {
            expect(ids).toContain(id);
        }
    });

    test("两批不重名，也不共用 id", () => {
        const film = new Set(CANVAS_BUILTIN_PRESETS.map((preset) => preset.id));
        for (const preset of ECOMMERCE_BUILTIN_PRESETS) expect(film.has(preset.id)).toBe(false);
    });

    test("长图预设明确要求留出切点，不跨越接缝放主体", () => {
        const long = ECOMMERCE_BUILTIN_PRESETS.find((preset) => preset.id === "ecom-long-detail")!;
        // 切穿商品是详情页上架后最常见的废图原因
        expect(long.prompt).toContain("切点");
        expect(long.prompt).toContain("不要跨越接缝放置商品主体");
    });
});

describe("一键详情页：切点优先落在屏边界", () => {
    // 九屏，每屏 800px，中间不留缝——总高 7200，淘宝上限之内先切一次
    const screens = Array.from({ length: 9 }, (_, index) => ({ id: `screen-${index + 1}`, top: index * 800, height: 800, label: `第 ${index + 1} 屏` }));

    test("切点被挪到屏边界，而不是等分位置", () => {
        // 总高 7200；如果平台上限是 3000，等分切点在 2400 / 4800——都落在屏中间
        const plan = ecommerceSlicePlan({ totalHeight: 7200, platform: "taobao", protected: screens });
        const cuts = plan.pieces.slice(0, -1).map((piece) => piece.top + piece.height);
        for (const cut of cuts) {
            // 每一个切点都必须落在某两屏的交界上
            expect(cut % 800).toBe(0);
        }
    });

    test("挪得动的切点不记 conflict", () => {
        const plan = ecommerceSlicePlan({ totalHeight: 7200, platform: "taobao", protected: screens });
        expect(plan.conflicts).toEqual([]);
    });

    test("屏太大、挪不动时记 conflict 而不是静默接受", () => {
        // 一屏 4000px 高，超过平台单片上限——怎么挪都会切穿它
        const huge = [{ id: "screen-1", top: 0, height: 4000, label: "超长屏" }];
        const plan = ecommerceSlicePlan({ totalHeight: 9000, platform: "taobao", protected: huge });
        expect(plan.conflicts.length).toBeGreaterThan(0);
        expect(plan.conflicts[0].label).toBe("超长屏");
    });

    test("长图不超过平台单片上限时只出一片", () => {
        // 淘宝单片上限 1100
        const plan = ecommerceSlicePlan({ totalHeight: 1000, platform: "taobao" });
        expect(plan.pieces).toHaveLength(1);
        expect(plan.pieces[0]).toMatchObject({ index: 1, top: 0, height: 1000 });
    });

    test("nine full screens retain contiguous boundaries and respect the platform ceiling", () => {
        const ranges = Array.from({ length: 9 }, (_, index) => ({ id: String(index), top: index * 1008, height: 1000, label: "screen" }));
        const plan = ecommerceSlicePlan({ totalHeight: 9064, platform: "taobao", protected: ranges });
        expect(plan.conflicts).toEqual([]);
        expect(plan.pieces).toHaveLength(9);
        for (const [index, piece] of plan.pieces.entries()) {
            expect(piece.height).toBeLessThanOrEqual(1100);
            expect(piece.height).toBeGreaterThanOrEqual(200);
            expect(piece.top).toBe(index ? plan.pieces[index - 1].top + plan.pieces[index - 1].height : 0);
        }
        expect(plan.pieces.at(-1)!.top + plan.pieces.at(-1)!.height).toBe(9064);
    });
});

describe("溶图合成：与爆款复刻的约束正好相反", () => {
    test("两种用途都在，且各有一句话说明", () => {
        expect(ECOMMERCE_REPLICA_PURPOSES.map((item) => item.id)).toEqual(["replicate", "compose"]);
        for (const purpose of ECOMMERCE_REPLICA_PURPOSES) expect(purpose.hint.trim().length).toBeGreaterThan(10);
    });

    test("溶图块要求贴合场景，不复刻块要求不照搬", () => {
        const compose = ecommerceReplicaBlock({ ...createEcommerceReplica("客厅实景"), purpose: "compose" });
        expect(compose).toContain("【溶图合成】");
        expect(compose).toContain("场景底图");
        // 这几项少一项，商品就会「浮」在场景里
        expect(compose).toContain("接触阴影");
        expect(compose).toContain("倒影");
        expect(compose).toContain("色温");
        expect(compose).toContain("视平线");
        // 溶图不该出现复刻那套边界——场景本来就是要保留的
        expect(compose).not.toContain("绝对不复刻");
        expect(compose).not.toContain("爆款公式");
    });

    test("复刻块仍然保留不可复刻清单，且边界排在强度前面", () => {
        const replicate = ecommerceReplicaBlock(createEcommerceReplica("对标爆款"));
        expect(replicate).toContain("【复刻参考】");
        expect(replicate).toContain("绝对不复刻");
        expect(replicate).toContain("爆款公式");
        expect(replicate).not.toContain("溶图");
        expect(replicate.indexOf("绝对不复刻")).toBeLessThan(replicate.indexOf("方向："));
    });

    test("溶图不需要勾复刻维度就算就绪", () => {
        const compose = { ...createEcommerceReplica("溶图"), purpose: "compose" as const, aspects: [] };
        expect(ecommerceReplicaReady(compose)).toBe(true);
        // 复刻反过来：一条维度都没勾时不该放行
        expect(ecommerceReplicaReady({ ...createEcommerceReplica("复刻"), aspects: [] })).toBe(false);
    });

    test("场景笔记与不要出现的项分别进溶图块", () => {
        const compose = ecommerceReplicaBlock({ ...createEcommerceReplica("溶图"), purpose: "compose", notes: "木质桌面，左上自然光", extraExclude: "改变场景里的其他物品" });
        expect(compose).toContain("场景笔记：木质桌面，左上自然光");
        expect(compose).toContain("不要出现：改变场景里的其他物品");
    });
});
