import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Dropdown, type MenuProps } from "antd";
import { ArrowDown, ArrowUp, ChevronDown, ChevronUp, FileText, Image as ImageIcon, LoaderCircle, MoreHorizontal, PanelsTopLeft, Pin, PinOff, Plus, RotateCcw, Trash2, Video } from "lucide-react";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { CachedResourceImage } from "@/components/cached-resource-image";
import { cn } from "@/lib/utils";
import { loadCanvasProjectPage } from "@/lib/workspace-route-modules";
import { listRemoteCanvasProjects, listRemoteCanvasProjectsPage, type CanvasLibrarySummary } from "@/services/api/user-data";
import { resolveBackendApiUrl } from "@/stores/use-config-store";
import { useCreationSidebarHistory } from "@/hooks/use-creation-sidebar-history";
import { useUserStore } from "@/stores/use-user-store";
import { useCanvasUiStore } from "@/stores/canvas/use-canvas-ui-store";
import { CanvasNodeType } from "@/types/canvas";
import { EMPTY_HISTORY_PREFS, orderSidebarHistory, useSidebarHistoryPrefsStore, type SidebarHistoryKind } from "@/stores/use-sidebar-history-prefs-store";

const PAGE_SIZE = 5;

function HistorySection({ title, action, children, loading }: { title: string; action?: ReactNode; children: ReactNode; loading?: boolean }) {
    return (
        <section className="workspace-history-section" aria-label={title} aria-busy={loading || undefined}>
            <header className="workspace-history-heading">
                <h2>{title}</h2>
                {action}
            </header>
            {children}
        </section>
    );
}

function HistorySkeleton() {
    return (
        <div className="workspace-history-list" aria-hidden="true">
            {Array.from({ length: PAGE_SIZE }, (_, index) => (
                <div className="workspace-history-skeleton" key={index}>
                    <span />
                    <span />
                </div>
            ))}
        </div>
    );
}

function HistoryPagination({ hasMore, expanded, loading, failed, onMore, onCollapse }: { hasMore: boolean; expanded: boolean; loading?: boolean; failed?: boolean; onMore: () => void; onCollapse: () => void }) {
    const { t } = useTranslation();
    if (!hasMore && !expanded && !failed) return null;
    return (
        <div className="workspace-history-pagination">
            {hasMore || failed ? (
                <button type="button" className="workspace-history-more" onClick={onMore} disabled={loading}>
                    {loading ? <LoaderCircle className="animate-spin" aria-hidden /> : <ChevronDown aria-hidden />}
                    <span>{t(loading ? "nav.sidebar.loading" : failed ? "common.retry" : "nav.sidebar.loadMore")}</span>
                </button>
            ) : (
                <span />
            )}
            {expanded ? (
                <button type="button" className="workspace-history-more" onClick={onCollapse} disabled={loading}>
                    <ChevronUp aria-hidden />
                    <span>{t("nav.sidebar.showLess")}</span>
                </button>
            ) : null}
        </div>
    );
}

const conversationIcons = { video: Video, image: ImageIcon, text: FileText };

function HistoryRow({ userId, kind, id, title, ids, children, onDelete }: { userId: string; kind: SidebarHistoryKind; id: string; title: string; ids: string[]; children: ReactNode; onDelete?: () => void }) {
    const { t } = useTranslation();
    const prefs = useSidebarHistoryPrefsStore((state) => state.users[userId]?.[kind] || EMPTY_HISTORY_PREFS);
    const [open, setOpen] = useState(false);
    const pinned = prefs.pinned.includes(id);
    const index = ids.indexOf(id);
    const menuId = `sidebar-history-menu-${kind}-${id}`;
    const menu: MenuProps = {
        id: menuId,
        items: [
            { key: "pin", label: t(pinned ? "nav.sidebar.unpin" : "nav.sidebar.pin"), icon: pinned ? <PinOff /> : <Pin /> },
            { key: "up", label: t("nav.sidebar.moveUp"), icon: <ArrowUp />, disabled: index <= 0 || pinned !== prefs.pinned.includes(ids[index - 1]) },
            { key: "down", label: t("nav.sidebar.moveDown"), icon: <ArrowDown />, disabled: index >= ids.length - 1 || pinned !== prefs.pinned.includes(ids[index + 1]) },
            { key: "reset", label: t("nav.sidebar.resetOrder"), icon: <RotateCcw />, disabled: !prefs.order.length },
            ...(onDelete ? [{ type: "divider" as const }, { key: "delete", label: t("common.delete"), icon: <Trash2 />, danger: true }] : []),
        ],
        onClick: ({ key, domEvent }) => {
            domEvent.preventDefault();
            domEvent.stopPropagation();
            const store = useSidebarHistoryPrefsStore.getState();
            if (key === "pin") store.togglePin(userId, kind, id);
            if (key === "up" || key === "down") store.move(userId, kind, ids, id, key === "up" ? -1 : 1);
            if (key === "reset") store.resetOrder(userId, kind);
            if (key === "delete") onDelete?.();
            setOpen(false);
        },
    };
    return (
        <li className={cn("workspace-history-row", open && "is-menu-open", pinned && "is-pinned")}>
            <Dropdown trigger={["contextMenu"]} menu={menu} open={open} onOpenChange={setOpen} destroyOnHidden classNames={{ root: "workspace-history-menu" }}>
                <div className="workspace-history-row-content">
                    {children}
                    {pinned ? <Pin className="workspace-history-pin" aria-label={t("nav.sidebar.pinned")} /> : null}
                    <button
                        type="button"
                        className="workspace-history-actions"
                        aria-label={t("nav.sidebar.itemActions", { title })}
                        aria-haspopup="menu"
                        aria-controls={open ? menuId : undefined}
                        aria-expanded={open}
                        onClick={() => setOpen((value) => !value)}
                    >
                        <MoreHorizontal aria-hidden />
                    </button>
                </div>
            </Dropdown>
        </li>
    );
}

