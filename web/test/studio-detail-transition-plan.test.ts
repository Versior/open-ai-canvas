import { expect, test } from "bun:test";
import { studioDetailPlanRoles } from "@/lib/ecommerce-studio/detail-plan";
import { buildDetailPlanPrompt, parseDetailPlan, type StudioPlanRequest } from "@/lib/ecommerce-studio/detail-plan-tasks";
import { createStudioProduct } from "@/lib/ecommerce-studio/product";

function cup() {
    const product = createStudioProduct("cup");
    product.name = "水杯";
    product.brief.outputType = "detail-set";
    product.brief.detailScreens = 2;
    product.photos = [{ id: "front", resourceId: "cup-front", view: "front", truth: true, url: "", addedAt: "" }];
    return product;
}

test("普通详情的策划把承接写成两屏都画得出来的关系，不是预览用的下一问", () => {
    const product = cup();
    const prompt = buildDetailPlanPrompt(product, studioDetailPlanRoles(product));
    const direction = prompt.split("\n").find((line) => line.includes("transitionOut") && !line.startsWith("{"))!;
    const example = JSON.parse(prompt.split("\n").at(-1)!);
    expect(direction).not.toContain("只用于策划预览");
    expect(direction).toMatch(/两屏都能画出[^。]*环境、物体或光影/);
    expect(direction).toMatch(/本屏[^。；]*下一屏/);
    expect(direction).toMatch(/没有[^。]*省略/);
    expect(example.screens[0].transitionOut).toMatch(/两屏[^。]*可见/);
    expect(example.alternatives[0].transitionOut).toBeUndefined();
});

test("实物承接可选且只属于相邻两屏；末屏没有下一屏，省略线索也不丢屏", () => {
    const product = cup();
    const bridge = "杯旁的晨光落在餐桌上，下一屏同一束光照着倒水的手。";
    for (const transitionOut of [bridge, undefined]) {
        const { plan } = parseDetailPlan(
            JSON.stringify({
                screens: [
                    { role: "detail-hero", displayContent: "餐桌上的杯身与杯柄。", transitionOut },
                    { role: "detail-scene", displayContent: "提起水壶，把水倒进杯口。", transitionOut: "继续回到餐桌" },
                ],
                alternatives: [],
            }),
            product,
            studioDetailPlanRoles(product),
            { id: "plan", model: "planner", createdAt: "" },
        );
        expect(plan.screens.map((screen) => screen.transitionOut)).toEqual([transitionOut, undefined]);
    }
});

test("同款维持阅读线索，主图、单张和模板不索要跨屏线索", () => {
    const product = cup();
    const roles = studioDetailPlanRoles(product);
    product.brief.sameLayout = true;
    const same = buildDetailPlanPrompt(product, roles);
    expect(same).toContain("只用于策划预览");
    expect(same).not.toContain("两屏都能画出");
    product.brief.sameLayout = false;
    product.brief.suite = {
        id: "cup-suite",
        name: "水杯",
        source: "library",
        kind: "detail",
        style: "",
        category: "水杯",
        shots: [
            { title: "外形", duty: "展示杯身" },
            { title: "使用", duty: "倾倒出水" },
        ],
    };
    const requests: StudioPlanRequest[] = [{ scope: "main" }, { scope: "single", targets: [{ type: "poster", count: 2 }] }, { scope: "template" }];
    for (const request of requests) {
        const prompt = buildDetailPlanPrompt(product, roles, request);
        expect(prompt).not.toContain("transitionOut");
    }
});
