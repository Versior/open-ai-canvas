import { generationTaskStageLabel, isGenerationTaskSubmissionUncertain } from "@/lib/generation-task-display";
import type { GenerationTask } from "@/services/api/task-center";
import { studioAttemptActive, studioShotLatestAttempt, studioShotPreview } from "./product";
import type { StudioShot } from "./types";

export type StudioShotDisplay = { state: "done" | "active" | "pending" | "waiting" | "recover" | "review" | "failed"; label: string; detail?: string };

export function studioShotDisplay(shot: StudioShot, task?: GenerationTask, previous?: StudioShot): StudioShotDisplay {
    const attempt = studioShotLatestAttempt(shot);
    if (!attempt) return { state: "pending", label: "待生成" };
    if (task && (isGenerationTaskSubmissionUncertain(task) || task.billing?.status === "uncertain")) return { state: "review", label: "待核对", detail: "原任务可能已产生费用，先核对，不重新生成" };
    if (task?.canRecoverMedia && task.status === "failed") return { state: "recover", label: "保存未完成", detail: "作品已生成，只需继续保存，不会重新生成" };
    const continuity = attempt.input?.compiled.continuity;
    if (continuity && !continuity.reference && !attempt.taskId && studioAttemptActive(attempt) && !studioShotPreview(shot) && (!previous || !studioShotPreview(previous))) {
        return { state: "waiting", label: `等第 ${continuity.previousScreen} 屏` };
    }
    if (task?.status === "queued" || task?.status === "running" || studioAttemptActive(attempt)) {
        return { state: "active", label: task ? generationTaskStageLabel(task) : attempt.status === "submitting" ? "准备提交" : attempt.status === "queued" ? "排队中" : "正在生成", detail: attempt.error };
    }
    if (studioShotPreview(shot)) return { state: "done", label: "已保存" };
    return { state: "failed", label: attempt.status === "cancelled" ? "已取消" : "生成失败", detail: attempt.error || task?.error };
}

export function studioGroupProgress(shots: StudioShot[], tasks: Record<string, GenerationTask>) {
    const screens = shots.map((shot, index) => {
        const task = tasks[studioShotLatestAttempt(shot)?.taskId || ""];
        return { shot, task, ...studioShotDisplay(shot, task, shots[index - 1]) };
    });
    const count = (state: StudioShotDisplay["state"]) => screens.filter((screen) => screen.state === state).length;
    const uncertain = screens.filter((screen) => screen.state === "review" && screen.task && (isGenerationTaskSubmissionUncertain(screen.task) || screen.task.billing?.status === "uncertain")).length;
    const review = count("review");
    return { screens, done: count("done"), active: count("active"), pending: count("pending"), waiting: count("waiting"), recover: count("recover"), review, uncertain, visualReview: review - uncertain, failed: count("failed"), total: shots.length };
}
