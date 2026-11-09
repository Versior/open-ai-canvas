import { afterAll, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import type { VideoReplicationDetail, VideoTeardownBundle } from "@/services/api/video-replication";

const dom = new Window({ url: "http://localhost/video-replication" });
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    HTMLInputElement: dom.HTMLInputElement,
    HTMLTextAreaElement: dom.HTMLTextAreaElement,
    HTMLAnchorElement: dom.HTMLAnchorElement,
    HTMLBodyElement: dom.HTMLBodyElement,
    HTMLHtmlElement: dom.HTMLHtmlElement,
    Element: dom.Element,
    Node: dom.Node,
    SVGElement: dom.SVGElement,
    ShadowRoot: dom.ShadowRoot,
    Event: dom.Event,
    MouseEvent: dom.MouseEvent,
    MutationObserver: dom.MutationObserver,
    ResizeObserver: dom.ResizeObserver,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
}))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
const { act, useState } = await import("react");
const { createRoot } = await import("react-dom/client");
const { App } = await import("antd");
const { defaultConfig } = await import("@/stores/use-config-store");
const capabilities = await import("@/lib/model-capabilities");
const selection = await import("@/lib/model-selection");
mock.module("@/lib/model-capabilities", () => ({ ...capabilities, modelCapabilityConfigFor: () => ({ text: { references: { maxImages: 4 } } }) }));
mock.module("@/lib/model-selection", () => ({ ...selection, modelCompatibilityError: () => "" }));
mock.module("@/components/model-picker", () => ({
    ModelPicker: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
        <select aria-label="分析模型" value={value} onChange={(event) => onChange(event.target.value)}>
            <option value="vision-a">模型 A</option>
            <option value="vision-b">模型 B</option>
        </select>
    ),
}));
mock.module("@/components/generation-cost-notice", () => ({ GenerationCostNotice: () => null, TaskSettlement: () => null }));
for (const [path, name] of [
    ["@/pages/video-replication/replication-player", "ReplicationPlayer"],
    ["@/pages/video-replication/replication-shots", "ReplicationShots"],
    ["@/pages/video-replication/replication-structure", "ReplicationStructure"],
    ["@/pages/video-replication/replication-timeline", "ReplicationTimeline"],
])
    mock.module(path, () => ({ [name]: () => null }));
mock.module("@/pages/video-replication/replication-plan", () => ({ ReplicationPlan: () => <div>已保存的复刻方案</div>, ReplicationCanvasStep: () => null }));
const { ReplicationWorkspace } = await import("@/pages/video-replication/replication-workspace");
const { videoReplicationAnalysisDocument } = await import("@/lib/canvas/video-teardown");
afterAll(() => dom.happyDOM.abort());

const bundle: VideoTeardownBundle = {
    version: 1,
    source: { resourceId: "source", durationMs: 1000, width: 100, height: 100, hasAudio: false },
    shots: [{ index: 1, startMs: 0, endMs: 1000, boundary: "start", keyframeTimeMs: 500, keyframeResourceId: "frame", keyframeWidth: 100, keyframeHeight: 100 }],
    grids: [{ resourceId: "grid", shotIndexes: [1], width: 100, height: 100 }],
    transcript: { source: "none", segments: [] },
    warnings: [],
};
const detail: VideoReplicationDetail = {
    task: { id: "teardown", type: "replication_teardown", status: "succeeded", prompt: "", attempts: 1, createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z", resultJson: JSON.stringify(bundle) },
    analysis: videoReplicationAnalysisDocument(
        {
            title: "原分析保留",
            summary: null,
            rows: [
                {
                    shotNumber: 1,
                    plotDescription: "原镜头",
                    dialogue: "",
                    dialogueSource: "none",
                    onScreenText: "",
                    shotSize: "近景",
                    camera: "平视",
                    motion: "固定",
                    production: "实拍",
                    productionConfidence: "中",
                    imageGenerationPrompt: "",
                    videoMotionPrompt: "",
                },
            ],
        },
        "vision-a",
        [],
    ),
};

for (const view of ["teardown", "plan", "canvas"] as const) {
    test(`已有分析重新失败，${view} 视图直接选模型并提交，原分析保持`, async () => {
        const host = document.createElement("div");
        document.body.append(host);
        const root = createRoot(host);
        const starts: Array<{ model: string; title: string }> = [];
        function Harness() {
            const [model, setModel] = useState("vision-a");
            return (
                <App>
                    <ReplicationWorkspace
                        detail={detail}
                        loading={false}
                        error=""
                        run={{ id: "teardown", stage: "analyze", detail: "分析镜头", error: "模型服务暂时不可用" }}
                        busy={false}
                        opening={false}
                        config={defaultConfig}
                        model={model}
                        onModelChange={setModel}
                        onReanalyze={(title) => starts.push({ model, title })}
                        onOpenCanvas={async () => null}
                        onBack={() => {}}
                        view={view}
                        onViewChange={() => {}}
                        onRemake={() => {}}
                    />
                </App>
            );
        }
        try {
            await act(async () => root.render(<Harness />));
            const picker = host.querySelector<HTMLSelectElement>('[aria-label="分析模型"]');
            expect(picker).not.toBeNull();
            await act(async () => {
                picker!.value = "vision-b";
                picker!.dispatchEvent(new Event("change", { bubbles: true }));
            });
            expect(starts).toEqual([]);
            const retry = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "重试分析");
            expect(retry).toBeDefined();
            expect(retry!.disabled).toBe(false);
            await act(async () => retry!.click());
            expect(starts).toEqual([{ model: "vision-b", title: "原分析保留" }]);
            expect(host.textContent).toContain("原分析保留");
            if (view === "plan") expect(host.textContent).toContain("已保存的复刻方案");
        } finally {
            await act(async () => root.unmount());
            host.remove();
        }
    });
}

test("视频生成失败后有明确的更换模型入口，点击只打开设置", async () => {
    const { RemakeProduce } = await import("@/pages/video-replication/remake/remake-produce");
    const { directorJob } = await import("./video-director-data");
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    let settingsOpened = 0;
    const failed = {
        ...directorJob,
        status: "failed" as const,
        units: [{ key: "unit", shotIndexes: [1], treatment: "remake" as const, startMs: 0, endMs: 6000, clipStartMs: 0, clipEndMs: 6000, status: "failed" as const, attempt: 1, takes: [], chosen: 0, error: "视频模型暂时不可用" }],
    };
    try {
        await act(async () =>
            root.render(
                <App>
                    <RemakeProduce job={failed} config={defaultConfig} onEditRecipe={() => settingsOpened++} />
                </App>,
            ),
        );
        const change = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "更换模型");
        expect(change).toBeDefined();
        expect(settingsOpened).toBe(0);
        await act(async () => change!.click());
        expect(settingsOpened).toBe(1);
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
});
