import { useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button } from "antd";
import { Bot, Cat, Check, Coins, Crown, Dog, Eye, Flame, Gift, Heart, LoaderCircle, Lock, MessageCircleHeart, Moon, RotateCcw, ShoppingBag, Store, Sun, Timer, Wallet, type LucideIcon } from "lucide-react";
import { useReducedMotion } from "motion/react";
import { useMemo, useState, type CSSProperties, type ReactNode } from "react";

import { AgentPetSprite } from "@/components/canvas/agent-pet-sprite";
import { Switch } from "@/components/ui/base/switch";
import { FluidOrb } from "@/components/ui/fluid-orb";
import { AppModal } from "@/components/ui/product/app-modal";
import { formatCredits } from "@/constant/credits";
import { agentPetCatalogQueryKey, publishActiveAgentPet, useApplyAgentPet } from "@/hooks/use-active-agent-pet";
import { useMinuteClock } from "@/hooks/use-minute-clock";
import { useWalletBalance } from "@/hooks/use-wallet-balance";
import type { CanvasTheme } from "@/lib/canvas-theme";
import { AGENT_PET_ASPECT } from "@/lib/canvas/agent-pet";
import { agentPetGreeting, agentPetPersona } from "@/lib/canvas/agent-pet-lines";
import { AGENT_PET_STORE_FILTERS, AGENT_PET_TONE_LABELS, agentPetCategories, agentPetDiscountLabel, agentPetOffer, formatAgentPetCountdown, matchesAgentPetFilter, type AgentPetOffer, type AgentPetStoreFilter } from "@/lib/canvas/agent-pet-store";
import { openWorkspaceWallet } from "@/lib/workspace-wallet";
import { agentPetSpritesheetURL, getAgentPetCatalog, purchaseAgentPet, selectAgentPet, type AgentPet, type AgentPetTone } from "@/services/api/agent-pets";
import { ApiError } from "@/services/api/request";
import { useAgentPetPrefsStore } from "@/stores/use-agent-pet-prefs-store";
import { useUserStore } from "@/stores/use-user-store";
import "./agent-pet-store.css";

const PREVIEW_HEIGHT = 112;
const PREVIEW_WIDTH = Math.round(PREVIEW_HEIGHT * AGENT_PET_ASPECT);

export const AGENT_PET_TONE_ICONS: Record<AgentPetTone, LucideIcon> = { gentle: Heart, kitty: Cat, puppy: Dog, robot: Bot, mystic: Moon, sunny: Sun };

/** 把画布主题写进商店与右键菜单共用的 --pet-* 变量。 */
export function agentPetThemeVars(theme: CanvasTheme) {
    return { "--pet-ink": theme.node.text, "--pet-muted": theme.node.muted, "--pet-fill": theme.node.fill, "--pet-stroke": theme.node.stroke, "--pet-accent": theme.accent.primary, "--pet-panel": theme.node.panel } as CSSProperties;
}

/**
 * 形象商店：按分类和获取方式筛选，卡片突出说话风格、价格与限时活动，悬停时形象会挥手说一句话。
 * Agent 设置「助手形象」（settings，带头顶气泡开关）和右键菜单的「形象商店」弹窗（store）共用。只影响当前用户自己的显示。
 */
