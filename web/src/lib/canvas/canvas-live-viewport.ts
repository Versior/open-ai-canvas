import type { SelectionBox, ViewportTransform } from "@/types/canvas";

export const CANVAS_VIEWPORT_PREVIEW_EVENT = "canvas:viewport-preview";
export const CANVAS_GRAPHICS_VIEWPORT_PREVIEW_EVENT = "canvas:graphics-viewport-preview";
export const CANVAS_SELECTION_PREVIEW_EVENT = "canvas:selection-preview";
export const CANVAS_NODE_DRAG_PREVIEW_EVENT = "canvas:node-drag-preview";
const CANVAS_INTERACTION_CHANGE_EVENT = "canvas:interaction-change";
const activeGestureCounts = new WeakMap<Document, number>();

export function setCanvasGestureActive(container: HTMLDivElement | null, attribute: "canvasNodeDragging" | "canvasViewportInteracting", active: boolean) {
    if (!container || (container.dataset[attribute] === "true") === active) return;
    if (active) container.dataset[attribute] = "true";
    else delete container.dataset[attribute];
    const doc = container.ownerDocument;
    const count = (activeGestureCounts.get(doc) ?? 0) + (active ? 1 : -1);
    if (count > 0) activeGestureCounts.set(doc, count);
    else activeGestureCounts.delete(doc);
    doc.dispatchEvent(new Event(CANVAS_INTERACTION_CHANGE_EVENT));
}

export function observeCanvasGestureActive(doc: Document, listener: (active: boolean) => void) {
    const update = () => listener(activeGestureCounts.has(doc));
    doc.addEventListener(CANVAS_INTERACTION_CHANGE_EVENT, update);
    update();
    return () => doc.removeEventListener(CANVAS_INTERACTION_CHANGE_EVENT, update);
}

export type CanvasNodeDragPreview = {
    x: number;
    y: number;
    nodeIds: ReadonlySet<string>;
    guides?: { vertical?: number; horizontal?: number };
};

type NodeDragPreviewDomState = {
    nodeIds: ReadonlySet<string>;
    translatedLayer: HTMLElement | null;
    individualNodes: Map<HTMLElement, boolean>;
    observer: MutationObserver | null;
    x: number;
    y: number;
    selectionBounds: HTMLElement | null;
};

type NodeSelectionPreviewDomState = {
    elementsById: Map<string, HTMLElement>;
    previousStates: Map<string, "include" | "remove">;
};

export type CanvasNodeSelectionPreview = {
    includeNodeIds: ReadonlySet<string>;
    removeNodeIds: ReadonlySet<string>;
};

const nodeDragPreviewDomStates = new WeakMap<HTMLDivElement, NodeDragPreviewDomState>();
const nodeSelectionPreviewDomStates = new WeakMap<HTMLDivElement, NodeSelectionPreviewDomState>();
const liveViewportElements = new WeakMap<HTMLDivElement, { worldLayer: HTMLElement | null; gridLayer: HTMLElement | null }>();

/** 网格层向左上多铺的像素，需大于最大网格间距，保证平移取模后仍覆盖视口。 */
export const CANVAS_GRID_BLEED = 64;

/**
 * 网格跟随视口平移与缩放：间距随 k 缩放，并在 [base*2/3, base*4/3) 内按 2 倍折叠，
 * 保持屏幕密度稳定。平移只改 transform（合成层），缩放才改 background-size。
 */
export function canvasGridMetrics(viewport: ViewportTransform, base: number) {
    let spacing = base * viewport.k;
    if (!Number.isFinite(spacing) || spacing <= 0) spacing = base;
    while (spacing < (base * 2) / 3) spacing *= 2;
    while (spacing >= (base * 4) / 3) spacing /= 2;
    const wrap = (value: number) => ((value % spacing) + spacing) % spacing;
    return { spacing, offsetX: wrap(viewport.x + CANVAS_GRID_BLEED), offsetY: wrap(viewport.y + CANVAS_GRID_BLEED) };
}

