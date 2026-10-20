import { afterEach, expect, test } from "bun:test";
import React, { act, type ReactElement } from "react";
import { reconciler } from "@react-three/fiber";
import { App } from "antd";
import { renderToStaticMarkup } from "react-dom/server";
import { CanvasEcommerceSuitePanel, type EcommerceSuitePanelProps } from "../src/components/canvas/canvas-ecommerce-suite-panel";
import { SkillRuntimePicker } from "../src/components/skills/skill-runtime-picker";
import { ECOMMERCE_ONE_CLICK_FLOWS } from "../src/lib/ecommerce/ecommerce-oneclick";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";

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
    App.useApp = (() => ({
        modal: {
            confirm: (options: typeof confirmation) => {
                confirmation = options;
            },
        },
    })) as typeof App.useApp;
    const submitted: unknown[] = [];
    const saved: unknown[] = [];
    let props: EcommerceSuitePanelProps = {
        open: true,
        flow: ECOMMERCE_ONE_CLICK_FLOWS[0],
        suite: undefined,
        rows: [
            { slotId: "first", title: "First", duty: "Hero", prompt: "Old prompt" },
            { slotId: "second", title: "Second", duty: "Detail", prompt: "" },
        ],
        nodeBySlot: new Map(),
        analysisModel: "analysis",
        imageModel: "image",
        imageSize: "",
        imageQuality: "",
        skillIds: [],
        availableSkills: [],
        skillsLoading: false,
        autoBind: false,
        analyzing: false,
        onAnalysisModelChange() {},
        onImageModelChange() {},
        onImageOptionChange() {},
        onSkillIdsChange() {},
        onAutoBindChange() {},
        onClearPrompts() {},
        onAnalyze() {},
        onRowChange() {},
        onRowsChange(rows) {
            saved.push(rows);
        },
        onAddRow() {},
        onRemoveRow() {},
        onGenerate(rows) {
            submitted.push(rows);
        },
        onGenerateOne() {},
        onMoveRow() {},
        onClose() {},
    };
    let tree: ReactElement;
    function Probe() {
        tree = CanvasEcommerceSuitePanel(props);
        return null;
    }
    const fail = (error: unknown) => {
        throw error;
    };
    const root = reconciler.createContainer({} as never, 1, null, false, null, "", fail, fail, fail, null);
    const render = async () => {
        await act(async () => {
            reconciler.updateContainer(<Probe />, root, null, null);
        });
    };
    await render();
    unmount = async () => {
        await act(async () => {
            reconciler.updateContainer(null, root, null, null);
        });
    };
    function find(predicate: (props: Record<string, any>) => boolean): Record<string, any> {
        const walk = (node: React.ReactNode): Record<string, any> | undefined => {
            if (!React.isValidElement<Record<string, any>>(node)) return;
            if (predicate(node.props)) return node.props;
            for (const child of React.Children.toArray(node.props.children)) {
                const found = walk(child);
                if (found) return found;
            }
        };
        const found = walk(tree!);
        if (!found) throw new Error("Panel control missing");
        return found;
    }
    return {
        find,
        submitted,
        saved,
        confirmation: () => confirmation,
        rerender: async (patch: Partial<EcommerceSuitePanelProps>) => {
            props = { ...props, ...patch };
            await render();
        },
    };
}

test("partial generation submits the latest edited rows, never the modal close callback", async () => {
    const panel = await mountPanel();
    await act(async () => {
        panel.find((p) => p["aria-label"] === "First 提示词").onChange({ target: { value: "Edited prompt" } });
    });
    await act(async () => {
        panel.find((p) => p.title === "按这张表批量提交出图任务").onClick();
    });
    expect(panel.confirmation()?.onOk).toBeFunction();
    await act(async () => {
        panel.confirmation()!.onOk!(() => {});
    });
    expect(panel.submitted).toEqual([
        [
            { slotId: "first", title: "First", duty: "Hero", prompt: "Edited prompt" },
            { slotId: "second", title: "Second", duty: "Detail", prompt: "" },
        ],
    ]);
    expect(panel.saved).toEqual(panel.submitted);
});

test("closing the panel saves the latest local draft", async () => {
    const panel = await mountPanel();
    let closed = 0;
    await panel.rerender({
        onClose: () => {
            closed += 1;
        },
    });
    await act(async () => {
        panel.find((p) => p["aria-label"] === "First 提示词").onChange({ target: { value: "Keep my edit" } });
    });
    await act(async () => {
        panel.find((p) => p.children === "关闭").onClick();
    });
    expect(closed).toBe(1);
    expect(panel.saved.at(-1)).toEqual([expect.objectContaining({ prompt: "Keep my edit" }), expect.anything()]);
});

test("a previous successful preview cannot enable another submission while generating", async () => {
    const panel = await mountPanel();
    await panel.rerender({ generating: true });
    expect(panel.find((p) => p["aria-label"] === "只出这一张：First").disabled).toBe(true);
});

test("local result adoption immediately updates preview and binding input before closing", async () => {
    const panel = await mountPanel();
    const first: CanvasNodeData = { id: "old", type: CanvasNodeType.Image, title: "Old", position: { x: 0, y: 0 }, metadata: { ecommerceShotId: "first", ecommerceFlowId: "detail", storageKey: "image:old" } };
    const latest = { ...first, id: "latest", title: "Latest", metadata: { ...first.metadata, storageKey: "image:latest" } };
    let bound: unknown;
    await panel.rerender({
        rows: [{ slotId: "first", title: "First", duty: "Hero", prompt: "New plan" }],
        nodeBySlot: new Map([["first", latest]]),
        candidatesBySlot: new Map([["first", [first, latest]]]),
        onBind: async (rows) => {
            bound = rows;
        },
    });
    await act(async () => {
        panel.find((p) => p["aria-label"] === "First 采用结果").onChange({ target: { value: "old" } });
    });
    expect(panel.find((p) => p.node?.id === "old").node).toBe(first);
    await act(async () => {
        await panel.find((p) => p.title === "按当前行顺序和采用版本拼长图").onClick();
    });
    expect(bound).toEqual([expect.objectContaining({ resultNodeId: "old" })]);
    expect(panel.saved).toEqual([]);
});

