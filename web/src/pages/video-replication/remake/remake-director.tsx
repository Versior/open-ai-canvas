import { Button, Select } from "antd";
import { useEffect, useRef, useState } from "react";
import { ModelPicker } from "@/components/model-picker";
import { buildGenerationConfig } from "@/lib/canvas/canvas-project-generation";
import { videoTeardownTextRequirements } from "@/lib/canvas/video-teardown";
import { applyRemakeDirectorPlan, buildRemakeDirectorPrompt, parseRemakeDirectorPlans, remakeDirectorInput } from "@/lib/remake/director-plan";
import type { RemakeJob } from "@/lib/remake/job";
import { getActiveUserScope } from "@/lib/user-scope";
import { runBackendGenerationTask } from "@/services/api/generation-task";
import { resourceStorageKey } from "@/services/api/resources";
import type { AiConfig } from "@/stores/use-config-store";
import { ReplicaStrategyView } from "../replication-director";
import { replicaScriptImageCount, replicaScriptModelError } from "../replication-script";
import type { RemakeEdit } from "./remake-recipe";

export function RemakeDirectorPlanner({ job, config, edit, disabled, onBusyChange }: { job: RemakeJob; config: AiConfig; edit: RemakeEdit; disabled?: boolean; onBusyChange: (busy: boolean) => void }) {
    const [model, setModel] = useState(config.textModel);
    const [count, setCount] = useState(2);
    const [running, setRunning] = useState(false);
    const [error, setError] = useState("");
    const controller = useRef<AbortController | null>(null);
    useEffect(
        () => () => {
            controller.current?.abort();
            onBusyChange(false);
        },
        [onBusyChange],
    );
    const problem =
        replicaScriptModelError(config, model) ||
        (!job.product.name && !job.product.sellingPoints ? "先填写商品名称和可证明的卖点" : !job.shots.some((shot) => shot.treatment === "replace" || shot.treatment === "remake") ? "至少保留一个换元素或重拍镜头" : "");
    const input = remakeDirectorInput(job);
    const activePlan = job.directorPlans?.find((plan) => plan.id === job.activeDirectorPlanId);
    const requestedCount = activePlan ? 2 : count;
    const imageCount = replicaScriptImageCount(config, model, job.product.images.length);
    const run = async () => {
        if (disabled || running || problem) return;
        const account = getActiveUserScope();
        const current = new AbortController();
        controller.current = current;
        setRunning(true);
        onBusyChange(true);
        setError("");
        try {
            const requirements = videoTeardownTextRequirements(config, imageCount);
            const result = await runBackendGenerationTask({
                mode: "text",
                prompt: buildRemakeDirectorPrompt(job, requestedCount, imageCount),
                config: { ...buildGenerationConfig(config, undefined, "text", requirements), model },
                referenceImages: job.product.images
                    .slice(0, imageCount)
                    .map((image) => ({ id: image.id, name: image.name || "商品实拍", type: "image/png", dataUrl: "", storageKey: resourceStorageKey(image.resourceId), width: image.width, height: image.height })),
                streamText: false,
                signal: current.signal,
                expectedUserScope: account,
            });
            if (current.signal.aborted || account !== getActiveUserScope()) return;
            const plans = parseRemakeDirectorPlans(result.text || "", job, { model, createdAt: new Date().toISOString(), idPrefix: `director-${Date.now().toString(36)}`, expectedCount: requestedCount });
            edit((value) => ({ ...value, directorPlans: [...plans, ...(activePlan ? [activePlan] : value.directorPlans || [])].slice(0, 3) }));
        } catch (cause) {
            if (!current.signal.aborted) setError(cause instanceof Error ? cause.message : "导演策划失败，原方案保留");
        } finally {
            if (controller.current === current) {
                controller.current = null;
                setRunning(false);
                onBusyChange(false);
            }
        }
    };
    return (
        <section aria-label="AI 导演策划" className="rw-director-planner">
            <p className="rw-hint">根据商品事实、观众顾虑和原片逐镜时长策划全片，再设计重拍镜头。选用后更新动作、色调与口播；换元素保留原机位，保留原片镜头不改。</p>
            <p className="rw-hint">{imageCount ? `当前模型将结合前 ${imageCount} 张商品实拍分析外观和色调。` : "当前按文字档案与原片拆解策划；选择支持图片的模型并放上商品图，才能结合实拍外观判断。"}</p>
            <ModelPicker config={config} capability="text" value={model} onChange={setModel} requirements={videoTeardownTextRequirements(config, 0)} fullWidth placeholder="选择导演策划模型" modelDisabledReason={() => (disabled ? "正在处理作品" : "")} />
            <div className="rw-director-actions">
                <Select aria-label="导演策划版本数" value={requestedCount} disabled={disabled || running} onChange={setCount} options={(activePlan ? [2] : [2, 3]).map((value) => ({ value, label: `${value} 个方向` }))} />
                <Button type="primary" loading={running} disabled={disabled || Boolean(problem)} onClick={() => void run()}>
                    AI 导演策划
                </Button>
            </div>
            {activePlan ? <p className="rw-hint">保留正在使用的方案，比较两个新方向；选用前保留当前逐镜编辑。</p> : null}
            <p className="rw-hint">{problem || "按所选文本模型计费；先比较策划，再选用，选用不会自动生成视频。"}</p>
            {error ? (
                <p role="alert" className="rw-warn">
                    {error}
                </p>
            ) : null}
            {(job.directorPlans || []).map((plan) => (
                <details key={plan.id} className="rw-director-result" open={plan.id === job.activeDirectorPlanId}>
                    <summary>
                        {plan.angle}
                        {plan.id === job.activeDirectorPlanId ? " · 正在用" : ""}
                    </summary>
                    <ReplicaStrategyView strategy={plan.strategy} />
                    <ol>
                        {plan.lines.map((line) => (
                            <li key={line.shotNumber}>
                                镜头 {line.shotNumber}：{line.director?.purpose || "保留原镜头动作"}。{line.director?.action || line.dialogue || "按原片执行"}
                            </li>
                        ))}
                    </ol>
                    {plan.input !== input ? (
                        <p role="status" className="rw-warn">
                            商品、策略或镜头做法已变化，这份策划仅供回查，请重新策划。
                        </p>
                    ) : null}
                    {plan.input !== input && plan.id === job.activeDirectorPlanId ? (
                        <Button disabled={disabled} onClick={() => edit((value) => ({ ...value, activeDirectorPlanId: undefined }))}>
                            取消方案绑定，保留逐镜编辑
                        </Button>
                    ) : null}
                    <Button
                        disabled={disabled || plan.input !== input || plan.id === job.activeDirectorPlanId}
                        onClick={() => {
                            try {
                                edit((value) => applyRemakeDirectorPlan(value, plan));
                                setError("");
                            } catch (cause) {
                                setError(cause instanceof Error ? cause.message : "选用失败");
                            }
                        }}
                    >
                        选用这份导演策划
                    </Button>
                </details>
            ))}
        </section>
    );
}