function ConversationHistory({ userId, onNavigate }: { userId: string; onNavigate: () => void }) {
    const { t } = useTranslation();
    const history = useCreationSidebarHistory(userId);
    const prefs = useSidebarHistoryPrefsStore((state) => state.users[userId]?.conversations || EMPTY_HISTORY_PREFS);
    const items = useMemo(() => orderSidebarHistory(history.items, prefs), [history.items, prefs]);
    const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
    return (
        <HistorySection
            title={t("nav.sidebar.conversations")}
            loading={history.loading}
            action={
                <Link
                    to="/?conversation=new"
                    className="product-icon-button"
                    aria-label={t("nav.sidebar.newConversation")}
                    title={t(history.canSelect ? "nav.sidebar.newConversation" : "nav.sidebar.switchUnavailable")}
                    aria-disabled={!history.canSelect || undefined}
                    onClick={(event) => {
                        if (!history.canSelect) event.preventDefault();
                        else onNavigate();
                    }}
                >
                    <Plus aria-hidden />
                </Link>
            }
        >
            {history.loading ? <HistorySkeleton /> : null}
            {history.error ? (
                <div className="workspace-history-state" role="alert">
                    <span>{t("nav.sidebar.historyFailed")}</span>
                    <button type="button" className="workspace-history-more" disabled={history.loading} onClick={history.refetch}>
                        {t("common.retry")}
                    </button>
                </div>
            ) : null}
            <ul className="workspace-history-list">
                {items.slice(0, visibleCount).map((item) => {
                    const current = item.id === history.activeId;
                    const disabled = !current && !history.canSelect;
                    const Icon = conversationIcons[item.mode];
                    return (
                        <HistoryRow key={item.id} userId={userId} kind="conversations" id={item.id} title={item.title || t("nav.sidebar.newConversation")} ids={items.map((value) => value.id)}>
                            <Link
                                to={`/?conversation=${encodeURIComponent(item.id)}`}
                                className={cn("workspace-history-item", current && "is-active")}
                                aria-current={current ? "page" : undefined}
                                aria-disabled={disabled || undefined}
                                title={disabled ? t("nav.sidebar.switchUnavailable") : item.title || t("nav.sidebar.newConversation")}
                                onClick={(event) => {
                                    if (disabled) event.preventDefault();
                                    else onNavigate();
                                }}
                            >
                                <span className="workspace-history-thumb" role="img" aria-label={t(`create.mode.${item.mode}`)}>
                                    <Icon aria-hidden />
                                </span>
                                <span className="workspace-history-title">{item.title || t("nav.sidebar.newConversation")}</span>
                            </Link>
                        </HistoryRow>
                    );
                })}
            </ul>
            {!history.loading && !history.items.length && !history.error ? <p className="workspace-history-state">{t("nav.sidebar.noConversations")}</p> : null}
            <HistoryPagination hasMore={history.items.length > visibleCount} expanded={visibleCount > PAGE_SIZE} onMore={() => setVisibleCount((count) => count + PAGE_SIZE)} onCollapse={() => setVisibleCount(PAGE_SIZE)} />
        </HistorySection>
    );
}

function CanvasThumbnail({ project }: { project: CanvasLibrarySummary }) {
    const image = project.previewNodes.find((node) => node.type === CanvasNodeType.Image && (node.metadata?.storageKey || node.metadata?.previewContent || node.metadata?.content));
    const fallback = <PanelsTopLeft />;
    return (
        <span className="workspace-history-thumb" aria-hidden>
            {image ? (
                <CachedResourceImage storageKey={image.metadata?.storageKey} src={resolveBackendApiUrl(image.metadata?.previewContent || image.metadata?.content || "")} variant="thumbnail" alt="" loading="lazy" decoding="async" fallback={fallback} />
            ) : (
                fallback
            )}
        </span>
    );
}