export function AgentPetPicker({ theme, variant = "settings" }: { theme: CanvasTheme; variant?: "settings" | "store" }) {
    const reducedMotion = Boolean(useReducedMotion());
    const userId = useUserStore((state) => state.user?.id || "");
    const queryClient = useQueryClient();
    const { message } = App.useApp();
    const catalog = useQuery({ queryKey: agentPetCatalogQueryKey(userId), queryFn: ({ signal }) => getAgentPetCatalog(signal), enabled: Boolean(userId) });
    const creditsEnabled = catalog.data?.creditsEnabled ?? false;
    const wallet = useWalletBalance(userId, creditsEnabled);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [confirmId, setConfirmId] = useState("");
    const [previewId, setPreviewId] = useState("");
    const [category, setCategory] = useState("all");
    const [filter, setFilter] = useState<AgentPetStoreFilter>("all");
    const now = useMinuteClock();
    const selectedId = catalog.data?.selectedPetId ?? "";
    const chatter = useAgentPetPrefsStore((state) => state.chatter);
    const setChatter = useAgentPetPrefsStore((state) => state.setChatter);
    const applyPet = useApplyAgentPet();
    const pets = useMemo(() => catalog.data?.pets ?? [], [catalog.data]);
    const categories = useMemo(() => agentPetCategories(pets), [pets]);
    const sales = useMemo(() => pets.filter((pet) => pet.promotion && !pet.owned && !pet.memberFree), [pets]);

    const apply = async (pet: AgentPet | null) => {
        setBusyId(pet?.id ?? "");
        await applyPet(pet);
        setBusyId(null);
    };

    // 购买（含限时免费领取）后直接换上。
    const buy = async (pet: AgentPet) => {
        setBusyId(pet.id);
        try {
            const result = await purchaseAgentPet(pet.id, pet.priceMicrocredits);
            if (result.charged) window.dispatchEvent(new CustomEvent("wallet:updated"));
            setConfirmId("");
            const selected = await selectAgentPet(pet.id);
            publishActiveAgentPet(queryClient, userId, selected);
            message.success(pet.priceMicrocredits === 0 ? `已领取并换上「${pet.name}」` : `已购买并换上「${pet.name}」`);
        } catch (cause) {
            if (cause instanceof ApiError && cause.reason === "failed_precondition") {
                message.warning("积分不足，请先充值");
                openWorkspaceWallet({ tab: "topup" });
            } else {
                message.error(cause instanceof Error ? cause.message : "购买失败，请稍后重试");
            }
            void catalog.refetch();
        } finally {
            setBusyId(null);
        }
    };

    if (!userId) return <PickerNotice theme={theme}>登录后可以更换助手形象。</PickerNotice>;
    if (catalog.isPending) {
        return (
            <PickerNotice theme={theme}>
                <LoaderCircle className={reducedMotion ? "size-4" : "size-4 motion-safe:animate-spin"} aria-hidden="true" />
                正在读取形象…
            </PickerNotice>
        );
    }
    if (catalog.isError) {
        return (
            <PickerNotice theme={theme}>
                形象列表读取失败。
                <Button size="small" icon={<RotateCcw className="size-3.5" />} onClick={() => void catalog.refetch()}>
                    重试
                </Button>
            </PickerNotice>
        );
    }

    const balance = wallet.availableMicrocredits;
    const consumed = catalog.data.consumedMicrocredits;
    const hasSpendPets = pets.some((pet) => pet.access === "spend");
    const filters = AGENT_PET_STORE_FILTERS.filter((item) => item.id === "all" || pets.some((pet) => matchesAgentPetFilter(pet, item.id)));
    const visible = pets.filter((pet) => (category === "all" || pet.category === category) && matchesAgentPetFilter(pet, filter));
    const showDefault = category === "all" && (filter === "all" || filter === "usable" || filter === "free");
    const soonestEnd = sales
        .map((pet) => pet.promotion?.endsAt)
        .filter((value): value is string => Boolean(value))
        .sort()[0];
    const gifts = sales.filter((pet) => pet.priceMicrocredits === 0).length;
    const deepest = sales.filter((pet) => pet.priceMicrocredits > 0).sort((left, right) => left.priceMicrocredits / left.listPriceMicrocredits - right.priceMicrocredits / right.listPriceMicrocredits)[0];
    const bannerTitle =
        gifts === sales.length
            ? `${sales.length} 个形象限时免费领`
            : gifts
              ? `${sales.length} 个形象特惠中，还有 ${gifts} 个限时免费领`
              : `${sales.length} 个形象低至 ${deepest ? agentPetDiscountLabel(deepest.priceMicrocredits, deepest.listPriceMicrocredits) : ""}`;

    return (
        <div className="agent-pet-store canvas-agent-settings-scroll thin-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto p-4" style={agentPetThemeVars(theme)}>
            <div className="flex flex-wrap items-center gap-2 text-xs" style={{ color: theme.node.muted }}>
                {creditsEnabled && balance !== null ? (
                    <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1" style={{ background: theme.node.fill }}>
                        <Wallet className="size-3.5" aria-hidden="true" />
                        可用{" "}
                        <b className="tabular-nums" style={{ color: theme.node.text }}>
                            {formatCredits(balance, 2)}
                        </b>{" "}
                        积分
                        <button type="button" className="ml-1 font-medium underline-offset-2 hover:underline" style={{ color: theme.accent.primary }} onClick={() => openWorkspaceWallet({ tab: "topup" })}>
                            充值
                        </button>
                    </span>
                ) : null}
                {hasSpendPets ? (
                    <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1" style={{ background: theme.node.fill }} title="只统计已结算的模型调用，购买形象不计入">
                        <Coins className="size-3.5" aria-hidden="true" />
                        累计消费{" "}
                        <b className="tabular-nums" style={{ color: theme.node.text }}>
                            {formatCredits(consumed, 2)}
                        </b>{" "}
                        积分
                    </span>
                ) : null}
                <span>形象只对你自己显示，悬停或点一下形象可以听它说话。</span>
            </div>

            {variant === "settings" ? (
                <label className="flex items-center gap-3 rounded-xl px-3 py-2.5" style={{ background: theme.node.fill }}>
                    <MessageCircleHeart className="size-4 shrink-0" style={{ color: theme.accent.primary }} aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                        <span className="block text-xs font-medium">头顶气泡</span>
                        <span className="mt-0.5 block text-[var(--fs-label)] leading-4" style={{ color: theme.node.muted }}>
                            形象会提醒时间和未完成的项目，也会说说灵感和贴心话；待审批提醒始终显示
                        </span>
                    </span>
                    <Switch checked={chatter} onChange={setChatter} aria-label="头顶气泡" />
                </label>
            ) : null}

            {sales.length ? (
                <button type="button" className="agent-pet-store-banner" aria-pressed={filter === "sale"} onClick={() => setFilter(filter === "sale" ? "all" : "sale")}>
                    <Flame className="size-5 shrink-0" style={{ color: "var(--palette-status-error)" }} aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold">限时活动 · {bannerTitle}</span>
                        <span className="block text-[var(--fs-label)]" style={{ color: theme.node.muted }}>
                            {soonestEnd ? `最早一档${formatAgentPetCountdown(soonestEnd, now)}，` : ""}
                            {filter === "sale" ? "点这里看全部形象" : "点这里只看活动形象"}
                        </span>
                    </span>
                </button>
            ) : null}

            {categories.length > 1 ? (
                <div className="agent-pet-store-chips" role="group" aria-label="形象分类">
                    <button type="button" className="agent-pet-store-chip" aria-pressed={category === "all"} onClick={() => setCategory("all")}>
                        全部分类
                    </button>
                    {categories.map((item) => (
                        <button key={item.name} type="button" className="agent-pet-store-chip" aria-pressed={category === item.name} onClick={() => setCategory(item.name)}>
                            {item.name}
                            <small>{item.count}</small>
                        </button>
                    ))}
                </div>
            ) : null}
            {filters.length > 2 ? (
                <div className="agent-pet-store-chips" role="group" aria-label="获取方式">
                    {filters.map((item) => (
                        <button key={item.id} type="button" className="agent-pet-store-chip" aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>
                            {item.label}
                        </button>
                    ))}
                </div>
            ) : null}

            <div className="agent-pet-store-grid">
                {showDefault ? (
                    <article className="agent-pet-card agent-pet-toned" data-selected={!selectedId} aria-label="默认形象">
                        <div className="agent-pet-card-stage agent-pet-stage" style={{ placeItems: "center" }}>
                            <div className="agent-pet-card-corner is-right">
                                <span className="agent-pet-tag" data-kind="free">
                                    免费
                                </span>
                            </div>
                            <FluidOrb size={64} color="#7164f6" />
                            {!selectedId ? <CurrentMark /> : null}
                        </div>
                        <div className="agent-pet-card-body">
                            <div className="agent-pet-card-title">默认形象</div>
                            <p className="agent-pet-card-desc">站点设置的助手形象，随时可以换回来。</p>
                            <div className="agent-pet-card-actions" style={{ marginTop: "auto" }}>
                                {selectedId ? (
                                    <Button size="small" block loading={busyId === ""} disabled={busyId !== null} onClick={() => void apply(null)}>
                                        使用
                                    </Button>
                                ) : (
                                    <Button size="small" block disabled icon={<Check className="size-3.5" />}>
                                        使用中
                                    </Button>
                                )}
                            </div>
                        </div>
                    </article>
                ) : null}
                {visible.map((pet) => {
                    const offer = agentPetOffer(pet, consumed);
                    const price = offer.kind === "paid" ? offer.price : offer.kind === "sale" ? offer.price : 0;
                    return (
                        <StoreCard key={pet.id} pet={pet} offer={offer} now={now} selected={pet.id === selectedId} previewing={previewId === pet.id} reducedMotion={reducedMotion} onPreview={(active) => setPreviewId(active ? pet.id : "")}>
                            <CardAction
                                pet={pet}
                                offer={offer}
                                selected={pet.id === selectedId}
                                busy={busyId === pet.id}
                                locked={busyId !== null && busyId !== pet.id}
                                confirming={confirmId === pet.id}
                                shortOfCredits={balance !== null && balance < price}
                                onUse={() => void apply(pet)}
                                onBuy={() => void buy(pet)}
                                onConfirm={(active) => setConfirmId(active ? pet.id : "")}
                            />
                        </StoreCard>
                    );
                })}
            </div>
            {visible.length === 0 && !showDefault ? (
                <p className="py-6 text-center text-xs leading-5" style={{ color: theme.node.muted }}>
                    {pets.length ? "这里还没有形象，换个分类看看。" : "管理员还没有开放可更换的形象。"}
                </p>
            ) : null}
        </div>
    );
}

