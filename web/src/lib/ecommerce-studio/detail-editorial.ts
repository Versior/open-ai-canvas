import type { StudioClaimSource } from "./claim-evidence";
import { studioPhotoEvidenceId } from "./reference-selection";
import type { StudioFact, StudioPlannedScreen, StudioProduct } from "./types";

const detailWordSegmenter = typeof Intl.Segmenter === "function" ? new Intl.Segmenter("zh", { granularity: "word" }) : undefined;
const framingWords = new Set("的 与 有 着 和 在 为 到 等 于 是 或 了 可 将 中 让 其 而 成为 出现 呈现 显示 展示 可见 信息 内容 实物 商品 画面 特写 位置 关系 同框 主体 处".split(" "));
const normalize = (text: string) =>
    text
        .normalize("NFKC")
        .toLowerCase()
        .replace(/[\s\p{P}]/gu, "");

export function withoutEstimatedColor(text: string) {
    return text.replace(/[，,；;]?\s*(?:近似|估算|大致)(?:色值|色号)?\s*[:：]?\s*#[\da-f]{6}\b/giu, "");
}

export function detailAlreadyDescribed(value: string, described: string) {
    const known = normalize(described);
    if (known.includes(normalize(value))) return true;
    if (!detailWordSegmenter || !known) return false;
    const key = value.replace(/横跨([^，。；]{1,12})一周/gu, "环绕$1");
    if ((key.match(/\d+(?:\.\d+)?(?:\s*(?:mm|cm|kg|ml|[a-z]+|毫米|厘米|千克|毫升|克|米))?|[a-z]+[a-z\d-]*|按压|按下|拨动|提起|翻开|抽出|转动|触达|拆卸|冲洗|接触/giu) || []).some((term) => !known.includes(normalize(term)))) return false;
    const words = [
        ...new Set(
            Array.from(detailWordSegmenter.segment(key))
                .filter(({ isWordLike, segment }) => isWordLike && !framingWords.has(segment))
                .map(({ segment }) => segment.toLowerCase()),
        ),
    ];
    const shared = words.filter((word) => known.includes(word)).length;
    return shared >= 4 && shared / words.length >= 0.76;
}

function unshownStudioDetailFacets(facts: StudioFact[], rest: StudioPlannedScreen[]) {
    const otherScreens = rest.map((screen) => [screen.purchaseQuestion, screen.displayContent, screen.visualFocus, screen.visualBeat].filter(Boolean).join("；"));
    return facts.flatMap((fact) => {
        if (fact.evidence !== "visible" || (fact.group !== "structure" && fact.group !== "appearance")) return [];
        const clauses = withoutEstimatedColor(fact.value)
            .split(/[。！？；，,;\n]+/u)
            .map((clause) => clause.trim());
        return clauses
            .filter((clause) => clause.length >= 6 && !/^(?:行程|方向|位置)|无法|不可见|看不清|未(?:拍清|拍到|确认)|疑似|可能/u.test(clause) && !otherScreens.some((description) => detailAlreadyDescribed(clause, description)))
            .map((clause) => ({ role: "detail-closeup", purchaseQuestion: fact.label, displayContent: `${fact.label}：${clause}。`, evidence: [`fact:${fact.id}`] }));
    });
}

export function* studioDetailEditorialCandidates(product: StudioProduct, sources: StudioClaimSource[], facts: StudioFact[], rest: StudioPlannedScreen[], crowded: boolean, next?: StudioPlannedScreen) {
    for (const source of sources) {
        if (!source.sellerConfirmed || !source.value || !source.id.startsWith("seller:")) continue;
        if (rest.some((screen) => screen.evidenceRefs?.includes(source.id) || [screen.displayContent, screen.purchaseQuestion].some((text) => text?.includes(source.label) || text?.includes(source.value!)))) continue;
        yield { role: "detail-selling", purchaseQuestion: `选这件商品时，${source.label}要看什么？`, displayContent: source.text, evidence: [source.id] };
    }
    if (!crowded) return;
    yield* unshownStudioDetailFacets(facts, rest);
    const region = next?.detailSource;
    const part = next?.visualFocus?.trim().replace(/[。；;，,]+$/u, "");
    if (!region || !part || part.length > 36 || !next.evidenceRefs?.includes(region.photo) || !["detail-closeup", "detail-material"].includes(next.role)) return;
    if (!product.photos.some((photo) => photo.truth && photo.resourceId && ["front", "side", "back"].includes(photo.view) && studioPhotoEvidenceId(photo) === region.photo)) return;
    const question = `从整件商品看，${part}在哪里？`;
    const context = (next.displayContent || part).replace(/(?:近景|特写)(?=[，,。；;]|$)/gu, "");
    yield {
        role: "detail-selling",
        purchaseQuestion: question,
        displayContent: `用整件商品交代${part}的位置。实拍中的对应结构：${context} 本屏保留整件与该部位的空间关系，不单拍局部。`,
        detailSource: { ...region, framing: "locate" as const },
        evidence: next.evidenceRefs,
    };
}
