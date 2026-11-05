import { useCallback, useEffect, useRef, useState } from "react";
import { applyScenePatch, normalizeSceneBrief, parseSceneJson } from "@/lib/interior/scene-3d";
import { sceneStats } from "@/lib/interior/scene-compile";
import { buildSceneSpecPrompt, normalizeSceneSpec, type InteriorSceneV2 } from "@/lib/interior/scene-spec";
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
 * 推进当前项目里还在生成的 3D 模型：方案分析完成后提交整份 3D 方案，方案完成后存成场景文件；
 * 修改任务完成后存成新的一版。离开页面或切换项目时只停止监听，不取消任务；回来时按记录里的进度接着走。
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
            const waiting = item.stage === "parts" ? false : !item.taskId;
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
        // 旧版「规划 → 分部分搭」的进度不再续跑，直接记失败让用户重新生成。
        const work =
            item.stage === "analyze"
                ? runAnalyze(item, controller.signal)
                : item.stage === "spec"
                  ? runSpec(item, controller.signal)
                  : item.stage === "edit"
                    ? runEdit(item, scenes, controller.signal)
                    : Promise.reject(new Error("3D 模型的生成方式已升级，这一条请重新生成"));
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
     * 方案分析完成：用分析结果补齐范围、空间和风格（用户自己选了的不改），按补齐后的条件再查一次知识库，提交整份 3D 方案。
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
        const task = await submitSceneTask(configRef.current, item.model, buildSceneSpecPrompt(scenePromptInput(next, knowledge)), "spec", item.reference);
        window.dispatchEvent(new CustomEvent("wallet:updated"));
        const { id: _id, createdAt: _createdAt, status: _status, ...changed } = next;
        return { ...changed, stage: "spec", taskId: task.id, knowledge: refs };
    }

    /** 方案完成：读出整份 3D 方案（房间、门窗、家具、屋顶、庭院），存成第二版场景文件。几何细节在页面上现算。 */
    async function runSpec(item: InteriorSceneItem, signal: AbortSignal): Promise<Partial<InteriorSceneItem>> {
        const { value, truncated } = parseSceneJson(await taskText(item.taskId!, signal));
        const spec = normalizeSceneSpec(value, item.scope);
        const scene: InteriorSceneV2 = { version: 2, title: spec.title, summary: spec.summary, spec };
        const sceneFile = await saveSceneFile(scene);
        return { status: "succeeded", sceneFile, title: spec.title, summary: spec.summary, stats: sceneStats(scene), error: undefined, ...(truncated ? { notice: "模型的回复太长被截断，只保留了前面的部分" } : {}) };
    }

    /** 修改完成：第二版读出改好的整份方案；第一版把改动应用到上一版的物体上。都存成新的一版。 */
    async function runEdit(item: InteriorSceneItem, scenes: InteriorSceneItem[], signal: AbortSignal): Promise<Partial<InteriorSceneItem>> {
        const parent = scenes.find((scene) => scene.id === item.parentId);
        if (!parent?.sceneFile) throw new Error("要修改的那一版已经删掉了");
        const [text, base] = await Promise.all([taskText(item.taskId!, signal), loadSceneFile(parent.sceneFile.resourceId)]);
        if (base.version === 2) {
            const spec = normalizeSceneSpec(parseSceneJson(text).value, base.spec.scope);
            const scene: InteriorSceneV2 = { version: 2, title: spec.title, summary: spec.summary, spec };
            const sceneFile = await saveSceneFile(scene);
            return { status: "succeeded", sceneFile, title: spec.title, summary: spec.summary, stats: sceneStats(scene), error: undefined };
        }
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
