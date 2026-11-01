import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Check, ChevronRight, Eye, Gift, LoaderCircle, Maximize2, MessageCircleHeart, MessageSquareQuote, MessageSquareText, Minus, PawPrint, RotateCcw, Shirt, Sparkles, Store } from "lucide-react";
import { useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, type CSSProperties, type FocusEvent, type KeyboardEvent, type ReactNode } from "react";

import { AGENT_PET_TONE_ICONS, agentPetThemeVars } from "@/components/canvas/agent-pet-picker";
import { AgentPetSprite } from "@/components/canvas/agent-pet-sprite";
import { Switch } from "@/components/ui/base/switch";
import { agentPetCatalogQueryKey, useApplyAgentPet } from "@/hooks/use-active-agent-pet";
import type { CanvasTheme } from "@/lib/canvas-theme";
import { AGENT_PET_ASPECT, AGENT_PET_SIZE_OPTIONS } from "@/lib/canvas/agent-pet";
import { agentPetGreeting, agentPetPersona } from "@/lib/canvas/agent-pet-lines";
import { AGENT_PET_TONE_LABELS } from "@/lib/canvas/agent-pet-store";
import { agentPetSpritesheetURL, getAgentPetCatalog, type AgentPet } from "@/services/api/agent-pets";
import { useAgentPetPrefsStore } from "@/stores/use-agent-pet-prefs-store";
import { useUserStore } from "@/stores/use-user-store";
import "./agent-pet-store.css";

const MENU_WIDTH = 264;
const MENU_MARGIN = 12;
const HERO_HEIGHT = 64;
const TILE_HEIGHT = 46;
const ITEM_SELECTOR = "[data-agent-pet-menu-item]:not(:disabled)";
/** 大小档位图标：脚印越来越大，自动档用星光。 */
const SIZE_ICON_PX: Record<string, number> = { s: 10, m: 12, l: 14, xl: 17 };

export type AgentPetMenuPoint = { x: number; y: number };

