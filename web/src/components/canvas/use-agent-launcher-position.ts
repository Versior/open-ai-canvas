import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import {
    AGENT_LAUNCHER_COMPACT_VIEWPORT_WIDTH,
    AGENT_LAUNCHER_POSITION_KEY,
    clampAgentLauncherPosition,
    dockAgentLauncherPosition,
    moveAgentLauncher,
    restoreAgentLauncherPosition,
    type AgentLauncherGesture,
    type AgentLauncherPosition,
} from "@/lib/canvas/agent-launcher-position";

const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });
const positionKey = () => (window.innerWidth < AGENT_LAUNCHER_COMPACT_VIEWPORT_WIDTH ? `${AGENT_LAUNCHER_POSITION_KEY}:compact` : AGENT_LAUNCHER_POSITION_KEY);

const readPosition = (size: { width: number; height: number }) => {
    try {
        return restoreAgentLauncherPosition(localStorage.getItem(positionKey()), viewport(), size);
    } catch (error) {
        console.warn("Agent 入口位置无法读取", error);
        return restoreAgentLauncherPosition(null, viewport(), size);
    }
};

/**
 * 入口的拖拽、点击与键盘移动。指针处理器（onPointer*）可以挂在入口按钮上，也可以挂在按钮内的身体热区上
 * （大形象外框不接收指针）；指针捕获落在挂处理器的元素上，因此该元素必须能被命中。
 */
export function useAgentLauncherPosition(onOpen: () => void, width = 76, height = 76, allowDock = false) {
    const size = { width, height };
    const [position, setPosition] = useState(() => readPosition(size));
    const savedScope = useRef(positionKey());
    const dockingAllowed = useRef(allowDock);
    const [dragging, setDragging] = useState(false);
    const gestureRef = useRef<(AgentLauncherGesture & { pointerId: number }) | null>(null);
    const suppressClick = useRef(false);

    const save = (next: AgentLauncherPosition) => {
        try {
            localStorage.setItem(positionKey(), JSON.stringify(next));
        } catch (error) {
            console.warn("Agent 入口位置无法保存", error);
        }
    };

    useEffect(() => {
        const resize = () => {
            const key = positionKey();
            if (savedScope.current !== key || (allowDock && !dockingAllowed.current)) {
                savedScope.current = key;
                const restored = readPosition(size);
                setPosition(clampAgentLauncherPosition(allowDock ? restored : { right: restored.right, bottom: restored.bottom }, viewport(), size));
            } else setPosition((current) => clampAgentLauncherPosition(allowDock ? current : { right: current.right, bottom: current.bottom }, viewport(), size));
            dockingAllowed.current = allowDock;
        };
        resize();
        window.addEventListener("resize", resize);
        return () => window.removeEventListener("resize", resize);
    }, [width, height, allowDock]);

    const onPointerDown = (event: PointerEvent<HTMLElement>) => {
        event.stopPropagation();
        if (event.button !== 0 || !event.isPrimary || gestureRef.current) return;
        suppressClick.current = false;
        const bounds = allowDock && position.dock ? (event.currentTarget.closest(".canvas-agent-launcher") ?? event.currentTarget).getBoundingClientRect() : undefined;
        const start = bounds ? { ...position, right: window.innerWidth - bounds.right, bottom: window.innerHeight - bounds.bottom } : position;
        gestureRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, start, dragged: false };
        event.currentTarget.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent<HTMLElement>) => {
        event.stopPropagation();
        const gesture = gestureRef.current;
        if (!gesture || gesture.pointerId !== event.pointerId) return;
        const next = moveAgentLauncher(gesture, event.clientX, event.clientY, viewport(), size, allowDock);
        gesture.dragged = next.dragged;
        if (!next.dragged) return;
        event.preventDefault();
        suppressClick.current = true;
        setDragging(true);
        setPosition(next.position);
    };
    const finish = (event: PointerEvent<HTMLElement>, cancelled: boolean) => {
        event.stopPropagation();
        const gesture = gestureRef.current;
        if (!gesture || gesture.pointerId !== event.pointerId) return;
        gestureRef.current = null;
        const next = cancelled ? { dragged: gesture.dragged, position: clampAgentLauncherPosition(position, viewport(), size) } : moveAgentLauncher(gesture, event.clientX, event.clientY, viewport(), size, allowDock);
        if (allowDock && next.dragged && !cancelled) next.position = dockAgentLauncherPosition(next.position, viewport(), size);
        suppressClick.current = cancelled || next.dragged;
        setDragging(false);
        setPosition(next.position);
        if (next.dragged) save(next.position);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    };
    const onClick = (event: MouseEvent<HTMLElement>) => {
        event.stopPropagation();
        // Keyboard/assistive activation remains available after a drag or cancellation.
        if (event.detail !== 0 && suppressClick.current) {
            event.preventDefault();
            return;
        }
        onOpen();
    };
    const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
        event.stopPropagation();
        const delta = event.shiftKey ? 40 : 10;
        const offsets: Record<string, [number, number]> = { ArrowLeft: [delta, 0], ArrowRight: [-delta, 0], ArrowUp: [0, delta], ArrowDown: [0, -delta] };
        const offset = offsets[event.key];
        if (!offset) return;
        event.preventDefault();
        const raw = { right: position.right + offset[0], bottom: position.bottom + offset[1] };
        if (allowDock && position.dock && offset[0]) raw.right = position.dock === "right" ? (offset[0] > 0 ? 20 : 0) : window.innerWidth - width - (offset[0] < 0 ? 20 : 0);
        const next = allowDock ? clampAgentLauncherPosition(offset[0] ? dockAgentLauncherPosition(raw, viewport(), size) : { ...raw, dock: position.dock }, viewport(), size) : clampAgentLauncherPosition(raw, viewport(), size);
        setPosition(next);
        save(next);
    };

    return {
        position,
        dragging,
        handlers: {
            onPointerDown,
            onPointerMove,
            onPointerUp: (event: PointerEvent<HTMLElement>) => finish(event, false),
            onPointerCancel: (event: PointerEvent<HTMLElement>) => finish(event, true),
            onLostPointerCapture: (event: PointerEvent<HTMLElement>) => finish(event, true),
            onClick,
            onKeyDown,
            onDoubleClick: (event: MouseEvent<HTMLElement>) => event.stopPropagation(),
        },
    };
}
