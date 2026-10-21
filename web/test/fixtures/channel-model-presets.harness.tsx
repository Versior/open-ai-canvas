import { afterAll, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";

const dom = new Window({ url: "http://localhost/" });
for (const key of ["HTMLBodyElement", "HTMLHtmlElement"] as const) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: dom[key] });
for (const [key, value] of Object.entries({ window: dom, document: dom.document, navigator: dom.navigator, HTMLElement: dom.HTMLElement, HTMLInputElement: dom.HTMLInputElement, Element: dom.Element, Node: dom.Node, SVGElement: dom.SVGElement, ShadowRoot: dom.ShadowRoot, MutationObserver: dom.MutationObserver, ResizeObserver: dom.ResizeObserver, getComputedStyle: dom.getComputedStyle.bind(dom), IS_REACT_ACT_ENVIRONMENT: true })) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
mock.module("../../src/pages/admin/admin-context", () => ({ useAdminContext: () => ({ references: { users: [], channels: [] } }) }));
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { App } = await import("antd");
const { ChannelModelEditor } = await import("../../src/pages/admin/components/channel-model-editor");
const { ChannelModelPresetPicker } = await import("../../src/pages/admin/components/channel-model-preset-picker");
const { initialChannelModelValues, changeChannelModelCapability } = await import("../../src/pages/admin/components/channel-model-editor-form");
const { apiClient } = await import("../../src/services/api/request");
const { defaultModelCapabilityConfig } = await import("../../src/lib/model-capabilities");
const host = document.createElement("div");
document.body.append(host);
const root = createRoot(host);
const originalRequest = apiClient.request;
afterAll(async () => { await act(async () => root.unmount()); apiClient.request = originalRequest; await dom.happyDOM.abort(); });
const button = (label: string) => Array.from(document.querySelectorAll("button")).find((element) => element.textContent === label)!;
async function settle() { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 80)); }); }
async function enterModelId(id: string, value: string) {
    const input = document.querySelector<HTMLInputElement>(`input#${id}`)!;
    await act(async () => {
        Object.getOwnPropertyDescriptor(dom.HTMLInputElement.prototype, "value")!.set!.call(input, value);
        input.dispatchEvent(new dom.Event("input", { bubbles: true }));
    });
}
async function chooseOption(label: string, option: string) {
    const input = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
    expect(input).toBeDefined();
    await act(async () => input.parentElement!.dispatchEvent(new dom.MouseEvent("mousedown", { bubbles: true })));
    await settle();
    const choice = Array.from(document.querySelectorAll<HTMLElement>(".ant-select-item-option")).find((item) => item.textContent?.includes(option));
    expect(choice).toBeDefined();
    await act(async () => choice!.click());
}

test("real price picker copies existing model prices and keeps the target identity on save", async () => {
    await act(async () => root.render(<App><div /></App>));
    const protocols = [{ value: "chat-completion", label: "Chat", capability: "text" as const, create: "POST /v1/chat/completions", contentType: "application/json", media: "url" }];
    const source = { id: "source", channelId: "test", modelKey: "source-model", providerModelKey: "source-upstream", displayName: "来源", icon: "", capability: "text" as const, protocol: "chat-completion", capabilityConfig: defaultModelCapabilityConfig("chat-completion"), billingMode: "token" as const, unitPriceMicrocredits: 0, inputTokenPriceMicrocredits: 3_000_000, outputTokenPriceMicrocredits: 12_000_000, cachedTokenPriceMicrocredits: 500_000, priceConfigured: true, enabled: true, priceVersion: 1, priceTiers: [], createdAt: "", updatedAt: "" };
    let payload: any;
    apiClient.request = (async (config) => { payload = config.data; return { data: { code: 0, data: { model: {} }, msg: "ok" }, status: 200, headers: {} }; }) as typeof apiClient.request;
    await act(async () => root.render(<App><ChannelModelEditor channel={{ id: "test", name: "测试", baseUrl: "https://example.invalid", apiKey: "", apiFormat: "openai", models: [] }} existingModels={[source]} editing={null} protocols={protocols} protocolLoading={false} protocolError="" onRetryProtocols={() => {}} onClose={() => {}} onSaved={async () => {}} /></App>));
    await enterModelId("modelKey", "target-model");
    await chooseOption("价格来源模型", "source-upstream");
    await act(async () => button("复制价格到表单").click());
    expect(payload).toBeUndefined();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 450)); });
    await act(async () => button("添加模型").click());
    await settle();
    expect(payload).toMatchObject({ modelKey: "target-model", providerModelKey: "target-model", protocol: "chat-completion" });
    expect(payload.priceTiers[0]).toMatchObject({ providerModelKey: "target-model", billingMode: "token", inputTokenPriceMicrocredits: 3_000_000, outputTokenPriceMicrocredits: 12_000_000, cachedTokenPriceMicrocredits: 500_000 });
});

