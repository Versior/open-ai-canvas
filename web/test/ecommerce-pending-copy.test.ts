import { describe, expect, test } from "bun:test";

import { createEcommerceProductProfile } from "@/lib/ecommerce/ecommerce-contract";
import { resolveEcommerceInputs } from "@/lib/ecommerce/ecommerce-canvas";
import { ecommerceOneClickFlow } from "@/lib/ecommerce/ecommerce-oneclick";
import { ecommerceSuiteDirectorPrompt, ecommerceSuiteDraftPrompt, ecommerceSuiteFromPresets, ecommerceSuiteSkeleton } from "@/lib/ecommerce/ecommerce-suite";
import { createCanvasNode } from "@/lib/canvas/canvas-project-domain";
import { CanvasNodeType, type CanvasConnection } from "@/types/canvas";

describe("详情页缺失事实不进入成品可见文案", () => {
    const flow = ecommerceOneClickFlow("detail")!;

    test("预设成品提示词不把待补充交给图片模型", () => {
        for (const row of ecommerceSuiteFromPresets(flow)) {
            expect(row.prompt).not.toContain("待补充");
            // 无依据的宣称整类不进提示词：铺底只写画面，事实约束交给负面提示词。
            expect(row.prompt).toContain("虚构参数认证功效");
            expect(row.prompt).toContain("无依据文案");
            expect(row.prompt).not.toContain("事实缺失");
        }
    });

    test("规划允许事实状态保留待补充，但可见文案缺依据时留空", () => {
        const profile = { ...createEcommerceProductProfile("保温杯"), facts: "认证待补充" };
        const director = ecommerceSuiteDirectorPrompt(undefined, flow);
        const prompt = ecommerceSuiteDraftPrompt(flow, profile, ecommerceSuiteSkeleton(flow));
        const outputContract = prompt.slice(prompt.indexOf("【详情页完整生图合同】"));

        expect(prompt).toContain("卖点与依据：\n认证待补充");
        expect(director).not.toContain("没有明确依据就写“待补充”");
        expect(director).toContain("事实缺失");
        expect(director).toContain("禁止展示相关宣称或数值");
        expect(outputContract).toContain("主标题、副标题、价格和行动引导等独立可见文案字段");
        expect(outputContract).toContain("缺少事实依据时留空");
        expect(outputContract).toContain("完整生图提示词不得包含“待补充”");
        expect(outputContract).toContain("事实缺失，禁止展示相关宣称或数值");
        expect(outputContract).not.toContain("没有明确依据就写“待补充”");
    });

    test("规划只把营销文案写进文案列，最后一段只写画面", () => {
        const prompt = ecommerceSuiteDraftPrompt(flow, undefined, ecommerceSuiteSkeleton(flow));
        const outputContract = prompt.slice(prompt.indexOf("【详情页完整生图合同】"), prompt.indexOf("版式 preset 只能从以下现有值选择"));
        const director = ecommerceSuiteDirectorPrompt(undefined, flow);

        for (const text of [outputContract, director]) {
            expect(text).toContain("最后一段只写画面");
            expect(text).toContain("不得在最后一段重复");
        }
        expect(outputContract).toContain("标题、副标题、价格和行动引导只写进独立文案列");
        // 七项顺序还在，只是文案三项改由文案列供给
        for (const field of ["画面构成", "产品摆放", "主标题", "副标题", "卖点模块", "视觉风格", "负面提示词"]) expect(outputContract).toContain(field);
    });

    test("铺底提示词只写画面四类，营销三项的指令不再混在里面", () => {
        // 提示词里一旦留着「主标题：…」这种指令，模型就会自己从资料里造字——
        // 文案该不该出现由 copy 决定，不该由提示词里的一句话决定。
        for (const row of ecommerceSuiteFromPresets(flow)) {
            for (const field of ["画面构成：", "产品摆放：", "视觉风格：", "负面提示词："]) expect(row.prompt).toContain(field);
            for (const field of ["主标题：", "副标题：", "卖点模块："]) expect(row.prompt).not.toContain(field);
        }
    });

    test("七项由共享编译器按 copy 补齐，copy 空就不生成营销文字", () => {
        const product = { ...createCanvasNode(CanvasNodeType.Product, { x: 0, y: 0 }, { productProfile: createEcommerceProductProfile("保温杯") }), id: "product-1" };
        const target = {
            ...createCanvasNode(CanvasNodeType.Image, { x: 0, y: 0 }, {}),
            id: "detail-1-result",
            metadata: { ecommerceProductId: "product-1", ecommerceFlowId: "detail", ecommerceShotId: "detail-1" },
        };
        const graph = [product, target];
        const edges: CanvasConnection[] = [{ id: "e", fromNodeId: "product-1", toNodeId: "detail-1-result" }];
        const preset = ecommerceSuiteFromPresets(flow)[0];

        // copy 空：编译器只出画面与版式约束，一个字都不给模型。
        const bare = resolveEcommerceInputs(target.id, graph, edges, [], [preset]);
        expect(bare.prompt).not.toContain("【文案】");
        // 七项格式下空文案写成显式「不生成」，而不是留一行可被模型自己填字的位置。
        expect(bare.prompt).toContain("主标题：不生成主标题文字");
        expect(bare.prompt).not.toContain("标题：通勤");
        expect(bare.prompt).not.toContain("价格：");

        // 有确认文案：编译器把它作为唯一文字来源补进去。
        const withCopy = resolveEcommerceInputs(target.id, graph, edges, [], [{ ...preset, copy: { headline: "通勤一路温热", subhead: "", price: "", cta: "" } }]);
        expect(withCopy.prompt).toContain("主标题：通勤一路温热");
        // 七项里文案就是图上文字的唯一来源，不再另起【文案】段重复一遍。
        expect(withCopy.prompt).not.toContain("【文案】");
        // 空字段依然不出现——不留空位，不去猜。
        expect(withCopy.prompt).not.toContain("价格：");
    });
});
