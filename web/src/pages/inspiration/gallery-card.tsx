import { LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { buildLibTVImagePreviewUrl, buildLibTVVideoPreviewUrl } from "@/lib/canvas/libtv-import";
import type { LibTVGalleryItem } from "@/types/libtv-gallery";
import "./gallery.css";

export function LibTVGalleryCard({ item, onClick, priority = false, featured, hero = false, onUnavailable }: { item: LibTVGalleryItem; onClick: () => void; priority?: boolean; featured?: boolean; hero?: boolean; onUnavailable?: () => void }) {
    const [unavailable, setUnavailable] = useState(false);
    if (unavailable) return null;
    return <div className={featured ? `creation-featured-card ${hero ? "is-featured-hero" : ""}` : "libtv-gallery-card library-item"} role="button" tabIndex={0} aria-label={item.title} onClick={onClick} onKeyDown={(event) => {
        if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); onClick(); }
    }}>
        <LibTVGalleryCover key={`${item.coverUrl}:${item.mediaUrl}`} item={item} priority={priority} className={featured ? "creation-featured-media" : undefined} onUnavailable={() => { setUnavailable(true); onUnavailable?.(); }} />
        {featured ? <div className="creation-featured-copy"><strong title={item.title}>{item.title}</strong></div> : <div className="library-item-info"><div className="libtv-gallery-title library-item-title" title={item.title}>{item.title}</div></div>}
    </div>;
}

export function LibTVGalleryCover({ item, priority, className, onReady, onUnavailable }: { item: Pick<LibTVGalleryItem, "coverUrl" | "mediaUrl" | "mediaType">; priority: boolean; className?: string; onReady?: () => void; onUnavailable?: () => void }) {
    const hostRef = useRef<HTMLDivElement>(null);
    const [visible, setVisible] = useState(priority);
    const [attempt, setAttempt] = useState(0);
    const [loaded, setLoaded] = useState(false);
    const candidates = [...new Set([
        item.coverUrl ? buildLibTVImagePreviewUrl(item.coverUrl, 480) : "",
        item.coverUrl,
        item.mediaType === "video" ? buildLibTVVideoPreviewUrl(item.mediaUrl) : item.mediaType === "image" ? buildLibTVImagePreviewUrl(item.mediaUrl, 480) : "",
    ].filter(Boolean))];
    const src = candidates[attempt];
    useEffect(() => {
        if (loaded) onReady?.();
        else if (visible && !src) onUnavailable?.();
    }, [loaded, visible, src, onReady, onUnavailable]);
    useEffect(() => {
        if (visible) return;
        if (typeof IntersectionObserver === "undefined") { setVisible(true); return; }
        const observer = new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
        }, { rootMargin: "300px" });
        if (hostRef.current) observer.observe(hostRef.current);
        return () => observer.disconnect();
    }, [visible]);
    useEffect(() => {
        if (!visible || loaded || !src) return;
        const timer = window.setTimeout(() => setAttempt((value) => value + 1), 12000);
        return () => window.clearTimeout(timer);
    }, [visible, loaded, src]);
    return <div ref={hostRef} className={className ?? "libtv-gallery-cover"} aria-busy={visible && Boolean(src) && !loaded}>
        {visible && src ? <>
            {!loaded && <LoaderCircle className="libtv-cover-spinner animate-spin" aria-label="封面加载中" />}
            <img key={src} src={src} alt="" decoding="async" fetchPriority={priority ? "high" : "auto"} onLoad={() => setLoaded(true)} onError={() => { setLoaded(false); setAttempt((value) => value + 1); }} style={{ opacity: loaded ? 1 : 0 }} />
        </> : null}
    </div>;
}
