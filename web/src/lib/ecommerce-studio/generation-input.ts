import { DEFAULT_ECOMMERCE_BRIEF } from "@/lib/ecommerce/ecommerce-capabilities";
import { buildEcommerceImageGeneration } from "@/lib/ecommerce/ecommerce-image-generation";
import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import type { AiConfig } from "@/stores/use-config-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import { studioRunRatio } from "./brief";
import { studioImageRequest } from "./image-options";
import { compileStudioPrompt, type StudioCompiledPrompt } from "./prompt-compiler";
import { studioPlanOf } from "./product";
import { studioReferencePhotos } from "./reference-selection";
import { studioRunOf } from "./runs";
import type { StudioAttempt, StudioGenerationSource, StudioKnowledgeReceipt, StudioPlanKind, StudioProduct, StudioRun, StudioShot, StudioStylePresetId, StudioTextMode } from "./types";

export type StudioShotRef = { runId: string } | { planKind: StudioPlanKind };
export type StudioLocatedShot = {
    shot: StudioShot;
    pageKind?: StudioPlanKind | "single";
    textMode: StudioTextMode;
    quality: string;
    resolution: string;
    fromForm: boolean;
    styleId?: StudioStylePresetId;
    source?: StudioGenerationSource;
    suite?: StudioRun["suite"];
    knowledgeReceipt?: StudioKnowledgeReceipt;
    candidate?: { index: number; count: number };
};

export function studioImageSetupBlock(product: Pick<StudioProduct, "photos">, model: string) {
    if (!product.photos.length) return "先上传商品图";
    if (!studioReferencePhotos(product.photos, 1).length) return "至少点亮一张商品图的星标，出图以它为外观依据";
    return model ? "" : "先选择图片模型";
}

function studioTaskMetadataText(value: unknown, max = 240) {
    if (typeof value !== "string") return "";
    return value.replace(/\s+/g, " ").trim().slice(0, max);
}

/**
 * 图片任务的最小页面上下文。商品图片和已编译 prompt 仍是事实来源，
 * 这些字段只让服务端在 worker 里选择对应的视觉知识，不携带固定版式或成品文案。
 */
export function studioImageTaskMetadata(product: StudioProduct, located: StudioLocatedShot, compiled: StudioCompiledPrompt) {
    const source = located.source ? { ...product, ...located.source } : product;
    const category = studioTaskMetadataText(source.brief.productType || source.dossier?.category, 80);
    const productName = studioTaskMetadataText(source.name || source.dossier?.name, 120);
    const materials = (source.dossier?.facts || [])
        .filter((fact) => ["material", "appearance", "structure"].includes(fact.group) && ["visible", "confirmed"].includes(fact.evidence))
        .map((fact) => `${fact.label} ${fact.value}`)
        .join("；");
    const metadata: Record<string, unknown> = {
        source: "ecommerce-studio",
        studioStep: "image",
        studioPlatform: source.platform,
        ...(productName ? { studioProductName: productName } : {}),
        ...(category ? { studioCategory: category } : {}),
        ...(source.dossier?.family ? { studioFamily: source.dossier.family } : {}),
        ...(materials ? { studioMaterials: studioTaskMetadataText(materials, 240) } : {}),
        ...(located.pageKind ? { studioPlanKind: located.pageKind } : {}),
        ...(typeof located.shot.screenIndex === "number" ? { studioScreenIndex: located.shot.screenIndex } : {}),
        ...(typeof located.shot.screenCount === "number" ? { studioScreenCount: located.shot.screenCount } : {}),
        ...(compiled.studioDetailContract !== undefined ? { studioDetailContract: compiled.studioDetailContract } : {}),
        ...(compiled.useDesignKnowledge ? { studioUseDesignKnowledge: true } : {}),
    };
    const detail = located.pageKind === "detail";
    if (detail) {
        const fields: [string, unknown, number][] = [
            ["studioPurchaseQuestion", located.shot.purchaseQuestion, 320],
            ["studioDisplayContent", located.shot.displayContent, 420],
            ["studioVisualFocus", located.shot.visualFocus, 240],
            ["studioVisualBeat", located.shot.visualBeat, 240],
        ];
        for (const [key, value, max] of fields) {
            const text = studioTaskMetadataText(value, max);
            if (text) metadata[key] = text;
        }
    }
    return metadata;
}

export function studioLocateRunShot(run: StudioRun, index: number): StudioLocatedShot {
    const shot = run.shots[index];
    const pageKind = run.type === "detail-set" ? "detail" : run.type === "main-set" ? "main" : run.type === "template-set" ? run.kind || run.source?.brief.suite?.kind || "detail" : "single";
    const candidates = pageKind === "single" ? run.shots.filter(({ role }) => role === shot.role) : [];
    return {
        shot: pageKind === "single" ? shot : { ...shot, screenIndex: index + 1, screenCount: run.shots.length },
        pageKind,
        ...(candidates.length > 1 ? { candidate: { index: candidates.indexOf(shot) + 1, count: candidates.length } } : {}),
        textMode: run.textMode,
        quality: run.quality,
        resolution: run.resolution || "",
        fromForm: true,
        styleId: run.styleId,
        source: run.source,
        suite: run.suite,
        knowledgeReceipt: run.suite?.knowledgeReceipt,
    };
}

