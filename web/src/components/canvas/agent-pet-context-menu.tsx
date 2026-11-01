import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Check, ChevronRight, LoaderCircle, Maximize2, MessageCircleHeart, MessageSquareQuote, MessageSquareText, Minus, RotateCcw, Shirt, Sparkles, Store } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type FocusEvent, type KeyboardEvent, type ReactNode } from "react";

import { AgentPetSprite } from "@/components/canvas/agent-pet-sprite";
import { Switch } from "@/components/ui/base/switch";
import { agentPetCatalogQueryKey, useApplyAgentPet } from "@/hooks/use-active-agent-pet";
import type { CanvasTheme } from "@/lib/canvas-theme";
import { AGENT_PET_ASPECT, AGENT_PET_SIZE_OPTIONS } from "@/lib/canvas/agent-pet";
import { agentPetSpritesheetURL, getAgentPetCatalog, type AgentPet } from "@/services/api/agent-pets";
import { useAgentPetPrefsStore } from "@/stores/use-agent-pet-prefs-store";
import { useUserStore } from "@/stores/use-user-store";

const MENU_WIDTH = 232;
const MENU_MARGIN = 12;
const THUMB_HEIGHT = 24;
const THUMB_WIDTH = Math.round(THUMB_HEIGHT * AGENT_PET_ASPECT);
const ITEM_SELECTOR = "[data-agent-pet-menu-item]:not(:disabled)";

export type AgentPetMenuPoint = { x: number; y: number };

type AgentPetContextMenuProps = {
    theme: CanvasTheme;
    /** 打开位置：右键时是光标，键盘打开时是入口中心。 */
    point: AgentPetMenuPoint;
    title: string;
    /** 正在显示宠物形象（未收起）：显示大小、气泡和说句话。 */
    petShown: boolean;
    collapsed: boolean;
    approvalPending: boolean;
    onOpenAgent: () => void;
    onOpenStore: () => void;
    onSpeak: () => void;
    onToggleCollapsed: () => void;
    /** restoreFocus 为 true 时焦点回到入口（Esc、执行完命令）；点到外面关闭时不抢焦点。 */
    onClose: (restoreFocus: boolean) => void;
};

/**
 * 智能体入口的右键菜单：打开助手、更换形象、形象商店、大小、头顶气泡、说句话、收起。
 * 在光标处打开，靠近屏幕边缘时向内翻转；点外面、按 Esc、窗口尺寸变化或失焦时关闭。
 */