type AgentPetContextMenuProps = {
    theme: CanvasTheme;
    /** 打开位置：右键时是光标，键盘打开时是入口中心。 */
    point: AgentPetMenuPoint;
    /** 当前形象；null 表示站点默认形象。 */
    pet: AgentPet | null;
    agentName: string;
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
 * 智能体入口的右键菜单：顶部是当前形象的名片（说话风格配色、台词），下面是常用操作、大小、头顶气泡和收起。
 * 在光标处打开，靠近屏幕边缘时向内翻转；点外面、按 Esc、窗口尺寸变化或失焦时关闭；方向键在各项之间移动。
 */
export function AgentPetContextMenu({ theme, point, pet, agentName, petShown, collapsed, approvalPending, onOpenAgent, onOpenStore, onSpeak, onToggleCollapsed, onClose }: AgentPetContextMenuProps) {
    const element = useRef<HTMLDivElement>(null);
    const reducedMotion = Boolean(useReducedMotion());
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

    // 打开和切换子菜单后聚焦当前形象或第一项，键盘可以直接移动。菜单是 fixed，聚焦只滚动菜单自身。
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
        const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[event.key];
        const items = [...(element.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? [])];
        if (!items.length || (step === undefined && event.key !== "Home" && event.key !== "End")) return;
        event.preventDefault();
        event.stopPropagation();
        const current = items.indexOf(document.activeElement as HTMLElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (current + (step ?? 0) + items.length) % items.length;
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
    const tone = pet?.tone || "gentle";

    return (
        <div
            ref={element}
            role="group"
            aria-label="智能体形象菜单"
            className="agent-pet-toned aceternity-floating-panel fixed z-[var(--z-popover)] flex flex-col overflow-hidden rounded-[var(--r-lg)] border p-1.5 backdrop-blur-2xl backdrop-saturate-150"
            data-tone={pet ? tone : undefined}
            style={
                {
                    left,
                    width: MENU_WIDTH,
                    ...placement,
                    ...agentPetThemeVars(theme),
                    background: theme.spatial.elevated,
                    borderColor: theme.toolbar.border,
                    color: theme.node.text,
                    "--menu-hover": theme.toolbar.itemHover,
                    "--tw-ring-color": theme.node.muted,
                } as CSSProperties
            }
            data-canvas-no-zoom
            data-canvas-wheel-scroll
            onContextMenu={(event) => event.preventDefault()}
            onPointerDown={(event) => event.stopPropagation()}
            onKeyDown={onKeyDown}
            onBlur={onBlur}
        >
            <div className="thin-scrollbar min-h-0 overflow-y-auto overscroll-contain">
                {view === "pets" ? (
                    <PetList theme={theme} userId={userId} reducedMotion={reducedMotion} onBack={() => setView("main")} onOpenStore={() => run(onOpenStore)} onDone={() => onClose(true)} />
                ) : (
                    <>
                        <Hero pet={pet} agentName={agentName} collapsed={collapsed} reducedMotion={reducedMotion} theme={theme} />
                        <div className="agent-pet-menu-tiles">
                            <Tile icon={<MessageSquareText />} label="打开助手" detail="继续对话" onClick={() => run(onOpenAgent)} />
                            {petShown ? <Tile icon={<MessageSquareQuote />} label="说句话" detail={approvalPending ? "正在提示审批" : "听听它想说什么"} disabled={approvalPending} onClick={() => run(onSpeak)} /> : null}
                            {userId ? (
                                <>
                                    <Tile icon={<Shirt />} label="换形象" detail="我的形象" chevron onClick={() => setView("pets")} />
                                    <Tile icon={<Store />} label="形象商店" detail="购买、领取" onClick={() => run(onOpenStore)} />
                                </>
                            ) : null}
                        </div>
                        {petShown ? (
                            <>
                                <MenuDivider theme={theme} />
                                <div className="px-1.5 pb-1 pt-0.5 font-medium" style={{ color: theme.node.faint, fontSize: "var(--fs-label)" }}>
                                    大小
                                </div>
                                <div className="agent-pet-menu-segmented mx-1" role="group" aria-label="形象大小">
                                    {AGENT_PET_SIZE_OPTIONS.map((option) => (
                                        <button
                                            key={option.id}
                                            type="button"
                                            data-agent-pet-menu-item
                                            aria-pressed={size === option.id}
                                            title={option.height ? `${option.height}px 高` : "跟随站点设置，离开画布时自动缩小"}
                                            onClick={() => setSize(option.id)}
                                        >
                                            {option.height ? <PawPrint aria-hidden="true" style={{ width: SIZE_ICON_PX[option.id], height: SIZE_ICON_PX[option.id] }} /> : <Sparkles aria-hidden="true" style={{ width: 13, height: 13 }} />}
                                            {option.label}
                                        </button>
                                    ))}
                                </div>
                                <label className="mt-1.5 flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-[var(--r-md)] px-2 py-1.5 hover:bg-[var(--menu-hover)]">
                                    <MessageCircleHeart className="size-4 shrink-0 opacity-70" aria-hidden="true" />
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
                            </>
                        ) : null}
                        <MenuDivider theme={theme} />
                        <MenuItem theme={theme} icon={collapsed ? <Maximize2 /> : <Minus />} label={collapsed ? "展开形象" : "收起形象"} detail={collapsed ? undefined : "只留一个小圆点"} onClick={() => run(onToggleCollapsed)} />
                    </>
                )}
            </div>
        </div>
    );
}

/** 菜单头部的形象名片：说话风格配色的舞台、名字、风格标签和一句台词。 */
function Hero({ pet, agentName, collapsed, reducedMotion, theme }: { pet: AgentPet | null; agentName: string; collapsed: boolean; reducedMotion: boolean; theme: CanvasTheme }) {
    if (!pet) {
        return (
            <div className="agent-pet-menu-hero agent-pet-stage">
                <span className="grid size-12 shrink-0 place-items-center self-center rounded-xl" style={{ background: theme.node.fill, color: theme.accent.primary }}>
                    <Sparkles className="size-5" aria-hidden="true" />
                </span>
                <span className="min-w-0 self-center">
                    <span className="block truncate text-sm font-semibold">{agentName}</span>
                    <span className="block text-[var(--fs-label)]" style={{ color: theme.node.muted }}>
                        {collapsed ? "形象已收起" : "站点默认形象，可以在商店换一个"}
                    </span>
                </span>
            </div>
        );
    }
    const tone = pet.tone || "gentle";
    const ToneIcon = AGENT_PET_TONE_ICONS[tone];
    const quote = pet.lines[0] || agentPetGreeting(agentPetPersona(pet), new Date()).text;
    return (
        <div className="agent-pet-menu-hero agent-pet-stage">
            <AgentPetSprite
                src={agentPetSpritesheetURL(pet)}
                version={pet.spriteVersion}
                state="idle"
                stateRows={pet.stateRows}
                width={Math.round(HERO_HEIGHT * AGENT_PET_ASPECT)}
                height={HERO_HEIGHT}
                paused={reducedMotion}
                reducedMotion={reducedMotion}
                pixelated={pet.pixelated}
                lookAtPointer={false}
            />
            <span className="min-w-0 flex-1 pb-0.5">
                <span className="flex items-center gap-1.5">
                    <span className="min-w-0 truncate text-sm font-semibold">{pet.name}</span>
                    <span className="agent-pet-tag" data-kind="tone">
                        <ToneIcon aria-hidden="true" />
                        {AGENT_PET_TONE_LABELS[tone]}
                    </span>
                    {pet.spriteVersion === 2 ? <Eye className="size-3.5 shrink-0 opacity-50" aria-label="视线跟随鼠标" /> : null}
                </span>
                <span className="agent-pet-menu-quote mt-1">{collapsed ? "已收起，展开后继续陪你～" : `“${quote}”`}</span>
            </span>
        </div>
    );
}

/** 「换形象」子菜单：默认形象和当前可用的形象（含累计消费已达标、选择即领取的形象），缩略图格子排列。 */
function PetList({ theme, userId, reducedMotion, onBack, onOpenStore, onDone }: { theme: CanvasTheme; userId: string; reducedMotion: boolean; onBack: () => void; onOpenStore: () => void; onDone: () => void }) {
    const catalog = useQuery({ queryKey: agentPetCatalogQueryKey(userId), queryFn: ({ signal }) => getAgentPetCatalog(signal), enabled: Boolean(userId) });
    const applyPet = useApplyAgentPet();
    const [busyId, setBusyId] = useState<string | null>(null);
    const [hoverId, setHoverId] = useState("");
    const selectedId = catalog.data?.selectedPetId ?? "";
    const pets = catalog.data?.pets ?? [];
    const usable = pets.filter((pet) => pet.usable);
    const locked = pets.length - usable.length;
    const grid = useRef<HTMLDivElement>(null);
    const loaded = catalog.isSuccess;
    // 列表读完时焦点还停在返回按钮上，就移到当前形象。
    useEffect(() => {
        if (!loaded || !(document.activeElement instanceof HTMLElement) || !document.activeElement.hasAttribute("data-agent-pet-menu-back")) return;
        grid.current?.querySelector<HTMLElement>('[aria-current="true"]')?.focus();
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
            <div className="mb-1 flex items-center gap-1.5 px-1 pb-1 pt-1">
                <button
                    type="button"
                    data-agent-pet-menu-item
                    data-agent-pet-menu-back
                    onClick={onBack}
                    className="grid size-7 shrink-0 place-items-center rounded-[var(--r-md)] outline-none transition-colors hover:bg-[var(--menu-hover)] focus-visible:ring-2"
                    aria-label="返回"
                >
                    <ArrowLeft className="size-4" />
                </button>
                <span className="min-w-0">
                    <span className="block truncate font-semibold leading-5" style={{ fontSize: "var(--fs-ui)" }}>
                        换形象
                    </span>
                    <span className="block truncate leading-4" style={{ color: theme.node.muted, fontSize: "var(--fs-label)" }}>
                        {loaded ? `可用 ${usable.length + 1} 个 · 只对你自己显示` : "只对你自己显示"}
                    </span>
                </span>
            </div>
            {catalog.isPending ? (
                <div className="flex h-24 items-center justify-center gap-2" style={{ color: theme.node.muted, fontSize: "var(--fs-label)" }} role="status">
                    <LoaderCircle className="size-3.5 motion-safe:animate-spin" aria-hidden="true" />
                    正在读取形象…
                </div>
            ) : catalog.isError ? (
                <MenuItem theme={theme} icon={<RotateCcw />} label="读取失败，点此重试" onClick={() => void catalog.refetch()} />
            ) : (
                <div ref={grid} className="agent-pet-menu-grid">
                    <button type="button" data-agent-pet-menu-item className="agent-pet-menu-pet agent-pet-toned" aria-current={!selectedId || undefined} aria-label="默认形象" disabled={busyId !== null} onClick={() => void choose(null)}>
                        <span className="agent-pet-stage" style={{ placeItems: "center" }}>
                            {busyId === "" ? <LoaderCircle className="size-4 motion-safe:animate-spin" aria-hidden="true" /> : <Sparkles className="size-5" style={{ color: theme.accent.primary }} aria-hidden="true" />}
                        </span>
                        {!selectedId ? <TileMark icon={<Check />} /> : null}
                        <span>默认</span>
                    </button>
                    {usable.map((pet) => (
                        <button
                            key={pet.id}
                            type="button"
                            data-agent-pet-menu-item
                            className="agent-pet-menu-pet agent-pet-toned"
                            data-tone={pet.tone || "gentle"}
                            aria-current={pet.id === selectedId || undefined}
                            aria-label={pet.claimable ? `${pet.name}（累计消费已达标，选择即领取）` : pet.name}
                            title={pet.claimable ? "累计消费已达标，选择即领取" : pet.description}
                            disabled={busyId !== null}
                            onPointerEnter={() => setHoverId(pet.id)}
                            onPointerLeave={() => setHoverId("")}
                            onClick={() => void choose(pet)}
                        >
                            <span className="agent-pet-stage">
                                {busyId === pet.id ? (
                                    <LoaderCircle className="mb-3 size-4 motion-safe:animate-spin" aria-hidden="true" />
                                ) : (
                                    <AgentPetSprite
                                        src={agentPetSpritesheetURL(pet)}
                                        version={pet.spriteVersion}
                                        state="idle"
                                        stateRows={pet.stateRows}
                                        width={Math.round(TILE_HEIGHT * AGENT_PET_ASPECT)}
                                        height={TILE_HEIGHT}
                                        paused={hoverId !== pet.id}
                                        reducedMotion={reducedMotion}
                                        pixelated={pet.pixelated}
                                        lookAtPointer={false}
                                    />
                                )}
                            </span>
                            {pet.id === selectedId ? <TileMark icon={<Check />} /> : pet.claimable ? <TileMark icon={<Gift />} tone="success" /> : null}
                            <span>{pet.name}</span>
                        </button>
                    ))}
                </div>
            )}
            <MenuDivider theme={theme} />
            <MenuItem theme={theme} icon={<Store />} label="去形象商店" detail={locked > 0 ? `还有 ${locked} 个形象可以购买或解锁` : "看看有没有新形象"} chevron onClick={onOpenStore} />
        </>
    );
}

function TileMark({ icon, tone = "accent" }: { icon: ReactNode; tone?: "accent" | "success" }) {
    return (
        <span
            className="agent-pet-menu-pet-mark grid size-4 place-items-center rounded-full [&_svg]:size-2.5 [&_svg]:stroke-[3]"
            style={{ background: tone === "success" ? "var(--palette-status-success)" : "var(--pet-accent)", color: "var(--pet-panel)" }}
            aria-hidden="true"
        >
            {icon}
        </span>
    );
}

function Tile({ icon, label, detail, chevron = false, disabled = false, onClick }: { icon: ReactNode; label: string; detail?: string; chevron?: boolean; disabled?: boolean; onClick: () => void }) {
    return (
        <button type="button" data-agent-pet-menu-item className="agent-pet-menu-tile" disabled={disabled} onClick={onClick}>
            {icon}
            <span className="min-w-0 flex-1">
                <span className="block truncate leading-5">{label}</span>
                {detail ? <small>{detail}</small> : null}
            </span>
            {chevron ? <ChevronRight className="!size-3.5 opacity-50" aria-hidden="true" /> : null}
        </button>
    );
}

/** 整行菜单项（收起、去商店、重试）。 */
function MenuItem({ theme, icon, label, detail, chevron = false, disabled = false, onClick }: { theme: CanvasTheme; icon: ReactNode; label: string; detail?: string; chevron?: boolean; disabled?: boolean; onClick: () => void }) {
    return (
        <button
            type="button"
            data-agent-pet-menu-item
            className={`group flex w-full items-center gap-2.5 rounded-[var(--r-md)] px-2 text-left outline-none enabled:hover:bg-[var(--menu-hover)] focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-40 ${detail ? "min-h-11 py-1.5" : "min-h-9 py-1"}`}
            style={{ color: theme.node.text }}
            disabled={disabled}
            onClick={onClick}
        >
            <span className="grid size-4 shrink-0 place-items-center opacity-70 group-hover:opacity-100 [&_svg]:size-4 [&_svg]:stroke-[1.75]">{icon}</span>
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
            {chevron ? <ChevronRight className="size-3.5 shrink-0" style={{ color: theme.node.faint }} aria-hidden="true" /> : null}
        </button>
    );
}

function MenuDivider({ theme }: { theme: CanvasTheme }) {
    return <div role="separator" className="mx-2 my-1.5 h-px" style={{ background: theme.toolbar.border, opacity: 0.7 }} />;
}
