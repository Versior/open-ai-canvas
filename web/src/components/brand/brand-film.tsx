import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import { useTranslation } from "react-i18next";
import { useAppearanceStore } from "@/stores/use-appearance-store";
import { cn } from "@/lib/utils";
import "./brand-film.css";

/** 首页与登录弹窗共用后台配置的视频；失败时保留播放器和明确的重试入口。 */
export function BrandFilm({ className, paused = false }: { className?: string; paused?: boolean }) {
    const appearance = useAppearanceStore((state) => state.appearance);
    const reducedMotion = useReducedMotion();
    const { t } = useTranslation();
    const ref = useRef<HTMLVideoElement>(null);
    const [failed, setFailed] = useState(false);
    const [playing, setPlaying] = useState(false);
    const autoplay = appearance.authVideoAutoplay && !reducedMotion && !paused;

    useEffect(() => {
        setFailed(Boolean(ref.current?.error));
        setPlaying(false);
    }, [appearance.authVideoUrl]);

    useEffect(() => {
        const video = ref.current;
        if (!video) return;
        const update = () => {
            if (!autoplay || document.hidden) video.pause();
            else void video.play().catch(() => setPlaying(false));
        };
        update();
        document.addEventListener("visibilitychange", update);
        return () => document.removeEventListener("visibilitychange", update);
    }, [autoplay, appearance.authVideoUrl]);

    if (!appearance.authVideoUrl) return null;
    const play = () => {
        if (ref.current?.error) ref.current.load();
        setFailed(false);
        void ref.current?.play().catch(() => {
            setPlaying(false);
            if (ref.current?.error) setFailed(true);
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
                controls
                preload="metadata"
                aria-label={t("auth.brandFilm", { brand: appearance.brandName })}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onError={() => setFailed(true)}
            />
            {failed || !playing ? (
                <div className="brand-film-status">
                    {failed ? <span role="alert">{t("auth.videoLoadFailed")}</span> : null}
                    <button type="button" onClick={play}>
                        {failed ? t("common.retry") : t("auth.playVideo")}
                    </button>
                </div>
            ) : null}
        </div>
    );
}