test("analysis receives the edited duties and latest rows", async () => {
    const panel = await mountPanel();
    let analyzed: unknown;
    await panel.rerender({
        onAnalyze: (rows) => {
            analyzed = rows;
        },
    });
    await act(async () => {
        panel.find((p) => p["aria-label"] === "First 要解决什么").onChange({ target: { value: "New direction" } });
    });
    await act(async () => {
        panel.find((p) => p.title === "分析商品图与参考图").onClick();
    });
    expect(analyzed).toEqual([expect.objectContaining({ duty: "New direction" }), expect.anything()]);
    expect(panel.saved.at(-1)).toEqual(analyzed);
});

test("changing skill selection with equivalent upstream rows preserves local edits", async () => {
    const panel = await mountPanel();
    await act(async () => {
        panel.find((p) => p["aria-label"] === "第 1 屏的标题").onChange({ target: { value: "Edited title" } });
    });
    await panel.rerender({
        skillIds: ["chosen"],
        rows: [
            { slotId: "first", title: "First", duty: "Hero", prompt: "Old prompt" },
            { slotId: "second", title: "Second", duty: "Detail", prompt: "" },
        ],
    });
    expect(panel.find((p) => p["aria-label"] === "第 1 屏的标题").value).toBe("Edited title");
});

test("skill selector exposes its supplied accessible label", () => {
    const html = renderToStaticMarkup(<SkillRuntimePicker skills={[]} value={[]} onChange={() => {}} ariaLabel="Analysis skills" />);
    expect(html).toContain('aria-label="Analysis skills"');
});

test("new analysis rows replace the previous local draft", async () => {
    const panel = await mountPanel();
    await act(async () => {
        panel.find((p) => p["aria-label"] === "First 提示词").onChange({ target: { value: "Local draft" } });
    });
    await panel.rerender({ rows: [{ slotId: "first", title: "First", duty: "Hero", prompt: "New analysis" }] });
    expect(panel.find((p) => p["aria-label"] === "First 提示词").value).toBe("New analysis");
});

test("empty prompts never offer partial generation", async () => {
    const panel = await mountPanel();
    await panel.rerender({ rows: [{ slotId: "first", title: "First", duty: "Hero", prompt: "  " }] });
    await act(async () => {
        panel.find((p) => p.title === "按这张表批量提交出图任务").onClick();
    });
    expect(panel.confirmation()).toBeDefined();
    expect(panel.confirmation()?.onOk).toBeUndefined();
    expect(panel.submitted).toEqual([]);
    expect(panel.saved).toEqual([]);
});

test("supplementary information replaces director editing and file import", async () => {
    const panel = await mountPanel();
    await act(async () => {
        panel.find((p) => p.title === "补充平台、张数和商品信息").onClick();
    });
    expect(panel.find((p) => p.label === "发布平台").choices).toContain("Amazon");
    expect(panel.find((p) => p["aria-label"] === "计划张数")).toBeDefined();
    expect(() => panel.find((p) => p["aria-label"] === "分析提示词")).toThrow();
    expect(() => panel.find((p) => p.type === "file")).toThrow();
    let latest: unknown;
    await panel.rerender({
        onBriefChange: (value) => {
            latest = value;
        },
    });
    await act(async () => {
        panel.find((p) => p.label === "发布平台").onChange("Amazon");
    });
    expect(latest).toMatchObject({ platform: "Amazon" });
    await act(async () => {
        panel.find((p) => p.label === "发布平台").onChange("我的专属店铺");
    });
    expect(latest).toMatchObject({ platform: "我的专属店铺" });
});

test("clear prompts also clears edits when upstream prompts were already empty", async () => {
    const panel = await mountPanel();
    await panel.rerender({ rows: [{ slotId: "first", title: "First", duty: "Hero", prompt: "" }] });
    await act(async () => {
        panel.find((p) => p["aria-label"] === "First 提示词").onChange({ target: { value: "Local draft" } });
    });
    await act(async () => {
        panel.find((p) => p.title === "清空所有提示词").onClick();
    });
    await act(async () => {
        panel.confirmation()!.onOk!();
    });
    expect(panel.find((p) => p["aria-label"] === "First 提示词").value).toBe("");
});

test("selecting a template preserves edits until confirmed and saves its snapshot", async () => {
    const panel = await mountPanel();
    const template = { id: "published", name: "Template", flow: "detail" as const, category: "服装", enabled: true, style: "Warm light", source: "Custom", shots: [{ title: "Hero", duty: "Show true product" }] };
    let brief: unknown;
    await panel.rerender({
        templates: [template],
        onBriefChange: (value) => {
            brief = value;
        },
    });
    await act(async () => {
        panel.find((p) => p.title === "补充平台、张数和商品信息").onClick();
    });
    await act(async () => {
        panel.find((p) => p["aria-label"] === "套图模板").onChange({ target: { value: "published" } });
    });
    expect(panel.find((p) => p["aria-label"] === "First 提示词").value).toBe("Old prompt");
    expect(brief).toBeUndefined();
    await act(async () => {
        panel.confirmation()!.onOk!();
    });
    expect(panel.find((p) => p["aria-label"] === "Hero 提示词").value).toBe("");
    expect(brief).toEqual({ template, imageCount: 1, style: "Warm light" });
});
