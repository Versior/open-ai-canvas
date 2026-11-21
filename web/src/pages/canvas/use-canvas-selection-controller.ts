import { useCallback, useEffect, useRef, useState, type Dispatch, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type RefObject, type SetStateAction } from "react";

import { applyCanvasNodeDragPreview, applyCanvasNodeSelectionPreview, applyCanvasSelectionPreview } from "@/lib/canvas/canvas-live-viewport";
import { calculateNodeAlignment, createNodeAlignmentContext, sameStringSet, type NodeAlignmentContext } from "@/lib/canvas/canvas-project-domain";
import { applyFrameDrop, buildCanvasFrameDropIndex, findFrameDropTargetFromIndex, isFrameNode, type CanvasFrameDropIndex } from "@/lib/canvas/canvas-frame";
import {
    applyCanvasSelectionStrategy,
    canvasSelectionHitsBounds,
    createCanvasSelectionBounds,
    createCanvasSelectionSpatialIndexCache,
    resolveCanvasSelectionHitMode,
    resolveCanvasSelectionPreviewDelta,
    resolveCanvasSelectionStrategy,
} from "@/lib/canvas/canvas-selection";
import { canvasNodeBounds } from "@/lib/canvas/canvas-spatial-index";
import type { CanvasNodeData, Position, SelectionBox, ViewportTransform } from "@/types/canvas";

type UseCanvasSelectionControllerOptions = {
    containerRef: RefObject<HTMLDivElement | null>;
    nodesRef: { current: CanvasNodeData[] };
    viewportRef: { current: ViewportTransform };
    selectedNodeIdsRef: { current: Set<string> };
    historyPausedRef: { current: boolean };
    screenToCanvas: (clientX: number, clientY: number) => Position;
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    setSelectedNodeIds: Dispatch<SetStateAction<Set<string>>>;
    setSelectedConnectionId: Dispatch<SetStateAction<string | null>>;
    cancelPendingConnectionCreate: () => void;
    onCanvasSelectionStart: () => void;
    onNodeInteractionStart: (selectionModifier: boolean) => void;
    onNodeBringToFront?: (nodeId: string) => void;
    onNodeClick: (node: CanvasNodeData) => void;
    onNodeDragEnd?: (nodeId: string) => void;
    onBatchConnectionTarget?: (event: ReactMouseEvent | ReactPointerEvent, nodeId: string) => boolean;
    onLinkedFolderDrop?: (folder: CanvasNodeData, nodes: CanvasNodeData[]) => void;
    onDeselect: () => void;
};

type DragState = {
    isDraggingNode: boolean;
    hasMoved: boolean;
    openPanelOnClick: boolean;
    startX: number;
    startY: number;
    startWorld: Position;
    draggedNodeIds: Set<string>;
    draggedRenderNodeIdSet: Set<string>;
    initialPositions: Map<string, Position>;
};

type SelectionGestureState =
    { phase: "idle" } | { phase: "pending"; initialSelection: Set<string>; selection: SelectionBox } | { phase: "selecting"; initialSelection: Set<string>; selection: SelectionBox; hitNodesSource: CanvasNodeData[]; hitNodeIds: Set<string> };

const EMPTY_DRAG_STATE: DragState = {
    isDraggingNode: false,
    hasMoved: false,
    openPanelOnClick: true,
    startX: 0,
    startY: 0,
    startWorld: { x: 0, y: 0 },
    draggedNodeIds: new Set(),
    draggedRenderNodeIdSet: new Set(),
    initialPositions: new Map(),
};
const EMPTY_FRAME_DROP_INDEX: CanvasFrameDropIndex = buildCanvasFrameDropIndex([]);

function trackDragCursor(viewport: HTMLDivElement, initialTarget: EventTarget | null) {
    let marked: HTMLElement | null = null;
    const mark = (target: EventTarget | null) => {
        const node = target instanceof Element ? target.closest<HTMLElement>(".node-element") : null;
        if (node === marked) return;
        marked?.removeAttribute("data-canvas-drag-cursor");
        marked = node;
        node?.setAttribute("data-canvas-drag-cursor", "");
    };
    const over = (event: MouseEvent) => mark(event.target);
    const leave = () => mark(null);
    mark(initialTarget);
    viewport.addEventListener("mouseover", over, true);
    viewport.addEventListener("mouseleave", leave);
    return () => {
        viewport.removeEventListener("mouseover", over, true);
        viewport.removeEventListener("mouseleave", leave);
        leave();
    };
}