/** 右键菜单里的「形象商店」：弹窗里的同一个形象列表。 */
export function AgentPetStoreModal({ theme, open, onClose }: { theme: CanvasTheme; open: boolean; onClose: () => void }) {
    return (
        <AppModal open={open} title={null} footer={null} centered width="min(780px, calc(100vw - 24px))" onCancel={onClose} flush aria-label="形象商店">
            <div className="flex h-[min(720px,calc(100dvh-80px))] min-h-0 flex-col" style={{ color: theme.node.text, background: theme.node.panel }}>
                <header className="flex shrink-0 items-center gap-3 border-b px-5 py-3.5 pr-12" style={{ borderColor: theme.node.stroke }}>
                    <span className="grid size-9 shrink-0 place-items-center rounded-xl" style={{ background: theme.node.fill, color: theme.accent.primary }}>
                        <Store className="size-4.5" aria-hidden="true" />
                    </span>
                    <span className="min-w-0">
                        <h2 className="text-base font-semibold leading-6">形象商店</h2>
                        <p className="text-[var(--fs-label)]" style={{ color: theme.node.muted }}>
                            挑一个陪你创作的小伙伴：免费、会员专享、积分购买或累计消费解锁
                        </p>
                    </span>
                </header>
                <AgentPetPicker theme={theme} variant="store" />
            </div>
        </AppModal>
    );
}

