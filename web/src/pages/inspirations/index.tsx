import { useNavigate, useSearchParams } from "react-router";
import { preconnect } from "react-dom";
import { fillablePrompt } from "@/lib/inspirations/resolve";
import { App, Button, Dropdown, Input } from "antd";
import { ChevronDown, Download, Heart, Import, MoreHorizontal, Pencil, Play, Plus, RotateCcw, Search, SlidersHorizontal, Trash2 } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { WorkspacePage } from "@/components/layout/workspace-page";
import { WorkspaceErrorState, WorkspaceLoadingState, WorkspaceState } from "@/components/layout/workspace-state";
import { Select } from "@/components/ui/base/select";
import { Tooltip } from "@/components/ui/base/tooltip";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { catalogIdOf, inspirationSources, type CreationInspiration, type InspirationSourceId } from "@/lib/inspirations/catalog";
import { bindCanvasVideoHoverPreview } from "@/lib/canvas/canvas-video-hover-preview";
import { isCustomInspiration, resolveInspirations } from "@/lib/inspirations/resolve";
import { loadInspirationCatalog, type InspirationCatalog } from "@/services/inspiration-catalog";
import { useInspirationStore, type InspirationDraft } from "@/stores/use-inspiration-store";
import { useUserStore } from "@/stores/use-user-store";
import { InspirationCover, InspirationDetailModal } from "./inspiration-detail-modal";
import { InspirationEditorModal, type InspirationCategoryChoice } from "./inspiration-editor-modal";
import "./inspirations.css";

const LibTVGalleryContent = lazy(() => import("@/pages/inspiration").then((module) => ({ default: module.LibTVGalleryContent })));

type SourceFilter = "all" | InspirationSourceId;
type ViewFilter = "all" | "favorites" | "hidden";
type ModeFilter = "all" | CreationInspiration["mode"];
type SortKey = "default" | "title";
/** 分类标签比编辑器里的选项多一个条目数，用于在标签上显示数量。 */
type CategoryChoice = InspirationCategoryChoice & { count: number };

/** 来源筛选的顺序。必须覆盖 inspirationSources 里全部有内容的来源，漏掉就会有条目筛不到。 */
const SOURCE_ORDER: InspirationSourceId[] = ["original", "chatgpt-prompts", "seedance", "haohaoxue", "youmind"];
const VIEW_OPTIONS: { label: string; value: ViewFilter }[] = [
    { label: "全部", value: "all" },
    { label: "收藏", value: "favorites" },
    { label: "已隐藏", value: "hidden" },
];
const SORT_OPTIONS = [
    { label: "默认顺序", value: "default" },
    { label: "按标题", value: "title" },
];
const MODE_OPTIONS = [
    { label: "全部", value: "all" },
    { label: "图片", value: "image" },
    { label: "视频", value: "video" },
    { label: "文本", value: "text" },
] as const;

function exportFileName() {
    return `yingce-inspirations-${new Date().toISOString().slice(0, 10)}.json`;
}

function downloadText(text: string, fileName: string) {
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
}