function CanvasHistory({ userId, onNavigate }: { userId: string; onNavigate: () => void }) {
    const { t } = useTranslation();
    const hydrated = useUserStore((state) => state.hydrated);
    const setDeleteIds = useCanvasUiStore((state) => state.setDeleteProjectIds);
    const prefs = useSidebarHistoryPrefsStore((state) => state.users[userId]?.canvases || EMPTY_HISTORY_PREFS);
    const preferredIds = useMemo(() => new Set([...prefs.pinned, ...prefs.order]), [prefs]);
    const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
    const loadingMore = useRef(false);
    const query = useInfiniteQuery({
        queryKey: ["canvas-library", userId, "sidebar", "updated", PAGE_SIZE],
        queryFn: ({ pageParam, signal }) => listRemoteCanvasProjectsPage({ page: pageParam, pageSize: PAGE_SIZE, sort: "updated", signal }),
        initialPageParam: 1,
        getNextPageParam: (last) => (last.hasMore ? last.page + 1 : undefined),
        enabled: hydrated,
    });
    // Saved pins/order may point beyond page one. Resolve them from the owner's lightweight
    // server metadata, never from cached titles or whole canvas documents.
    const preferredQuery = useQuery({
        queryKey: ["canvas-library", userId, "sidebar-preferences"],
        queryFn: listRemoteCanvasProjects,
        enabled: hydrated && preferredIds.size > 0,
    });
    // 更新排序的分页可能重叠：保留首次出现的最新摘要，避免重复条目。
    const projects = useMemo(() => {
        const unique = new Map<string, CanvasLibrarySummary>();
        for (const page of query.data?.pages ?? []) for (const project of page.projects) if (!unique.has(project.id)) unique.set(project.id, project);
        for (const project of preferredQuery.data?.projects ?? []) if (preferredIds.has(project.id) && !unique.has(project.id)) unique.set(project.id, { ...project, nodeCount: 0, previewNodes: [] });
        return orderSidebarHistory([...unique.values()], prefs);
    }, [query.data, preferredQuery.data, preferredIds, prefs]);
    const loadMore = async () => {
        if (query.isFetching || loadingMore.current) return;
        if (projects.length >= visibleCount + PAGE_SIZE || !query.hasNextPage) {
            setVisibleCount((count) => count + PAGE_SIZE);
            return;
        }
        loadingMore.current = true;
        try {
            const result = await query.fetchNextPage();
            if (!result.isError) setVisibleCount((count) => count + PAGE_SIZE);
        } finally {
            loadingMore.current = false;
        }
    };
    const preload = () => {
        void loadCanvasProjectPage();
    };
    return (
        <HistorySection
            title={t("nav.sidebar.canvases")}
            loading={query.isPending || query.isFetchingNextPage}
            action={
                <Link to="/canvas" className="workspace-history-all" onClick={onNavigate}>
                    {t("nav.sidebar.viewAll")}
                </Link>
            }
        >
            {query.isPending ? (
                <HistorySkeleton />
            ) : (
                <ul className="workspace-history-list">
                    {projects.slice(0, visibleCount).map((project) => (
                        <HistoryRow key={project.id} userId={userId} kind="canvases" id={project.id} title={project.title || t("create.recent.untitledCanvas")} ids={projects.map((value) => value.id)} onDelete={() => setDeleteIds([project.id])}>
                            <Link to={`/canvas/${project.id}`} className="workspace-history-item" title={project.title || t("create.recent.untitledCanvas")} onClick={onNavigate} onPointerEnter={preload} onFocus={preload} aria-haspopup="menu">
                                <CanvasThumbnail project={project} />
                                <span className="workspace-history-title">{project.title || t("create.recent.untitledCanvas")}</span>
                            </Link>
                        </HistoryRow>
                    ))}
                </ul>
            )}
            {query.isError ? (
                <div className="workspace-history-state" role="alert">
                    <span>{t("nav.sidebar.canvasesFailed")}</span>
                    {!query.isFetchNextPageError ? (
                        <button type="button" className="workspace-history-more" disabled={query.isFetching} onClick={() => void query.refetch()}>
                            {t("common.retry")}
                        </button>
                    ) : null}
                </div>
            ) : !query.isPending && !projects.length ? (
                <p className="workspace-history-state">{t("nav.sidebar.noCanvases")}</p>
            ) : null}
            {preferredQuery.isError && preferredIds.size ? (
                <div className="workspace-history-state" role="alert">
                    <span>{t("nav.sidebar.preferencesFailed")}</span>
                    <button type="button" className="workspace-history-more" onClick={() => void preferredQuery.refetch()}>
                        {t("common.retry")}
                    </button>
                </div>
            ) : null}
            <HistoryPagination
                hasMore={projects.length > visibleCount || Boolean(query.hasNextPage)}
                expanded={visibleCount > PAGE_SIZE}
                loading={query.isFetching}
                failed={query.isFetchNextPageError}
                onMore={() => void loadMore()}
                onCollapse={() => setVisibleCount(PAGE_SIZE)}
            />
        </HistorySection>
    );
}

export function WorkspaceSidebarHistory({ userId, onNavigate }: { userId: string; onNavigate: () => void }) {
    return (
        <div className="workspace-sidebar-history">
            <ConversationHistory key={`conversations-${userId}`} userId={userId} onNavigate={onNavigate} />
            <CanvasHistory key={`canvases-${userId}`} userId={userId} onNavigate={onNavigate} />
        </div>
    );
}