function applyCanvasGridViewport(gridLayer: HTMLElement, viewport: ViewportTransform) {
    const base = Number(gridLayer.dataset.canvasGridBase) || 24;
    const { spacing, offsetX, offsetY } = canvasGridMetrics(viewport, base);
    const size = `${spacing}px ${spacing}px`;
    if (gridLayer.style.backgroundSize !== size) gridLayer.style.backgroundSize = size;
    gridLayer.style.transform = `translate3d(${offsetX}px, ${offsetY}px, 0)`;
}

export function applyCanvasLiveViewport(container: HTMLDivElement | null, viewport: ViewportTransform, notify = true) {
    if (!container) return;
    const committedScale = Number(container.style.getPropertyValue("--canvas-committed-scale")) || viewport.k;
    let elements = liveViewportElements.get(container);
    if (!elements) {
        elements = { worldLayer: null, gridLayer: null };
        liveViewportElements.set(container, elements);
    }
    if (!elements.worldLayer?.isConnected) elements.worldLayer = container.querySelector<HTMLElement>("[data-canvas-world-layer]");
    // 网格层会随“点/线/空白”切换挂载与卸载，失联后重新查找。
    if (!elements.gridLayer?.isConnected) elements.gridLayer = container.querySelector<HTMLElement>("[data-canvas-grid-layer]");
    const worldLayer = elements.worldLayer;
    if (worldLayer) {
        // 平移期间直接更新合成层，避免修改容器继承变量导致所有节点重新计算样式。
        worldLayer.style.transformOrigin = "0 0";
        worldLayer.style.transform = `translate3d(${viewport.x}px, ${viewport.y}px, 0) scale(${viewport.k / committedScale})`;
        const willChange = container.dataset.canvasViewportInteracting === "true" ? "transform" : "";
        if (worldLayer.style.willChange !== willChange) worldLayer.style.willChange = willChange;
    }
    if (elements.gridLayer) applyCanvasGridViewport(elements.gridLayer, viewport);
    // 交互期不要修改根容器上的继承变量。它们会让整棵节点 DOM 子树失效并
    // 触发样式重算；交互结束后由 CanvasViewport 的 committed render 一次性校正。
    // 标题和选框在交互期暂时跟随世界层缩放，换取连续帧的合成路径。
    if (container.dataset.canvasViewportInteracting !== "true") {
        container.style.setProperty("--canvas-live-scale", String(viewport.k));
        container.style.setProperty("--canvas-live-inverse-scale", String(1 / Math.max(viewport.k, 0.05)));
    }
    // 图形层必须逐帧跟随 DOM 世界层；浮层和滚动通知仍可按原频率节流。
    container.dispatchEvent(new CustomEvent<ViewportTransform>(CANVAS_GRAPHICS_VIEWPORT_PREVIEW_EVENT, { detail: viewport }));
    if (notify) {
        container.dispatchEvent(new CustomEvent<ViewportTransform>(CANVAS_VIEWPORT_PREVIEW_EVENT, { detail: viewport }));
        // Ant Design overlays watch scrollable ancestors, but CSS transforms do not emit layout events.
        container.dispatchEvent(new Event("scroll"));
    }
}

export function subscribeCanvasGraphicsViewportPreview(container: HTMLDivElement, listener: (viewport: ViewportTransform) => void) {
    const handlePreview = (event: Event) => listener((event as CustomEvent<ViewportTransform>).detail);
    container.addEventListener(CANVAS_GRAPHICS_VIEWPORT_PREVIEW_EVENT, handlePreview);
    return () => container.removeEventListener(CANVAS_GRAPHICS_VIEWPORT_PREVIEW_EVENT, handlePreview);
}

export function subscribeCanvasViewportPreview(container: HTMLDivElement, listener: (viewport: ViewportTransform) => void) {
    const handlePreview = (event: Event) => listener((event as CustomEvent<ViewportTransform>).detail);
    container.addEventListener(CANVAS_VIEWPORT_PREVIEW_EVENT, handlePreview);
    return () => container.removeEventListener(CANVAS_VIEWPORT_PREVIEW_EVENT, handlePreview);
}

