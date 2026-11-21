import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";
import "fake-indexeddb/auto";
import type { GenerationTask, CreateTaskInput } from "@/services/api/task-center";
import type { StudioProduct } from "@/lib/ecommerce-studio/types";

const dom = new Window({ url: "http://localhost/studio", settings: { disableCSSFileLoading: true, disableJavaScriptFileLoading: true, disableComputedStyleRendering: true } });
for (const key of [
    "document",
    "navigator",
    "HTMLElement",
    "HTMLInputElement",
    "HTMLAnchorElement",
    "Element",
    "SVGElement",
    "ShadowRoot",
    "Node",
    "CustomEvent",
    "Event",
    "MutationObserver",
    "ResizeObserver",
    "getComputedStyle",
    "requestAnimationFrame",
    "cancelAnimationFrame",
    "localStorage",
    "sessionStorage",
] as const) {
    const value = dom[key];
    Object.defineProperty(globalThis, key, { configurable: true, value: typeof value === "function" && ["getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame"].includes(key) ? value.bind(dom) : value });
}
Object.defineProperty(globalThis, "window", { configurable: true, value: dom });
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
Object.defineProperty(dom.navigator, "locks", { configurable: true, value: { request: async (_name: string, callback: () => unknown) => callback() } });

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { MemoryRouter } = await import("react-router");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { App, ConfigProvider } = await import("antd");
const { apiClient } = await import("@/services/api/request");
const { useConfigStore, createModelChannel, defaultConfig } = await import("@/stores/use-config-store");
const { useUserStore } = await import("@/stores/use-user-store");
const { setActiveUserScope } = await import("@/lib/user-scope");
const { defaultModelCapabilityConfig } = await import("@/lib/model-capabilities");
const { createStudioProduct } = await import("@/lib/ecommerce-studio/product");
const { studioActivePlan, studioRevisionPlan } = await import("@/lib/ecommerce-studio/runs");
const { useStudioRunner, useStudioAnalysis } = await import("@/pages/ecommerce-studio/use-studio-runner");
const { useStudioStore } = await import("@/pages/ecommerce-studio/use-studio-store");
const { StudioForm } = await import("@/pages/ecommerce-studio/studio-form");
const scope = "studio-offline";
const textModel = "fixture::qwen-test";
const imageModel = "fixture::gpt-image-1";
const textConfig = defaultModelCapabilityConfig("newapi-chat", "qwen-test");
textConfig.text!.references.maxImages = 2;
const channel = createModelChannel({
    id: "fixture",
    scope: "system",
    models: ["qwen-test", "gpt-image-1"],
    modelCosts: [
        { model: "qwen-test", capability: "text", protocol: "newapi-chat", capabilityConfig: textConfig, billingMode: "fixed_request", unitPriceMicrocredits: 1 },
        { model: "gpt-image-1", capability: "image", protocol: "openai-image", billingMode: "fixed_request", unitPriceMicrocredits: 1 },
    ],
});
setActiveUserScope(scope);
useUserStore.setState({ user: { id: scope, username: "fixture", displayName: "测试", role: "user", status: "active" }, features: { ...useUserStore.getState().features, creditsEnabled: false, customChannelsEnabled: true } });
useConfigStore.setState({ config: { ...defaultConfig, channels: [channel], model: imageModel, textModel, textModels: [textModel], imageModel, imageModels: [imageModel] } });
const store = useStudioStore.getState;
const base = createStudioProduct("offline-cup", "2026-01-01T00:00:00Z");
let saved: StudioProduct = {
    ...base,
    revision: 1,
    name: "陶瓷杯",
    dossier: { name: "陶瓷杯", category: "杯子", family: "home", summary: "有把手的杯子", facts: [], questions: [], invariants: [] },
    brief: { ...base.brief, planNote: "暖色" },
    photos: [{ id: "cup-photo", resourceId: "cup-resource", url: "/api/resources/cup-resource/file", width: 800, height: 800, view: "front", truth: true, addedAt: base.createdAt }],
};
const library = [2, 3].map((count) => ({
    id: `s${count}`,
    name: `陶瓷杯${count}屏`,
    enabled: true,
    flow: "detail",
    category: "杯子",
    source: "fixture",
    style: "暖色",
    shots: Array.from({ length: count }, (_, index) => ({ title: `场景${index}`, duty: "杯子在桌上" })),
}));
const screens = (count: number) =>
    JSON.stringify({
        summary: `测试稿${count}`,
        style: "暖色",
        screens: Array.from({ length: count }, (_, index) => ({
            role: "detail-scene",
            title: `场景${index}`,
            visual: "杯子在木桌上",
            purpose: ["看清杯子外观", "展示握持方式", "总结桌面需求"][index],
            layout: "poster",
            headline: ["木桌静物", "侧看杯口", "茶歇时刻"][index],
            subline: "",
            lines: [],
        })),
    });
