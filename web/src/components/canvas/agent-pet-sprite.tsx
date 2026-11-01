import { memo, useEffect, useRef, useState, type CSSProperties } from "react";

import type { AgentAvatarState } from "@/lib/canvas/agent-appearance";
import {
    AGENT_PET_COLUMNS,
    agentPetFrameDuration,
    agentPetLookCell,
    agentPetRowForState,
    agentPetRowIndex,
    agentPetSheetRows,
    cachedAgentPetMetrics,
    DEFAULT_AGENT_PET_FRAMES,
    DEFAULT_AGENT_PET_HEAD_TOP,
    detectAgentPetMetrics,
    type AgentPetSheetMetrics,
} from "@/lib/canvas/agent-pet";
import { cn } from "@/lib/utils";
import type { AgentPetRow } from "@/services/api/agent-pets";

/** 鼠标停止移动多久后，形象从“看向鼠标”回到待机动画。 */
const LOOK_IDLE_MS = 2500;

type LookCell = { row: number; column: number };

export type AgentPetSpriteProps = {
    src: string;
    version: 1 | 2;
    state: AgentAvatarState;
    stateRows?: Partial<Record<string, AgentPetRow>>;
    width: number;
    height: number;
    /** 强制播放某个动作（后台预览用），优先于状态映射。 */
    row?: AgentPetRow;
    paused?: boolean;
    reducedMotion?: boolean;
    pixelated?: boolean;
    /** 拖动中按 offsetRight 的变化切换向左 / 向右跑。 */
    dragging?: boolean;
    offsetRight?: number;
    hovered?: boolean;
    /** v2 图集在待机时看向鼠标。 */
    lookAtPointer?: boolean;
    label?: string;
    className?: string;
    onError?: () => void;
};

/**
 * 逐帧切换 CSS 背景位置播放 Codex 宠物图集，不解码视频也不逐像素处理。
 * 页面隐藏、paused 或减少动效时停在第一帧；状态切到 completed 时庆祝动作只播一次。
 */
export const AgentPetSprite = memo(function AgentPetSprite({
    src,
    version,
    state,
    stateRows,
    width,
    height,
    row: forcedRow,
    paused = false,
    reducedMotion = false,
    pixelated = false,
    dragging = false,
    offsetRight = 0,
    hovered = false,
    lookAtPointer = true,
    label,
    className,
    onError,
}: AgentPetSpriteProps) {
    const element = useRef<HTMLSpanElement>(null);
    const rows = agentPetSheetRows(version);
    const { frames } = useAgentPetSheetMetrics(src, version, onError);

    const documentHidden = useDocumentHidden();
    const still = paused || reducedMotion || documentHidden;
    const idleRow = agentPetRowForState("idle", stateRows);
    const mappedRow = agentPetRowForState(state, stateRows);
    const loopRow = forcedRow ?? (state === "completed" ? idleRow : mappedRow);

    const [oneShot, setOneShot] = useState<AgentPetRow | null>(null);
    const previousState = useRef(state);
    useEffect(() => {
        if (previousState.current !== state && state === "completed" && !forcedRow) setOneShot(mappedRow);
        previousState.current = state;
    }, [state, mappedRow, forcedRow]);
    useEffect(() => {
        if (hovered && !forcedRow && loopRow === idleRow) setOneShot((current) => current ?? "waving");
    }, [hovered, forcedRow, loopRow, idleRow]);

    const [facing, setFacing] = useState<"running-right" | "running-left">("running-right");
    const lastOffset = useRef(offsetRight);
    useEffect(() => {
        const delta = lastOffset.current - offsetRight;
        lastOffset.current = offsetRight;
        // right 变小表示向右移动。
        if (dragging && Math.abs(delta) > 0.5) setFacing(delta > 0 ? "running-right" : "running-left");
    }, [dragging, offsetRight]);

    const activeRow: AgentPetRow = dragging && !forcedRow ? facing : (oneShot ?? loopRow);
    const lookEnabled = version === 2 && lookAtPointer && !still && !dragging && !forcedRow && !oneShot && loopRow === idleRow;
    const look = useLookAtPointer(element, lookEnabled);

    const frameCount = Math.max(1, Math.min(AGENT_PET_COLUMNS, frames[agentPetRowIndex(activeRow)] ?? 1));
    const [frame, setFrame] = useState(0);
    useEffect(() => setFrame(0), [activeRow, src]);
    useEffect(() => {
        if (still || look) return;
        const timer = window.setTimeout(
            () => {
                if (frame + 1 < frameCount) {
                    setFrame(frame + 1);
                    return;
                }
                setFrame(0);
                if (oneShot && activeRow === oneShot) setOneShot(null);
            },
            agentPetFrameDuration(activeRow, frame, frameCount),
        );
        return () => window.clearTimeout(timer);
    }, [still, look, frame, frameCount, activeRow, oneShot]);

    const cell = look ?? { row: agentPetRowIndex(activeRow), column: still ? 0 : Math.min(frame, frameCount - 1) };
    const style: CSSProperties = {
        width,
        height,
        backgroundImage: `url(${JSON.stringify(src)})`,
        backgroundRepeat: "no-repeat",
        backgroundSize: `${width * AGENT_PET_COLUMNS}px ${height * rows}px`,
        backgroundPosition: `${-cell.column * width}px ${-cell.row * height}px`,
        imageRendering: pixelated ? "pixelated" : undefined,
    };
    return <span ref={element} className={cn("agent-pet-sprite block shrink-0", className)} style={style} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} data-pet-row={look ? "look" : activeRow} />;
});

