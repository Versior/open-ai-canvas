import { describe, expect, test } from "bun:test";

import { ECOMMERCE_MATERIAL_PLANS, ecommerceCanvasPreset, ecommerceCanvasTitle, ecommerceMaterialNodes, ecommerceMaterialPlan, ecommerceShotSetOutputs } from "@/lib/ecommerce/ecommerce-canvas-preset";
import { ECOMMERCE_DELIVERABLE_SETS, ECOMMERCE_DETAIL_PAGE_SET, ECOMMERCE_MAIN_IMAGE_SET } from "@/lib/ecommerce/ecommerce-deliverables";
import { resolveEcommerceInputs, upstreamEcommerceNodes } from "@/lib/ecommerce/ecommerce-canvas";
import { CanvasNodeType } from "@/types/canvas";

function counter() {
    let n = 0;
    return () => `id-${++n}`;
}

describe("ecommerce canvas growth", () => {
    test("a new canvas seeds only the product node and nothing else", () => {
        const { nodes, connections } = ecommerceCanvasPreset();

        // 只要一张主图时铺七个节点是荒谬的——开局必须只有一个必需输入
        expect(nodes).toHaveLength(1);
        expect(nodes[0].type).toBe(CanvasNodeType.Product);
        expect(connections).toEqual([]);
    });

    test("the lightest plan grows exactly two nodes", () => {
        const product = ecommerceCanvasPreset().nodes[0];
        const plan = ecommerceMaterialPlan("single")!;
        const { nodes, connections } = ecommerceMaterialNodes(product, plan, counter());

        expect(nodes.map((node) => node.type).sort()).toEqual([CanvasNodeType.Image, CanvasNodeType.ShotRecipe].sort());
        // 商品→拍法、商品→图、拍法→图：三条边缺一条都会让某一头拿不到约束
        expect(connections).toHaveLength(3);
        const image = nodes.find((node) => node.type === CanvasNodeType.Image)!;
        const recipe = nodes.find((node) => node.type === CanvasNodeType.ShotRecipe)!;
        // 图拿到商品与拍法两条；拍法拿到商品一条（为了让约束链能穿过去）
        expect(connections.filter((connection) => connection.toNodeId === image.id)).toHaveLength(2);
        expect(connections.filter((connection) => connection.toNodeId === recipe.id)).toHaveLength(1);
        expect(image.title).toBe("主图");
        expect(image.metadata?.ecommerceShotId).toBe("single-1");
    });

    test("every plan grows exactly as many images as it promises, behind one shot list", () => {
        const product = ecommerceCanvasPreset().nodes[0];
        const create = counter();
        for (const plan of ECOMMERCE_MATERIAL_PLANS) {
            const { nodes, connections } = ecommerceMaterialNodes(product, plan, create);
            const images = nodes.filter((node) => node.type === CanvasNodeType.Image);
            expect(images).toHaveLength(plan.slots.length);
            expect(images.map((node) => node.title)).toEqual(plan.slots.map((slot) => slot.title));

            // 一套交付物只有一个拍法节点。五张主图的差异是清单上的五行，
            // 拆成五个节点意味着同一套布光基准要填五遍，还要在画布上四处找哪份对应哪张。
            const recipes = nodes.filter((node) => node.type === CanvasNodeType.ShotRecipe);
            expect(recipes).toHaveLength(1);
            expect(recipes[0].metadata?.shotSet?.shots).toHaveLength(plan.slots.length);
            expect(recipes[0].metadata?.shotSet?.shots.map((shot) => shot.id)).toEqual(plan.slots.map((slot) => slot.id));

            // 每张图都认领清单里的一行，靠 id 对齐而不是靠位置
            expect(images.map((node) => node.metadata?.ecommerceShotId)).toEqual(plan.slots.map((slot) => slot.id));
            // 认领的行必须在清单里真实存在，否则生成时会静默退化成只用整组统一
            const shotIds = new Set(recipes[0].metadata!.shotSet!.shots.map((shot) => shot.id));
            for (const image of images) expect(shotIds.has(image.metadata!.ecommerceShotId!)).toBe(true);
            // 每张图都要连着那唯一的拍法节点
            for (const image of images) {
                expect(connections.some((connection) => connection.fromNodeId === recipes[0].id && connection.toNodeId === image.id)).toBe(true);
            }

            const extras = plan.extras || [];
            expect(nodes.filter((node) => node.type === CanvasNodeType.Style)).toHaveLength(extras.includes("style") ? 1 : 0);
            expect(nodes.filter((node) => node.type === CanvasNodeType.SellingPoint)).toHaveLength(extras.includes("sellingPoints") ? 1 : 0);
            expect(nodes.filter((node) => node.type === CanvasNodeType.Copy)).toHaveLength(extras.includes("copy") ? 1 : 0);
            expect(nodes.filter((node) => node.type === CanvasNodeType.Layout)).toHaveLength(extras.includes("layout") ? 1 : 0);
        }
    });

    test("a grown plan compiles into a prompt the same way a hand-built graph does", () => {
        const base = ecommerceCanvasPreset().nodes[0];
        const product = { ...base, metadata: { ...base.metadata, productProfile: { name: "保温杯", category: "保温杯", appearance: "哑光黑", marks: "", forbidden: "", views: {} } } };
        const { nodes, connections } = ecommerceMaterialNodes(product, ecommerceMaterialPlan("main-five")!, counter());
        const all = [product, ...nodes];
        const image = nodes.find((node) => node.title === "主图1 · 核心展示")!;

        const inputs = resolveEcommerceInputs(image.id, all, connections);
        expect(inputs.prompt).toContain("【商品锁定】");
        expect(inputs.prompt).toContain("【拍摄方案】");
        expect(inputs.sources.shotSet?.name).toBe("主图 5 张");
        // 只展开这一张认领的那一行，不是整张清单
        expect(inputs.prompt).toContain("本张（主图1 · 核心展示）");
        expect(inputs.prompt).not.toContain("主图3 · 场景使用");

        // 另一张拿到的是另一行——同一张清单，各取所需
        const sceneImage = nodes.find((node) => node.title === "主图3 · 场景使用")!;
        const scenePrompt = resolveEcommerceInputs(sceneImage.id, all, connections).prompt;
        expect(scenePrompt).toContain("本张（主图3 · 场景使用）");
        expect(scenePrompt).not.toContain("主图1 · 核心展示");
    });

    test("the product node stays the shared upstream of every grown image", () => {
        const product = ecommerceCanvasPreset().nodes[0];
        const { nodes, connections } = ecommerceMaterialNodes(product, ecommerceMaterialPlan("full-listing")!, counter());
        const all = [product, ...nodes];
        const images = nodes.filter((node) => node.type === CanvasNodeType.Image);
        expect(images.length).toBeGreaterThanOrEqual(13);
        for (const image of images) {
            const found = upstreamEcommerceNodes(image.id, all, connections);
            expect(found.product?.id).toBe(product.id);
            expect(found.recipe).toBeDefined();
        }
    });

    test("a large set wraps into rows instead of one endless line", () => {
        const product = ecommerceCanvasPreset().nodes[0];
        const { nodes } = ecommerceMaterialNodes(product, ecommerceMaterialPlan("detail-nine")!, counter());
        const images = nodes.filter((node) => node.type === CanvasNodeType.Image);
        const rows = new Set(images.map((node) => node.position.y));
        // 九屏排成两行，而不是一条九张的长龙
        expect(rows.size).toBe(2);
        expect(images.filter((node) => node.position.y === Math.min(...rows)).length).toBe(5);
    });

    test("titles increment instead of colliding", () => {
        expect(ecommerceCanvasTitle([])).toBe("电商创作");
        expect(ecommerceCanvasTitle(["自由画布 1"])).toBe("电商创作");
        expect(ecommerceCanvasTitle(["电商创作"])).toBe("电商创作 2");
        expect(ecommerceCanvasTitle(["电商创作", "电商创作 2"])).toBe("电商创作 3");
    });

    test("every generated id is unique within a single growth pass", () => {
        const product = ecommerceCanvasPreset().nodes[0];
        const { nodes, connections } = ecommerceMaterialNodes(product, ecommerceMaterialPlan("full-listing")!, counter());
        const ids = [...nodes.map((node) => node.id), ...connections.map((connection) => connection.id)];
        expect(new Set(ids).size).toBe(ids.length);
    });

    test("layout and video nodes are wired from the product so the lock reaches them", () => {
        const product = ecommerceCanvasPreset().nodes[0];
        const { nodes, connections } = ecommerceMaterialNodes(product, ecommerceMaterialPlan("detail-nine")!, counter());
        // 这两个节点自己会出图出片，只连产物图是不够的——
        // 用户可能只点「生成成品图」而不重新生成底图，那时商品锁定必须还能走到它身上
        for (const type of [CanvasNodeType.Layout, CanvasNodeType.EcommerceVideo]) {
            const node = nodes.find((item) => item.type === type);
            if (!node) continue;
            expect(connections.some((connection) => connection.fromNodeId === product.id && connection.toNodeId === node.id)).toBe(true);
        }
    });
});

