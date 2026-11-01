import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
    ECOMMERCE_MODEL_PRESETS,
    createEcommerceModel,
    ecommerceModelById,
    ecommerceModelCoverRef,
    ecommerceModelLockBlock,
    ecommerceModelPresetPrompt,
    ecommerceModelRefCount,
    ecommerceModelReady,
    ecommerceModelRefs,
} from "@/lib/ecommerce/ecommerce-models";
import { ecommerceModelReferenceImages, resolveEcommerceModel } from "@/lib/ecommerce/ecommerce-canvas";
import { compileEcommercePrompt, createEcommerceProductProfile } from "@/lib/ecommerce/ecommerce-contract";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

function node(type: CanvasNodeType, metadata: CanvasNodeData["metadata"] = {}, id = "n1"): CanvasNodeData {
    return { id, type, title: "节点", position: { x: 0, y: 0 }, width: 400, height: 400, metadata };
}

describe("模特就是图，不是一段文字", () => {
    test("判据只有一条：有没有参考图", () => {
        expect(ecommerceModelReady(createEcommerceModel("空模特"))).toBe(false);
        expect(ecommerceModelReady(createEcommerceModel("有图", ["image:u:a"]))).toBe(true);
        expect(ecommerceModelReady(undefined)).toBe(false);
    });

    test("名字再具体也不算数——旧版本把外观描述当判据，那是错的", () => {
        const named = { ...createEcommerceModel("亚洲女性 168cm 纤细"), refs: [] };
        expect(ecommerceModelReady(named)).toBe(false);
        expect(ecommerceModelLockBlock(named)).toBe("");
    });

    test("没有参考图时锁定块为空——只有名字等于没锁", () => {
        expect(ecommerceModelLockBlock(createEcommerceModel("空模特"))).toBe("");
        expect(ecommerceModelLockBlock(undefined)).toBe("");
    });

    test("参考图计数跳过空串", () => {
        expect(ecommerceModelRefCount(createEcommerceModel("测试", ["a", "", "b"]))).toBe(2);
        expect(ecommerceModelRefCount(undefined)).toBe(0);
    });

    test("封面就是第一张参考图", () => {
        expect(ecommerceModelCoverRef(createEcommerceModel("测试", ["a", "b"]))).toBe("a");
        expect(ecommerceModelCoverRef(createEcommerceModel("空"))).toBeUndefined();
    });
});

describe("移除内置模特预设", () => {
    test("不再提供默认模特记录，自建模特仍可使用", () => {
        expect(ECOMMERCE_MODEL_PRESETS).toEqual([]);
        const own = createEcommerceModel("我的模特", ["resource:my-model"]);
        expect(ecommerceModelById(own.id, [own])).toEqual(own);
    });
    test("出图提示词要求全身正面、白底、不要文字——参考图定的是身高与比例", () => {
        const prompt = ecommerceModelPresetPrompt({ id: "explicit", name: "用户模板", brief: "用户的拍摄要求", hint: "", tags: [] });
        expect(prompt).toContain("用户的拍摄要求");
        expect(prompt).toContain("全身");
        expect(prompt).toContain("不要任何文字");
    });

    test("旧内置预设 ID 不能作为已选模特", () => {
        expect(ecommerceModelById("preset-female-young-slim", [])).toBeUndefined();
    });
});

describe("模特锁定块", () => {
    test("以参考图为准，并压住模型的美化倾向", () => {
        const model = createEcommerceModel("小美", ["image:u:a", "image:u:b"]);
        const block = ecommerceModelLockBlock(model);
        expect(block).toContain("【模特锁定】");
        expect(block).toContain("小美");
        expect(block).toContain("参考图");
        expect(block).toContain("同一个人");
        // 三次生成之后人变了，是模型默认会做的事——不写这句锁不住
        expect(block).toContain("不要美化轮廓");
        expect(block).toContain("不要换发型发色");
    });

    test("显式传姿势时写进提示词", () => {
        const block = ecommerceModelLockBlock(createEcommerceModel("小美", ["a"]), "转身回眸，定格在肩线转向镜头那一帧");
        expect(block).toContain("姿势：转身回眸");
    });

    test("不传姿势时不编姿势——人设已经由参考图定了", () => {
        const block = ecommerceModelLockBlock(createEcommerceModel("小美", ["a"]));
        expect(block).not.toContain("姿势：");
        expect(block).not.toContain("姿势方向：");
    });

    test("编译器把模特锁定排在商品锁定之后", () => {
        const prompt = compileEcommercePrompt({
            profile: { ...createEcommerceProductProfile("保温杯"), category: "保温杯" },
            model: createEcommerceModel("小美", ["image:u:a"]),
        });
        const productAt = prompt.indexOf("【商品锁定】");
        const modelAt = prompt.indexOf("【模特锁定】");
        expect(productAt).toBeGreaterThanOrEqual(0);
        expect(modelAt).toBeGreaterThan(productAt);
    });
});