export function AgentPetContextMenu({ theme, point, title, petShown, collapsed, approvalPending, onOpenAgent, onOpenStore, onSpeak, onToggleCollapsed, onClose }: AgentPetContextMenuProps) {
    const element = useRef<HTMLDivElement>(null);
    const userId = useUserStore((state) => state.user?.id || "");
    const [view, setView] = useState<"main" | "pets">("main");
    const size = useAgentPetPrefsStore((state) => state.size);
    const setSize = useAgentPetPrefsStore((state) => state.setSize);
    const chatter = useAgentPetPrefsStore((state) => state.chatter);
    const setChatter = useAgentPetPrefsStore((state) => state.setChatter);

    useEffect(() => {
        // 捕获阶段监听：入口自己的指针处理会阻止冒泡，点回形象身上也要能关菜单。
        const closeOutside = (event: PointerEvent) => {
            if (event.target instanceof Node && element.current?.contains(event.target)) return;
            onClose(false);
        };
        const closeQuietly = () => onClose(false);
        window.addEventListener("pointerdown", closeOutside, true);
        window.addEventListener("resize", closeQuietly);
        window.addEventListener("blur", closeQuietly);
        return () => {
            window.removeEventListener("pointerdown", closeOutside, true);
            window.removeEventListener("resize", closeQuietly);
            window.removeEventListener("blur", closeQuietly);
        };
    }, [onClose]);

    // 打开和切换子菜单后聚焦当前形象或第一项，键盘可以直接上下选择。菜单是 fixed，聚焦只滚动菜单自身。
    useEffect(() => {
        const root = element.current;
        (root?.querySelector<HTMLElement>(`${ITEM_SELECTOR}[aria-current="true"]`) ?? root?.querySelector<HTMLElement>(ITEM_SELECTOR))?.focus();
    }, [view]);

    const run = (action: () => void) => {
        onClose(true);
        action();
    };

    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            if (view === "pets") setView("main");
            else onClose(true);
            return;
        }
        const items = [...(element.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? [])];
        if (!items.length || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        event.stopPropagation();
        const current = items.indexOf(document.activeElement as HTMLElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
    };
    // Tab 移出菜单时关闭，焦点留在用户去的地方。
    const onBlur = (event: FocusEvent<HTMLDivElement>) => {
        if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) onClose(false);
    };

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = Math.max(MENU_MARGIN, Math.min(point.x + MENU_WIDTH + MENU_MARGIN <= vw ? point.x + 4 : point.x - MENU_WIDTH - 4, vw - MENU_WIDTH - MENU_MARGIN));
    // 入口通常在右下角：下方放不下就从光标往上展开，子菜单变长时继续往上长。
    const upward = point.y > vh / 2;
    const placement: CSSProperties = upward ? { bottom: vh - point.y + 4, maxHeight: point.y - 4 - MENU_MARGIN } : { top: point.y + 4, maxHeight: vh - point.y - 4 - MENU_MARGIN };

    return (
        <div
            ref={element}
            role="group"
            aria-label="智能体形象菜单"
            className="aceternity-floating-panel fixed z-[var(--z-popover)] flex flex-col overflow-hidden rounded-[var(--r-lg)] border p-1.5 backdrop-blur-2xl backdrop-saturate-150"
            style={{ left, width: MENU_WIDTH, ...placement, background: theme.spatial.elevated, borderColor: theme.toolbar.border, color: theme.node.text, "--menu-hover": theme.toolbar.itemHover, "--tw-ring-color": theme.node.muted } as CSSProperties}
            data-canvas-no-zoom
            data-canvas-wheel-scroll
            onContextMenu={(event) => event.preventDefault()}
            onPointerDown={(event) => event.stopPropagation()}
            onKeyDown={onKeyDown}
            onBlur={onBlur}
        >
            <div className="thin-scrollbar min-h-0 overflow-y-auto overscroll-contain">
                {view === "pets" ? (
                    <PetList theme={theme} userId={userId} onBack={() => setView("main")} onOpenStore={() => run(onOpenStore)} onDone={() => onClose(true)} />
                ) : (
                    <>
                        <MenuHeader theme={theme} title={title} description={petShown ? "当前形象" : collapsed ? "形象已收起" : "站点默认形象"} />
                        <MenuItem theme={theme} icon={<MessageSquareText />} label="打开助手" onClick={() => run(onOpenAgent)} />
                        {userId ? (
                            <>
                                <MenuItem theme={theme} icon={<Shirt />} label="更换形象" chevron onClick={() => setView("pets")} />
                                <MenuItem theme={theme} icon={<Store />} label="形象商店" detail="购买、领取更多形象" onClick={() => run(onOpenStore)} />
                            </>
                        ) : null}
                        {petShown ? (
                            <>
                                <MenuDivider theme={theme} />
                                <MenuSection theme={theme} label="大小" />
                                <div className="flex gap-1 px-1.5 pb-1.5" role="group" aria-label="形象大小">
                                    {AGENT_PET_SIZE_OPTIONS.map((option) => {
                                        const active = size === option.id;
                                        return (
                                            <button
                                                key={option.id}
                                                type="button"
                                                data-agent-pet-menu-item
                                                aria-pressed={active}
                                                title={option.height ? `${option.height}px 高` : "跟随站点设置，离开画布时自动缩小"}
                                                className="h-7 min-w-0 flex-1 rounded-[var(--r-md)] font-medium outline-none transition-colors enabled:hover:bg-[var(--menu-hover)] focus-visible:ring-2"
                                                style={{ fontSize: "var(--fs-label)", background: active ? theme.toolbar.activeBg : undefined, color: active ? theme.toolbar.activeText : theme.node.muted }}
                                                onClick={() => setSize(option.id)}
                                            >
                                                {option.label}
                                            </button>
                                        );
                                    })}
                                </div>
                                <label className="flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-[var(--r-md)] px-2 py-1.5 hover:bg-[var(--menu-hover)]">
                                    <span className="grid size-4 shrink-0 place-items-center opacity-70 [&_svg]:size-4 [&_svg]:stroke-[1.75]">
                                        <MessageCircleHeart />
                                    </span>
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate font-medium leading-5" style={{ fontSize: "var(--fs-ui)" }}>
                                            头顶气泡
                                        </span>
                                        <span className="block truncate leading-4" style={{ color: theme.node.muted, fontSize: "var(--fs-label)" }}>
                                            {chatter ? "提醒时间、待办和灵感" : "只提示待审批"}
                                        </span>
                                    </span>
                                    <Switch size="sm" checked={chatter} onChange={setChatter} aria-label="头顶气泡" data-agent-pet-menu-item />
                                </label>
                                <MenuItem theme={theme} icon={<MessageSquareQuote />} label="说句话" disabled={approvalPending} onClick={() => run(onSpeak)} />
                            </>
                        ) : null}
                        <MenuDivider theme={theme} />
                        <MenuItem theme={theme} icon={collapsed ? <Maximize2 /> : <Minus />} label={collapsed ? "展开形象" : "收起形象"} onClick={() => run(onToggleCollapsed)} />
                    </>
                )}
            </div>
        </div>
    );
}

