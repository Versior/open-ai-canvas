import { useCallback, useEffect, useRef, useState } from "react";
import { applyScenePatch, normalizeSceneBrief, parseSceneJson, type SceneBrief } from "@/lib/interior/scene-3d";
import { sceneStats } from "@/lib/interior/scene-compile";
import { applySceneLocalEdit } from "@/lib/interior/scene-local-edit";
import { buildSceneSpecPrompt, normalizeSceneMeta, specDimensionCheck, type InteriorSceneV2, type SceneSpec } from "@/lib/interior/scene-spec";
import { checkSceneCompletion } from "@/lib/interior/scene-validation";
import { parseBackendGenerationResult } from "@/services/api/generation-task";
import { isGenerationTaskTerminalError, waitForGenerationTask } from "@/services/api/task-center";
import type { InteriorCatalog, InteriorProject, InteriorProjectDocument, InteriorSceneItem } from "@/services/api/interior";
import type { AiConfig } from "@/stores/use-config-store";
import { patchInteriorScene } from "./interior-models";
import { catalogKeys, fetchSceneKnowledge, loadSceneFile, saveSceneFile, sceneKnowledgeQuery, scenePromptInput, submitSceneTask } from "./interior-scene-tasks";

type Update = (projectId: string, mutate: (document: InteriorProjectDocument) => InteriorProjectDocument) => void;

const SCENE_TASK_TIMEOUT_MS = 15 * 60 * 1000;
/** 还没拿到任务 ID 的记录：提交超过这么久仍没有任务，多半是页面在提交时被关掉了。 */
const SUBMIT_STALE_MS = 2 * 60 * 1000;
/** 流式文字最多这么久刷新一次页面，预览每次都要重新搭模型，太勤了会卡。 */
const LIVE_FLUSH_MS = 300;

function errorText(error: unknown, fallback: string) {
    return error instanceof Error && error.message ? error.message : fallback;
}

/** 查询中断（网络、超时）和任务本身失败分开：前者让用户点「重新查询」，后者直接记失败。 */
class SceneStalledError extends Error {}

/**
 * 等任务完成并取回文字。onText 收到的是到目前为止的完整文字：优先走文本事件流；
 * 事件流不可用（代理没开 SSE、旧任务）时退回轮询，轮询结果里有草稿也照样往外送。
 */
async function taskText(taskId: string, signal: AbortSignal, onText?: (text: string) => void) {
    const finish = (task: Awaited<ReturnType<typeof waitForGenerationTask>>) => parseBackendGenerationResult(task).text || "";
    try {
        if (onText) {
            try {
                return finish(await waitForGenerationTask(taskId, { signal, timeoutMs: SCENE_TASK_TIMEOUT_MS, onTextDelta: onText }));
            } catch (error) {
                if (signal.aborted || isGenerationTaskTerminalError(error) || !(error instanceof Error) || error.name !== "TaskTextStreamFatalError") throw error;
            }
        }
        return finish(
            await waitForGenerationTask(taskId, {
                signal,
                timeoutMs: SCENE_TASK_TIMEOUT_MS,
                ...(onText ? { onTaskUpdate: (task) => task.textDraft && onText(task.textDraft) } : {}),
            }),
        );
    } catch (error) {
        if (signal.aborted || isGenerationTaskTerminalError(error)) throw error;
        throw new SceneStalledError(errorText(error, "查询结果中断"));
    }
}

/** 一次读图出方案的结果里没有单独的方案分析：用方案里的说明拼一份，出效果图时带上 renderNotes。 */
function briefFromSpec(spec: SceneSpec, meta: ReturnType<typeof normalizeSceneMeta>): SceneBrief {
    return {
        scope: meta.scope,
        title: spec.title,
        summary: spec.summary,
        ...(meta.roomKey ? { roomKey: meta.roomKey } : {}),
        ...(meta.styleKey ? { styleKey: meta.styleKey } : {}),
        spaces: spec.floors.flatMap((floor) => floor.rooms.filter((room) => !room.part).map((room) => ({ name: room.name }))).slice(0, 24),
        features: meta.reading,
        materials: [],
        furniture: [],
        description: meta.reading.join("；") || spec.summary || spec.title,
        renderNotes: meta.renderNotes,
    };
}

/**
 * 推进当前项目里还在生成的 3D 模型：先读图，再检索知识建模；校验失败最多修正一次，通过后存成场景文件；
 * 修改任务完成后存成新的一版。生成过程中把模型写出来的文字交给页面（live），页面边读边搭预览。
 * 离开页面或切换项目时只停止监听，不取消任务；回来时按记录里的进度接着走。
 */
