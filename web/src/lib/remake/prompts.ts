import { jsonCandidates } from "@/lib/canvas/video-teardown";
import { replicaDirectionDescription, replicaCampaignPrompt } from "@/lib/canvas/replica-director";
import { imageReferenceLabel } from "@/lib/image-reference-prompt";
import type { ProductVideoImage } from "@/lib/product-video/job";
import { seedanceReferenceLabel } from "@/lib/seedance-video";
import { remakeLanguage, type RemakeJob, type RemakeLanguage, type RemakeShot, type RemakeUnit } from "./job";

// 复刻工作台的提示词：生成单元的视频提示词（换元素 / 重新拍）和改写口播的文本提示词。
// 参考图按角色绑定：商品图定商品、模特图定人物、背景图定场景；换元素时参考视频定动作、运镜和节奏。
// 结构可以借，内容要换：不出现原片的品牌、Logo、水印和原话。

/**
 * 每镜新口播的字数上限：按语言每秒能说的字符数（中文约 4 字/秒，英语约 14 个字母/秒）乘镜头时长，
 * 说话镜头要对口型、配音要放得下，宁短勿长。
 */
export function remakeDialogueBudget(shot: Pick<RemakeShot, "startMs" | "endMs">, language: RemakeLanguage = "zh") {
    const { cps } = remakeLanguage(language);
    return Math.max(0, Math.floor(((shot.endMs - shot.startMs) / 1000) * cps));
}

export type RemakeReferenceImages = { images: ProductVideoImage[]; product: string; model: string; background: string };

/** 参考图的顺序就是提示词里的图号：商品图、模特图（选了换模特时）、背景图。 */
export function remakeReferenceImages(job: Pick<RemakeJob, "product" | "people" | "models" | "backgrounds">): RemakeReferenceImages {
    const models = job.people === "model" ? job.models : [];
    const images = [...job.product.images, ...models, ...job.backgrounds];
    const label = (offset: number, length: number) => Array.from({ length }, (_, index) => `@${imageReferenceLabel(offset + index)}`).join("、");
    return {
        images,
        product: label(0, job.product.images.length),
        model: label(job.product.images.length, models.length),
        background: label(job.product.images.length + models.length, job.backgrounds.length),
    };
}

function productLine(job: Pick<RemakeJob, "product">, refs: RemakeReferenceImages) {
    const name = job.product.name.trim();
    const named = name ? `「${name}」` : "";
    return refs.product ? `商品：画面里的商品一律是${refs.product}里的${named || "商品"}，外形、结构、比例、材质、颜色、包装和文字以参考图为准，不要画成别的商品，也不要多出商品。` : "";
}

function peopleLine(job: Pick<RemakeJob, "people">, refs: RemakeReferenceImages, video: string) {
    if (job.people === "none") return "人物：画面里不出现人物的脸，需要时只出现手。";
    if (job.people === "model" && refs.model) return `人物：出镜的人换成${refs.model}里的模特，保留模特的脸、发型、服装和体型${video ? `，动作、姿态和表情节奏跟随${video}` : ""}。`;
    if (job.people === "original") return video ? `人物：保留${video}里的人物。` : "";
    return video ? `人物：${video}里的人物换成一位外观不同的普通人，不要还原原片人物的长相。` : "人物：如果需要出镜，用一位外观普通的人，不要模仿任何真人。";
}

