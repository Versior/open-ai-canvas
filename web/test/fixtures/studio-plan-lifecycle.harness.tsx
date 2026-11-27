import { afterAll, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import "fake-indexeddb/auto";
import { canonicalize } from "json-canonicalize";
import type { GenerationTask, CreateTaskInput } from "@/services/api/task-center";
import type { StudioProduct } from "@/lib/ecommerce-studio/types";

const dom = new Window({ url: "http://localhost/studio", settings: { disableCSSFileLoading: true, disableJavaScriptFileLoading: true, disableComputedStyleRendering: true } });
for (const key of [
    "document",
    "navigator",
    "HTMLElement",
    "HTMLInputElement",
    "HTMLTextAreaElement",
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
const { apiClient, ApiError } = await import("@/services/api/request");
const { useConfigStore, createModelChannel, defaultConfig } = await import("@/stores/use-config-store");
const { useUserStore } = await import("@/stores/use-user-store");
const { setActiveUserScope } = await import("@/lib/user-scope");
const { defaultModelCapabilityConfig } = await import("@/lib/model-capabilities");
const { patchStudioDetailPlanScreen, STUDIO_DETAIL_PLAN_LIMITS, studioDetailPlanRoles } = await import("@/lib/ecommerce-studio/detail-plan");
const { parseDetailPlan } = await import("@/lib/ecommerce-studio/detail-plan-tasks");
const { createStudioProduct, studioShotPreview } = await import("@/lib/ecommerce-studio/product");
const { studioPlanningImages, studioPlanImageBindings } = await import("@/lib/ecommerce-studio/reference-selection");
const { studioActivePlan, studioRevisionPlan } = await import("@/lib/ecommerce-studio/runs");
const { studioGroupProgress } = await import("@/lib/ecommerce-studio/task-display");
const { useStudioRunner, useStudioAnalysis } = await import("@/pages/ecommerce-studio/use-studio-runner");
const { useStudioPlanProgress, studioPlanProgressKey } = await import("@/pages/ecommerce-studio/use-studio-plan-progress");
const { useStudioStore } = await import("@/pages/ecommerce-studio/use-studio-store");
const { StudioForm } = await import("@/pages/ecommerce-studio/studio-form");
const { StudioResults } = await import("@/pages/ecommerce-studio/studio-results");
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
useUserStore.setState({ user: { id: scope, username: "fixture", displayName: "测试", role: "user", status: "active" }, features: { ...useUserStore.getState().features, creditsEnabled: true, customChannelsEnabled: true } });
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
const purchaseQuestions = ["看清杯子外观", "展示握持方式", "核对杯口轮廓", "了解杯身与杯柄的连接", "理解杯子在桌面上的使用关系", "回顾杯口和手部的关系"];
const displayContents = ["杯子在木桌上", "手握杯柄", "杯沿的圆形开口", "杯柄接入杯身的部位", "杯子在餐具旁的相对位置", "手把杯口送到嘴边的动作"];
const transitionOut = "沿桌面的木纹从杯身引向杯柄";
const concept = "从一只暖瓷杯开始";
const artDirection = { visualWorld: "暖白瓷面和木桌的晨光形成温润对比", screenVariationPlan: "从杯身轮廓过渡到手指与把手接触的细节" };
const screens = (count: number) =>
    JSON.stringify({
        summary: `测试稿${count}`,
        ...(holdPlanStream || count === 6 ? { concept, artDirection } : {}),
        screens: Array.from({ length: count }, (_, index) => ({
            role: count === 6 ? (index === 0 ? "detail-hero" : index === count - 1 ? "detail-closing" : "detail-scene") : "detail-scene",
            title: `陶瓷杯页面${index + 1}`,
            purchaseQuestion: purchaseQuestions[index],
            displayContent: displayContents[index],
            evidence: count === 6 && index === 0 ? ["product:name"] : [],
            ...(index === 0 && count > 1 ? { transitionOut } : {}),
        })),
    });
let replyCount = 1;
let denyAcceptedSave = false;
let holdPlanStream = false;
let releasePlanStream: (() => void) | undefined;
const requests: CreateTaskInput[] = [];
const reads: string[] = [];
const unexpected: string[] = [];
const tasks = new Map<string, GenerationTask>();
const imageOperations = new Map<string, GenerationTask>();
let finishImages = false;
let loseImageReplyForScreen: number | undefined;
let heldImageRead: { screen: number; pending: Promise<void>; taskId?: string; signal?: AbortSignal } | undefined;
const edgeReads: string[] = [];
const edgeUploads: string[] = [];
const edgeDraws: Array<{ source: string; args: number[] }> = [];
const styleSource = "seller-long-reference";
const styleUploads: string[] = [];
const imageQuoteCounts: number[] = [];
const colors = new Map<string, { top: number; bottom: number }>();
Object.defineProperty(globalThis, "createImageBitmap", {
    configurable: true,
    value: async (blob: Blob) => {
        const source = await blob.text();
        return { width: source === styleSource ? 750 : 768, height: source === styleSource ? 9000 : 1024, source, close() {} };
    },
});
spyOn(dom.HTMLCanvasElement.prototype, "getContext").mockImplementation(function () {
    let sample = "";
    let bottom = false;
    return {
        drawImage(bitmap: ImageBitmap & { source: string }, ...args: number[]) {
            sample = bitmap.source;
            bottom = args[1] > 0;
            if (args.at(-1) === 512 || args.at(-1) === 103) edgeDraws.push({ source: bitmap.source, args });
        },
        createLinearGradient() {
            return { addColorStop() {} };
        },
        fillRect() {},
        clearRect() {},
        getImageData(_x: number, _y: number, width: number, height: number) {
            const color = colors.get(sample)?.[bottom ? "bottom" : "top"] ?? 200;
            return { data: Uint8ClampedArray.from({ length: width * height * 4 }, (_, index) => (index % 4 === 3 ? 255 : color)) };
        },
    } as unknown as CanvasRenderingContext2D;
});
spyOn(dom.HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => callback(new Blob(["edge fixture"], { type: "image/png" })));
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
    else if (path === "/model-catalog/quote" && method === "POST") {
        if (request.data.intent.capability === "image") imageQuoteCounts.push(request.data.intent.inputs.image);
        data = { quote: { logicalModelId: "", billingMode: "fixed_request", quantity: 1, amountMicrocredits: 1_000_000, estimated: false } };
    } else if (path === `/resources/${styleSource}` && method === "GET") data = { resource: { id: styleSource, kind: "image", status: "ready", width: 750, height: 9000 } };
    else if (path === "/resources/access" && method === "POST") {
        data = {
            items: request.data.map(({ resourceId, purpose }: { resourceId: string; purpose: string }) => {
                expect(purpose).toBe("ecommerce-export");
                return { access: { url: `/api/resources/${resourceId}/file`, delivery: "platform-local", refreshAt: new Date(Date.now() + 60_000).toISOString() } };
            }),
        };
    } else if (path === "/resources" && method === "POST") {
        expect(request.data.get("kind")).toBe("image");
        const key = String(request.headers?.["X-Idempotency-Key"]);
        if (key.startsWith(`commerce-ref-v1:${scope}:${styleSource}:`)) {
            const [, start, height] = key.match(/:(\d+):(\d+)$/)!;
            expect([request.data.get("width"), request.data.get("height")]).toEqual(["750", height]);
            expect(request.headers?.["X-Canvas-Expected-User"]).toBe(scope);
            styleUploads.push(`style-${start}-${height}`);
            data = { resource: { id: styleUploads.at(-1), kind: "image", status: "ready" } };
        } else {
            const [, version, source] = key.match(/^studio-detail-edge-(v5|v7):(.+)$/) || [];
            expect(source).toBeTruthy();
            expect([request.data.get("width"), request.data.get("height")]).toEqual(["768", version === "v7" ? "512" : "103"]);
            expect(edgeReads).toContain(source);
            edgeUploads.push(source);
            data = { resource: { id: `${version === "v7" ? "context" : "edge"}-${source}`, kind: "image", status: "ready" } };
        }
    } else if (path === "/tasks" && method === "POST") {
        const input = request.data as CreateTaskInput;
        const id = `fixture-task-${requests.push(input)}`;
        const image = input.operation === "image";
        const operation = input.idempotencyKey || "";
        const original = image ? imageOperations.get(operation) : undefined;
        const task: GenerationTask = {
            id,
            attempts: 1,
            type: input.type!,
            operation: input.operation,
            prompt: input.prompt,
            status: image ? (finishImages ? "succeeded" : "failed") : holdPlanStream ? "running" : "succeeded",
            inputJson: JSON.stringify({ metadata: input.input?.metadata }),
            ...(image ? (finishImages ? { resultJson: JSON.stringify({ images: [{ storageKey: `resource:output-${id}`, width: 768, height: 1024 }] }) } : { error: "fixture: image failed" }) : { resultJson: JSON.stringify({ text: screens(replyCount) }) }),
            createdAt: base.createdAt,
            updatedAt: base.createdAt,
        };
        if (original) data = original;
        else {
            tasks.set(id, task);
            if (image) {
                expect(operation).not.toBe("");
                imageOperations.set(operation, task);
                const screen = input.input?.metadata?.studioScreenIndex;
                if (heldImageRead?.screen === screen && !heldImageRead.taskId) heldImageRead.taskId = id;
                const attempt = saved.runs[0]?.shots[Number(screen) - 1]?.attempts.at(-1);
                const edge = input.input?.referenceImages?.at(attempt?.input?.styleWindow ? -2 : -1)?.storageKey;
                if (attempt?.input?.compiled.continuity) expect(edge).toBe(`resource:${attempt.input.compiled.continuity.reference?.resourceId}`);
                if (loseImageReplyForScreen === screen && typeof screen === "number") {
                    loseImageReplyForScreen = undefined;
                    throw new ApiError("fixture: reply lost", { status: 408 });
                }
            }
            data = { ...task, status: "queued", resultJson: "" };
        }
    } else if (path.startsWith("/tasks/fixture-task-")) {
        reads.push(path);
        const taskId = path.slice("/tasks/".length);
        if (heldImageRead?.taskId === taskId && !heldImageRead.signal && request.signal) {
            const hold = heldImageRead;
            hold.signal = request.signal as AbortSignal;
            await hold.pending;
        }
        data = tasks.get(taskId);
    } else {
        unexpected.push(path);
        throw new Error(`unexpected offline request ${path}`);
    }
    return { data: { code: 0, data, msg: "ok" }, status: 200, headers: {} };
}) as typeof apiClient.request;

const browserFetch = globalThis.fetch;
globalThis.fetch = (async (input, options) => {
    const path = String(input);
    if (path.startsWith("blob:")) return browserFetch(input, options);
    if (path.endsWith(`/resources/${styleSource}/file`)) {
        expect(options?.credentials).toBe("include");
        return new Response(new Blob([styleSource], { type: "image/png" }));
    }
    const image = path.match(/\/resources\/(output-fixture-task-\d+)\/file$/);
    if (image) {
        expect(options?.credentials).toBe("include");
        edgeReads.push(image[1]);
        return new Response(new Blob([image[1]], { type: "image/png" }));
    }
    const match = path.match(/\/tasks\/(fixture-task-\d+)\/text-events/);
    if (!match) throw new Error(`unexpected offline stream ${path}`);
    expect(options?.credentials).toBe("include");
    const task = tasks.get(match[1])!;
    const text = JSON.parse(task.resultJson || "{}").text || "";
    const event = (sequence: number, content: string) => `id: ${sequence}\nevent: delta\ndata: ${JSON.stringify({ sequence, content })}\n\n`;
    const held = holdPlanStream;
    return new Response(
        new ReadableStream({
            async start(controller) {
                if (held) {
                    const split = text.indexOf("},{") + 1;
                    controller.enqueue(new TextEncoder().encode(event(1, text.slice(0, split))));
                    await new Promise<void>((resolve) => {
                        releasePlanStream = resolve;
                    });
                    controller.enqueue(new TextEncoder().encode(event(2, text.slice(split))));
                    task.status = "succeeded";
                } else controller.enqueue(new TextEncoder().encode(event(1, text)));
                controller.enqueue(new TextEncoder().encode(`event: terminal\ndata: ${JSON.stringify({ status: task.status, finalText: text })}\n\n`));
                controller.close();
            },
        }),
        { headers: { "Content-Type": "text/event-stream" } },
    );
}) as typeof fetch;

const host = dom.document.body.appendChild(dom.document.createElement("div"));
let root = createRoot(host);
const client = new QueryClient();
let liveRunner: ReturnType<typeof useStudioRunner> | undefined;
let showResults = false;
function Panel() {
    const product = useStudioStore((state) => state.products[0]);
    const runner = useStudioRunner();
    liveRunner = runner;
    if (showResults) return <StudioResults product={product} runner={runner} imageModel={imageModel} edit={(fn, options) => void store().update(product.id, fn, options)} onView={() => {}} onReference={() => {}} />;
    return <StudioForm product={product} runner={runner} edit={(fn, options) => void store().update(product.id, fn, options)} ensure={() => product.id} onOutputChange={() => {}} onPlanning={() => {}} onGenerated={() => {}} />;
}
async function mountPanel() {
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
}
const local = () => store().products[0];
const button = (text: string) => [...dom.document.querySelectorAll("button")].find((item) => item.textContent.trim() === text);
const planPrimary = () => dom.document.querySelector<HTMLButtonElement>(".es-plan-workspace .es-form-foot .es-generate");
const footerEstimate = () => dom.document.querySelector('.es-plan-workspace .es-form-foot [aria-live="polite"]')?.textContent || "";
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

test("固定像素枚举的模型不提供自定义比例，旧草稿显示实际可出的预设", async () => {
    const previous = useConfigStore.getState().config;
    const previousRatio = saved.brief.ratio;
    const image = defaultModelCapabilityConfig("openai-image", "gpt-image-1").image!;
    const size = { parameter: "size" as const, default: "1024x1360", values: ["1024x1360"], allowCustom: false, presets: [{ tier: "1k" as const, ratio: "3:4", size: "1024x1360", width: 1024, height: 1360 }] };
    const model = createModelChannel({
        ...channel,
        modelCosts: channel.modelCosts?.map((cost) =>
            cost.capability === "image" ? { ...cost, capabilityConfig: { version: 1, image: { ...image, size, parameters: [{ name: "size", label: "画幅", type: "string", encoding: "pixels", values: size.values, default: size.default }] } } } : cost,
        ),
    });
    try {
        useConfigStore.setState({ config: { ...previous, channels: [model] } });
        await mountPanel();
        await edit((product) => ({ ...product, brief: { ...product.brief, ratio: "3:8" } }));
        const ratio = dom.document.querySelector('[role="combobox"][aria-label="比例"]');
        expect(ratio).not.toBeNull();
        expect(Boolean(dom.document.querySelector('[aria-label="自定义比例的宽"]'))).toBe(false);
        expect(ratio!.closest(".es-field")?.textContent).toContain("3:4");
        await act(async () => ratio!.dispatchEvent(new dom.KeyboardEvent("keydown", { key: "ArrowDown", keyCode: 40, bubbles: true })));
        await settle(() => Boolean(dom.document.querySelector(".ant-select-dropdown")));
        expect(dom.document.querySelector(".ant-select-dropdown")?.textContent).not.toContain("自定义");
    } finally {
        await edit((product) => ({ ...product, brief: { ...product.brief, ratio: previousRatio } }));
        await act(async () => useConfigStore.setState({ config: previous }));
    }
});

test("starred input, durable diagnostics, GET-only recovery, suite identity and first-screen charge boundary", async () => {
    await mountPanel();
    await pick(library[0]);
    expect(dom.document.querySelector('[role="combobox"][aria-label="平台"]')).not.toBeNull();
    await edit((product) => ({ ...product, photos: product.photos.map((photo) => ({ ...photo, truth: false })) }));
    expect(button("策划 2 屏")?.disabled).toBe(true);
    expect(dom.document.body.textContent).toContain("请点亮至少一张非吊牌商品图的星标");
    expect(requests).toHaveLength(0);
    await edit((product) => ({ ...product, photos: product.photos.map((photo) => ({ ...photo, truth: true })) }));
    await click("策划 2 屏");
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
    expect(requests[0].input?.metadata?.studioDetailContract).toBeUndefined();
    expect(studioActivePlan(local())).toBeUndefined();
    expect(local().planReceipt?.review?.length).toBe(1);
    await act(async () => {
        await store().load(true);
    });
    expect(dom.document.body.textContent).toContain("页面设计已完成 · 当前输入未应用");
    expect(local().planReceipt?.review?.[0]).toMatchObject({ index: 0, purpose: purchaseQuestions[0], headline: "", visual: displayContents[0] });
    expect(dom.document.querySelector('[aria-label="最近页面设计结果"]')?.textContent).toContain("画面构思：杯子在木桌上");
    const id = local().planReceipt!.taskId!;
    expect(dom.document.body.textContent).toContain(id);
    await edit((product) => ({ ...product, sellerNotes: "输入已变" }));
    expect(button("读取原任务结果（不重复计费）")?.disabled).toBe(true);
    await edit((product) => ({ ...product, sellerNotes: "" }));
    const originalInput = tasks.get(id)!.inputJson;
    tasks.get(id)!.inputJson = JSON.stringify({ metadata: { source: "ecommerce-studio", studioStep: "recognize", studioProductId: "different-product" } });
    await click("读取原任务结果（不重复计费）");
    expect(studioActivePlan(local())).toBeUndefined();
    expect(local().planReceipt?.message).toContain("不匹配");
    tasks.get(id)!.inputJson = originalInput;
    tasks.get(id)!.resultJson = JSON.stringify({ text: screens(2) });
    const queries = reads.length;
    denyAcceptedSave = true;
    await click("读取原任务结果（不重复计费）");
    await settle(() => local().planReceipt?.state === "accepted" && store().saveStates[saved.id] === "error");
    expect(saved.planReceipt?.state).not.toBe("accepted");
    expect(dom.document.body.textContent).toContain("页面设计已完成 · 已应用到当前商品");
    expect(dom.document.body.textContent).toContain("商品未保存到服务器：测试断开保存");
    denyAcceptedSave = false;
    await click("只重试保存（不扣费）");
    await settle(() => saved.planReceipt?.state === "accepted");
    expect(reads.length).toBeGreaterThan(queries);
    expect(requests).toHaveLength(1);
    expect(studioActivePlan(local())?.screens).toHaveLength(2);
    expect(dom.document.querySelector('[aria-label="整套美术方向"]')).toBeNull();
    expect(saved.planReceipt?.taskId).toBe(id);
    const original = local();
    expect(studioRevisionPlan({ ...original, brief: { ...original.brief, planNote: "调整光线" } })?.suiteId).toBe("s2");
    for (const patch of [{ source: "admin" as const }, { style: "替换同 ID 模板内容" }]) expect(studioRevisionPlan({ ...original, brief: { ...original.brief, suite: { ...original.brief.suite!, ...patch } } })).toBeUndefined();
    await pick(library[1]);
    expect(button("按补充调整重新策划")).toBeUndefined();
    replyCount = 3;
    await click("策划 3 屏");
    await settle(() => studioActivePlan(local())?.suiteId === "s3");
    expect(requests[1].prompt).not.toContain("【上一版策划】");
    expect(requests[1].prompt).toContain("陶瓷杯3屏");
    await edit((product) => {
        const brief = patchStudioDetailPlanScreen(product.brief, 1, { headline: "手握杯柄", subline: "手握杯柄" }, "templatePlan");
        return { ...product, brief: { ...brief, shotOrder: ["p2", "p0", "p1"] } };
    });
    const group = dom.document.querySelector<HTMLButtonElement>(".es-generate")!;
    expect(group.disabled).toBe(true);
    expect(button("先试首屏")?.disabled).toBe(false);
    expect(requests.filter((item) => item.operation === "image")).toHaveLength(0);
    await click("先试首屏");
    await settle(() => requests.some((item) => item.operation === "image"));
    const imageRequests = requests.filter((item) => item.operation === "image");
    expect(imageRequests).toHaveLength(1);
    expect(imageRequests[0]).toMatchObject({ input: { prompt: imageRequests[0].prompt, referenceImages: [{ storageKey: "resource:cup-resource" }] } });
    expect(imageRequests[0].prompt).toContain("淘宝 / 天猫");
    expect(imageRequests[0].prompt).toContain("详情页连续长图");
    expect(imageRequests[0].prompt).toContain("第 1/3 屏");
    expect(imageRequests[0].prompt).toContain(purchaseQuestions[2]);
    expect(imageRequests[0].prompt).toContain(displayContents[2]);
    expect(imageRequests[0].prompt).not.toContain(displayContents[1]);
    expect(imageRequests[0].prompt).toMatch(/标题|短文案|辅助语/);
    expect(local().runs[0].shots).toHaveLength(3);
    expect(
        local()
            .runs[0].shots.slice(1)
            .every((shot) => !shot.attempts.length),
    ).toBe(true);
    expect(useStudioAnalysis.getState().running[saved.id]).toBeUndefined();
    expect(unexpected).toEqual([]);
}, 15000);

test("a complete first-screen draft is visible before the same paid task finishes", async () => {
    holdPlanStream = true;
    replyCount = 6;
    let operation: ReturnType<NonNullable<typeof liveRunner>["plan"]> | undefined;
    const before = requests.length;
    try {
        await edit((product) => ({ ...product, brief: { ...product.brief, outputType: "detail-set", detailScreens: 6, detailPlan: undefined } }));
        await act(async () => {
            operation = liveRunner!.plan(saved.id, textModel);
            await wait(20);
        });
        await settle(() => useStudioPlanProgress.getState().items[studioPlanProgressKey(scope, saved.id)]?.screens.length === 1);
        const progress = useStudioPlanProgress.getState().items[studioPlanProgressKey(scope, saved.id)]!;
        expect(progress.phase).toBe("writing");
        expect(tasks.get(progress.taskId!)?.status).toBe("running");
        const panel = dom.document.querySelector('[aria-label="实时页面设计进度"]')!;
        expect(panel.textContent).toContain("正在策划第 2 屏");
        expect(panel.textContent).toContain("1 / 6 屏");
        expect(panel.querySelector(".es-plan-progress-direction p")?.textContent).toBe("测试稿6");
        expect(panel.textContent).not.toContain(concept);
        expect(panel.textContent).not.toContain(artDirection.visualWorld);
        expect(panel.querySelector(".es-plan-draft-list strong")?.textContent).toBe(purchaseQuestions[0]);
        expect(panel.querySelector(".es-plan-draft-list p")?.textContent).toBe(displayContents[0]);
        expect(panel.querySelector(".es-plan-draft-list details")?.textContent).toContain("陶瓷杯");
        expect(panel.textContent).not.toContain("product:name");
        expect(panel.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("1");
        expect(panel.querySelector('[role="progressbar"]')?.getAttribute("aria-valuemax")).toBe("6");
        expect(panel.textContent).not.toContain("草稿已就绪");
        expect(requests).toHaveLength(before + 1);
        await act(async () => {
            releasePlanStream!();
            await operation;
        });
        expect(local().planReceipt?.state).toBe("accepted");
        expect(useStudioPlanProgress.getState().items[studioPlanProgressKey(scope, saved.id)]?.phase).toBe("completed");
        expect(dom.document.querySelector('[aria-label="实时页面设计进度"]')).toBeNull();
        expect(requests).toHaveLength(before + 1);
    } finally {
        holdPlanStream = false;
        releasePlanStream?.();
    }
}, 10000);

test("editing the detail purchase question and display content updates the saved plan, preview and next image request", async () => {
    replyCount = 3;
    await edit((product) => ({ ...product, brief: { ...product.brief, outputType: "detail-set", detailScreens: 3, detailPlan: undefined, shotOrder: [], shotSkip: [] } }));
    await click("策划 3 屏");
    await settle(() => studioActivePlan(local())?.screens.length === 3);
    const oldTitle = studioActivePlan(local())!.screens[0].title;
    await act(async () => dom.document.querySelector<HTMLButtonElement>(`[aria-label="修改这一屏：${purchaseQuestions[0]}"]`)!.click());
    const input = dom.document.querySelector<HTMLInputElement>("#es-plan-p0-question")!;
    expect(input.value).toBe(purchaseQuestions[0]);
    expect(input.maxLength).toBe(STUDIO_DETAIL_PLAN_LIMITS.purpose);
    const editedQuestion = "杯身的曲面在桌上看起来是什么样？";
    const display = dom.document.querySelector<HTMLTextAreaElement>("#es-plan-p0-visual")!;
    const editedDisplay = "展示斜侧光下桌面与杯身的接触区域";
    await act(async () => {
        Object.getOwnPropertyDescriptor(dom.HTMLInputElement.prototype, "value")!.set!.call(input, editedQuestion);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        Object.getOwnPropertyDescriptor(dom.HTMLTextAreaElement.prototype, "value")!.set!.call(display, editedDisplay);
        display.dispatchEvent(new Event("input", { bubbles: true }));
        await store().flush(saved.id);
    });
    expect(saved.brief.detailPlan?.screens[0]).toMatchObject({ title: oldTitle, purchaseQuestion: editedQuestion, purpose: editedQuestion, displayContent: editedDisplay, copySource: "assistant" });
    expect(dom.document.querySelector(".es-storyboard-title strong")?.textContent).toBe(editedQuestion);
    await click("连续页面预览 · 3 屏");
    expect(dom.document.querySelector(".es-proof-brief-head strong")?.textContent).toBe(editedQuestion);
    await act(async () => dom.document.querySelector<HTMLButtonElement>(".ant-modal-close")!.click());
    const before = requests.length;
    await click("先试首屏");
    await settle(() => requests.length > before && !dom.document.querySelector(".es-generate.ant-btn-loading"));
    expect(requests.slice(before)).toHaveLength(1);
    expect(requests[before].operation).toBe("image");
    expect(requests[before].prompt).toContain(editedQuestion);
    expect(requests[before].prompt).toContain(editedDisplay);
    expect(requests[before].prompt).not.toContain(purchaseQuestions[0]);
    expect(local().runs[0].shots[0].purchaseQuestion).toBe(editedQuestion);
    expect(unexpected).toEqual([]);
}, 10000);

test("确认前逐屏展开实际匹配的卖家参考，不把设计案例混进实拍依据或启动生成", async () => {
    const original = local();
    const before = requests.length;
    try {
        await edit((product) => {
            const references = ["场景参考", "纹理参考"].map((name, index) => ({ ...product.photos[0], id: `design-${index}`, resourceId: `style-${index}`, name, view: "other" as const, truth: false }));
            const draft = { ...product, references, brief: { ...product.brief, sameLayout: false, detailScreens: 3, outputType: "detail-set" as const, shotOrder: [], shotSkip: [] } };
            const selected = studioPlanningImages(draft, 3);
            const screens = ["图3", "图2", undefined].map((styleReference, index) => ({ role: index ? "detail-scene" : "detail-hero", purchaseQuestion: purchaseQuestions[index], displayContent: displayContents[index], styleReference }));
            draft.brief.detailPlan = parseDetailPlan(
                JSON.stringify({ screens }),
                draft,
                studioDetailPlanRoles(draft),
                { id: "selected-designs", model: textModel, createdAt: "" },
                { scope: "detail", images: { photos: 1, references: 2, ...studioPlanImageBindings(selected, false) } },
            ).plan;
            return draft;
        });
        await click("连续页面预览 · 3 屏");
        const rows = [...dom.document.querySelectorAll(".es-proof-item")];
        expect(rows.map((row) => row.querySelector('a[aria-label*="设计参考"]')?.getAttribute("href"))).toEqual(["/api/resources/style-1/file", "/api/resources/style-0/file", undefined]);
        expect(rows[0].querySelector('a[aria-label*="设计参考"] img')?.getAttribute("alt")).toContain("纹理参考");
        expect(rows[2].textContent).not.toContain("设计参考");
        expect(requests.slice(before)).toHaveLength(0);
    } finally {
        await act(async () => dom.document.querySelector<HTMLButtonElement>(".ant-modal-close")?.click());
        await edit((product) => ({ ...product, references: original.references, brief: original.brief }));
    }
}, 10000);

for (const firstOnly of [false, true]) {
    test(
        firstOnly ? "策划六屏后需点击先试首屏，只提交第 1/6 屏" : "策划六屏后需确认，才提交六张不同的详情屏",
        async () => {
            replyCount = 6;
            await edit((product) => ({
                ...product,
                planReceipt: undefined,
                brief: { ...product.brief, outputType: "detail-set", suite: undefined, detailPlan: undefined, detailScreens: 6, shotOrder: [], shotSkip: [] },
            }));
            const before = requests.length;
            const runsBefore = local().runs.length;
            const primary = planPrimary();
            const initialLabel = primary?.textContent.trim();
            const earlyTrial = button("先试首屏");
            expect(primary?.disabled).toBe(false);
            await settle(() => footerEstimate().includes("策划：1 积分"));
            expect(footerEstimate()).not.toMatch(/出图|首屏：/);
            await act(async () => primary!.click());
            await settle(() => saved.planReceipt?.state === "accepted" && !planPrimary()?.classList.contains("ant-btn-loading"));
            const [plan] = requests.slice(before);
            expect(plan.input?.metadata).toMatchObject({ studioStep: "plan", studioPlanKind: "detail", studioPlanCount: 6, studioDetailContract: 3 });
            expect(requests.slice(before).map((request) => request.operation)).toEqual(["text"]);
            expect(local().runs).toHaveLength(runsBefore);
            expect(initialLabel).toBe("策划 6 屏");
            expect(earlyTrial).toBeUndefined();
            expect(studioActivePlan(local())?.screens).toHaveLength(6);
            expect(studioActivePlan(local())?.capacityDiagnostics?.missingEvidence.length).toBeGreaterThan(0);
            expect(dom.document.querySelectorAll('[aria-label="页面清单"] > li')).toHaveLength(6);
            expect(footerEstimate()).toContain("出图 ×6：");
            expect(footerEstimate()).not.toContain("策划：");
            expect([...dom.document.querySelectorAll(".es-storyboard-title strong")].map((element) => element.textContent)).toEqual(purchaseQuestions);
            expect([...dom.document.querySelectorAll(".es-storyboard-text > p")].map((element) => element.textContent)).toEqual(displayContents);
            if (!firstOnly) {
                await click("连续页面预览 · 6 屏");
                const preview = dom.document.querySelector('[aria-label="逐屏内容预览"]')!;
                expect([...preview.querySelectorAll(".es-proof-brief-head strong")].map((element) => element.textContent)).toEqual(purchaseQuestions);
                expect([...preview.querySelectorAll(".es-proof-brief-content")].map((element) => element.textContent)).toEqual(displayContents);
                expect(preview.querySelector(".es-proof-brief-body")?.textContent).toContain("依据陶瓷杯");
                expect(preview.querySelector(".es-proof-brief-body")?.textContent).toContain(transitionOut);
                expect(preview.textContent).not.toContain("product:name");
                await act(async () => dom.document.querySelector<HTMLButtonElement>(".ant-modal-close")!.click());
            }
            expect(dom.document.querySelector('[aria-label="整套美术方向"]')).toBeNull();
            expect(dom.document.querySelector(".es-plan-review-summary")?.textContent).toBe("测试稿6");
            expect(dom.document.querySelector(".es-plan-workspace")?.textContent).not.toContain(concept);
            expect(dom.document.querySelector(".es-plan-adjust")?.textContent).toContain("可补充的商品资料");
            expect(dom.document.querySelector(".es-plan-scroll")?.textContent).not.toContain("无字实拍");
            const count = firstOnly ? 1 : 6;
            const readsBefore = edgeReads.length;
            const uploadsBefore = edgeUploads.length;
            finishImages = true;
            try {
                await click(firstOnly ? "先试首屏" : "确认生成 · 6 屏");
                await settle(() => local().runs[0].shots.filter((shot) => shot.attempts.at(-1)?.status === "succeeded").length === count && !planPrimary()?.classList.contains("ant-btn-loading"));
            } finally {
                finishImages = false;
            }
            const shots = local().runs[0].shots;
            const images = requests.slice(before + 1);
            expect(images).toHaveLength(count);
            expect(dom.document.querySelector('[role="dialog"]')).toBeNull();
            expect(shots.map((shot) => shot.attempts.length)).toEqual(firstOnly ? [1, 0, 0, 0, 0, 0] : [1, 1, 1, 1, 1, 1]);
            const previousOutputs = shots.slice(0, count - 1).map((shot) => shot.attempts[0].outputs[0].resourceId);
            expect(edgeReads.slice(readsBefore)).toEqual(previousOutputs);
            expect(edgeUploads.slice(uploadsBefore)).toEqual(previousOutputs);
            expect(edgeDraws.slice(readsBefore)).toEqual(previousOutputs.map((source) => ({ source, args: [0, 512, 768, 512, 0, 0, 768, 512] })));
            images.forEach((image, index) => {
                const expectedReferences = ["resource:cup-resource", ...(index > 0 ? [`resource:context-${previousOutputs[index - 1]}`] : [])];
                expect(image.operation).toBe("image");
                expect(image.input?.prompt).toBe(image.prompt);
                expect(image.input?.referenceImages?.map((reference: { storageKey: string }) => reference.storageKey)).toEqual(expectedReferences);
                expect(image.input?.metadata).toMatchObject({ studioDetailContract: 3, studioUseDesignKnowledge: true });
                expect(image.prompt).toContain("淘宝 / 天猫");
                expect(image.prompt).toContain("详情页连续长图");
                expect(image.prompt).toContain(`第 ${index + 1}/6 屏`);
                expect(image.prompt).toContain(purchaseQuestions[index]);
                expect(image.prompt).toContain(displayContents[index]);
                expect(image.prompt).toMatch(/必须.*(?:短文案|短标题)/);
                expect(image.prompt).toMatch(/所有新增文字[^。]*尺寸标注[^。]*只用简体中文/);
                expect(image.prompt).not.toContain(displayContents[(index + 1) % 6]);
                if (index > 0) expect(image.prompt).toContain("图2是上一屏已生成的下半幅");
                expect(image.prompt.includes(transitionOut)).toBe(index < 2);
            });
            expect(unexpected).toEqual([]);
        },
        15000,
    );
}

test("上一屏失败时后续等待，补齐后续画，刷新沿用已保存的衔接图与原请求号", async () => {
    replyCount = 3;
    await edit((product) => ({ ...product, brief: { ...product.brief, detailScreens: 3, shotOrder: [], shotSkip: [], detailPlan: undefined } }));
    await click("策划 3 屏");
    await settle(() => Boolean(button("确认生成 · 3 屏")));
    const before = requests.length;
    const beforeUploads = edgeUploads.length;
    const beforeRead = edgeReads.length;
    await click("确认生成 · 3 屏");
    const shots = () => local().runs[0].shots;
    await settle(() => shots()[0].attempts[0]?.status === "failed");
    expect(requests.slice(before)).toHaveLength(1);
    expect(studioGroupProgress(shots(), {}).screens.map(({ label }) => label)).toEqual(["生成失败", "等第 1 屏", "等第 2 屏"]);
    expect(edgeUploads).toHaveLength(beforeUploads);
    const waitingIds = shots()
        .slice(1)
        .map((shot) => shot.attempts[0].id);

    finishImages = true;
    loseImageReplyForScreen = 2;
    try {
        await act(async () => {
            await liveRunner!.rerun(saved.id, { runId: local().runs[0].id }, [shots()[0].id, shots()[1].id, shots()[2].id], imageModel);
        });
        await settle(() => shots()[1].attempts[0]?.error?.includes("待核对") === true);
        await act(async () => store().flush(saved.id));
        expect(requests.slice(before).map((request) => request.input?.metadata?.studioScreenIndex)).toEqual([1, 1, 2]);
        const priorRequest = requests.at(-1)!;
        const uploaded = edgeUploads.slice(beforeUploads);
        expect(uploaded).toEqual([shots()[0].attempts[1].outputs[0].resourceId]);

        await act(async () => root.unmount());
        root = createRoot(host);
        await mountPanel();
        expect(shots()[1].attempts[0].input?.compiled.continuity?.reference?.resourceId).toBe(`context-${uploaded[0]}`);
        expect(shots()[1].attempts[0].input?.compiled.continuity).toMatchObject({ guide: "context", anchor: { sourceResourceId: uploaded[0] } });
        expect(shots()[1].attempts[0].input?.compiled.continuity?.anchor).not.toHaveProperty("height");
        expect(studioGroupProgress(shots(), {}).screens[2].label).toBe("等第 2 屏");
        await act(async () => liveRunner!.resume(local()));
        await settle(() => shots()[2].attempts[0]?.status === "succeeded");
        expect(requests.slice(before).map((request) => request.input?.metadata?.studioScreenIndex)).toEqual([1, 1, 2, 2, 3]);
        expect(requests.at(-2)).toEqual(priorRequest);
        expect(
            shots()
                .slice(1)
                .map((shot) => shot.attempts[0].id),
        ).toEqual(waitingIds);
        expect(edgeReads.slice(beforeRead)).toEqual([uploaded[0], shots()[1].attempts[0].outputs[0].resourceId]);
        expect(edgeUploads.slice(beforeUploads)).toEqual(edgeReads.slice(beforeRead));
        expect(unexpected).toEqual([]);
    } finally {
        finishImages = false;
        loseImageReplyForScreen = undefined;
    }
}, 15000);

test("退出时旧轮询还没有结束，返回仍接回原任务并继续下一屏，不重复提交", async () => {
    replyCount = 3;
    await edit((product) => ({ ...product, brief: { ...product.brief, detailScreens: 3, detailPlan: undefined, shotOrder: [], shotSkip: [] } }));
    await click("策划 3 屏");
    await settle(() => Boolean(button("确认生成 · 3 屏")));
    const before = requests.length;
    const pending = Promise.withResolvers<void>();
    const read: NonNullable<typeof heldImageRead> = { screen: 2, pending: pending.promise };
    const shots = () => local().runs[0].shots;
    finishImages = true;
    heldImageRead = read;
    try {
        await click("确认生成 · 3 屏");
        await settle(() => Boolean(read.signal) && shots()[1].attempts[0]?.taskId === read.taskId);
        await act(async () => store().flush(saved.id));
        const second = shots()[1].attempts[0];
        expect(second.outputs).toHaveLength(0);
        expect(requests.slice(before).map((request) => request.input?.metadata?.studioScreenIndex)).toEqual([1, 2]);

        await act(async () => root.unmount());
        expect(read.signal?.aborted).toBe(true);
        root = createRoot(host);
        await mountPanel();
        await act(async () => liveRunner!.resume(local()));
        await settle(() => shots()[2].attempts[0]?.status === "succeeded");
        await act(async () => store().flush(saved.id));
        expect(saved.runs[0].shots[1].attempts).toEqual([expect.objectContaining({ id: second.id, taskId: second.taskId, status: "succeeded" })]);
        expect(requests.slice(before).map((request) => request.input?.metadata?.studioScreenIndex)).toEqual([1, 2, 3]);
        expect(reads.filter((path) => path === `/tasks/${second.taskId}`)).toHaveLength(2);
    } finally {
        await act(async () => pending.resolve());
        heldImageRead = undefined;
        finishImages = false;
    }
}, 10000);

test("确认后实际提交长参考局部，报价计入局部和接边；丢回执刷新不重新裁切", async () => {
    replyCount = 3;
    const originalConfig = useConfigStore.getState().config;
    const metered = createModelChannel({ ...channel, modelCosts: channel.modelCosts?.map((cost) => (cost.capability === "image" ? { ...cost, billingMode: "image_usage" } : cost)) });
    await act(async () => useConfigStore.setState({ config: { ...originalConfig, channels: [metered] } }));
    const uploadsBefore = styleUploads.length;
    const quotesBefore = imageQuoteCounts.length;
    const requestsBefore = requests.length;
    await edit((product) => ({
        ...product,
        references: [{ id: styleSource, resourceId: styleSource, name: "卖家长参考", width: 750, height: 9000, view: "other", truth: false, url: "", addedAt: base.createdAt }],
        brief: { ...product.brief, sameLayout: false, detailScreens: 3, detailPlan: undefined, shotOrder: [], shotSkip: [] },
    }));
    finishImages = true;
    loseImageReplyForScreen = 2;
    try {
        await click("策划 3 屏");
        await settle(() => Boolean(button("确认生成 · 3 屏")));
        expect(imageQuoteCounts.slice(quotesBefore)).toEqual(expect.arrayContaining([3, 4]));
        expect(requests.slice(requestsBefore).map((request) => request.operation)).toEqual(["text"]);
        expect(styleUploads.slice(uploadsBefore)).toEqual([]);
        await click("确认生成 · 3 屏");
        const shots = () => local().runs[0].shots;
        await settle(() => shots()[1].attempts[0]?.error?.includes("待核对") === true);
        await act(async () => store().flush(saved.id));
        const secondRequest = requests.at(-1)!;
        const submitted = saved.runs[0].shots[1].attempts[0];
        const expected = (index: number) => ["resource:cup-resource", `resource:${styleSource}`, ...(index > 0 ? [`resource:context-${shots()[index - 1].attempts[0].outputs[0].resourceId}`] : []), `resource:${styleUploads[uploadsBefore + index]}`];
        const keys = (request: CreateTaskInput) => request.input?.referenceImages?.map(({ storageKey }: { storageKey: string }) => storageKey);
        expect(styleUploads.slice(uploadsBefore)).toHaveLength(2);
        expect(keys(requests.at(-2)!)).toEqual(expected(0));
        expect(keys(secondRequest)).toEqual(expected(1));
        expect(secondRequest.prompt).toContain("图4是图2的设计局部");
        expect(submitted.input?.styleWindow?.resourceId).toBe(styleUploads.at(-1));
        await act(async () => root.unmount());
        root = createRoot(host);
        await mountPanel();
        await act(async () => liveRunner!.resume(local()));
        await settle(() => shots()[2].attempts[0]?.status === "succeeded");
        expect(requests.at(-2)).toEqual(secondRequest);
        expect(keys(requests.at(-1)!)).toEqual(expected(2));
        const uploads = styleUploads.slice(uploadsBefore);
        expect(uploads).toHaveLength(3);
        expect(new Set(uploads).size).toBe(3);
        expect(shots()[2].attempts[0].input?.styleWindow?.bottom).toBe(1);
        expect(unexpected).toEqual([]);
    } finally {
        finishImages = false;
        loseImageReplyForScreen = undefined;
        await act(async () => useConfigStore.setState({ config: originalConfig }));
        await edit((product) => ({ ...product, references: [] }));
    }
}, 10000);

test("接边精修丢回执时刷新重放同一请求；保留原图，查看两侧后才采用候选", async () => {
    replyCount = 3;
    await edit((product) => ({ ...product, brief: { ...product.brief, detailScreens: 3, detailPlan: undefined, shotOrder: [], shotSkip: [] } }));
    await click("策划 3 屏");
    await settle(() => Boolean(button("确认生成 · 3 屏")));
    const shots = () => local().runs[0].shots;
    finishImages = true;
    try {
        await click("确认生成 · 3 屏");
        await settle(() => shots().every((shot) => studioShotPreview(shot)));
        await edit((product) => ({ ...product, runs: product.runs.slice(0, 1) }));
        const original = shots().map((shot) => studioShotPreview(shot)!.resourceId);
        colors.set(original[0], { top: 155, bottom: 155 });
        colors.set(original[1], { top: 225, bottom: 225 });
        colors.set(original[2], { top: 225, bottom: 225 });
        const reopen = async () => {
            await act(async () => root.unmount());
            root = createRoot(host);
            await mountPanel();
            await click("预览整页");
        };
        showResults = true;
        const before = requests.length;
        await reopen();
        await settle(() => Boolean(button("精修第 2 屏")));
        expect(button("精修第 3 屏")).toBeUndefined();
        const selector = () => dom.document.querySelector<HTMLSelectElement>('.es-delivery-reading select[aria-label="选择接边"]')!;
        expect([...selector().options].map((option) => option.textContent)).toEqual(["1→2 屏 · 未检出像素衔接", "2→3 屏 · 仅背景色接近"]);
        const locate = () => dom.document.querySelector<HTMLButtonElement>(".es-delivery-join button[aria-controls]")!;
        const marker = () => dom.document.getElementById(locate().getAttribute("aria-controls")!)!;
        const select = async (index: number) =>
            act(async () => {
                selector().value = String(index);
                selector().dispatchEvent(new dom.Event("change", { bubbles: true }));
            });
        const firstMarker = marker();
        const secondMarker = dom.document.querySelectorAll<HTMLElement>(".es-delivery-boundary")[1];
        const firstScroll = spyOn(firstMarker, "scrollIntoView");
        const secondScroll = spyOn(secondMarker, "scrollIntoView");
        await act(async () => locate().click());
        expect(firstScroll).toHaveBeenCalledWith({ block: "center", inline: "nearest", behavior: "instant" });
        await select(2);
        expect(marker()).toBe(secondMarker);
        expect(secondMarker.previousElementSibling?.tagName).toBe("IMG");
        expect(secondMarker.nextElementSibling?.tagName).toBe("IMG");
        expect(secondScroll).toHaveBeenCalledTimes(1);
        expect(button("精修第 2 屏")).toBeUndefined();
        expect(button("精修第 3 屏")).toBeUndefined();
        await select(1);
        expect(marker()).toBe(firstMarker);
        expect(firstScroll).toHaveBeenCalledTimes(2);
        expect(button("精修第 2 屏")).toBeDefined();
        firstScroll.mockRestore();
        secondScroll.mockRestore();
        expect(requests).toHaveLength(before);
        const beforeUploads = edgeUploads.length;
        loseImageReplyForScreen = 2;
        await click("精修第 2 屏");
        await settle(() => shots()[1].attempts.at(-1)?.error?.includes("待核对") === true);
        const submitted = shots()[1].attempts.at(-1)!;
        expect(submitted.taskId).toBeUndefined();
        expect(submitted.input?.compiled.continuity?.reference?.resourceId).toBe(`edge-${original[0]}`);
        const request = requests.at(-1)!;
        expect(requests).toHaveLength(before + 1);
        expect(request.input?.metadata?.studioScreenIndex).toBe(2);
        expect(request.input?.referenceImages?.map(({ storageKey }: { storageKey: string }) => storageKey)).toEqual(["resource:cup-resource", `resource:${original[1]}`, `resource:edge-${original[0]}`]);
        expect(shots().map((shot) => studioShotPreview(shot)!.resourceId)).toEqual(original);

        await act(async () => store().flush(saved.id));
        await reopen();
        await act(async () => liveRunner!.resume(local()));
        await settle(() => Boolean(button("预览候选")));
        const repair = shots()[1].attempts.at(-1)!;
        const candidate = repair.outputs[0].resourceId;
        colors.set(candidate, { top: 155, bottom: 225 });
        expect(requests.slice(before)).toEqual([request, request]);
        expect(repair.id).toBe(submitted.id);
        expect(repair.taskId).toBe(imageOperations.get(request.idempotencyKey!)?.id);
        expect(repair.input?.compiled.continuity).toMatchObject({ repair: true, anchor: { sourceResourceId: original[0] } });
        expect(edgeUploads.slice(beforeUploads)).toEqual([original[0]]);
        await click("预览候选");
        await settle(() => button("采用第 2 屏候选")?.disabled === false);
        const comparisonStatus = dom.document.querySelector('.es-delivery-reading [role="status"]')?.textContent;
        expect(comparisonStatus).toContain("1→2 屏");
        expect(comparisonStatus).toContain("2→3 屏");
        expect(comparisonStatus).not.toContain("未检出像素衔接");
        expect(studioShotPreview(shots()[1])?.resourceId).toBe(original[1]);
        await click("采用第 2 屏候选");
        await settle(() => studioShotPreview(shots()[1])?.resourceId === candidate);
        expect(shots().map((shot) => studioShotPreview(shot)!.resourceId)).toEqual([original[0], candidate, original[2]]);
        expect(requests).toHaveLength(before + 2);
        expect(unexpected).toEqual([]);
    } finally {
        colors.clear();
        finishImages = false;
        loseImageReplyForScreen = undefined;
        showResults = false;
        await act(async () => root.unmount());
        root = createRoot(host);
        await mountPanel();
    }
}, 15000);

test("旧版详情策划保留但不可直接出图，有补充要求也从新版策划开始", async () => {
    replyCount = 6;
    const oldQuestion = "旧版用同一张手托照只核对商品标识";
    const sellerNote = "保留杯沿和把手的真实形状";
    await edit((product) => {
        const current: StudioProduct = { ...product, brief: { ...product.brief, outputType: "detail-set", detailScreens: 6, planNote: sellerNote, shotOrder: [], shotSkip: [] } };
        const oldPlan = parseDetailPlan(screens(6), current, studioDetailPlanRoles(current), { id: "previous-detail-contract", model: textModel, createdAt: base.createdAt }, { scope: "detail" }).plan;
        const signature = JSON.parse(oldPlan.inputSignature!);
        delete signature.studioDetailContract;
        oldPlan.inputSignature = canonicalize(signature);
        oldPlan.screens[0].purchaseQuestion = oldQuestion;
        return {
            ...current,
            planReceipt: { scope: "detail", state: "accepted", inputSignature: oldPlan.inputSignature, model: textModel, createdAt: base.createdAt, attemptId: oldPlan.id },
            brief: { ...current.brief, detailPlan: oldPlan },
        };
    });
    const before = requests.length;
    const history = local().runs;
    expect(history.length).toBeGreaterThan(0);
    await act(async () => {
        await store().load(true);
    });
    expect(local().brief.detailPlan?.screens[0].purchaseQuestion).toBe(oldQuestion);
    expect(studioActivePlan(local())).toBeUndefined();
    expect(dom.document.querySelector('[aria-label="最近页面设计结果"] strong')?.textContent).toBe("历史策划 · 不用于当前出图");
    expect(button("确认生成 · 6 屏")).toBeUndefined();
    expect(button("先试首屏")).toBeUndefined();
    await expect(liveRunner!.generate(saved.id, imageModel, { confirmedPlanId: "previous-detail-contract" })).rejects.toThrow("请查看当前页面清单");
    expect(requests).toHaveLength(before);

    await click("策划 6 屏");
    await settle(() => saved.planReceipt?.state === "accepted" && saved.planReceipt.attemptId !== "previous-detail-contract" && Boolean(button("确认生成 · 6 屏")));
    expect(requests.slice(before).map((request) => request.operation)).toEqual(["text"]);
    expect(requests[before].prompt).toContain(sellerNote);
    expect(requests[before].prompt).not.toContain(oldQuestion);
    expect(requests[before].input?.metadata).toMatchObject({ studioDetailContract: 3, studioPlanCount: 6 });
    expect(local().runs).toEqual(history);
    expect(unexpected).toEqual([]);
}, 10000);

test("改屏数或重置参数后，旧的详情页确认不能提交图片", async () => {
    replyCount = 6;
    await edit((product) => ({
        ...product,
        planReceipt: undefined,
        brief: { ...product.brief, outputType: "detail-set", detailPlan: undefined, detailScreens: 6, planNote: "保留杯沿和把手的真实形状" },
    }));
    const before = requests.length;
    const runsBefore = local().runs.length;
    await click("策划 6 屏");
    await settle(() => saved.planReceipt?.state === "accepted" && Boolean(button("确认生成 · 6 屏")));
    const oldTask = saved.planReceipt!.taskId;

    const count = dom.document.querySelector<HTMLInputElement>('[role="combobox"][aria-label="详情屏数"]')!;
    await act(async () => count.dispatchEvent(new dom.MouseEvent("mousedown", { bubbles: true })));
    const option = [...dom.document.querySelectorAll<HTMLElement>(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option")].find((item) => item.textContent.trim() === "3 屏");
    expect(option).toBeDefined();
    await act(async () => option!.click());
    expect(planPrimary()?.textContent.trim()).toBe("策划 3 屏");
    expect(button("确认生成 · 6 屏")).toBeUndefined();
    expect(button("先试首屏")).toBeUndefined();

    replyCount = 3;
    await click("策划 3 屏");
    await settle(() => saved.planReceipt?.state === "accepted" && saved.planReceipt.taskId !== oldTask && Boolean(button("确认生成 · 3 屏")));
    expect(requests.slice(before).map((request) => [request.operation, request.input?.metadata?.studioPlanCount])).toEqual([
        ["text", 6],
        ["text", 3],
    ]);
    expect(dom.document.querySelectorAll('[aria-label="页面清单"] > li')).toHaveLength(3);

    await click("重置参数");
    await click("详情页");
    expect(planPrimary()?.textContent.trim()).toBe("策划 3 屏");
    expect(button("确认生成 · 3 屏")).toBeUndefined();
    expect(button("先试首屏")).toBeUndefined();
    expect(requests.slice(before)).toHaveLength(2);
    expect(local().runs).toHaveLength(runsBefore);
    expect(unexpected).toEqual([]);
}, 10000);

test("单张商品图保留一键策划并生成；明确跳过策划的模板仍可直接生成", async () => {
    replyCount = 1;
    await edit((product) => ({
        ...product,
        planReceipt: undefined,
        brief: { ...base.brief, outputType: "white" },
    }));
    const before = requests.length;
    await click("AI 策划并生成 1 张");
    await settle(() => requests.length >= before + 2);
    expect(requests.slice(before).map((request) => request.operation)).toEqual(["text", "image"]);
    expect(requests[before].input?.metadata).toMatchObject({ studioPlanScope: "single", studioPlanCount: 1 });
    expect(requests[before + 1].input?.referenceImages).toMatchObject([{ storageKey: "resource:cup-resource" }]);
    expect(dom.document.querySelector('[role="dialog"]')).toBeNull();

    await pick(library[0]);
    const beforeTemplate = requests.length;
    await click("不策划，按模板直接生成");
    await settle(() => requests.length >= beforeTemplate + 2);
    expect(requests.slice(beforeTemplate).map((request) => request.operation)).toEqual(["image", "image"]);
    expect(dom.document.querySelector('[role="dialog"]')).toBeNull();
    expect(unexpected).toEqual([]);
}, 10000);
