import type { EcommerceOneClickFlow } from "./ecommerce-oneclick";
import type { EcommerceSuiteRow } from "./ecommerce-suite";
import type { EcommerceSuiteTemplate } from "@/services/api/ecommerce";
import { ecommerceSliceSpec, type EcommerceSlicePlatform } from "./ecommerce-slice";
import { ecommercePlatformGuidance } from "./ecommerce-platform-guidance";

export type EcommerceBrief = { platform?: string; slicePlatform?: EcommerceSlicePlatform; imageCount?: number; sellingPoints?: string; audience?: string; language?: string; forbidden?: string; style?: string; template?: EcommerceSuiteTemplate };

export function ecommerceBriefSlicePlatform(brief?: EcommerceBrief, fallback?: string): EcommerceSlicePlatform {
    const platform = brief?.slicePlatform || fallback || "taobao";
    const spec = ecommerceSliceSpec(platform as EcommerceSlicePlatform);
    if (!spec) throw new Error("请选择支持的长图切片规格");
    return spec.id;
}

export function ecommerceBriefRows(flow: EcommerceOneClickFlow, rows: EcommerceSuiteRow[], brief?: EcommerceBrief) {
    const count = brief?.imageCount;
    if (count === undefined) return rows;
    if (!Number.isInteger(count) || count < 1 || count > 30) throw new Error("计划张数须为 1–30 张");
    const result: EcommerceSuiteRow[] = [];
    let enabledCount = 0;
    for (const row of rows) {
        if (row.enabled === false) result.push(row);
        else if (enabledCount < count) {
            result.push(row);
            enabledCount++;
        }
    }
    const used = new Set(rows.map((row) => row.slotId));
    let sequence = 1;
    while (enabledCount < count) {
        while (used.has(`${flow.id}-extra-${sequence}`)) sequence++;
        const slotId = `${flow.id}-extra-${sequence++}`;
        used.add(slotId);
        result.push({ slotId, title: `第 ${enabledCount + 1} 张`, duty: "按商品事实与本套用途规划", prompt: "" });
        enabledCount++;
    }
    return result;
}

export function ecommerceBriefBlock(brief?: EcommerceBrief) {
    if (!brief) return "";
    const lines = [
        brief.platform && `发布平台：${brief.platform}`,
        brief.imageCount && `严格输出 ${brief.imageCount} 张，每张一行`,
        brief.sellingPoints && `卖点与依据：${brief.sellingPoints}`,
        brief.audience && `人群与场景：${brief.audience}`,
        brief.language && `图上文案语言：${brief.language}`,
        brief.forbidden && `禁止宣称与禁止改动：${brief.forbidden}`,
        brief.style && `整套视觉规范（所有画面保持一致）：${brief.style}`,
    ].filter(Boolean);
    return lines.length ? ["【用户补充信息】", ...lines, ecommercePlatformGuidance(brief.platform)].filter(Boolean).join(String.fromCharCode(10)) : "";
}
