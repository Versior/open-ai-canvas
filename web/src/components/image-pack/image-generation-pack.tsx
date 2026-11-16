import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { PackImage } from "./image-pack-scene";
import "./image-pack-reveal.css";

const ImagePackReveal = lazy(() => import("./image-pack-reveal"));

/** 只为本次挂载亲眼看到生成完成的图片开包；图片加载和任务状态各自负责就绪。 */
export function ImageGenerationPack({
    pending,
    succeeded,
    disabled = false,
    label = "正在生成图片",
    pendingActions,
    onComplete,
    className = "",
    style,
    children,
}: {
    pending: boolean;
    succeeded: boolean;
    disabled?: boolean;
    label?: ReactNode;
    pendingActions?: ReactNode;
    onComplete?: () => void;
    className?: string;
    style?: CSSProperties;
    children: ReactNode;
}) {
    const [observed, setObserved] = useState({ pending, succeeded });
    const [armed, setArmed] = useState(pending && !disabled);
    const [images, setImages] = useState<PackImage[]>([]);
    const [anchor, setAnchor] = useState<HTMLSpanElement | null>(null);
    const [results, setResults] = useState<HTMLDivElement | null>(null);
    const stage = useRef<HTMLDivElement>(null);
    const waitingSize = useRef<{ width: number; height: number }>(undefined);
    useLayoutEffect(() => {
        if (pending) waitingSize.current = { width: stage.current!.offsetWidth, height: stage.current!.offsetHeight };
    });
    if (observed.pending !== pending || observed.succeeded !== succeeded) {
        setObserved({ pending, succeeded });
        if (pending) {
            setArmed(!disabled);
            setImages([]);
        }
        if (!pending && !succeeded) setArmed(false);
    }
    const complete = useCallback(() => {
        setArmed(false);
        onComplete?.();
    }, [onComplete]);
    useEffect(() => {
        if (disabled) complete();
    }, [disabled, complete]);
    const active = !disabled && (pending || (armed && succeeded));
    const prepare = useCallback(() => {
        if (!armed || pending || !succeeded || disabled || !results) return;
        const elements = Array.from(results.querySelectorAll<HTMLImageElement>("[data-image-pack-result] img, img[data-image-pack-result]"));
        if (elements.length > 8) return complete();
        if (!elements.length || elements.some((image) => !image.complete || !image.naturalWidth)) return;
        const next = elements.map((image, index) => ({ url: image.currentSrc || image.src, label: image.alt || `作品 ${index + 1}` }));
        setImages((current) => (current.length === next.length && current.every((image, index) => image.url === next[index].url) ? current : next));
    }, [armed, pending, succeeded, disabled, results, complete]);
    useEffect(() => {
        if (!active) return;
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
            complete();
            return;
        }
        if (!pending) {
            const bounds = stage.current!.getBoundingClientRect();
            if (bounds.bottom < 0 || bounds.top > window.innerHeight || bounds.right < 0 || bounds.left > window.innerWidth) {
                complete();
                return;
            }
            prepare();
        }
    }, [active, pending, children, prepare, complete]);
    return (
        <div ref={stage} className={`image-pack-slot ${className}`} style={style} data-active={active || undefined}>
            <div ref={setResults} className="image-pack-slot-body" inert={active || undefined} onLoadCapture={prepare} onErrorCapture={complete}>
                {children}
            </div>
            {active ? (
                <>
                    <div className="image-pack-slot-waiting" style={!pending ? waitingSize.current : undefined}>
                        <div className="image-pack-slot-waiting-content">
                            <span ref={setAnchor} className="image-generation-packet" aria-hidden />
                            <div className="image-pack-slot-label" role={typeof label === "string" ? "status" : undefined}>
                                {pending ? label : "图片已生成，正在准备…"}
                            </div>
                        </div>
                    </div>
                    {pending && pendingActions ? (
                        <div className="image-pack-slot-actions" data-canvas-no-zoom>
                            {pendingActions}
                        </div>
                    ) : null}
                    {!pending && images.length > 0 && anchor && results ? (
                        <Suspense fallback={null}>
                            <ImagePackReveal images={images} anchor={anchor} results={results} onComplete={complete} />
                        </Suspense>
                    ) : null}
                </>
            ) : null}
        </div>
    );
}
