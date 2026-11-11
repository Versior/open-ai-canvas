import { imageReferenceLabel } from "@/lib/image-reference-prompt";
import type { RemakeJob } from "./job";

export function remakeContinuitySource(job: Pick<RemakeJob, "shots">) {
    return job.shots.find((shot) => shot.treatment !== "skip" && shot.keyframeResourceId && (shot.speaker || shot.risks.includes("face"))) || job.shots.find((shot) => shot.treatment !== "skip" && shot.keyframeResourceId);
}

/** 定妆图只绑定视觉资料，修改台词或配音不会要求重新定妆。 */
export function remakeContinuityInput(job: Pick<RemakeJob, "product" | "people" | "models" | "backgrounds" | "shots" | "source" | "note"> & Partial<Pick<RemakeJob, "replication">>) {
    return JSON.stringify([
        job.source?.resourceId,
        remakeContinuitySource(job)?.keyframeResourceId,
        job.product.name,
        job.product.images.map((image) => image.resourceId),
        job.people,
        job.people === "model" ? job.models.map((image) => [image.resourceId, image.role]) : [],
        job.backgrounds.map((image) => image.resourceId),
        job.note,
        ...(job.replication ? [job.replication.mode, job.replication.plan?.style, job.shots[0]?.director] : []),
    ]);
}

export function remakeContinuityImage(job: Pick<RemakeJob, "continuity" | "product" | "people" | "models" | "backgrounds" | "shots" | "source" | "note">) {
    return job.continuity?.confirmed && job.continuity.input === remakeContinuityInput(job) ? job.continuity.image : undefined;
}

export function remakeNeedsContinuity(job: Pick<RemakeJob, "source" | "people" | "shots" | "models">) {
    const generated = job.shots.filter((shot) => shot.treatment === "replace" || shot.treatment === "remake");
    return Boolean(job.source && job.people !== "none" && generated.some((shot) => shot.speaker || shot.risks.includes("face")) && (generated.length > 1 || job.models.some((image) => image.role === "face")));
}

/** 先编辑目标定妆画面，视频阶段只使用确认后的目标图，不再把旧商品/旧脸当身份参考。 */
export function remakeContinuityMaterials(job: RemakeJob) {
    const source = job.source && !job.replication ? remakeContinuitySource(job) : undefined;
    const models = job.people === "model" ? job.models.filter((image) => image.role !== "pose") : [];
    const images = [...(source ? [{ id: "source-frame", resourceId: source.keyframeResourceId, name: "原片构图" }] : []), ...job.product.images, ...models, ...job.backgrounds];
    const labels = (start: number, count: number) => Array.from({ length: count }, (_, index) => `@${imageReferenceLabel(start + index)}`).join("、");
    const offset = source ? 1 : 0;
    const product = labels(offset, job.product.images.length);
    const model = labels(offset + job.product.images.length, models.length);
    const background = labels(offset + job.product.images.length + models.length, job.backgrounds.length);
    const prompt = [
        "生成一张全片共用的摄影定妆与商品基准图。单幅画面，不要拼图。人物脸、发型、完整穿搭、手中商品与包装正面必须清楚。",
        source
            ? "@图片1仅提供机位、构图、人物与商品的空间关系、场景光线和色调。"
            : job.replication?.plan
              ? `按目标分镜定妆：${JSON.stringify(job.shots[0]?.director)}。全片风格：${JSON.stringify(job.replication.plan.style)}。不复制原片人物、商品与具体场景。`
              : "采用自然柔和的摄影布光。",
        product ? `将所有原商品替换成${product}的「${job.product.name || "目标商品"}」，外形、包装色块、材质、Logo和包装文字完全以商品图为准。不得混入原包装、凭空改色或增加商品。` : "不添加未指定的商品。",
        job.people === "none"
            ? "不出现人脸，只保留必要的手部。"
            : job.people === "original"
              ? "人物身份、发型、体型和穿搭沿用@图片1。"
              : `人物唯一身份来自${model}。${models.some((image) => image.role === "face") ? (job.replication ? "人脸图只决定长相；按目标分镜设计一套服装，完整画出作为全片唯一穿搭基准。" : "人脸图只决定长相；穿搭沿用原片同一套服装，清楚画出服装作为后续全片唯一穿搭基准。") : "保留模特图的脸、发型、体型和同一套服装。"}不要保留原片的人脸。`,
        background ? `环境改用${background}，光线与主体自然一致。` : job.replication ? "环境按目标分镜与全片风格设计，后续同场景共用此布光与布局。" : "环境沿用原片，不随意重布景。",
        "包装上已有的文字需要保留；画面不新增字幕、贴纸、水印或额外文字。",
        job.note ? `补充视觉要求：${job.note}` : "",
    ]
        .filter(Boolean)
        .join("\n");
    return { images, prompt };
}
