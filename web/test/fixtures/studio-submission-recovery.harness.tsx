import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import "fake-indexeddb/auto";
import type { StudioProduct } from "@/lib/ecommerce-studio/types";
import type { CreateTaskInput, GenerationTask } from "@/services/api/task-center";

const dom = new Window({ url: "http://localhost:3000/studio", settings: { disableCSSFileLoading: true, disableJavaScriptFileLoading: true, disableComputedStyleRendering: true } });
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
const { MemoryRouter, createMemoryRouter, RouterProvider } = await import("react-router");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { App, ConfigProvider } = await import("antd");
const { ApiError, http } = await import("@/services/api/request");
const { useConfigStore, createModelChannel, defaultConfig } = await import("@/stores/use-config-store");
const { useUserStore } = await import("@/stores/use-user-store");
const { setActiveUserScope } = await import("@/lib/user-scope");
const { defaultModelCapabilityConfig } = await import("@/lib/model-capabilities");
const { createStudioProduct, normalizeStudioProduct } = await import("@/lib/ecommerce-studio/product");
const { studioDetailPlanRoles } = await import("@/lib/ecommerce-studio/detail-plan");
const { parseDetailPlan } = await import("@/lib/ecommerce-studio/detail-plan-tasks");
const { studioImageInput, studioLocateRunShot } = await import("@/lib/ecommerce-studio/generation-input");
const { createStudioRun } = await import("@/lib/ecommerce-studio/runs");
const { studioGroupProgress } = await import("@/lib/ecommerce-studio/task-display");
const { useStudioRunner } = await import("@/pages/ecommerce-studio/use-studio-runner");
const { useStudioStore } = await import("@/pages/ecommerce-studio/use-studio-store");
const { StudioForm } = await import("@/pages/ecommerce-studio/studio-form");
const { mockEcommerceImageDelivery } = await import("../helpers/ecommerce-media-fixture");
const generationApi = await import("@/services/api/generation-task");
const quotes = await import("@/services/api/logical-models");
const resourceApi = await import("@/services/api/resources");
const studioApi = await import("@/services/api/ecommerce-studio");
const taskApi = await import("@/services/api/task-center");

const textModel = "fixture::qwen-test";
const imageModel = "fixture::gpt-image-1";
const textConfig = defaultModelCapabilityConfig("newapi-chat", "qwen-test");
textConfig.text!.references.maxImages = 2;
const channel = createModelChannel({
    id: "fixture",
    scope: "system",
    models: ["qwen-test", "gpt-image-1"],
    modelCosts: [
        { model: "qwen-test", capability: "text", protocol: "newapi-chat", capabilityConfig: textConfig, billingMode: "fixed_request", unitPriceMicrocredits: 1_000_000 },
        { model: "gpt-image-1", capability: "image", protocol: "openai-image", billingMode: "fixed_request", unitPriceMicrocredits: 1_000_000 },
    ],
});
const config = { ...defaultConfig, channels: [channel], model: imageModel, textModel, textModels: [textModel], imageModel, imageModels: [imageModel] };
const now = "2026-01-01T00:00:00Z";
const store = useStudioStore.getState;
const current = () => store().products[0];
let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;
let client: InstanceType<typeof QueryClient>;

