import { DEFAULT_ECOMMERCE_BRIEF } from "@/lib/ecommerce/ecommerce-capabilities";
import { buildEcommerceImageGeneration } from "@/lib/ecommerce/ecommerce-image-generation";
import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import type { AiConfig } from "@/stores/use-config-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import { studioImageRequest } from "./image-options";
import { compileStudioPrompt } from "./prompt-compiler";
import { studioPlanOf } from "./product";
import { studioRunOf } from "./runs";
import type { StudioAttempt, StudioGenerationSource, StudioPlanKind, StudioProduct, StudioRun, StudioShot, StudioTextMode } from "./types";

export type StudioShotRef = { runId: string } | { planKind: StudioPlanKind };
export type StudioLocatedShot = { shot: StudioShot; textMode: StudioTextMode; quality: string; resolution: string; fromForm: boolean; source?: StudioGenerationSource; suite?: StudioRun["suite"] };

export function locateStudioShot(product: StudioProduct, ref: StudioShotRef, shotId: string): StudioLocatedShot | undefined {
    if ("runId" in ref) {
        const run = studioRunOf(product, ref.runId);
        const shot = run?.shots.find((item) => item.id === shotId);
        return run && shot ? { shot, textMode: run.textMode, quality: run.quality, resolution: run.resolution || "", fromForm: true, source: run.source, suite: run.suite } : undefined;
    }
    const plan = studioPlanOf(product, ref.planKind);
    const shot = plan?.shots.find((item) => item.id === shotId);
    return plan && shot ? { shot, textMode: plan.textMode, quality: product.brief.quality, resolution: product.brief.resolution, fromForm: false } : undefined;
}

export function compileStudioShot(product: StudioProduct, located: StudioLocatedShot, model: string, config: AiConfig, revisionResourceId?: string) {
    const profile = modelCapabilityConfigFor(config, model).image;
    const source = located.source ? { ...product, ...located.source } : product;
    const brief = located.fromForm ? source.brief : { ...source.brief, shooting: "auto" as const, sameLayout: false };
    const compiled = compileStudioPrompt({
        product: source,
        textMode: located.textMode,
        shot: located.shot,
        model,
        maxChars: profile?.references.promptMaxChars,
        maxReferences: profile?.references.maxImages,
        revisionResourceId,
        brief,
        ...(located.suite ? { suite: located.suite } : {}),
    });
    return { profile, compiled };
}

export function studioImageInput(product: StudioProduct, located: StudioLocatedShot, model: string, config: AiConfig, revisionResourceId?: string): NonNullable<StudioAttempt["input"]> {
    const { profile, compiled } = compileStudioShot(product, located, model, config, revisionResourceId);
    if (!compiled.references.length) throw new Error("请先上传商品图，出图以它为外观依据");
    return structuredClone({ compiled, request: studioImageRequest(profile, located.quality, located.shot.ratio, located.resolution) });
}

export function studioImageInputCount(input: NonNullable<StudioAttempt["input"]>) {
    const compiled = input.compiled;
    return compiled.references.length + compiled.modelReferences.length + compiled.styleReferences.length + Number(Boolean(compiled.revisionReference)) + Number(Boolean(compiled.layoutGuide));
}

/** 报价与提交共用实际图像请求；配置仅在运行时解析，不进入商品快照。 */
export function buildStudioImageGeneration(config: AiConfig, model: string, input: NonNullable<StudioAttempt["input"]>, shotId: string) {
    if (!input.compiled.prompt.trim() || !input.compiled.references.some((photo) => photo.resourceId)) throw new Error("保存的生成输入不完整，请重新生成");
    const node = { id: `studio-${shotId}`, type: CanvasNodeType.Image, title: "", width: 0, height: 0, position: { x: 0, y: 0 }, metadata: { model } } as CanvasNodeData;
    const references = studioImageInputCount(input);
    return buildEcommerceImageGeneration({ ...config, systemPrompt: "" }, node, { ...DEFAULT_ECOMMERCE_BRIEF, ...input.request }, { textCount: 1, imageCount: references, referenceImageCount: references, videoCount: 0, audioCount: 0, characterCount: 0 })
        .config;
}
