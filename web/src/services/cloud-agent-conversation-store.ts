import { openDB, type DBSchema } from "idb";
import { canonicalize } from "json-canonicalize";
import localforage from "localforage";
import { nanoid } from "nanoid";

import { assertCurrentUserSession, captureUserSession, isUserScopedPersistenceSuppressed, scopedStorageKey } from "@/lib/user-scope";
import type { CloudAgentConversation } from "@/services/cloud-agent-conversations";

interface HistoryDatabase extends DBSchema {
    app_state: { key: string; value: string };
}

type ConversationSnapshot = { activeId: string | null; conversations: CloudAgentConversation[]; readOnly?: true };
type ParseArchive = (raw: string) => ConversationSnapshot;
type ParseRow = (raw: string) => CloudAgentConversation;
type LegacyDraftCheckpoint = { draft: string; updatedAt: string; targetId: string; editId?: string };

function rowPrefix(key: string, scope: string) {
    return `${key}:by-session:${encodeURIComponent(scope)}:`;
}

const activeKey = (key: string, scope: string) => scopedStorageKey(`${key}:active`, scope);
const checkpointKey = (key: string, scope: string, id: string) => `${key}:legacy-draft:${encodeURIComponent(scope)}:${encodeURIComponent(id)}`;

function readCheckpoint(raw?: string): LegacyDraftCheckpoint | undefined {
    if (raw === undefined) return undefined;
    const entry = JSON.parse(raw) as Partial<LegacyDraftCheckpoint> | null;
    if (!entry || typeof entry.draft !== "string" || typeof entry.updatedAt !== "string" || typeof entry.targetId !== "string" || (entry.editId !== undefined && typeof entry.editId !== "string")) throw new Error("Agent 草稿迁移记录损坏，已保留原始对话");
    return entry as LegacyDraftCheckpoint;
}

function draftValue(conversation: CloudAgentConversation) {
    return canonicalize([conversation.draft || "", conversation.draftPrefill ?? null]);
}

function reconcileLegacyDraft(incoming: CloudAgentConversation, target: CloudAgentConversation | undefined, previous: LegacyDraftCheckpoint | undefined) {
    const draft = draftValue(incoming);
    if (previous && Date.parse(incoming.updatedAt) < Date.parse(previous.updatedAt)) return;
    let changed: CloudAgentConversation | undefined;
    if (!target) changed = incoming;
    else if (draft !== previous?.draft && draft !== draftValue(target)) {
        const untouched = previous ? previous.draft === draftValue(target) && previous.editId === target.draftEditId : !target.draft && !target.draftEditId;
        if (untouched) {
            changed = { ...target, draft: incoming.draft, draftPrefill: incoming.draftPrefill, draftEditId: nanoid(), updatedAt: Date.parse(target.updatedAt) > Date.parse(incoming.updatedAt) ? target.updatedAt : incoming.updatedAt };
        } else if (incoming.draft || incoming.draftPrefill) {
            changed = {
                id: nanoid(),
                title: `恢复的草稿 · ${incoming.title}`,
                draft: incoming.draft,
                draftPrefill: incoming.draftPrefill,
                draftEditId: nanoid(),
                messages: [],
                run: null,
                permissionMode: "read_only",
                createdAt: incoming.updatedAt,
                updatedAt: incoming.updatedAt,
            };
        }
    }
    const destination = changed ?? target!;
    const checkpoint: LegacyDraftCheckpoint = { draft, updatedAt: incoming.updatedAt, targetId: destination.id, editId: !changed && previous?.draft === draft ? previous.editId : destination.draftEditId };
    return { changed, checkpoint };
}

