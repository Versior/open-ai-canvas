import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { reconciler } from "@react-three/fiber";
import { renderToStaticMarkup } from "react-dom/server";
import { CanvasNodeSearchModal } from "@/components/canvas/canvas-node-search-modal";
import { observeCanvasGestureActive, setCanvasGestureActive } from "@/lib/canvas/canvas-live-viewport";
import { useCanvasBatchReferences } from "@/pages/canvas/use-canvas-batch-references";
import { useCanvasRenderModel, useCanvasSemanticNodes } from "@/pages/canvas/use-canvas-render-model";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

const noop = () => {};

test("a position-only commit reuses media references without freezing geometry, edits, or the visible set", async () => {
    const originalAct = Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT");
    Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
    const fail = (error: unknown) => {
        throw error;
    };
    const root = reconciler.createContainer({} as never, 1, null, false, null, "", fail, fail, fail, null);
    const image: CanvasNodeData = { id: "source", type: CanvasNodeType.Image, title: "海岸", position: { x: 20, y: 20 }, width: 80, height: 60, metadata: { content: "first.jpg" } };
    const target = { ...image, id: "target", position: { x: 180, y: 20 } };
    const options = {
        connections: [{ id: "edge", fromNodeId: image.id, toNodeId: target.id }],
        viewport: { x: 0, y: 0, k: 1 },
        viewportSize: { width: 600, height: 400 },
        selectedNodeIds: new Set<string>(),
        collapsingBatchIds: new Set<string>(),
        assets: [],
        addedSkills: [],
        infoNodeId: null,
        cropNodeId: null,
        regionEditNodeId: null,
        imageEditNodeId: null,
        annotationNodeId: null,
        splitNodeId: null,
        upscaleNodeId: null,
        superResolveNodeId: null,
        angleNodeId: null,
        lightingNodeId: null,
        emotionNodeId: null,
        previewNodeId: null,
        contextMenu: null,
        previsNodeId: null,
        scriptEditorNodeId: null,
        dialogNodeId: null,
    };
    let model!: ReturnType<typeof useCanvasRenderModel>;
    function Probe({ source }: { source: CanvasNodeData }) {
        const nodes = [source, target];
        model = useCanvasRenderModel({ ...options, nodes, semanticNodes: useCanvasSemanticNodes(nodes) });
        return null;
    }
    const render = (source: CanvasNodeData) =>
        act(async () => {
            reconciler.updateContainer(<Probe source={source} />, root, null, null);
        });
    try {
        await render(image);
        const labels = model.resourceReferenceByNodeId,
            mentions = model.mentionReferencesByNodeId;
        const moved = { ...image, position: { x: 64, y: 32 }, updatedAt: "2026-02-01T00:00:00Z" };
        await render(moved);
        expect(model.resourceReferenceByNodeId).toBe(labels);
        expect(model.mentionReferencesByNodeId).toBe(mentions);
        expect(model.candidateNodes[0]).toBe(moved);
        expect(model.displayConnections[0].from).toBe(moved);
        const replaced = { ...moved, title: "山谷", metadata: { content: "next.jpg" } };
        await render(replaced);
        expect(model.resourceReferenceByNodeId.get(image.id)).toMatchObject({ title: "山谷", previewUrl: "next.jpg" });
        expect(model.mentionReferencesByNodeId.get(target.id)?.[0]).toMatchObject({ nodeId: image.id, title: "山谷" });
        await render({ ...replaced, position: { x: 4000, y: 32 } });
        expect(model.resourceReferenceByNodeId.has(image.id)).toBe(false);
        expect(model.mentionReferencesByNodeId.get(target.id)?.[0].previewUrl).toBe("next.jpg");
    } finally {
        await act(async () => {
            reconciler.updateContainer(null, root, null, null);
        });
        if (originalAct) Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", originalAct);
        else Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
    }
});

test("closed search and reference pickers do not enumerate image titles or sort by timestamps", () => {
    let dateReads = 0;
    let titleReads = 0;
    const nodes = Array.from({ length: 1000 }, (_, index): CanvasNodeData => ({
        id: `node-${index}`,
        type: CanvasNodeType.Image,
        position: { x: index * 100, y: 0 },
        width: 80,
        height: 60,
        metadata: { content: "image" },
        get title() {
            titleReads++;
            return `图片 ${index}`;
        },
        get updatedAt() {
            dateReads++;
            return "2026-01-01T00:00:00Z";
        },
    }));
    function ClosedPickers() {
        const { pickerModal } = useCanvasBatchReferences({ nodesRef: { current: nodes }, connectionsRef: { current: [] }, setNodes: noop, setConnections: noop, createFileNode: async () => null });
        return (
            <>
                {pickerModal}
                <CanvasNodeSearchModal open={false} nodes={nodes} onClose={noop} onFocus={noop} />
            </>
        );
    }
    renderToStaticMarkup(<ClosedPickers />);
    expect({ titleReads, dateReads }).toEqual({ titleReads: 0, dateReads: 0 });
});

test("multiple canvases and subscribers share the gesture transition without a document scan on release", () => {
    const window = new Window();
    const doc = window.document as unknown as Document;
    const one = doc.createElement("div"),
        two = doc.createElement("div");
    doc.body.append(one, two);
    const first: boolean[] = [],
        second: boolean[] = [];
    const nativeEvent = globalThis.Event;
    globalThis.Event = window.Event as typeof Event;
    const unsubscribeFirst = observeCanvasGestureActive(doc, (busy) => first.push(busy));
    setCanvasGestureActive(one, "canvasViewportInteracting", true);
    const unsubscribeSecond = observeCanvasGestureActive(doc, (busy) => second.push(busy));
    let queries = 0;
    const query = doc.querySelector.bind(doc);
    doc.querySelector = ((selector: string) => {
        queries++;
        return query(selector);
    }) as Document["querySelector"];
    try {
        setCanvasGestureActive(two, "canvasNodeDragging", true);
        setCanvasGestureActive(one, "canvasViewportInteracting", false);
        expect(first.at(-1)).toBe(true);
        expect(second.at(-1)).toBe(true);
        setCanvasGestureActive(two, "canvasNodeDragging", false);
        expect(first.at(-1)).toBe(false);
        expect(second.at(-1)).toBe(false);
        expect(queries).toBe(0);
    } finally {
        unsubscribeFirst();
        unsubscribeSecond();
        globalThis.Event = nativeEvent;
        window.happyDOM.abort();
    }
});
