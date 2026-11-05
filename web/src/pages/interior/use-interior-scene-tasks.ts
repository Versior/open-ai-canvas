import { useCallback, useEffect, useRef, useState } from "react";
import { applyScenePatch, assembleScene, buildScenePartPrompt, buildScenePlanPrompt, normalizeSceneBrief, normalizeScenePlan, parseSceneJson, type ScenePlan } from "@/lib/interior/scene-3d";
import { parseBackendGenerationResult } from "@/services/api/generation-task";
import { isGenerationTaskTerminalError, waitForGenerationTask } from "@/services/api/task-center";
import type { InteriorCatalog, InteriorProject, InteriorProjectDocument, InteriorSceneItem } from "@/services/api/interior";
import type { AiConfig } from "@/stores/use-config-store";
import { patchInteriorScene } from "./interior-models";
import { fetchSceneKnowledge, loadSceneFile, saveSceneFile, sceneKnowledgeQuery, scenePromptInput, submitSceneTask } from "./interior-scene-tasks";

type Update = (projectId: string, mutate: (document: InteriorProjectDocument) => InteriorProjectDocument) => void;

const SCENE_TASK_TIMEOUT_MS = 15 * 60 * 1000;
/** 还没拿到任务 ID 的记录：提交超过这么久仍没有任务，多半是页面在提交时被关掉了。 */
const SUBMIT_STALE_MS = 2 * 60 * 1000;
const PART_RETRY_MS = 1500;

function errorText(error: unknown, fallback: string) {
    return error instanceof Error && error.message ? error.message : fallback;
}

/** 查询中断（网络、超时）和任务本身失败分开：前者让用户点「重新查询」，后者直接记失败。 */
class SceneStalledError extends Error {}

async function taskText(taskId: string, signal: AbortSignal) {
    try {
        return parseBackendGenerationResult(await waitForGenerationTask(taskId, { signal, timeoutMs: SCENE_TASK_TIMEOUT_MS })).text || "";
    } catch (error) {
        if (signal.aborted || isGenerationTaskTerminalError(error)) throw error;
        throw new SceneStalledError(errorText(error, "查询结果中断"));
    }
}

/**
 * 推进当前项目里还在生成的 3D 模型：规划完成后按部分并行提交，各部分完成后拼成场景存成文件；
 * 修改任务完成后把改动应用到上一版上。离开页面或切换项目时只停止监听，不取消任务；回来时按记录里的进度接着走。
 */