describe("growing a shot list into its outputs", () => {
    function recipeWithShots() {
        const product = ecommerceCanvasPreset().nodes[0];
        const grown = ecommerceMaterialNodes(product, ecommerceMaterialPlan("detail-nine")!, counter());
        // ecommerceMaterialNodes 只返回新长的节点，商品本身要自己带上——
        // 否则约束链走到商品那一跳就断了，测出来的会是假阴性
        const nodes = [product, ...grown.nodes];
        const recipe = nodes.find((node) => node.type === CanvasNodeType.ShotRecipe)!;
        return { product, recipe, nodes, connections: grown.connections, shots: recipe.metadata!.shotSet!.shots };
    }

    test("only the unclaimed rows grow an output", () => {
        const { recipe, shots } = recipeWithShots();
        // 认领除最后一行以外的全部，只留一行没认领
        const claimed = new Set(shots.slice(0, -1).map((shot) => shot.id));
        const { nodes: spawned, connections } = ecommerceShotSetOutputs(recipe, claimed, counter());

        expect(spawned).toHaveLength(1);
        expect(spawned[0].metadata!.ecommerceShotId).toBe(shots[shots.length - 1].id);
        expect(connections).toHaveLength(1);
        expect(connections[0].fromNodeId).toBe(recipe.id);
        expect(connections[0].toNodeId).toBe(spawned[0].id);
    });

    test("a shotIds filter only grows those rows", () => {
        const { recipe, shots } = recipeWithShots();
        const { nodes: spawned } = ecommerceShotSetOutputs(recipe, new Set(), counter(), [shots[1].id]);
        expect(spawned).toHaveLength(1);
        expect(spawned[0].metadata!.ecommerceShotId).toBe(shots[1].id);
    });

    test("a fully claimed list grows nothing", () => {
        const { recipe, shots } = recipeWithShots();
        const all = new Set(shots.map((shot) => shot.id));
        expect(ecommerceShotSetOutputs(recipe, all, counter()).nodes).toEqual([]);
    });

    test("a grown output resolves its own row plus the product lock", () => {
        const { product, recipe, nodes, connections } = recipeWithShots();
        // 拍法的上游电商节点要一起连到新图上，否则新图沿约束链只能走到拍法，
        // 商品锁定块静默丢失——生成结果看起来正常，商品却不是同一件
        const { nodes: spawned, connections: spawnedConnections } = ecommerceShotSetOutputs(recipe, new Set(), counter());
        const sources = connections.filter((connection) => connection.toNodeId === recipe.id).map((connection) => nodes.find((node) => node.id === connection.fromNodeId)).filter((node): node is NonNullable<typeof node> => Boolean(node));
        expect(sources.length).toBeGreaterThan(0);
        const carried = spawned.flatMap((image) => sources.map((source) => ({ id: `carry-${source.id}-${image.id}`, fromNodeId: source.id, toNodeId: image.id })));
        const allConnections = [...connections, ...spawnedConnections, ...carried];

        const target = spawned[0];
        const inputs = resolveEcommerceInputs(target.id, [...nodes, ...spawned], allConnections);
        expect(inputs.sources.profile?.name).toBe(product.metadata!.productProfile!.name);
        expect(inputs.sources.shotId).toBe(target.metadata!.ecommerceShotId);
        expect(inputs.prompt).toContain("【拍摄方案】");
        // 只展开认领的那一行，不是整张清单
        expect(inputs.prompt).not.toContain(recipe.metadata!.shotSet!.shots[1].title);
    });
});

