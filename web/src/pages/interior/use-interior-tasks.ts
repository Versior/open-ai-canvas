import { useCallback, useEffect, useRef, useState } from "react";
import { isGenerationTaskTerminalError, waitForGenerationTask } from "@/services/api/task-center";
import type { InteriorImageRef, InteriorProject, InteriorProjectDocument, InteriorRoundItem } from "@/services/api/interior";
import { workbenchTaskOutputs } from "@/pages/workbench/workbench-batches";
import { patchInteriorItem } from "./interior-models";

type Update = (projectId: string, mutate: (document: InteriorProjectDocument) => InteriorProjectDocument) => void;

/**
 * 监听当前项目里还在生成的任务，完成后把效果图写回对应轮次。
 * 离开页面或切换项目时停止监听，不取消任务；回来时按任务 ID 继续查询。
 */
export function useInteriorTasks(project: InteriorProject | null, update: Update) {
    const controllers = useRef(new Map<string, AbortController>());
    // 查询通道中断（网络、超时）的任务不自动重查，避免循环；用户点「重新查询」再试。
    const [stalled, setStalled] = useState<Record<string, string>>({});
    const projectId = project?.id || "";

    useEffect(() => {
        const active = controllers.current;
        return () => {
            for (const controller of active.values()) controller.abort();
            active.clear();
        };
    }, [projectId]);

    useEffect(() => {
        if (!project) return;
        for (const round of project.document.rounds) {
            for (const item of round.items) {
                if (item.status !== "pending" || !item.taskId || controllers.current.has(item.taskId) || stalled[item.taskId]) continue;
                watch(project.id, round.id, item);
            }
        }
        // watch 只依赖 update；文档变化时重新扫描即可。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [project, stalled]);

    function watch(targetProjectId: string, roundId: string, item: InteriorRoundItem) {
        const taskId = item.taskId!;
        const controller = new AbortController();
        controllers.current.set(taskId, controller);
        void waitForGenerationTask(taskId, { signal: controller.signal })
            .then((task) => {
                const outputs: InteriorImageRef[] = workbenchTaskOutputs(task, "image")
                    .filter((output) => output.resourceId)
                    .map((output) => ({ resourceId: output.resourceId!, ...(output.width ? { width: output.width } : {}), ...(output.height ? { height: output.height } : {}) }));
                update(targetProjectId, (document) => patchInteriorItem(document, roundId, item.id, outputs.length ? { status: "succeeded", outputs, error: undefined } : { status: "failed", error: "任务完成了，但没有拿到图片" }));
            })
            .catch((error: unknown) => {
                if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return;
                if (isGenerationTaskTerminalError(error)) {
                    update(targetProjectId, (document) => patchInteriorItem(document, roundId, item.id, { status: "failed", error: error.message || "生成失败" }));
                    return;
                }
                setStalled((current) => ({ ...current, [taskId]: error instanceof Error && error.message ? error.message : "查询结果中断" }));
            })
            .finally(() => {
                if (controllers.current.get(taskId) === controller) controllers.current.delete(taskId);
            });
    }

    const retry = useCallback((taskId: string) => {
        setStalled((current) => {
            const next = { ...current };
            delete next[taskId];
            return next;
        });
    }, []);

    return { stalled, retry };
}
