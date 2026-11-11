import { App, Button } from "antd";
import { useMemo, useState } from "react";
import { GenerationCostNotice } from "@/components/generation-cost-notice";
import { ModelPicker } from "@/components/model-picker";
import { DEFAULT_ECOMMERCE_BRIEF } from "@/lib/ecommerce/ecommerce-capabilities";
import { buildEcommerceImageGeneration } from "@/lib/ecommerce/ecommerce-image-generation";
import { studioImageRequest, STUDIO_PREFERRED_TIER } from "@/lib/ecommerce-studio/image-options";
import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import { remakeContinuityImage, remakeContinuityInput, remakeContinuityMaterials, remakeNeedsContinuity } from "@/lib/remake/continuity";
import type { RemakeJob } from "@/lib/remake/job";
import { getActiveUserScope } from "@/lib/user-scope";
import { parseBackendGenerationResult, submitBackendGenerationTask } from "@/services/api/generation-task";
import { resourceIdFromStorageKey, resourceStorageKey } from "@/services/api/resources";
import { queryGenerationTask, waitForGenerationTask } from "@/services/api/task-center";
import { selectableModelsByCapability, type AiConfig } from "@/stores/use-config-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import { productVideoThumbUrl } from "../replace/product-video-assets";
import { readRemake, updateRemake } from "../replace/use-product-video-store";

export function remakeContinuityGeneration(job: RemakeJob, config: AiConfig, model: string) {
    const { images, prompt } = remakeContinuityMaterials(job);
    const profile = modelCapabilityConfigFor(config, model).image;
    if (!profile) throw new Error("请选择图片模型");
    const request = studioImageRequest(profile, STUDIO_PREFERRED_TIER, job.source && job.source.width > job.source.height ? "4:3" : "3:4");
    const input = { textCount: 1, imageCount: images.length, referenceImageCount: images.length, videoCount: 0, audioCount: 0, characterCount: 0 };
    const node = { id: "remake-continuity", type: CanvasNodeType.Image, title: "", width: 0, height: 0, position: { x: 0, y: 0 }, metadata: { model } } as unknown as CanvasNodeData;
    const generation = buildEcommerceImageGeneration(config, node, { ...DEFAULT_ECOMMERCE_BRIEF, ...(request.aspectRatio ? { aspectRatio: request.aspectRatio } : {}), imageSettings: request.imageSettings }, input);
    return { images, prompt, config: generation.config, requirements: { capability: "image" as const, input, imageSize: generation.config.size } };
}

/** 定妆任务先持久化幂等键；中断后查询原任务，不重复收费。 */
async function generateContinuity(id: string, config: AiConfig, model: string) {
    const scope = getActiveUserScope();
    const assertScope = () => {
        if (getActiveUserScope() !== scope) throw new Error("账号已切换");
    };
    const job = readRemake(id);
    if (!job) throw new Error("作品不存在");
    const input = remakeContinuityInput(job);
    const previous = job.continuity;
    if (previous?.taskId && (previous.input !== input || previous.model !== model)) throw new Error("上一张定妆图还没有确认结束，请先恢复原任务");
    const request = remakeContinuityGeneration(job, config, model);
    const state: NonNullable<RemakeJob["continuity"]> = previous && !previous.image && previous.input === input && previous.model === model ? previous : { input, model, attempt: (previous?.attempt || 0) + 1, confirmed: false };
    await updateRemake(id, (value) => {
        if (remakeContinuityInput(value) !== input) throw new Error("素材已在另一窗口修改，请重新核对");
        return { ...value, continuity: state };
    });
    assertScope();
    let task = state.taskId ? await queryGenerationTask(state.taskId) : undefined;
    assertScope();
    if (task && (task.status === "failed" || task.status === "cancelled")) {
        await updateRemake(id, (value) => ({ ...value, continuity: { ...state, taskId: undefined, attempt: state.attempt + 1 } }));
        throw new Error(task.error || "定妆任务已停止，可以重新生成");
    }
    if (!task) {
        task = await submitBackendGenerationTask({
            mode: "image",
            expectedUserScope: scope,
            prompt: request.prompt,
            config: request.config,
            referenceImages: request.images.map((image) => ({ id: image.id, name: image.name || "参考图", type: "image/png", dataUrl: "", storageKey: resourceStorageKey(image.resourceId) })),
            clientOperationId: `${id}-continuity-${state.attempt}`,
            metadata: { source: "video-remake-continuity", remakeId: id },
        });
        assertScope();
        await updateRemake(id, (value) => ({ ...value, continuity: { ...state, taskId: task!.id } }));
    }
    const done = await waitForGenerationTask(task.id, { initialTask: task, timeoutMs: 10 * 60_000 });
    assertScope();
    const image = parseBackendGenerationResult(done).images?.[0];
    const resourceId = resourceIdFromStorageKey(image?.storageKey);
    if (!resourceId) throw new Error("定妆任务没有返回可用图片，请到任务中心核对");
    await updateRemake(id, (value) => ({ ...value, continuity: { ...state, taskId: undefined, confirmed: false, image: { id: "target-continuity", resourceId, name: "全片目标定妆", width: image?.width, height: image?.height } } }));
}

