import { apiBaseURL, http } from "./request";

/** 图集前 9 行的动作，下标即行号。 */
export const AGENT_PET_ROWS = ["idle", "running-right", "running-left", "waving", "jumping", "failed", "waiting", "running", "review"] as const;
export type AgentPetRow = (typeof AGENT_PET_ROWS)[number];
/** spend：累计消费满门槛即可领取。 */
export type AgentPetAccess = "free" | "vip" | "paid" | "spend";

/** 正在进行的限时促销；endsAt 为空表示管理员手动结束前一直有效。 */
export type AgentPetPromotion = { label: string; endsAt: string | null };

export type AgentPet = {
    id: string;
    name: string;
    description: string;
    /** 2 表示图集带 16 个视线方向，可以跟随鼠标。 */
    spriteVersion: 1 | 2;
    revision: string;
    pixelated: boolean;
    /** 助手状态 → 图集动作的覆盖项；未覆盖的状态用默认映射。 */
    stateRows: Partial<Record<string, AgentPetRow>>;
    access: AgentPetAccess;
    /** 此刻的售价（促销中为促销价，限时免费为 0）；只对 paid 有值。 */
    priceMicrocredits: number;
    /** 原价；只对 paid 有值。 */
    listPriceMicrocredits: number;
    /** 只在促销进行中时有值。 */
    promotion: AgentPetPromotion | null;
    owned: boolean;
    /** 付费或消费解锁形象对当前用户分组免费。 */
    memberFree: boolean;
    usable: boolean;
    purchasable: boolean;
    /** 累计消费解锁的门槛（仅 spend）。 */
    unlockMicrocredits: number;
    /** 累计消费已达标、尚未领取；选择时自动领取。 */
    claimable: boolean;
    /** 商店分类，空为未分类。 */
    category: string;
    /** 卡片角标，如“新品”。 */
    badge: string;
    /** 头顶气泡的说话风格；为空时使用通用语气。 */
    tone: AgentPetTone | "";
    /** 形象专属台词。 */
    lines: string[];
};

export type AgentPetTone = "gentle" | "kitty" | "puppy" | "robot" | "mystic" | "sunny";

export type AgentPetCatalog = {
    pets: AgentPet[];
    /** 空字符串表示使用站点默认形象。 */
    selectedPetId: string;
    creditsEnabled: boolean;
    /** 累计消费（已结算的模型调用积分），用于累计消费解锁。 */
    consumedMicrocredits: number;
};

export type AgentPetPurchaseResult = {
    pet: AgentPet;
    /** 是否扣了积分；限时免费领取和重复购买为 false。 */
    charged: boolean;
    availableMicrocredits: number;
};

export type AgentPetPromoState = "none" | "scheduled" | "active" | "ended";

export type AdminAgentPet = AgentPet & {
    source: "builtin" | "upload";
    enabled: boolean;
    groupCodes: string[];
    sortOrder: number;
    /** 拥有人数（购买或领取）。 */
    ownerCount: number;
    /** 累计购买收入。 */
    revenueMicrocredits: number;
    promoEnabled: boolean;
    promoLabel: string;
    promoPriceMicrocredits: number;
    promoStartsAt: string | null;
    promoEndsAt: string | null;
    promoState: AgentPetPromoState;
    updatedAt?: string;
};

export type AdminAgentPetInput = {
    name: string;
    description: string;
    enabled: boolean;
    access: AgentPetAccess;
    priceMicrocredits: number;
    unlockMicrocredits: number;
    groupCodes: string[];
    stateRows: Partial<Record<string, AgentPetRow>>;
    pixelated: boolean;
    sortOrder: number;
    category: string;
    badge: string;
    /** 促销只对积分购买的形象生效；促销价 0 为限时免费。 */
    promoEnabled: boolean;
    promoLabel: string;
    promoPriceMicrocredits: number;
    promoStartsAt: string | null;
    promoEndsAt: string | null;
    /** 说话风格和台词只对上传形象生效。 */
    tone: AgentPetTone | "";
    lines: string[];
};

/** 批量修改：只改提供了的字段。 */
export type AdminAgentPetBatchInput = {
    ids: string[];
    enabled?: boolean;
    category?: string;
    badge?: string;
    access?: { mode: AgentPetAccess; priceMicrocredits?: number; unlockMicrocredits?: number; groupCodes?: string[] };
    /** enabled 为 false 时结束促销；percent 是原价的百分比（0 为限时免费）。 */
    promotion?: { enabled: boolean; label?: string; percent?: number; startsAt?: string | null; endsAt?: string | null };
};

export type AdminAgentPetBatchResult = {
    pets: AdminAgentPet[];
    deleted: string[];
    skipped: Array<{ id: string; name: string; reason: string }>;
};

export const AGENT_PET_IMPORT_MAX_BYTES = 32 * 1024 * 1024;

export function getAgentPetCatalog(signal?: AbortSignal) {
    return http.get<AgentPetCatalog>("/agent-pets", { signal });
}

export async function getAgentPetSelection(signal?: AbortSignal) {
    const result = await http.get<{ pet: AgentPet | null }>("/agent-pets/selection", { signal });
    return result.pet;
}

export async function selectAgentPet(petId: string) {
    const result = await http.put<{ pet: AgentPet | null }>("/agent-pets/selection", { petId });
    return result.pet;
}

export function purchaseAgentPet(petId: string, expectedPriceMicrocredits: number) {
    return http.post<AgentPetPurchaseResult>(`/agent-pets/${encodeURIComponent(petId)}/purchase`, { expectedPriceMicrocredits });
}

export function agentPetSpritesheetURL(pet: Pick<AgentPet, "id" | "revision">) {
    return `${apiBaseURL.replace(/\/$/, "")}/agent-pets/${encodeURIComponent(pet.id)}/spritesheet?v=${encodeURIComponent(pet.revision)}`;
}

export async function listAdminAgentPets() {
    const result = await http.get<{ pets: AdminAgentPet[] }>("/admin/agent-pets");
    return result.pets;
}

export async function updateAdminAgentPet(id: string, input: AdminAgentPetInput) {
    const result = await http.put<{ pet: AdminAgentPet }>(`/admin/agent-pets/${encodeURIComponent(id)}`, input);
    return result.pet;
}

export function batchUpdateAdminAgentPets(input: AdminAgentPetBatchInput) {
    return http.post<AdminAgentPetBatchResult>("/admin/agent-pets/batch", input);
}

export function batchDeleteAdminAgentPets(ids: string[]) {
    return http.post<AdminAgentPetBatchResult>("/admin/agent-pets/batch-delete", { ids });
}

export async function importAdminAgentPet(file: File) {
    const body = new FormData();
    body.append("file", file);
    const result = await http.post<{ pet: AdminAgentPet }>("/admin/agent-pets/import", body);
    return result.pet;
}

export async function deleteAdminAgentPet(id: string) {
    await http.delete<{ deleted: boolean }>(`/admin/agent-pets/${encodeURIComponent(id)}`);
}
