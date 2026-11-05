import { Minus, Plus } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent } from "react";

/** 缩放状态：scale 以「整张放进画面」为 1，x / y 是相对舞台中心的平移（像素）。 */
type View = { scale: number; x: number; y: number };
/** 整张放进画面时图片与舞台的尺寸；actual 是按原图像素显示时的倍数。 */
type Box = { width: number; height: number; stageWidth: number; stageHeight: number; actual: number; max: number };

const FIT: View = { scale: 1, x: 0, y: 0 };
const STEP = 1.5;
const DRAG_SLOP = 4;

function measure(stage: HTMLElement | null, image: HTMLImageElement | null): Box | undefined {
    if (!stage || !image || !image.offsetWidth || !image.naturalWidth) return undefined;
    const actual = image.naturalWidth / image.offsetWidth;
    return { width: image.offsetWidth, height: image.offsetHeight, stageWidth: stage.clientWidth, stageHeight: stage.clientHeight, actual, max: Math.min(16, Math.max(4, actual * 2)) };
}

/** 平移限制在图片盖住舞台的范围内；放大后仍比舞台窄的方向保持居中。 */
function panView(view: View, box: Box): View {
    const limitX = Math.max(0, (box.width * view.scale - box.stageWidth) / 2);
    const limitY = Math.max(0, (box.height * view.scale - box.stageHeight) / 2);
    return { scale: view.scale, x: Math.min(limitX, Math.max(-limitX, view.x)), y: Math.min(limitY, Math.max(-limitY, view.y)) };
}

/** 以舞台里的一点（相对舞台中心）为锚缩放：这一点下面的图片内容保持不动。 */
function zoomView(current: View, scale: number, px: number, py: number, box: Box): View {
    const target = Math.min(box.max, Math.max(1, scale));
    if (target <= 1) return FIT;
    const ratio = target / current.scale;
    return panView({ scale: target, x: px - (px - current.x) * ratio, y: py - (py - current.y) * ratio }, box);
}

function pointOf(stage: HTMLElement, clientX: number, clientY: number) {
    const rect = stage.getBoundingClientRect();
    return { px: clientX - rect.left - rect.width / 2, py: clientY - rect.top - rect.height / 2 };
}

/**
 * 大图查看的图片区：默认整张放进画面。点一下放大到原图像素（小图放大两倍），再点一下回到整张；
 * 滚轮或触控板捏合以指针为中心缩放，放大后拖动查看各处。换图时由调用方换 key 重置。
 */
export function StudioViewerStage({ src, alt }: { src: string; alt: string }) {
    const stageRef = useRef<HTMLDivElement>(null);
    const imageRef = useRef<HTMLImageElement>(null);
    const drag = useRef<{ id: number; x: number; y: number; from: View; moved: boolean }>(undefined);
    const [view, setView] = useState<View>(FIT);
    // 拖动和滚轮时去掉过渡，图片跟手。
    const [gesture, setGesture] = useState<"" | "drag" | "wheel">("");
    const zoomed = view.scale > 1;

    // React 的 onWheel 是被动监听，拦不住页面滚动，这里直接挂原生监听。
    useEffect(() => {
        const stage = stageRef.current;
        if (!stage) return;
        let timer = 0;
        const onWheel = (event: WheelEvent) => {
            const box = measure(stage, imageRef.current);
            if (!box) return;
            event.preventDefault();
            const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? box.stageHeight : 1;
            // 触控板捏合给的是带 ctrlKey 的小步长，系数大一些才跟手。
            const factor = Math.exp(-event.deltaY * unit * (event.ctrlKey ? 0.01 : 0.002));
            const { px, py } = pointOf(stage, event.clientX, event.clientY);
            setView((current) => zoomView(current, current.scale * factor, px, py, box));
            setGesture("wheel");
            window.clearTimeout(timer);
            timer = window.setTimeout(() => setGesture(""), 180);
        };
        stage.addEventListener("wheel", onWheel, { passive: false });
        return () => {
            stage.removeEventListener("wheel", onWheel);
            window.clearTimeout(timer);
        };
    }, []);

    const zoomBy = (factor: number) => {
        const box = measure(stageRef.current, imageRef.current);
        if (box) setView((current) => zoomView(current, current.scale * factor, 0, 0, box));
    };

    const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, from: view, moved: false };
    };
    const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
        const current = drag.current;
        if (!current || current.id !== event.pointerId) return;
        const dx = event.clientX - current.x;
        const dy = event.clientY - current.y;
        if (!current.moved && Math.hypot(dx, dy) < DRAG_SLOP) return;
        current.moved = true;
        const box = measure(stageRef.current, imageRef.current);
        if (!box || current.from.scale <= 1) return;
        setGesture("drag");
        setView(panView({ ...current.from, x: current.from.x + dx, y: current.from.y + dy }, box));
    };
    const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
        const current = drag.current;
        if (!current || current.id !== event.pointerId) return;
        drag.current = undefined;
        setGesture("");
        const box = measure(stageRef.current, imageRef.current);
        if (current.moved || !box) return;
        // 没拖动就是点击：整张时以点击处为中心放大，放大时回到整张。
        const { px, py } = pointOf(event.currentTarget, event.clientX, event.clientY);
        setView((value) => (value.scale > 1 ? FIT : zoomView(value, Math.max(2, box.actual), px, py, box)));
    };
    const onPointerCancel = () => {
        drag.current = undefined;
        setGesture("");
    };

    return (
        <div className="es-viewer-stage">
            <div ref={stageRef} className="es-zoom" data-zoomed={zoomed || undefined} data-gesture={gesture || undefined} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel}>
                <img ref={imageRef} src={src} alt={alt} draggable={false} style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }} />
            </div>
            <div className="es-zoom-bar" role="toolbar" aria-label="缩放图片">
                <button type="button" className="es-icon-btn" aria-label="缩小" title="缩小" disabled={!zoomed} onClick={() => zoomBy(1 / STEP)}>
                    <Minus size={16} />
                </button>
                <button type="button" className="es-zoom-level" title="回到整张" disabled={!zoomed} onClick={() => setView(FIT)}>
                    {zoomed ? `${Math.round(view.scale * 100)}%` : "适应"}
                </button>
                <button type="button" className="es-icon-btn" aria-label="放大" title="放大，也可以点图片或用滚轮" onClick={() => zoomBy(STEP)}>
                    <Plus size={16} />
                </button>
            </div>
        </div>
    );
}
