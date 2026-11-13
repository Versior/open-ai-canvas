import { useEffect, useRef, useState } from "react";
import { nanoid } from "nanoid";
import { localForageStorageForScope } from "@/lib/localforage-storage";
import { getActiveUserScope } from "@/lib/user-scope";
import { creativeCastDefaults, type CreativeCast } from "@/lib/remake/creative";
import type { RemakeProduct } from "@/lib/remake/job";
import type { VideoChatSettings, VideoChatTurn } from "@/lib/remake/video-chat";
import { parseVideoChatArchive, saveVideoChatSession, VIDEO_CHAT_HISTORY_KEY, type VideoChatArchive } from "@/services/video-chat-history-storage";

export type VideoChatDraft = VideoChatSettings & {
    product: RemakeProduct;
    cast: CreativeCast;
    text: string;
    referenceId: string;
    model: string;
    transcribe: boolean;
    confirmedInput: string;
    edited: Array<"name" | "sellingPoints" | "note" | "audience" | "objective" | "brand" | "tone" | "ratio">;
};
export type VideoChatSession = { id: string; turns: VideoChatTurn[]; draft: VideoChatDraft; updatedAt: string };
type Archive = VideoChatArchive;
export { VIDEO_CHAT_HISTORY_KEY };

export function emptyVideoChatDraft(model: string): VideoChatDraft {
    return {
        intent: "creative",
        brief: { scene: "showcase", tone: "natural", seconds: 15, audience: "", objective: "", brand: "" },
        ratio: "9:16",
        note: "",
        product: { name: "", sellingPoints: "", images: [] },
        cast: creativeCastDefaults("showcase"),
        text: "",
        referenceId: "",
        model,
        transcribe: false,
        confirmedInput: "",
        edited: [],
    };
}

function newSession(draft: VideoChatDraft): VideoChatSession {
    return { id: nanoid(), turns: [], draft, updatedAt: new Date().toISOString() };
}

export function useVideoChatHistory(draft: VideoChatDraft, onRestore: (draft: VideoChatDraft) => void) {
    const scope = getActiveUserScope();
    const [storage] = useState(() => localForageStorageForScope(scope));
    const [archive, setArchive] = useState<Archive>(() => {
        const session = newSession(draft);
        return { version: 1, activeId: session.id, sessions: [session] };
    });
    const [ready, setReady] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const latest = useRef({ draft, onRestore });
    latest.current = { draft, onRestore };
    const current = useRef(archive);
    const writes = useRef(Promise.resolve());
    const savedSessions = useRef(new Map<string, VideoChatSession>());
    const sessionIds = useRef(new Map<string, string>());
    const mounted = useRef(false);
    const serializedDraft = JSON.stringify(draft);

    const save = (value: Archive) => {
        if (scope === "guest") return;
        setSaving(true);
        const session = value.sessions.find((item) => item.id === value.activeId)!;
        writes.current = writes.current.then(async () => {
            try {
                const id = sessionIds.current.get(session.id) ?? session.id;
                const stored = await saveVideoChatSession(scope, { ...session, id }, savedSessions.current.get(id));
                sessionIds.current.set(session.id, stored.activeId);
                savedSessions.current.set(stored.activeId, { ...session, id: stored.activeId });
                if (!mounted.current) return;
                const sessions = current.current.sessions.map((item) => (item.id === session.id ? { ...item, id: stored.activeId } : item));
                current.current = {
                    version: 1,
                    activeId: current.current.activeId === session.id ? stored.activeId : current.current.activeId,
                    sessions: [...sessions, ...stored.sessions.filter((item) => !sessions.some((local) => local.id === item.id))],
                };
                setArchive(current.current);
                setError("");
            } catch {
                if (mounted.current) setError("对话未能保存到本机，请重试保存后再刷新。");
            }
        });
        const pending = writes.current;
        void pending.then(() => {
            if (mounted.current && pending === writes.current) setSaving(false);
        });
    };
    const commit = (value: Archive) => {
        current.current = value;
        setArchive(value);
        save(value);
    };

    useEffect(() => {
        mounted.current = true;
        let active = true;
        void (async () => {
            try {
                const raw = scope === "guest" ? null : await storage.getItem(VIDEO_CHAT_HISTORY_KEY);
                if (!active) return;
                if (raw) {
                    const stored = parseVideoChatArchive(raw);
                    savedSessions.current = new Map(stored.sessions.map((session) => [session.id, session]));
                    current.current = stored;
                    latest.current.onRestore(stored.sessions.find((session) => session.id === stored.activeId)!.draft);
                    setArchive(stored);
                }
                setReady(true);
            } catch {
                if (active) setError("读取对话历史失败，原记录未覆盖，请刷新重试。");
            }
        })();
        return () => {
            active = false;
            mounted.current = false;
        };
    }, [scope, storage]);

    useEffect(() => {
        if (!ready) return;
        const session = current.current.sessions.find((item) => item.id === current.current.activeId)!;
        if (JSON.stringify(session.draft) === serializedDraft) return;
        commit({ ...current.current, sessions: current.current.sessions.map((item) => (item.id === session.id ? { ...item, draft: latest.current.draft, updatedAt: new Date().toISOString() } : item)) });
    }, [serializedDraft, ready]);

    const switchTo = (value: Archive) => {
        const selected = value.sessions.find((session) => session.id === value.activeId)!;
        latest.current.onRestore(selected.draft);
        commit(value);
    };
    return {
        ready,
        saving,
        error,
        activeId: archive.activeId,
        sessions: archive.sessions,
        turns: archive.sessions.find((session) => session.id === archive.activeId)!.turns,
        setTurns: (update: (turns: VideoChatTurn[]) => VideoChatTurn[]) => {
            if (!ready) return;
            commit({
                ...current.current,
                sessions: current.current.sessions.map((session) => (session.id === current.current.activeId ? { ...session, turns: update(session.turns), draft: latest.current.draft, updatedAt: new Date().toISOString() } : session)),
            });
        },
        open: (id: string) => switchTo({ ...current.current, activeId: id }),
        reset: () => {
            const session = newSession(emptyVideoChatDraft(latest.current.draft.model));
            switchTo({ ...current.current, activeId: session.id, sessions: [session, ...current.current.sessions] });
        },
        retrySave: () => save(current.current),
    };
}
