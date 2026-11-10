import { expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import type { InteriorCatalog, InteriorProject, InteriorSceneItem } from "@/services/api/interior";
import { normalizeSceneSpec, type InteriorSceneData } from "@/lib/interior/scene-spec";

const dom = new Window({ url: "http://localhost/" });
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    localStorage: dom.localStorage,
    HTMLElement: dom.HTMLElement,
    HTMLAnchorElement: dom.HTMLAnchorElement,
    SVGElement: dom.SVGElement,
    Element: dom.Element,
    ShadowRoot: dom.ShadowRoot,
    Image: dom.Image,
    CustomEvent: dom.CustomEvent,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    MutationObserver: dom.MutationObserver,
    ResizeObserver: dom.ResizeObserver,
    IS_REACT_ACT_ENVIRONMENT: true,
}))
    Object.defineProperty(globalThis, key, { configurable: true, value });
const { act, useState } = await import("react");
const { createRoot } = await import("react-dom/client");
const { App } = await import("antd");
const { defaultConfig } = await import("@/stores/use-config-store");
const { setActiveUserScope } = await import("@/lib/user-scope");
setActiveUserScope("synthetic-owner");
const spec = normalizeSceneSpec(
    {
        scope: "home",
        title: "合成核对图纸",
        grid: { source: "drawing", width: 6, depth: 4, x: [0, 6], z: [0, 4], image: [100, 100, 900, 900] },
        floors: [{ name: "测试层", height: 3, rooms: [{ name: "客厅", type: "living", rect: [0, 0, 6, 4] }], furniture: [] }],
        roof: { type: "none" },
    },
    "home",
);
let saved: InteriorSceneData | undefined;
let submissions = 0;
let lastPrompt = "";
const tasks = await import("@/pages/interior/interior-scene-tasks");
mock.module("@/pages/interior/interior-scene-tasks", () => ({
    ...tasks,
    fetchSceneKnowledge: async () => ({ knowledge: [], refs: [] }),
    loadSceneFile: async () => saved,
    saveSceneFile: async (value: InteriorSceneData) => {
        saved = value;
        return { resourceId: "synthetic-finished" };
    },
    submitSceneTask: async (_config: unknown, _model: string, prompt: string) => {
        submissions++;
        lastPrompt = prompt;
        return { id: "synthetic-spec-task" };
    },
}));
const taskApi = await import("@/services/api/task-center");
mock.module("@/services/api/task-center", () => ({
    ...taskApi,
    waitForGenerationTask: async (id: string) => ({
        resultJson: JSON.stringify({
            text: JSON.stringify(id === "synthetic-analyze" ? item.brief : { scope: "home", title: "合成结果", floors: [{ name: "测试层", rooms: [{ name: "客厅", floor: "wood" }], furniture: [{ type: "sofa", room: "客厅", at: "n", size: [2, 0.9] }] }] }),
        }),
    }),
}));
mock.module("@/components/model-picker", () => ({ ModelPicker: () => null }));
mock.module("@/components/generation-cost-notice", () => ({ GenerationCostNotice: () => null, TaskSettlement: () => null }));
mock.module("@/pages/interior/interior-scene-viewer", () => ({
    InteriorSceneViewer: ({ scene, activeFloor, onFloorChange }: { scene: InteriorSceneData; activeFloor: number; onFloorChange: (floor: number) => void }) => (
        <select aria-label="合成三维楼层" value={activeFloor} onChange={(event) => onFloorChange(Number(event.target.value))}>
            {scene.version === 2
                ? scene.spec.floors.map((floor, index) => (
                      <option key={index} value={index}>
                          {floor.name}
                      </option>
                  ))
                : null}
        </select>
    ),
}));
mock.module("@/pages/interior/interior-scene-build", () => ({ InteriorSceneBuildStage: () => <div>合成生成进度</div> }));
const { InteriorSceneStudio } = await import("@/pages/interior/interior-scene-studio");
const { InteriorDrawingReview } = await import("@/pages/interior/interior-drawing-review");
const catalog: InteriorCatalog = { settings: { defaultSurface: "quick", allowSurfaceSwitch: true, maxStylesPerRun: 1, maxCountPerStyle: 1 }, rooms: [], styles: [], modes: [] };
const item: InteriorSceneItem = {
    id: "synthetic-scene",
    createdAt: "2026-01-01",
    status: "review",
    stage: "analyze",
    scope: "home",
    description: "合成图纸",
    model: "synthetic::gpt-4o",
    reference: { resourceId: "synthetic-drawing" },
    brief: {
        scope: "home",
        source: "drawing",
        title: spec.title,
        summary: "",
        layout: spec,
        spaces: [{ name: "客厅" }],
        features: [],
        materials: [],
        furniture: [],
        description: "合成结构",
        renderNotes: "",
        size: { width: 6, depth: 4, floors: 1, storeyHeight: 3 },
        dimensionChains: { x: [6], z: [4] },
    },
};
let project: InteriorProject = { id: "synthetic-project", name: "合成项目", kind: "home", revision: 1, createdAt: "2026-01-01", updatedAt: "2026-01-01", document: { version: 1, rounds: [], scenes: [item] } };
function Harness() {
    const [current, setCurrent] = useState(project);
    return (
        <App>
            <InteriorSceneStudio
                catalog={catalog}
                config={defaultConfig}
                project={current}
                header={null}
                ensureProject={async () => project}
                update={(_id, mutate) => {
                    project = { ...project, document: mutate(project.document) };
                    setCurrent(project);
                }}
                saveProject={async () => {}}
                onBusyChange={() => {}}
                removeScene={() => {}}
                handoff={null}
                onHandoffUsed={() => {}}
                onRender={() => {}}
            />
        </App>
    );
}

