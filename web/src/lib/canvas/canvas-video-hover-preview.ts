// Canvas nodes and inspiration cards share one decoder lease, including pending work.
let stopCurrentPreview: (() => void) | undefined;
export const VIDEO_HOVER_DELAY_MS = 350;
export const VIDEO_HOVER_PREVIEW_MS = 3000;

export function bindCanvasVideoHoverPreview(element: HTMLElement, resolveSource: () => Promise<string>, previewMs = VIDEO_HOVER_PREVIEW_MS, onProgress?: (percent: number | null) => void) {
    let stop: (() => void) | undefined;
    const enter = (event: PointerEvent) => {
        if (event.pointerType !== "mouse" || event.buttons || document.hidden
            || window.matchMedia("(prefers-reduced-motion: reduce)").matches
            || element.closest('[data-canvas-viewport-interacting="true"]')) return;
        if (stop) return;
        stopCurrentPreview?.();
        let disposed = false;
        let video: HTMLVideoElement | undefined;
        let playbackTimer: ReturnType<typeof setTimeout> | undefined;
        const listeners = new AbortController();
        const viewport = element.closest("[data-canvas-viewport]");
        const visibility = new IntersectionObserver((entries) => {
            if (entries.some((entry) => !entry.isIntersecting)) cancel();
        });
        const observer = new MutationObserver(() => {
            if (viewport?.getAttribute("data-canvas-viewport-interacting") === "true") cancel();
        });
        const cancel = () => {
            if (disposed) return;
            disposed = true;
            clearTimeout(delay);
            clearTimeout(deadline);
            clearTimeout(playbackTimer);
            listeners.abort();
            observer.disconnect();
            visibility.disconnect();
            delete element.dataset.hoverPreviewState;
            onProgress?.(null);
            if (video) {
                video.pause();
                video.removeAttribute("src");
                video.load();
                video.remove();
            }
            if (stopCurrentPreview === cancel) stopCurrentPreview = undefined;
            if (stop === cancel) stop = undefined;
        };
        const finish = () => { cancel(); element.dataset.hoverPreviewState = "finished"; };
        const fail = () => { cancel(); element.dataset.hoverPreviewState = "error"; };
        const delay = setTimeout(() => {
            // Explicit playback wins over an incidental hover.
            if (Array.from(document.querySelectorAll("video, audio")).some((media) => !(media as HTMLMediaElement).paused)) {
                cancel();
                return;
            }
            element.dataset.hoverPreviewState = "loading";
            onProgress?.(null);
            void resolveSource().then((src) => {
                if (disposed) return;
                if (!src || !element.isConnected || document.hidden) { cancel(); return; }
                video = document.createElement("video");
                video.muted = true;
                video.playsInline = true;
                video.preload = "metadata";
                video.className = "pointer-events-none absolute inset-0 size-full rounded-[var(--node-radius)] bg-black object-contain";
                video.setAttribute("aria-hidden", "true");
                video.dataset.canvasHoverPreview = "true";
                const updateProgress = () => {
                    if (!video || !onProgress) return;
                    const target = Number.isFinite(video.duration) && video.duration > 0 ? Math.min(previewMs / 1000, video.duration) : previewMs / 1000;
                    let end = 0;
                    for (let index = 0; index < video.buffered.length; index++) {
                        if (video.buffered.start(index) > end + 0.05) break;
                        end = Math.max(end, video.buffered.end(index));
                    }
                    onProgress(end > 0 ? Math.min(100, Math.floor(end / target * 100)) : null);
                };
                for (const type of ["progress", "loadedmetadata", "loadeddata", "canplay"]) {
                    video.addEventListener(type, updateProgress, { signal: listeners.signal });
                }
                video.addEventListener("waiting", () => {
                    element.dataset.hoverPreviewState = "loading";
                    updateProgress();
                }, { signal: listeners.signal });
                video.addEventListener("ended", finish, { signal: listeners.signal });
                video.addEventListener("error", fail, { signal: listeners.signal });
                video.addEventListener("timeupdate", () => {
                    if (video && video.currentTime >= previewMs / 1000) finish();
                }, { signal: listeners.signal });
                video.addEventListener("playing", () => {
                    if (video) video.dataset.hoverPreviewPlaying = "true";
                    element.dataset.hoverPreviewState = "playing";
                    if (!playbackTimer) playbackTimer = setTimeout(finish, previewMs);
                }, { signal: listeners.signal });
                video.src = src;
                element.appendChild(video);
                void video.play().catch(() => { if (!disposed) fail(); });
            }).catch(() => { if (!disposed) fail(); });
        }, VIDEO_HOVER_DELAY_MS);
        // Bound stalled network/decoder sessions as well as actual playback.
        const deadline = setTimeout(fail, 8000 + previewMs - VIDEO_HOVER_PREVIEW_MS);
        stop = cancel;
        stopCurrentPreview = cancel;
        visibility.observe(element);
        if (viewport) observer.observe(viewport, { attributes: true, attributeFilter: ["data-canvas-viewport-interacting"] });
        for (const type of ["pointerdown", "wheel", "keydown", "blur"] as const) {
            window.addEventListener(type, cancel, { capture: true, passive: true, signal: listeners.signal });
        }
        document.addEventListener("visibilitychange", cancel, { signal: listeners.signal });
        document.addEventListener("play", (event) => { if (event.target !== video) cancel(); }, { capture: true, signal: listeners.signal });
    };
    const leave = () => { stop?.(); delete element.dataset.hoverPreviewState; };
    const move = (event: PointerEvent) => {
        if (element.dataset.hoverPreviewState === "finished" || element.dataset.hoverPreviewState === "error") return;
        enter(event);
    };
    element.addEventListener("pointerenter", enter);
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerleave", leave);
    element.addEventListener("pointercancel", leave);
    return () => {
        leave();
        element.removeEventListener("pointerenter", enter);
        element.removeEventListener("pointermove", move);
        element.removeEventListener("pointerleave", leave);
        element.removeEventListener("pointercancel", leave);
    };
}
