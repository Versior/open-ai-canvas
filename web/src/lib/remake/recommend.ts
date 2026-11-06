import type { RemakeRisk, RemakeTreatment } from "./job";

/**
 * 每镜的推荐做法。原则：结构可以借，内容要换成自己的。
 * - 画面上有他人品牌、Logo 或水印：重新拍，换元素很难把字完全抹掉。
 * - 其余镜头默认换元素：沿用原镜头的动作和运镜，把商品、人物、场景换成用户的；没有商品的空镜也重新生成一遍，
 *   不直接用原片像素。
 * - 保留原片要用户确认授权，系统不主动推荐。
 */
export function recommendRemakeShot({ risks }: { risks: readonly RemakeRisk[]; durationMs: number; analyzed: boolean }): RemakeTreatment {
    if (risks.includes("brand")) return "remake";
    return "replace";
}

/** 推荐理由，显示在分镜表里。 */
export function remakeRecommendReason(risks: readonly RemakeRisk[], treatment: RemakeTreatment) {
    if (treatment === "remake" && risks.includes("brand")) return "画面上有他人品牌，建议重新拍";
    if (treatment === "replace" && risks.includes("product")) return "镜头里有原商品，换成你的商品";
    if (treatment === "replace" && risks.includes("face")) return "有人露脸，换成你的模特";
    if (treatment === "replace") return "沿用动作和运镜，重新生成画面";
    return "";
}