export function RemakeContinuityCard({ job, config, disabled, flush, onBusyChange }: { job: RemakeJob; config: AiConfig; disabled?: boolean; flush: () => Promise<void>; onBusyChange: (busy: boolean) => void }) {
    const { message } = App.useApp();
    const models = useMemo(() => selectableModelsByCapability(config, "image"), [config]);
    const [model, setModel] = useState(() => job.continuity?.model || (models.includes(config.imageModel) ? config.imageModel : models[0] || ""));
    const [busy, setBusy] = useState(false);
    const generation = useMemo(() => {
        try {
            return model ? { request: remakeContinuityGeneration(job, config, model), error: "" } : { error: "请选择图片模型" };
        } catch (error) {
            return { error: error instanceof Error ? error.message : "当前图片模型不可用" };
        }
    }, [config, job, model]);
    const confirmed = Boolean(remakeContinuityImage(job));
    const current = job.continuity?.input === remakeContinuityInput(job);
    const canGenerate = Boolean(job.product.images.length && (job.people !== "model" || job.models.some((image) => image.role !== "pose")));
    const perform = async (action: () => Promise<void>) => {
        setBusy(true);
        onBusyChange(true);
        try {
            await flush();
            await action();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "定妆失败");
        } finally {
            setBusy(false);
            onBusyChange(false);
        }
    };
    return (
        <section className="rw-card rw-continuity">
            <header className="rw-card-head">
                <h3>全片定妆</h3>
                <span>{confirmed ? "已固定" : remakeNeedsContinuity(job) ? "生成视频前确认" : "推荐先预览"}</span>
            </header>
            <p className="rw-hint">先看目标模特、穿搭和商品是否正确。这张图会供各段共同参考；换商品、模特或背景后需要重新确认。</p>
            {job.continuity?.image ? <img className="rw-continuity-preview" src={productVideoThumbUrl(job.continuity.image.resourceId)} alt="目标人物、穿搭和商品定妆预览" /> : null}
            {job.continuity?.image && !current ? <p className="rw-warn">素材已变化，这张旧定妆图不会提交给视频模型。</p> : null}
            <ModelPicker config={config} capability="image" value={model} onChange={setModel} fullWidth showOptionPrices showSelectedPrice={false} modelDisabledReason={() => (busy || disabled ? "正在处理" : "")} />
            {generation.error ? <p className="rw-hint">{generation.error}</p> : null}
            {generation.request ? <GenerationCostNotice config={generation.request.config} model={model} capability="image" requirements={generation.request.requirements} label="全片定妆图" /> : null}
            <div className="rw-inspector-actions">
                <Button loading={busy} disabled={disabled || !canGenerate || Boolean(generation.error)} onClick={() => void perform(() => generateContinuity(job.id, config, model))}>
                    {job.continuity?.taskId ? "恢复定妆任务" : job.continuity?.image ? "重做定妆" : "生成定妆预览"}
                </Button>
                <Button
                    disabled={disabled || busy || !current || !job.continuity?.image || confirmed}
                    onClick={() =>
                        void perform(() =>
                            updateRemake(job.id, (value) => {
                                if (!value.continuity?.image || value.continuity.input !== remakeContinuityInput(value)) throw new Error("定妆图与当前素材不一致");
                                return { ...value, continuity: { ...value.continuity, confirmed: true } };
                            }).then(() => undefined),
                        )
                    }
                >
                    {confirmed ? "已确认" : "人物和商品正确"}
                </Button>
            </div>
        </section>
    );
}
