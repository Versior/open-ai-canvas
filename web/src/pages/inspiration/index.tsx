import { useInfiniteQuery } from "@tanstack/react-query";
import { Alert, Button, Input, Spin, Tag } from "antd";
import { RotateCw, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";

import { libTVGalleryInfiniteQuery, rankLibTVGalleryTags } from "@/lib/libtv-gallery";
import { getLibTVGallery } from "@/services/api/libtv-gallery";
import type { LibTVGalleryItem, LibTVGalleryTag } from "@/types/libtv-gallery";

import { LibTVWorkDetailDialog } from "./work-detail-dialog";
import { LibTVGalleryCard } from "./gallery-card";

export function LibTVGalleryContent() {
    const [searchParams, setSearchParams] = useSearchParams();
    // 作品弹窗状态挂在地址栏上：返回键可关弹窗，作品链接也能直接分享。
    const activeTemplateUuid = searchParams.get("work") || undefined;
    const [keyword, setKeyword] = useState("");
    const [searchValue, setSearchValue] = useState("");
    const [selectedTagId, setSelectedTagId] = useState<number>();
    const [tagsExpanded, setTagsExpanded] = useState(false);
    const [unavailable, setUnavailable] = useState<ReadonlySet<string>>(() => new Set());
    const loadMoreRef = useRef<HTMLDivElement>(null);

    const { data, isLoading, isError, isFetching, isFetchingNextPage, isFetchNextPageError, error, refetch, fetchNextPage, hasNextPage } = useInfiniteQuery(
        libTVGalleryInfiniteQuery({ keyword, tagId: selectedTagId }, getLibTVGallery),
    );

    const items = useMemo(() => {
        const seen = new Set<string>();
        return (data?.pages.flatMap((page) => page.items) ?? []).filter((item) => {
            if (seen.has(item.templateUuid) || unavailable.has(item.templateUuid)) return false;
            seen.add(item.templateUuid);
            return true;
        });
    }, [data?.pages, unavailable]);

    useEffect(() => {
        const target = loadMoreRef.current;
        if (!target || !hasNextPage || isFetching || isError || activeTemplateUuid || typeof IntersectionObserver === "undefined") return;
        let requested = false;
        const observer = new IntersectionObserver((entries) => {
            if (requested || !entries.some((entry) => entry.isIntersecting)) return;
            requested = true;
            void fetchNextPage({ cancelRefetch: false });
        }, { root: target.closest(".app-workspace-scroll"), rootMargin: "0px 0px 240px 0px" });
        observer.observe(target);
        return () => observer.disconnect();
    }, [activeTemplateUuid, fetchNextPage, hasNextPage, isError, isFetching, items.length, keyword, selectedTagId]);

    // 标签取自已加载过的作品并持续累积，选中某个标签后其它标签仍可切换；加载中/0 结果/失败时目录仍在，能切回去。
    const [knownTags, setKnownTags] = useState<LibTVGalleryTag[]>([]);
    useEffect(() => {
        if (items.length === 0) return;
        setKnownTags((prev) => {
            const byId = new Map(prev.map((tag) => [tag.id, tag]));
            let changed = false;
            for (const item of items) {
                for (const tag of item.tags) {
                    if (byId.has(tag.id)) continue;
                    byId.set(tag.id, tag);
                    changed = true;
                }
            }
            return changed ? Array.from(byId.values()) : prev;
        });
    }, [items]);

    // 官方标签有几十个：首屏只给最常用的几个，其余按需展开；选中的标签始终在可见位置。
    const tagRank = useMemo(() => rankLibTVGalleryTags(items, selectedTagId, 8, knownTags), [items, selectedTagId, knownTags]);
    const visibleTags = tagsExpanded ? knownTags : tagRank.visible;

    const handleSearch = () => {
        setKeyword(searchValue.trim());
    };

    const handleTagClick = (tagId?: number) => {
        setSelectedTagId(tagId);
    };

    // 追加页失败只重试那一页，不重拉已加载的页。
    const handleRetry = () => {
        if (isFetching) return;
        if (isFetchNextPageError) {
            void fetchNextPage({ cancelRefetch: false });
            return;
        }
        void refetch();
    };

    const openWork = (item: LibTVGalleryItem) => {
        const next = new URLSearchParams(searchParams);
        next.set("work", item.templateUuid);
        // 压一条新历史：否则 replace 会把列表那条记录改写掉，浏览器返回会直接离开灵感广场，而不是只关掉弹窗。
        setSearchParams(next);
    };

    const closeWork = () => {
        const next = new URLSearchParams(searchParams);
        next.delete("work");
        setSearchParams(next, { replace: true });
    };

    return (
        <>
            <div className="space-y-6 pb-12">
                {/* Search */}
                <div className="flex gap-3">
                    <Input
                        value={searchValue}
                        onChange={(e) => setSearchValue(e.target.value)}
                        onPressEnter={handleSearch}
                        placeholder="搜索作品关键词"
                        prefix={<Search className="size-4 text-foreground/35" />}
                        size="large"
                        allowClear
                    />
                    <Button type="primary" className="libtv-gallery-search" size="large" onClick={handleSearch} loading={isLoading}>
                        搜索
                    </Button>
                </div>

                {/* Tags：首屏只铺常用的几个，剩下的按需展开，窄屏不靠标签墙占满一屏 */}
                {knownTags.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2">
                        <Tag.CheckableTag checked={!selectedTagId} onChange={() => handleTagClick(undefined)}>
                            全部
                        </Tag.CheckableTag>
                        {visibleTags.map((tag) => (
                            <Tag.CheckableTag key={tag.id} checked={selectedTagId === tag.id} onChange={() => handleTagClick(tag.id)}>
                                {tag.label}
                            </Tag.CheckableTag>
                        ))}
                        {knownTags.length > tagRank.visible.length && (
                            <button type="button" className="px-1 text-xs text-foreground/50 underline" aria-expanded={tagsExpanded} onClick={() => setTagsExpanded((value) => !value)}>
                                {tagsExpanded ? "收起标签" : `展开全部 ${knownTags.length} 个标签`}
                            </button>
                        )}
                    </div>
                )}

                {/* Error */}
                {error && !isFetchNextPageError && (
                    <Alert
                        type="error"
                        message="加载失败"
                        description={error instanceof Error ? error.message : "请求出错"}
                        action={
                            <Button size="small" onClick={handleRetry} loading={isFetching}>
                                重试
                            </Button>
                        }
                    />
                )}

                {/* Gallery Grid */}
                {isLoading ? (
                    <div className="flex items-center justify-center py-20">
                        <Spin size="large" />
                    </div>
                ) : items.length === 0 && !hasNextPage && !error ? (
                    <div className="py-20 text-center text-sm text-foreground/45">
                        {keyword ? `没有找到包含「${keyword}」的作品` : "暂无作品"}
                    </div>
                ) : items.length > 0 || hasNextPage ? (
                    <>
                        <div className="libtv-gallery-grid">
                            {items.map((item, index) => (
                                <LibTVGalleryCard key={item.templateUuid} item={item} priority={index < 4} onClick={() => openWork(item)} onUnavailable={() => setUnavailable((current) => new Set(current).add(item.templateUuid))} />
                            ))}
                        </div>

                        <div ref={loadMoreRef} className="flex min-h-8 items-center justify-center gap-2 pt-4 text-xs text-foreground/50" role="status" aria-live="polite">
                            {isFetchNextPageError ? (
                                <>
                                    <span>下一批作品加载失败</span>
                                    <Button size="small" icon={<RotateCw size={14} />} onClick={handleRetry} loading={isFetchingNextPage} disabled={isFetching}>
                                        重试
                                    </Button>
                                </>
                            ) : isFetchingNextPage ? (
                                <><Spin size="small" /><span>正在加载更多作品…</span></>
                            ) : !hasNextPage ? (
                                <span>已展示全部 {items.length} 个作品</span>
                            ) : null}
                        </div>
                    </>
                ) : null}
            </div>

            <LibTVWorkDetailDialog templateUuid={activeTemplateUuid} onClose={closeWork} />
        </>
    );
}
