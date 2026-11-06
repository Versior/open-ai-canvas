import { imageReferenceLabel } from "@/lib/image-reference-prompt";
import { seedanceReferenceLabel } from "@/lib/seedance-video";
import type { ProductVideoAudio, ProductVideoImage, ProductVideoInputs } from "./job";

// 元素替换的提示词：按「替换万物」的做法逐个绑定参考素材的角色（参考视频定动作、镜头、时间和声音，
// 商品图定商品外观，模特图定人物身份，背景图定环境），固定采用自然适配：保留原视频的动作、运镜和节奏，
// 新主体按自己的结构自然适配原动作。没给的那一类素材，原视频里的对应元素保持不变。

export type ProductVideoPromptImages = { images: ProductVideoImage[]; roles: ("product" | "model" | "background")[] };

/** 参考图的顺序就是提示词里的图号：商品图、模特图、背景图。 */
export function productVideoReferenceImages(inputs: Pick<ProductVideoInputs, "products" | "models" | "backgrounds">): ProductVideoPromptImages {
    const roles: ProductVideoPromptImages["roles"] = [...inputs.products.map(() => "product" as const), ...inputs.models.map(() => "model" as const), ...inputs.backgrounds.map(() => "background" as const)];
    return { images: [...inputs.products, ...inputs.models, ...inputs.backgrounds], roles };
}

function mentions(roles: ProductVideoPromptImages["roles"], role: ProductVideoPromptImages["roles"][number]) {
    return roles.flatMap((item, index) => (item === role ? [`@${imageReferenceLabel(index)}`] : [])).join("、");
}

const AUDIO_LINES: Record<ProductVideoAudio, string> = {
    original: "声音：成片会换回原视频的声音，这里只需要画面；人物的口型、动作节拍与原视频的对白和音乐节奏保持同步。",
    model: "声音：保留原视频的对白节奏、环境声和音乐风格，声音与新画面同步，不要重复的对白或音轨。",
    mute: "声音：不需要声音。",
};

export type ProductVideoShotPromptInput = Pick<ProductVideoInputs, "products" | "models" | "backgrounds" | "note" | "audio"> & {
    index: number;
    total: number;
    seconds: number;
    fix?: string;
};

export function buildProductVideoShotPrompt(input: ProductVideoShotPromptInput) {
    const { roles } = productVideoReferenceImages(input);
    const video = `@${seedanceReferenceLabel("video", 0)}`;
    const products = mentions(roles, "product");
    const models = mentions(roles, "model");
    const backgrounds = mentions(roles, "background");
    const lines = [
        `以${video}为动作、镜头和时间结构的基础，替换画面里的元素，生成一段约 ${input.seconds} 秒的视频，镜头顺序和节奏与${video}一致。`,
        "替换方式（自然适配）：",
        products
            ? `- 商品：把${video}里展示、手持或使用的商品换成${products}里的商品，保持商品的外形、结构、比例、材质、颜色、包装、文字和 Logo 与参考图一致；按原商品的位置、大小、朝向和手部接触关系出现，不要变形或多出商品。`
            : `- 商品：${video}里的商品保持原样。`,
        models ? `- 人物：把${video}里的人物换成${models}里的模特，保留模特的脸部、发型、服装和体型；动作、姿态、表情节奏和口型跟随原视频，按模特自己的体型自然适配。` : `- 人物：${video}里的人物保持原样。`,
        backgrounds ? `- 背景：把${video}里的环境换成${backgrounds}的场景，保持透视、光线方向、景深和地面关系与前景人物、商品一致，边缘自然融合。` : `- 背景：${video}里的环境保持原样。`,
        "保留原视频的动作、运镜、构图、剪辑节奏，以及人物与商品之间的遮挡、接触和空间关系；人物参考不改变背景，背景参考不改变人物，商品参考不改变手部动作。",
        "不添加字幕、文字、贴纸或水印。",
        AUDIO_LINES[input.audio],
    ];
    if (input.total > 1) lines.push(`这是整条视频的第 ${input.index} 段（共 ${input.total} 段），各段里的商品、人物和场景保持同一身份和外观。`);
    if (input.note.trim()) lines.push(`补充要求：${input.note.trim()}`);
    if (input.fix?.trim()) lines.push(`这一段重做，请重点修正：${input.fix.trim()}`);
    return lines.join("\n");
}

export type ProductVideoDifficulty = "低" | "中" | "高";

export type ProductVideoAssessment = { difficulty: ProductVideoDifficulty; summary: string; risks: string[] };

/**
 * 生成前的难度与预期：只按素材和设置能判断的风险提示，不拦截生成。
 * 替换的元素越多、分段越多、商品角度越少，越容易出现身份漂移、变形和段间不一致。
 */
export function assessProductVideo(inputs: Pick<ProductVideoInputs, "products" | "models" | "backgrounds" | "startMs" | "endMs">, segments: number): ProductVideoAssessment {
    const risks: string[] = [];
    const replaced = [inputs.products.length, inputs.models.length, inputs.backgrounds.length].filter(Boolean).length;
    if (inputs.products.length === 1) risks.push("只有一张商品图：商品转到侧面或背面时容易变形，建议补 2–3 个角度");
    if (inputs.products.length) risks.push("商品上的小字和 Logo 最容易走样，生成后重点检查");
    if (inputs.models.length) risks.push("换人时转头、口型、手部和衣服边缘可能不稳定，参考视频里人物越多越难");
    if (inputs.backgrounds.length) risks.push("换背景时人物边缘、遮挡和光线方向可能不自然");
    if (segments > 1) risks.push(`参考视频会分成 ${segments} 段分别生成再拼起来，段与段之间的人物和商品可能有细微差异`);
    const lengthSeconds = Math.max(0, inputs.endMs - inputs.startMs) / 1000;
    let score = replaced + (segments > 3 ? 1 : 0) + (inputs.products.length === 1 ? 1 : 0) + (lengthSeconds > 60 ? 1 : 0);
    if (inputs.models.length && inputs.backgrounds.length) score += 1;
    const difficulty: ProductVideoDifficulty = score <= 1 ? "低" : score <= 3 ? "中" : "高";
    const summary =
        difficulty === "低"
            ? "预计能较好保留原视频的动作和镜头，替换比较稳定。"
            : difficulty === "中"
              ? "可以生成，但局部可能闪烁、边缘不稳或细节变化，个别段可能需要重做。"
              : "可以尝试，但难以保证每一帧都稳定：可能出现身份漂移、商品变形或融合不自然，建议先生成一段预览。";
    return { difficulty, summary, risks };
}
