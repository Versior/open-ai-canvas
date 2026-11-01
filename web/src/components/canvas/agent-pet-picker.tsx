import { useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button } from "antd";
import { Check, Crown, Eye, Gift, LoaderCircle, MessageCircleHeart, RotateCcw, Sparkles } from "lucide-react";
import { useReducedMotion } from "motion/react";
import { useState, type ReactNode } from "react";

import { AgentPetSprite } from "@/components/canvas/agent-pet-sprite";
import { Switch } from "@/components/ui/base/switch";
import { FluidOrb } from "@/components/ui/fluid-orb";
import { AppModal } from "@/components/ui/product/app-modal";
import { formatCredits } from "@/constant/credits";
import { agentPetCatalogQueryKey, publishActiveAgentPet, useApplyAgentPet } from "@/hooks/use-active-agent-pet";
import { useWalletBalance } from "@/hooks/use-wallet-balance";
import type { CanvasTheme } from "@/lib/canvas-theme";
import { AGENT_PET_ASPECT } from "@/lib/canvas/agent-pet";
import { openWorkspaceWallet } from "@/lib/workspace-wallet";
import { agentPetSpritesheetURL, getAgentPetCatalog, purchaseAgentPet, selectAgentPet, type AgentPet } from "@/services/api/agent-pets";
import { ApiError } from "@/services/api/request";
import { useAgentPetPrefsStore } from "@/stores/use-agent-pet-prefs-store";
import { useUserStore } from "@/stores/use-user-store";

const PREVIEW_HEIGHT = 96;
const PREVIEW_WIDTH = Math.round(PREVIEW_HEIGHT * AGENT_PET_ASPECT);

