import { afterAll, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import type { InteriorProject } from "@/services/api/interior";
import type { VideoTeardownBundle } from "@/services/api/video-replication";
import type { GenerationTask } from "@/services/api/task-center";

const dom = new Window({ url: "http://localhost/" });
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    Element: dom.Element,
    SVGElement: dom.SVGElement,
    ShadowRoot: dom.ShadowRoot,
    ResizeObserver: dom.ResizeObserver,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
}))
    Object.defineProperty(globalThis, key, { configurable: true, value });
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { ApiError } = await import("@/services/api/request");
const { setActiveUserScope, getActiveUserScope } = await import("@/lib/user-scope");
let analysisInput: { expectedUserScope?: string } | undefined;
let analysisText = "invalid";
let analysisReply: (() => Promise<{ text: string }>) | undefined;
const { defaultConfig } = await import("@/stores/use-config-store");
const tasks = await import("@/services/api/task-center");
let waits: string[] = [];
let submissions = 0;
let studioSubmit: (input: { clientOperationId?: string }) => Promise<GenerationTask>;
const capabilities = await import("@/lib/model-capabilities");
const selection = await import("@/lib/model-selection");
let frozenVideoProfile = false;
mock.module("@/lib/model-capabilities", () => ({
    ...capabilities,
    modelCapabilityConfigFor: (_config: unknown, model: string) => ({ text: { references: { maxImages: 4 } }, ...(frozenVideoProfile && model === "frozen-video" ? { video: capabilities.defaultModelCapabilityConfig("volcengine-ark-video").video } : {}) }),
}));
mock.module("@/lib/model-selection", () => ({ ...selection, modelCompatibilityError: () => "" }));
const canvasGeneration = await import("@/lib/canvas/canvas-project-generation");
const taskGeneration = await import("@/services/api/generation-task");
mock.module("@/lib/canvas/canvas-project-generation", () => ({ ...canvasGeneration, buildGenerationConfig: () => ({}) }));
mock.module("@/services/api/generation-task", () => ({
    ...taskGeneration,
    parseBackendGenerationResult: () => ({ text: "invalid" }),
    runBackendGenerationTask: async (input: { expectedUserScope?: string }) => {
        submissions++;
        analysisInput = input;
        if (input.expectedUserScope && input.expectedUserScope !== getActiveUserScope()) throw new DOMException("账号已切换，已取消生成", "AbortError");
        return analysisReply ? analysisReply() : { text: analysisText };
    },
    submitBackendGenerationTask: (input: { clientOperationId?: string }) => studioSubmit(input),
}));
let waitFailure: Error = new Error("network offline");
let studioWait: ((id: string) => Promise<GenerationTask>) | undefined;
let queryTask = tasks.queryGenerationTask;
let cancelTask = tasks.cancelGenerationTask;
mock.module("@/services/api/task-center", () => ({
    ...tasks,
    queryGenerationTask: (...args: Parameters<typeof tasks.queryGenerationTask>) => queryTask(...args),
    cancelGenerationTask: (id: string) => cancelTask(id),
    waitForGenerationTask: async (id: string) => {
        waits.push(id);
        if (studioWait) return studioWait(id);
        throw waitFailure;
    },
}));
const { analyzeVideoTeardown } = await import("@/pages/video-replication/replication-analysis");
const bundle: VideoTeardownBundle = {
    version: 1,
    source: { resourceId: "source", durationMs: 1000, width: 100, height: 100, hasAudio: false },
    shots: [{ index: 1, startMs: 0, endMs: 1000, boundary: "start", keyframeTimeMs: 0, keyframeResourceId: "keyframe", keyframeWidth: 100, keyframeHeight: 100 }],
    grids: [{ resourceId: "grid", width: 100, height: 100, shotIndexes: [1] }],
    transcript: { source: "none", segments: [] },
    warnings: [],
};

test("temporary query failure never creates another paid analysis task", async () => {
    waits = [];
    submissions = 0;
    waitFailure = new Error("network offline");
    await expect(analyzeVideoTeardown(bundle, { config: defaultConfig, model: "test", signal: new AbortController().signal, expectedScope: "a", fallbackTitle: "demo", onProgress: () => {}, existingTask: () => "existing-task" })).rejects.toThrow(
        "network offline",
    );
    expect(waits).toEqual(["existing-task"]);
    expect(submissions).toBe(0);
});