function StoreCard({
    pet,
    offer,
    now,
    selected,
    previewing,
    reducedMotion,
    onPreview,
    children,
}: {
    pet: AgentPet;
    offer: AgentPetOffer;
    now: number;
    selected: boolean;
    previewing: boolean;
    reducedMotion: boolean;
    onPreview: (active: boolean) => void;
    children: ReactNode;
}) {
    const [sayCount, setSayCount] = useState(0);
    const tone = pet.tone || "gentle";
    const ToneIcon = AGENT_PET_TONE_ICONS[tone];
    // 悬停时轮流说专属台词；没有台词的上传形象按说话风格打招呼。
    const say = pet.lines.length ? pet.lines[(sayCount + (pet.lines.length > 1 ? 1 : 0)) % pet.lines.length] : agentPetGreeting(agentPetPersona(pet), new Date(now)).text;
    const start = () => {
        if (!previewing) setSayCount((count) => count + 1);
        onPreview(true);
    };
    const endsAt = offer.kind === "sale" || offer.kind === "gift" ? offer.endsAt : null;
    return (
        <article className="agent-pet-card agent-pet-toned" data-tone={tone} data-selected={selected} aria-label={pet.name} onPointerEnter={start} onPointerLeave={() => onPreview(false)} onFocus={start} onBlur={() => onPreview(false)}>
            <div className="agent-pet-card-stage agent-pet-stage" onClick={() => (previewing ? onPreview(false) : start())}>
                <div className="agent-pet-card-corner is-left">
                    <span className="agent-pet-tag" data-kind="tone">
                        <ToneIcon aria-hidden="true" />
                        {AGENT_PET_TONE_LABELS[tone]}
                    </span>
                    {pet.badge ? (
                        <span className="agent-pet-tag" data-kind="badge">
                            {pet.badge}
                        </span>
                    ) : null}
                </div>
                <div className="agent-pet-card-corner is-right">
                    <OfferTag offer={offer} />
                </div>
                {previewing && !reducedMotion ? (
                    <span className="agent-pet-card-say" key={sayCount}>
                        <span>{say}</span>
                    </span>
                ) : null}
                <AgentPetSprite
                    src={agentPetSpritesheetURL(pet)}
                    version={pet.spriteVersion}
                    state="idle"
                    stateRows={pet.stateRows}
                    width={PREVIEW_WIDTH}
                    height={PREVIEW_HEIGHT}
                    paused={!previewing && !selected}
                    reducedMotion={reducedMotion}
                    pixelated={pet.pixelated}
                    lookAtPointer={previewing}
                    hovered={previewing}
                    lazy
                    label={pet.name}
                />
                {selected ? <CurrentMark /> : null}
            </div>
            <div className="agent-pet-card-body">
                <div className="agent-pet-card-title">
                    <span className="min-w-0 truncate">{pet.name}</span>
                    {pet.spriteVersion === 2 ? <Eye className="size-3.5 shrink-0 opacity-50" aria-label="视线跟随鼠标" /> : null}
                </div>
                <p className="agent-pet-card-desc">{pet.description}</p>
                {pet.lines[0] ? <p className="agent-pet-card-quote">“{pet.lines[0]}”</p> : null}
                <OfferPrice offer={offer} />
                {endsAt ? (
                    <span className="agent-pet-card-countdown">
                        <Timer className="size-3" aria-hidden="true" />
                        {formatAgentPetCountdown(endsAt, now)}
                    </span>
                ) : null}
                {offer.kind === "spend" ? (
                    <div className="agent-pet-card-progress" role="progressbar" aria-label="累计消费进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(offer.ratio * 100)} title="只统计已结算的模型调用，购买形象不计入">
                        <span style={{ width: `${offer.ratio * 100}%` }} />
                    </div>
                ) : null}
                {children}
            </div>
        </article>
    );
}

