import type { ReactNode } from "react";
import { GenerationPhaseSteps } from "@/components/ai/generation-phase-steps";
import { WorkingDots } from "@/components/ai/working-indicator";
import { useTaskElapsed } from "@/hooks/use-task-elapsed";
import { generationPhaseHint, generationPhaseLabel, generationPhaseStep, generationTaskPhase, generationTaskShowsProgress, type GenerationPhase } from "@/lib/generation-task-display";
import type { GenerationTask } from "@/services/api/task-center";
import "./image-pack-progress.css";

export function ImagePackProgress({
    task,
    phase: phaseOverride,
    preparing = false,
    children,
}: {
    task: Pick<GenerationTask, "status"> & Partial<Pick<GenerationTask, "stage" | "mediaStage" | "progress" | "createdAt">>;
    phase?: GenerationPhase;
    preparing?: boolean;
    children?: ReactNode;
}) {
    const phase = phaseOverride ?? generationTaskPhase(task);
    const elapsed = useTaskElapsed(task.createdAt);
    const progress = typeof task.progress === "number" && generationTaskShowsProgress(task) ? task.progress : null;
    const hint = generationPhaseHint(phase, "image", task.stage);
    return (
        <div className="image-pack-progress" data-phase={phase}>
            <span className="image-pack-progress-title" role="status">
                {!preparing && phase !== "uncertain" ? <WorkingDots dotSize={2} gap={2} /> : null}
                {preparing ? "图片已生成" : generationPhaseLabel(phase, "image", task.stage)}
            </span>
            <span className="image-pack-progress-meta">{preparing ? "正在准备展开…" : [progress !== null ? `${progress}%` : "", task.createdAt ? `已用时 ${elapsed}` : ""].filter(Boolean).join(" · ")}</span>
            {hint ? <span className="image-pack-progress-hint">{hint}</span> : null}
            {children || (phase !== "uncertain" ? <GenerationPhaseSteps step={generationPhaseStep(phase)} progress={progress} /> : null)}
        </div>
    );
}