function speechLines(job: Pick<RemakeJob, "audio" | "language">, shots: readonly RemakeShot[]) {
    if (job.audio === "original") return ["声音：成片会换回原视频的声音，这里只要画面；人物口型和动作节拍跟原视频保持同步。"];
    if (job.audio === "mute") return ["声音：不要人声和旁白，只保留轻微的环境声。"];
    if (job.audio === "voice") return ["声音：不要人声和旁白（成片会另配旁白配音），只保留轻微的环境声；出镜的人可以做讲解的表情和手势，嘴部动作自然，不必对口型。"];
    const spoken = shots.filter((shot) => shot.dialogue.trim());
    if (!spoken.length) return ["声音：这一段没有台词，只要环境声，不要人声。"];
    const { speech } = remakeLanguage(job.language);
    return [`台词（${speech}，语速自然，只说这些话，不要加词）：`, ...spoken.map((shot) => `- 镜头 ${shot.index}：${shot.speaker ? "人物对着镜头说" : "画外音旁白"}「${shot.dialogue.trim()}」`), "说话镜头的口型和台词同步；没有台词的镜头只要环境声。"];
}

function shotSeconds(shot: Pick<RemakeShot, "startMs" | "endMs">) {
    return ((shot.endMs - shot.startMs) / 1000).toFixed(1).replace(/\.0$/, "");
}

/** 一个生成单元的视频提示词。shots 是这个单元覆盖的镜头（按顺序）。 */
export function buildRemakeUnitPrompt(job: RemakeJob, unit: RemakeUnit, shots: readonly RemakeShot[], seconds: number) {
    const refs = remakeReferenceImages(job);
    const video = unit.treatment === "replace" ? `@${seedanceReferenceLabel("video", 0)}` : "";
    const background = refs.background ? `场景：环境换成${refs.background}的场景，透视、光线方向和地面关系与前景一致。` : video ? `场景：保留${video}的环境布局，但不要出现原片的品牌、招牌和店铺名。` : "";
    const lines: string[] =
        unit.treatment === "replace"
            ? [`以${video}为动作、镜头和时间结构的基础，替换画面里的元素，生成一段约 ${seconds} 秒的视频，镜头顺序、切换点和节奏与${video}一致。`, "替换方式（自然适配：新主体按自己的结构自然套进原动作）："]
            : [`生成一段约 ${seconds} 秒的带货短视频，共 ${shots.length} 个镜头，按下面的分镜依次硬切：`, ...shots.map((shot) => `- 镜头 ${shot.index}（约 ${shotSeconds(shot)} 秒）：${remakeShotDescription(shot)}`), "素材要求："];
    lines.push(...[productLine(job, refs), peopleLine(job, refs, video), background].filter(Boolean).map((line) => `- ${line}`));
    if (unit.treatment === "replace") lines.push("保留原视频的动作、运镜、构图和剪辑节奏，以及人物与商品之间的遮挡、接触和空间关系；人物参考不改变背景，背景参考不改变人物，商品参考不改变手部动作。");
    if (job.campaign) {
        if (unit.treatment === "remake") {
            lines.push(replicaCampaignPrompt(job.campaign));
            const selected = job.directorPlans?.find((plan) => plan.id === job.activeDirectorPlanId);
            if (selected) lines.push(`已选全片策划：${JSON.stringify(selected.strategy)}。本单元只执行上述镜头，不重新生成整套剧情；声音意图服从下面的口播模式。`);
        } else lines.push(`全片连续性：${job.campaign.continuity}。换元素保持原镜头动作与机位，不新增剧情。`);
    }
    lines.push("不要出现原片的品牌名、Logo、店铺名、水印和贴纸；不添加字幕或文字。");
    lines.push(...speechLines(job, shots));
    if (job.note.trim()) lines.push(`补充要求：${job.note.trim()}`);
    if (unit.fix?.trim()) lines.push(`这一段重做，请重点修正：${unit.fix.trim()}`);
    return lines.join("\n");
}

/** 重新拍时一镜的画面描述：景别、机位、画面和运镜，原片商品换成「我的商品」。 */
export function remakeShotDescription(shot: Pick<RemakeShot, "plot" | "motion" | "camera" | "shotSize" | "director">) {
    const d = shot.director;
    if (d?.action) return replicaDirectionDescription(d);
    const parts = [shot.shotSize, shot.camera, shot.plot, shot.motion].map((item) => item.trim()).filter(Boolean);
    return parts.length ? parts.join("；") : "展示商品的近景镜头";
}

