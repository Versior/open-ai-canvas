import { create } from "zustand";
import { persist } from "zustand/middleware";

export type SidebarHistoryKind = "canvases" | "conversations";
export type SidebarHistoryPrefs = { pinned: string[]; order: string[] };
export const EMPTY_HISTORY_PREFS: SidebarHistoryPrefs = { pinned: [], order: [] };

export function orderSidebarHistory<T extends { id: string }>(items: T[], prefs: SidebarHistoryPrefs): T[] {
    const pinned = new Set(prefs.pinned);
    const positions = new Map(prefs.order.map((id, index) => [id, index]));
    return [...items].sort((a, b) => Number(pinned.has(b.id)) - Number(pinned.has(a.id)) || (positions.get(a.id) ?? Infinity) - (positions.get(b.id) ?? Infinity));
}

type SidebarHistoryPrefsStore = {
    users: Record<string, Partial<Record<SidebarHistoryKind, SidebarHistoryPrefs>>>;
    togglePin: (userId: string, kind: SidebarHistoryKind, id: string) => void;
    move: (userId: string, kind: SidebarHistoryKind, ids: string[], id: string, direction: -1 | 1) => void;
    resetOrder: (userId: string, kind: SidebarHistoryKind) => void;
};

/** Only IDs and display order live here; titles, thumbnails and media remain in their normal caches. */
export const useSidebarHistoryPrefsStore = create<SidebarHistoryPrefsStore>()(
    persist(
        (set) => {
            const update = (userId: string, kind: SidebarHistoryKind, change: (prefs: SidebarHistoryPrefs) => SidebarHistoryPrefs) =>
                set((state) => ({ users: { ...state.users, [userId]: { ...state.users[userId], [kind]: change(state.users[userId]?.[kind] || EMPTY_HISTORY_PREFS) } } }));
            return {
                users: {},
                togglePin: (userId, kind, id) => update(userId, kind, (prefs) => ({ ...prefs, pinned: prefs.pinned.includes(id) ? prefs.pinned.filter((value) => value !== id) : [...prefs.pinned, id] })),
                move: (userId, kind, ids, id, direction) =>
                    update(userId, kind, (prefs) => {
                        const index = ids.indexOf(id);
                        const next = index + direction;
                        if (index < 0 || next < 0 || next >= ids.length || prefs.pinned.includes(id) !== prefs.pinned.includes(ids[next])) return prefs;
                        const order = [...ids];
                        [order[index], order[next]] = [order[next], order[index]];
                        return { ...prefs, order };
                    }),
                resetOrder: (userId, kind) => update(userId, kind, (prefs) => ({ ...prefs, order: [] })),
            };
        },
        { name: "yingce:sidebar-history-prefs", version: 1 },
    ),
);
