import type { ComponentProps } from "react";
import { Coins } from "lucide-react";

export { requestCreditCost } from "@/lib/model-pricing";

export function CreditSymbol({ className, ...props }: ComponentProps<"span">) {
    return (
        <span {...props} className={`inline-flex items-center justify-center ${className || ""}`}>
            <Coins className="size-[1em]" strokeWidth={2.2} />
        </span>
    );
}

export function formatCredits(value: number, maximumFractionDigits = 6) {
    return (value / 1_000_000).toLocaleString("zh-CN", { maximumFractionDigits });
}

export function formatCompactCredits(value: number) {
    return value > 0 && value < 10_000 ? "<0.01" : formatCredits(value, 2);
}
