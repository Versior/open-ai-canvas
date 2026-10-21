import React, { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { App, ConfigProvider } from "antd";
import { useCanvasSelectionController } from "@/pages/canvas/use-canvas-selection-controller";
import { CanvasNode } from "@/components/canvas/canvas-node";
import { CanvasViewport } from "@/components/canvas/canvas-viewport";
import { getAntThemeConfig } from "@/lib/app-theme";
import { CanvasNodeActionContext } from "@/components/canvas/canvas-node-action-context";
import { CanvasEcommerceWorkbench } from "@/components/canvas/canvas-ecommerce-workbench";
import { CanvasNodeGraphContext } from "@/components/canvas/canvas-node-graph-context";
import { createCanvasNodeGraph } from "@/lib/canvas/canvas-node-graph";
import type { EcommerceCapability } from "@/lib/ecommerce/ecommerce-capabilities";
import { DEFAULT_ECOMMERCE_SETTING } from "@/services/api/ecommerce";
import { useEcommerceSettings } from "@/stores/use-ecommerce-settings";
import { DEFAULT_ECOMMERCE_BRIEF } from "@/lib/ecommerce/ecommerce-capabilities";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import { useCanvasThemeStore } from "@/stores/canvas/use-canvas-theme-store";
import { useConfigStore, defaultConfig, createModelChannel } from "@/stores/use-config-store";
import { defaultImageCapabilityConfig } from "@/lib/model-capabilities";
import { imagePresetForRatio, imageSizeConfigWithPresets } from "@/lib/image-size-presets";
import "@/styles/globals.css";

const noop = () => {};
const query = new URLSearchParams(location.search);
const dark = query.get("theme") === "dark";
const width = Number(query.get("width")) || 540;
const scale = Number(query.get("scale")) || 1;
const scenario = query.get("scenario");
if (scenario === "parameters") {
    const image = defaultImageCapabilityConfig("openai-image");
    image.size = imageSizeConfigWithPresets(image, ["1:1", "3:4", "16:9"].flatMap((ratio) => [imagePresetForRatio("1k", ratio), imagePresetForRatio("2k", ratio)]));
    image.size.default = "1024x1024";
    const channel = createModelChannel({ id: "layout-fixture", scope: "system", models: ["fixture-image"], modelCosts: [{ model: "fixture-image", capability: "image", protocol: "openai-image", capabilityConfig: { version: 1, image }, billingMode: "fixed_request", unitPriceMicrocredits: 1 }] });
    useConfigStore.setState({ config: { ...defaultConfig, channels: [channel], model: "layout-fixture::fixture-image", imageModel: "layout-fixture::fixture-image", imageModels: ["layout-fixture::fixture-image"] } });
}
useCanvasThemeStore.setState({ active: true, theme: dark ? "dark" : "light" });
document.documentElement.classList.toggle("dark", dark);

function Harness() {
    const containerRef = useRef<HTMLDivElement>(null);
    const [viewport, setViewport] = useState({ x: 60, y: 30, k: scale });
    const [workbench, setWorkbench] = useState<{ open: boolean; capability: EcommerceCapability }>({ open: false, capability: "planning" });
    const [node, setNode] = useState<CanvasNodeData>({
        id: "studio-layout", type: CanvasNodeType.EcommerceStudio, title: "电商生图台",
        position: { x: 40, y: 60 }, width, height: 640,
        metadata: { ecommerceStudio: { brief: { ...structuredClone(DEFAULT_ECOMMERCE_BRIEF), name: "商品布局验收", ...(scenario === "parameters" ? { aspectRatio: "3:4" } : {}) } } },
    });
    const [running, setRunning] = useState(scenario === "running");
    const [lastRequest, setLastRequest] = useState("");
    const [previewed, setPreviewed] = useState("");
    const outputs: CanvasNodeData[] = scenario ? ["red", "blue"].map((color, index) => ({ id: color, type: CanvasNodeType.Image, title: `画面 ${index + 1}`, position: { x: 800, y: 0 }, width: 200, height: 200, metadata: { status: "success", storageKey: "test-" + color, content: "data:image/svg+xml," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="${color}"/></svg>`), ecommerceCandidate: { studioId: node.id } } })) : [];
    const displayNode: CanvasNodeData = scenario ? { ...node, metadata: { ...node.metadata, status: running ? "loading" : "success", ecommerceWorkbench: { capability: "planning", brief: node.metadata!.ecommerceStudio!.brief, sourceIds: [], startedAt: new Date(Date.now() - 5000).toISOString(), steps: [{ id: "planning", status: running ? "running" : "succeeded", taskId: "fixture-paid-task" }] } } } : node;
    const graph = createCanvasNodeGraph([displayNode, ...outputs], outputs.map((output) => ({ id: output.id, fromNodeId: node.id, toNodeId: output.id })));
    const nodesRef = useRef([node]);
    nodesRef.current = [node];
    const viewportRef = useRef(viewport);
    viewportRef.current = viewport;
    const selectedNodeIdsRef = useRef(new Set<string>());
    const historyPausedRef = useRef(false);
    const [interactions, setInteractions] = useState(0);
    const selection = useCanvasSelectionController({
        containerRef, nodesRef, viewportRef, selectedNodeIdsRef, historyPausedRef,
        screenToCanvas: (x, y) => ({ x: (x - viewport.x) / viewport.k, y: (y - viewport.y) / viewport.k }),
        setNodes: (update) => setNode((current) => (typeof update === "function" ? update([current]) : update)[0]!),
        setSelectedNodeIds: noop, setSelectedConnectionId: noop, cancelPendingConnectionCreate: noop,
        onCanvasSelectionStart: noop, onNodeInteractionStart: () => setInteractions((count) => count + 1),
        onNodeClick: noop, onDeselect: noop,
    });
    return <ConfigProvider theme={getAntThemeConfig(dark)}><App>
        <CanvasNodeActionContext.Provider value={{ runEcommerceWorkbench: async (request) => { setLastRequest(JSON.stringify(request)); return node.id; }, stopEcommerceWorkbench: () => setRunning(false), isEcommerceWorkbenchRunning: () => running, viewImage: (image) => setPreviewed(image.id), updateMetadata: (_, patch) => setNode((current) => ({ ...current, metadata: { ...current.metadata, ...patch } })), updateNode: (_, update) => setNode(update), openEcommerceWorkbench: (_, capability = "planning") => { useEcommerceSettings.getState().commit(structuredClone(DEFAULT_ECOMMERCE_SETTING)); setWorkbench({ open: true, capability }); } }}>
            <CanvasNodeGraphContext.Provider value={graph}>
            <div data-studio-brief={JSON.stringify(node.metadata?.ecommerceStudio?.brief)} data-node-interactions={interactions} data-last-request={lastRequest} data-previewed={previewed} data-running={running} style={{ width: "100vw", height: "100vh" }}>
            <CanvasViewport containerRef={containerRef} viewport={viewport} onViewportChange={setViewport}>
                <CanvasNode data={displayNode} scale={viewport.k} isSelected={false} isRelated={false} isFocusRelated={false} isConnectionTarget={false} showImageInfo={false} onMouseDown={selection.handleNodeMouseDown} onHoverStart={noop} onHoverEnd={noop} onConnectStart={noop} onResize={noop} onContentChange={noop} onContextMenu={noop} />
            </CanvasViewport></div>
            </CanvasNodeGraphContext.Provider>
        </CanvasNodeActionContext.Provider>
        <CanvasEcommerceWorkbench studioId={node.id} initialCapability={workbench.capability} open={workbench.open} onClose={() => setWorkbench((current) => ({ ...current, open: false }))} nodes={[node]} connections={[]} selectedIds={new Set([node.id])} busy={false} onRun={async () => { throw new Error("布局测试不提交生成任务"); }} onStop={noop} onLayers={noop} onFocus={noop} onAssets={noop} />
    </App></ConfigProvider>;
}

createRoot(document.getElementById("root")!).render(<Harness />);