function OfferTag({ offer }: { offer: AgentPetOffer }) {
    switch (offer.kind) {
        case "owned":
            return (
                <span className="agent-pet-tag" data-kind="owned">
                    <Check aria-hidden="true" />
                    已拥有
                </span>
            );
        case "free":
            return (
                <span className="agent-pet-tag" data-kind="free">
                    免费
                </span>
            );
        case "member":
            return (
                <span className="agent-pet-tag" data-kind="member">
                    <Crown aria-hidden="true" />
                    会员免费
                </span>
            );
        case "vip":
            return (
                <span className="agent-pet-tag" data-kind="vip">
                    <Crown aria-hidden="true" />
                    VIP 专享
                </span>
            );
        case "sale":
            return (
                <span className="agent-pet-tag" data-kind="sale">
                    <Flame aria-hidden="true" />
                    {agentPetDiscountLabel(offer.price, offer.listPrice)}
                </span>
            );
        case "gift":
            return (
                <span className="agent-pet-tag" data-kind="gift">
                    <Gift aria-hidden="true" />
                    {offer.label}
                </span>
            );
        case "spend":
            return (
                <span className="agent-pet-tag" data-kind="spend">
                    <Lock aria-hidden="true" />
                    消费解锁
                </span>
            );
        case "claimable":
            return (
                <span className="agent-pet-tag" data-kind="claimable">
                    <Gift aria-hidden="true" />
                    可领取
                </span>
            );
        case "paid":
        case "unavailable":
            return (
                <span className="agent-pet-tag" data-kind="paid">
                    积分购买
                </span>
            );
    }
}

/** 卡片里醒目的价格行：积分购买、限时活动显示价格；消费解锁显示进度。 */
function OfferPrice({ offer }: { offer: AgentPetOffer }) {
    switch (offer.kind) {
        case "paid":
        case "unavailable":
            return (
                <div className="agent-pet-card-price" data-kind="paid">
                    <b>
                        {formatCredits(offer.price, 2)}
                        <small>积分</small>
                    </b>
                </div>
            );
        case "sale":
            return (
                <div className="agent-pet-card-price" data-kind="sale">
                    <b>
                        {formatCredits(offer.price, 2)}
                        <small>积分</small>
                    </b>
                    <s>{formatCredits(offer.listPrice, 2)}</s>
                    <span className="text-[var(--fs-label)] font-medium" style={{ color: "var(--palette-status-error)" }}>
                        {offer.label}
                    </span>
                </div>
            );
        case "gift":
            return (
                <div className="agent-pet-card-price" data-kind="gift">
                    <b>免费</b>
                    <s>{formatCredits(offer.listPrice, 2)} 积分</s>
                </div>
            );
        case "spend":
            return (
                <div className="agent-pet-card-price" data-kind="spend">
                    <span className="text-[var(--fs-label)]" style={{ color: "var(--pet-muted)" }}>
                        累计消费满 <b style={{ fontSize: "var(--fs-ui)", color: "var(--pet-ink)" }}>{formatCredits(offer.unlock, 2)}</b> 积分解锁
                    </span>
                </div>
            );
        case "claimable":
            return (
                <div className="agent-pet-card-price" data-kind="claimable">
                    <span className="text-[var(--fs-label)]" style={{ color: "var(--palette-status-success)" }}>
                        累计消费已满 {formatCredits(offer.unlock, 2)} 积分
                    </span>
                </div>
            );
        default:
            return <div className="mt-auto" />;
    }
}

