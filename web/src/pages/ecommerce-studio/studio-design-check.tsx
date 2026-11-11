import { Button } from "antd";
import { useState } from "react";
import { create } from "zustand";
import { ModelPicker } from "@/components/model-picker";
import { buildEcommerceAnalysisGeneration } from "@/lib/ecommerce/ecommerce-analysis-generation";
import { createClientUUID } from "@/lib/client-id";
import { buildStudioDesignCheckPrompt, parseStudioDesignCheck, STUDIO_DESIGN_CHECK_LABELS } from "@/lib/ecommerce-studio/design-check";
import { readStudioCheckSession, saveStudioCheckSession, type StudioCheckState } from "@/lib/ecommerce-studio/design-check-session";
import { studioReferencePhotos } from "@/lib/ecommerce-studio/prompt-compiler";
import type { StudioOutput, StudioProduct, StudioShot } from "@/lib/ecommerce-studio/types";
import { getActiveUserScope, scopedStorageKey } from "@/lib/user-scope";
import { parseBackendGenerationResult, runBackendGenerationTask } from "@/services/api/generation-task";
import { resourceStorageKey } from "@/services/api/resources";
import { isGenerationTaskTerminalError, waitForGenerationTask } from "@/services/api/task-center";
import { useEffectiveConfig } from "@/stores/use-config-store";
import { useStudioModel } from "./studio-parts";

// 关闭大图后仍跟踪同一个任务；查询失败只继续查询，不能再次扣费创建任务。
const useChecks = create<{ items: Record<string, StudioCheckState> }>(() => ({ items: {} }));

