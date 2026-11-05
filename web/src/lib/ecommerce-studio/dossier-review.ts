import type { StudioDossier, StudioFact, StudioFactGroup } from "./types";

/**
 * 商品档案的人工核对：确认推断、改错、回答识别时没能确认的问题。
 * 卖家核对过的信息记为 confirmed、来源写「卖家」，与助手的约定一致；只有图片可见与已确认的信息会进入出图提示词。
 */
export const STUDIO_SELLER_SOURCE = "卖家";

const MAX_VALUE = 240;
const MAX_LABEL = 40;

export function confirmStudioFact(dossier: StudioDossier, factId: string): StudioDossier {
    return { ...dossier, facts: dossier.facts.map((fact) => (fact.id === factId ? { ...fact, evidence: "confirmed", source: STUDIO_SELLER_SOURCE } : fact)) };
}

export function removeStudioFact(dossier: StudioDossier, factId: string): StudioDossier {
    return { ...dossier, facts: dossier.facts.filter((fact) => fact.id !== factId) };
}

/** 卖家改过的值由卖家负责，记为已确认；改成空等于删掉这条。 */
export function patchStudioFactValue(dossier: StudioDossier, factId: string, value: string): StudioDossier {
    const text = value.trim().slice(0, MAX_VALUE);
    if (!text) return removeStudioFact(dossier, factId);
    return { ...dossier, facts: dossier.facts.map((fact) => (fact.id === factId ? { ...fact, value: text, evidence: "confirmed", source: STUDIO_SELLER_SOURCE } : fact)) };
}

export function removeStudioInvariant(dossier: StudioDossier, invariant: string): StudioDossier {
    return { ...dossier, invariants: dossier.invariants.filter((item) => item !== invariant) };
}

export function dismissStudioQuestion(dossier: StudioDossier, question: string): StudioDossier {
    return { ...dossier, questions: dossier.questions.filter((item) => item !== question) };
}

// 问题问的是什么，答案就归到哪一组；靠前的优先，对不上时归到参数。
const QUESTION_GROUPS: [RegExp, StudioFactGroup][] = [
    [/品牌|型号|系列|款号/, "identity"],
    [/印字|刻字|文字|字样|标签|标识|logo/i, "text"],
    [/材质|面料|材料|成分|用料/, "material"],
    [/尺寸|尺码|容量|重量|规格|参数|长度|宽度|高度|厚度|直径|功率|电池|续航/, "spec"],
    [/包装|配件|赠品|附件|礼盒/, "package"],
    [/用途|适用|场景|人群/, "usage"],
    [/结构|部件|开合|按键|接口|拉链|扣/, "structure"],
    [/颜色|配色|外观|图案|花纹/, "appearance"],
];

export function studioQuestionGroup(question: string): StudioFactGroup {
    return QUESTION_GROUPS.find(([pattern]) => pattern.test(question))?.[1] || "spec";
}

/** 问题改写成事实名称：去掉「请确认」这类开头和句末问号。 */
export function studioQuestionLabel(question: string) {
    const text = question
        .trim()
        .replace(/^(请|麻烦)?(确认|核实|说明|告知)(一下)?[:：]?\s*/, "")
        // 英文句点可能是内容本身（如「NORDA.」），只去掉问号和中文句末标点。
        .replace(/[？?！!。]+$/, "")
        .trim();
    return (text || question.trim()).slice(0, MAX_LABEL);
}

/** 回答一个问题：答案作为卖家确认的事实写进档案，问题从列表里去掉。 */
export function answerStudioQuestion(dossier: StudioDossier, question: string, answer: string, id: string): StudioDossier {
    const value = answer.trim().slice(0, MAX_VALUE);
    if (!value || !dossier.questions.includes(question)) return dossier;
    const fact: StudioFact = { id, group: studioQuestionGroup(question), label: studioQuestionLabel(question), value, evidence: "confirmed", source: STUDIO_SELLER_SOURCE };
    return { ...dossier, facts: [...dossier.facts, fact], questions: dossier.questions.filter((item) => item !== question) };
}

function sameFact(a: Pick<StudioFact, "group" | "label">, b: Pick<StudioFact, "group" | "label">) {
    return a.group === b.group && a.label.trim() === b.label.trim();
}

/**
 * 重新识别：以新结果为准，但卖家确认过的信息保留。同组同名的新结果让位给确认过的那条；
 * 已经回答过的问题不再重复列出。
 */
export function mergeStudioDossier(previous: StudioDossier | undefined, next: StudioDossier): StudioDossier {
    const kept = (previous?.facts || []).filter((fact) => fact.evidence === "confirmed");
    if (!kept.length) return next;
    const labels = new Set(kept.map((fact) => fact.label.trim()));
    return {
        ...next,
        facts: [...next.facts.filter((fact) => !kept.some((item) => sameFact(item, fact))), ...kept],
        questions: next.questions.filter((question) => !labels.has(studioQuestionLabel(question))),
    };
}
