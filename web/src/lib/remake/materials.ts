import { buildFillPrompt, extractStudioJson, parseFill } from "@/lib/ecommerce-studio/dossier-tasks";
import { studioFactUsable } from "@/lib/ecommerce-studio/types";
import { CREATIVE_SCENES, CREATIVE_TONES, type CreativeBrief } from "./creative";
import type { RemakeProduct } from "./job";

export type CreativeMaterialSuggestion = {
    name: string;
    sellingPoints: string;
    audience: string;
    objective: string;
    brand: string;
    note: string;
    tone?: CreativeBrief["tone"];
    questions: string[];
};

/** 复用商品档案的事实与证据规则；创作建议单独输出，不成为商品事实。 */
export function buildCreativeMaterialPrompt(product: RemakeProduct, brief: CreativeBrief) {
    return [
        buildFillPrompt({ photos: product.images.map(() => ({ view: "other" })), platformName: "短视频", sellerNotes: product.sellingPoints, title: product.name }),
        `本次内容用途：${CREATIVE_SCENES.find((scene) => scene.id === brief.scene)!.name}。参考图也可能是人物、场景或角色，请按实际主体识别，不把人物当商品，不猜真实身份。`,
        "在同一 JSON 增加 creative 字段，给出可修改的创作建议：audience（适合的观众），objective（希望观众做什么），brand（场景色调与光线），note（一个具体的拍摄想法），tone（下列风格之一）。每段不超过120字。",
        `tone 可选：${Object.keys(CREATIVE_TONES).join("、")}。`,
        "建议不是已验证事实。仅凭图片不能确认的材质、性能、使用效果、品牌、参数放入 questions，不写进可用卖点。保持附图主体外观，不虚构已有参考视频。",
    ].join("\n");
}

export function parseCreativeMaterialSuggestion(raw: string, model: string): CreativeMaterialSuggestion {
    let id = 0;
    const parsed = parseFill(raw, () => `material-${++id}`, model);
    if (!parsed.dossier.name) throw new Error("没有识别出主体名称，请换清晰图片或手动补充");
    const lines = parsed.sellingPoints.filter((point) => point.enabled).map((point) => [point.title, point.detail].filter(Boolean).join("："));
    if (!lines.length) lines.push(...parsed.dossier.facts.filter(studioFactUsable).map((fact) => `${fact.label}：${fact.value}`));
    const usable: string[] = [];
    for (const line of lines) {
        if ([...usable, line].join("\n").length <= 400) usable.push(line);
    }
    const data = extractStudioJson(raw);
    const creative = data.creative && typeof data.creative === "object" && !Array.isArray(data.creative) ? (data.creative as Record<string, unknown>) : {};
    const text = (key: string) => (typeof creative[key] === "string" ? (creative[key] as string).trim().slice(0, 300) : "");
    const tone = text("tone");
    return {
        name: parsed.dossier.name,
        sellingPoints: usable.join("\n"),
        audience: text("audience"),
        objective: text("objective"),
        brand: text("brand"),
        note: text("note"),
        ...(Object.hasOwn(CREATIVE_TONES, tone) ? { tone: tone as CreativeBrief["tone"] } : {}),
        questions: parsed.dossier.questions,
    };
}
