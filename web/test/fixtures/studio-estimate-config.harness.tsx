import { afterAll, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import type { StudioAttempt } from "@/lib/ecommerce-studio/types";
import type { ModelQuoteRequest } from "@/services/api/logical-models";

const dom = new Window({ url: "http://localhost/" });
for (const [key, value] of Object.entries({ window: dom, document: dom.document, navigator: dom.navigator, HTMLElement: dom.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) Object.defineProperty(globalThis, key, { configurable: true, value });
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const stores = await import("@/stores/use-config-store");
const model = "channel::image-model";
const config = {
    ...stores.defaultConfig,
    channels: [
        stores.createModelChannel({
            id: "channel",
            name: "test",
            scope: "system",
            apiFormat: "openai",
            models: ["image-model"],
            modelCosts: [{ model: "image-model", capability: "image", billingMode: "fixed_request", unitPriceMicrocredits: 3_000_000, logicalModelId: "logical" }],
        }),
    ],
};
mock.module("@/stores/use-config-store", () => ({ ...stores, useEffectiveConfig: () => config }));
const generation = await import("@/lib/ecommerce/ecommerce-image-generation");
mock.module("@/lib/ecommerce/ecommerce-image-generation", () => ({
    ...generation,
    buildEcommerceImageGeneration: (_config: unknown, _node: unknown, brief: { imageSettings: { size?: string; quality?: string } }) => ({ config: { ...config, model, size: brief.imageSettings.size, quality: brief.imageSettings.quality } }),
}));
const api = await import("@/services/api/logical-models");
const quoted: ModelQuoteRequest[] = [];
let reply: (request: ModelQuoteRequest) => Promise<unknown> = async (request) => ({ quote: { amountMicrocredits: request.intent.options?.size === "1024x1024" ? 3_000_000 : 11_000_000 } });
mock.module("@/services/api/logical-models", () => ({
    ...api,
    quoteModel: (request: ModelQuoteRequest) => {
        quoted.push(request);
        return reply(request);
    },
}));
let promptRead: () => Promise<Record<string, string>> = async () => ({});
const studioApi = await import("@/services/api/ecommerce-studio");
mock.module("@/services/api/ecommerce-studio", () => ({ ...studioApi, getStudioPrompts: () => promptRead() }));
const { useStudioEstimate } = await import("@/pages/ecommerce-studio/use-studio-estimate");
const { loadStudioPromptConfig } = await import("@/pages/ecommerce-studio/studio-prompt-config");
const { setStudioPromptOverrides, studioPromptText } = await import("@/lib/ecommerce-studio/prompt-overrides");
const { useUserStore } = await import("@/stores/use-user-store");
useUserStore.setState({ features: { ...useUserStore.getState().features, creditsEnabled: true } });
const host = dom.document.createElement("div");
dom.document.body.append(host);
const root = createRoot(host);
const base: NonNullable<StudioAttempt["input"]> = {
    compiled: { prompt: "test", textMode: "model", layers: [], trimmed: [], adapter: { family: "generic", label: "test", textRendering: "strong" }, references: [], modelReferences: [], styleReferences: [] },
    request: { imageSettings: { size: "1024x1024", quality: "high" } },
};
const square = { ...base, compiled: { ...base.compiled, references: [{ id: "a", resourceId: "a", url: "/api/resources/a/file", view: "front" as const, truth: true, addedAt: "2026-11-09" }] } };
const portrait = { ...square, compiled: { ...square.compiled, modelReferences: square.compiled.references }, request: { imageSettings: { size: "1024x1536", quality: "high" } } };
function Probe({ inputs }: { inputs: NonNullable<StudioAttempt["input"]>[] }) {
    return <span>{useStudioEstimate({ model, inputs })}</span>;
}
afterAll(async () => {
    await act(async () => root.unmount());
    await dom.happyDOM.abort();
});

test("mixed image specifications are quoted individually and identical ones share a quote", async () => {
    await act(async () => root.render(<Probe inputs={[square, square, portrait]} />));
    expect(host.textContent).toBe("预计约 17 积分");
    expect(quoted).toHaveLength(2);
    expect(quoted.map((request) => [request.intent.options?.size, request.intent.inputs?.image])).toEqual([
        ["1024x1024", 1],
        ["1024x1536", 2],
    ]);
    await act(async () => root.render(<Probe inputs={structuredClone([square, square, portrait])} />));
    expect(quoted).toHaveLength(2);
});

test("a late quote cannot replace the estimate for the new specifications", async () => {
    let finish!: (value: unknown) => void;
    reply = () =>
        new Promise((resolve) => {
            finish = resolve;
        });
    await act(async () => root.render(<Probe inputs={[square]} />));
    reply = async () => ({ quote: { amountMicrocredits: 11_000_000 } });
    await act(async () => root.render(<Probe inputs={[portrait]} />));
    await act(async () => finish({ quote: { amountMicrocredits: 99_000_000 } }));
    expect(host.textContent).toBe("预计约 11 积分");
});

test("prompt read failure clears stale overrides and cancelled responses preserve the current config", async () => {
    setStudioPromptOverrides({ key: "stale" });
    promptRead = async () => {
        throw new Error("offline");
    };
    await expect(loadStudioPromptConfig(new AbortController().signal)).rejects.toThrow("offline");
    expect(studioPromptText("key", "built-in")).toBe("built-in");
    let finish!: (value: Record<string, string>) => void;
    promptRead = () =>
        new Promise((resolve) => {
            finish = resolve;
        });
    const controller = new AbortController();
    const old = loadStudioPromptConfig(controller.signal);
    controller.abort();
    promptRead = async () => ({ key: "current" });
    await loadStudioPromptConfig(new AbortController().signal);
    finish({ key: "old-account" });
    await old;
    expect(studioPromptText("key", "built-in")).toBe("current");
    setStudioPromptOverrides({});
});
