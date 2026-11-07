import { formatCompactCredits, formatCredits } from "@/constant/credits";
import type { GenerationTask } from "@/services/api/task-center";

type TaskBilling = NonNullable<GenerationTask["billing"]>;

export type TaskBillingDisplay = {
    /** 主金额：已结算为实收，已退回为退回额，其余为冻结额。 */
    amount: string;
    /** 状态：已结算、冻结、已退回、待核对。 */
    note: string;
    /** 已结算且有差额退回时为“退回 X”，其余为空串。 */
    refundNote: string;
    tone: "settled" | "held" | "refunded" | "uncertain";
};

/** 任务计费的展示口径：冻结额不是扣费，只有已结算才显示实收。任务中心与画布任务列表共用。 */
export function taskBillingDisplay(billing: TaskBilling): TaskBillingDisplay {
    switch (billing.status) {
        case "settled":
            return {
                amount: formatCredits(billing.chargedMicrocredits ?? 0),
                note: "已结算",
                refundNote: billing.refundedMicrocredits > 0 ? `退回 ${formatCredits(billing.refundedMicrocredits)}` : "",
                tone: "settled",
            };
        case "refunded":
            return { amount: formatCredits(billing.refundedMicrocredits || billing.reservedMicrocredits), note: "已退回", refundNote: "", tone: "refunded" };
        case "uncertain":
            return { amount: formatCredits(billing.reservedMicrocredits), note: "待核对", refundNote: "", tone: "uncertain" };
        default:
            return { amount: formatCredits(billing.reservedMicrocredits), note: "冻结", refundNote: "", tone: "held" };
    }
}

/** 单行计费文案，例如“已结算 0.6 积分 · 退回 0.4”“冻结 1 积分”。 */
export function taskBillingLabel(billing: TaskBilling) {
    const display = taskBillingDisplay(billing);
    const label = `${display.note} ${display.amount} 积分`;
    return display.refundNote ? `${label} · ${display.refundNote}` : label;
}

/** 创作页面只展示一行实收或退回；冻结及缺失账务不冒充已扣费。 */
export function taskBillingSummary(items: readonly TaskBilling[]) {
    const settled = items.filter((item) => item.status === "settled" && typeof item.chargedMicrocredits === "number" && Number.isFinite(item.chargedMicrocredits));
    if (settled.length) return `已消耗 ${formatCompactCredits(settled.reduce((sum, item) => sum + item.chargedMicrocredits!, 0))} 积分`;
    const refunded = items.filter((item) => item.status === "refunded").reduce((sum, item) => sum + item.refundedMicrocredits, 0);
    return refunded > 0 ? `已退回 ${formatCompactCredits(refunded)} 积分` : null;
}