let listRead: () => Promise<InteriorProject[]> = async () => [];
let projectRead: (id: string) => Promise<InteriorProject>;
let saveFailure = false;
let savedNames: string[] = [];
const sample = (id: string): InteriorProject => ({ id, name: id, kind: "home", revision: 1, createdAt: "2026-11-01", updatedAt: "2026-11-01", document: { version: 1, rounds: [] } });
projectRead = async (id) => sample(id);
mock.module("@/services/api/interior", () => ({
    INTERIOR_PROJECT_CONFLICT: "interior_project_conflict",
    listInteriorProjects: () => listRead(),
    getInteriorProject: (id: string) => projectRead(id),
    createInteriorProject: async () => sample("new"),
    deleteInteriorProject: async () => {},
    saveInteriorProject: async (id: string, input: { name: string }) => {
        savedNames.push(input.name);
        if (saveFailure) throw new Error("save offline");
        return { ...sample(id), name: input.name, revision: 2 };
    },
}));
const { useInteriorProjects, InteriorUnsavedError } = await import("@/pages/interior/use-interior-project");
let hook: ReturnType<typeof useInteriorProjects>;
function Probe({ user }: { user: string }) {
    hook = useInteriorProjects(user);
    return <span>{hook.current?.id}</span>;
}
const host = dom.document.createElement("div");
dom.document.body.append(host);
const root = createRoot(host);
async function render(user: string) {
    setActiveUserScope(user);
    await act(async () => {
        root.render(<Probe user={user} />);
    });
}
afterAll(async () => {
    await act(async () => root.unmount());
    await dom.happyDOM.abort();
});

test("late account A response cannot replace account B's project", async () => {
    let resolveA!: (list: InteriorProject[]) => void;
    listRead = () =>
        new Promise((resolve) => {
            resolveA = resolve;
        });
    await render("a");
    listRead = async () => [sample("project-b")];
    await render("b");
    expect(hook!.current?.id).toBe("project-b");
    await act(async () => resolveA([sample("project-a")]));
    expect(hook!.current?.id).toBe("project-b");
    expect(hook!.projects?.map((item) => item.id)).toEqual(["project-b"]);
});

test("deleting another project does not discard the active project's unsaved changes", async () => {
    listRead = async () => [sample("active"), sample("other")];
    await render("c");
    savedNames = [];
    saveFailure = true;
    await act(async () => {
        hook!.update("active", (doc) => ({ ...doc, rounds: [] }));
        await hook!.remove("other");
    });
    await act(async () => {
        await expect(hook!.open("third")).rejects.toBeInstanceOf(InteriorUnsavedError);
    });
    expect(hook!.current?.id).toBe("active");
    saveFailure = false;
});

test("rename is blocked if the pending document cannot be saved", async () => {
    listRead = async () => [sample("active")];
    await render("d");
    await act(async () => {
        hook!.update("active", (doc) => ({ ...doc }));
    });
    savedNames = [];
    saveFailure = true;
    await act(async () => {
        await expect(hook!.rename("renamed")).rejects.toBeInstanceOf(InteriorUnsavedError);
    });
    expect(savedNames).not.toContain("renamed");
    saveFailure = false;
});