/** 「更换形象」子菜单：默认形象和当前可用的形象（含累计消费已达标、选择即领取的形象）。 */
function PetList({ theme, userId, onBack, onOpenStore, onDone }: { theme: CanvasTheme; userId: string; onBack: () => void; onOpenStore: () => void; onDone: () => void }) {
    const catalog = useQuery({ queryKey: agentPetCatalogQueryKey(userId), queryFn: ({ signal }) => getAgentPetCatalog(signal), enabled: Boolean(userId) });
    const applyPet = useApplyAgentPet();
    const [busyId, setBusyId] = useState<string | null>(null);
    const selectedId = catalog.data?.selectedPetId ?? "";
    const pets = catalog.data?.pets ?? [];
    const usable = pets.filter((pet) => pet.usable);
    const locked = pets.length - usable.length;
    const list = useRef<HTMLDivElement>(null);
    const loaded = catalog.isSuccess;
    // 列表读完时焦点还停在返回按钮上，就移到当前形象。
    useEffect(() => {
        if (!loaded || !(document.activeElement instanceof HTMLElement) || !document.activeElement.hasAttribute("data-agent-pet-menu-back")) return;
        list.current?.querySelector<HTMLElement>('[aria-current="true"]')?.focus();
    }, [loaded]);

    const choose = async (pet: AgentPet | null) => {
        if ((pet?.id ?? "") === selectedId) {
            onDone();
            return;
        }
        setBusyId(pet?.id ?? "");
        const applied = await applyPet(pet);
        setBusyId(null);
        if (applied) onDone();
    };

    return (
        <>
            <MenuHeader theme={theme} title="更换形象" description="只对你自己显示" onBack={onBack} />
            {catalog.isPending ? (
                <div className="flex h-9 items-center gap-2 px-2" style={{ color: theme.node.muted, fontSize: "var(--fs-label)" }} role="status">
                    <LoaderCircle className="size-3.5 motion-safe:animate-spin" aria-hidden="true" />
                    正在读取形象…
                </div>
            ) : catalog.isError ? (
                <MenuItem theme={theme} icon={<RotateCcw />} label="读取失败，点此重试" onClick={() => void catalog.refetch()} />
            ) : (
                <div ref={list}>
                    <MenuItem theme={theme} icon={<Sparkles />} label="默认形象" detail="站点设置的助手形象" checked={!selectedId} busy={busyId === ""} disabled={busyId !== null} onClick={() => void choose(null)} />
                    {usable.map((pet) => (
                        <MenuItem
                            key={pet.id}
                            theme={theme}
                            icon={<AgentPetSprite src={agentPetSpritesheetURL(pet)} version={pet.spriteVersion} state="idle" stateRows={pet.stateRows} width={THUMB_WIDTH} height={THUMB_HEIGHT} paused pixelated={pet.pixelated} lookAtPointer={false} />}
                            thumb
                            label={pet.name}
                            detail={pet.claimable ? "累计消费已达标，选择即领取" : undefined}
                            checked={pet.id === selectedId}
                            busy={busyId === pet.id}
                            disabled={busyId !== null}
                            onClick={() => void choose(pet)}
                        />
                    ))}
                </div>
            )}
            <MenuDivider theme={theme} />
            <MenuItem theme={theme} icon={<Store />} label="去形象商店" detail={locked > 0 ? `还有 ${locked} 个形象可以购买或解锁` : undefined} onClick={onOpenStore} />
        </>
    );
}

