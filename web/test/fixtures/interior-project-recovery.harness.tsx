import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import type { InteriorProject, InteriorProjectInput, InteriorSceneItem } from "@/services/api/interior";
import { DEFAULT_RENOVATION } from "@/lib/interior/renovation";

const dom = new Window({ url: "http://localhost/" });
for (const [key, value] of Object.entries({ window: dom, document: dom.document, localStorage: dom.localStorage, navigator: dom.navigator, HTMLElement: dom.HTMLElement, CustomEvent: dom.CustomEvent, IS_REACT_ACT_ENVIRONMENT: true }))
    Object.defineProperty(globalThis, key, { configurable: true, value });
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { setActiveUserScope } = await import("@/lib/user-scope");
const { apiClient } = await import("@/services/api/request");
const { useInteriorProjects } = await import("@/pages/interior/use-interior-project");
setActiveUserScope("fixture");
const scene = (id: string): InteriorSceneItem => ({ id, createdAt: "2026-01-01", status: "failed", scope: "room", model: "fixture-model", description: "客厅" });
const project: InteriorProject = {
    id: "A",
    name: "工程 A",
    kind: "client",
    revision: 1,
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    document: {
        version: 1,
        rounds: [{ id: "round", createdAt: "2026-01-01", surface: "quick", modeKey: "edit", modeName: "编辑", params: {}, count: 1, source: { resourceId: "photo" }, references: [], items: [] }],
        scenes: [scene("first"), scene("last")],
        professional: { ...DEFAULT_RENOVATION, texture: { resourceId: "marble" }, budget: 8750 },
    },
};
let stored: InteriorProject, saves: string[], reads: string[], failRead: string;
let root: ReturnType<typeof createRoot>, state: ReturnType<typeof useInteriorProjects>;
function Probe() {
    state = useInteriorProjects("fixture");
    return null;
}
beforeEach(async () => {
    stored = structuredClone(project);
    saves = [];
    reads = [];
    failRead = "";
    localStorage.clear();
    setActiveUserScope("fixture");
    apiClient.defaults.adapter = async (config) => {
        const path = config.url!;
        let data: unknown;
        if (path === "/interior/projects") data = { projects: [stored, { ...stored, id: "B" }] };
        else if (config.method === "put" && path === "/interior/projects/A") {
            const input = JSON.parse(config.data) as InteriorProjectInput;
            saves.push(path);
            stored = { ...stored, document: input.document!, revision: stored.revision + 1 };
            data = stored;
        } else if (path === "/interior/projects/A" || path === "/interior/projects/B") {
            const id = path.slice(-1);
            reads.push(id);
            if (id === failRead) throw new Error("isolated offline");
            data = { ...stored, id };
        } else throw new Error(`Unexpected ${config.method} ${path}`);
        return { status: 200, statusText: "OK", headers: {}, config, data: { code: 0, msg: "", data: structuredClone(data) } };
    };
    root = createRoot(document.createElement("div"));
    await act(async () => root.render(<Probe />));
    expect(state.current?.id).toBe("A");
});
afterEach(async () => {
    await act(async () => root.unmount());
});

test("deleting one or the last scene preserves the material plan, its texture, budget and image history after saving and reopening", async () => {
    for (const id of ["first", "last"]) {
        await act(async () => {
            state.removeScene("A", id);
            await state.ensureSaved();
        });
        expect(stored.document.professional).toEqual(project.document.professional);
        expect(stored.document.rounds).toEqual(project.document.rounds);
        await act(async () => state.open("A"));
        expect(state.current?.document.professional).toEqual(project.document.professional);
        expect(state.current?.document.scenes?.map((item) => item.id) ?? []).toEqual(id === "first" ? ["last"] : []);
    }
    expect(saves).toHaveLength(2);
});

test("a failed switch keeps A untouched and a retry reads B, never A", async () => {
    failRead = "B";
    await act(async () => state.open("B"));
    expect(state.current?.id).toBe("A");
    expect(state.projectError?.projectId).toBe("B");
    failRead = "";
    await act(async () => state.open(state.projectError!.projectId));
    expect(reads).toEqual(["A", "B", "B"]);
    expect(state.current?.id).toBe("B");
    expect(state.projectError).toBeNull();
    expect(saves).toEqual([]);
});