export async function loadAgentConversationRows(key: string, scope: string, parseArchive: ParseArchive, parseRow: ParseRow): Promise<ConversationSnapshot> {
    const session = captureUserSession(true);
    const legacy = scopedStorageKey(`${key}:global`, scope);
    await localforage.ready();
    if (localforage.driver() !== localforage.INDEXEDDB) {
        const raw = await localforage.getItem<string>(legacy);
        assertCurrentUserSession(session, true);
        return { ...(raw ? parseArchive(raw) : { activeId: null, conversations: [] }), readOnly: true };
    }
    const database = await openDB<HistoryDatabase>("yingce");
    try {
        assertCurrentUserSession(session, true);
        const transaction = database.transaction("app_state", "readwrite");
        const prefix = rowPrefix(key, scope);
        const range = IDBKeyRange.bound(prefix, `${prefix}\uffff`);
        const [rawArchive, keys, values] = await Promise.all([transaction.store.get(legacy), transaction.store.getAllKeys(range), transaction.store.getAll(range)]);
        const rows = new Map(keys.map((row, index) => [decodeURIComponent(row.slice(prefix.length)), values[index] === "null" ? null : parseRow(values[index])] as const));
        let legacyActive: string | null = null;
        if (rawArchive) {
            if (isUserScopedPersistenceSuppressed()) throw new Error("当前账号禁止迁移对话历史");
            const archive = parseArchive(rawArchive);
            legacyActive = archive.activeId;
            const checkpointKeys = archive.conversations.map((item) => checkpointKey(key, scope, item.id));
            const checkpoints = (await Promise.all(checkpointKeys.map((entry) => transaction.store.get(entry)))).map(readCheckpoint);
            const writes = new Map<string, string>();
            for (const [index, incoming] of archive.conversations.entries()) {
                const previous = checkpoints[index];
                const target = rows.get(previous?.targetId ?? incoming.id);
                if (rows.get(incoming.id) === null || target === null) continue;
                const result = reconcileLegacyDraft(incoming, target, previous);
                if (!result) continue;
                if (result.changed) {
                    rows.set(result.changed.id, result.changed);
                    writes.set(prefix + encodeURIComponent(result.changed.id), JSON.stringify(result.changed));
                }
                writes.set(checkpointKeys[index], JSON.stringify(result.checkpoint));
            }
            assertCurrentUserSession(session, true);
            await Promise.all([...Array.from(writes, ([entry, value]) => transaction.store.put(value, entry)), transaction.store.delete(legacy), transaction.done]);
        } else await transaction.done;
        assertCurrentUserSession(session, true);
        const conversations = [...rows.values()].filter((row) => row !== null);
        conversations.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
        const remembered = window.sessionStorage.getItem(activeKey(key, scope)) ?? legacyActive;
        const activeId = conversations.find((item) => item.id === remembered)?.id ?? conversations[0]?.id ?? null;
        if (activeId) window.sessionStorage.setItem(activeKey(key, scope), activeId);
        return { activeId, conversations };
    } finally {
        database.close();
    }
}

const pendingWrites = new Map<string, Promise<void>>();
export function saveAgentConversationRows(key: string, scope: string, activeId: string | null, conversation: CloudAgentConversation | undefined, deleted: string[]) {
    const session = captureUserSession(true);
    const write = (pendingWrites.get(scope) || Promise.resolve())
        .catch(() => undefined)
        .then(async () => {
            assertCurrentUserSession(session, true);
            if (isUserScopedPersistenceSuppressed()) throw new Error("当前账号禁止写入对话历史");
            await localforage.ready();
            if (localforage.driver() !== localforage.INDEXEDDB) throw new Error("当前浏览器不支持 IndexedDB，仅能读取旧对话，修改未保存");
            const database = await openDB<HistoryDatabase>("yingce");
            try {
                assertCurrentUserSession(session, true);
                const transaction = database.transaction("app_state", "readwrite");
                const prefix = rowPrefix(key, scope);
                for (const id of deleted) await Promise.all([transaction.store.put("null", prefix + encodeURIComponent(id)), transaction.store.delete(checkpointKey(key, scope, id))]);
                let removed = false;
                if (conversation) {
                    const row = prefix + encodeURIComponent(conversation.id);
                    removed = (await transaction.store.get(row)) === "null";
                    if (!removed) {
                        const messages = conversation.messages.filter((item) => item.interjection !== "sending").map((item) => ({ ...item, streaming: false }));
                        await transaction.store.put(JSON.stringify({ ...conversation, messages }), row);
                    }
                }
                await transaction.done;
                assertCurrentUserSession(session, true);
                if (removed) throw new Error("本对话已在另一个窗口删除，请新建对话后继续");
                if (activeId) window.sessionStorage.setItem(activeKey(key, scope), activeId);
                else window.sessionStorage.removeItem(activeKey(key, scope));
            } finally {
                database.close();
            }
        });
    pendingWrites.set(scope, write);
    return write.finally(() => {
        if (pendingWrites.get(scope) === write) pendingWrites.delete(scope);
    });
}