export function InspirationHall({ onUse, creationMode, embedded = false }: { onUse: (item: CreationInspiration) => void; creationMode?: CreationInspiration["mode"]; embedded?: boolean }) {
    const { message, modal } = App.useApp();
    const inspirationSourcesVisible = useUserStore((state) => state.features.inspirationSourcesVisible);

    const custom = useInspirationStore((state) => state.custom);
    const overrides = useInspirationStore((state) => state.overrides);
    const hidden = useInspirationStore((state) => state.hidden);
    const favorites = useInspirationStore((state) => state.favorites);
    const hydrated = useInspirationStore((state) => state.hydrated);
    const createEntry = useInspirationStore((state) => state.createEntry);
    const updateEntry = useInspirationStore((state) => state.updateEntry);
    const removeEntry = useInspirationStore((state) => state.removeEntry);
    const restoreEntry = useInspirationStore((state) => state.restoreEntry);
    const toggleFavorite = useInspirationStore((state) => state.toggleFavorite);
    const exportPayload = useInspirationStore((state) => state.exportPayload);
    const importPayload = useInspirationStore((state) => state.importPayload);

    const [catalog, setCatalog] = useState<InspirationCatalog | null>(null);
    const [shouldLoadCatalog, setShouldLoadCatalog] = useState(false);
    const [loadError, setLoadError] = useState("");
    const [reloadKey, setReloadKey] = useState(0);
    const [filtersOpen, setFiltersOpen] = useState(false);
    const sectionRef = useRef<HTMLElement>(null);
    const loadMoreRef = useRef<HTMLDivElement>(null);

    const [source, setSource] = useState<SourceFilter>("all");
    const [modeFilter, setModeFilter] = useState<ModeFilter>(creationMode ?? "all");
    // 创作页每次进入重新推荐，追加加载和数据回填不改变已有条目的顺序。
    const recommendationRanks = useRef(new Map<string, number>());
    const [category, setCategory] = useState("all");
    const [view, setView] = useState<ViewFilter>("all");
    const [sort, setSort] = useState<SortKey>("default");
    const [search, setSearch] = useState("");
    const debouncedSearch = useDebouncedValue(search, 250);
    const [page, setPage] = useState(1);
    const pageSize = 30;

    const [detail, setDetail] = useState<CreationInspiration | null>(null);
    const [editorOpen, setEditorOpen] = useState(false);
    const [editing, setEditing] = useState<CreationInspiration | null>(null);
    const importRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const section = sectionRef.current;
        if (!section) return;
        if (typeof IntersectionObserver === "undefined") {
            setShouldLoadCatalog(true);
            return;
        }
        const observer = new IntersectionObserver(
            ([entry]) => {
                if (!entry?.isIntersecting) return;
                setShouldLoadCatalog(true);
                observer.disconnect();
            },
            { rootMargin: "240px" },
        );
        observer.observe(section);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        if (!shouldLoadCatalog) return;
        preconnect("https://media.goodcase.ai");
        let cancelled = false;
        setLoadError("");
        loadInspirationCatalog()
            .then((loaded) => {
                if (!cancelled) setCatalog(loaded);
            })
            .catch((error) => {
                if (!cancelled) setLoadError(error instanceof Error ? error.message : "灵感目录加载失败");
            });
        return () => {
            cancelled = true;
        };
    }, [shouldLoadCatalog, reloadKey]);

    useEffect(() => {
        if (!inspirationSourcesVisible) setSource("all");
    }, [inspirationSourcesVisible]);

    useEffect(() => {
        if (!creationMode) return;
        setModeFilter(creationMode);
        setSource("all");
        setCategory("all");
        setPage(1);
    }, [creationMode]);

    // 筛选条件一变就回第一页，否则会停在一个已经不存在的位置上。
    useEffect(() => {
        setPage(1);
    }, [source, modeFilter, category, view, sort, debouncedSearch, pageSize]);

    const overlay = useMemo(() => ({ custom, overrides, hidden }), [custom, hidden, overrides]);
    const resolved = useMemo(() => (catalog ? resolveInspirations(catalog.entries, overlay) : []), [catalog, overlay]);

    /** 隐藏态在合成结果里已经滤掉了，单独还原一份给「已隐藏」视图。 */
    const hiddenItems = useMemo(() => {
        if (!catalog) return [];
        const hiddenSet = new Set(hidden);
        return catalog.entries.filter((item) => hiddenSet.has(catalogIdOf(item)));
    }, [catalog, hidden]);

    const categoryLabels = useMemo(() => {
        const map = new Map<string, Map<string, string>>();
        for (const [sourceId, options] of Object.entries(catalog?.categoriesBySource ?? {})) {
            map.set(sourceId, new Map(options.map((option) => [option.id, option.label])));
        }
        return map;
    }, [catalog]);

    const categoryLabel = useCallback(
        (item: CreationInspiration) => {
            const code = item.category?.trim();
            if (!code) return "未分类";
            return categoryLabels.get(item.sourceId ?? "original")?.get(code) ?? code;
        },
        [categoryLabels],
    );

    /** 分类跟随当前来源，并纳入自建和改写后的条目。 */
    const categoryChoices = useMemo<CategoryChoice[]>(() => {
        const merged = new Map<string, { label: string; count: number }>();
        for (const item of [...resolved, ...hiddenItems]) {
            if (source !== "all" && (item.sourceId ?? "original") !== source) continue;
            const value = item.category?.trim();
            if (!value) continue;
            const current = merged.get(value);
            merged.set(value, { label: current?.label ?? categoryLabel(item), count: (current?.count ?? 0) + 1 });
        }
        return [...merged.entries()].sort((left, right) => right[1].count - left[1].count || left[1].label.localeCompare(right[1].label, "zh-Hans-CN")).map(([value, { label, count }]) => ({ value, label, count }));
    }, [categoryLabel, hiddenItems, resolved, source]);

    const sourceCounts = useMemo(() => {
        const counts = new Map<SourceFilter, number>();
        counts.set("all", resolved.length + hiddenItems.length);
        for (const item of [...resolved, ...hiddenItems]) {
            const key = item.sourceId ?? "original";
            counts.set(key, (counts.get(key) ?? 0) + 1);
        }
        return counts;
    }, [resolved, hiddenItems]);

    /** 图片 / 视频 / 文本是库里的两大主类（文本较少），按当前视图与来源统计数量。 */
    const modeCounts = useMemo(() => {
        const counts: Record<ModeFilter, number> = { all: 0, image: 0, video: 0, text: 0 };
        const pool = view === "hidden" ? hiddenItems : resolved;
        const favoriteSet = new Set(favorites);
        for (const item of pool) {
            if (view === "favorites" && !favoriteSet.has(catalogIdOf(item))) continue;
            if (source !== "all" && (item.sourceId ?? "original") !== source) continue;
            counts.all += 1;
            counts[item.mode] += 1;
        }
        return counts;
    }, [view, resolved, hiddenItems, favorites, source]);

    const modeOptions = useMemo(
        () =>
            (
                [
                    { label: "全部", value: "all" },
                    { label: "图片", value: "image" },
                    { label: "视频", value: "video" },
                    { label: "文本", value: "text" },
                ] as const
            ).map((option) => ({
                value: option.value,
                label: (
                    <>
                        <span>{option.label}</span>
                        {catalog ? <span className="inspiration-mode-count app-segmented-count">{modeCounts[option.value].toLocaleString("zh-CN")}</span> : null}
                    </>
                ),
                title: catalog ? `${option.label} ${modeCounts[option.value]} 条` : option.label,
            })),
        [catalog, modeCounts],
    );
    const visible = useMemo(() => {
        const pool = view === "hidden" ? hiddenItems : resolved;
        const ranks = recommendationRanks.current;
        for (const item of embedded ? pool : []) {
            const id = catalogIdOf(item);
            if (!ranks.has(id)) ranks.set(id, Math.random());
        }
        const keyword = debouncedSearch.trim().toLowerCase();
        const favoriteSet = new Set(favorites);
        const filtered = pool.filter((item) => {
            if (view === "favorites" && !favoriteSet.has(catalogIdOf(item))) return false;
            if (source !== "all" && (item.sourceId ?? "original") !== source) return false;
            if (modeFilter !== "all" && item.mode !== modeFilter) return false;
            if (category !== "all" && (item.category?.trim() ?? "") !== category) return false;
            if (!keyword) return true;
            const haystack = [item.title, item.description, item.category, categoryLabel(item), ...(item.tags ?? [])].join(" ").toLowerCase();
            return haystack.includes(keyword);
        });
        if (sort === "title") return [...filtered].sort((left, right) => left.title.localeCompare(right.title, "zh-Hans-CN"));
        if (!embedded) return filtered;
        return filtered.sort((left, right) => ranks.get(catalogIdOf(left))! - ranks.get(catalogIdOf(right))!);
    }, [embedded, view, resolved, hiddenItems, debouncedSearch, favorites, source, modeFilter, category, sort, categoryLabel]);

    const lastPage = Math.max(1, Math.ceil(visible.length / pageSize));
    const currentPage = Math.min(page, lastPage);
    const paged = useMemo(() => visible.slice(0, currentPage * pageSize), [visible, currentPage, pageSize]);
    const hasMore = currentPage < lastPage;
    useEffect(() => {
        const sentinel = loadMoreRef.current;
        if (!sentinel || !hasMore || typeof IntersectionObserver === "undefined") return;
        let advanced = false;
        const observer = new IntersectionObserver(([entry]) => {
            if (!entry?.isIntersecting || advanced) return;
            advanced = true;
            observer.disconnect();
            setPage((current) => Math.min(current + 1, lastPage));
        }, { root: sectionRef.current?.closest(".creation-home-scroll, .app-workspace-scroll") ?? null, rootMargin: "240px" });
        observer.observe(sentinel);
        return () => observer.disconnect();
    }, [embedded, hasMore, lastPage, currentPage, hydrated]);
    useEffect(() => {
        setPage((current) => Math.min(current, lastPage));
    }, [lastPage]);

    const handleUse = useCallback(
        (item: CreationInspiration) => {
            setDetail(null);
            onUse(item);
        },
        [onUse],
    );

    const handleCopy = useCallback(
        (text: string, label: string) => {
            void navigator.clipboard.writeText(text).then(
                () => message.success(`${label}已复制`),
                () => message.error("复制失败，请手动选中文本"),
            );
        },
        [message],
    );

    const handleDelete = useCallback(
        (item: CreationInspiration) => {
            const id = catalogIdOf(item);
            const customItem = isCustomInspiration(id);
            modal.confirm({
                className: "workspace-modal workspace-modal-compact",
                title: customItem ? "删除这条灵感？" : "从库中隐藏这条灵感？",
                content: customItem ? `「${item.title}」会从本地灵感库移除，此操作不可撤销。` : `「${item.title}」来自外部目录，隐藏后可在“已隐藏”视图中找到。`,
                okText: customItem ? "删除" : "隐藏",
                okButtonProps: { danger: true },
                cancelText: "保留",
                onOk: () => {
                    removeEntry(id);
                    setDetail((current) => (current && catalogIdOf(current) === id ? null : current));
                    message.success(customItem ? "已删除" : "已隐藏");
                },
            });
        },
        [message, modal, removeEntry],
    );

    const handleSubmit = useCallback(
        (draft: InspirationDraft) => {
            if (editing) {
                const id = catalogIdOf(editing);
                updateEntry(id, draft);
                setDetail((current) => (current && catalogIdOf(current) === id ? { ...current, ...draft } : current));
                setEditing(null);
                message.success("已保存修改");
                return;
            }
            createEntry(draft);
            setSource("all");
            setModeFilter("all");
            setCategory("all");
            setView("all");
            setSort("default");
            setSearch("");
            setPage(1);
            message.success("灵感已创建");
        },
        [createEntry, editing, message, updateEntry],
    );

    const handleExport = useCallback(() => {
        downloadText(exportPayload(), exportFileName());
        message.success("已导出本地改动（自建条目 / 改写 / 隐藏 / 收藏）");
    }, [exportPayload, message]);

    const handleImportFile = useCallback(
        async (file: File) => {
            try {
                const result = importPayload(await file.text());
                message.success(`导入完成：新增 ${result.created}，覆盖 ${result.updated}${result.skipped ? `，跳过 ${result.skipped} 条无效数据` : ""}`);
            } catch (error) {
                message.error(error instanceof Error ? error.message : "导入失败");
            }
        },
        [importPayload, message],
    );

    const advancedFilterCount = Number(source !== "all") + Number(category !== "all") + Number(view !== "all") + Number(sort !== "default");
    const hasFilters = Boolean(advancedFilterCount || modeFilter !== "all" || search.trim());
    const resetFilters = () => {
        setSource("all");
        setModeFilter(creationMode ?? "all");
        setCategory("all");
        setView("all");
        setSort("default");
        setSearch("");
    };

    return (
        <section ref={sectionRef} id="creation-inspirations" className="inspiration-hall" aria-label="单次创作灵感">

            {!embedded ? <div className="inspiration-hall-toolbar">
                <div className="inspiration-hall-modes" role="group" aria-label="按创作类型筛选灵感">
                    {MODE_OPTIONS.map((option) => <button key={option.value} type="button" aria-pressed={modeFilter === option.value} onClick={() => setModeFilter(option.value)}>{option.label}</button>)}
                </div>
                <Input allowClear prefix={<Search className="size-4" />} placeholder="搜索灵感" aria-label="搜索灵感" value={search} onChange={(event) => setSearch(event.target.value)} className="inspiration-hall-search" />
                <Button type="text" icon={<SlidersHorizontal className="size-4" />} aria-expanded={filtersOpen} aria-controls="inspiration-hall-filters" onClick={() => setFiltersOpen((open) => !open)} className="inspiration-hall-filter-toggle">
                    筛选{advancedFilterCount ? ` · ${advancedFilterCount}` : ""}
                    <ChevronDown className={filtersOpen ? "is-open" : undefined} aria-hidden="true" />
                </Button>
                <div className="inspiration-hall-actions">
                    <Button
                        disabled={!hydrated}
                        icon={<Plus className="size-4" />}
                        onClick={() => {
                            setEditing(null);
                            setEditorOpen(true);
                        }}
                    >
                        新建灵感
                    </Button>
                    <Dropdown
                        trigger={["click"]}
                        placement="bottomRight"
                        menu={{
                            items: [
                                { key: "import", label: "导入灵感", icon: <Import className="size-4" />, disabled: !hydrated },
                                { key: "export", label: "导出本地灵感", icon: <Download className="size-4" />, disabled: !hydrated },
                            ],
                            onClick: ({ key }) => {
                                if (key === "import") importRef.current?.click();
                                if (key === "export") handleExport();
                            },
                        }}
                    >
                        <Button type="text" icon={<MoreHorizontal className="size-4" />} aria-label="更多灵感管理操作" title="更多操作" />
                    </Dropdown>
                </div>
            </div> : null}

            {!embedded && filtersOpen ? (
                <div id="inspiration-hall-filters" className="inspiration-hall-filters" role="group" aria-label="灵感进阶筛选">
                    <div className="inspiration-hall-field">
                        <span>浏览范围</span>
                        <Select options={VIEW_OPTIONS} value={view} onChange={(value) => setView(value as ViewFilter)} ariaLabel="按全部、收藏或隐藏状态筛选灵感" />
                    </div>
                    {inspirationSourcesVisible ? (
                        <div className="inspiration-hall-field">
                            <span>来源</span>
                            <Select
                                options={[
                                    { label: "全部来源", value: "all" },
                                    ...SOURCE_ORDER.filter((key) => (sourceCounts.get(key) ?? 0) > 0).map((key) => ({
                                        label: `${inspirationSources[key].name ?? inspirationSources[key].label} (${sourceCounts.get(key) ?? 0})`,
                                        value: key,
                                    })),
                                ]}
                                value={source}
                                onChange={(value) => {
                                    setSource(value as SourceFilter);
                                    setCategory("all");
                                }}
                                ariaLabel="按来源筛选灵感"
                            />
                        </div>
                    ) : null}
                    <div className="inspiration-hall-field">
                        <span>分类</span>
                        <Select
                            showSearch
                            optionFilterProp="label"
                            options={[{ label: "全部分类", value: "all" }, ...categoryChoices.map((choice) => ({ value: choice.value, label: `${choice.label} (${choice.count})` }))]}
                            value={category}
                            onChange={setCategory}
                            ariaLabel="按分类筛选灵感"
                        />
                    </div>
                    <div className="inspiration-hall-field">
                        <span>排序</span>
                        <Select options={SORT_OPTIONS} value={sort} onChange={(value) => setSort(value as SortKey)} ariaLabel="灵感排序" />
                    </div>
                    {hasFilters ? (
                        <Button type="text" icon={<RotateCcw className="size-4" />} onClick={resetFilters} className="inspiration-hall-reset">
                            重置筛选
                        </Button>
                    ) : null}
                </div>
            ) : null}

            <div className="inspiration-hall-results">
                {!shouldLoadCatalog ? (
                    <div className="inspiration-hall-deferred" aria-hidden="true" />
                ) : loadError ? (
                    <WorkspaceErrorState title="灵感目录加载失败" description={loadError} onRetry={() => setReloadKey((key) => key + 1)} />
                ) : !catalog || !hydrated ? (
                    <WorkspaceLoadingState label="正在准备灵感" rows={3} />
                ) : paged.length ? (
                    <>
                        <div className="inspiration-gallery">
                            {paged.map((item) => {
                                const id = catalogIdOf(item);
                                return (
                                    <InspirationCard
                                        key={id}
                                        item={item}
                                        favorite={!embedded && favorites.includes(id)}
                                        hidden={!embedded && view === "hidden"}
                                        onOpen={() => setDetail(item)}
                                        onToggleFavorite={embedded ? undefined : () => toggleFavorite(id)}
                                        onRestore={
                                            embedded
                                                ? undefined
                                                : () => {
                                                      restoreEntry(id);
                                                      message.success("灵感已恢复显示");
                                                  }
                                        }
                                        onEdit={
                                            embedded
                                                ? undefined
                                                : () => {
                                                      setEditing(item);
                                                      setEditorOpen(true);
                                                  }
                                        }
                                        onDelete={embedded ? undefined : () => handleDelete(item)}
                                    />
                                );
                            })}
                        </div>
                        {hasMore ? <div ref={loadMoreRef} className="inspiration-hall-load-more">
                            <button type="button" onClick={() => setPage((current) => Math.min(current + 1, lastPage))}>加载更多</button>
                        </div> : null}
                    </>
                ) : (
                    <WorkspaceState
                        icon="empty"
                        kind={hasFilters ? "no-results" : "first-use"}
                        title={hasFilters && search.trim() ? `没有找到与“${search.trim()}”相关的灵感` : view === "favorites" ? "还没有收藏" : view === "hidden" ? "没有隐藏的条目" : "没有符合条件的灵感"}
                        description={view === "favorites" ? "点卡片右上角的爱心，把喜欢的创意留在这里。" : "试试其他类型、分类或关键词。"}
                        action={hasFilters ? <Button onClick={resetFilters}>清除筛选</Button> : undefined}
                    />
                )}
            </div>

            {!embedded ? (
                <input
                    ref={importRef}
                    type="file"
                    accept="application/json,.json"
                    className="hidden"
                    onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = "";
                        if (file) void handleImportFile(file);
                    }}
                />
            ) : null}

            <InspirationDetailModal
                item={detail}
                favorite={!embedded && detail ? favorites.includes(catalogIdOf(detail)) : false}
                categoryLabel={embedded ? undefined : categoryLabel}
                onClose={() => setDetail(null)}
                onUse={handleUse}
                onCopy={handleCopy}
                onToggleFavorite={embedded ? undefined : (item) => toggleFavorite(catalogIdOf(item))}
                onEdit={
                    embedded
                        ? undefined
                        : (item) => {
                              setDetail(null);
                              setEditing(item);
                              setEditorOpen(true);
                          }
                }
                onDelete={embedded ? undefined : handleDelete}
            />
            <InspirationEditorModal
                open={editorOpen}
                item={editing}
                categoryOptions={categoryChoices}
                onClose={() => {
                    setEditorOpen(false);
                    setEditing(null);
                }}
                onSubmit={handleSubmit}
            />
        </section>
    );
}