let studioSave: (product: ReturnType<typeof studioProduct>) => Promise<{ product: ReturnType<typeof studioProduct> }> = async (product) => ({ product });
mock.module("@/services/api/ecommerce-studio", () => ({
    STUDIO_PRODUCT_CONFLICT: "studio_product_conflict",
    getStudioWorkspace: async () => ({ products: [] }),
    getStudioProduct: async () => {
        throw new Error("not found");
    },
    saveStudioProduct: (product: ReturnType<typeof studioProduct>) => studioSave(product),
    deleteStudioProduct: async () => {},
}));
const imageGeneration = await import("@/lib/ecommerce/ecommerce-image-generation");
const analysisGeneration = await import("@/lib/ecommerce/ecommerce-analysis-generation");
mock.module("@/lib/ecommerce/ecommerce-analysis-generation", () => ({ ...analysisGeneration, buildEcommerceAnalysisGeneration: () => ({ ...defaultConfig, model: "test" }) }));
mock.module("@/lib/ecommerce/ecommerce-image-generation", () => ({ ...imageGeneration, buildEcommerceImageGeneration: () => ({ config: { ...defaultConfig, model: "test" } }) }));
const compiler = await import("@/lib/ecommerce-studio/prompt-compiler");
mock.module("@/lib/ecommerce-studio/prompt-compiler", () => ({
    ...compiler,
    compileStudioPrompt: ({ product }: { product: { name: string; brief: { language: string } } }) => ({
        prompt: `${product.name} ${product.brief.language}`,
        layers: [],
        trimmed: [],
        textMode: "model",
        adapter: { family: "generic", label: "test", textRendering: "strong" },
        references: [{ id: "photo", resourceId: "photo", view: "front", truth: true, addedAt: "2026-11-01", url: "/api/resources/photo/file" }],
        modelReferences: [],
        styleReferences: [],
    }),
}));
const { createStudioProduct } = await import("@/lib/ecommerce-studio/product");
const { useStudioStore } = await import("@/pages/ecommerce-studio/use-studio-store");
const { useStudioRunner } = await import("@/pages/ecommerce-studio/use-studio-runner");
let runner: ReturnType<typeof useStudioRunner>;
function RunnerProbe() {
    runner = useStudioRunner();
    return null;
}
const studioHost = dom.document.createElement("div");
dom.document.body.append(studioHost);
const studioRoot = createRoot(studioHost);
afterAll(async () => {
    await act(async () => studioRoot.unmount());
});
const task = (id: string, status: GenerationTask["status"]): GenerationTask =>
    ({ id, status, type: "canvas_image", resultJson: JSON.stringify({ images: [{ resourceId: "result-image", url: "/api/resources/result-image/file", width: 1024, height: 1024 }] }) }) as GenerationTask;
function studioProduct(taskId?: string) {
    const product = createStudioProduct("studio");
    product.runs = [
        {
            id: "run",
            createdAt: "2026-11-01",
            type: "main",
            quality: "",
            textMode: "model",
            shots: [
                {
                    id: "shot",
                    role: "main-white",
                    title: "主图",
                    ratio: "1:1",
                    headline: "",
                    subline: "",
                    lines: [],
                    sellingPointIds: [],
                    tweaks: [],
                    attempts: [{ id: "same-operation", taskId, status: taskId ? "running" : "submitting", model: "test", tweaks: [], outputs: [], createdAt: "2026-11-01" }],
                },
            ],
        },
    ];
    return product;
}
async function mountStudio(product: ReturnType<typeof studioProduct>) {
    setActiveUserScope("studio-user");
    useStudioStore.setState({ scope: "studio-user", products: [product], status: "ready", saveStates: { [product.id]: "saved" } });
    await act(async () => studioRoot.render(<RunnerProbe />));
}
const attempt = () => useStudioStore.getState().products[0].runs[0].shots[0].attempts[0];
test("same-account planning uses account identity instead of the detail/main business scope", async () => {
    const product = studioProduct();
    product.brief.outputType = "detail-set";
    analysisText = JSON.stringify({
        screens: Array.from({ length: 10 }, (_, index) => ({
            role: index === 0 ? "detail-hero" : index === 9 ? "detail-closing" : "detail-scene",
            title: "商品展示",
            headline: "清晰外观",
            subline: "",
            lines: [],
            visual: "展示商品真实外观",
            layout: "editorial",
        })),
    });
    for (let login = 0; login < 2; login++) {
        await mountStudio(product);
        let result: Awaited<ReturnType<typeof runner.plan>> | undefined;
        await act(async () => {
            result = await runner.plan(product.id, "test");
        });
        expect(analysisInput?.expectedUserScope).toBe("studio-user");
        expect(result?.plan.screens).toHaveLength(10);
    }
    setActiveUserScope("another-user");
    await expect(runner.plan(product.id, "test")).rejects.toMatchObject({ name: "AbortError" });
    analysisText = "invalid";
});
test("studio query interruption keeps the original task active and resynchronizes its result", async () => {
    await mountStudio(studioProduct("original-task"));
    studioWait = async () => {
        throw new Error("gateway unavailable");
    };
    await act(async () => runner!.resume(useStudioStore.getState().products[0]));
    expect(attempt()).toMatchObject({ status: "running", taskId: "original-task" });
    expect(attempt().error).toContain("同步中断");
    studioWait = async (id) => task(id, "succeeded");
    await act(async () => runner!.resume(useStudioStore.getState().products[0]));
    expect(attempt()).toMatchObject({ status: "succeeded", taskId: "original-task" });
    expect(attempt().outputs[0].resourceId).toBe("result-image");
});
test("studio lost submission response is recovered with the same operation ID", async () => {
    await mountStudio(studioProduct());
    const operations: (string | undefined)[] = [];
    studioSubmit = async (input) => {
        operations.push(input.clientOperationId);
        throw new Error("response lost");
    };
    await act(async () => runner!.resume(useStudioStore.getState().products[0]));
    expect(attempt().status).toBe("submitting");
    expect(attempt().error).toContain("待核对");
    studioSubmit = async (input) => {
        operations.push(input.clientOperationId);
        return task("recovered", "succeeded");
    };
    await act(async () => runner!.resume(useStudioStore.getState().products[0]));
    expect(operations).toEqual(["same-operation", "same-operation"]);
    expect(attempt().status).toBe("succeeded");
});

