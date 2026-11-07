import { describe, expect, test } from "bun:test";

import { taskBillingDisplay, taskBillingLabel, taskBillingTotals } from "@/lib/generation-task-billing";
import type { GenerationTask } from "@/services/api/task-center";

type Billing = NonNullable<GenerationTask["billing"]>;

const hold = { amountMicrocredits: 1_000_000, reservedMicrocredits: 1_000_000, refundedMicrocredits: 0 };

describe("task billing display", () => {
    test("a mixed batch totals real charges and keeps held/refunded money separate", () => {
        expect(
            taskBillingTotals([
                { ...hold, status: "settled", chargedMicrocredits: 600000, refundedMicrocredits: 400000 },
                { ...hold, status: "settled", chargedMicrocredits: 800000, refundedMicrocredits: 200000 },
                { ...hold, status: "uncertain" },
                { ...hold, status: "refunded", refundedMicrocredits: 1000000 },
            ]),
        ).toEqual(["已结算 1.4 积分 · 退回 0.6（2 个任务）", "待核对 1 积分", "已退回 1 积分"]);
    });
    test("settled shows the charged amount, not the hold, with the difference refund", () => {
        const billing: Billing = { ...hold, status: "settled", chargedMicrocredits: 600_000, refundedMicrocredits: 400_000 };
        expect(taskBillingDisplay(billing)).toEqual({ amount: "0.6", note: "已结算", refundNote: "退回 0.4", tone: "settled" });
        expect(taskBillingLabel(billing)).toBe("已结算 0.6 积分 · 退回 0.4");
    });

    test("settled without a refund has no refund note", () => {
        const billing: Billing = { ...hold, status: "settled", chargedMicrocredits: 1_000_000 };
        expect(taskBillingLabel(billing)).toBe("已结算 1 积分");
    });

    test("reserved and running show the hold as frozen", () => {
        for (const status of ["reserved", "running"] as const) {
            expect(taskBillingLabel({ ...hold, status })).toBe("冻结 1 积分");
        }
    });

    test("refunded and uncertain keep their own labels", () => {
        expect(taskBillingDisplay({ ...hold, status: "refunded", refundedMicrocredits: 1_000_000 })).toMatchObject({ note: "已退回", amount: "1", tone: "refunded" });
        expect(taskBillingDisplay({ ...hold, status: "uncertain" })).toMatchObject({ note: "待核对", tone: "uncertain" });
    });
});
