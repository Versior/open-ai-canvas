import type { AgentPet, AgentPetTone } from "@/services/api/agent-pets";

/** 商店展示用的纯函数：获取方式、折扣、倒计时、分类和筛选。后台与用户端共用同一套文案。 */

export const AGENT_PET_TONES: readonly AgentPetTone[] = ["gentle", "kitty", "puppy", "robot", "mystic", "sunny"];
export const AGENT_PET_TONE_LABELS: Record<AgentPetTone, string> = { gentle: "温柔", kitty: "猫系", puppy: "狗系", robot: "机器人", mystic: "魔法", sunny: "元气" };

/** 卡片上的获取方式，决定价格标签和按钮。 */
export type AgentPetOffer =
    | { kind: "owned" }
    | { kind: "free" }
    | { kind: "member" }
    | { kind: "vip" }
    | { kind: "paid"; price: number }
    | { kind: "sale"; price: number; listPrice: number; label: string; endsAt: string | null }
    | { kind: "gift"; listPrice: number; label: string; endsAt: string | null }
    | { kind: "spend"; unlock: number; remaining: number; ratio: number }
    | { kind: "claimable"; unlock: number }
    | { kind: "unavailable"; price: number };

export function agentPetOffer(pet: AgentPet, consumedMicrocredits: number): AgentPetOffer {
    if (pet.owned) return { kind: "owned" };
    if (pet.memberFree) return { kind: "member" };
    switch (pet.access) {
        case "free":
            return { kind: "free" };
        case "vip":
            return pet.usable ? { kind: "member" } : { kind: "vip" };
        case "spend":
            if (pet.claimable) return { kind: "claimable", unlock: pet.unlockMicrocredits };
            return {
                kind: "spend",
                unlock: pet.unlockMicrocredits,
                remaining: Math.max(0, pet.unlockMicrocredits - consumedMicrocredits),
                ratio: pet.unlockMicrocredits > 0 ? Math.min(1, Math.max(0, consumedMicrocredits / pet.unlockMicrocredits)) : 1,
            };
        case "paid":
            if (!pet.purchasable) return { kind: "unavailable", price: pet.priceMicrocredits };
            if (pet.promotion && pet.priceMicrocredits === 0) return { kind: "gift", listPrice: pet.listPriceMicrocredits, label: pet.promotion.label, endsAt: pet.promotion.endsAt };
            if (pet.promotion) return { kind: "sale", price: pet.priceMicrocredits, listPrice: pet.listPriceMicrocredits, label: pet.promotion.label, endsAt: pet.promotion.endsAt };
            return { kind: "paid", price: pet.priceMicrocredits };
    }
}

/** 折扣文案：8 折、8.5 折（按 0.1 折四舍五入，最低 0.1 折、最高 9.9 折），0 元为“免费”。 */
export function agentPetDiscountLabel(price: number, listPrice: number) {
    if (price <= 0) return "免费";
    if (listPrice <= 0 || price >= listPrice) return "";
    const tenths = Math.min(99, Math.max(1, Math.round((price / listPrice) * 100)));
    return `${tenths % 10 === 0 ? tenths / 10 : (tenths / 10).toFixed(1)} 折`;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** 促销倒计时：剩 2 天 3 小时 / 剩 5 小时 20 分 / 剩 12 分钟；已过期返回“已结束”。 */
export function formatAgentPetCountdown(endsAt: string, now: number) {
    const left = new Date(endsAt).getTime() - now;
    if (!Number.isFinite(left) || left <= 0) return "已结束";
    const days = Math.floor(left / DAY);
    const hours = Math.floor((left % DAY) / HOUR);
    const minutes = Math.floor((left % HOUR) / MINUTE);
    if (days > 0) return `剩 ${days} 天${hours ? ` ${hours} 小时` : ""}`;
    if (hours > 0) return `剩 ${hours} 小时${minutes ? ` ${minutes} 分` : ""}`;
    return `剩 ${Math.max(1, minutes)} 分钟`;
}

export type AgentPetStoreFilter = "all" | "usable" | "sale" | "free" | "paid" | "spend" | "vip";

export const AGENT_PET_STORE_FILTERS: ReadonlyArray<{ id: AgentPetStoreFilter; label: string }> = [
    { id: "all", label: "全部" },
    { id: "usable", label: "可使用" },
    { id: "sale", label: "限时活动" },
    { id: "free", label: "免费" },
    { id: "paid", label: "积分购买" },
    { id: "spend", label: "消费解锁" },
    { id: "vip", label: "会员专享" },
];

export function matchesAgentPetFilter(pet: AgentPet, filter: AgentPetStoreFilter) {
    switch (filter) {
        case "all":
            return true;
        case "usable":
            return pet.usable;
        case "sale":
            return pet.promotion !== null;
        default:
            return pet.access === filter;
    }
}

/** 形象出现过的分类，按首次出现的顺序（即后台排序）；未分类不列出。 */
export function agentPetCategories(pets: ReadonlyArray<Pick<AgentPet, "category">>) {
    const counts = new Map<string, number>();
    for (const pet of pets) {
        if (pet.category) counts.set(pet.category, (counts.get(pet.category) ?? 0) + 1);
    }
    return [...counts].map(([name, count]) => ({ name, count }));
}