test("queued account A save cannot read or save account B's product", async () => {
    const productA = studioProduct();
    await mountStudio(productA);
    let finish!: () => void;
    let started!: () => void;
    const savingStarted = new Promise<void>((resolve) => {
        started = resolve;
    });
    const names: string[] = [];
    studioSave = async (product) => {
        names.push(product.name);
        started();
        await new Promise<void>((resolve) => {
            finish = resolve;
        });
        return { product: { ...product, revision: 2 } };
    };
    useStudioStore.getState().update(productA.id, (product) => ({ ...product, name: "account-a-edit" }));
    const first = useStudioStore
        .getState()
        .flush(productA.id)
        .catch((error) => error);
    await savingStarted;
    useStudioStore.getState().update(productA.id, (product) => ({ ...product, name: "account-a-queued" }));
    const queued = useStudioStore
        .getState()
        .flush(productA.id)
        .catch((error) => error);
    setActiveUserScope("studio-other");
    await useStudioStore.getState().load();
    const productB = { ...productA, name: "account-b-product" };
    useStudioStore.setState({ products: [productB] });
    finish();
    expect(await first).toMatchObject({ name: "AbortError" });
    expect(await queued).toMatchObject({ name: "AbortError" });
    expect(names).toEqual(["account-a-edit"]);
    expect(useStudioStore.getState().products[0].name).toBe("account-b-product");
    studioSave = async (product) => ({ product });
});

test("unmounting one studio runner preserves another runner's queued shot", async () => {
    const { useUserStore } = await import("@/stores/use-user-store");
    const previous = useUserStore.getState().runtimeLimits;
    useUserStore.setState({ runtimeLimits: { ...previous, activeTaskLimit: 1 } });
    const a = studioProduct();
    a.runs[0].shots[0].attempts[0].id = "owner-a";
    const b = studioProduct();
    b.id = "product-b";
    b.runs[0].shots[0].attempts[0].id = "owner-b";
    await mountStudio(a);
    useStudioStore.setState({ products: [a, b] });
    let runnerB!: ReturnType<typeof useStudioRunner>;
    const hostB = dom.document.createElement("div");
    dom.document.body.append(hostB);
    const rootB = createRoot(hostB);
    function OtherProbe() {
        runnerB = useStudioRunner();
        return null;
    }
    await act(async () => rootB.render(<OtherProbe />));
    let finishA!: (task: GenerationTask) => void;
    const operations: (string | undefined)[] = [];
    studioSubmit = async (input) => {
        operations.push(input.clientOperationId);
        return input.clientOperationId === "owner-a"
            ? new Promise((resolve) => {
                  finishA = resolve;
              })
            : task("b-task", "succeeded");
    };
    studioWait = async (id) => task(id, "succeeded");
    await act(async () => {
        runner!.resume(a);
        runnerB.resume(b);
    });
    expect(operations).toEqual(["owner-a"]);
    await act(async () => studioRoot.render(null));
    await act(async () => finishA(task("a-task", "succeeded")));
    expect(operations).toEqual(["owner-a", "owner-b"]);
    expect(useStudioStore.getState().products.find((item) => item.id === b.id)?.runs[0].shots[0].attempts[0].status).toBe("succeeded");
    await act(async () => rootB.unmount());
    useUserStore.setState({ runtimeLimits: previous });
});

