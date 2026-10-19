import { useCallback, useEffect, useMemo, useRef, type Dispatch, type SetStateAction } from "react";
import { createCanvasStateWriter } from "@/lib/canvas/canvas-editor-state";
import { updateCanvasNode, updateCanvasNodes } from "@/lib/canvas/canvas-node-timestamps";
import type { CanvasNodeData } from "@/types/canvas";

export function useCanvasContentUpdates(nodesRef: { current: CanvasNodeData[] }, publish: Dispatch<SetStateAction<CanvasNodeData[]>>) {
    const write = useMemo(() => createCanvasStateWriter(nodesRef, publish), [nodesRef, publish]);
    const updateNode = useCallback((nodeId: string, update: (node: CanvasNodeData) => CanvasNodeData) => {
        write((current) => updateCanvasNode(current, nodeId, update));
    }, [write]);
    const pending = useRef(new Map<string, (node: CanvasNodeData) => CanvasNodeData>());
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const updateMediaNode = useCallback((nodeId: string, update: (node: CanvasNodeData) => CanvasNodeData) => {
        const previous = pending.current.get(nodeId);
        pending.current.set(nodeId, previous ? (node) => update(previous(node)) : update);
        if (timer.current) return;
        timer.current = setTimeout(() => {
            const updates = pending.current;
            pending.current = new Map();
            timer.current = null;
            if (!updates.size) return;
            write((current) => updateCanvasNodes(current, updates));
        }, 120);
    }, [write]);
    useEffect(() => () => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = null;
        pending.current.clear();
    }, []);
    return { updateNode, updateMediaNode };
}