function CardAction({
    pet,
    offer,
    selected,
    busy,
    locked,
    confirming,
    shortOfCredits,
    onUse,
    onBuy,
    onConfirm,
}: {
    pet: AgentPet;
    offer: AgentPetOffer;
    selected: boolean;
    busy: boolean;
    locked: boolean;
    confirming: boolean;
    shortOfCredits: boolean;
    onUse: () => void;
    onBuy: () => void;
    onConfirm: (active: boolean) => void;
}) {
    if (selected) {
        return (
            <div className="agent-pet-card-actions">
                <Button size="small" block disabled icon={<Check className="size-3.5" />}>
                    使用中
                </Button>
            </div>
        );
    }
    if (offer.kind === "claimable") {
        return (
            <div className="agent-pet-card-actions">
                <Button size="small" block type="primary" icon={<Gift className="size-3.5" />} loading={busy} disabled={locked} onClick={onUse}>
                    领取并使用
                </Button>
            </div>
        );
    }
    if (pet.usable) {
        return (
            <div className="agent-pet-card-actions">
                <Button size="small" block loading={busy} disabled={locked} onClick={onUse}>
                    使用
                </Button>
            </div>
        );
    }
    if (offer.kind === "gift") {
        return (
            <div className="agent-pet-card-actions">
                <Button size="small" block type="primary" danger icon={<Gift className="size-3.5" />} loading={busy} disabled={locked} onClick={onBuy}>
                    免费领取
                </Button>
            </div>
        );
    }
    if (offer.kind === "paid" || offer.kind === "sale") {
        if (confirming) {
            return (
                <div className="agent-pet-card-actions">
                    {shortOfCredits ? (
                        <Button size="small" type="primary" className="min-w-0 flex-1" onClick={() => openWorkspaceWallet({ tab: "topup" })}>
                            积分不足，去充值
                        </Button>
                    ) : (
                        <Button size="small" type="primary" className="min-w-0 flex-1" loading={busy} disabled={locked} onClick={onBuy}>
                            确认支付 {formatCredits(offer.price, 2)}
                        </Button>
                    )}
                    <Button size="small" disabled={busy} onClick={() => onConfirm(false)}>
                        取消
                    </Button>
                </div>
            );
        }
        return (
            <div className="agent-pet-card-actions">
                <Button
                    size="small"
                    block
                    type={offer.kind === "sale" ? "primary" : "default"}
                    danger={offer.kind === "sale"}
                    icon={offer.kind === "sale" ? <Flame className="size-3.5" /> : <ShoppingBag className="size-3.5" />}
                    disabled={locked}
                    onClick={() => onConfirm(true)}
                >
                    {offer.kind === "sale" ? "立即抢购" : "购买"}
                </Button>
            </div>
        );
    }
    const reason =
        offer.kind === "spend"
            ? { label: `还差 ${formatCredits(offer.remaining, 2)} 积分`, title: `累计消费满 ${formatCredits(offer.unlock, 2)} 积分即可免费领取`, icon: <Lock className="size-3.5" /> }
            : offer.kind === "vip"
              ? { label: "加入会员可用", title: "加入对应会员分组后可用", icon: <Crown className="size-3.5" /> }
              : { label: "暂不可购买", title: "积分功能暂未开放", icon: undefined };
    return (
        <div className="agent-pet-card-actions">
            <Button size="small" block disabled icon={reason.icon} title={reason.title}>
                {reason.label}
            </Button>
        </div>
    );
}

function CurrentMark() {
    return (
        <span className="agent-pet-card-current">
            <Check className="size-3" aria-hidden="true" />
            使用中
        </span>
    );
}

function PickerNotice({ theme, children }: { theme: CanvasTheme; children: ReactNode }) {
    return (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-xs" style={{ color: theme.node.muted }}>
            {children}
        </div>
    );
}
