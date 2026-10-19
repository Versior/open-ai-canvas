// 创作页空态的纵深图片画廊：卡片沿 Z 轴前后排队，当前一张在最前、最大，
// 其余依次后退缩小，像展厅里一排挂在纵深上的画。
// 滚轮、左右按钮或自动轮播切换，切换靠 CSS transition 平滑过渡。
// 卡片是带玻璃质感边框的实体面板，不做弧形、也不压成薄片。
// 展示内容跟随下方输入框的创作类型：选视频就只排队视频灵感，选图片就只排队图片灵感。
//
// 队列是「随机取样」而不是固定切片：每次进场、每次换创作类型都会重新抽一批，
// 并且记住最近出现过哪些，走完一轮自动换下一批，避免反复看到同样那几张。
//
// 与下方画布灵感共用查询缓存，图片作品缺少时回退单次创作图片，详情中可使用提示词。
//
// 每张卡片等自己的封面加载完再露面。不这么做的话，先到的图先显示、
// 慢的那几张只剩一块空面板，观感就是"右边出来了左边还空着"。

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { App } from "antd";
import { useReducedMotion } from "motion/react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router";

import { libTVGalleryInfiniteQuery } from "@/lib/libtv-gallery";
import { getLibTVGallery } from "@/services/api/libtv-gallery";
import type { LibTVGalleryItem } from "@/types/libtv-gallery";
import { LibTVGalleryCover } from "@/pages/inspiration/gallery-card";
import { LibTVWorkDetailDialog } from "@/pages/inspiration/work-detail-dialog";
import { InspirationDetailModal } from "@/pages/inspirations/inspiration-detail-modal";
import { catalogIdOf, type CreationInspiration } from "@/lib/inspirations/catalog";
import { fillablePrompt } from "@/lib/inspirations/resolve";
import { loadGalleryPool } from "@/services/inspiration-catalog";
import type { CreationMode } from "./creation-types";
import { createGalleryWheelGesture } from "./creation-gallery-gesture";
import "./creation-inspiration-tunnel.css";

/** 画廊里排队展示的照片数，取奇数，两侧层数才对得齐。 */
const GALLERY_SIZE = 11;
/** 每后退一层的纵深（px）。 */
const STEP_Z = 150;
/** 虚拟焦距，只用来算出"后退一层缩多少"，不再是 CSS perspective。 */
const PERSPECTIVE = 1200;
/** 最多同时可见的层数，再远就隐掉。 */
const MAX_DEPTH = 4;
/** 每一层的透明度，越靠后越淡，做出空气透视。 */
const DEPTH_OPACITY = [1, 0.98, 0.95, 0.91, 0.86];
/** 自动轮播间隔。悬停、聚焦或系统开了"减少动效"时暂停。 */
const AUTO_ADVANCE_MS = 6500;
/** 记住最近展示过的条目数，换页/刷新时不会又抽到同一批。 */
const RECENT_MEMORY = 66;
const RECENT_KEY = "yingce:creation-canvas-gallery-recent";
type TunnelItem = { id: string; title: string } & ({ work: LibTVGalleryItem; inspiration?: never } | { work?: never; inspiration: CreationInspiration });

/**
 * 把"离眼睛多远"换算成这一层的等比缩放。
 * 原先交给 CSS perspective 做，但每帧的投影光栅化太贵；
 * 平面卡片在固定 z 上做投影变换，结果恰好就是等比缩放加向中轴平移，所以自己算更省。
 */
function depthScale(depth: number): number {
    return PERSPECTIVE / (PERSPECTIVE + STEP_Z * depth);
}

function shuffled<T>(list: T[]): T[] {
    const next = [...list];
    for (let index = next.length - 1; index > 0; index -= 1) {
        const swap = Math.floor(Math.random() * (index + 1));
        [next[index], next[swap]] = [next[swap], next[index]];
    }
    return next;
}

function readRecent(mode: CreationMode): string[] {
    try {
        const raw = window.sessionStorage.getItem(`${RECENT_KEY}:${mode}`);
        const parsed = raw ? (JSON.parse(raw) as unknown) : null;
        return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
    } catch {
        return [];
    }
}

function writeRecent(mode: CreationMode, ids: string[]) {
    try {
        window.sessionStorage.setItem(`${RECENT_KEY}:${mode}`, JSON.stringify(ids.slice(-RECENT_MEMORY)));
    } catch {
        // 隐私模式下 sessionStorage 可能不可用；退化成每次纯随机，不影响功能。
    }
}

/** 随机抽一批：先挑没在最近出现过的，不够再用出现过的补齐，抽完把结果记进"最近"。 */
function pickBatch(pool: TunnelItem[], size: number, mode: CreationMode): TunnelItem[] {
    if (pool.length <= size) return shuffled(pool);
    const recent = new Set(readRecent(mode));
    const byFreshness = [...shuffled(pool.filter((item) => !recent.has(item.id))), ...shuffled(pool.filter((item) => recent.has(item.id)))];
    const picked = byFreshness.slice(0, size);
    writeRecent(mode, [...recent, ...picked.map((item) => item.id)]);
    return picked;
}