test("studio save failure blocks every paid submission and reports failed attempts", async () => {
    const product = studioProduct();
    product.runs = [];
    product.photos = [{ id: "photo", resourceId: "photo", view: "front", truth: true, addedAt: "2026-11-01", url: "/api/resources/photo/file" }];
    await mountStudio(product);
    let submitted = 0;
    studioSubmit = async () => {
        submitted++;
        return task("should-not-exist", "succeeded");
    };
    studioSave = async () => {
        throw new Error("save offline");
    };
    await act(async () => {
        await expect(runner.generate(product.id, "test")).rejects.toThrow("save offline");
    });
    expect(submitted).toBe(0);
    const shots = useStudioStore.getState().products[0].runs[0].shots;
    expect(shots.every((shot) => shot.attempts.at(-1)?.status === "failed")).toBe(true);
    studioSave = async (product) => ({ product });
    await useStudioStore.getState().flush(product.id);
});

test("task ID save failure recovers the saved operation and frozen request after reload", async () => {
    const product = studioProduct();
    product.runs = [];
    product.name = "durable-input";
    product.photos = [{ id: "photo", resourceId: "photo", view: "front", truth: true, addedAt: "2026-11-01", url: "/api/resources/photo/file" }];
    await mountStudio(product);
    let durable = structuredClone(product);
    studioSave = async (value) => {
        if (value.runs.some((run) => run.shots.some((shot) => shot.attempts.some((attempt) => attempt.taskId)))) throw new Error("task ID save failed");
        durable = structuredClone(value);
        return { product: value };
    };
    const operations: (string | undefined)[] = [];
    const prompts: string[] = [];
    studioSubmit = async (input) => {
        operations.push(input.clientOperationId);
        prompts.push((input as { prompt: string }).prompt);
        return task("existing-paid-task", "succeeded");
    };
    studioWait = async (id) => task(id, "succeeded");
    await act(async () => {
        await runner.generate(product.id, "test", { firstOnly: true });
    });
    expect(operations).toHaveLength(1);
    expect(durable.runs[0].shots[0].attempts[0]).toMatchObject({ id: operations[0], status: "submitting" });
    expect(durable.runs[0].shots[0].attempts[0].taskId).toBeUndefined();
    await act(async () => studioRoot.render(null));
    setActiveUserScope("reload-reset");
    await useStudioStore.getState().load();
    studioSave = async (product) => ({ product });
    durable.name = "changed-after-reload";
    await mountStudio(durable);
    await act(async () => runner.resume(durable));
    expect(operations).toEqual([operations[0], operations[0]]);
    expect(prompts).toEqual(["durable-input zh", "durable-input zh"]);
    expect(useStudioStore.getState().products[0].runs[0].shots[0].attempts[0]).toMatchObject({ taskId: "existing-paid-task", status: "succeeded" });
});

test("a queued group keeps its original inputs after editing the form", async () => {
    const { useUserStore } = await import("@/stores/use-user-store");
    const previous = useUserStore.getState().runtimeLimits;
    useUserStore.setState({ runtimeLimits: { ...previous, activeTaskLimit: 1 } });
    const product = studioProduct();
    product.runs = [];
    product.name = "original";
    product.photos = [{ id: "photo", resourceId: "photo", view: "front", truth: true, addedAt: "2026-11-01", url: "/api/resources/photo/file" }];
    product.brief.count = 4;
    await mountStudio(product);
    const prompts: string[] = [];
    let finish!: (task: GenerationTask) => void;
    studioSubmit = async (input) => {
        prompts.push((input as { prompt?: string }).prompt!);
        if (prompts.length === 1)
            return new Promise((resolve) => {
                finish = resolve;
            });
        return task(`queue-${prompts.length}`, "succeeded");
    };
    studioWait = async (id) => task(id, "succeeded");
    await act(async () => {
        await runner.generate(product.id, "test");
    });
    expect(prompts).toEqual(["original zh"]);
    await act(async () => {
        useStudioStore.getState().update(product.id, (value) => ({ ...value, name: "edited", brief: { ...value.brief, language: "en" } }));
        finish(task("queue-first", "succeeded"));
    });
    expect(prompts).toEqual(Array(4).fill("original zh"));
    expect(useStudioStore.getState().products[0].name).toBe("edited");
    useUserStore.setState({ runtimeLimits: previous });
});

