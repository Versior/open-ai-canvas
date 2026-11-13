import { openDB, type DBSchema } from "idb";
import localforage from "localforage";
import { nanoid } from "nanoid";

import { isUserScopedPersistenceSuppressed, scopedStorageKey } from "@/lib/user-scope";
import type { VideoChatSession } from "@/pages/video-replication/use-video-chat-history";

export type VideoChatArchive = { version: 1; activeId: string; sessions: VideoChatSession[] };
export const VIDEO_CHAT_HISTORY_KEY = "video-creation-conversations";

interface VideoChatDatabase extends DBSchema {
    app_state: { key: string; value: string };
}

export function parseVideoChatArchive(raw: string): VideoChatArchive {
    const archive = JSON.parse(raw) as VideoChatArchive;
    if (
        archive.version !== 1 ||
        !Array.isArray(archive.sessions) ||
        !archive.sessions.every((session) => typeof session.id === "string" && Array.isArray(session.turns) && session.draft) ||
        !archive.sessions.some((session) => session.id === archive.activeId)
    ) {
        throw new Error("invalid conversation archive");
    }
    return archive;
}

export async function saveVideoChatSession(scope: string, session: VideoChatSession, base?: VideoChatSession): Promise<VideoChatArchive> {
    if (isUserScopedPersistenceSuppressed()) throw new Error("当前账号禁止持久化写入");
    await localforage.ready();
    if (localforage.driver() !== localforage.INDEXEDDB) throw new Error("对话历史需要浏览器支持 IndexedDB");
    const database = await openDB<VideoChatDatabase>("yingce");
    try {
        // 复用原存档位置；事务跨页面串行，读取和更新之间不会被另一页面插入写入。
        const transaction = database.transaction("app_state", "readwrite");
        const key = scopedStorageKey(VIDEO_CHAT_HISTORY_KEY, scope);
        const raw = await transaction.store.get(key);
        const archive = raw ? parseVideoChatArchive(raw) : { version: 1 as const, activeId: session.id, sessions: [] };
        const stored = archive.sessions.find((item) => item.id === session.id);
        const changed = JSON.stringify(session) !== JSON.stringify(base);
        const conflict = changed && stored && JSON.stringify(stored) !== JSON.stringify(base) && JSON.stringify(stored) !== JSON.stringify(session);
        const next = conflict ? { ...session, id: nanoid() } : changed ? session : (stored ?? session);
        const result: VideoChatArchive = { version: 1, activeId: next.id, sessions: [next, ...archive.sessions.filter((item) => item.id !== next.id)] };
        await Promise.all([transaction.store.put(JSON.stringify(result), key), transaction.done]);
        return result;
    } finally {
        database.close();
    }
}