let replyCount = 1;
let denyAcceptedSave = false;
const requests: CreateTaskInput[] = [];
const reads: string[] = [];
const unexpected: string[] = [];
const tasks = new Map<string, GenerationTask>();
apiClient.request = (async (request) => {
    const path = request.url || "";
    const method = request.method?.toUpperCase();
    let data;
    if (path === "/ecommerce/studio") data = { revision: saved.revision, products: [structuredClone(saved)] };
    else if (path === `/ecommerce/studio/products/${saved.id}` && method === "PUT") {
        expect(request.data.expectedRevision).toBe(saved.revision);
        if (denyAcceptedSave && request.data.product.planReceipt?.state === "accepted") throw new Error("测试断开保存");
        saved = { ...structuredClone(request.data.product), revision: saved.revision + 1 };
        data = { revision: saved.revision, product: structuredClone(saved) };
    } else if (path === "/ecommerce/studio/templates") data = { templates: [] };
    else if (path === "/ecommerce/templates") data = { items: library.map((item) => ({ id: item.id, name: item.name, category: item.category, count: item.shots.length })), categories: [], total: 2, page: 1, pageSize: 20 };
    else if (path.startsWith("/ecommerce/templates/")) data = { template: library.find((item) => path.endsWith(`/${item.id}`)) };
    else if (path === "/tasks" && method === "POST") {
        const input = request.data as CreateTaskInput;
        const id = `fixture-task-${requests.push(input)}`;
        const image = input.operation === "image";
        const task: GenerationTask = {
            id,
            attempts: 1,
            type: input.type!,
            operation: input.operation,
            prompt: input.prompt,
            status: image ? "failed" : "succeeded",
            inputJson: JSON.stringify({ metadata: input.input?.metadata }),
            ...(image ? { error: "fixture: no paid generation" } : { resultJson: JSON.stringify({ text: screens(replyCount) }) }),
            createdAt: base.createdAt,
            updatedAt: base.createdAt,
        };
        tasks.set(id, task);
        data = { ...task, status: "queued", resultJson: "" };
    } else if (path.startsWith("/tasks/fixture-task-")) {
        reads.push(path);
        data = tasks.get(path.slice("/tasks/".length));
    } else {
        unexpected.push(path);
        throw new Error(`unexpected offline request ${path}`);
    }
    return { data: { code: 0, data, msg: "ok" }, status: 200, headers: {} };
}) as typeof apiClient.request;

const root = createRoot(dom.document.body.appendChild(dom.document.createElement("div")));
const client = new QueryClient();
function Panel() {
    const product = useStudioStore((state) => state.products[0]);
    const runner = useStudioRunner();
    return <StudioForm product={product} runner={runner} edit={(fn, options) => void store().update(product.id, fn, options)} ensure={() => product.id} onGenerated={() => {}} />;
}
const local = () => store().products[0];
const button = (text: string) => [...dom.document.querySelectorAll("button")].find((item) => item.textContent.trim() === text);
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function settle(check: () => boolean) {
    for (let count = 0; count < 70 && !check(); count++)
        await act(async () => {
            await wait(20);
        });
    expect(check()).toBe(true);
}
async function click(text: string) {
    const target = button(text);
    expect(target?.disabled).toBe(false);
    await act(async () => {
        target!.click();
        await wait(10);
    });
}
async function pick(template: (typeof library)[number]) {
    await click("套图模板库");
    await settle(() => Boolean(dom.document.querySelector(".etc-row")));
    const row = [...dom.document.querySelectorAll<HTMLButtonElement>(".etc-row")].find((item) => item.textContent.includes(template.name));
    await act(async () => row!.click());
    await settle(() => Boolean(button("使用这套")) && Boolean(dom.document.querySelector(".etc-preview-head")?.textContent.includes(template.name)));
    await click("使用这套");
    expect(local().brief.suite?.id).toBe(template.id);
}
async function edit(fn: (product: StudioProduct) => StudioProduct) {
    await act(async () => {
        store().update(saved.id, fn);
        await store().flush(saved.id);
    });
}
afterAll(async () => {
    await act(async () => root.unmount());
    await dom.happyDOM.abort();
    client.clear();
});

