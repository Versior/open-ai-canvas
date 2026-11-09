import { expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import { directorJob, directorPlanOutput } from "./video-director-data";
const dom = new Window({ url: "http://localhost/video-replication" });
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    localStorage: dom.localStorage,
    HTMLElement: dom.HTMLElement,
    Element: dom.Element,
    HTMLAnchorElement: dom.HTMLAnchorElement,
    SVGElement: dom.SVGElement,
    ShadowRoot: dom.ShadowRoot,
    MutationObserver: dom.MutationObserver,
    ResizeObserver: dom.ResizeObserver,
    Image: dom.Image,
    CustomEvent: dom.CustomEvent,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
}))
    Object.defineProperty(globalThis, key, { configurable: true, value });
const { act, useState } = await import("react");
const { createRoot } = await import("react-dom/client");
const { defaultConfig } = await import("@/stores/use-config-store");
const { setActiveUserScope } = await import("@/lib/user-scope");
const { normalizeRemakeJob } = await import("@/lib/remake/job");
setActiveUserScope("synthetic-owner");
mock.module("@/components/model-picker", () => ({ ModelPicker: () => <span>导演模型选择器</span> }));
let finish: (result: { text: string }) => void = () => {};
const requests: { prompt: string; expectedUserScope: string; referenceImages?: { storageKey?: string }[] }[] = [];
const generation = await import("@/services/api/generation-task");
mock.module("@/services/api/generation-task", () => ({
    ...generation,
    runBackendGenerationTask: async (input: { prompt: string; expectedUserScope: string }) => {
        requests.push(input);
        return new Promise((resolve) => {
            finish = resolve;
        });
    },
}));
const { RemakeDirectorPlanner } = await import("@/pages/video-replication/remake/remake-director");
let current = directorJob;
function Harness() {
    const [job, setJob] = useState(current);
    const [busy, setBusy] = useState(false);
    return (
        <RemakeDirectorPlanner
            job={job}
            config={{
                ...defaultConfig,
                textModel: "synthetic::gpt-4o",
                channels: [
                    {
                        id: "synthetic",
                        name: "test",
                        baseUrl: "https://example.invalid",
                        apiKey: "",
                        apiFormat: "openai",
                        models: ["gpt-4o"],
                        modelCosts: [
                            { model: "gpt-4o", capabilityConfig: { version: 1, text: { contextWindowTokens: 128000, maxOutputTokens: 12000, references: { promptMaxChars: 32000, maxImages: 1, maxImageBytes: 30000000, maxVideos: 0, maxVideoBytes: 0 } } } },
                        ],
                    },
                ],
            }}
            disabled={busy}
            onBusyChange={setBusy}
            edit={(update) => {
                current = update(current);
                setJob(current);
            }}
        />
    );
}
test("real planner compares strategies, waits for selection and updates only allowed shot fields", async () => {
    const host = dom.document.createElement("div");
    dom.document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<Harness />));
    const start = Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "AI 导演策划")!;
    expect(start.disabled).toBe(false);
    await act(async () => start.click());
    expect(start.disabled).toBe(true);
    expect(requests).toHaveLength(1);
    expect(requests[0].prompt).toContain("全片策略");
    expect(requests[0].expectedUserScope).toBe("synthetic-owner");
    expect(requests[0].referenceImages?.[0]?.storageKey).toBe("resource:synthetic-product");
    expect(requests[0].prompt).toContain("新商品实拍");
    await act(async () => finish({ text: JSON.stringify({ plans: [directorPlanOutput, { ...directorPlanOutput, angle: "镜腿结构", strategy: { ...directorPlanOutput.strategy, insight: "镜腿怎样弯曲", method: "macro", narrative: "reveal" } }] }) }));
    expect(host.textContent).toContain("不知道鼻托怎样调节");
    expect(current.shots[0].director).toBeUndefined();
    const select = Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "选用这份导演策划")!;
    await act(async () => select.click());
    expect(current.shots[0].director?.action).toBe("手指轻压镜腿后松开");
    expect(current.shots[1].treatment).toBe("replace");
    expect(current.shots[2]).toEqual(directorJob.shots[2]);
    expect(requests).toHaveLength(1);
    expect(normalizeRemakeJob(JSON.parse(JSON.stringify(current)))?.activeDirectorPlanId).toBe(current.directorPlans?.[0].id);
    const selectedPlan = current.directorPlans?.find((plan) => plan.id === current.activeDirectorPlanId);
    await act(async () => start.click());
    await act(async () => finish({ text: JSON.stringify({ plans: [directorPlanOutput, { ...directorPlanOutput, angle: "另一个结构方向" }] }) }));
    expect(current.directorPlans).toHaveLength(3);
    expect(current.directorPlans).toContainEqual(selectedPlan);
    expect(current.activeDirectorPlanId).toBe(selectedPlan?.id);
    const beforeAccountChange = current;
    await act(async () => start.click());
    setActiveUserScope("another-synthetic-owner");
    await act(async () => finish({ text: JSON.stringify({ plans: [directorPlanOutput, directorPlanOutput] }) }));
    expect(current).toBe(beforeAccountChange);
    await act(async () => root.unmount());
    dom.happyDOM.abort();
});
