import { expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import type { InteriorCatalog, InteriorProject } from "@/services/api/interior";
import type { AiConfig } from "@/stores/use-config-store";
import type { InteriorSceneHandoff } from "@/pages/interior/interior-scene-studio";
import { normalizeSceneSpec } from "@/lib/interior/scene-spec";

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
        title: "Measured drawing",
        grid: { source: "drawing", width: 6, depth: 4, image: [100, 100, 900, 900] },
        floors: [{ name: "1F", height: 3, rooms: [{ name: "客厅", type: "living", rect: [0, 0, 6, 4] }], furniture: [{ type: "sofa", room: "客厅", at: "n", size: [2, 0.9] }], doors: [], windows: [], stairs: [], balconies: [], pillars: [] }],
        roof: { type: "none" },
    },
    "home",
);
const scene = { version: 2 as const, title: spec.title, summary: spec.summary, spec };
const baselineNotice = "人工校准参考版，未标尺寸的内隔墙为估算。";
const api = await import("@/services/api/interior");
mock.module("@/services/api/interior", () => ({ ...api, getInteriorDrawingBaseline: async () => ({ projectId: "baseline-project", sceneId: "baseline-scene", title: scene.title, notice: baselineNotice, sceneFile: { resourceId: "baseline-resource" } }) }));
const tasks = await import("@/pages/interior/interior-scene-tasks");
let submissions = 0;
const requests: { prompt: string; stage: string }[] = [];
let savedScene: typeof scene | undefined;
mock.module("@/pages/interior/interior-scene-tasks", () => ({
    ...tasks,
    loadSceneFile: async () => savedScene || scene,
    fetchSceneKnowledge: async () => ({ knowledge: [], refs: [] }),
    saveSceneFile: async (value: typeof scene) => {
        savedScene = value;
        return { resourceId: "finished-resource" };
    },
    submitSceneTask: async (_config: AiConfig, _model: string, prompt: string, stage: string) => {
        submissions++;
        requests.push({ prompt, stage });
        return { id: "finishing-task" };
    },
}));
const taskApi = await import("@/services/api/task-center");
mock.module("@/services/api/task-center", () => ({
    ...taskApi,
    waitForGenerationTask: async () => ({ resultJson: JSON.stringify({ text: JSON.stringify({ scope: "home", title: "Finished drawing", floors: [{ name: "1F", rooms: [{ name: "客厅", floor: "wood" }] }] }) }) }),
}));
mock.module("@/components/model-picker", () => ({ ModelPicker: () => null }));
mock.module("@/components/generation-cost-notice", () => ({ GenerationCostNotice: () => null, TaskSettlement: () => null }));
mock.module("@/pages/interior/interior-scene-build", () => ({ InteriorSceneBuildStage: () => <div data-testid="pending-build" /> }));
mock.module("@/pages/interior/interior-scene-viewer", () => ({ InteriorSceneViewer: () => <div data-testid="restored-viewer">Measured drawing loaded</div> }));
const { InteriorSceneStudio } = await import("@/pages/interior/interior-scene-studio");
let project: InteriorProject = {
    id: "target-project",
    name: "Failed drawing",
    kind: "home",
    revision: 1,
    createdAt: "2026-11-09",
    updatedAt: "2026-11-09",
    document: {
        version: 1,
        rounds: [],
        scenes: [
            { id: "failed-scene", createdAt: "2026-11-09", status: "failed", scope: "home", description: "Read my drawing", stage: "analyze", model: "synthetic-model", reference: { resourceId: "reuploaded-source" }, error: "读图未通过校核：房间重叠" },
        ],
    },
};
let saves = 0;
const catalog: InteriorCatalog = { settings: { defaultSurface: "quick", allowSurfaceSwitch: true, maxStylesPerRun: 1, maxCountPerStyle: 1 }, modes: [], styles: [], rooms: [] };
const config: AiConfig = {
    ...defaultConfig,
    textModel: "synthetic::gpt-4o",
    channels: [
        {
            id: "synthetic",
            name: "Synthetic",
            baseUrl: "https://example.invalid",
            apiKey: "",
            apiFormat: "openai",
            models: ["gpt-4o"],
            enabled: true,
            modelCosts: [
                {
                    model: "gpt-4o",
                    capability: "text",
                    billingMode: "token",
                    unitPriceMicrocredits: 0,
                    capabilityConfig: { version: 1, text: { contextWindowTokens: 128000, maxOutputTokens: 8000, references: { promptMaxChars: 100000, maxImages: 1, maxImageBytes: 32000000, maxVideos: 0, maxVideoBytes: 0 } } },
                },
            ],
        },
    ],
};
function Harness({ initialHandoff = null }: { initialHandoff?: InteriorSceneHandoff | null }) {
    const [current, setCurrent] = useState(project);
    const [handoff, setHandoff] = useState(initialHandoff);
    return (
        <App>
            <InteriorSceneStudio
                catalog={catalog}
                config={config}
                project={current}
                header={null}
                ensureProject={async () => project}
                update={(_id, mutate) => {
                    project = { ...project, document: mutate(project.document) };
                    setCurrent(project);
                }}
                saveProject={async () => {
                    saves++;
                }}
                onBusyChange={() => {}}
                removeScene={() => {}}
                handoff={handoff}
                onHandoffUsed={() => setHandoff(null)}
                onRender={() => {}}
            />
        </App>
    );
}