test("renaming an image model with unchanged parameters does not ask to recheck pricing", async () => {
    await act(async () => root.render(<App><div /></App>));
    const protocols = [{ value: "image", label: "图片", capability: "image" as const, create: "POST /v1/images/generations", contentType: "application/json", media: "url", imageParameters: [{ name: "quality", label: "质量", type: "string" as const, values: ["standard", "high"], default: "standard", pricing: true }] }];
    const draft = changeChannelModelCapability({ ...initialChannelModelValues(null, protocols), capability: "image", modelKey: "image-model", providerModelKey: "image-model" }, protocols);
    draft.priceTiers[0].unitPrice = 19;
    let payload: any;
    apiClient.request = (async (config) => { payload = config.data; return { data: { code: 0, data: { model: {} }, msg: "ok" }, status: 200, headers: {} }; }) as typeof apiClient.request;
    await act(async () => root.render(<App><ChannelModelEditor channel={{ id: "test", name: "测试", baseUrl: "https://example.invalid", apiKey: "", apiFormat: "openai", models: [] }} editing={null} draftValues={draft} protocols={protocols} protocolLoading={false} protocolError="" onRetryProtocols={() => {}} onClose={() => {}} onSaved={async () => {}} /></App>));
    await settle();
    expect(document.body.textContent).not.toContain("请核对定价");
    await enterModelId("providerModelKey", "image-model-renamed");
    expect(document.body.textContent).not.toContain("能力或协议已变更");
    expect(document.body.textContent).not.toContain("请核对定价");
    await act(async () => button("添加模型").click());
    await settle();
    expect(payload).toMatchObject({ providerModelKey: "image-model-renamed", capability: "image", protocol: "image" });
    expect(payload.priceTiers[0]).toMatchObject({ billingMode: "fixed_request", unitPriceMicrocredits: 19_000_000 });
});

test("protocol changes require pricing review, acknowledge it and warn again after another change", async () => {
    await act(async () => root.render(<App><div /></App>));
    const protocols = ["first", "second"].map((value) => ({ value, label: value, capability: "text" as const, create: "POST /v1/chat/completions", contentType: "application/json", media: "url" }));
    const draft = initialChannelModelValues(null, protocols);
    Object.assign(draft, { modelKey: "text-model", providerModelKey: "text-model" });
    Object.assign(draft.priceTiers[0], { billingMode: "token", inputTokenPrice: 3, outputTokenPrice: 12, cachedTokenPrice: 0.5 });
    let payload: any;
    apiClient.request = (async (config) => { payload = config.data; return { data: { code: 0, data: { model: {} }, msg: "ok" }, status: 200, headers: {} }; }) as typeof apiClient.request;
    await act(async () => root.render(<App><ChannelModelEditor channel={{ id: "test", name: "测试", baseUrl: "https://example.invalid", apiKey: "", apiFormat: "openai", models: [] }} editing={null} draftValues={draft} protocols={protocols} protocolLoading={false} protocolError="" onRetryProtocols={() => {}} onClose={() => {}} onSaved={async () => {}} /></App>));
    const select = (value: string) => act(async () => document.querySelector<HTMLInputElement>(`.choice-browser input[value="${value}"]`)!.click());
    await select("second");
    expect(document.body.textContent).toContain("调用协议已变更");
    expect(document.body.textContent).toContain("请核对定价");
    await act(async () => button("已核对").click());
    expect(document.body.textContent).not.toContain("请核对定价");
    await select("first");
    expect(document.body.textContent).toContain("请核对定价");
    await act(async () => button("添加模型").click());
    await settle();
    expect(payload.priceTiers[0]).toMatchObject({ billingMode: "token", inputTokenPriceMicrocredits: 3_000_000, outputTokenPriceMicrocredits: 12_000_000, cachedTokenPriceMicrocredits: 500_000 });
});

