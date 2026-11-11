import { canonicalize } from "json-canonicalize";
import { normalizeStudioPlanPrep } from "./plan-prep";
import type { StudioGenerationSource, StudioModelPick, StudioPhoto } from "./types";

/** 策划身份只包含创作输入；保存时间、出图结果和逐屏编辑不会使策划失效。 */
export function studioPlanInputSignature(product: StudioGenerationSource): string {
    const { brief, dossier } = product;
    const photos = (items: StudioPhoto[]) => items.map(({ id, resourceId, view, truth }) => [id, resourceId, view, truth]);
    const pick = (item?: StudioModelPick) => (item ? [item.itemId, item.name, item.prompt, item.resourceId || ""] : null);
    const prep = normalizeStudioPlanPrep(brief.prep);
    return canonicalize({
        version: 1,
        name: product.name,
        platform: product.platform,
        style: product.style,
        sellerNotes: product.sellerNotes,
        photos: photos(product.photos),
        references: photos(product.references),
        dossier: dossier
            ? { name: dossier.name, category: dossier.category, family: dossier.family, summary: dossier.summary, invariants: dossier.invariants, facts: dossier.facts.map(({ id, group, label, value, evidence }) => [id, group, label, value, evidence]) }
            : null,
        sellingPoints: product.sellingPoints.map(({ id, title, detail, evidence, factIds, enabled }) => [id, title, detail, evidence, factIds, enabled]),
        copy: product.copy || null,
        brief: {
            brand: brief.brand,
            productType: brief.productType,
            outputType: brief.outputType,
            mix: brief.outputType === "mix" ? brief.mix : undefined,
            count: brief.outputType.endsWith("-set") ? undefined : brief.count,
            detailScreens: brief.outputType === "detail-set" ? brief.detailScreens : undefined,
            suite: brief.outputType === "template-set" ? brief.suite : undefined,
            market: brief.market,
            language: brief.language,
            shooting: brief.shooting,
            audience: brief.audience,
            positioning: brief.positioning,
            extra: brief.extra,
            sameLayout: brief.sameLayout,
            ratio: brief.ratio,
            planNote: brief.planNote?.trim() || "",
            answers: prep?.asks.map(({ question, picked, note }) => [question, picked, note]) || [],
            direction: prep?.directions.find(({ id }) => id === prep.picked) || null,
            model: [pick(brief.model?.figure), pick(brief.model?.face), pick(brief.model?.pose), pick(brief.model?.style)],
        },
    });
}
