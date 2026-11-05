import { describe, expect, test } from "bun:test";
import { ECOMMERCE_SLICE_SPECS, createEcommerceSliceProtectedRange, ecommerceSliceBlocked, ecommerceSliceFileName, ecommerceSliceIssues, ecommerceSlicePlan, ecommerceSliceSpec } from "@/lib/ecommerce/ecommerce-slice";
import { ECOMMERCE_REPLICA_PURPOSES, createEcommerceReplica, ecommerceReplicaBlock, ecommerceReplicaReady } from "@/lib/ecommerce/ecommerce-replica";
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
describe("detail page slicing", () => {
    test("each platform carries its own width and slice ceiling", () => {
        expect(ECOMMERCE_SLICE_SPECS.map((spec) => spec.id)).toEqual(["generic", "taobao", "jd", "pdd", "douyin"]);
        expect(ecommerceSliceSpec("generic")!.note).toContain("不是任何平台审核硬规则");
        expect(ecommerceSliceSpec("taobao")!.maxSliceHeight).toBe(1100);
        expect(ecommerceSliceSpec("douyin")!.maxTotalHeight).toBe(16000);
    });

    test("a short image is one piece", () => {
        const plan = ecommerceSlicePlan({ totalHeight: 900, platform: "taobao" });
        expect(plan.pieces).toEqual([{ index: 1, top: 0, height: 900 }]);
        expect(plan.conflicts).toEqual([]);
    });

    test("a long image splits into even pieces under the ceiling", () => {
        const plan = ecommerceSlicePlan({ totalHeight: 4000, platform: "taobao" });
        expect(plan.pieces).toHaveLength(4);
        for (const piece of plan.pieces) expect(piece.height).toBeLessThanOrEqual(1100);
        // 首尾必须严丝合缝，不能漏掉或重叠
        expect(plan.pieces[0].top).toBe(0);
        const last = plan.pieces[plan.pieces.length - 1];
        expect(last.top + last.height).toBe(4000);
    });

    test("cuts move out of a protected block so nothing gets sliced through", () => {
        // 切点会落在 1000 附近，而 940–1180 是产品主体
        const plan = ecommerceSlicePlan({
            totalHeight: 4000,
            platform: "taobao",
            protected: [createEcommerceSliceProtectedRange(940, 240, "杯身主体")],
        });
        const firstCut = plan.pieces[0].top + plan.pieces[0].height;
        expect(firstCut).toBe(940);
        expect(plan.pieces[0].adjustedFrom).toBe(1000);
        expect(plan.conflicts).toEqual([]);
    });

    test("a cut that cannot move is reported instead of silently accepted", () => {
        // 保护块几乎占满整张图：往上挪会让首片过矮，往下推会让末片过矮
        const plan = ecommerceSlicePlan({
            totalHeight: 2200,
            platform: "taobao",
            protected: [createEcommerceSliceProtectedRange(50, 2100, "整屏产品图")],
        });
        expect(plan.conflicts).toHaveLength(1);
        expect(plan.conflicts[0].label).toBe("整屏产品图");
        const issues = ecommerceSliceIssues(plan, "taobao");
        expect(ecommerceSliceBlocked(issues)).toBe(true);
        expect(issues[0].message).toContain("切穿了上架后每张图都缺一块");
    });

    test("over the platform's total ceiling is blocked", () => {
        const plan = ecommerceSlicePlan({ totalHeight: 18000, platform: "douyin" });
        expect(plan.overTotalHeight).toBe(true);
        expect(ecommerceSliceBlocked(ecommerceSliceIssues(plan, "douyin"))).toBe(true);
    });

    test("slice filenames say which piece of how many", () => {
        expect(ecommerceSliceFileName({ code: "A001", index: 2, total: 9 })).toBe("A001_详情_02of09_v1.jpg");
        expect(ecommerceSliceFileName({ code: "", index: 1, total: 3, version: 2 })).toBe("ITEM_详情_01of03_v2.jpg");
    });
});