describe("参考图直接送进生成，不反查画布", () => {
    test("按 storageKey 造 ReferenceImage——模特库是用户级的，那些图多半不在当前画布上", () => {
        const model = createEcommerceModel("小美", ["image:u:aaa", "image:u:bbb"]);
        const refs = ecommerceModelReferenceImages(model);
        expect(refs.map((item) => item.storageKey)).toEqual(["image:u:aaa", "image:u:bbb"]);
        expect(refs[0].id).not.toBe(refs[1].id);
        for (const ref of refs) expect(ref.dataUrl).toBe("");
    });

    test("没有参考图时返回空，不炸", () => {
        expect(ecommerceModelReferenceImages(undefined)).toEqual([]);
        expect(ecommerceModelReferenceImages(createEcommerceModel("空"))).toEqual([]);
    });

    test("参考图列表跳过空串", () => {
        expect(ecommerceModelRefs(createEcommerceModel("测试", ["a", "", "b"]))).toEqual(["a", "b"]);
    });
});

describe("模特挂在节点上，不沿连线继承", () => {
    test("按节点自己的 ecommerceModelId 解析", () => {
        const custom = [createEcommerceModel("我的模特", ["image:u:a"])];
        expect(resolveEcommerceModel(node(CanvasNodeType.Image, { ecommerceModelId: custom[0].id }), custom)?.name).toBe("我的模特");
        expect(resolveEcommerceModel(node(CanvasNodeType.Image, {}), custom)).toBeUndefined();
        expect(resolveEcommerceModel(undefined, custom)).toBeUndefined();
    });

    test("公共起手式不能当模特选中——它没有图", () => {
        expect(resolveEcommerceModel(node(CanvasNodeType.Image, { ecommerceModelId: "preset-female-young-slim" }), [])).toBeUndefined();
    });
});

describe("模特库的存储与界面", () => {
    const store = readFileSync(new URL("../src/stores/use-ecommerce-model-library.ts", import.meta.url), "utf8");
    const modal = readFileSync(new URL("../src/components/canvas/canvas-ecommerce-model-library.tsx", import.meta.url), "utf8");
    const panel = readFileSync(new URL("../src/components/canvas/canvas-node-prompt-panel.tsx", import.meta.url), "utf8");

    test("老记录把 angles 迁移成 refs，不整库读不出来", () => {
        // 旧版本按全身/半身/侧面分槽存参考图；不迁移的话用户升级后模特全空了
        expect(store).toContain("LEGACY_ANGLE_ORDER");
        expect(store).toContain("raw.angles");
    });

    test("弹窗有自建模特上传入口", () => {
        expect(modal).toContain("我的模特");
        expect(modal).toContain("上传保存为模特");
    });

    test("参考图存 storageKey 不存 url——blob URL 过一夜就失效", () => {
        expect(modal).toContain("model.refs");
        expect(modal).toContain("function ModelImage");
        expect(modal).not.toContain("image.url || image.storageKey");
    });

    test("没有参考图的模特不能直接用", () => {
        expect(modal).toContain("没有参考图，锁不住人");
    });

    test("不再有性别 / 体型 / 年龄 / 姿势 / 角度这些要手填的字段", () => {
        // 这些字段一个都不会改变生成结果，却把「加一个模特」变成填一张表
        expect(modal).not.toContain("ECOMMERCE_MODEL_GENDERS");
        expect(modal).not.toContain("ECOMMERCE_MODEL_FRAMES");
        expect(modal).not.toContain("ECOMMERCE_MODEL_POSE_KINDS");
        expect(modal).not.toContain("ECOMMERCE_MODEL_ANGLES");
    });

    test("输入框那一格在电商画布里是模特、自由画布里是风格", () => {
        expect(panel).toContain("<CanvasEcommerceModelButton");
        expect(panel).toContain('canvasKind === "ecommerce" ? (');
        expect(panel).toContain("<CanvasChooseImageStylePicker open={expanded ? expandedStyleToolOpen : styleToolOpen}");
    });
});

describe("画布图存为模特", () => {
    const toolbar = readFileSync(new URL("../src/components/canvas/canvas-image-toolbar-tools.tsx", import.meta.url), "utf8");
    const project = readFileSync(new URL("../src/pages/canvas/project.tsx", import.meta.url), "utf8");

    test("图片工具盘上有「存为模特」，且只在电商画布里出现", () => {
        expect(toolbar).toContain("存为模特");
        expect(toolbar).toContain("ecommerceOnly: true");
        expect(toolbar).toContain("options?.ecommerce");
    });

    test("存的是 storageKey——url 在退回本机时会失效", () => {
        expect(project).toContain("const ref = node.metadata?.storageKey;");
        expect(project).toContain("setModelImageToAdd({ storageKey: ref, name: node.title");
    });
});