/** 当前作品支持点击和键盘打开详情；后排卡片不进入焦点顺序。 */
export function CreationInspirationTunnel({ mode, enabled, hidden = false, onUseInspiration }: { mode: CreationMode; enabled: boolean; hidden?: boolean; onUseInspiration?: (item: CreationInspiration) => void }) {
    const navigate = useNavigate();
    const { message } = App.useApp();
    const { data, isLoading } = useInfiniteQuery({ ...libTVGalleryInfiniteQuery({ keyword: "" }, getLibTVGallery), enabled });
    const pool = useMemo(() => [...new Map((data?.pages.flatMap((page) => page.items) ?? []).map((item) => [item.templateUuid, item])).values()], [data?.pages]);
    const [activeTemplateUuid, setActiveTemplateUuid] = useState<string>();
    const [promptDetail, setPromptDetail] = useState<CreationInspiration | null>(null);
    const [promptPool, setPromptPool] = useState<CreationInspiration[]>([]);
    const [unavailable, setUnavailable] = useState<ReadonlySet<string>>(() => new Set());
    const [shots, setShots] = useState<TunnelItem[]>([]);
    const [active, setActive] = useState(0);
    const [paused, setPaused] = useState(false);
    const [readyIds, setReadyIds] = useState<ReadonlySet<string>>(() => new Set());
    const reducedMotion = useReducedMotion();
    const stageRef = useRef<HTMLDivElement>(null);
    const activeRef = useRef(0);
    activeRef.current = active;

    const canvasPool = useMemo(() => pool.filter((item) => item.mediaType === mode && !unavailable.has(item.templateUuid)), [pool, mode, unavailable]);
    const useImageFallback = mode === "image" && !isLoading && canvasPool.length === 0;
    useEffect(() => {
        if (!enabled || !useImageFallback) return;
        let alive = true;
        void loadGalleryPool().then((entries) => { if (alive) setPromptPool(entries); });
        return () => { alive = false; };
    }, [enabled, useImageFallback]);
    const modePool = useMemo<TunnelItem[]>(() => useImageFallback
        ? promptPool.filter((item) => item.mode === "image" && !unavailable.has(`prompt:${catalogIdOf(item)}`)).map((inspiration) => ({ id: `prompt:${catalogIdOf(inspiration)}`, title: inspiration.title, inspiration }))
        : canvasPool.map((work) => ({ id: work.templateUuid, title: work.title, work })), [useImageFallback, promptPool, unavailable, canvasPool]);
    /** 轮换时读最新的池子，但不把池子写进轮播的依赖——否则池子一到就重置计时。 */
    const modePoolRef = useRef(modePool);
    modePoolRef.current = modePool;

    // 共享列表更新或切换创作类型时，重新抽取匹配作品。
    useEffect(() => {
        setShots(pickBatch(modePool, GALLERY_SIZE, mode));
        setActive(0);
    }, [mode, modePool]);

    /** 仅在封面加载成功后显示；所有候选都失败的作品移出队列。 */
    const markReady = useCallback((id: string) => {
        setReadyIds((current) => (current.has(id) ? current : new Set(current).add(id)));
    }, []);

    const step = useCallback(
        (delta: number) => {
            if (!shots.length) return;
            setActive((current) => (current + delta + shots.length) % shots.length);
        },
        [shots.length],
    );

    // 自动轮播：走完一轮就换一批新的，用户不会反复看到同样那几张。
    useEffect(() => {
        if (!enabled || hidden || paused || activeTemplateUuid || promptDetail || reducedMotion || shots.length < 2) return;
        const timer = window.setInterval(() => {
            const next = activeRef.current + 1;
            if (next < shots.length) {
                setActive(next);
                return;
            }
            setShots(pickBatch(modePoolRef.current, GALLERY_SIZE, mode));
            setActive(0);
        }, AUTO_ADVANCE_MS);
        return () => window.clearInterval(timer);
    }, [enabled, hidden, paused, activeTemplateUuid, promptDetail, reducedMotion, shots.length, mode]);

    // 标签页切到后台时停掉，回来再继续，免得空转。
    useEffect(() => {
        const handleVisibility = () => setPaused(document.hidden);
        document.addEventListener("visibilitychange", handleVisibility);
        return () => document.removeEventListener("visibilitychange", handleVisibility);
    }, []);

    // 只在画廊区域消费滚轮，缩放手势仍由浏览器处理。
    useEffect(() => {
        const node = stageRef.current;
        if (!node) return;
        const gesture = createGalleryWheelGesture();
        const handleWheel = (event: WheelEvent) => {
            if (event.ctrlKey || shots.length < 2) return;
            const rawDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
            const delta = rawDelta * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? node.clientHeight : 1);
            if (Math.abs(delta) < 0.5) return;
            event.preventDefault();
            const direction = gesture(delta, performance.now());
            if (direction) step(direction);
        };
        node.addEventListener("wheel", handleWheel, { passive: false });
        return () => node.removeEventListener("wheel", handleWheel);
    }, [step, shots.length]);

    const current = shots[active];

    if (!enabled || !shots.length) return null;

    return (
        <div className="creation-inspiration-tunnel" data-hidden={hidden} aria-hidden={hidden || undefined} inert={hidden} onPointerEnter={() => setPaused(true)} onPointerLeave={() => setPaused(false)} onFocusCapture={() => setPaused(true)} onBlurCapture={() => setPaused(false)}>
            <div ref={stageRef} className="creation-gallery-stage">
                {shots.map((inspiration, index) => {
                    const id = inspiration.id;
                    const openDetail = () => inspiration.work ? setActiveTemplateUuid(inspiration.work.templateUuid) : setPromptDetail(inspiration.inspiration);
                    const remove = () => setUnavailable((current) => current.has(id) ? current : new Set(current).add(id));
                    // 相对当前卡片的距离，绕成最短路径，形成首尾相接的队列。
                    const half = Math.floor(shots.length / 2);
                    const relative = ((index - active + half + shots.length) % shots.length) - half;

                    const depth = Math.abs(relative);
                    // 超出可见层数就靠透明度淡出，不切 visibility——
                    // 硬切会让最远那张在过渡中途"啪"地消失。
                    const style = {
                        "--card-x": `calc(${relative} * var(--gallery-step))`,
                        "--card-scale": depthScale(depth).toFixed(4),
                        "--card-depth-opacity": depth > MAX_DEPTH ? "0" : `${DEPTH_OPACITY[depth]}`,
                        zIndex: `${100 - depth}`,
                    } as CSSProperties;

                    return (
                        <div
                            key={id}
                            role="button"
                            tabIndex={depth === 0 ? 0 : -1}
                            aria-label={`查看作品：${inspiration.title}`}
                            aria-hidden={depth !== 0 || undefined}
                            inert={depth !== 0}
                            className={`creation-tunnel-card ${depth === 0 ? "is-active" : ""} ${readyIds.has(id) ? "is-ready" : ""}`}
                            style={style}
                            onClick={openDetail}
                            onKeyDown={(event) => {
                                if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); openDetail(); }
                            }}
                        >
                            <LibTVGalleryCover key={inspiration.work ? `${inspiration.work.coverUrl}:${inspiration.work.mediaUrl}` : inspiration.inspiration.image} item={inspiration.work ?? { coverUrl: inspiration.inspiration.image, mediaUrl: inspiration.inspiration.image, mediaType: "image" }} priority className="creation-tunnel-cover" onReady={() => markReady(id)} onUnavailable={remove} />
                            <span className="creation-tunnel-card-info">
                                <span className="creation-tunnel-card-title">{inspiration.title}</span>
                            </span>
                        </div>
                    );
                })}
            </div>

            {/* 图标外面套一层 span 是必须的：workspace-product.css 里有一条
                `button:has(> svg):not(:has(> span)):not(:disabled):hover` 会认领"纯图标按钮"，
                用 !important 改写 color / background 并把 transform 顶成 translateY(-1px)，
                按钮会当场掉半个身位。带 span 的按钮不在那条规则的射程内。 */}
            <button type="button" className="creation-gallery-arrow is-prev" aria-label="上一张灵感" onClick={() => step(-1)}>
                <span className="creation-gallery-arrow-icon">
                    <ChevronLeft aria-hidden="true" />
                </span>
            </button>
            <button type="button" className="creation-gallery-arrow is-next" aria-label="下一张灵感" onClick={() => step(1)}>
                <span className="creation-gallery-arrow-icon">
                    <ChevronRight aria-hidden="true" />
                </span>
            </button>

            {/* 切换当前作品时播报标题。 */}
            <p className="creation-gallery-announce" aria-live="polite">
                {current?.title ?? ""}
            </p>
            <LibTVWorkDetailDialog templateUuid={activeTemplateUuid} onClose={() => setActiveTemplateUuid(undefined)} />
            <InspirationDetailModal item={promptDetail} onClose={() => setPromptDetail(null)} onUse={onUseInspiration ?? ((item) => navigate("/create", { state: { inspirationMode: item.mode, inspirationPrompt: fillablePrompt(item) } }))} onCopy={(text, label) => { void navigator.clipboard.writeText(text).then(() => message.success(`${label}已复制`), () => message.error("复制失败，请手动选中文本")); }} />
        </div>
    );
}