export const CANVAS_ACTIVE_NODE_SLOT = "canvas-active";

export function prepareCanvasNodeLayer(layer: HTMLDivElement | null) {
    if (!layer || layer.shadowRoot) return;
    const doc = layer.ownerDocument;
    const shadow = layer.attachShadow({ mode: "open" });
    const group = doc.createElement("div");
    group.style.cssText = "position:absolute;left:0;top:0;z-index:var(--z-node-active)";
    const activeSlot = doc.createElement("slot");
    activeSlot.name = CANVAS_ACTIVE_NODE_SLOT;
    group.append(activeSlot);
    shadow.append(doc.createElement("slot"), group);
}

function mountNodeDragPreview(container: HTMLDivElement, nodeIds: ReadonlySet<string>): NodeDragPreviewDomState {
    const layer = container.querySelector<HTMLElement>("[data-canvas-node-layer]");
    const activeGroup = layer?.shadowRoot?.querySelector<HTMLElement>("div") || null;
    const elements = Array.from(layer ? layer.children : container.querySelectorAll<HTMLElement>("[data-node-id]")).filter((element): element is HTMLElement => element instanceof HTMLElement && Boolean(element.dataset.nodeId));
    let directWrites = 0;
    let activeWrites = 1;
    for (const node of elements) {
        const moving = nodeIds.has(node.dataset.nodeId!);
        if (moving) directWrites++;
        if (moving !== (node.slot === CANVAS_ACTIVE_NODE_SLOT)) activeWrites++;
    }
    const wholeLayerWrites = elements.length - directWrites + 1;
    const translatedLayer = activeGroup && activeWrites < Math.min(directWrites, wholeLayerWrites) ? activeGroup : layer && wholeLayerWrites < directWrites ? layer : null;
    const state: NodeDragPreviewDomState = { nodeIds, translatedLayer, individualNodes: new Map(), observer: null, x: 0, y: 0, selectionBounds: null };
    const classify = (element: HTMLElement) => {
        const moving = nodeIds.has(element.dataset.nodeId!);
        const layerMoves = Boolean(translatedLayer && (translatedLayer === layer || element.slot === CANVAS_ACTIVE_NODE_SLOT));
        if (moving === layerMoves) {
            if (state.individualNodes.delete(element)) element.style.removeProperty("translate");
        } else {
            state.individualNodes.set(element, moving);
            if (state.x || state.y) element.style.translate = moving ? `${state.x}px ${state.y}px` : `${-state.x}px ${-state.y}px`;
        }
    };
    for (const node of elements) classify(node);
    if (translatedLayer) translatedLayer.style.willChange = "transform";
    if (layer) {
        const observer = new container.ownerDocument.defaultView!.MutationObserver((records) => {
            for (const record of records) {
                if (record.target !== layer) {
                    if (record.type === "attributes" && record.target instanceof HTMLElement && record.target.parentElement === layer && record.target.dataset.nodeId) classify(record.target);
                    continue;
                }
                for (const element of record.removedNodes) {
                    if (element instanceof HTMLElement && state.individualNodes.delete(element)) element.style.removeProperty("translate");
                }
                for (const element of record.addedNodes) {
                    if (element instanceof HTMLElement && element.dataset.nodeId) classify(element);
                }
            }
        });
        observer.observe(layer, translatedLayer && translatedLayer === activeGroup ? { childList: true, subtree: true, attributeFilter: ["slot"] } : { childList: true });
        state.observer = observer;
    }
    return state;
}

