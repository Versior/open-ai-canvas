import { checkImageAgainstSpec, type EcommerceImageAudit } from "@/lib/ecommerce/ecommerce-platform-specs";
import { studioShotSpec } from "./shot-specs";
import { studioFactUsable, type StudioProduct, type StudioShot } from "./types";

export type StudioDeliveryMeasure = { width: number; height: number; bytes: number; audit?: EcommerceImageAudit };
export type StudioDeliveryIssue = { shotId?: string; title: string; message: string };
export type StudioDeliveryReview = { total: number; delivered: number; issues: StudioDeliveryIssue[]; manualChecks: string[] };

/** 只采样边缘，不把它当成全图分割、商品一致性或 OCR 检测。透明边缘不算纯白。 */
export function studioEdgeAudit(data: Uint8ClampedArray, width: number, height: number): EcommerceImageAudit {
    if (width < 1 || height < 1 || data.length !== width * height * 4) throw new Error("图像采样尺寸无效");
    let white = 0,
        count = 0;
    const rgb = [0, 0, 0];
    const sample = (x: number, y: number) => {
        const index = (y * width + x) * 4;
        const [r, g, b, a] = data.subarray(index, index + 4);
        if (r >= 250 && g >= 250 && b >= 250 && a >= 250) white++;
        rgb[0] += r;
        rgb[1] += g;
        rgb[2] += b;
        count++;
    };
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (x === 0 || y === 0 || x === width - 1 || y === height - 1) sample(x, y);
    return {
        whiteEdgeRatio: white / count,
        cornerColor:
            "#" +
            rgb
                .map((value) =>
                    Math.round(value / count)
                        .toString(16)
                        .padStart(2, "0"),
                )
                .join(""),
    };
}

export function reviewStudioDelivery(product: StudioProduct, shots: StudioShot[], measurements: ReadonlyMap<string, StudioDeliveryMeasure>, deliveredIds: ReadonlySet<string>): StudioDeliveryReview {
    const issues: StudioDeliveryIssue[] = [];
    for (const shot of shots) {
        if (!deliveredIds.has(shot.id)) {
            issues.push({ shotId: shot.id, title: shot.title, message: "没有可交付成品；整套交付前请补齐或明确删去这一张" });
            continue;
        }
        const measured = measurements.get(shot.id);
        if (!measured) {
            issues.push({ shotId: shot.id, title: shot.title, message: "成品尺寸和文件大小尚未实测" });
            continue;
        }
        const role = studioShotSpec(shot.role, product.dossier?.family || "generic").platformRole;
        for (const issue of checkImageAgainstSpec({ platformId: product.platform, role, facts: measured })) issues.push({ shotId: shot.id, title: shot.title, message: issue.message });
        const [w, h] = shot.ratio.split(":").map(Number);
        if (w > 0 && h > 0 && Math.abs(measured.width / measured.height / (w / h) - 1) > 0.02) issues.push({ shotId: shot.id, title: shot.title, message: `实际画幅 ${measured.width}×${measured.height} 与策划 ${shot.ratio} 偏差超过 2%，请检查排版` });
        const copy = [shot.headline, shot.subline, ...shot.lines].join(" ");
        const claims = [...new Set(copy.match(/国家级|全网第一|最便宜|百分百有效|100%有效|治疗|治愈|零风险/g) || [])];
        if (claims.length) issues.push({ shotId: shot.id, title: shot.title, message: `文案包含待人工审核表述：${claims.join("、")}` });
    }
    for (const point of product.sellingPoints.filter((point) => point.enabled && !["visible", "confirmed"].includes(point.evidence))) issues.push({ title: point.title, message: "启用的卖点尚未确认，请核对依据后再上架" });
    if (product.dossier?.facts.some((fact) => !studioFactUsable(fact))) issues.push({ title: "商品档案", message: "档案仍有推断或待确认信息，须由卖家核实" });
    return {
        total: shots.length,
        delivered: deliveredIds.size,
        issues,
        manualChecks: [
            "核对商品外观、颜色、包装文字与原图一致",
            "核对文字、参数、品牌与卖点依据；程序未做 OCR",
            "确认模特、品牌和素材使用权限",
            "按商家后台最新要求复查；内置平台参数仅作为建议",
            "主体占比、完整白底和生成标识需人工确认；边缘采样不能替代全图审核",
        ],
    };
}