export function useInteriorSceneTasks(project: InteriorProject | null, update: Update, config: AiConfig, catalog: InteriorCatalog) {
    const running = useRef(new Map<string, AbortController>());
    const configRef = useRef(config);
    configRef.current = config;
    const catalogRef = useRef(catalog);
    catalogRef.current = catalog;
    const [stalled, setStalled] = useState<Record<string, string>>({});
    const [live, setLive] = useState<Record<string, string>>({});
    const buffer = useRef<Record<string, string>>({});
    const flushTimer = useRef<number | null>(null);
    const projectId = project?.id || "";

    const pushLive = useCallback((sceneId: string, text: string) => {
        buffer.current[sceneId] = text;
        if (flushTimer.current !== null) return;
        flushTimer.current = window.setTimeout(() => {
            flushTimer.current = null;
            const pending = buffer.current;
            buffer.current = {};
            setLive((current) => ({ ...current, ...pending }));
        }, LIVE_FLUSH_MS);
    }, []);
    const dropLive = useCallback((sceneId: string) => {
        delete buffer.current[sceneId];
        setLive((current) => {
            if (!(sceneId in current)) return current;
            const next = { ...current };
            delete next[sceneId];
            return next;
        });
    }, []);
    useEffect(
        () => () => {
            if (flushTimer.current !== null) window.clearTimeout(flushTimer.current);
        },
        [],
    );

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
            const key = `${item.id}:${item.stage}:${item.taskId}`;
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
        const onText = (text: string) => {
            if (!controller.signal.aborted) pushLive(item.id, text);
        };
        // 旧版「规划 → 分部分搭」的进度不再续跑，直接记失败让用户重新生成。
        const work =
            item.stage === "analyze"
                ? runAnalyze(item, controller.signal, onText)
                : item.stage === "spec"
                  ? runSpec(item, controller.signal, onText)
                  : item.stage === "edit"
                    ? runEdit(item, scenes, controller.signal, onText)
                    : Promise.reject(new Error("3D 模型的生成方式已升级，这一条请重新生成"));
        void work
            .then((value) => {
                if (!controller.signal.aborted) patch(value);
            })
            .catch((error: unknown) => {
                if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return;
                if (error instanceof SceneStalledError) setStalled((current) => ({ ...current, [item.id]: error.message }));
                else patch({ status: "failed", error: errorText(error, "生成失败"), notice: undefined });
            })
            .finally(() => {
                if (running.current.get(key) === controller) running.current.delete(key);
                if (!controller.signal.aborted) dropLive(item.id);
            });
    }

    /** 读图后补齐范围、空间和风格（用户自己选了的不改），按实际空间再查知识库，提交整份 3D 方案。 */
    async function runAnalyze(item: InteriorSceneItem, signal: AbortSignal, onText: (text: string) => void): Promise<Partial<InteriorSceneItem>> {
        const catalog = catalogRef.current;
        const parsed = parseSceneJson(await taskText(item.taskId!, signal, onText));
        if (parsed.truncated) throw new Error("读图回复被截断，未继续建模");
        const brief = normalizeSceneBrief(parsed.value, {
            scope: item.autoScope ? "auto" : item.scope,
            roomKeys: catalog.rooms.map((room) => room.key),
            styleKeys: catalog.styles.map((style) => style.key),
        });
        const room = catalog.rooms.find((entry) => entry.key === (item.roomKey || brief.roomKey));
        const style = catalog.styles.find((entry) => entry.key === (item.styleKey || brief.styleKey));
        const next: InteriorSceneItem = {
            ...item,
            scope: brief.scope,
            autoScope: false,
            brief,
            title: brief.title,
            summary: brief.summary,
            ...(room ? { roomKey: room.key, roomName: room.name } : {}),
            ...(style ? { styleKey: style.key, styleName: style.name, ...(style.summary ? { styleHint: style.summary } : {}) } : {}),
        };
        const { knowledge, refs } = await fetchSceneKnowledge(sceneKnowledgeQuery(next));
        if (signal.aborted) throw new DOMException("已离开", "AbortError");
        const task = await submitSceneTask(configRef.current, item.model, buildSceneSpecPrompt({ ...scenePromptInput(next, knowledge), ...catalogKeys(catalog) }), "spec", item.reference);
        window.dispatchEvent(new CustomEvent("wallet:updated"));
        const { id: _id, createdAt: _createdAt, status: _status, ...changed } = next;
        return { ...changed, stage: "spec", taskId: task.id, knowledge: refs };
    }

    /**
     * 方案完成：读出读图记录、范围、空间和风格，以及整份 3D 方案（房间、门窗、家具、屋顶、庭院），存成第二版场景文件。
     * 完整性和几何检查通过才保存；不通过最多提交一次修正。几何细节在页面上现算。
     */
    async function runSpec(item: InteriorSceneItem, signal: AbortSignal, onText: (text: string) => void): Promise<Partial<InteriorSceneItem>> {
        const catalog = catalogRef.current;
        const { value, truncated } = parseSceneJson(await taskText(item.taskId!, signal, onText));
        const meta = normalizeSceneMeta(value, { scope: item.autoScope ? "auto" : item.scope, roomKeys: catalog.rooms.map((room) => room.key), styleKeys: catalog.styles.map((style) => style.key) });
        let spec: SceneSpec | undefined;
        let issues: string[];
        try {
            ({ spec, issues } = checkSceneCompletion(value, meta.scope, { truncated, spaces: item.brief?.spaces, size: item.brief?.dimensionChains ? item.brief.size : undefined }));
        } catch (cause) {
            issues = [errorText(cause, "方案格式无效")];
        }
        if (issues.length) {
            if ((item.repairCount || 0) >= 1) throw new Error(`建模未通过检查，未保存为成品：${issues.slice(0, 5).join("；")}`);
            const { knowledge, refs } = await fetchSceneKnowledge(sceneKnowledgeQuery(item));
            if (signal.aborted) throw new DOMException("已离开", "AbortError");
            const prompt = [
                buildSceneSpecPrompt({ ...scenePromptInput(item, knowledge), ...catalogKeys(catalog) }),
                "",
                "上一份方案未通过程序校验。结合原图和读图清单修正以下错误，输出完整 JSON：",
                ...issues.map((issue) => `- ${issue}`),
                `上一份方案：${JSON.stringify(value)}`,
            ].join("\n");
            const task = await submitSceneTask(configRef.current, item.model, prompt, "repair", item.reference);
            window.dispatchEvent(new CustomEvent("wallet:updated"));
            return { taskId: task.id, repairCount: 1, knowledge: refs, notice: "正在修正空间、尺寸和门洞检查发现的问题" };
        }
        if (!spec) throw new Error("没有可保存的建模方案");
        const scene: InteriorSceneV2 = { version: 2, title: spec.title, summary: spec.summary, spec };
        const sceneFile = await saveSceneFile(scene);
        const room = item.roomKey ? undefined : catalog.rooms.find((entry) => entry.key === meta.roomKey);
        const style = item.styleKey ? undefined : catalog.styles.find((entry) => entry.key === meta.styleKey);
        return {
            status: "succeeded",
            scope: meta.scope,
            autoScope: false,
            sceneFile,
            title: spec.title,
            summary: spec.summary,
            stats: sceneStats(scene),
            error: undefined,
            brief: item.brief ? { ...item.brief, ...(meta.renderNotes ? { renderNotes: meta.renderNotes } : {}) } : briefFromSpec(spec, meta),
            ...(room ? { roomKey: room.key, roomName: room.name } : {}),
            ...(style ? { styleKey: style.key, styleName: style.name, ...(style.summary ? { styleHint: style.summary } : {}) } : {}),
            notice: undefined,
        };
    }

    /** 修改完成：第二版读出改好的整份方案；第一版把改动应用到上一版的物体上。都存成新的一版。 */
    async function runEdit(item: InteriorSceneItem, scenes: InteriorSceneItem[], signal: AbortSignal, onText: (text: string) => void): Promise<Partial<InteriorSceneItem>> {
        const parent = scenes.find((scene) => scene.id === item.parentId);
        if (!parent?.sceneFile) throw new Error("要修改的那一版已经删掉了");
        const [text, base] = await Promise.all([taskText(item.taskId!, signal, onText), loadSceneFile(parent.sceneFile.resourceId)]);
        if (item.editTarget) {
            const scene = applySceneLocalEdit(base, item.editTarget, parseSceneJson(text).value);
            const sceneFile = await saveSceneFile(scene);
            return { status: "succeeded", sceneFile, title: scene.title, summary: scene.summary, stats: sceneStats(scene), error: undefined };
        }
        if (base.version === 2) {
            const parsed = parseSceneJson(text);
            const { spec, issues } = checkSceneCompletion(parsed.value, base.spec.scope, { truncated: parsed.truncated });
            if (issues.length) throw new Error(`修改未通过检查，原模型保留：${issues.slice(0, 5).join("；")}`);
            const scene: InteriorSceneV2 = { version: 2, title: spec.title, summary: spec.summary, spec };
            const sceneFile = await saveSceneFile(scene);
            const notice = specDimensionCheck(spec);
            return { status: "succeeded", sceneFile, title: spec.title, summary: spec.summary, stats: sceneStats(scene), error: undefined, ...(notice ? { notice } : {}) };
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

    return { stalled, retry, live };
}