test("an old plan response cannot replace requirements edited while planning", async () => {
    const product = studioProduct();
    product.brief.outputType = "detail-set";
    await mountStudio(product);
    let finish!: (result: { text: string }) => void;
    let started!: () => void;
    const submitted = new Promise<void>((resolve) => {
        started = resolve;
    });
    analysisReply = () =>
        new Promise((resolve) => {
            finish = resolve;
            started();
        });
    const result = runner.plan(product.id, "test").catch((error) => error);
    await act(async () => {
        await submitted;
    });
    useStudioStore.getState().update(product.id, (value) => ({ ...value, sellerNotes: "new requirements", brief: { ...value.brief, language: "en" } }));
    const text = JSON.stringify({
        screens: Array.from({ length: 10 }, (_, index) => ({ role: index === 0 ? "detail-hero" : index === 9 ? "detail-closing" : "detail-scene", title: "商品展示", headline: "清晰外观", visual: "真实外观", layout: "editorial" })),
    });
    await act(async () => {
        finish({ text });
    });
    expect((await result).message).toContain("已修改");
    expect(useStudioStore.getState().products[0].brief.detailPlan).toBeUndefined();
    expect(useStudioStore.getState().products[0].sellerNotes).toBe("new requirements");
    analysisReply = undefined;
    await useStudioStore.getState().flush(product.id);
});

const { createRemakeJob } = await import("@/lib/remake/job");
let remake = createRemakeJob("remake", { teardownId: "teardown", bundle, analysis: null, sourceName: "demo" });
let beforeRemakeSave: (() => void) | undefined;
mock.module("@/pages/video-replication/replace/use-product-video-store", () => ({
    readRemake: () => remake,
    updateRemake: async (_id: string, update: (value: typeof remake) => typeof remake) => {
        beforeRemakeSave?.();
        remake = update(remake);
    },
}));
const { startRemake, retryRemake, stopRemake, redoRemakeUnit, isRemakeRunning } = await import("@/pages/video-replication/remake/remake-runner");
async function finishRemake() {
    for (let i = 0; i < 100 && isRemakeRunning(remake.id); i++) await new Promise((resolve) => setTimeout(resolve, 1));
    expect(isRemakeRunning(remake.id)).toBe(false);
}
function pendingRemake() {
    remake = createRemakeJob("remake", { teardownId: "teardown", bundle, analysis: null, sourceName: "demo" });
    remake.units = [{ key: "unit", shotIndexes: [1], treatment: "remake", startMs: 0, endMs: 1000, clipStartMs: 0, clipEndMs: 1000, status: "failed", attempt: 2, taskId: "original-video-task", takes: [], chosen: 0 }];
}
test("remake retry queries its original task without incrementing the attempt or submitting", async () => {
    pendingRemake();
    const queried: string[] = [];
    let created = 0;
    queryTask = async (id) => {
        queried.push(id);
        throw new Error("query offline");
    };
    studioSubmit = async () => {
        created++;
        throw new Error("must not submit");
    };
    await retryRemake(remake.id, defaultConfig);
    await finishRemake();
    expect(queried).toEqual(["original-video-task"]);
    expect(remake.units[0]).toMatchObject({ status: "failed", attempt: 2, taskId: "original-video-task" });
    expect(created).toBe(0);
    await expect(redoRemakeUnit(remake.id, "unit", "redo", defaultConfig)).rejects.toThrow("原任务状态尚未确认");
});
test("unknown video submission restores its frozen model even if the visible model is unavailable", async () => {
    pendingRemake();
    remake.model = "unavailable-new-model";
    remake.units[0].taskId = undefined;
    const input = { model: "frozen-video", ratio: "9:16", resolution: "720p", seconds: 4, audio: "mute" as const, prompt: "冻结商品与动作", imageResourceIds: ["original-image"] };
    remake.units[0].input = input;
    const submitted: Array<{ clientOperationId?: string; prompt?: string; config?: { model: string } }> = [];
    studioSubmit = async (request) => {
        submitted.push(request);
        throw new Error("response still offline");
    };
    frozenVideoProfile = true;
    try {
        await retryRemake(remake.id, defaultConfig);
        await finishRemake();
        expect(submitted).toHaveLength(1);
        expect(submitted[0]).toMatchObject({ clientOperationId: "remake-unit-2", prompt: input.prompt, config: { model: input.model } });
        expect(remake.units[0].input).toEqual(input);
        expect(remake.units[0].attempt).toBe(2);
    } finally {
        frozenVideoProfile = false;
    }
});
test("starting video production rejects a recipe changed during CAS replay before any submission", async () => {
    pendingRemake();
    remake.model = "frozen-video";
    remake.audio = "mute";
    remake.units = [];
    remake.shots[0].treatment = "remake";
    remake.product.images = [{ id: "image", resourceId: "original-image", name: "商品" }];
    beforeRemakeSave = () => {
        beforeRemakeSave = undefined;
        remake = { ...remake, note: "另一窗口的新动作" };
    };
    let submitted = 0;
    studioSubmit = async () => {
        submitted++;
        throw new Error("must not submit");
    };
    frozenVideoProfile = true;
    try {
        await expect(startRemake(remake.id, defaultConfig)).rejects.toThrow("配方已被另一窗口修改");
        expect(submitted).toBe(0);
        expect(remake.note).toBe("另一窗口的新动作");
        expect(remake.units).toHaveLength(0);
    } finally {
        frozenVideoProfile = false;
        beforeRemakeSave = undefined;
    }
});
test("unconfirmed remake cancellation preserves video, voice and render task IDs", async () => {
    pendingRemake();
    remake.status = "generating";
    remake.units[0].status = "running";
    remake.voiceLines = [{ shotIndex: 1, text: "voice", signature: "voice", attempt: 1, status: "running", taskId: "voice-task" }];
    remake.render = { taskId: "render-task" };
    cancelTask = async () => {
        throw new Error("cancel offline");
    };
    await stopRemake(remake.id);
    expect(remake.units[0].taskId).toBe("original-video-task");
    expect(remake.voiceLines[0].taskId).toBe("voice-task");
    expect(remake.render?.taskId).toBe("render-task");
    expect(remake.error).toContain("取消未确认");
    cancelTask = async (id) => task(id, "cancelled");
    remake.units[0].status = "running";
    remake.voiceLines[0].status = "running";
    await stopRemake(remake.id);
    expect(remake.units[0].taskId).toBeUndefined();
    expect(remake.voiceLines[0].taskId).toBeUndefined();
    expect(remake.render).toBeUndefined();
});

