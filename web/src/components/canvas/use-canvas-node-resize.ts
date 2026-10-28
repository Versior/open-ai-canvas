import { useEffect, useRef, type PointerEvent } from "react";
import type { CanvasNodeData, Position } from "@/types/canvas";
import { getNodeResizeMinSize, shouldKeepAspectRatio } from "@/lib/canvas/node-registry";
import { solveNodeResize, type NodeResizeCorner } from "@/lib/canvas/node-resize-geometry";
import { useCanvasNodeResizeMotion } from "./canvas-node-resize-motion";

type ResizeCallback = (id: string, width: number, height: number, position?: Position) => void;

export function useCanvasNodeResize(node: CanvasNodeData, scale: number, minimumHeight: number | null, onResize: ResizeCallback, readOnly = false) {
    const dispose = useRef<(() => void) | null>(null);
    const latest = useRef(onResize);
    const resizeMotion = useCanvasNodeResizeMotion();
    latest.current = onResize;
    const disabled = readOnly || Boolean(node.metadata?.locked);
    useEffect(() => {
        if (disabled) dispose.current?.();
        return () => dispose.current?.();
    }, [node.id, disabled]);

    return (event: PointerEvent<HTMLElement>, corner: NodeResizeCorner) => {
        event.stopPropagation();
        if (disabled || dispose.current || event.button !== 0 || !(scale > 0) || !Number.isFinite(scale)) return;
        event.preventDefault();
        const target: HTMLElement = event.currentTarget;
        const pointer = event.pointerId;
        const origin = { x: event.clientX, y: event.clientY };
        let pending = origin;
        let frame: number | null = null;
        const minimum = getNodeResizeMinSize(node);
        const snapshot = {
            position: { ...node.position },
            width: node.width,
            height: node.height,
            corner,
            minimumWidth: minimum.width,
            minimumHeight: minimumHeight ?? minimum.height,
            ratio: shouldKeepAspectRatio(node) ? (node.metadata?.naturalWidth || node.width) / (node.metadata?.naturalHeight || node.height || 1) : undefined,
        };
        const listeners = new AbortController();
        const solve = (point: Position) => solveNodeResize(snapshot, { x: (point.x - origin.x) / scale, y: (point.y - origin.y) / scale });
        const paint = () => {
            frame = null;
            resizeMotion?.setPreview(node.id, solve(pending));
        };
        const stop = (restore = true) => {
            listeners.abort();
            if (frame !== null) window.cancelAnimationFrame(frame);
            frame = null;
            if (restore) resizeMotion?.clearPreview(node.id);
            if (target.hasPointerCapture(pointer)) target.releasePointerCapture(pointer);
            dispose.current = null;
        };
        const move = (next: globalThis.PointerEvent) => {
            if (next.pointerId !== pointer || (pending.x === next.clientX && pending.y === next.clientY)) return;
            pending = { x: next.clientX, y: next.clientY };
            if (frame === null) frame = window.requestAnimationFrame(paint);
        };
        target.setPointerCapture(pointer);
        target.addEventListener("pointermove", move, { signal: listeners.signal });
        target.addEventListener(
            "pointerup",
            (next) => {
                if (next.pointerId !== pointer) return;
                pending = { x: next.clientX, y: next.clientY };
                if (pending.x === origin.x && pending.y === origin.y) return stop();
                if (frame !== null) window.cancelAnimationFrame(frame);
                const size = solve(pending);
                resizeMotion?.setPreview(node.id, size);
                stop(false);
                try {
                    latest.current(node.id, size.width, size.height, size.position);
                } catch (error) {
                    resizeMotion?.clearPreview(node.id);
                    throw error;
                }
            },
            { signal: listeners.signal },
        );
        target.addEventListener(
            "pointercancel",
            (next) => {
                if (next.pointerId === pointer) stop();
            },
            { signal: listeners.signal },
        );
        target.addEventListener(
            "lostpointercapture",
            (next) => {
                if (next.pointerId === pointer) stop();
            },
            { signal: listeners.signal },
        );
        window.addEventListener("blur", () => stop(), { signal: listeners.signal });
        dispose.current = stop;
    };
}