export function applyCanvasNodeDragPreview(container: HTMLDivElement | null, preview: CanvasNodeDragPreview | null, selectionBounds: HTMLElement | null = null) {
    if (!container) return;
    setCanvasGestureActive(container, "canvasNodeDragging", Boolean(preview));

    let state = nodeDragPreviewDomStates.get(container);
    if (state && state.nodeIds !== preview?.nodeIds) {
        state.observer?.disconnect();
        state.translatedLayer?.style.removeProperty("will-change");
        state.translatedLayer?.style.removeProperty("translate");
        state.selectionBounds?.style.removeProperty("translate");
        for (const element of state.individualNodes.keys()) element.style.removeProperty("translate");
        nodeDragPreviewDomStates.delete(container);
        state = undefined;
    }
    if (preview) {
        if (!state) {
            state = mountNodeDragPreview(container, preview.nodeIds);
            nodeDragPreviewDomStates.set(container, state);
        }
        const moved = state.x !== preview.x || state.y !== preview.y;
        const translate = `${preview.x}px ${preview.y}px`;
        if (moved) {
            state.x = preview.x;
            state.y = preview.y;
            const inverse = `${-preview.x}px ${-preview.y}px`;
            if (state.translatedLayer) state.translatedLayer.style.translate = translate;
            for (const [element, forward] of state.individualNodes) element.style.translate = forward ? translate : inverse;
        }
        if (state.selectionBounds !== selectionBounds) state.selectionBounds?.style.removeProperty("translate");
        if (selectionBounds && (moved || state.selectionBounds !== selectionBounds)) selectionBounds.style.translate = translate;
        state.selectionBounds = selectionBounds;
    }

    container.dispatchEvent(new CustomEvent<CanvasNodeDragPreview | null>(CANVAS_NODE_DRAG_PREVIEW_EVENT, { detail: preview }));
}

export function subscribeCanvasNodeDragPreview(container: HTMLDivElement, listener: (preview: CanvasNodeDragPreview | null) => void) {
    const handlePreview = (event: Event) => listener((event as CustomEvent<CanvasNodeDragPreview | null>).detail);
    container.addEventListener(CANVAS_NODE_DRAG_PREVIEW_EVENT, handlePreview);
    return () => container.removeEventListener(CANVAS_NODE_DRAG_PREVIEW_EVENT, handlePreview);
}

/**
 * Shows the selection delta on mounted nodes without changing React state.
 * The controller commits the final Set once on pointer-up.
 */
export function applyCanvasNodeSelectionPreview(container: HTMLDivElement | null, preview: CanvasNodeSelectionPreview | null) {
    if (!container) return;

    let state = nodeSelectionPreviewDomStates.get(container);
    if (!state) {
        state = { elementsById: new Map(), previousStates: new Map() };
        nodeSelectionPreviewDomStates.set(container, state);
    }

    const nextStates = new Map<string, "include" | "remove">();
    if (preview) {
        for (const nodeId of preview.includeNodeIds) nextStates.set(nodeId, "include");
        for (const nodeId of preview.removeNodeIds) nextStates.set(nodeId, "remove");
    }

    if (state.elementsById.size === 0 && nextStates.size > 0) {
        container.querySelectorAll<HTMLElement>("[data-node-id]").forEach((element) => {
            const nodeId = element.dataset.nodeId;
            if (nodeId) state?.elementsById.set(nodeId, element);
        });
    }

    for (const [nodeId, previousState] of state.previousStates) {
        if (nextStates.get(nodeId) === previousState) continue;
        state.elementsById.get(nodeId)?.removeAttribute("data-canvas-selection-preview");
    }
    for (const [nodeId, nextState] of nextStates) {
        if (state.previousStates.get(nodeId) === nextState) continue;
        const element = state.elementsById.get(nodeId);
        if (!element || !element.isConnected) continue;
        element.dataset.canvasSelectionPreview = nextState;
    }

    state.previousStates = nextStates;
    if (!preview) state.elementsById.clear();
}

export function applyCanvasSelectionPreview(container: HTMLDivElement | null, selection: SelectionBox) {
    container?.dispatchEvent(new CustomEvent<SelectionBox>(CANVAS_SELECTION_PREVIEW_EVENT, { detail: selection }));
}

export function subscribeCanvasSelectionPreview(container: HTMLDivElement, listener: (selection: SelectionBox) => void) {
    const handlePreview = (event: Event) => listener((event as CustomEvent<SelectionBox>).detail);
    container.addEventListener(CANVAS_SELECTION_PREVIEW_EVENT, handlePreview);
    return () => container.removeEventListener(CANVAS_SELECTION_PREVIEW_EVENT, handlePreview);
}