function MenuHeader({ theme, title, description, onBack }: { theme: CanvasTheme; title: string; description?: string; onBack?: () => void }) {
    return (
        <div className="mb-1 flex items-center gap-1.5 px-2 pb-1.5 pt-1.5">
            {onBack ? (
                <button
                    type="button"
                    data-agent-pet-menu-item
                    data-agent-pet-menu-back
                    onClick={onBack}
                    className="grid size-6 shrink-0 place-items-center rounded-[var(--r-md)] outline-none transition-colors hover:bg-[var(--menu-hover)] focus-visible:ring-2"
                    aria-label="返回"
                >
                    <ArrowLeft className="size-3.5" />
                </button>
            ) : null}
            <span className="min-w-0">
                <span className="block truncate font-semibold leading-5" style={{ fontSize: "var(--fs-ui)" }}>
                    {title}
                </span>
                {description ? (
                    <span className="block truncate leading-4" style={{ color: theme.node.muted, fontSize: "var(--fs-label)" }}>
                        {description}
                    </span>
                ) : null}
            </span>
        </div>
    );
}

function MenuSection({ theme, label }: { theme: CanvasTheme; label: string }) {
    return (
        <div className="px-2 pb-1 pt-1.5 font-medium leading-4" style={{ color: theme.node.faint, fontSize: "var(--fs-label)" }}>
            {label}
        </div>
    );
}

/** 菜单项。checked 表示当前选中的形象（右侧打勾）；thumb 表示图标位放的是形象缩略图。 */
function MenuItem({
    theme,
    icon,
    thumb = false,
    label,
    detail,
    chevron = false,
    checked = false,
    busy = false,
    disabled = false,
    onClick,
}: {
    theme: CanvasTheme;
    icon: ReactNode;
    thumb?: boolean;
    label: string;
    detail?: string;
    chevron?: boolean;
    checked?: boolean;
    busy?: boolean;
    disabled?: boolean;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            data-agent-pet-menu-item
            aria-current={checked || undefined}
            className={`group flex w-full items-center gap-2.5 rounded-[var(--r-md)] px-2 text-left outline-none enabled:hover:bg-[var(--menu-hover)] focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-40 ${detail ? "min-h-11 py-1.5" : "min-h-8 py-1"}`}
            style={{ color: theme.node.text, background: checked ? theme.toolbar.activeBg : undefined }}
            disabled={disabled}
            onClick={onClick}
        >
            <span className={`grid shrink-0 place-items-center [&_svg]:size-4 [&_svg]:stroke-[1.75] ${thumb ? "" : "opacity-70 group-hover:opacity-100"}`} style={thumb ? { width: THUMB_WIDTH, height: THUMB_HEIGHT } : { width: 16, height: 16 }}>
                {icon}
            </span>
            <span className="min-w-0 flex-1">
                <span className="block truncate font-medium leading-5" style={{ fontSize: "var(--fs-ui)" }}>
                    {label}
                </span>
                {detail ? (
                    <span className="block truncate leading-4" style={{ color: theme.node.muted, fontSize: "var(--fs-label)" }}>
                        {detail}
                    </span>
                ) : null}
            </span>
            {busy ? <LoaderCircle className="size-3.5 shrink-0 motion-safe:animate-spin" aria-label="正在切换" /> : null}
            {!busy && checked ? <Check className="size-3.5 shrink-0" style={{ color: theme.accent.primary }} aria-label="使用中" /> : null}
            {chevron ? <ChevronRight className="size-3.5 shrink-0" style={{ color: theme.node.faint }} aria-hidden="true" /> : null}
        </button>
    );
}

function MenuDivider({ theme }: { theme: CanvasTheme }) {
    return <div role="separator" className="mx-2 my-1.5 h-px" style={{ background: theme.toolbar.border, opacity: 0.7 }} />;
}
