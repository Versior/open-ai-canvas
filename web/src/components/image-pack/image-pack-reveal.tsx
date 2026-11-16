import { useEffect, useState } from "react";
import { Button } from "antd";
import { SkipForward } from "lucide-react";
import { createImagePackScene, type PackImage, type PackPhase } from "./image-pack-scene";
import "./image-pack-reveal.css";

let activeScenes = 0;

export default function ImagePackReveal({ images, anchor, results, onComplete }: { images: readonly PackImage[]; anchor: HTMLElement; results: HTMLElement; onComplete: () => void }) {
    const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
    const [phase, setPhase] = useState<PackPhase>("loading");

    useEffect(() => {
        if (!canvas) return;
        // 与一次最多展示八张图片的范围一致，避免第五张起跳过开包。
        if (activeScenes >= 8) return onComplete();
        activeScenes += 1;
        let active = true;
        const animations: Animation[] = [];
        const fail = () => {
            console.warn("图片生成动效未能播放，已直接显示生成结果。");
            onComplete();
        };
        // 动效失败只降级展示，生成结果和保存状态仍由任务流程决定。
        try {
            const scene = createImagePackScene(canvas, images, anchor, (event) => {
                setPhase(event.phase);
                if (event.phase === "error") return fail();
                if (event.phase !== "settling") return;
                if (matchMedia("(prefers-reduced-motion: reduce)").matches) return onComplete();
                const stage = results.parentElement!;
                const options = { duration: 650, easing: "cubic-bezier(0.22, 0.8, 0.25, 1)", fill: "both" } as const;
                const tiles = results.querySelectorAll<HTMLElement>(".creation-image-result, [data-image-pack-result]");
                const bounds = stage.getBoundingClientRect();
                const scaleX = bounds.width / stage.offsetWidth;
                const scaleY = bounds.height / stage.offsetHeight;
                tiles.forEach((tile, index) => {
                    const target = tile.getBoundingClientRect();
                    const source = event.images[index];
                    const contain = tile instanceof HTMLImageElement && getComputedStyle(tile).objectFit === "contain";
                    const imageScale = contain ? Math.min(target.width / tile.naturalWidth, target.height / tile.naturalHeight) : 1;
                    const photoWidth = contain ? tile.naturalWidth * imageScale : target.width;
                    const photoHeight = contain ? tile.naturalHeight * imageScale : target.height;
                    const stretchX = source.width / photoWidth;
                    const stretchY = source.height / photoHeight;
                    animations.push(
                        tile.animate(
                            [
                                {
                                    transformOrigin: "0 0",
                                    transform: `translate(${(source.x - target.x - ((target.width - photoWidth) / 2) * stretchX) / scaleX}px, ${(source.y - target.y - ((target.height - photoHeight) / 2) * stretchY) / scaleY}px) scale(${stretchX}, ${stretchY})`,
                                    borderRadius: "0",
                                    opacity: 0,
                                },
                                { opacity: 1, offset: 0.25 },
                                { transformOrigin: "0 0", transform: "translate(0, 0) scale(1, 1)", borderRadius: getComputedStyle(tile).borderRadius, opacity: 1 },
                            ],
                            options,
                        ),
                    );
                });
                results.style.opacity = "1";
                const actions = results.querySelector<HTMLElement>(".creation-media-actions");
                if (actions) animations.push(actions.animate([{ opacity: 0 }, { opacity: 1 }], { ...options, delay: 200, duration: 450 }));
                const settle = stage.animate([{ height: `${stage.offsetHeight}px` }, { height: `${results.offsetHeight}px` }], options);
                settle.onfinish = onComplete;
                animations.push(settle);
            });
            void scene.ready.catch(() => {
                if (active) {
                    fail();
                    scene.dispose();
                }
            });
            return () => {
                activeScenes -= 1;
                active = false;
                animations.forEach((animation) => {
                    animation.onfinish = null;
                    animation.cancel();
                });
                results.style.removeProperty("opacity");
                scene.dispose();
            };
        } catch {
            activeScenes -= 1;
            fail();
        }
    }, [canvas, images, anchor, results, onComplete]);

    return (
        <div className="image-generation-reveal" data-phase={phase} inert={phase !== "opening" ? true : undefined} data-canvas-no-zoom onPointerDown={(event) => event.stopPropagation()}>
            <canvas ref={setCanvas} className="image-pack-canvas" aria-label="图片生成完成，正在自动展开" />
            <div className="image-generation-reveal-status">
                <span role="status">{phase === "loading" ? "正在准备图片…" : "图片已生成，正在展开…"}</span>
                <Button type="text" size="small" icon={<SkipForward size={15} />} onClick={onComplete}>
                    跳过动效
                </Button>
            </div>
        </div>
    );
}