test("upstream changes that actually change image specifications still warn with an accurate reason", async () => {
    await act(async () => root.render(<App><div /></App>));
    const protocols = [{ value: "cangyuan-midjourney-v82", label: "MJ", capability: "image" as const, create: "POST /image", contentType: "application/json", media: "url" }];
    const draft = changeChannelModelCapability({ ...initialChannelModelValues(null, protocols), capability: "image", modelKey: "midjourney-1k", providerModelKey: "midjourney-1k" }, protocols);
    draft.priceTiers[0].unitPrice = 19;
    let payload: any;
    apiClient.request = (async (config) => { payload = config.data; return { data: { code: 0, data: { model: {} }, msg: "ok" }, status: 200, headers: {} }; }) as typeof apiClient.request;
    await act(async () => root.render(<App><ChannelModelEditor channel={{ id: "test", name: "测试", baseUrl: "https://example.invalid", apiKey: "", apiFormat: "openai", models: [] }} editing={null} draftValues={draft} protocols={protocols} protocolLoading={false} protocolError="" onRetryProtocols={() => {}} onClose={() => {}} onSaved={async () => {}} /></App>));
    await enterModelId("providerModelKey", "midjourney-2k");
    expect(document.body.textContent).toContain("图片参数已更新");
    expect(document.body.textContent).toContain("请核对定价");
    expect(document.body.textContent).not.toContain("能力或协议已变更");
    await act(async () => button("添加模型").click());
    await settle();
    expect(payload.capabilityConfig.image.size.presets.every((preset: { tier: string }) => preset.tier === "2k")).toBe(true);
    expect(payload.priceTiers[0]).toMatchObject({ billingMode: "fixed_request", unitPriceMicrocredits: 19_000_000 });
});

test("real editor applies metadata only on command and saves it through the existing API", async () => {
    await act(async () => root.render(<App><div /></App>));
    const protocols = [{ value: "text", label: "文本", capability: "text" as const, create: "POST /v1/chat/completions", contentType: "application/json", media: "url" }];
    const draft = initialChannelModelValues(null, protocols);
    Object.assign(draft, { modelKey: "my-product", providerModelKey: "gemini-2.5-computer-use-preview-10-2025", channelLabel: "我的渠道", description: "已有描述", enabled: false });
    draft.priceTiers[0].unitPrice = 19;
    draft.capabilityConfig!.text!.streaming = false;
    let payload: any;
    let saved = 0;
    apiClient.request = (async (config) => {
        expect(config.method).toBe("post");
        expect(config.url).toBe("/admin/channels/test/models");
        payload = config.data;
        return { data: { code: 0, data: { model: {} }, msg: "ok" }, status: 200, headers: {} };
    }) as typeof apiClient.request;
    await act(async () => root.render(<App><ChannelModelEditor channel={{ id: "test", name: "测试渠道", baseUrl: "https://example.invalid", apiKey: "", apiFormat: "openai", models: [] }} editing={null} draftValues={draft} protocols={protocols} protocolLoading={false} protocolError="" onRetryProtocols={() => {}} onClose={() => {}} onSaved={async () => { saved++; }} /></App>));
    await settle();
    expect(document.body.textContent).toContain("128,000");
    expect(document.body.textContent).toContain("推理能力");
    expect(payload).toBeUndefined();
    await act(async () => button("应用预设到表单").click());
    expect(payload).toBeUndefined();
    expect(document.body.textContent).toContain("已填入，可继续修改");
    await act(async () => button("添加模型").click());
    await settle();
    expect(saved).toBe(1);
    expect(payload).toMatchObject({ modelKey: "my-product", providerModelKey: draft.providerModelKey, channelLabel: "我的渠道", description: "已有描述", enabled: false, icon: "Gemini", protocol: "text", capabilityConfig: { text: { contextWindowTokens: 128000, maxOutputTokens: 64000, streaming: false, references: { maxImages: 100, maxImageBytes: 0 } } } });
    expect(payload.priceTiers[0].unitPriceMicrocredits).toBe(19_000_000);
    expect(draft.capabilityConfig?.text?.references.maxImages).toBe(0);
});