function snapshotDragSelection(nodes: CanvasNodeData[], selected: Set<string>) {
    const rootIds = new Set<string>();
    const frameIds = new Set<string>();
    const attachedIds = new Set<string>();
    for (const node of nodes) {
        if (!selected.has(node.id)) continue;
        if (!node.metadata?.locked && !(node.parentId && selected.has(node.parentId))) rootIds.add(node.id);
        if (isFrameNode(node)) frameIds.add(node.id);
        node.metadata?.batchChildIds?.forEach((childId) => attachedIds.add(childId));
    }
    if (frameIds.size) for (const node of nodes) if (node.parentId && frameIds.has(node.parentId)) attachedIds.add(node.id);
    if (attachedIds.size) for (const node of nodes) if (selected.has(node.id) || attachedIds.has(node.id)) node.metadata?.batchChildIds?.forEach((childId) => attachedIds.add(childId));
    const initialPositions = new Map<string, Position>();
    const movingNodes = nodes.filter((node) => {
        if ((!selected.has(node.id) && !attachedIds.has(node.id)) || node.metadata?.locked) return false;
        initialPositions.set(node.id, node.position);
        return true;
    });
    return { rootIds, movingNodes, renderIds: new Set(initialPositions.keys()), initialPositions };
}

export function useCanvasSelectionController({
    containerRef,
    nodesRef,
    viewportRef,
    selectedNodeIdsRef,
    historyPausedRef,
    screenToCanvas,
    setNodes,
    setSelectedNodeIds,
    setSelectedConnectionId,
    cancelPendingConnectionCreate,
    onCanvasSelectionStart,
    onNodeInteractionStart,
    onNodeBringToFront,
    onNodeClick,
    onNodeDragEnd,
    onBatchConnectionTarget,
    onLinkedFolderDrop,
    onDeselect,
}: UseCanvasSelectionControllerOptions) {
    const dragFrameRef = useRef<number | null>(null);
    const pendingDragPointerRef = useRef<Position>({ x: 0, y: 0 });
    const alignmentContextRef = useRef<NodeAlignmentContext | null>(null);
    const lastFrameDropCheckRef = useRef(0);
    const selectionFrameRef = useRef<number | null>(null);
    const selectionBoundsElementRef = useRef<HTMLDivElement>(null);
    const selectionSpatialIndexCacheRef = useRef(createCanvasSelectionSpatialIndexCache());
    const pendingSelectionPointRef = useRef<Position | null>(null);
    const selectionGestureRef = useRef<SelectionGestureState>({ phase: "idle" });
    const nodeDraggingRef = useRef(false);
    const stopDragCursorRef = useRef<(() => void) | null>(null);
    const dragRef = useRef<DragState>({ ...EMPTY_DRAG_STATE });
    const frameDropIndexRef = useRef(EMPTY_FRAME_DROP_INDEX);
    const draggedNodesRef = useRef<CanvasNodeData[]>([]);
    const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);
    const [frameDropTargetId, setFrameDropTargetId] = useState<string | null>(null);
    const [isNodeDragging, setIsNodeDragging] = useState(false);
    const [dragPreview, setDragPreview] = useState<{ x: number; y: number; nodeIds: Set<string> } | null>(null);

    const resetSelectionBox = useCallback(() => {
        selectionGestureRef.current = { phase: "idle" };
        pendingSelectionPointRef.current = null;
        if (selectionFrameRef.current) cancelAnimationFrame(selectionFrameRef.current);
        selectionFrameRef.current = null;
        applyCanvasNodeSelectionPreview(containerRef.current, null);
        setSelectionBox(null);
    }, [containerRef]);

    const cancelSelectionBox = useCallback(() => {
        const gesture = selectionGestureRef.current;
        const initialSelection = gesture.phase === "selecting" ? gesture.initialSelection : null;
        resetSelectionBox();
        if (!initialSelection) return;
        if (initialSelection === selectedNodeIdsRef.current || sameStringSet(initialSelection, selectedNodeIdsRef.current)) return;
        selectedNodeIdsRef.current = initialSelection;
        setSelectedNodeIds(initialSelection);
    }, [resetSelectionBox, selectedNodeIdsRef, setSelectedNodeIds]);

    const deselectCanvas = useCallback(() => {
        cancelPendingConnectionCreate();
        cancelSelectionBox();
        const emptySelection = new Set<string>();
        selectedNodeIdsRef.current = emptySelection;
        setSelectedNodeIds(emptySelection);
        setSelectedConnectionId(null);
        onDeselect();
    }, [cancelPendingConnectionCreate, cancelSelectionBox, onDeselect, selectedNodeIdsRef, setSelectedConnectionId, setSelectedNodeIds]);

    const handleCanvasMouseDown = useCallback(
        (event: ReactPointerEvent<HTMLDivElement>) => {
            cancelPendingConnectionCreate();
            onCanvasSelectionStart();
            if (event.button !== 0) return;
            const world = screenToCanvas(event.clientX, event.clientY);
            const strategy = resolveCanvasSelectionStrategy(event);
            const nextSelectionBox: SelectionBox = {
                startWorldX: world.x,
                startWorldY: world.y,
                currentWorldX: world.x,
                currentWorldY: world.y,
                strategy,
                hitMode: "contain",
            };
            selectionGestureRef.current = { phase: "pending", initialSelection: selectedNodeIdsRef.current, selection: nextSelectionBox };
            setSelectedConnectionId(null);
        },
        [cancelPendingConnectionCreate, onCanvasSelectionStart, screenToCanvas, selectedNodeIdsRef, setSelectedConnectionId],
    );

    const handleNodeMouseDown = useCallback(
        (event: ReactMouseEvent | ReactPointerEvent, nodeId: string) => {
            event.stopPropagation();
            if (event.button !== 0) return;
            // 下拉菜单、弹层等经 React Portal 渲染，事件沿组件树冒泡到节点外壳，但 DOM 不在节点内。
            // 不能把它当成节点拖动：拖动预览会改写样式并让锚定弹层提前关闭，菜单项点击随之失效。
            if (event.target instanceof Node && event.currentTarget instanceof Node && !event.currentTarget.contains(event.target)) return;
            // 子组件的 pointerdown 停止冒泡不会阻止随后独立派发的 mousedown。
            // 编辑、控件操作和表内滚动均不能启动节点选择/拖动，也不能暂停历史记录。
            if (
                event.target instanceof Element &&
                event.target.closest(
                    'input, textarea, select, button, a[href], [contenteditable]:not([contenteditable="false"]), [role="textbox"], [data-canvas-no-drag], .ant-modal, .ant-popover, .ant-dropdown, .ant-select-dropdown, .ant-picker-dropdown',
                )
            )
                return;
            if (onBatchConnectionTarget?.(event, nodeId)) return;
            // Paint order is session-local UI state. Update it once at the start
            // of a real node interaction so dragging also survives deselection.
            onNodeBringToFront?.(nodeId);
            setSelectedConnectionId(null);
            const currentNodes = nodesRef.current;
            const previousSelection = selectedNodeIdsRef.current;
            let nextSelected = previousSelection;
            const isSubtractClick = event.altKey;
            const isMultiSelectClick = !isSubtractClick && (event.shiftKey || event.metaKey || event.ctrlKey);
            const isSelectionModifier = isSubtractClick || isMultiSelectClick;
            onNodeInteractionStart(isSelectionModifier);

            if (isSubtractClick && previousSelection.has(nodeId)) {
                nextSelected = new Set(previousSelection);
                nextSelected.delete(nodeId);
            } else if (isMultiSelectClick) {
                nextSelected = new Set(previousSelection);
                if (nextSelected.has(nodeId)) nextSelected.delete(nodeId);
                else nextSelected.add(nodeId);
            } else if (!isSubtractClick && !nextSelected.has(nodeId)) {
                nextSelected = new Set([nodeId]);
            }

            if (nextSelected !== previousSelection) {
                selectedNodeIdsRef.current = nextSelected;
                setSelectedNodeIds(nextSelected);
            }
            if (isSelectionModifier && !nextSelected.has(nodeId)) {
                dragRef.current = { ...EMPTY_DRAG_STATE, openPanelOnClick: false };
                return;
            }

            const clickedNode = currentNodes.find((node) => node.id === nodeId);
            if (clickedNode?.metadata?.locked) {
                dragRef.current = { ...EMPTY_DRAG_STATE };
                onNodeClick(clickedNode);
                return;
            }

            const { rootIds: draggedNodeIds, movingNodes: draggedNodes, renderIds: draggedRenderNodeIdSet, initialPositions } = snapshotDragSelection(currentNodes, nextSelected);
            if (!draggedNodes.length) return;

            frameDropIndexRef.current = buildCanvasFrameDropIndex(currentNodes);
            draggedNodesRef.current = draggedNodes;
            dragRef.current = {
                isDraggingNode: true,
                hasMoved: false,
                openPanelOnClick: !isMultiSelectClick,
                startX: event.clientX,
                startY: event.clientY,
                startWorld: screenToCanvas(event.clientX, event.clientY),
                draggedNodeIds,
                draggedRenderNodeIdSet,
                initialPositions,
            };
            historyPausedRef.current = true;
            nodeDraggingRef.current = true;
            stopDragCursorRef.current?.();
            stopDragCursorRef.current = containerRef.current && trackDragCursor(containerRef.current, event.target);
            alignmentContextRef.current = createNodeAlignmentContext(currentNodes, initialPositions);
            lastFrameDropCheckRef.current = 0;
            setIsNodeDragging(true);
            setDragPreview({ x: 0, y: 0, nodeIds: draggedRenderNodeIdSet });
            applyCanvasNodeDragPreview(containerRef.current, { x: 0, y: 0, nodeIds: draggedRenderNodeIdSet }, selectionBoundsElementRef.current);
        },
        [containerRef, historyPausedRef, nodesRef, onBatchConnectionTarget, onNodeBringToFront, onNodeClick, onNodeInteractionStart, screenToCanvas, selectedNodeIdsRef, setSelectedConnectionId, setSelectedNodeIds],
    );

    const finishNodeDrag = useCallback(
        (clientX?: number, clientY?: number) => {
            if (dragFrameRef.current) {
                cancelAnimationFrame(dragFrameRef.current);
                dragFrameRef.current = null;
            }
            if (!dragRef.current.isDraggingNode) return;
            const shouldOpenPanelOnClick = dragRef.current.openPanelOnClick;
            const draggedNodeIds = dragRef.current.draggedNodeIds;
            const isRelease = clientX != null && clientY != null;
            const wasClick = isRelease && shouldOpenPanelOnClick && !dragRef.current.hasMoved && draggedNodeIds.size === 1;
            const clickedNodeId = draggedNodeIds.values().next().value;
            const world = isRelease && dragRef.current.hasMoved ? screenToCanvas(clientX, clientY) : null;

            historyPausedRef.current = false;
            nodeDraggingRef.current = false;
            stopDragCursorRef.current?.();
            stopDragCursorRef.current = null;
            applyCanvasNodeDragPreview(containerRef.current, null);
            setIsNodeDragging(false);
            setDragPreview(null);
            if (world) {
                const rawOffset = { x: world.x - dragRef.current.startWorld.x, y: world.y - dragRef.current.startWorld.y };
                const { x: dx, y: dy } = calculateNodeAlignment(alignmentContextRef.current, rawOffset, 7 / viewportRef.current.k).offset;
                const initialPositions = dragRef.current.initialPositions;
                const positioned = nodesRef.current.map((node) => {
                    const initial = initialPositions.get(node.id);
                    return initial ? { ...node, position: { x: initial.x + dx, y: initial.y + dy } } : node;
                });
                const targetId = findFrameDropTargetFromIndex(frameDropIndexRef.current, draggedNodesRef.current, draggedNodeIds, { x: dx, y: dy });
                const target = targetId ? positioned.find((node) => node.id === targetId) : undefined;
                const linkedFolder = target?.metadata?.folder?.assetFolderId ? target : undefined;
                // 素材库文件夹只建立归档关系，不把画布节点变成其本地子节点。
                setNodes(linkedFolder ? positioned : applyFrameDrop(positioned, draggedNodeIds, targetId));
                if (linkedFolder)
                    onLinkedFolderDrop?.(
                        linkedFolder,
                        positioned.filter((node) => draggedNodeIds.has(node.id)),
                    );
                if (clickedNodeId) onNodeDragEnd?.(clickedNodeId);
            }
            setFrameDropTargetId(null);
            frameDropIndexRef.current = EMPTY_FRAME_DROP_INDEX;
            alignmentContextRef.current = null;
            draggedNodesRef.current = [];
            dragRef.current = { ...EMPTY_DRAG_STATE };
            if (wasClick && clickedNodeId) {
                const clickedNode = nodesRef.current.find((node) => node.id === clickedNodeId);
                if (clickedNode) onNodeClick(clickedNode);
            }
        },
        [historyPausedRef, nodesRef, onLinkedFolderDrop, onNodeClick, onNodeDragEnd, screenToCanvas, setNodes, viewportRef],
    );

    const handleNodeDragMove = useCallback(
        (event: MouseEvent | PointerEvent) => {
            if (!dragRef.current.isDraggingNode) return;
            if (Math.abs(event.clientX - dragRef.current.startX) > 3 || Math.abs(event.clientY - dragRef.current.startY) > 3) dragRef.current.hasMoved = true;
            // 点击时指针常有 1~3px 抖动；未越过拖动阈值前不预览位移，否则对齐吸附会把节点
            // 临时拉偏最多 7px，松手判定为点击后又弹回原位，表现为“点一下左右抖动”。
            if (!dragRef.current.hasMoved) return;
            pendingDragPointerRef.current = { x: event.clientX, y: event.clientY };
            if (dragFrameRef.current) return;
            dragFrameRef.current = requestAnimationFrame(() => {
                const pointer = pendingDragPointerRef.current;
                const world = screenToCanvas(pointer.x, pointer.y);
                const start = dragRef.current.startWorld;
                const aligned = calculateNodeAlignment(alignmentContextRef.current, { x: world.x - start.x, y: world.y - start.y }, 7 / viewportRef.current.k);
                const latest = aligned.offset;
                const now = performance.now();
                if (now - lastFrameDropCheckRef.current >= 100) {
                    lastFrameDropCheckRef.current = now;
                    setFrameDropTargetId(findFrameDropTargetFromIndex(frameDropIndexRef.current, draggedNodesRef.current, dragRef.current.draggedNodeIds, latest));
                }
                applyCanvasNodeDragPreview(containerRef.current, { ...latest, nodeIds: dragRef.current.draggedRenderNodeIdSet, guides: aligned.guides }, selectionBoundsElementRef.current);
                dragFrameRef.current = null;
            });
        },
        [containerRef, screenToCanvas, viewportRef],
    );

    const updateSelectionPreview = useCallback(
        (world: Position, commit: boolean) => {
            const gesture = selectionGestureRef.current;
            if (gesture.phase === "idle") return false;
            const start = gesture.selection;
            if (gesture.phase === "pending" && Math.hypot(world.x - start.startWorldX, world.y - start.startWorldY) < 4 / viewportRef.current.k) return false;
            const nodes = nodesRef.current;
            let hitNodeIds: Set<string>;
            if (gesture.phase === "selecting" && start.currentWorldX === world.x && start.currentWorldY === world.y && gesture.hitNodesSource === nodes) {
                if (!commit) return true;
                hitNodeIds = gesture.hitNodeIds;
            } else {
                const selection = { ...start, currentWorldX: world.x, currentWorldY: world.y, hitMode: resolveCanvasSelectionHitMode(start.startWorldX, world.x) };
                const bounds = createCanvasSelectionBounds(start.startWorldX, start.startWorldY, world.x, world.y);
                bounds.right = Math.max(bounds.right, bounds.left + 0.01);
                bounds.bottom = Math.max(bounds.bottom, bounds.top + 0.01);
                hitNodeIds = new Set();
                for (const node of selectionSpatialIndexCacheRef.current.get(nodes).query(bounds)) {
                    if (canvasSelectionHitsBounds(bounds, canvasNodeBounds(node), selection.hitMode)) hitNodeIds.add(node.id);
                }
                if (!commit) {
                    selectionGestureRef.current = { phase: "selecting", initialSelection: gesture.initialSelection, selection, hitNodesSource: nodes, hitNodeIds };
                    if (gesture.phase === "pending") setSelectionBox(selection);
                    applyCanvasSelectionPreview(containerRef.current, selection);
                    applyCanvasNodeSelectionPreview(containerRef.current, resolveCanvasSelectionPreviewDelta(gesture.initialSelection, hitNodeIds, selection.strategy));
                    return true;
                }
            }
            const nextSelected = start.strategy === "replace" ? hitNodeIds : applyCanvasSelectionStrategy(gesture.initialSelection, hitNodeIds, start.strategy);
            if (!sameStringSet(nextSelected, selectedNodeIdsRef.current)) {
                selectedNodeIdsRef.current = nextSelected;
                setSelectedNodeIds(nextSelected);
            }
            return true;
        },
        [containerRef, nodesRef, selectedNodeIdsRef, setSelectedNodeIds, viewportRef],
    );

    const handlePointerMove = useCallback(
        (event: PointerEvent) => {
            if (dragRef.current.isDraggingNode) {
                handleNodeDragMove(event);
                return;
            }
            const currentGesture = selectionGestureRef.current;
            if (currentGesture.phase === "idle") return;
            pendingSelectionPointRef.current = { x: event.clientX, y: event.clientY };
            if (selectionFrameRef.current) return;
            selectionFrameRef.current = requestAnimationFrame(() => {
                selectionFrameRef.current = null;
                const pointer = pendingSelectionPointRef.current;
                if (pointer) updateSelectionPreview(screenToCanvas(pointer.x, pointer.y), false);
            });
        },
        [handleNodeDragMove, screenToCanvas, updateSelectionPreview],
    );

    const finishSelection = useCallback(
        (clientX: number, clientY: number) => {
            const gesture = selectionGestureRef.current;
            if (gesture.phase === "idle") return;
            if (selectionFrameRef.current) cancelAnimationFrame(selectionFrameRef.current);
            selectionFrameRef.current = null;
            const wasSelection = updateSelectionPreview(screenToCanvas(clientX, clientY), true);
            if (!wasSelection && gesture.selection.strategy === "replace") deselectCanvas();
            else resetSelectionBox();
        },
        [deselectCanvas, resetSelectionBox, screenToCanvas, updateSelectionPreview],
    );

    // 重渲染只更新回调，不能拆掉进行中的手势监听并清除 iframe 保护层 / 待执行帧。
    const gestureHandlersRef = useRef({ finishNodeDrag, finishSelection, cancelSelectionBox, handleNodeDragMove, handlePointerMove });
    useEffect(() => {
        gestureHandlersRef.current = { finishNodeDrag, finishSelection, cancelSelectionBox, handleNodeDragMove, handlePointerMove };
    });

    useEffect(() => {
        const handleMouseUp = (event: MouseEvent) => {
            gestureHandlersRef.current.finishNodeDrag(event.clientX, event.clientY);
        };
        const handlePointerUp = (event: PointerEvent) => {
            gestureHandlersRef.current.finishNodeDrag(event.clientX, event.clientY);
            gestureHandlersRef.current.finishSelection(event.clientX, event.clientY);
        };
        const cancel = () => {
            gestureHandlersRef.current.finishNodeDrag();
            gestureHandlersRef.current.cancelSelectionBox();
        };
        const onMouseMove = (event: MouseEvent) => gestureHandlersRef.current.handleNodeDragMove(event);
        const onPointerMove = (event: PointerEvent) => gestureHandlersRef.current.handlePointerMove(event);
        window.addEventListener("mousemove", onMouseMove);
        window.addEventListener("mouseup", handleMouseUp);
        window.addEventListener("pointermove", onPointerMove);
        window.addEventListener("pointerup", handlePointerUp);
        window.addEventListener("pointercancel", cancel);
        window.addEventListener("blur", cancel);
        return () => {
            if (dragFrameRef.current) cancelAnimationFrame(dragFrameRef.current);
            if (selectionFrameRef.current) cancelAnimationFrame(selectionFrameRef.current);
            stopDragCursorRef.current?.();
            stopDragCursorRef.current = null;
            applyCanvasNodeDragPreview(containerRef.current, null);
            window.removeEventListener("mousemove", onMouseMove);
            window.removeEventListener("mouseup", handleMouseUp);
            window.removeEventListener("pointermove", onPointerMove);
            window.removeEventListener("pointerup", handlePointerUp);
            window.removeEventListener("pointercancel", cancel);
            window.removeEventListener("blur", cancel);
        };
    }, [containerRef]);

    return {
        cancelSelectionBox,
        deselectCanvas,
        dragPreview,
        frameDropTargetId,
        handleCanvasMouseDown,
        handleNodeMouseDown,
        isNodeDragging,
        nodeDraggingRef,
        selectionBoundsElementRef,
        selectionBox,
    };
}
