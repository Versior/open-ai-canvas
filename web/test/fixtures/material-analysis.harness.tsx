import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { BackendGenerationResult } from "@/services/api/generation-task";
import type { CreativeMaterialSuggestion } from "@/lib/remake/materials";
const dom = new Window({ url: "http://localhost/" });
for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "Event", "MutationObserver"])
    Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? dom : key === "document" ? dom.document : dom[key as keyof Window] });
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { useMaterialAnalysis, materialAnalysisDependencies } = await import("@/pages/video-replication/use-material-analysis");
const { defaultConfig, createModelChannel, encodeChannelModel } = await import("@/stores/use-config-store");
const { defaultModelCapabilityConfig } = await import("@/lib/model-capabilities");
const { setActiveUserScope } = await import("@/lib/user-scope");
const channel = createModelChannel({ id: "test-text", name: "测试", interfaceType: "openai", baseUrl: "/api", apiKey: "", models: ["gpt-4o", "gpt-3.5-turbo"] });
channel.modelCosts = channel.models.map((model) => {
    const capabilityConfig = defaultModelCapabilityConfig("openai", model);
    if (model === "gpt-4o") capabilityConfig.text!.references.maxImages = 2;
    return { model, capabilityConfig };
});
const model = encodeChannelModel(channel.id, "gpt-4o");
const config = { ...defaultConfig, channels: [channel], textModel: model };
type Options = Parameters<typeof materialAnalysisDependencies.run>[0];
const requests: Array<{ input: Options; resolve: (value: BackendGenerationResult) => void; reject: (error: Error) => void }> = [];
materialAnalysisDependencies.run = (input) =>
    new Promise((resolve, reject) => {
        requests.push({ input, resolve, reject });
    });
const suggestions: CreativeMaterialSuggestion[] = [];
let images = ["image_a"];
let paused = false;
let selectedModel = model;
let analysis: ReturnType<typeof useMaterialAnalysis>;
function Harness() {
    analysis = useMaterialAnalysis({
        config,
        model: selectedModel,
        product: { name: "", sellingPoints: "", images: images.map((resourceId) => ({ id: resourceId, resourceId, name: "参考" })) },
        brief: { scene: "selling", tone: "natural", seconds: 15, audience: "", objective: "", brand: "" },
        paused,
        onResult: (value) => suggestions.push(value),
    });
    return <span>{analysis.busy ? "分析中" : analysis.error || (analysis.recognized ? "已识别" : "等待")}</span>;
}
const host = document.createElement("div");
document.body.append(host);
const root = createRoot(host);
const output = (name: string) => ({
    text: JSON.stringify({ name, family: "kitchen", facts: [{ label: "颜色", value: "蓝色", group: "appearance", evidence: "visible" }], points: [{ title: "蓝色外观", facts: ["颜色"] }], creative: { audience: "桌面使用者", note: "近景展示" } }),
});
const render = async () => {
    await act(async () => root.render(<Harness />));
};
const settle = async (ms = 400) => {
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, ms));
    });
};
afterAll(async () => {
    await act(async () => root.unmount());
    await dom.happyDOM.abort();
});
test("上传批次防抖，只提交模型支持的图片与统一后端任务", async () => {
    setActiveUserScope("user_a");
    await render();
    images = ["image_a", "image_b", "image_c"];
    await render();
    await settle();
    expect(requests).toHaveLength(1);
    expect(requests[0].input.referenceImages?.map((image) => image.storageKey)).toEqual(["resource:image_a", "resource:image_b"]);
    expect(requests[0].input.expectedUserScope).toBe("user_a");
    expect(requests[0].input.metadata).toMatchObject({ ecommerceCapability: "dossier", stage: "material-analysis" });
    await act(async () => requests[0].resolve(output("蓝色杯")));
    expect(suggestions[0].name).toBe("蓝色杯");
    expect(analysis.recognized).toBe(true);
    paused = true;
    await render();
    paused = false;
    await render();
    await settle();
    expect(requests).toHaveLength(1);
    expect(analysis.recognized).toBe(true);
});
test("换图取消旧请求并拒绝旧结果", async () => {
    images = ["image_d"];
    await render();
    await settle();
    const old = requests[1];
    images = ["image_e"];
    await render();
    expect(old.input.signal?.aborted).toBe(true);
    await act(async () => old.resolve(output("旧图片")));
    expect(suggestions).toHaveLength(1);
    await settle();
    await act(async () => requests[2].resolve(output("新图片")));
    expect(suggestions.at(-1)?.name).toBe("新图片");
});
test("换账号拒绝旧结果，旧账号的请求不会回填", async () => {
    images = ["image_f"];
    await render();
    await settle();
    const old = requests[3];
    setActiveUserScope("user_b");
    await render();
    await act(async () => old.resolve(output("旧账号")));
    expect(suggestions).toHaveLength(2);
    await settle();
    expect(requests[4].input.expectedUserScope).toBe("user_b");
    await act(async () => requests[4].resolve(output("新账号")));
    expect(suggestions.at(-1)?.name).toBe("新账号");
});
test("失败不会自动重提，只有显式重试发起新请求", async () => {
    images = ["image_g"];
    await render();
    await settle();
    await act(async () => requests[5].reject(new Error("模型不可用")));
    expect(analysis.error).toBe("模型不可用");
    await render();
    await settle();
    expect(requests).toHaveLength(6);
    await act(async () => analysis.retry());
    await settle();
    expect(requests).toHaveLength(7);
    await act(async () => requests[6].resolve(output("重试成功")));
    expect(analysis.recognized).toBe(true);
});
test("纯文本模型和未登录状态不发请求", async () => {
    selectedModel = encodeChannelModel(channel.id, "gpt-3.5-turbo");
    images = ["image_h"];
    await render();
    await settle();
    expect(requests).toHaveLength(7);
    selectedModel = model;
    setActiveUserScope(null);
    await render();
    await settle();
    expect(requests).toHaveLength(7);
});
test("处理中切换流程会取消回填，恢复流程不自动重提", async () => {
    setActiveUserScope("user_b");
    images = ["image_i"];
    await render();
    await settle();
    const old = requests[7];
    paused = true;
    await render();
    expect(old.input.signal?.aborted).toBe(true);
    paused = false;
    await render();
    await act(async () => old.resolve(output("中断结果")));
    await settle();
    expect(requests).toHaveLength(8);
    expect(suggestions.at(-1)?.name).toBe("重试成功");
    expect(analysis.error).toContain("识别已中断");
});