// ---------- 改写口播 ----------

export function buildRemakeDialoguePrompt(job: Pick<RemakeJob, "product" | "shots" | "sourceSummary" | "note" | "language" | "campaign">) {
    const shots = job.shots.filter((shot) => shot.treatment !== "skip");
    const language = remakeLanguage(job.language);
    const lines = [
        "你是带货短视频的口播编剧。下面是一条爆款视频逐镜头的原口播和画面。请保留它的节奏和说服结构（开头怎么抓人、痛点、卖点、证明、行动号召），把内容改写成我的商品。",
        "",
        `我的商品：${job.product.name.trim() || "（没有填名称，按商品图理解）"}`,
        `卖点：${job.product.sellingPoints.trim() || "（没有填写，只写看得出的、不夸大的卖点）"}`,
        ...(job.campaign ? [replicaCampaignPrompt(job.campaign)] : []),
        job.sourceSummary.product ? `原片卖的是：${job.sourceSummary.product}` : "",
        job.sourceSummary.hook ? `原片的开头钩子：${job.sourceSummary.hook}` : "",
        job.note.trim() ? `补充要求：${job.note.trim()}` : "",
        "",
        "逐镜头：",
        ...shots.map(
            (shot) =>
                `- 镜头 ${shot.index}｜${shotSeconds(shot)} 秒｜最多 ${remakeDialogueBudget(shot, job.language)} 个${language.value === "zh" ? "字" : "字符"}｜${shot.speaker ? "有人对着镜头说话" : "旁白或无人说话"}｜原口播：${shot.originalDialogue.trim() || "（无）"}｜画面：${shot.plot.trim() || "（无）"}`,
        ),
        "",
        "要求：",
        `1. 新口播一律用${language.speech}写${language.value === "zh" ? "" : "（面向当地观众的自然口语，不是逐字翻译）"}；每个镜头不能超过标注的${language.value === "zh" ? "字数" : "字符数（含空格和标点）"}，原片这一镜没有口播的，新口播也写空字符串。`,
        "2. 不要出现原片的品牌、店铺、人名和原话，不要照抄原句；不要夸大功效，不写价格和极限词（最、第一、100%）。",
        "3. 口语化、短句，像真人说话；开头一镜要有让人停下来的钩子。",
        "4. 只输出一个 JSON 对象，不要 Markdown 代码块，不要解释：",
        '{ "lines": [{ "shotNumber": 1, "dialogue": "新口播" }] }',
    ];
    return lines.filter((line, index, all) => line || all[index - 1]).join("\n");
}

/** 不截断口播；缺镜头或超时长均报错，避免把句子和卖点切坏。 */
export function parseRemakeDialogue(text: string, shots: readonly Pick<RemakeShot, "index" | "startMs" | "endMs">[], language: RemakeLanguage = "zh") {
    const expected = new Map(shots.map((shot) => [shot.index, shot]));
    for (const candidate of jsonCandidates(text)) {
        if (!Array.isArray(candidate.lines)) continue;
        const result = new Map<number, string>();
        let overBudget = false;
        for (const item of candidate.lines) {
            if (!item || typeof item !== "object") continue;
            const recordItem = item as Record<string, unknown>;
            const index = Number(recordItem.shotNumber);
            const shot = expected.get(index);
            if (!shot || result.has(index)) continue;
            const dialogue = typeof recordItem.dialogue === "string" ? recordItem.dialogue.trim() : "";
            if (Array.from(dialogue.replace(/\s/g, "")).length > remakeDialogueBudget(shot, language)) {
                overBudget = true;
                break;
            }
            result.set(index, dialogue);
        }
        if (!overBudget && result.size === expected.size) return result;
    }
    throw new Error("模型没有返回完整且符合镜头时长的改写口播，请缩短口播要求后重试");
}