test("starred input, durable diagnostics, GET-only recovery, suite identity and first-screen charge boundary", async () => {
    await act(async () => {
        await store().load(true);
        root.render(
            <ConfigProvider theme={{ token: { motion: false } }}>
                <App>
                    <QueryClientProvider client={client}>
                        <MemoryRouter>
                            <Panel />
                        </MemoryRouter>
                    </QueryClientProvider>
                </App>
            </ConfigProvider>,
        );
    });
    await pick(library[0]);
    await edit((product) => ({ ...product, photos: product.photos.map((photo) => ({ ...photo, truth: false })) }));
    expect(button("AI 策划 2 屏")?.disabled).toBe(true);
    expect(dom.document.body.textContent).toContain("请点亮至少一张非吊牌商品图的星标");
    expect(requests).toHaveLength(0);
    await edit((product) => ({ ...product, photos: product.photos.map((photo) => ({ ...photo, truth: true })) }));
    await click("AI 策划 2 屏");
    await settle(() => local().planReceipt?.state === "not-accepted");
    expect(requests[0].input?.metadata).toMatchObject({
        studioStep: "plan",
        studioPlanKind: "detail",
        studioPlanScope: "template",
        studioPlanCount: 2,
        studioTemplateId: "s2",
        studioTemplateSource: "library",
        studioPlanRoles: expect.arrayContaining(["detail-scene"]),
    });
    expect(requests[0].input?.textOptions).toMatchObject({ stream: true });
    expect(studioActivePlan(local())).toBeUndefined();
    expect(local().planReceipt?.review?.length).toBe(1);
    await act(async () => {
        await store().load(true);
    });
    expect(dom.document.body.textContent).toContain("文本已完成 · 这次结果未采用");
    expect(local().planReceipt?.review?.[0]).toMatchObject({ index: 0, purpose: "看清杯子外观", headline: "木桌静物", visual: "杯子在木桌上" });
    expect(dom.document.querySelector('[aria-label="最近策划结果"]')?.textContent).toContain("画面摘要：杯子在木桌上");
    const id = local().planReceipt!.taskId!;
    expect(dom.document.body.textContent).toContain(id);
    await edit((product) => ({ ...product, sellerNotes: "输入已变" }));
    expect(button("重验原任务（不扣费）")?.disabled).toBe(true);
    await edit((product) => ({ ...product, sellerNotes: "" }));
    const originalInput = tasks.get(id)!.inputJson;
    tasks.get(id)!.inputJson = JSON.stringify({ metadata: { source: "ecommerce-studio", studioStep: "recognize", studioProductId: "different-product" } });
    await click("重验原任务（不扣费）");
    expect(studioActivePlan(local())).toBeUndefined();
    expect(local().planReceipt?.message).toContain("不匹配");
    tasks.get(id)!.inputJson = originalInput;
    tasks.get(id)!.resultJson = JSON.stringify({ text: screens(2) });
    const queries = reads.length;
    denyAcceptedSave = true;
    await click("重验原任务（不扣费）");
    await settle(() => local().planReceipt?.state === "accepted" && store().saveStates[saved.id] === "error");
    expect(saved.planReceipt?.state).not.toBe("accepted");
    expect(dom.document.body.textContent).toContain("文本已完成 · 当前本机已采用");
    expect(dom.document.body.textContent).toContain("商品未保存到服务器：测试断开保存");
    denyAcceptedSave = false;
    await click("只重试保存（不扣费）");
    await settle(() => saved.planReceipt?.state === "accepted");
    expect(reads.length).toBeGreaterThan(queries);
    expect(requests).toHaveLength(1);
    expect(studioActivePlan(local())?.screens).toHaveLength(2);
    expect(saved.planReceipt?.taskId).toBe(id);
    const original = local();
    expect(studioRevisionPlan({ ...original, brief: { ...original.brief, planNote: "调整光线" } })?.suiteId).toBe("s2");
    for (const patch of [{ source: "admin" as const }, { style: "替换同 ID 模板内容" }]) expect(studioRevisionPlan({ ...original, brief: { ...original.brief, suite: { ...original.brief.suite!, ...patch } } })).toBeUndefined();
    await pick(library[1]);
    expect(button("按补充调整重新策划")).toBeUndefined();
    replyCount = 3;
    await click("AI 策划 3 屏");
    await settle(() => studioActivePlan(local())?.suiteId === "s3");
    expect(requests[1].prompt).not.toContain("【上一版策划】");
    expect(requests[1].prompt).toContain("陶瓷杯3屏");
    await edit((product) => {
        const plan = product.brief.templatePlan!;
        return { ...product, brief: { ...product.brief, useProofLayout: true, templatePlan: { ...plan, screens: plan.screens.map((screen, index) => ({ ...screen, composition: index === 0 ? undefined : "left" })) } } };
    });
    const group = dom.document.querySelector<HTMLButtonElement>(".es-generate")!;
    expect(group.disabled).toBe(false);
    await act(async () => {
        group.click();
        await wait(20);
    });
    expect(requests.filter((item) => item.operation === "image")).toHaveLength(0);
    expect(local().runs).toHaveLength(0);
    expect(dom.document.body.textContent).toContain("「场景1」预检失败：浏览器无法准备布局参考");
    await edit((product) => {
        const plan = product.brief.templatePlan!;
        return { ...product, brief: { ...product.brief, useProofLayout: false, templatePlan: { ...plan, screens: plan.screens.map((screen, index) => (index === 1 ? { ...screen, subline: screen.headline } : screen)) } } };
    });
    expect(group.disabled).toBe(true);
    expect(button("先试首屏")?.disabled).toBe(false);
    await click("先试首屏");
    await settle(() => requests.some((item) => item.operation === "image"));
    expect(requests.filter((item) => item.operation === "image")).toHaveLength(1);
    expect(local().runs[0].shots).toHaveLength(3);
    expect(
        local()
            .runs[0].shots.slice(1)
            .every((shot) => !shot.attempts.length),
    ).toBe(true);
    expect(useStudioAnalysis.getState().running[saved.id]).toBeUndefined();
    expect(unexpected).toEqual([]);
}, 15000);
