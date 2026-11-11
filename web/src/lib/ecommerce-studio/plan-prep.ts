import { STUDIO_DESIGN_TONES, studioPlanTone } from "./detail-plan";
import type { StudioAsk, StudioDirection, StudioPlanPrep } from "./types";

/**
 * 策划前的准备：卖家补充（AI 问、卖家答）和视角方案（AI 给几个方向、卖家挑一个）。
 * 这里是数据规则：读回、勾选、挑方向，以及交给策划的那一段；提示词和解析在 plan-prep-tasks.ts。
 * 卖家勾选或写下的答案当作已确认的信息；没勾的选项只是候选，不进策划。
 */
export const STUDIO_PREP_LIMITS = {
    asks: 5,
    question: 40,
    options: 6,
    option: 16,
    note: 80,
    directions: 4,
    angle: 10,
    positioning: 40,
    concept: 60,
    palette: 4,
    colorName: 10,
    visual: 160,
    why: 60,
} as const;

const HEX = /^#[0-9a-f]{6}$/i;
/** 没有信息量的选项：卖家点了也说明不了什么，补充一句话的输入框已经能代替。 */
const EMPTY_OPTION = /^(其他|其它|都可以|都行|不确定|不知道|以上都是|无)$/;

function text(value: unknown, max: number) {
    return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function strings(value: unknown, max: number, length: number) {
    return Array.isArray(value) ? [...new Set(value.map((item) => text(item, length)).filter(Boolean))].slice(0, max) : [];
}

export function studioAskOf(value: unknown): StudioAsk | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const record = value as Record<string, unknown>;
    const limits = STUDIO_PREP_LIMITS;
    const question = text(record.question, limits.question);
    const options = strings(record.options, limits.options, limits.option).filter((option) => !EMPTY_OPTION.test(option));
    if (!question || options.length < 2) return undefined;
    const picked = strings(record.picked, limits.options, limits.option).filter((item) => options.includes(item));
    const multi = record.multi === true;
    return { id: text(record.id, 40) || question, question, options, multi, picked: multi ? picked : picked.slice(0, 1), note: text(record.note, limits.note) };
}

export function studioPaletteOf(value: unknown): StudioDirection["palette"] {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => (item && typeof item === "object" ? (item as Record<string, unknown>) : {}))
        .map((item) => ({ name: text(item.name, STUDIO_PREP_LIMITS.colorName), hex: text(item.hex, 7) }))
        .filter((item) => item.name && HEX.test(item.hex))
        .slice(0, STUDIO_PREP_LIMITS.palette);
}

export function studioDirectionOf(value: unknown): StudioDirection | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const record = value as Record<string, unknown>;
    const limits = STUDIO_PREP_LIMITS;
    const angle = text(record.angle, limits.angle);
    const positioning = text(record.positioning, limits.positioning);
    const concept = text(record.concept, limits.concept);
    if (!angle || !positioning || !concept) return undefined;
    const tone = studioPlanTone(record.tone);
    return {
        id: text(record.id, 40) || angle,
        angle,
        positioning,
        concept,
        ...(tone ? { tone } : {}),
        palette: studioPaletteOf(record.palette),
        headline: typeof record.headline === "string" ? record.headline.trim() : "",
        visual: text(record.visual, limits.visual),
        why: text(record.why, limits.why),
    };
}

/** 读回表单里的策划前准备：问题和方向都没有时当作没有。挑中的方向要在方向列表里。 */
export function normalizeStudioPlanPrep(value: unknown): StudioPlanPrep | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const record = value as Record<string, unknown>;
    const asks = (Array.isArray(record.asks) ? record.asks : [])
        .map(studioAskOf)
        .filter((ask): ask is StudioAsk => Boolean(ask))
        .slice(0, STUDIO_PREP_LIMITS.asks);
    const directions = (Array.isArray(record.directions) ? record.directions : [])
        .map(studioDirectionOf)
        .filter((direction): direction is StudioDirection => Boolean(direction))
        .slice(0, STUDIO_PREP_LIMITS.directions);
    if (!asks.length && !directions.length) return undefined;
    const picked = text(record.picked, 40);
    return {
        asks,
        ...(text(record.askedAt, 40) ? { askedAt: text(record.askedAt, 40) } : {}),
        directions,
        ...(text(record.directionsAt, 40) ? { directionsAt: text(record.directionsAt, 40) } : {}),
        ...(picked && directions.some((direction) => direction.id === picked) ? { picked } : {}),
    };
}