describe("industry deliverable structure", () => {
    test("the five main images follow the trade-standard breakdown", () => {
        const slots = ECOMMERCE_MAIN_IMAGE_SET.slots;
        expect(slots).toHaveLength(5);
        // 顺序是行业共识：核心展示 → 卖点 → 场景 → 细节 → 规格
        expect(slots[0].title).toContain("核心展示");
        expect(slots[1].title).toContain("卖点");
        expect(slots[2].title).toContain("场景");
        expect(slots[3].title).toContain("细节");
        expect(slots[4].title).toContain("规格");
        // 第一张决定点击率，职责里必须写清楚
        expect(slots[0].duty).toContain("点击率");
    });

    test("the detail page follows the nine-screen pyramid order", () => {
        const slots = ECOMMERCE_DETAIL_PAGE_SET.slots;
        expect(slots).toHaveLength(9);
        // 先共情痛点，再给量化利益，然后才是背书、卖点、场景、参数、售后——顺序不能乱
        expect(slots[0].title).toContain("痛点");
        expect(slots[0].duty).toContain("问题");
        expect(slots[1].duty).toContain("量化");
        expect(slots[2].title).toContain("信任");
        // 这一屏的职责要给出替代写法，而不是「没有依据就不要写」——
        // 后者会把模型推回「暂未提供」那种废话
        expect(slots[2].duty).toContain("改写工艺与用料的可见之处");
        expect(slots[2].duty).toContain("不要写「暂无」");
        expect(slots[3].title).toContain("核心卖点");
        expect(slots[5].title).toContain("场景");
        expect(slots[7].title).toContain("参数");
        expect(slots[8].title).toContain("售后");
    });

    test("every slot names a duty and a real shot preset", () => {
        for (const set of ECOMMERCE_DELIVERABLE_SETS) {
            expect(set.slots.length).toBeGreaterThan(0);
            for (const slot of set.slots) {
                expect(slot.title.trim()).not.toBe("");
                expect(slot.duty.trim()).not.toBe("");
                expect(slot.presetId.trim()).not.toBe("");
            }
            const ids = set.slots.map((slot) => slot.id);
            expect(new Set(ids).size).toBe(ids.length);
        }
    });

    test("the full listing set is the main images plus the detail page plus extras", () => {
        const full = ECOMMERCE_DELIVERABLE_SETS.find((set) => set.id === "full-listing")!;
        expect(full.slots.length).toBe(ECOMMERCE_MAIN_IMAGE_SET.slots.length + ECOMMERCE_DETAIL_PAGE_SET.slots.length + 2);
        expect(full.slots.filter((slot) => slot.id.startsWith("detail-"))).toHaveLength(9);
    });
});