export function useInteriorSceneTasks(project: InteriorProject | null, update: Update, config: AiConfig, catalog: InteriorCatalog) {
    const running = useRef(new Map<string, AbortController>());
    const configRef = useRef(config);
    configRef.current = config;
    const catalogRef = useRef(catalog);
    catalogRef.current = catalog;
    const [stalled, setStalled] = useState<Record<string, string>>({});
    const projectId = project?.id || "";

    useEffect(() => {
        const active = running.current;
        return () => {
            for (const controller of active.values()) controller.abort();
            active.clear();
        };
    }, [projectId]);

    useEffect(() => {
        if (!project) return;
        const scenes = project.document.scenes || [];
        for (const item of scenes) {
            if (item.status !== "pending" || stalled[item.id]) continue;
            const key = `${item.id}:${item.stage}`;
            if (running.current.has(key)) continue;
            const waiting = item.stage === "parts" ? !item.partTaskIds?.length : !item.taskId;
            if (waiting) {
                if (Date.now() - Date.parse(item.createdAt) > SUBMIT_STALE_MS) update(project.id, (document) => patchInteriorScene(document, item.id, { status: "failed", error: "提交没有完成，请重新生成" }));
                continue;
            }
            advance(project.id, item, scenes, key);
        }
        // advance 只依赖 update 和 config 的最新值；文档变化时重新扫描即可。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [project, stalled]);

    function advance(targetProjectId: string, item: InteriorSceneItem, scenes: InteriorSceneItem[], key: string) {
        const controller = new AbortController();
        running.current.set(key, controller);
        const patch = (value: Partial<InteriorSceneItem>) => update(targetProjectId, (document) => patchInteriorScene(document, item.id, value));
        const work = item.stage === "analyze" ? runAnalyze(item, controller.signal) : item.stage === "plan" ? runPlan(item, controller.signal) : item.stage === "parts" ? runParts(item, controller.signal) : runEdit(item, scenes, controller.signal);
        void work
            .then((value) => {
                if (!controller.signal.aborted) patch(value);
            })
            .catch((error: unknown) => {
                if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return;
                if (error instanceof SceneStalledError) setStalled((current) => ({ ...current, [item.id]: error.message }));
                else patch({ status: "failed", error: errorText(error, "生成失败") });
            })
            .finally(() => {
                if (running.current.get(key) === controller) running.current.delete(key);
            });
    }

    /**
     * 方案分析完成：用分析结果补齐范围、空间和风格（用户自己选了的不改），按补齐后的条件再查一次知识库，提交规划。
     */
    async function runAnalyze(item: InteriorSceneItem, signal: AbortSignal): Promise<Partial<InteriorSceneItem>> {
        const catalog = catalogRef.current;
        const brief = normalizeSceneBrief(parseSceneJson(await taskText(item.taskId!, signal)).value, {
            scope: item.autoScope ? "auto" : item.scope,
            roomKeys: catalog.rooms.map((room) => room.key),
            styleKeys: catalog.styles.map((style) => style.key),
        });
        const room = catalog.rooms.find((entry) => entry.key === (item.roomKey || brief.roomKey));
        const style = catalog.styles.find((entry) => entry.key === (item.styleKey || brief.styleKey));
        const next: InteriorSceneItem = {
            ...item,
            scope: brief.scope,
            brief,
            title: brief.title,
            summary: brief.summary,
            ...(room ? { roomKey: room.key, roomName: room.name } : {}),
            ...(style ? { styleKey: style.key, styleName: style.name, ...(style.summary ? { styleHint: style.summary } : {}) } : {}),
        };
        const { knowledge, refs } = await fetchSceneKnowledge(sceneKnowledgeQuery(next));
        if (signal.aborted) throw new DOMException("已离开", "AbortError");
        const task = await submitSceneTask(configRef.current, item.model, buildScenePlanPrompt(scenePromptInput(next, knowledge)), "plan", item.reference);
        window.dispatchEvent(new CustomEvent("wallet:updated"));
        const { id: _id, createdAt: _createdAt, status: _status, ...changed } = next;
        return { ...changed, stage: "plan", taskId: task.id, knowledge: refs };
    }

    /** 规划完成：读出几部分，逐个提交（有部分提交失败时其余照常，全失败才算失败）。各部分的提示词带上方案分析和知识库。 */
    async function runPlan(item: InteriorSceneItem, signal: AbortSignal): Promise<Partial<InteriorSceneItem>> {
        const plan = normalizeScenePlan(parseSceneJson(await taskText(item.taskId!, signal)).value);
        const { knowledge } = await fetchSceneKnowledge(sceneKnowledgeQuery(item));
        const input = scenePromptInput(item, knowledge);
        // 依次提交，不并发：同时建几个任务容易撞上数据库写锁和「同时进行的任务」上限；失败的那部分稍等再试一次。
        const partTaskIds: (string | null)[] = [];
        let lastError: unknown = null;
        for (const [index] of plan.parts.entries()) {
            const prompt = buildScenePartPrompt(input, plan, index);
            let taskId: string | null = null;
            for (let attempt = 0; attempt < 2 && !taskId; attempt += 1) {
                if (signal.aborted) throw new DOMException("已离开", "AbortError");
                if (attempt) await new Promise((resolve) => window.setTimeout(resolve, PART_RETRY_MS));
                try {
                    taskId = (await submitSceneTask(configRef.current, item.model, prompt, "part", item.reference)).id;
                } catch (error) {
                    lastError = error;
                }
            }
            partTaskIds.push(taskId);
        }
        if (!partTaskIds.some(Boolean)) throw new Error(errorText(lastError, "分部分提交失败"));
        window.dispatchEvent(new CustomEvent("wallet:updated"));
        return { stage: "parts", plan, partTaskIds, title: plan.title, summary: plan.summary };
    }

    /** 各部分都结束后拼起来；某部分失败或读不懂就跳过，其余照常显示，并记下跳过了哪些。 */
    async function runParts(item: InteriorSceneItem, signal: AbortSignal): Promise<Partial<InteriorSceneItem>> {
        const plan = item.plan as ScenePlan;
        const results = await Promise.allSettled((item.partTaskIds || []).map((taskId) => (taskId ? taskText(taskId, signal) : Promise.reject(new Error("这一部分没有提交成功")))));
        const stalledResult = results.find((result): result is PromiseRejectedResult => result.status === "rejected" && result.reason instanceof SceneStalledError);
        if (stalledResult) throw stalledResult.reason;
        const values = results.map((result) => {
            if (result.status !== "fulfilled") return null;
            try {
                return parseSceneJson(result.value).value;
            } catch {
                return null;
            }
        });
        const { scene, dropped, failedParts } = assembleScene(plan, values);
        const sceneFile = await saveSceneFile(scene);
        return { status: "succeeded", sceneFile, title: scene.title, summary: scene.summary, objectCount: scene.objects.length, error: undefined, plan: undefined, ...(dropped ? { dropped } : {}), ...(failedParts.length ? { failedParts } : {}) };
    }

    /** 修改完成：读上一版场景，应用改动，存成新的一版。 */
    async function runEdit(item: InteriorSceneItem, scenes: InteriorSceneItem[], signal: AbortSignal): Promise<Partial<InteriorSceneItem>> {
        const parent = scenes.find((scene) => scene.id === item.parentId);
        if (!parent?.sceneFile) throw new Error("要修改的那一版已经删掉了");
        const [text, base] = await Promise.all([taskText(item.taskId!, signal), loadSceneFile(parent.sceneFile.resourceId)]);
        const { scene, dropped } = applyScenePatch(base, parseSceneJson(text).value);
        const sceneFile = await saveSceneFile(scene);
        return { status: "succeeded", sceneFile, title: scene.title, summary: scene.summary, objectCount: scene.objects.length, error: undefined, ...(dropped ? { dropped } : {}) };
    }

    const retry = useCallback((sceneId: string) => {
        setStalled((current) => {
            const next = { ...current };
            delete next[sceneId];
            return next;
        });
    }, []);

    return { stalled, retry };
}
