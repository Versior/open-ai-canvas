import { afterAll, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import type { InteriorProject } from "@/services/api/interior";
import type { VideoTeardownBundle } from "@/services/api/video-replication";
import type { GenerationTask } from "@/services/api/task-center";

const dom = new Window({ url: "http://localhost/" });
for (const [key, value] of Object.entries({ window: dom, document: dom.document, navigator: dom.navigator, HTMLElement: dom.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) Object.defineProperty(globalThis, key, { configurable: true, value });
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { ApiError } = await import("@/services/api/request");
const { setActiveUserScope } = await import("@/lib/user-scope");
const { defaultConfig } = await import("@/stores/use-config-store");
const tasks = await import("@/services/api/task-center");
let waits: string[] = [];
let submissions = 0;
let studioSubmit: (input: { clientOperationId?: string }) => Promise<GenerationTask>;
const capabilities = await import("@/lib/model-capabilities");
const selection = await import("@/lib/model-selection");
mock.module("@/lib/model-capabilities", () => ({ ...capabilities, modelCapabilityConfigFor: () => ({ text: { references: { maxImages: 4 } } }) }));
mock.module("@/lib/model-selection", () => ({ ...selection, modelCompatibilityError: () => "" }));
const canvasGeneration = await import("@/lib/canvas/canvas-project-generation");
const taskGeneration = await import("@/services/api/generation-task");
mock.module("@/lib/canvas/canvas-project-generation", () => ({ ...canvasGeneration, buildGenerationConfig: () => ({}) }));
mock.module("@/services/api/generation-task", () => ({
    ...taskGeneration,
    parseBackendGenerationResult: () => ({ text: "invalid" }),
    runBackendGenerationTask: async () => {
        submissions++;
        return { text: "invalid" };
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
mock.module("@/lib/ecommerce/ecommerce-image-generation", () => ({ ...imageGeneration, buildEcommerceImageGeneration: () => ({ config: { ...defaultConfig, model: "test" } }) }));
const compiler = await import("@/lib/ecommerce-studio/prompt-compiler");
mock.module("@/lib/ecommerce-studio/prompt-compiler", () => ({
    ...compiler,
    compileStudioPrompt: () => ({ prompt: "product", references: [{ id: "photo", resourceId: "photo", view: "front", truth: true, addedAt: "2026-11-01", url: "/api/resources/photo/file" }], modelReferences: [], styleReferences: [] }),
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
    useStudioStore.setState({ scope: "studio-user", products: [product], status: "ready", saveStates: {} });
    await act(async () => studioRoot.render(<RunnerProbe />));
}
const attempt = () => useStudioStore.getState().products[0].runs[0].shots[0].attempts[0];
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
    const first = useStudioStore.getState().flush(productA.id);
    await savingStarted;
    useStudioStore.getState().update(productA.id, (product) => ({ ...product, name: "account-a-queued" }));
    const queued = useStudioStore.getState().flush(productA.id);
    setActiveUserScope("studio-other");
    await useStudioStore.getState().load();
    const productB = { ...productA, name: "account-b-product" };
    useStudioStore.setState({ products: [productB] });
    finish();
    await Promise.all([first, queued]);
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

const { createRemakeJob } = await import("@/lib/remake/job");
let remake = createRemakeJob("remake", { teardownId: "teardown", bundle, analysis: null, sourceName: "demo" });
mock.module("@/pages/video-replication/replace/use-product-video-store", () => ({
    readRemake: () => remake,
    updateRemake: async (_id: string, update: (value: typeof remake) => typeof remake) => {
        remake = update(remake);
    },
}));
const { retryRemake, stopRemake, redoRemakeUnit, isRemakeRunning } = await import("@/pages/video-replication/remake/remake-runner");
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