test("two active studios advance the same source stage with one stable operation; a new scene remains a separate submission", async () => {
    const generation = await import("@/services/api/generation-task");
    const tasks = await import("@/services/api/task-center");
    const api = await import("@/services/api/interior");
    const { defaultConfig } = await import("@/stores/use-config-store");
    const requests: Array<Parameters<typeof generation.submitBackendGenerationTask>[0]> = [];
    mock.module("@/services/api/task-center", () => ({ ...tasks, waitForGenerationTask: async () => ({ resultJson: JSON.stringify({ text: JSON.stringify({ source: "text", scope: "room", description: "普通客厅", spaces: [{ name: "客厅" }] }) }) }) }));
    mock.module("@/services/api/interior", () => ({ ...api, getInteriorKnowledge: async () => [] }));
    mock.module("@/services/api/generation-task", () => ({
        ...generation,
        submitBackendGenerationTask: async (input: (typeof requests)[number]) => {
            requests.push(input);
            return { id: "receipt" };
        },
    }));
    const { useInteriorSceneTasks } = await import("@/pages/interior/use-interior-scene-tasks");
    const item = { ...scene("same"), status: "pending" as const, stage: "analyze" as const, taskId: "previous-analysis" };
    function Studio({ id }: { id: string }) {
        useInteriorSceneTasks({ ...project, document: { ...project.document, scenes: [{ ...item, id }] } }, () => {}, defaultConfig, { rooms: [], styles: [] } as unknown as Awaited<ReturnType<typeof api.getInteriorCatalog>>);
        return null;
    }
    const roots = ["same", "same", "new-version"].map(() => createRoot(document.createElement("div")));
    try {
        await act(async () => {
            roots.forEach((view, index) => view.render(<Studio id={index === 2 ? "new-version" : "same"} />));
        });
        for (let wait = 0; requests.length < 3 && wait < 20; wait++)
            await act(async () => {
                await Bun.sleep(5);
            });
        expect(requests).toHaveLength(3);
        expect(requests.every((request) => typeof request.clientOperationId === "string" && request.clientOperationId.length > 0 && request.clientOperationId.length <= 160)).toBe(true);
        expect(new Set(requests.map((request) => request.clientOperationId)).size).toBe(2);
    } finally {
        await act(async () => roots.forEach((view) => view.unmount()));
    }
});

test("LAN HTTP without SubtleCrypto uses the same bounded stage key; a change of floor heights or furnishing is a new confirmation", async () => {
    const generation = await import("@/services/api/generation-task");
    const { defaultConfig } = await import("@/stores/use-config-store");
    const keys: string[] = [];
    mock.module("@/services/api/generation-task", () => ({
        ...generation,
        submitBackendGenerationTask: async (input: Parameters<typeof generation.submitBackendGenerationTask>[0]) => {
            keys.push(input.clientOperationId!);
            return { id: "fixture-receipt" };
        },
    }));
    const { submitSceneTask } = await import("@/pages/interior/interior-scene-tasks");
    const transition = { projectId: "f".repeat(32), sceneId: "scene-01", sourceTaskId: "前驱".repeat(32), confirmation: { heights: [3, 3.25], furnishing: "preserve" as const } };
    const submit = (value: Parameters<typeof submitSceneTask>[5], model = "fixture-model", image?: Parameters<typeof submitSceneTask>[4]) => submitSceneTask(defaultConfig, model, "按核准的户型建模", "spec", image, value);
    const original = Object.getOwnPropertyDescriptor(globalThis, "crypto")!;
    await submit(transition);
    try {
        Object.defineProperty(globalThis, "crypto", { configurable: true, value: { getRandomValues: crypto.getRandomValues.bind(crypto) } });
        expect(crypto.subtle).toBeUndefined();
        await submit(transition);
        await submit({ ...transition, confirmation: { ...transition.confirmation, heights: [3.25, 3] } });
        await submit({ ...transition, confirmation: { ...transition.confirmation, furnishing: "auto" } });
        await submit({ ...transition, sourceTaskId: "different-parent" });
        await submit({ ...transition, repair: 1 });
        await submit(transition, "different-model");
        await submit(transition, "fixture-model", { resourceId: "floorplan" });
    } finally {
        Object.defineProperty(globalThis, "crypto", original);
    }
    expect(keys[1]).toBe(keys[0]);
    expect(new Set(keys.slice(1)).size).toBe(7);
    expect(keys.every((key) => new TextEncoder().encode(key).length <= 160)).toBe(true);
});
