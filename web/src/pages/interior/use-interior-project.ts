import { useCallback, useEffect, useRef, useState } from "react";
import { getActiveUserScope } from "@/lib/user-scope";
import { ApiError } from "@/services/api/request";
import {
    createInteriorProject,
    deleteInteriorProject,
    getInteriorProject,
    INTERIOR_PROJECT_CONFLICT,
    listInteriorProjects,
    saveInteriorProject,
    type InteriorProject,
    type InteriorProjectDocument,
    type InteriorProjectKind,
    type InteriorProjectSummary,
} from "@/services/api/interior";
import { emptyInteriorDocument, mergeInteriorDocuments, normalizeInteriorDocument } from "./interior-models";

export type InteriorSaveState = "saved" | "saving" | "error";

const SAVE_DELAY_MS = 600;
const LAST_PROJECT_KEY = "interior:last-project:";

function summaryOf(project: InteriorProject): InteriorProjectSummary {
    return { id: project.id, name: project.name, kind: project.kind, revision: project.revision, createdAt: project.createdAt, updatedAt: project.updatedAt };
}

function withDocument(project: InteriorProject): InteriorProject {
    return { ...project, document: normalizeInteriorDocument(project.document) };
}

function errorText(error: unknown, fallback: string) {
    return error instanceof Error && error.message ? error.message : fallback;
}

/** 当前项目保存失败时切换或新建项目会抛出它；页面据此询问是否放弃未保存的记录。 */
export class InteriorUnsavedError extends Error {
    constructor() {
        super("当前项目还有出图记录没保存成功，可以先点「保存失败，点击重试」");
        this.name = "InteriorUnsavedError";
    }
}

/**
 * 室内设计项目的读取与保存。页面先改本地文档，再串行保存到服务端；
 * 修订号冲突时取回最新文档、按轮次合并后重试，不会覆盖另一个窗口新增的轮次。
 */