test("the actual planned-shot editor displays and edits full semantic title lines", async () => {
    const { StudioShotList } = await import("@/pages/ecommerce-studio/studio-shot-list");
    const editorHost = dom.document.createElement("div");
    dom.document.body.append(editorHost);
    const editorRoot = createRoot(editorHost);
    const headline = "弧面靠背与开放间隔\n让餐桌旁的空间关系与结构细节一眼看清";
    const subline = "奶油白软包与黑色框架相接，靠背与坐垫之间保留开放间隔，具体材质与尺寸以已确认商品资料为准";
    let changed: { headline?: string } | undefined;
    try {
        await act(async () =>
            editorRoot.render(
                <StudioShotList
                    entries={[{ key: "p0", role: "detail-scene", title: "空间关系", purpose: "辨认开放间隔", included: true, planIndex: 0, layout: "scene", visual: "餐桌旁的完整餐椅", copy: { headline, subline, lines: [] } }]}
                    unit="屏"
                    onToggle={() => {}}
                    onMove={() => {}}
                    onEditPlan={(_index, patch) => {
                        changed = patch;
                    }}
                />,
            ),
        );
        await act(async () => editorHost.querySelector<HTMLButtonElement>('[aria-label="修改这一屏：空间关系"]')!.click());
        const title = editorHost.querySelector<HTMLTextAreaElement>("textarea#es-plan-p0-headline")!;
        const supporting = editorHost.querySelector<HTMLTextAreaElement>("textarea#es-plan-p0-subline")!;
        expect(title.value).toBe(headline);
        expect(supporting.value).toBe(subline);
        const edited = headline.replace("一眼看清", "看得清楚");
        await act(async () => {
            Object.getOwnPropertyDescriptor(dom.HTMLTextAreaElement.prototype, "value")!.set!.call(title, edited);
            title.dispatchEvent(new dom.Event("input", { bubbles: true }));
        });
        expect(changed?.headline).toBe(edited);
    } finally {
        await act(async () => editorRoot.unmount());
        editorHost.remove();
    }
});