export function locateStudioShot(product: StudioProduct, ref: StudioShotRef, shotId: string): StudioLocatedShot | undefined {
    if ("runId" in ref) {
        const run = studioRunOf(product, ref.runId);
        const index = run?.shots.findIndex((item) => item.id === shotId) ?? -1;
        return run && index >= 0 ? studioLocateRunShot(run, index) : undefined;
    }
    const plan = studioPlanOf(product, ref.planKind);
    const index = plan?.shots.findIndex((item) => item.id === shotId) ?? -1;
    if (!plan || index < 0) return undefined;
    return {
        shot: { ...plan.shots[index], screenIndex: index + 1, screenCount: plan.shots.length },
        pageKind: plan.kind,
        textMode: plan.textMode,
        quality: product.brief.quality,
        resolution: product.brief.resolution,
        fromForm: false,
        styleId: plan.styleId,
    };
}

export function compileStudioShot(product: StudioProduct, located: StudioLocatedShot, model: string, config: AiConfig, revisionResourceId?: string) {
    const profile = modelCapabilityConfigFor(config, model).image;
    const source = located.source ? { ...product, ...located.source } : product;
    const brief = located.fromForm ? source.brief : { ...source.brief, shooting: "auto" as const, sameLayout: false };
    const ratio = located.pageKind === "detail" && brief.outputType === "detail-set" ? studioRunRatio(located.shot.role, { ...source, brief }) : located.shot.aspectRatio || located.shot.ratio;
    const request = studioImageRequest(profile, located.quality, ratio, located.resolution);
    const compiled = compileStudioPrompt({
        product: source,
        textMode: located.textMode,
        shot: request.aspectRatio && request.aspectRatio !== located.shot.ratio ? { ...located.shot, ratio: request.aspectRatio } : located.shot,
        pageKind: located.pageKind,
        candidate: located.candidate,
        model,
        maxChars: profile?.references.promptMaxChars,
        maxReferences: profile?.references.maxImages,
        revisionResourceId,
        brief,
        styleId: located.styleId,
        ...(located.suite ? { suite: located.suite } : {}),
    });
    return { profile, compiled, request };
}

export function studioImageInput(product: StudioProduct, located: StudioLocatedShot, model: string, config: AiConfig, revisionResourceId?: string): NonNullable<StudioAttempt["input"]> {
    const { request, compiled } = compileStudioShot(product, located, model, config, revisionResourceId);
    if (!compiled.references.length) throw new Error("请先上传商品图，出图以它为外观依据");
    return structuredClone({ compiled, request });
}

export function studioImageInputCount(input: NonNullable<StudioAttempt["input"]>) {
    const compiled = input.compiled;
    return compiled.references.length + compiled.modelReferences.length + compiled.styleReferences.length + Number(Boolean(compiled.revisionReference)) + Number(Boolean(compiled.layoutGuide));
}

export type StudioImageReferenceSummary = {
    total: number;
    product: number;
    model: number;
    style: number;
    revision: number;
    layoutGuide: number;
    names: string[];
    notice?: string;
};

/**
 * 生成前展示图片模型真正会收到的参考图，不把上传数量当成请求数量。
 * layoutGuide 尚未上传时也要计入，因为提交阶段会先生成并追加这张蓝图。
 */
export function studioImageReferenceSummary(input: NonNullable<StudioAttempt["input"]>): StudioImageReferenceSummary {
    const { compiled } = input;
    const references = [...compiled.references, ...compiled.modelReferences, ...compiled.styleReferences];
    const names = references.map((photo) => photo.name?.trim() || "未命名参考图");
    if (compiled.revisionReference) names.push(compiled.revisionReference.name?.trim() || "待修正成品");
    if (compiled.layoutGuide) names.push(compiled.layoutGuide.proof ? "定稿排版蓝图" : "图文区域蓝图");
    return {
        total: studioImageInputCount(input),
        product: compiled.references.length,
        model: compiled.modelReferences.length,
        style: compiled.styleReferences.length,
        revision: Number(Boolean(compiled.revisionReference)),
        layoutGuide: Number(Boolean(compiled.layoutGuide)),
        names,
        ...(compiled.referenceNotice ? { notice: compiled.referenceNotice } : {}),
    };
}

/** 报价与提交共用实际图像请求；配置仅在运行时解析，不进入商品快照。 */
export function buildStudioImageGeneration(config: AiConfig, model: string, input: NonNullable<StudioAttempt["input"]>, shotId: string) {
    if (!input.compiled.prompt.trim() || !input.compiled.references.some((photo) => photo.resourceId)) throw new Error("保存的生成输入不完整，请重新生成");
    const node = { id: `studio-${shotId}`, type: CanvasNodeType.Image, title: "", width: 0, height: 0, position: { x: 0, y: 0 }, metadata: { model } } as CanvasNodeData;
    const references = studioImageInputCount(input);
    return buildEcommerceImageGeneration({ ...config, systemPrompt: "" }, node, { ...DEFAULT_ECOMMERCE_BRIEF, ...input.request }, { textCount: 1, imageCount: references, referenceImageCount: references, videoCount: 0, audioCount: 0, characterCount: 0 })
        .config;
}