test("new model editor automatically fills fuzzy metadata and saves without applying a preset button", async () => {
    await act(async () => root.render(<App><div /></App>));
    const protocols = [{ value: "chat-completion", label: "Chat", capability: "text" as const, create: "POST /v1/chat/completions", contentType: "application/json", media: "url" }];
    let payload: any;
    apiClient.request = (async (config) => { payload = config.data; return { data: { code: 0, data: { model: {} }, msg: "ok" }, status: 200, headers: {} }; }) as typeof apiClient.request;
    await act(async () => root.render(<App><ChannelModelEditor channel={{ id: "test", name: "测试", baseUrl: "https://example.invalid", apiKey: "", apiFormat: "openai", models: [] }} editing={null} protocols={protocols} protocolLoading={false} protocolError="" onRetryProtocols={() => {}} onClose={() => {}} onSaved={async () => {}} /></App>));
    const input = document.querySelector<HTMLInputElement>("input#modelKey")!;
    expect(input).toBeDefined();
    await act(async () => {
        Object.getOwnPropertyDescriptor(dom.HTMLInputElement.prototype, "value")!.set!.call(input, "models/Gemini_2.5_Flash-high");
        input.dispatchEvent(new dom.Event("input", { bubbles: true }));
    });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 450)); });
    expect(document.body.textContent).toContain("参数匹配 gemini-2.5-flash");
    expect(payload).toBeUndefined();
    await act(async () => button("添加模型").click());
    await settle();
    expect(document.querySelector<HTMLInputElement>("input#displayName")?.value).toBe("Gemini");
    expect(payload).toMatchObject({ displayName: "Gemini", icon: "Gemini", protocol: "chat-completion", capabilityConfig: { text: { contextWindowTokens: 1048576, maxOutputTokens: 65536, references: { maxImages: 100 } } } });
    expect(payload.priceTiers[0].priceConfigured).toBe(false);
});

test("manual category survives automatic matching and subsequent model renaming", async () => {
    await act(async () => root.render(<App><div /></App>));
    const protocols = [{ value: "chat-completion", label: "Chat", capability: "text" as const, create: "POST /v1/chat/completions", contentType: "application/json", media: "url" }];
    let payload: any;
    apiClient.request = (async (config) => { payload = config.data; return { data: { code: 0, data: { model: {} }, msg: "ok" }, status: 200, headers: {} }; }) as typeof apiClient.request;
    await act(async () => root.render(<App><ChannelModelEditor channel={{ id: "test", name: "测试", baseUrl: "https://example.invalid", apiKey: "", apiFormat: "openai", models: [] }} editing={null} protocols={protocols} protocolLoading={false} protocolError="" onRetryProtocols={() => {}} onClose={() => {}} onSaved={async () => {}} /></App>));
    await enterModelId("modelKey", "Gemini_2.5_Flash-high");
    await enterModelId("displayName", "我的分类");
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 450)); });
    expect(document.querySelector<HTMLInputElement>("input#displayName")?.value).toBe("我的分类");
    await enterModelId("modelKey", "claude-sonnet-4");
    await act(async () => button("添加模型").click());
    await settle();
    expect(payload).toMatchObject({ displayName: "我的分类", icon: "Claude" });
});

test("real picker shows model parameters without supplier choices or external links", async () => {
    const applied: unknown[] = [];
    const render = (modelId: string, capability = "text") => act(async () => root.render(<App><ChannelModelPresetPicker modelId={modelId} capability={capability} disabled={false} onApply={(preset) => applied.push(preset)} /></App>));
    await render("gemini-2.5-flash"); await settle();
    expect(host.textContent).toContain("多模态输入");
    expect(host.textContent).toContain("图片识别");
    expect(button("应用预设到表单")).toBeDefined();
    expect(host.querySelector("a")).toBeNull();
    for (const text of ["供应商", "Pi", "DataLearner", "google-vertex"]) expect(host.textContent).not.toContain(text);
    await act(async () => button("应用预设到表单").click());
    expect(applied).toHaveLength(1);
    expect(applied[0]).toMatchObject({ id: "gemini-2.5-flash", context: 1048576, output: 65536, vision: true });
    expect(applied[0]).not.toHaveProperty("provider");
    await render("gemini-2.5-flash-high");
    expect(host.textContent).toContain("1,048,576");
    await render("gemini-2.5-computer-use-preview-10-2025", "image");
    expect(host.textContent).toContain("图片输入不代表图片生成能力");
    expect(button("应用预设到表单")).toBeUndefined();
    expect(applied).toHaveLength(1);
});
