import { apiBaseURL, http } from "./request";

/** 图集前 9 行的动作，下标即行号。 */
export const AGENT_PET_ROWS = ["idle", "running-right", "running-left", "waving", "jumping", "failed", "waiting", "running", "review"] as const;
export type AgentPetRow = (typeof AGENT_PET_ROWS)[number];
export type AgentPetAccess = "free" | "vip" | "paid";

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
    priceMicrocredits: number;
    owned: boolean;
    /** 付费形象对当前用户分组免费。 */
    memberFree: boolean;
    usable: boolean;
    purchasable: boolean;
    /** 头顶气泡的说话风格；上传形象为空，使用通用语气。 */
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
};

export type AgentPetPurchaseResult = {
    pet: AgentPet;
    charged: boolean;
    availableMicrocredits: number;
};

export type AdminAgentPet = AgentPet & {
    source: "builtin" | "upload";
    enabled: boolean;
    groupCodes: string[];
    sortOrder: number;
    ownerCount: number;
    updatedAt?: string;
};

export type AdminAgentPetInput = {
    name: string;
    description: string;
    enabled: boolean;
    access: AgentPetAccess;
    priceMicrocredits: number;
    groupCodes: string[];
    stateRows: Partial<Record<string, AgentPetRow>>;
    pixelated: boolean;
    sortOrder: number;
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

export async function importAdminAgentPet(file: File) {
    const body = new FormData();
    body.append("file", file);
    const result = await http.post<{ pet: AdminAgentPet }>("/admin/agent-pets/import", body);
    return result.pet;
}

export async function deleteAdminAgentPet(id: string) {
    await http.delete<{ deleted: boolean }>(`/admin/agent-pets/${encodeURIComponent(id)}`);
}