export function InspirationCard({
    item,
    favorite = false,
    hidden = false,
    onOpen,
    onToggleFavorite,
    onRestore,
    onEdit,
    onDelete,
}: {
    item: CreationInspiration;
    favorite?: boolean;
    hidden?: boolean;
    onOpen: () => void;
    onToggleFavorite?: () => void;
    onRestore?: () => void;
    onEdit?: () => void;
    onDelete?: () => void;
}) {
    const [previewProgress, setPreviewProgress] = useState<number | null>(null);
    const [coverRatio, setCoverRatio] = useState(4 / 3);
    const [menuOpen, setMenuOpen] = useState(false);
    const cardRef = useRef<HTMLElement>(null);
    const coverRef = useRef<HTMLSpanElement>(null);
    const managed = Boolean(onToggleFavorite || onRestore || onEdit || onDelete);
    const favoriteLabel = favorite ? "取消收藏" : "收藏";
    useEffect(() => {
        const card = cardRef.current;
        const content = card?.firstElementChild;
        if (!card || !content || typeof ResizeObserver === "undefined") return;
        const measure = () => {
            const gallery = card.parentElement;
            if (!gallery) return;
            const style = getComputedStyle(gallery);
            const row = parseFloat(style.gridAutoRows);
            const gap = parseFloat(style.rowGap);
            if (row > 0 && Number.isFinite(gap)) {
                card.style.gridRowEnd = `span ${Math.ceil((content.getBoundingClientRect().height + gap) / (row + gap))}`;
            }
        };
        const observer = new ResizeObserver(measure);
        observer.observe(content);
        measure();
        return () => observer.disconnect();
    }, []);
    useEffect(() => {
        const cover = coverRef.current;
        const videoUrl = item.mode === "video" ? item.videoUrl : undefined;
        if (!cover || !videoUrl) return;
        return bindCanvasVideoHoverPreview(cover, async () => videoUrl, 6000, setPreviewProgress);
    }, [item.mode, item.videoUrl]);
    return (
        <article ref={cardRef} className="inspiration-card">
            <button type="button" className="inspiration-card-open" aria-label={`查看灵感：${item.title}`} aria-haspopup="dialog" onClick={onOpen}>
                <span ref={coverRef} className="inspiration-card-cover" style={{ aspectRatio: coverRatio }}>
                    <InspirationCover key={item.image} image={item.image} onDimensions={(width, height) => {
                        if (width > 0 && height > 0) setCoverRatio(Math.max(4 / 5, Math.min(16 / 9, width / height)));
                    }} />
                    {item.mode === "video" && item.videoUrl ? (
                        <span className="inspiration-preview-hint" aria-hidden="true">
                            <span className="inspiration-preview-circle">
                                <Play className="inspiration-preview-play size-4" fill="currentColor" />
                                <span className="inspiration-preview-loading" data-indeterminate={previewProgress === null}>
                                    <svg className="inspiration-preview-ring" viewBox="0 0 64 64">
                                        <circle className="inspiration-preview-ring-track" cx="32" cy="32" r="29" />
                                        <circle cx="32" cy="32" r="29" pathLength="100" strokeDasharray="100" strokeDashoffset={100 - (previewProgress ?? 25)} />
                                    </svg>
                                    <span className="inspiration-preview-percent">{previewProgress ?? 0}%</span>
                                </span>
                            </span>
                        </span>
                    ) : null}
                    <span className="inspiration-card-caption" aria-hidden="true">
                        <strong className="inspiration-card-title">{item.title}</strong>
                    </span>
                </span>
            </button>
            {managed ? (
                <div className={`inspiration-card-actions${favorite || menuOpen ? " is-visible" : ""}`}>
                    {onToggleFavorite ? (
                        <Tooltip title={favoriteLabel}>
                            <button type="button" data-icon-only className="inspiration-card-action" aria-label={`${favoriteLabel}：${item.title}`} aria-pressed={favorite} onClick={onToggleFavorite}>
                                <span aria-hidden="true">
                                    <Heart className="size-3.5" fill={favorite ? "currentColor" : "none"} />
                                </span>
                            </button>
                        </Tooltip>
                    ) : null}
                    {hidden && onRestore ? (
                        <Tooltip title="恢复显示">
                            <button type="button" data-icon-only className="inspiration-card-action" aria-label={`恢复显示：${item.title}`} onClick={onRestore}>
                                <span aria-hidden="true">
                                    <RotateCcw className="size-3.5" />
                                </span>
                            </button>
                        </Tooltip>
                    ) : onEdit || onDelete ? (
                        <Dropdown
                            trigger={["click"]}
                            placement="bottomRight"
                            open={menuOpen}
                            onOpenChange={setMenuOpen}
                            menu={{
                                items: [
                                    ...(onEdit ? [{ key: "edit", icon: <Pencil className="size-3.5" />, label: "编辑", onClick: onEdit }] : []),
                                    ...(onDelete ? [{ key: "delete", icon: <Trash2 className="size-3.5" />, label: isCustomInspiration(catalogIdOf(item)) ? "删除" : "隐藏", danger: true, onClick: onDelete }] : []),
                                ],
                            }}
                        >
                            <button type="button" data-icon-only className="inspiration-card-action" aria-label={`更多灵感操作：${item.title}`} aria-haspopup="menu" aria-expanded={menuOpen}>
                                <span aria-hidden="true">
                                    <MoreHorizontal className="size-3.5" />
                                </span>
                            </button>
                        </Dropdown>
                    ) : null}
                </div>
            ) : null}
        </article>
    );
}

export default function InspirationsPage() {
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const canvasView = searchParams.has("work") || searchParams.get("view") !== "prompt";
    return <WorkspacePage className="inspirations-page">
        <nav className="inspirations-view-switch" aria-label="灵感内容">
            {([{ label: "单次创作", canvas: false }, { label: "画布灵感", canvas: true }]).map((view) => (
                <button key={view.label} type="button" aria-pressed={canvasView === view.canvas} onClick={() => {
                    const next = new URLSearchParams(searchParams);
                    if (view.canvas) next.set("view", "canvas");
                    else next.set("view", "prompt");
                    next.delete("work");
                    setSearchParams(next);
                }}>{view.label}</button>
            ))}
        </nav>
        {canvasView ? <>
            <Suspense fallback={<WorkspaceLoadingState label="正在准备画布灵感" rows={3} />}><LibTVGalleryContent /></Suspense>
        </> : <InspirationHall onUse={(item) => navigate("/create", { state: { inspirationMode: item.mode, inspirationPrompt: fillablePrompt(item) } })} />}
    </WorkspacePage>;
}