test("failed drawing recovers the matched structure as a new version without paying or deleting history", async () => {
    const host = dom.document.createElement("div");
    dom.document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<Harness />));
    expect(host.textContent).toContain("图纸结构未通过校核");
    expect(host.querySelector("details")?.open).toBe(false);
    const button = Array.from(host.querySelectorAll("button")).find((item) => item.textContent === "恢复已校准结构");
    expect(button).toBeDefined();
    await act(async () => button!.click());
    expect(host.querySelector('[data-testid="restored-viewer"]')).not.toBeNull();
    expect(project.document.scenes).toHaveLength(2);
    expect(project.document.scenes?.[0]).toMatchObject({ status: "succeeded", parentId: "failed-scene", sceneFile: { resourceId: "baseline-resource" }, structureSource: { projectId: "baseline-project", sceneId: "baseline-scene" } });
    expect(project.document.scenes?.[1].status).toBe("failed");
    expect(submissions).toBe(0);
    expect(saves).toBe(2);
    await act(async () => root.unmount());
});

test("same drawing skips analysis and completes the real finishing pipeline with provenance retained", async () => {
    project = { ...project, document: { version: 1, rounds: [], scenes: [] } };
    const host = dom.document.createElement("div");
    dom.document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<Harness initialHandoff={{ id: "source-handoff", image: { resourceId: "reuploaded-source", width: 1250, height: 777 }, description: "换成原木地面" }} />));
    const button = Array.from(host.querySelectorAll("button")).find((item) => item.textContent === "生成 3D 模型");
    expect(button?.disabled, host.querySelector(".itd-muted-note")?.textContent || "missing button").toBe(false);
    await act(async () => button!.click());
    expect(requests).toHaveLength(1);
    expect(requests[0].stage).toBe("spec");
    expect(requests[0].prompt).toContain("只补充材质和家具");
    expect(requests[0].prompt).toContain(JSON.stringify(spec));
    expect(project.document.scenes?.[0]).toMatchObject({
        status: "succeeded",
        sceneFile: { resourceId: "finished-resource" },
        scope: "home",
        structureSource: { projectId: "baseline-project", sceneId: "baseline-scene", notice: baselineNotice },
        notice: baselineNotice,
    });
    expect(savedScene?.spec.grid).toEqual(spec.grid);
    expect(savedScene?.spec.floors[0].rooms[0].rect).toEqual(spec.floors[0].rooms[0].rect);
    expect(savedScene?.spec.floors[0].rooms[0].floor).toBe("wood");
    expect(savedScene?.spec.floors[0].furniture).toEqual(spec.floors[0].furniture);
    await act(async () => root.unmount());
    dom.happyDOM.abort();
});