/** 卖家答过的问题：勾了选项或写了补充的。 */
export function studioAnsweredAsks(prep: StudioPlanPrep | undefined) {
    return (prep?.asks || []).filter((ask) => ask.picked.length || ask.note.trim());
}

/** 一条答案写成一句：勾选的选项加补充说明。 */
export function studioAskAnswer(ask: Pick<StudioAsk, "picked" | "note">) {
    return [ask.picked.join("、"), ask.note.trim()].filter(Boolean).join("；");
}

export function studioPickedDirection(prep: StudioPlanPrep | undefined): StudioDirection | undefined {
    return prep?.picked ? prep.directions.find((direction) => direction.id === prep.picked) : undefined;
}

/** 点一个选项：单选题换成这一项（再点取消），多选题加上或去掉。 */
export function toggleStudioAskOption(prep: StudioPlanPrep, askId: string, option: string): StudioPlanPrep {
    return {
        ...prep,
        asks: prep.asks.map((ask) => {
            if (ask.id !== askId || !ask.options.includes(option)) return ask;
            const on = ask.picked.includes(option);
            if (ask.multi) return { ...ask, picked: on ? ask.picked.filter((item) => item !== option) : [...ask.picked, option] };
            return { ...ask, picked: on ? [] : [option] };
        }),
    };
}

export function setStudioAskNote(prep: StudioPlanPrep, askId: string, note: string): StudioPlanPrep {
    return { ...prep, asks: prep.asks.map((ask) => (ask.id === askId ? { ...ask, note: note.slice(0, STUDIO_PREP_LIMITS.note) } : ask)) };
}

/** 挑一个方向；再点同一个取消，策划时由 AI 自己定方向。 */
export function pickStudioDirection(prep: StudioPlanPrep, directionId: string): StudioPlanPrep {
    if (!prep.directions.some((direction) => direction.id === directionId)) return prep;
    if (prep.picked === directionId) {
        const { picked: _picked, ...rest } = prep;
        return rest;
    }
    return { ...prep, picked: directionId };
}

/** 卖家补充的答案合成一段文字：策划核对文案里的数字时，这里出现的数字也算有出处。 */
export function studioPrepFactsText(prep: StudioPlanPrep | undefined) {
    return studioAnsweredAsks(prep)
        .map((ask) => `${ask.question} ${studioAskAnswer(ask)}`)
        .join("\n");
}

/** 交给策划的卖家补充和选定方向；都没有时为空。 */
export function studioPrepPromptLines(prep: StudioPlanPrep | undefined, varyConcept = false, adjustment = false): string[] {
    const answered = studioAnsweredAsks(prep);
    const direction = studioPickedDirection(prep);
    const lines: string[] = [];
    if (answered.length) {
        lines.push("", "【卖家补充】（卖家在策划前回答的，当作已确认的信息，可以写进文案和画面；卖家没选的不算）", ...answered.map((ask) => `- ${ask.question}：${studioAskAnswer(ask)}`));
    }
    if (direction) {
        const example = [direction.headline ? `「${direction.headline}」` : "", direction.visual].filter(Boolean).join("，");
        const details = [
            `- 视角：${direction.angle}`,
            `- 定位：${direction.positioning}`,
            `- 创意主线：${direction.concept}`,
            direction.tone ? `- 调性：${direction.tone}（${STUDIO_DESIGN_TONES[direction.tone].label}）` : "",
            direction.palette.length ? `- 色彩世界：${direction.palette.map((color) => `${color.name} ${color.hex}`).join("、")}` : "",
            example ? `- 首屏示例：${example}` : "",
        ].filter(Boolean);
        lines.push(
            "",
            adjustment
                ? "【卖家选定的旧方向】（仅作背景。以本次补充调整为准：冲突的定位、创意主线、调性、色板、道具和首屏须重新设计；未要求改变的部分可以保留。商品事实始终不变，不能把旧场景或旧道具带入明确要求移除它们的新方案）"
                : varyConcept
                  ? "【卖家选定的方向】（保留视角、定位、调性和色板；创意主线与首屏是旧方案的示例。本次换方向策划须换一个具体场景、动作或摄影手法，不能再复用旧主线，只改标题不算新设计）"
                  : "【卖家选定的方向】（照这个方向策划：positioning、concept 照用，tone 用它给的编号，色彩世界以这几个颜色为准；首屏可以参考示例，但要写得更好）",
            ...details,
        );
    }
    return lines;
}
