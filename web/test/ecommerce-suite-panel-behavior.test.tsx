import { afterEach, expect, test } from "bun:test";
import React, { act, type ReactElement } from "react";
import { reconciler } from "@react-three/fiber";
import { App } from "antd";
import { renderToStaticMarkup } from "react-dom/server";
import { CanvasEcommerceSuitePanel, type EcommerceSuitePanelProps } from "../src/components/canvas/canvas-ecommerce-suite-panel";
import { SkillRuntimePicker } from "../src/components/skills/skill-runtime-picker";
import { ECOMMERCE_ONE_CLICK_FLOWS } from "../src/lib/ecommerce/ecommerce-oneclick";

const originalUseApp = App.useApp;
const originalAct = Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT");
let unmount: (() => Promise<void>) | undefined;
afterEach(async () => {
    await unmount?.();
    unmount = undefined;
    App.useApp = originalUseApp;
    if (originalAct) Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", originalAct);
    else Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
});

async function mountPanel() {
    Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
    let confirmation: { onOk?: (...args: unknown[]) => unknown } | undefined;
    App.useApp = (() => ({ modal: { confirm: (options: typeof confirmation) => { confirmation = options; } } })) as typeof App.useApp;
    const submitted: unknown[] = [];
    const saved: unknown[] = [];
    let props: EcommerceSuitePanelProps = {
        open: true, flow: ECOMMERCE_ONE_CLICK_FLOWS[0], suite: undefined,
        rows: [{ slotId: "first", title: "First", duty: "Hero", prompt: "Old prompt" }, { slotId: "second", title: "Second", duty: "Detail", prompt: "" }],
        nodeBySlot: new Map(), analysisModel: "analysis", imageModel: "image", imageSize: "", imageQuality: "", directorPrompt: "",
        skillIds: [], availableSkills: [], skillsLoading: false, autoBind: false, analyzing: false,
        onAnalysisModelChange() {}, onImageModelChange() {}, onImageOptionChange() {}, onSkillIdsChange() {}, onAutoBindChange() {},
        onClearPrompts() {}, onDirectorPromptChange() {}, onAnalyze() {}, onRowChange() {}, onRowsChange(rows) { saved.push(rows); },
        onAddRow() {}, onRemoveRow() {}, onGenerate(rows) { submitted.push(rows); }, onGenerateOne() {}, onMoveRow() {}, onClose() {},
    };
    let tree: ReactElement;
    function Probe() { tree = CanvasEcommerceSuitePanel(props); return null; }
    const fail = (error: unknown) => { throw error; };
    const root = reconciler.createContainer({} as never, 1, null, false, null, "", fail, fail, fail, null);
    const render = async () => { await act(async () => { reconciler.updateContainer(<Probe />, root, null, null); }); };
    await render();
    unmount = async () => { await act(async () => { reconciler.updateContainer(null, root, null, null); }); };
    function find(predicate: (props: Record<string, any>) => boolean): Record<string, any> {
        const walk = (node: React.ReactNode): Record<string, any> | undefined => {
            if (!React.isValidElement<Record<string, any>>(node)) return;
            if (predicate(node.props)) return node.props;
            for (const child of React.Children.toArray(node.props.children)) { const found = walk(child); if (found) return found; }
        };
        const found = walk(tree!);
        if (!found) throw new Error("Panel control missing");
        return found;
    }
    return { find, submitted, saved, confirmation: () => confirmation,
        rerender: async (patch: Partial<EcommerceSuitePanelProps>) => { props = { ...props, ...patch }; await render(); },
    };
}

test("partial generation submits the latest edited rows, never the modal close callback", async () => {
    const panel = await mountPanel();
    await act(async () => { panel.find((p) => p["aria-label"] === "First 提示词").onChange({ target: { value: "Edited prompt" } }); });
    await act(async () => { panel.find((p) => p.title === "按这张表批量提交出图任务").onClick(); });
    expect(panel.confirmation()?.onOk).toBeFunction();
    await act(async () => { panel.confirmation()!.onOk!(() => {}); });
    expect(panel.submitted).toEqual([[{ slotId: "first", title: "First", duty: "Hero", prompt: "Edited prompt" }, { slotId: "second", title: "Second", duty: "Detail", prompt: "" }]]);
    expect(panel.saved).toEqual(panel.submitted);
});

test("changing skill selection with equivalent upstream rows preserves local edits", async () => {
    const panel = await mountPanel();
    await act(async () => { panel.find((p) => p["aria-label"] === "第 1 屏的标题").onChange({ target: { value: "Edited title" } }); });
    await panel.rerender({ skillIds: ["chosen"], rows: [{ slotId: "first", title: "First", duty: "Hero", prompt: "Old prompt" }, { slotId: "second", title: "Second", duty: "Detail", prompt: "" }] });
    expect(panel.find((p) => p["aria-label"] === "第 1 屏的标题").value).toBe("Edited title");
});

test("skill selector exposes its supplied accessible label", () => {
    const html = renderToStaticMarkup(<SkillRuntimePicker skills={[]} value={[]} onChange={() => {}} ariaLabel="Analysis skills" />);
    expect(html).toContain('aria-label="Analysis skills"');
});

test("new analysis rows replace the previous local draft", async () => {
    const panel = await mountPanel();
    await act(async () => { panel.find((p) => p["aria-label"] === "First 提示词").onChange({ target: { value: "Local draft" } }); });
    await panel.rerender({ rows: [{ slotId: "first", title: "First", duty: "Hero", prompt: "New analysis" }] });
    expect(panel.find((p) => p["aria-label"] === "First 提示词").value).toBe("New analysis");
});

test("empty prompts never offer partial generation", async () => {
    const panel = await mountPanel();
    await panel.rerender({ rows: [{ slotId: "first", title: "First", duty: "Hero", prompt: "  " }] });
    await act(async () => { panel.find((p) => p.title === "按这张表批量提交出图任务").onClick(); });
    expect(panel.confirmation()).toBeDefined();
    expect(panel.confirmation()?.onOk).toBeUndefined();
    expect(panel.submitted).toEqual([]);
    expect(panel.saved).toEqual([]);
});

test("clear prompts also clears edits when upstream prompts were already empty", async () => {
    const panel = await mountPanel();
    await panel.rerender({ rows: [{ slotId: "first", title: "First", duty: "Hero", prompt: "" }] });
    await act(async () => { panel.find((p) => p["aria-label"] === "First 提示词").onChange({ target: { value: "Local draft" } }); });
    await act(async () => { panel.find((p) => p.title === "清空所有提示词").onClick(); });
    await act(async () => { panel.confirmation()!.onOk!(); });
    expect(panel.find((p) => p["aria-label"] === "First 提示词").value).toBe("");
});
