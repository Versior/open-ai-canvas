import { describe, expect, test } from "bun:test";

import { agentPetCategories, agentPetDiscountLabel, agentPetOffer, formatAgentPetCountdown, matchesAgentPetFilter } from "../src/lib/canvas/agent-pet-store";
import type { AgentPet } from "../src/services/api/agent-pets";

const CREDIT = 1_000_000;

function pet(patch: Partial<AgentPet>): AgentPet {
    return {
        id: "pet",
        name: "形象",
        description: "",
        spriteVersion: 2,
        revision: "r",
        pixelated: false,
        stateRows: {},
        access: "free",
        priceMicrocredits: 0,
        listPriceMicrocredits: 0,
        promotion: null,
        owned: false,
        memberFree: false,
        usable: true,
        purchasable: false,
        unlockMicrocredits: 0,
        claimable: false,
        category: "",
        badge: "",
        tone: "gentle",
        lines: [],
        ...patch,
    };
}

describe("agent pet store offers", () => {
    test("each way of getting a pet maps to one offer", () => {
        expect(agentPetOffer(pet({}), 0).kind).toBe("free");
        expect(agentPetOffer(pet({ access: "paid", owned: true }), 0).kind).toBe("owned");
        expect(agentPetOffer(pet({ access: "paid", memberFree: true }), 0).kind).toBe("member");
        expect(agentPetOffer(pet({ access: "vip", usable: false }), 0).kind).toBe("vip");
        expect(agentPetOffer(pet({ access: "paid", usable: false, purchasable: true, priceMicrocredits: 5 * CREDIT, listPriceMicrocredits: 5 * CREDIT }), 0)).toEqual({ kind: "paid", price: 5 * CREDIT });
        expect(agentPetOffer(pet({ access: "paid", usable: false, purchasable: false, priceMicrocredits: 5 * CREDIT }), 0).kind).toBe("unavailable");
        const sale = agentPetOffer(pet({ access: "paid", usable: false, purchasable: true, priceMicrocredits: 4 * CREDIT, listPriceMicrocredits: 5 * CREDIT, promotion: { label: "限时特惠", endsAt: "2026-11-02T00:00:00Z" } }), 0);
        expect(sale).toEqual({ kind: "sale", price: 4 * CREDIT, listPrice: 5 * CREDIT, label: "限时特惠", endsAt: "2026-11-02T00:00:00Z" });
        expect(agentPetOffer(pet({ access: "paid", usable: false, purchasable: true, priceMicrocredits: 0, listPriceMicrocredits: 5 * CREDIT, promotion: { label: "限时免费", endsAt: null } }), 0).kind).toBe("gift");
        expect(agentPetOffer(pet({ access: "spend", usable: false, unlockMicrocredits: 50 * CREDIT }), 12 * CREDIT)).toEqual({ kind: "spend", unlock: 50 * CREDIT, remaining: 38 * CREDIT, ratio: 0.24 });
        expect(agentPetOffer(pet({ access: "spend", claimable: true, unlockMicrocredits: 10 * CREDIT }), 12 * CREDIT).kind).toBe("claimable");
    });

    test("discount labels round to tenths and never read 10 折", () => {
        expect(agentPetDiscountLabel(4 * CREDIT, 5 * CREDIT)).toBe("8 折");
        expect(agentPetDiscountLabel(10_630_000, 12_500_000)).toBe("8.5 折");
        expect(agentPetDiscountLabel(0, 5 * CREDIT)).toBe("免费");
        expect(agentPetDiscountLabel(9_999_000, 10 * CREDIT)).toBe("9.9 折");
        expect(agentPetDiscountLabel(5 * CREDIT, 5 * CREDIT)).toBe("");
    });

    test("countdowns read in days, hours or minutes", () => {
        const now = Date.parse("2026-11-01T00:00:00Z");
        expect(formatAgentPetCountdown("2026-11-03T03:00:00Z", now)).toBe("剩 2 天 3 小时");
        expect(formatAgentPetCountdown("2026-11-02T00:00:00Z", now)).toBe("剩 1 天");
        expect(formatAgentPetCountdown("2026-11-01T05:20:00Z", now)).toBe("剩 5 小时 20 分");
        expect(formatAgentPetCountdown("2026-11-01T00:00:20Z", now)).toBe("剩 1 分钟");
        expect(formatAgentPetCountdown("2026-10-31T23:00:00Z", now)).toBe("已结束");
    });

    test("filters and categories follow the catalog order", () => {
        const pets = [pet({ id: "a", category: "猫咪" }), pet({ id: "b", category: "狗狗", access: "paid", usable: false, promotion: { label: "x", endsAt: null } }), pet({ id: "c", category: "猫咪", access: "spend", usable: false }), pet({ id: "d" })];
        expect(agentPetCategories(pets)).toEqual([
            { name: "猫咪", count: 2 },
            { name: "狗狗", count: 1 },
        ]);
        expect(pets.filter((item) => matchesAgentPetFilter(item, "usable")).map((item) => item.id)).toEqual(["a", "d"]);
        expect(pets.filter((item) => matchesAgentPetFilter(item, "sale")).map((item) => item.id)).toEqual(["b"]);
        expect(pets.filter((item) => matchesAgentPetFilter(item, "spend")).map((item) => item.id)).toEqual(["c"]);
        expect(pets.filter((item) => matchesAgentPetFilter(item, "all"))).toHaveLength(4);
    });
});