async function chooseFloor(host: HTMLElement, label: string, name: string) {
    await act(async () => host.querySelector(`[aria-label="${label}"]`)!.dispatchEvent(new dom.MouseEvent("mousedown", { bubbles: true })));
    const option = Array.from(dom.document.querySelectorAll<HTMLElement>(".ant-select-item-option")).find((element) => element.textContent === name);
    expect(option).toBeDefined();
    await act(async () => option!.click());
}

const multiFloor = () => normalizeSceneSpec({ ...spec, floors: [spec.floors[0], { ...spec.floors[0], name: "上层", rooms: [{ ...spec.floors[0].rooms[0], name: "上层书房", type: "study" }] }] }, "home");

test("completed first drawing analysis transitions to review without submitting the furnishing task", async () => {
    project = { ...project, document: { version: 1, rounds: [], scenes: [{ ...item, status: "pending", stage: "analyze", taskId: "synthetic-analyze" }] } };
    const host = dom.document.createElement("div");
    dom.document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<Harness />));
    expect(project.document.scenes?.[0].status).toBe("review");
    expect(submissions).toBe(0);
    expect(saved).toBeUndefined();
    expect(host.textContent).toContain("先核对图纸");
    await act(async () => root.unmount());
});

test("the review state cannot spend a second model task before explicit product confirmation", async () => {
    const host = dom.document.createElement("div");
    dom.document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<Harness />));
    expect(host.textContent).toContain("先核对图纸");
    const confirm = Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "确认结构并继续建模")!;
    expect(confirm.disabled).toBe(true);
    expect(submissions).toBe(0);
    await act(async () => host.querySelector<HTMLInputElement>('.itd-drawing-review input[type="checkbox"]')!.click());
    expect(confirm.disabled).toBe(false);
    await act(async () => confirm.click());
    expect(submissions).toBe(1);
    expect(lastPrompt).toContain("用户确认层高与结构");
    expect(project.document.scenes?.[0].drawingConfirmed).toBe(true);
    expect(project.document.scenes?.[0].status).toBe("succeeded");
    expect(saved?.version).toBe(2);
    await act(async () => root.unmount());
});

test("preserve original furnishing enforces geometry even if a model adds unsolicited furniture", async () => {
    saved = undefined;
    project = { ...project, document: { version: 1, rounds: [], scenes: [{ ...item, status: "pending", stage: "spec", taskId: "synthetic-task", drawingConfirmed: true, furnishing: "preserve" }] } };
    const host = dom.document.createElement("div");
    dom.document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<Harness />));
    expect(saved?.version).toBe(2);
    if (saved?.version !== 2) throw new Error("result not saved");
    expect(saved.spec.floors[0].furniture).toHaveLength(0);
    expect(saved.spec.floors[0].rooms[0].floor).toBe("wood");
    expect(saved.spec.grid).toEqual(spec.grid);
    await act(async () => root.unmount());
});

test("multi floor drawing review exposes every floor before confirmation", async () => {
    const source = multiFloor();
    const host = dom.document.createElement("div");
    dom.document.body.append(host);
    const root = createRoot(host);
    await act(async () =>
        root.render(
            <App>
                <InteriorDrawingReview spec={source} busy={false} onConfirm={async () => {}} />
            </App>,
        ),
    );
    expect(host.querySelector('img[alt="测试层读图结构平面预览"]')).not.toBeNull();
    await chooseFloor(host, "核对图纸楼层", "上层");
    const image = host.querySelector<HTMLImageElement>('img[alt="上层读图结构平面预览"]');
    expect(image).not.toBeNull();
    expect(decodeURIComponent(image!.src)).toContain("上层书房");
    await act(async () => root.unmount());
});

test("the real studio shares the selected floor between plan, 3D and adjustment target", async () => {
    const source = multiFloor();
    saved = { version: 2, title: source.title, summary: source.summary, spec: source };
    project = { ...project, document: { version: 1, rounds: [], scenes: [{ ...item, status: "succeeded", sceneFile: { resourceId: "synthetic-multi-floor" } }] } };
    const host = dom.document.createElement("div");
    dom.document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<Harness />));
    const split = Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "2D / 3D 联动")!;
    await act(async () => split.click());
    const three = host.querySelector<HTMLSelectElement>('[aria-label="合成三维楼层"]')!;
    await act(async () => {
        three.value = "1";
        three.dispatchEvent(new dom.Event("change", { bubbles: true }));
    });
    expect(host.querySelector('svg[aria-label="上层 · 家具布置平面图"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="局部调整目标"]')?.closest(".ant-select")?.textContent).toContain("上层书房");
    await chooseFloor(host, "平面楼层", "测试层");
    expect(three.value).toBe("0");
    expect(host.querySelector('svg[aria-label="测试层 · 家具布置平面图"]')).not.toBeNull();
    await act(async () => root.unmount());
    dom.happyDOM.abort();
});
