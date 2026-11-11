import { expect, test } from "bun:test";
import { emptyEcommerceDraft, type EcommercePlan, type EcommerceProject } from "@/services/api/ecommerce";
import { apiClient } from "@/services/api/request";
import { commerceInputSignature, plannerPrompt } from "@/pages/ecommerce/planner";
import { submitCommerceImages } from "@/pages/ecommerce/workflow";
import { defaultConfig } from "@/stores/use-config-store";

test("paid image submission rejects pending or unsupported facts before making requests", async () => {
    const draft = { ...emptyEcommerceDraft(), productName: "头戴耳机", imageType: "detail", count: 1, imageModel: "gpt-image", references: [{ resourceId: "product", role: "primary" as const }] };
    const plan: EcommercePlan = {
        inputSignature: commerceInputSignature(draft),
        productSummary: "头戴耳机",
        confirmedFacts: [],
        uncertainFacts: [],
        visualStrategy: "自然光",
        qualityChecks: [],
        images: [
            {
                id: "image",
                imageType: "detail",
                platform: "taobao",
                language: "zh-CN",
                goal: "展示可见外观",
                theme: "看见设计",
                composition: "商品右侧",
                mainVisual: "耳机",
                verifiedClaims: "",
                copy: "看见设计",
                lighting: "窗光",
                fidelity: "真实外观",
                prompt: "展示耳机外观",
                negativePrompt: "",
                imageModel: "gpt-image",
                ratio: "1:1",
                resolution: "1k",
            },
        ],
    };
    const project: EcommerceProject = { id: "project", name: "商品", status: "draft", revision: 1, draftJson: "", planJson: "", createdAt: "", updatedAt: "" };
    const adapter = apiClient.defaults.adapter;
    let requests = 0;
    apiClient.defaults.adapter = async () => {
        requests += 1;
        throw new Error("must not create a task or save a project");
    };
    try {
        await expect(submitCommerceImages(defaultConfig, draft, { ...plan, uncertainFacts: ["容量待确认"] }, project, () => {})).rejects.toThrow("待确认");
        await expect(submitCommerceImages(defaultConfig, draft, { ...plan, images: [{ ...plan.images[0], prompt: "演示主动降噪功能" }] }, project, () => {})).rejects.toThrow("降噪功能");
        await expect(submitCommerceImages(defaultConfig, draft, { ...plan, images: [{ ...plan.images[0], copy: "续航24小时" }] }, project, () => {})).rejects.toThrow("续航时长");
        expect(requests).toBe(0);
    } finally {
        apiClient.defaults.adapter = adapter;
    }
});

test("detail planning keeps creative exploration without authorizing invented specifications", () => {
    const prompt = plannerPrompt({ ...emptyEcommerceDraft(), imageType: "detail", count: 9 });
    expect(prompt).toContain("不依据同品类常见配置推测容量、尺寸、材质、年龄范围或功能");
    expect(prompt).not.toContain("这些推断信息不放进 uncertainFacts");
    expect(prompt).toContain("生成前由商家确认或移除");
});