const DEFAULT_METRICS: AgentPetSheetMetrics = { frames: DEFAULT_AGENT_PET_FRAMES, headTop: DEFAULT_AGENT_PET_HEAD_TOP };

/** 图集帧数与头顶位置；同一 URL 只检测一次，加载失败时调用 onError。 */
export function useAgentPetSheetMetrics(src: string, version: 1 | 2, onError?: () => void) {
    const rows = agentPetSheetRows(version);
    const [metrics, setMetrics] = useState<AgentPetSheetMetrics>(() => cachedAgentPetMetrics(src) ?? DEFAULT_METRICS);
    const onErrorRef = useRef(onError);
    useEffect(() => {
        onErrorRef.current = onError;
    }, [onError]);
    useEffect(() => {
        let active = true;
        setMetrics(cachedAgentPetMetrics(src) ?? DEFAULT_METRICS);
        if (!src) return;
        detectAgentPetMetrics(src, rows).then(
            (next) => active && setMetrics(next),
            () => active && onErrorRef.current?.(),
        );
        return () => {
            active = false;
        };
    }, [src, rows]);
    return metrics;
}

function useDocumentHidden() {
    const [hidden, setHidden] = useState(() => typeof document !== "undefined" && document.hidden);
    useEffect(() => {
        const update = () => setHidden(document.hidden);
        document.addEventListener("visibilitychange", update);
        return () => document.removeEventListener("visibilitychange", update);
    }, []);
    return hidden;
}

/** 待机时按“头部 → 鼠标”的角度选择视线格；鼠标停下一段时间或移到形象身上时恢复待机动画。 */
function useLookAtPointer(element: { current: HTMLElement | null }, enabled: boolean) {
    const [look, setLook] = useState<LookCell | null>(null);
    useEffect(() => {
        if (!enabled) {
            setLook(null);
            return;
        }
        let frameRequest = 0;
        let idleTimer = 0;
        let pointer: { x: number; y: number } | null = null;
        const update = () => {
            frameRequest = 0;
            const target = element.current;
            if (!target || !pointer) return;
            const rect = target.getBoundingClientRect();
            const dx = pointer.x - (rect.left + rect.width / 2);
            const dy = pointer.y - (rect.top + rect.height * 0.4);
            if (Math.hypot(dx, dy) < rect.width * 0.35) {
                setLook(null);
                return;
            }
            const next = agentPetLookCell(dx, dy);
            setLook((current) => (current && current.row === next.row && current.column === next.column ? current : next));
        };
        const move = (event: PointerEvent) => {
            pointer = { x: event.clientX, y: event.clientY };
            if (!frameRequest) frameRequest = window.requestAnimationFrame(update);
            window.clearTimeout(idleTimer);
            idleTimer = window.setTimeout(() => setLook(null), LOOK_IDLE_MS);
        };
        window.addEventListener("pointermove", move, { passive: true });
        return () => {
            window.removeEventListener("pointermove", move);
            window.cancelAnimationFrame(frameRequest);
            window.clearTimeout(idleTimer);
        };
    }, [element, enabled]);
    return enabled ? look : null;
}