export function StudioArtworkCheck({ product, shot, output, onRevision }: { product: StudioProduct; shot: StudioShot; output: StudioOutput; onRevision: (revision: string) => void }) {
    const config = useEffectiveConfig();
    const { value: defaultModel, models } = useStudioModel("text");
    const [pickerOpen, setPickerOpen] = useState(false);
    const scope = getActiveUserScope();
    const [selection, setSelection] = useState(() => {
        try {
            return { scope, model: window.sessionStorage.getItem(scopedStorageKey("studio-check-model", scope)) || defaultModel };
        } catch {
            return { scope, model: defaultModel };
        }
    });
    const model = selection.scope === scope && models.includes(selection.model) ? selection.model : defaultModel;
    const execution = shot.attempts.find((attempt) => attempt.outputs.some((item) => item.resourceId === output.resourceId))?.input?.compiled;
    const prompt = buildStudioDesignCheckPrompt(product, shot, Boolean(studioReferencePhotos(product.photos, 1).length), execution);
    const key = JSON.stringify([scope, output.resourceId, model, prompt]);
    const live = useChecks((state) => state.items[key]);
    let restored: StudioCheckState | undefined, restoreError: string | undefined;
    try {
        restored = live ? undefined : readStudioCheckSession(scope, key);
    } catch (error) {
        restoreError = error instanceof Error ? error.message : "无法读取成品检查记录，请到任务中心核对";
    }
    const check = live || restored;
    const update = (patch: Partial<StudioCheckState>) => {
        const next = { ...(useChecks.getState().items[key] || restored), ...patch } as StudioCheckState;
        // 先更新内存以保留返回的 taskId；存储失败仍报错，不悄悄新建检查。
        useChecks.setState((state) => ({ items: { ...state.items, [key]: next } }));
        saveStudioCheckSession(scope, key, next);
    };
    const run = async () => {
        if (useChecks.getState().items[key]?.running) return;
        if (restoreError) return;
        const previous = useChecks.getState().items[key] || restored;
        const operationId = previous?.operationId || createClientUUID();
        let completed = false;
        try {
            update({ operationId, running: true, error: undefined });
            let text: string;
            if (previous?.taskId) {
                const done = await waitForGenerationTask(previous.taskId);
                text = parseBackendGenerationResult(done).text || "";
            } else {
                const truth = studioReferencePhotos(product.photos, 1);
                const references = [
                    { id: output.resourceId, name: "待检查成品.png", type: "image/png", dataUrl: "", storageKey: resourceStorageKey(output.resourceId) },
                    ...truth.map((photo) => ({ id: photo.id, name: photo.name || "商品实拍.png", type: "image/png", dataUrl: "", storageKey: resourceStorageKey(photo.resourceId) })),
                ];
                const generation = buildEcommerceAnalysisGeneration(config, model, { textCount: 0, imageCount: references.length, videoCount: 0, audioCount: 0, characterCount: 0 });
                const result = await runBackendGenerationTask({
                    mode: "text",
                    expectedUserScope: scope,
                    prompt,
                    config: generation,
                    referenceImages: references,
                    streamText: false,
                    clientOperationId: operationId,
                    metadata: { source: "ecommerce-studio", stage: "design-check", studioProductId: product.id, shotId: shot.id, resourceId: output.resourceId },
                    onTaskUpdate: (task) => update({ taskId: task.id }),
                });
                text = result.text || "";
            }
            completed = true;
            if (getActiveUserScope() !== scope) return;
            update({ result: parseStudioDesignCheck(text), running: false });
        } catch (error) {
            const patch = { running: false, error: error instanceof Error ? error.message : "AI 检查失败", ...(completed || isGenerationTaskTerminalError(error) ? { taskId: undefined, operationId: createClientUUID() } : {}) };
            useChecks.setState((state) => ({ items: { ...state.items, [key]: { ...state.items[key], ...patch } } }));
            try {
                saveStudioCheckSession(scope, key, useChecks.getState().items[key]);
            } catch {
                /* 保留内存里的原任务；下次提交仍必须成功保存同一个编号。 */
            }
        } finally {
            useChecks.setState((state) => ({ items: { ...state.items, [key]: { ...state.items[key], running: false } } }));
        }
    };
    return (
        <section className="es-artwork-check" aria-label="AI 成品检查">
            <div className="es-viewer-actions">
                <Button loading={check?.running} disabled={Boolean(check?.result || restoreError)} onClick={() => void run()}>
                    {check?.result ? "已检查这张图" : check?.running ? "正在检查成品" : check?.taskId ? "继续查询检查结果" : "AI 检查成品"}
                </Button>
                <Button type="text" size="small" onClick={() => setPickerOpen(!pickerOpen)}>
                    检查模型
                </Button>
            </div>
            {pickerOpen ? (
                <ModelPicker
                    config={config}
                    value={model}
                    onChange={(value) => {
                        setSelection({ scope, model: value });
                        try {
                            window.sessionStorage.setItem(scopedStorageKey("studio-check-model", scope), value);
                        } catch {
                            /* 检查任务本身仍须成功保存编号后才提交。 */
                        }
                    }}
                    capability="text"
                    requirements={{ capability: "text", input: { textCount: 0, imageCount: studioReferencePhotos(product.photos, 1).length + 1, videoCount: 0, audioCount: 0, characterCount: 0 } }}
                    variant="creation"
                    fullWidth
                    className="creation-model-picker es-model-picker"
                    showSelectedPrice={false}
                    showOptionPrices
                    placeholder="选择能看图的检查模型"
                />
            ) : null}
            {!check?.result ? <p className="es-viewer-meta">按所选看图模型计费。检查实际文字、图文位置与商品外观。</p> : null}
            {check?.error ? <p role="alert">{check.error}</p> : null}
            {restoreError ? <p role="alert">{restoreError}</p> : null}
            {check?.result ? (
                <>
                    {check.result.findings.map((finding) => (
                        <p key={finding.area}>
                            <strong>
                                {STUDIO_DESIGN_CHECK_LABELS[finding.area]} · {finding.status === "pass" ? "符合" : finding.status === "fail" ? "需调整" : "待核对"}
                            </strong>
                            <br />
                            {finding.evidence}
                        </p>
                    ))}
                    <details>
                        <summary>图内文字识别</summary>
                        <p>{check.result.observedText.join(" / ") || "未识别到可读文字"}</p>
                    </details>
                    {check.result.revision ? <Button onClick={() => onRevision(check.result!.revision)}>带入修正要求</Button> : null}
                    <p className="es-viewer-meta">AI 判断供复核，不代表平台审核通过。</p>
                </>
            ) : null}
        </section>
    );
}