beforeEach(() => {
    const scope = crypto.randomUUID();
    setActiveUserScope(scope);
    useUserStore.setState({ user: { id: scope, username: "fixture", displayName: "测试", role: "user", status: "active" }, features: { ...useUserStore.getState().features, creditsEnabled: true, customChannelsEnabled: true } });
    useConfigStore.setState({ config });
    mockEcommerceImageDelivery();
    host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(async () => {
    await act(async () => root.unmount());
    client.clear();
    host.remove();
    mock.restore();
});
afterAll(() => dom.happyDOM.abort());

function productWithPhoto(id: string) {
    const product = createStudioProduct(id, now);
    product.photos.push({ id: "cup", resourceId: "cup", url: "", view: "front", truth: true, addedAt: now });
    return product;
}

function runningTask(id: string): GenerationTask {
    return { id, projectId: "", type: "canvas_text", status: "running", prompt: "", attempts: 1, createdAt: now, updatedAt: now };
}

function StudioHarness() {
    const product = useStudioStore((state) => state.products[0]);
    const runner = useStudioRunner();
    return <StudioForm product={product} edit={(change, options) => store().update(product.id, change, options)} ensure={() => product.id} runner={runner} onPlanning={() => undefined} onGenerated={() => undefined} />;
}

async function press(text: string) {
    const button = Array.from(host.querySelectorAll("button")).find((entry) => entry.textContent?.trim() === text);
    expect(button?.disabled).toBe(false);
    await act(async () => button!.click());
}

for (const action of ["全新商品分析", "已有档案提问", "明确重新识别"] as const) {
    test(`${action}：十次回调只保存一次回执和一次终态`, async () => {
        const product = productWithPhoto("fixture-studio");
        if (action !== "全新商品分析") product.dossier = { name: "水杯", category: "杯具", family: "generic", summary: "水杯", invariants: [], facts: [], questions: [] };
        if (action === "明确重新识别") product.brief.prep = { asks: [{ id: "known", question: "用途", options: ["家用", "办公"], picked: [], multi: false, note: "" }], directions: [] };
        const writes: StudioProduct[] = [];
        const steps: string[] = [];
        spyOn(studioApi, "getStudioWorkspace").mockResolvedValue({ revision: 1, products: [product] });
        spyOn(studioApi, "saveStudioProduct").mockImplementation(async (updated, revision) => {
            writes.push(structuredClone(updated));
            return { revision: revision + 1, product: { ...updated, revision: revision + 1 } };
        });
        spyOn(quotes, "quoteModel").mockResolvedValue({ quote: { logicalModelId: "", billingMode: "fixed_request", quantity: 1, amountMicrocredits: 1_000_000, estimated: false } });
        spyOn(generationApi, "runBackendGenerationTask").mockImplementation(async (options) => {
            const step = String(options.metadata?.studioStep);
            steps.push(step);
            for (let index = 0; index < 10; index++) {
                options.onTaskUpdate?.(runningTask(`${step}-${steps.length}`));
                await store().flush(product.id);
            }
            return {
                text: JSON.stringify(step === "ask" ? { asks: [{ question: "使用场景", options: ["家用", "办公"] }] } : { name: "新识别的水杯", category: "杯具", facts: [{ group: "appearance", label: "颜色", value: "白色", evidence: "visible" }] }),
            };
        });
        await store().load(true);
        await act(async () =>
            root.render(
                <MemoryRouter>
                    <QueryClientProvider client={client}>
                        <ConfigProvider theme={{ token: { motion: false } }}>
                            <App>
                                <StudioHarness />
                            </App>
                        </ConfigProvider>
                    </QueryClientProvider>
                </MemoryRouter>,
            ),
        );
        const cost = host.querySelector(".es-form-foot .es-estimate")?.textContent || "";
        expect(cost.includes("识别：1 积分")).toBe(action === "全新商品分析");
        expect(cost).toContain("策划：1 积分");
        expect(cost).toContain("出图 ×1");
        if (action === "已有档案提问") await act(async () => host.querySelector<HTMLElement>(".es-prep-optional > summary")!.click());
        await press(action === "已有档案提问" ? "生成补充问题" : "AI 分析商品");
        await act(async () => store().flush(product.id));
        const expected = action === "已有档案提问" ? "ask" : "recognize";
        expect(steps).toEqual([expected]);
        expect(writes).toHaveLength(2);
        expect(writes[0].lastAnalysisTaskId).toBe(`${expected}-1`);
        if (expected === "recognize") expect(writes[1].dossier?.name).toBe("新识别的水杯");
        else expect(writes[1].brief.prep?.asks[0].question).toBe("使用场景");
    });
}

test("回执恢复：不重发旧版未确认尝试，已知任务只查询，新版超时按原请求号接回", async () => {
    const product = productWithPhoto("receipt-studio");
    product.brief.count = 3;
    const run = createStudioRun(product, () => crypto.randomUUID());
    Object.assign(run.shots[2], { role: "main-selling", composition: "left", ratio: "1:1", headline: "方便携带" });
    product.runs.push(run);
    const attempt = { id: "legacy", status: "submitting" as const, model: imageModel, tweaks: [], createdAt: product.createdAt, outputs: [] };
    run.shots[0].attempts.push(attempt);
    run.shots[1].attempts.push({ ...attempt, id: "confirmed", taskId: "known-task", status: "queued" });
    const saved = (value: StudioProduct) => normalizeStudioProduct(JSON.parse(JSON.stringify(value)))!;
    let persisted = saved(product);
    spyOn(studioApi, "getStudioWorkspace").mockImplementation(async () => ({ revision: persisted.revision, products: [saved(persisted)] }));
    spyOn(studioApi, "saveStudioProduct").mockImplementation(async (updated, revision) => {
        persisted = saved({ ...updated, revision: revision + 1 });
        return { revision: revision + 1, product: persisted };
    });
    const done = (id: string) => ({ ...runningTask(id), type: "canvas_image", status: "succeeded" as const, resultJson: JSON.stringify({ images: [{ storageKey: "resource:output", url: "/result" }] }) });
    const watch = spyOn(taskApi, "waitForGenerationTask").mockImplementation(async (id) => done(id));
    const upload = spyOn(resourceApi, "uploadResourceFile").mockRejectedValue(new Error("成品由图片模型直接完成，不应上传版式草图"));
    const submits: CreateTaskInput[] = [];
    spyOn(http, "post").mockImplementation(async <T,>(path: string, body?: unknown) => {
        expect(path).toBe("/tasks");
        const input = body as CreateTaskInput;
        const snapshot = persisted.runs[0].shots[2].attempts[0];
        expect(snapshot.input?.compiled.prompt).toBe(input.input?.prompt);
        expect(snapshot.input?.compiled.layoutGuide).toBeUndefined();
        submits.push(structuredClone(input));
        if (submits.length === 1) throw new ApiError("网络超时", { status: 408 });
        return done("new-task") as T;
    });
    await store().load(true);
    let runner!: ReturnType<typeof useStudioRunner>;
    function Runner() {
        runner = useStudioRunner();
        return null;
    }
    await act(async () => root.render(<Runner />));
    await act(async () => runner.resume(current()));
    expect(submits).toHaveLength(0);
    expect(watch.mock.calls.map(([id]) => id)).toEqual(["known-task"]);
    expect(current().runs[0].shots[0].attempts[0].error).toContain("任务中心");
    await act(async () => {
        await runner.rerun(product.id, { runId: run.id }, [run.shots[2].id], attempt.model);
    });
    const pending = current().runs[0].shots[2].attempts[0];
    expect(submits).toHaveLength(1);
    expect(pending.status).toBe("submitting");
    expect(pending.error).toContain("待核对");
    expect(pending.taskId).toBeUndefined();
    expect(pending.input?.compiled.layoutGuide).toBeUndefined();
    await store().flush(product.id);
    await act(async () => root.unmount());
    await store().load(true);
    root = createRoot(host);
    await act(async () => root.render(<Runner />));
    await act(async () => runner.resume(current()));
    expect(submits).toHaveLength(2);
    expect(submits[1]).toEqual(submits[0]);
    expect(submits[0]).toMatchObject({ idempotencyKey: pending.id, input: { prompt: pending.input!.compiled.prompt, referenceImages: [{ storageKey: "resource:cup" }] } });
    expect(current().runs[0].shots[2].attempts[0].taskId).toBe("new-task");
    expect(upload).not.toHaveBeenCalled();
    expect(current().runs[0].shots[0].attempts[0].taskId).toBeUndefined();
});

test("旧详情回执原样查询，明确未受理就终止，不换请求编号或提示费用待核对", async () => {
    const product = productWithPhoto("old-detail-receipt");
    product.brief.outputType = "detail-set";
    product.brief.detailScreens = 2;
    const screens = [
        { role: "detail-hero", purchaseQuestion: "这个杯子是什么样？", displayContent: "白色水杯的完整外形" },
        { role: "detail-model", purchaseQuestion: "用哪一部分握住杯子？", displayContent: "手指握住杯柄" },
    ];
    product.brief.detailPlan = parseDetailPlan(JSON.stringify({ screens }), product, studioDetailPlanRoles(product), { id: "old-plan", model: textModel, createdAt: now }).plan;
    const run = createStudioRun(product, () => crypto.randomUUID());
    product.runs.push(run);
    const input = studioImageInput(product, studioLocateRunShot(run, 0), imageModel, config);
    const prompt = "【页面身份】\n商品详情区单屏，不是搜索主图。\n\n【画面】\n白色水杯的完整外形。";
    input.compiled.prompt = prompt;
    delete input.compiled.studioDetailContract;
    run.shots[0].attempts.push({ id: "old-detail-request", replaySafe: true, status: "submitting", model: imageModel, tweaks: [], createdAt: now, outputs: [], input });
    const saved = (value: StudioProduct) => normalizeStudioProduct(structuredClone(value))!;
    let persisted = saved(product);
    spyOn(studioApi, "getStudioWorkspace").mockImplementation(async () => ({ revision: persisted.revision, products: [saved(persisted)] }));
    spyOn(studioApi, "saveStudioProduct").mockImplementation(async (updated, revision) => {
        persisted = saved({ ...updated, revision: revision + 1 });
        return { revision: revision + 1, product: persisted };
    });
    const message = "详情页生成规则已更新。请刷新页面，重新策划后再出图。";
    const submit = spyOn(http, "post").mockRejectedValue(new ApiError(message, { status: 422, reason: "studio_detail_contract_outdated" }));
    const watch = spyOn(taskApi, "waitForGenerationTask").mockRejectedValue(new Error("未受理的请求没有任务可查"));
    let runner!: ReturnType<typeof useStudioRunner>;
    function Runner() {
        runner = useStudioRunner();
        return null;
    }
    await store().load(true);
    await act(async () => root.render(<Runner />));
    await act(async () => runner.resume(current()));
    await act(async () => store().flush(product.id));

    expect(submit).toHaveBeenCalledTimes(1);
    const [path, body] = submit.mock.calls[0];
    expect(path).toBe("/tasks");
    expect(body).toMatchObject({ idempotencyKey: "old-detail-request", input: { prompt, referenceImages: [{ storageKey: "resource:cup" }] } });
    expect((body as CreateTaskInput).input?.metadata).not.toHaveProperty("studioDetailContract");
    const [shot, pending] = persisted.runs[0].shots;
    expect(shot.attempts).toHaveLength(1);
    expect(shot.attempts[0]).toMatchObject({ id: "old-detail-request", status: "failed", error: message });
    expect(shot.attempts[0].taskId).toBeUndefined();
    expect(pending.attempts).toHaveLength(0);
    expect(studioGroupProgress(persisted.runs[0].shots, {})).toMatchObject({ failed: 1, pending: 1, active: 0, review: 0 });
    await act(async () => runner.resume(saved(persisted)));
    expect(submit).toHaveBeenCalledTimes(1);
    expect(watch).not.toHaveBeenCalled();
});

test("生图台顶栏保留商品、页签与创作工具，刷新时不重复生成", async () => {
    const { default: EcommerceStudioPage } = await import("@/pages/ecommerce-studio");
    const { studioPlanInputSignature } = await import("@/lib/ecommerce-studio/plan-input");
    const product = productWithPhoto("saved-studio");
    product.name = "已保存的水杯";
    product.brief.outputType = "main-set";
    const run = createStudioRun(product, () => crypto.randomUUID());
    run.shots[0].attempts.push({ id: "saved-attempt", taskId: "saved-task", status: "succeeded", tweaks: [], model: imageModel, createdAt: now, outputs: [{ resourceId: "saved-output", url: "", width: 768, height: 1024 }] });
    product.runs.push(run);
    const other = createStudioProduct("other-studio", "2026-01-02T00:00:00Z");
    other.name = "另一件没有商品图的样品";
    spyOn(studioApi, "getStudioWorkspace").mockImplementation(async () => ({ revision: 1, products: structuredClone([other, product]) }));
    spyOn(studioApi, "getStudioProduct").mockImplementation(async () => structuredClone(product));
    spyOn(studioApi, "getStudioPrompts").mockResolvedValue({});
    spyOn(quotes, "quoteModel").mockResolvedValue({ quote: { logicalModelId: "", billingMode: "fixed_request", quantity: 1, amountMicrocredits: 1_000_000, estimated: false } });
    spyOn(http, "get").mockImplementation(async <T,>(path: string) => {
        if (path === "/ecommerce/product-videos") return { revision: 0, items: [] } as T;
        expect(path).toBe("/tasks/saved-task");
        return { ...runningTask("saved-task"), status: "succeeded", type: "canvas_image" } as T;
    });
    const save = spyOn(http, "put").mockImplementation(async <T,>(path: string, body?: { item: { id: string }; expectedRevision: number }) => {
        expect(body?.expectedRevision).toBe(0);
        expect(path).toBe(`/ecommerce/product-videos/${body?.item.id}`);
        return { revision: 1, item: { ...body!.item, revision: 1 } } as T;
    });
    const submit = spyOn(http, "post").mockRejectedValue(new Error("查看已保存商品不应提交生成任务"));
    const existingPlan = Promise.withResolvers<GenerationTask>();
    const resume = spyOn(taskApi, "waitForGenerationTask").mockReturnValue(existingPlan.promise);
    const studioPath = `/studio?product=${product.id}&from=fixture`;
    let router: ReturnType<typeof createMemoryRouter> | undefined;
    const mount = async (path: string) => {
        if (router) {
            await act(async () => root.unmount());
            router.dispose();
            root = createRoot(host);
        }
        useStudioStore.setState(useStudioStore.getInitialState());
        const next = createMemoryRouter(
            [
                { path: "/studio", element: <EcommerceStudioPage /> },
                { path: "/video-replication", element: <h1>商品视频工作台</h1> },
            ],
            { initialEntries: [path] },
        );
        router = next;
        await act(async () =>
            root.render(
                <QueryClientProvider client={client}>
                    <ConfigProvider theme={{ token: { motion: false } }}>
                        <App>
                            <RouterProvider router={next} />
                        </App>
                    </ConfigProvider>
                </QueryClientProvider>,
            ),
        );
        expect(host.querySelector('button[aria-label="修改商品名称"]')?.textContent).toBe(product.name);
        expect(host.querySelector("[data-image-pack-result]")).not.toBeNull();
        return next;
    };
    const active = () => host.querySelector('[aria-label="电商生图台工作阶段"] [aria-checked="true"]')?.textContent;
    const select = async (group: string, label: string) => {
        const button = [...host.querySelectorAll(`[aria-label="${group}"] button`)].find((entry) => entry.textContent?.startsWith(label)) as HTMLButtonElement;
        expect(button).toBeDefined();
        await act(async () => button.click());
    };
    const headerAction = async (name: string) => {
        const button = host.querySelector<HTMLButtonElement>(`.es-head button[aria-label="${name}"]`);
        expect(button?.disabled).toBe(false);
        await act(async () => button!.click());
    };
    const menuItem = (label: string) => Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find((entry) => entry.textContent?.trim().startsWith(label));
    try {
        const opened = await mount(`${studioPath}&view=results`);
        expect(active()).toBe("生成记录");
        expect(host.querySelector(".es-head")?.textContent).not.toContain("商品视频策划");
        expect(host.querySelector(".es-head")?.textContent).not.toContain("换装 · 换脸 · 印花");
        await select("电商生图台工作阶段", "商品与设置");
        expect(active()).toBe("商品与设置");
        expect(opened.state.historyAction).toBe("REPLACE");
        const formURL = opened.state.location.search;
        expect(Object.fromEntries(new URLSearchParams(formURL))).toEqual({ product: product.id, from: "fixture", view: "form" });

        const refreshed = await mount(`/studio${formURL}`);
        expect(active()).toBe("商品与设置");
        await select("右侧工作区", "生成记录");
        expect(active()).toContain("生成记录");
        expect(refreshed.state.historyAction).toBe("REPLACE");
        expect(Object.fromEntries(new URLSearchParams(refreshed.state.location.search))).toEqual({ product: product.id, from: "fixture", view: "results" });
        await mount(`${studioPath}&view=plan`);
        expect(active()).toBe("页面设计");
        const draftFlow = await mount(studioPath);
        expect(active()).toBe("商品与设置");
        await headerAction("新建商品");
        expect(new URLSearchParams(draftFlow.state.location.search).get("product")).not.toBe(product.id);
        await headerAction("更多操作");
        expect(menuItem("商品视频策划")?.getAttribute("aria-disabled")).toBe("true");
        expect(menuItem("删除商品")).toBeUndefined();
        expect(menuItem("换装 · 换脸 · 印花")).toBeDefined();
        await act(async () => menuItem("换装 · 换脸 · 印花")!.click());
        const fashion = document.querySelector(".fashion-workbench");
        expect(fashion?.textContent).toContain("服装与人物 · 图片");
        await act(async () => fashion!.querySelector<HTMLButtonElement>('button[aria-label="关闭模特工作台"]')!.click());
        expect(document.querySelector(".fashion-workbench")).toBeNull();

        await headerAction("切换商品");
        expect(menuItem(other.name)).toBeDefined();
        await act(async () => menuItem(other.name)!.click());
        expect(new URLSearchParams(draftFlow.state.location.search).get("product")).toBe(other.id);
        expect(host.querySelector('button[aria-label="修改商品名称"]')?.textContent).toBe(other.name);

        product.planReceipt = { scope: "main", inputSignature: studioPlanInputSignature(product), model: textModel, createdAt: now, attemptId: "existing-plan", taskId: "existing-plan-task", state: "submitted" };
        await mount(`${studioPath}&view=form`);
        expect(active()).toBe("商品与设置");
        const videoFlow = await mount(studioPath);
        expect(active()).toBe("页面设计");
        expect(resume.mock.calls.map(([id]) => id)).toEqual(["existing-plan-task"]);
        await headerAction("更多操作");
        expect(menuItem("删除商品")).toBeDefined();
        expect(menuItem("商品视频策划")?.getAttribute("aria-disabled")).not.toBe("true");
        await act(async () => menuItem("商品视频策划")!.click());
        expect(save).toHaveBeenCalledTimes(1);
        expect(videoFlow.state.location.pathname).toBe("/video-replication");
        expect(new URLSearchParams(videoFlow.state.location.search).get("remake")).toBeTruthy();
        expect(submit).not.toHaveBeenCalled();
    } finally {
        router?.dispose();
        await act(async () => {
            setActiveUserScope(null);
            existingPlan.resolve(runningTask("existing-plan-task"));
        });
    }
});