/** “助手形象”：浏览、购买、领取和切换智能体形象（Agent 设置与右键菜单的形象商店共用）。只影响当前用户自己的显示。 */
export function AgentPetPicker({ theme }: { theme: CanvasTheme }) {
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
    const selectedId = catalog.data?.selectedPetId ?? "";
    const chatter = useAgentPetPrefsStore((state) => state.chatter);
    const setChatter = useAgentPetPrefsStore((state) => state.setChatter);
    const applyPet = useApplyAgentPet();

    const apply = async (pet: AgentPet | null) => {
        setBusyId(pet?.id ?? "");
        await applyPet(pet);
        setBusyId(null);
    };

    const buy = async (pet: AgentPet) => {
        setBusyId(pet.id);
        try {
            await purchaseAgentPet(pet.id, pet.priceMicrocredits);
            window.dispatchEvent(new CustomEvent("wallet:updated"));
            setConfirmId("");
            const selected = await selectAgentPet(pet.id);
            publishActiveAgentPet(queryClient, userId, selected);
            message.success(`已购买并换上「${pet.name}」`);
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

    const pets = catalog.data.pets;
    const balance = wallet.availableMicrocredits;
    const consumed = catalog.data.consumedMicrocredits;
    const hasSpendPets = pets.some((pet) => pet.access === "spend");
    return (
        <div className="canvas-agent-settings-scroll thin-scrollbar min-h-0 flex-1 overflow-y-auto p-4">
            <p className="mb-3 text-xs leading-5" style={{ color: theme.node.muted }}>
                形象只对你自己显示。带「视线」标记的形象待机时会看向鼠标。
                {creditsEnabled && balance !== null ? ` 当前可用 ${formatCredits(balance, 2)} 积分。` : ""}
                {hasSpendPets ? ` 累计已消费 ${formatCredits(consumed, 2)} 积分，消费满门槛即可免费领取对应形象。` : ""}
            </p>
            <label className="mb-3 flex items-center gap-3 rounded-xl px-3 py-2.5" style={{ background: theme.node.fill }}>
                <MessageCircleHeart className="size-4 shrink-0" style={{ color: theme.accent.primary }} aria-hidden="true" />
                <span className="min-w-0 flex-1">
                    <span className="block text-xs font-medium">头顶气泡</span>
                    <span className="mt-0.5 block text-[var(--fs-label)] leading-4" style={{ color: theme.node.muted }}>
                        形象会提醒时间和未完成的项目，也会说说灵感和贴心话；待审批提醒始终显示
                    </span>
                </span>
                <Switch checked={chatter} onChange={setChatter} aria-label="头顶气泡" />
            </label>
            <div className="grid grid-cols-2 gap-2">
                <PetCard theme={theme} selected={!selectedId} title="默认形象" description="使用站点设置的助手形象" preview={<FluidOrb size={56} color="#7164f6" />}>
                    {selectedId ? (
                        <Button size="small" block loading={busyId === ""} disabled={busyId !== null} onClick={() => void apply(null)}>
                            使用
                        </Button>
                    ) : (
                        <Button size="small" block disabled icon={<Check className="size-3.5" />}>
                            使用中
                        </Button>
                    )}
                </PetCard>
                {pets.map((pet) => {
                    const selected = pet.id === selectedId;
                    const animated = previewId === pet.id || selected;
                    const shortOfCredits = balance !== null && balance < pet.priceMicrocredits;
                    return (
                        <PetCard
                            key={pet.id}
                            theme={theme}
                            selected={selected}
                            title={pet.name}
                            description={pet.description}
                            badges={petBadges(pet)}
                            onPreview={(active) => setPreviewId(active ? pet.id : "")}
                            preview={
                                <AgentPetSprite
                                    src={agentPetSpritesheetURL(pet)}
                                    version={pet.spriteVersion}
                                    state="idle"
                                    stateRows={pet.stateRows}
                                    width={PREVIEW_WIDTH}
                                    height={PREVIEW_HEIGHT}
                                    paused={!animated}
                                    reducedMotion={reducedMotion}
                                    pixelated={pet.pixelated}
                                    lookAtPointer={previewId === pet.id}
                                    label={pet.name}
                                />
                            }
                        >
                            {pet.access === "spend" && !pet.owned && !pet.memberFree ? <SpendProgress theme={theme} consumed={consumed} unlock={pet.unlockMicrocredits} /> : null}
                            {selected ? (
                                <Button size="small" block disabled icon={<Check className="size-3.5" />}>
                                    使用中
                                </Button>
                            ) : pet.claimable ? (
                                <Button size="small" block icon={<Gift className="size-3.5" />} loading={busyId === pet.id} disabled={busyId !== null} onClick={() => void apply(pet)}>
                                    领取并使用
                                </Button>
                            ) : pet.usable ? (
                                <Button size="small" block loading={busyId === pet.id} disabled={busyId !== null} onClick={() => void apply(pet)}>
                                    使用
                                </Button>
                            ) : pet.access === "spend" ? (
                                <Button size="small" block disabled title={`累计消费满 ${formatCredits(pet.unlockMicrocredits, 2)} 积分即可领取`}>
                                    还差 {formatCredits(Math.max(0, pet.unlockMicrocredits - consumed), 2)} 积分
                                </Button>
                            ) : pet.purchasable && confirmId === pet.id ? (
                                <div className="flex gap-1">
                                    {shortOfCredits ? (
                                        <Button size="small" type="primary" className="min-w-0 flex-1" onClick={() => openWorkspaceWallet({ tab: "topup" })}>
                                            积分不足，去充值
                                        </Button>
                                    ) : (
                                        <Button size="small" type="primary" className="min-w-0 flex-1" loading={busyId === pet.id} disabled={busyId !== null && busyId !== pet.id} onClick={() => void buy(pet)}>
                                            确认支付
                                        </Button>
                                    )}
                                    <Button size="small" disabled={busyId === pet.id} onClick={() => setConfirmId("")}>
                                        取消
                                    </Button>
                                </div>
                            ) : pet.purchasable ? (
                                <Button size="small" block icon={<Sparkles className="size-3.5" />} disabled={busyId !== null} onClick={() => setConfirmId(pet.id)}>
                                    {formatCredits(pet.priceMicrocredits, 2)} 积分购买
                                </Button>
                            ) : (
                                <Button size="small" block disabled icon={pet.access === "vip" ? <Crown className="size-3.5" /> : undefined} title={pet.access === "vip" ? "加入对应会员分组后可用" : "积分功能暂未开放"}>
                                    {pet.access === "vip" ? "VIP 专享" : "暂不可购买"}
                                </Button>
                            )}
                        </PetCard>
                    );
                })}
            </div>
            {pets.length === 0 ? (
                <p className="mt-3 text-xs leading-5" style={{ color: theme.node.muted }}>
                    管理员还没有开放可更换的形象。
                </p>
            ) : null}
        </div>
    );
}

/** 右键菜单里的「形象商店」：弹窗里的同一个形象列表。 */
export function AgentPetStoreModal({ theme, open, onClose }: { theme: CanvasTheme; open: boolean; onClose: () => void }) {
    return (
        <AppModal open={open} title={null} footer={null} centered width="min(600px, calc(100vw - 24px))" onCancel={onClose} flush aria-label="形象商店">
            <div className="flex h-[min(680px,calc(100dvh-96px))] min-h-0 flex-col" style={{ color: theme.node.text, background: theme.node.panel }}>
                <header className="shrink-0 border-b px-4 py-3 pr-12" style={{ borderColor: theme.node.stroke }}>
                    <h2 className="text-sm font-semibold">形象商店</h2>
                    <p className="mt-0.5 text-[var(--fs-label)]" style={{ color: theme.node.muted }}>
                        免费、会员专享、积分购买或累计消费解锁
                    </p>
                </header>
                <AgentPetPicker theme={theme} />
            </div>
        </AppModal>
    );
}

function petBadges(pet: AgentPet) {
    const badges: string[] = [];
    if (pet.spriteVersion === 2) badges.push("视线");
    if (pet.owned) badges.push("已拥有");
    else if (pet.memberFree) badges.push("会员免费");
    else if (pet.access === "vip") badges.push("VIP");
    else if (pet.access === "paid") badges.push(`${formatCredits(pet.priceMicrocredits, 2)} 积分`);
    else if (pet.access === "spend") badges.push(pet.claimable ? "可领取" : `消费满 ${formatCredits(pet.unlockMicrocredits, 2)}`);
    else badges.push("免费");
    return badges;
}

/** 累计消费解锁的进度条；只统计已结算的模型调用消费，购买形象不计入。 */
function SpendProgress({ theme, consumed, unlock }: { theme: CanvasTheme; consumed: number; unlock: number }) {
    const ratio = unlock > 0 ? Math.min(1, consumed / unlock) : 1;
    const text = `已消费 ${formatCredits(Math.min(consumed, unlock), 2)} / ${formatCredits(unlock, 2)} 积分`;
    return (
        <div
            className="mb-1.5 h-1 overflow-hidden rounded-full"
            style={{ background: theme.toolbar.itemHover }}
            role="progressbar"
            aria-label="累计消费进度"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(ratio * 100)}
            aria-valuetext={text}
            title={`${text}（只统计模型调用，购买形象不计入）`}
        >
            <div className="h-full rounded-full" style={{ width: `${ratio * 100}%`, background: theme.accent.primary }} />
        </div>
    );
}

function PetCard({
    theme,
    selected,
    title,
    description,
    badges = [],
    preview,
    onPreview,
    children,
}: {
    theme: CanvasTheme;
    selected: boolean;
    title: string;
    description: string;
    badges?: string[];
    preview: ReactNode;
    onPreview?: (active: boolean) => void;
    children: ReactNode;
}) {
    return (
        <div
            className="flex min-w-0 flex-col rounded-xl p-2"
            style={{ background: theme.node.fill, boxShadow: selected ? `inset 0 0 0 1px ${theme.accent.primary}` : "none" }}
            onPointerEnter={onPreview ? () => onPreview(true) : undefined}
            onPointerLeave={onPreview ? () => onPreview(false) : undefined}
            onFocus={onPreview ? () => onPreview(true) : undefined}
            onBlur={onPreview ? () => onPreview(false) : undefined}
        >
            <div className="grid place-items-center" style={{ height: PREVIEW_HEIGHT }}>
                {preview}
            </div>
            <div className="mt-1 flex min-w-0 items-center gap-1">
                <span className="truncate text-xs font-medium">{title}</span>
                {selected ? <Check className="size-3 shrink-0" style={{ color: theme.accent.primary }} aria-label="使用中" /> : null}
            </div>
            {badges.length ? (
                <div className="mt-1 flex flex-wrap gap-1">
                    {badges.map((badge) => (
                        <span key={badge} className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[var(--fs-label)] leading-none" style={{ background: theme.toolbar.itemHover, color: theme.node.muted }}>
                            {badge === "视线" ? <Eye className="size-2.5" aria-hidden="true" /> : null}
                            {badge}
                        </span>
                    ))}
                </div>
            ) : null}
            <p className="mt-1 line-clamp-2 min-h-8 text-[var(--fs-label)] leading-4" style={{ color: theme.node.muted }}>
                {description}
            </p>
            <div className="mt-2">{children}</div>
        </div>
    );
}

function PickerNotice({ theme, children }: { theme: CanvasTheme; children: ReactNode }) {
    return (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-xs" style={{ color: theme.node.muted }}>
            {children}
        </div>
    );
}
