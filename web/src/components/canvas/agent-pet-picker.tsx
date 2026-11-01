import { useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button } from "antd";
import { Check, Crown, Eye, LoaderCircle, RotateCcw, Sparkles } from "lucide-react";
import { useReducedMotion } from "motion/react";
import { useState, type ReactNode } from "react";

import { AgentPetSprite } from "@/components/canvas/agent-pet-sprite";
import { FluidOrb } from "@/components/ui/fluid-orb";
import { formatCredits } from "@/constant/credits";
import { agentPetCatalogQueryKey, publishActiveAgentPet } from "@/hooks/use-active-agent-pet";
import { useWalletBalance } from "@/hooks/use-wallet-balance";
import type { CanvasTheme } from "@/lib/canvas-theme";
import { AGENT_PET_ASPECT } from "@/lib/canvas/agent-pet";
import { openWorkspaceWallet } from "@/lib/workspace-wallet";
import { agentPetSpritesheetURL, getAgentPetCatalog, purchaseAgentPet, selectAgentPet, type AgentPet } from "@/services/api/agent-pets";
import { ApiError } from "@/services/api/request";
import { useUserStore } from "@/stores/use-user-store";

const PREVIEW_HEIGHT = 96;
const PREVIEW_WIDTH = Math.round(PREVIEW_HEIGHT * AGENT_PET_ASPECT);

/** Agent 设置里的“助手形象”：浏览、购买和切换智能体形象。只影响当前用户自己的显示。 */
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

    const apply = async (pet: AgentPet | null) => {
        setBusyId(pet?.id ?? "");
        try {
            const selected = await selectAgentPet(pet?.id ?? "");
            publishActiveAgentPet(queryClient, userId, selected);
            message.success(selected ? `已换成「${selected.name}」` : "已恢复默认形象");
        } catch (cause) {
            message.error(cause instanceof Error ? cause.message : "形象切换失败，请稍后重试");
            void catalog.refetch();
        } finally {
            setBusyId(null);
        }
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
    return (
        <div className="canvas-agent-settings-scroll thin-scrollbar min-h-0 flex-1 overflow-y-auto p-4">
            <p className="mb-3 text-xs leading-5" style={{ color: theme.node.muted }}>
                形象只对你自己显示。带「视线」标记的形象待机时会看向鼠标。
                {creditsEnabled && balance !== null ? ` 当前可用 ${formatCredits(balance, 2)} 积分。` : ""}
            </p>
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
                            {selected ? (
                                <Button size="small" block disabled icon={<Check className="size-3.5" />}>
                                    使用中
                                </Button>
                            ) : pet.usable ? (
                                <Button size="small" block loading={busyId === pet.id} disabled={busyId !== null} onClick={() => void apply(pet)}>
                                    使用
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

function petBadges(pet: AgentPet) {
    const badges: string[] = [];
    if (pet.spriteVersion === 2) badges.push("视线");
    if (pet.owned) badges.push("已拥有");
    else if (pet.memberFree) badges.push("会员免费");
    else if (pet.access === "vip") badges.push("VIP");
    else if (pet.access === "paid") badges.push(`${formatCredits(pet.priceMicrocredits, 2)} 积分`);
    else badges.push("免费");
    return badges;
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