export function useInteriorProjects(userId: string) {
    const [projects, setProjects] = useState<InteriorProjectSummary[] | null>(null);
    const [listError, setListError] = useState("");
    const [current, setCurrent] = useState<InteriorProject | null>(null);
    const [projectLoading, setProjectLoading] = useState(false);
    const [projectError, setProjectError] = useState("");
    const [saveState, setSaveState] = useState<InteriorSaveState>("saved");
    const [saveError, setSaveError] = useState("");

    const currentRef = useRef<InteriorProject | null>(null);
    const revisionRef = useRef(0);
    const dirtyRef = useRef(false);
    // 最近一次保存是否失败；和 dirtyRef 分开，保存途中有新改动时不会被当成失败。
    const saveFailedRef = useRef(false);
    const deletedRoundsRef = useRef(new Set<string>());
    const chainRef = useRef<Promise<void>>(Promise.resolve());
    const timerRef = useRef<number | undefined>(undefined);
    const baseRef = useRef<InteriorProjectDocument>(emptyInteriorDocument());
    const sessionRef = useRef({ userId });
    const navigationRef = useRef(0);
    if (sessionRef.current.userId !== userId) {
        window.clearTimeout(timerRef.current);
        sessionRef.current = { userId };
        currentRef.current = null;
        revisionRef.current = 0;
        dirtyRef.current = false;
        saveFailedRef.current = false;
        deletedRoundsRef.current = new Set();
        baseRef.current = emptyInteriorDocument();
        chainRef.current = Promise.resolve();
        navigationRef.current += 1;
    }
    const session = sessionRef.current;
    const isCurrent = useCallback(() => sessionRef.current === session && getActiveUserScope() === (userId || "guest"), [session, userId]);
    const lastProjectKey = LAST_PROJECT_KEY + userId;

    const setLocal = useCallback((project: InteriorProject | null) => {
        currentRef.current = project;
        setCurrent(project);
    }, []);

    const saveOnce = useCallback(async () => {
        if (!isCurrent()) return;
        const project = currentRef.current;
        if (!project || !dirtyRef.current) return;
        dirtyRef.current = false;
        setSaveState("saving");
        try {
            for (let attempt = 0; ; attempt += 1) {
                const snapshot = currentRef.current;
                if (!snapshot || snapshot.id !== project.id) return;
                try {
                    const saved = await saveInteriorProject(snapshot.id, { name: snapshot.name, kind: snapshot.kind, document: snapshot.document, expectedRevision: revisionRef.current });
                    if (!isCurrent()) return;
                    revisionRef.current = saved.revision;
                    baseRef.current = normalizeInteriorDocument(saved.document);
                    // 保存期间页面可能又有新改动，本地文档保持最新，只同步修订号和时间。
                    const latest = currentRef.current;
                    if (latest && latest.id === saved.id) setLocal({ ...latest, revision: saved.revision, updatedAt: saved.updatedAt });
                    setProjects((list) => list?.map((item) => (item.id === saved.id ? summaryOf(saved) : item)) ?? list);
                    break;
                } catch (error) {
                    if (!isCurrent()) return;
                    if (!(error instanceof ApiError && error.reason === INTERIOR_PROJECT_CONFLICT) || attempt >= 2) throw error;
                    const server = await getInteriorProject(snapshot.id);
                    if (!isCurrent()) return;
                    revisionRef.current = server.revision;
                    const local = currentRef.current;
                    if (!local || local.id !== snapshot.id) return;
                    const document = normalizeInteriorDocument(server.document);
                    setLocal({ ...local, revision: server.revision, document: mergeInteriorDocuments(document, local.document, deletedRoundsRef.current, baseRef.current) });
                    baseRef.current = document;
                }
            }
            saveFailedRef.current = false;
            setSaveError("");
            setSaveState(dirtyRef.current ? "saving" : "saved");
        } catch (error) {
            if (!isCurrent()) return;
            dirtyRef.current = true;
            saveFailedRef.current = true;
            setSaveError(errorText(error, "项目保存失败"));
            setSaveState("error");
        }
    }, [isCurrent, setLocal]);

    const flush = useCallback(() => {
        window.clearTimeout(timerRef.current);
        timerRef.current = undefined;
        chainRef.current = chainRef.current.then(saveOnce);
        return chainRef.current;
    }, [saveOnce]);

    const schedule = useCallback(() => {
        window.clearTimeout(timerRef.current);
        timerRef.current = window.setTimeout(() => void flush(), SAVE_DELAY_MS);
    }, [flush]);

    /**
     * 切换或新建项目前先把当前项目存好；存不上就不切换，避免已扣费的出图记录被丢掉。
     * 保存期间又有任务结果写回时再存一次；只有保存真的失败才拦下。discard 表示用户确认放弃未保存的记录。
     */
    const ensureSaved = useCallback(
        async (discard = false) => {
            if (discard) {
                window.clearTimeout(timerRef.current);
                await chainRef.current;
                dirtyRef.current = false;
                saveFailedRef.current = false;
                return;
            }
            await flush();
            if (dirtyRef.current && !saveFailedRef.current) await flush();
            if (saveFailedRef.current) throw new InteriorUnsavedError();
        },
        [flush],
    );

    /** 修改当前项目文档；projectId 不是当前项目时忽略，避免切换项目后旧任务写错地方。 */
    const update = useCallback(
        (projectId: string, mutate: (document: InteriorProjectDocument) => InteriorProjectDocument) => {
            if (!isCurrent()) return;
            const project = currentRef.current;
            if (!project || project.id !== projectId) return;
            setLocal({ ...project, document: mutate(project.document) });
            dirtyRef.current = true;
            setSaveState("saving");
            schedule();
        },
        [isCurrent, schedule, setLocal],
    );

    const removeRound = useCallback(
        (projectId: string, roundId: string) => {
            deletedRoundsRef.current.add(roundId);
            update(projectId, (document) => ({ ...document, rounds: document.rounds.filter((round) => round.id !== roundId) }));
        },
        [update],
    );

    // 轮次和 3D 模型的 id 都是随机串，共用一份「本地删掉的」记录，合并冲突时不会把删掉的又加回来。
    const removeScene = useCallback(
        (projectId: string, sceneId: string) => {
            deletedRoundsRef.current.add(sceneId);
            update(projectId, (document) => {
                const scenes = (document.scenes || []).filter((item) => item.id !== sceneId);
                return scenes.length ? { ...document, scenes } : { version: 1, rounds: document.rounds };
            });
        },
        [update],
    );

    const open = useCallback(
        async (projectId: string, discardUnsaved = false) => {
            if (!isCurrent()) return;
            const navigation = ++navigationRef.current;
            await ensureSaved(discardUnsaved);
            if (!isCurrent() || navigation !== navigationRef.current) return;
            setProjectLoading(true);
            setProjectError("");
            try {
                const project = withDocument(await getInteriorProject(projectId));
                if (!isCurrent() || navigation !== navigationRef.current) return;
                revisionRef.current = project.revision;
                baseRef.current = project.document;
                deletedRoundsRef.current = new Set();
                dirtyRef.current = false;
                saveFailedRef.current = false;
                setLocal(project);
                setSaveState("saved");
                setSaveError("");
                window.localStorage.setItem(lastProjectKey, project.id);
            } catch (error) {
                if (isCurrent() && navigation === navigationRef.current) setProjectError(errorText(error, "项目读取失败"));
            } finally {
                if (isCurrent() && navigation === navigationRef.current) setProjectLoading(false);
            }
        },
        [ensureSaved, isCurrent, lastProjectKey, setLocal],
    );

    const create = useCallback(
        async (name: string, kind: InteriorProjectKind, discardUnsaved = false) => {
            if (!isCurrent()) throw new DOMException("账号已切换", "AbortError");
            const navigation = ++navigationRef.current;
            await ensureSaved(discardUnsaved);
            if (!isCurrent()) throw new DOMException("账号已切换", "AbortError");
            const project = withDocument(await createInteriorProject({ name, kind, document: emptyInteriorDocument() }));
            if (!isCurrent() || navigation !== navigationRef.current) throw new DOMException("项目已切换", "AbortError");
            revisionRef.current = project.revision;
            baseRef.current = project.document;
            deletedRoundsRef.current = new Set();
            dirtyRef.current = false;
            saveFailedRef.current = false;
            setProjects((list) => [summaryOf(project), ...(list || [])]);
            setLocal(project);
            setSaveState("saved");
            window.localStorage.setItem(lastProjectKey, project.id);
            return project;
        },
        [ensureSaved, isCurrent, lastProjectKey, setLocal],
    );

    const rename = useCallback(
        async (name: string) => {
            const project = currentRef.current;
            if (!project) return;
            await ensureSaved();
            if (!isCurrent()) return;
            const latest = currentRef.current;
            if (!latest || latest.id !== project.id) return;
            const saved = await saveInteriorProject(latest.id, { name, kind: latest.kind, document: latest.document, expectedRevision: revisionRef.current });
            if (!isCurrent() || currentRef.current?.id !== latest.id) return;
            revisionRef.current = saved.revision;
            baseRef.current = normalizeInteriorDocument(saved.document);
            setLocal({ ...currentRef.current, name: saved.name, revision: saved.revision, updatedAt: saved.updatedAt });
            setProjects((list) => list?.map((item) => (item.id === saved.id ? summaryOf(saved) : item)) ?? list);
        },
        [ensureSaved, isCurrent, setLocal],
    );

    const remove = useCallback(
        async (projectId: string) => {
            if (!isCurrent()) return;
            const removingCurrent = currentRef.current?.id === projectId;
            if (removingCurrent) {
                window.clearTimeout(timerRef.current);
                await chainRef.current;
            }
            if (!isCurrent()) return;
            try {
                await deleteInteriorProject(projectId);
            } catch (error) {
                // 项目已在别的窗口删掉时照常从本地移除。
                if (!(error instanceof ApiError && error.status === 404)) throw error;
            }
            if (!isCurrent()) return;
            const rest = (projects || []).filter((item) => item.id !== projectId);
            setProjects(rest);
            if (currentRef.current?.id === projectId) {
                dirtyRef.current = false;
                saveFailedRef.current = false;
                setLocal(null);
                window.localStorage.removeItem(lastProjectKey);
                if (rest[0]) await open(rest[0].id);
            }
        },
        [isCurrent, lastProjectKey, open, projects, setLocal],
    );

    const retrySave = useCallback(() => {
        dirtyRef.current = true;
        void flush();
    }, [flush]);

    const reloadList = useCallback(async () => {
        if (!isCurrent()) return;
        setListError("");
        try {
            const list = await listInteriorProjects();
            if (!isCurrent()) return;
            setProjects(list);
            const preferred = window.localStorage.getItem(lastProjectKey);
            const target = list.find((item) => item.id === preferred) || list[0];
            if (target && currentRef.current?.id !== target.id) await open(target.id);
        } catch (error) {
            if (isCurrent()) setListError(errorText(error, "项目列表读取失败"));
        }
    }, [isCurrent, lastProjectKey, open]);

    useEffect(() => {
        setProjects(null);
        setLocal(null);
        setSaveState("saved");
        setSaveError("");
        setProjectError("");
        setProjectLoading(false);
        void reloadList();
        // 只在进入页面和切换账号时读取一次列表。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userId]);

    // 离开页面前把等待中的修改提交出去。
    useEffect(
        () => () => {
            if (dirtyRef.current) void flush();
        },
        [flush],
    );

    return { projects, listError, current, projectLoading, projectError, saveState, saveError, update, removeRound, removeScene, open, create, rename, remove, retrySave, reloadList };
}
