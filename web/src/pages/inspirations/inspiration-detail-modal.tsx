import { Button } from "antd";
import { Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { AppModal } from "@/components/ui/product/app-modal";
import { MediaPlaceholder } from "@/components/ui/product/media-placeholder";
import { catalogIdOf, type CreationInspiration } from "@/lib/inspirations/catalog";

export function InspirationDetailModal({
    item,
    onClose,
    onUse,
    onCopy,
}: {
    item: CreationInspiration | null;
    onClose: () => void;
    onUse: (item: CreationInspiration) => void;
    onCopy: (text: string, label: string) => void;
}) {
    const [usingPrompt, setUsingPrompt] = useState(false);

    return (
        <AppModal
            open={Boolean(item)}
            onCancel={onClose}
            width={880}
            title={null}
            footer={null}
            flush
            className="inspiration-detail-modal"
            focusTriggerAfterClose={!usingPrompt}
            afterOpenChange={(visible) => {
                if (visible) setUsingPrompt(false);
            }}
        >
            {item ? (
                <div className="flex max-h-[82dvh] flex-col">
                    <div className="inspiration-detail-scroll min-h-0 flex-1 overflow-y-auto">
                        <InspirationDetailMedia key={`${catalogIdOf(item)}:${item.videoUrl ?? item.image}`} item={item} />
                        <div className="flex flex-col gap-4 py-5">
                            <h2 className="text-[var(--fs-heading,16px)] font-semibold leading-6 text-foreground">{item.title}</h2>
                            <PromptSection label={item.promptZh ? "提示词 · 中文" : "提示词"} text={item.promptZh || item.prompt} onCopy={onCopy} />
                            {item.promptZh && item.prompt !== item.promptZh ? <PromptSection label="提示词 · 原文" text={item.prompt} onCopy={onCopy} /> : null}
                        </div>
                    </div>

                    <div className="inspiration-detail-actions flex shrink-0 items-center justify-end gap-2 border-t border-foreground/8 px-5 py-3">
                        <button type="button" className="inspiration-detail-dismiss" onClick={onClose}>关闭</button>
                        <button
                            type="button"
                            className="inspiration-detail-use"
                    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                                <h2 className="text-[var(--fs-heading,16px)] font-semibold leading-6 text-foreground">{item.title}</h2>
                                {item.description ? <p className="mt-1 text-xs leading-5 text-foreground/58">{item.description}</p> : null}
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                                <Tooltip title={favorite ? "取消收藏" : "收藏"}>
                                    <button type="button" data-icon-only className="inspiration-icon-button" aria-label={favorite ? "取消收藏灵感" : "收藏灵感"} aria-pressed={favorite} onClick={() => onToggleFavorite(item)}>
                                        <span aria-hidden="true">
                                            <Heart className="size-4" fill={favorite ? "currentColor" : "none"} />
                                        </span>
                                    </button>
                                </Tooltip>
                                <Tooltip title="编辑">
                                    <button type="button" data-icon-only className="inspiration-icon-button" aria-label="编辑灵感" onClick={() => onEdit(item)}>
                                        <span aria-hidden="true">
                                            <Pencil className="size-4" />
                                        </span>
                                    </button>
                                </Tooltip>
                                <Tooltip title={custom ? "删除" : "从库中隐藏"}>
                                    <button type="button" data-icon-only className="inspiration-icon-button" aria-label={custom ? "删除灵感" : "隐藏灵感"} onClick={() => onDelete(item)}>
                                        <span aria-hidden="true">
                                            <Trash2 className="size-4" />
                                        </span>
                                    </button>
                                </Tooltip>
                            </div>
                        </div>

                        <div className="flex flex-col gap-2">
                            {showSources ? (
                                <MetaRow label="来源">
                                    {source?.name ?? (item.sourceId && item.sourceId !== "original" ? (source?.label ?? "未标注来源") : "原创")}
                                    {item.credit ? ` · ${item.credit}` : ""}
                                </MetaRow>
                            ) : null}
                            <MetaRow label="分类">{categoryLabel(item)}</MetaRow>
                            <MetaRow label="类型">
                                {modeLabels[item.mode]}
                                {item.ratio ? ` · ${item.ratio}` : ""}
                            </MetaRow>
                            {item.tags?.length ? (
                                <MetaRow label="标签">
                                    <span className="flex flex-wrap gap-2">
                                        {item.tags.map((tag) => (
                                            <span key={tag} className="inspiration-chip">
                                                {tag}
                                            </span>
                                        ))}
                                    </span>
                                </MetaRow>
                            ) : null}
                            {showSources && item.sourceUrl ? (
                                <MetaRow label="原页">
                                    <a className="inline-flex items-center gap-1 text-primary hover:underline" href={item.sourceUrl} target="_blank" rel="noreferrer">
                                        查看上游内容 <ExternalLink className="size-3" />
                                    </a>
                                </MetaRow>
                            ) : null}
                        </div>

                        <PromptSection label={item.promptZh ? "提示词 · 中文" : "提示词"} text={item.promptZh || item.prompt} onCopy={onCopy} />
                        {item.promptZh && item.prompt !== item.promptZh ? <PromptSection label="提示词 · 原文" text={item.prompt} onCopy={onCopy} /> : null}
                    </div>

                    <div className="flex shrink-0 items-center justify-end gap-2 border-t border-foreground/8 px-5 py-3">
                        <Button onClick={onClose}>关闭</Button>
                        <Button
                            type="primary"
                            icon={<Wand2 className="size-4" />}
                            onClick={() => {
                                setUsingPrompt(true);
                                onClose();
                                onUse(item);
                            }}
                        >
                            使用提示词
                        </button>
                    </div>
                </div>
            ) : null}
        </AppModal>
    );
}

function InspirationDetailMedia({ item }: { item: CreationInspiration }) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [failed, setFailed] = useState(false);
    const [hovered, setHovered] = useState(false);
    const [focused, setFocused] = useState(false);
    const [touchControls, setTouchControls] = useState(false);
    const [blocked, setBlocked] = useState(false);
    const [fullscreen, setFullscreen] = useState(false);
    useEffect(() => {
        let active = true;
        const video = videoRef.current;
        if (video && item.videoUrl) {
            video.muted = true;
            video.src = item.videoUrl;
            video.load();
            void video.play().catch(() => { if (active) setBlocked(true); });
        }
        return () => {
            active = false;
            if (!video) return;
            video.pause();
            video.removeAttribute("src");
            video.load();
        };
    }, [item.videoUrl]);
    useEffect(() => {
        const update = () => setFullscreen(Boolean(videoRef.current && document.fullscreenElement?.contains(videoRef.current)));
        document.addEventListener("fullscreenchange", update);
        return () => document.removeEventListener("fullscreenchange", update);
    }, []);
    return (
        <div className="inspiration-detail-cover">
            {item.mode === "video" && item.videoUrl && !failed ? (
                <video
                    ref={videoRef}
                    poster={item.image}
                    autoPlay
                    muted
                    controls={hovered || focused || touchControls || blocked || fullscreen}
                    playsInline
                    preload="auto"
                    tabIndex={0}
                    aria-label={item.title}
                    onPointerEnter={(event) => { if (event.pointerType === "mouse") setHovered(true); }}
                    onPointerLeave={() => setHovered(false)}
                    onPointerDown={(event) => { if (event.pointerType !== "mouse") setTouchControls(true); }}
                    onFocus={(event) => setFocused(event.currentTarget.matches(":focus-visible"))}
                    onKeyDown={() => setFocused(true)}
                    onBlur={() => { setFocused(false); setTouchControls(false); }}
                    onPlay={() => setBlocked(false)}
                    onError={() => setFailed(true)}
                />
            ) : <InspirationCover key={item.image} image={item.image} />}
            {failed ? <p className="p-2 text-center text-xs text-foreground/58" role="status">视频暂时无法加载</p> : null}
            {blocked && !failed ? <p className="inspiration-detail-playback-status" role="status">自动播放受限，请点击播放</p> : null}
        </div>
    );
}

export function InspirationCover({ image, onDimensions }: { image: string; onDimensions?: (width: number, height: number) => void }) {
    const [failed, setFailed] = useState(false);
    return failed ? <MediaPlaceholder failed /> : <img src={image} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onLoad={(event) => onDimensions?.(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)} onError={() => setFailed(true)} />;
}

function PromptSection({ label, text, onCopy }: { label: string; text: string; onCopy: (text: string, label: string) => void }) {
    return (
        <section className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-medium text-foreground/58">{label}</h3>
                <Button size="small" icon={<Copy className="size-3.5" />} onClick={() => onCopy(text, label)}>
                    复制
                </Button>
            </div>
            <div className="inspiration-prompt-block">{text}</div>
        </section>
    );
}
