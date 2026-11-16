import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import { useTranslation } from "react-i18next";
import { useAppearanceStore } from "@/stores/use-appearance-store";
import { cn } from "@/lib/utils";
import "./brand-film.css";

/** 品牌影片作为循环背景展示；读取失败时提供重试。 */
export function BrandFilm({ className }: { className?: string }) {
    const appearance = useAppearanceStore((state) => state.appearance);
    const reducedMotion = useReducedMotion();
    const { t } = useTranslation();
    const ref = useRef<HTMLVideoElement>(null);
    const [failed, setFailed] = useState(false);
    const autoplay = appearance.authVideoAutoplay && !reducedMotion;
    const [needsPlay, setNeedsPlay] = useState(!autoplay);

    useEffect(() => {
        setFailed(Boolean(ref.current?.error));
        setNeedsPlay(!autoplay);
    }, [appearance.authVideoUrl, autoplay]);

    useEffect(() => {
        const video = ref.current;
        if (!video) return;
        const update = () => {
            if (!autoplay || document.hidden) video.pause();
            else
                void video.play().catch((error: DOMException) => {
                    if (video.error) setFailed(true);
                    if (error.name === "NotAllowedError") setNeedsPlay(true);
                });
        };
        update();
        document.addEventListener("visibilitychange", update);
        return () => document.removeEventListener("visibilitychange", update);
    }, [autoplay, appearance.authVideoUrl]);

    if (!appearance.authVideoUrl) return null;
    const play = () => {
        if (ref.current?.error) ref.current.load();
        setFailed(false);
        void ref.current?.play().catch((error: DOMException) => {
            if (ref.current?.error) setFailed(true);
            if (error.name === "NotAllowedError") setNeedsPlay(true);
        });
    };

    return (
        <div className={cn("brand-film", className)}>
            <video
                ref={ref}
                src={appearance.authVideoUrl}
                poster={appearance.authVideoPosterUrl || undefined}
                autoPlay={autoplay}
                muted
                loop
                playsInline
                preload="metadata"
                aria-label={t("auth.brandFilm", { brand: appearance.brandName })}
                onLoadedMetadata={(event) => {
                    // iOS 没有 poster 时，显式定位首帧才能显示静止的视频画面。
                    if (!appearance.authVideoPosterUrl && event.currentTarget.paused) event.currentTarget.currentTime = 0.001;
                }}
                onPlaying={() => setNeedsPlay(false)}
                onPause={() => setNeedsPlay(true)}
                onError={() => setFailed(true)}
            />
            {failed || needsPlay ? (
                <div className="brand-film-status">
                    {failed ? <span role="alert">{t("auth.videoLoadFailed")}</span> : null}
                    <button type="button" onClick={play}>
                        {t(failed ? "common.retry" : "auth.playVideo")}
                    </button>
                </div>
            ) : null}
        </div>
    );
}
