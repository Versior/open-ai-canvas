import { afterEach, expect, test } from "bun:test";
import React, { act } from "react";
import { reconciler } from "@react-three/fiber";

import { useSkillRuntimeCatalog } from "../src/components/skills/skill-runtime-picker";
import { getActiveUserScope, setActiveUserScope } from "../src/lib/user-scope";
import { apiClient } from "../src/services/api/request";
import { addSkill, listAddedSkills } from "../src/services/api/skills";
import { useUserStore, type LocalUser } from "../src/stores/use-user-store";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalRequest = apiClient.request;
const originalUser = useUserStore.getState().user;
const originalScope = getActiveUserScope();
const originalAct = Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT");
let unmount: (() => Promise<void>) | undefined;

afterEach(async () => {
    await unmount?.();
    unmount = undefined;
    apiClient.request = originalRequest;
    useUserStore.getState().setUser(originalUser);
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
    setActiveUserScope(originalScope);
    if (originalAct) Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", originalAct);
    else Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
});

function browser() {
    const storage = new Map<string, string>();
    const target = Object.assign(new EventTarget(), { localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
    } });
    Object.defineProperty(globalThis, "window", { configurable: true, value: target });
    return target;
}

function user(id: string): LocalUser {
    return { id, username: id, displayName: id, role: "user", status: "active" };
}

function envelope(ids: string[]) {
    return { data: { code: 0, data: { skills: ids.map((skillId) => ({
        skillId, skillName: skillId, description: "Runtime skill", versionId: "v1", version: "1",
        tag: "canvas", isLike: false, isAdded: true, isOwner: true,
    })) }, msg: "ok" }, status: 200, headers: {} };
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

async function mountCatalog(count = 1) {
    Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
    let catalog!: ReturnType<typeof useSkillRuntimeCatalog>;
    function Probe() { catalog = useSkillRuntimeCatalog(); return null; }
    // The installed renderer runs real React effects; this probe creates no 3D hosts.
    const fail = (error: unknown) => { throw error; };
    const root = reconciler.createContainer({} as never, 1, null, false, null, "", fail, fail, fail, null);
    await act(async () => { reconciler.updateContainer(Array.from({ length: count }, (_, index) => <Probe key={index} />), root, null, null); });
    unmount = async () => { await act(async () => { reconciler.updateContainer(null, root, null, null); }); };
    return () => catalog;
}

test("manual and focus refresh bypass cached skills and coalesce pending fresh reads", async () => {
    const target = browser();
    setActiveUserScope("catalog-refresh");
    useUserStore.getState().setUser(user("catalog-refresh"));
    let ids = ["old"];
    let reads = 0;
    let next: ReturnType<typeof deferred<ReturnType<typeof envelope>>> | undefined;
    apiClient.request = (async (config) => {
        if (config.method === "post") return envelope([]);
        reads += 1;
        return next?.promise ?? envelope(ids);
    }) as typeof apiClient.request;
    await addSkill("invalidate");
    const catalog = await mountCatalog();
    expect(catalog().skills.map((item) => item.skillId)).toEqual(["old"]);
    ids = ["manual"];
    await act(async () => { catalog().refresh(); });
    expect(catalog().skills.map((item) => item.skillId)).toEqual(["manual"]);
    ids = ["focus"];
    await act(async () => { target.dispatchEvent(new Event("focus")); });
    expect(catalog().skills.map((item) => item.skillId)).toEqual(["focus"]);
    next = deferred();
    await act(async () => {
        catalog().refresh();
        target.dispatchEvent(new Event("focus"));
        target.dispatchEvent(new Event("canvas-skills-changed"));
    });
    expect(catalog().loading).toBe(true);
    expect(reads).toBe(4);
    await act(async () => { next!.resolve(envelope(["fresh"])); });
    expect(catalog().skills.map((item) => item.skillId)).toEqual(["fresh"]);
    expect(reads).toBe(4);
});

for (const trigger of ["manual", "focus"] as const) {
    for (const fails of [false, true]) {
        test(`${trigger} refresh supersedes a pending forced ${fails ? "error" : "success"} from before a library change`, async () => {
            const target = browser();
            const scope = `catalog-boundary-${trigger}-${fails}`;
            setActiveUserScope(scope);
            useUserStore.getState().setUser(user(scope));
            const stale = deferred<ReturnType<typeof envelope>>();
            const fresh = deferred<ReturnType<typeof envelope>>();
            let reads = 0;
            apiClient.request = (async (config) => {
                if (config.method === "post") return envelope([]);
                reads += 1;
                return reads === 1 ? stale.promise : fresh.promise;
            }) as typeof apiClient.request;
            await addSkill("invalidate");
            const catalog = await mountCatalog();
            try {
                // Another tab added a skill; no window-local mutation event reaches this tab.
                await act(async () => {
                    if (trigger === "manual") catalog().refresh();
                    else target.dispatchEvent(new Event("focus"));
                });
                expect(reads).toBe(2);
                if (!fails) {
                    await act(async () => { stale.resolve(envelope([])); });
                    expect(catalog().skills).toEqual([]);
                    expect(catalog().loading).toBe(true);
                }
                await act(async () => { fresh.resolve(envelope(["newly-added"])); });
                if (fails) await act(async () => { stale.reject(new Error("Old catalog failed")); });
                expect(catalog().skills.map((item) => item.skillId)).toEqual(["newly-added"]);
                expect(catalog().loading).toBe(false);
                expect(catalog().error).toBe("");
                expect((await listAddedSkills()).skills.map((item) => item.skillId)).toEqual(["newly-added"]);
                expect(reads).toBe(2);
            } finally {
                await act(async () => {
                    stale.resolve(envelope([]));
                    fresh.resolve(envelope(["newly-added"]));
                });
            }
        });
    }
}

test("simultaneous catalogs share initial and focus refresh reads without an event loop", async () => {
    const target = browser();
    setActiveUserScope("catalog-shared-boundary");
    useUserStore.getState().setUser(user("catalog-shared-boundary"));
    const initial = deferred<ReturnType<typeof envelope>>();
    const fresh = deferred<ReturnType<typeof envelope>>();
    let reads = 0;
    apiClient.request = (async (config) => {
        if (config.method === "post") return envelope([]);
        reads += 1;
        return reads === 1 ? initial.promise : fresh.promise;
    }) as typeof apiClient.request;
    await addSkill("invalidate");
    const catalog = await mountCatalog(2);
    try {
        expect(reads).toBe(1);
        await act(async () => { target.dispatchEvent(new Event("focus")); });
        expect(reads).toBe(2);
        await act(async () => {
            fresh.resolve(envelope(["fresh"]));
            initial.resolve(envelope([]));
        });
        expect(catalog().skills.map((item) => item.skillId)).toEqual(["fresh"]);
        expect(catalog().loading).toBe(false);
        expect(reads).toBe(2);
    } finally {
        await act(async () => {
            initial.resolve(envelope([]));
            fresh.resolve(envelope(["fresh"]));
        });
    }
});

test("a forced read supersedes an older pending read without stale cache publication", async () => {
    browser();
    setActiveUserScope("catalog-race");
    const old = deferred<ReturnType<typeof envelope>>();
    let reads = 0;
    apiClient.request = (async (config) => {
        if (config.method === "post") return envelope([]);
        reads += 1;
        return reads === 1 ? old.promise : envelope(["new"]);
    }) as typeof apiClient.request;
    await addSkill("invalidate");
    const pending = listAddedSkills();
    const refreshed = listAddedSkills({ force: true });
    try { expect(reads).toBe(2); } finally { old.resolve(envelope(["old"])); }
    const fresh = await refreshed;
    await pending;
    expect(fresh.skills.map((item) => item.skillId)).toEqual(["new"]);
    expect((await listAddedSkills()).skills.map((item) => item.skillId)).toEqual(["new"]);
    expect(reads).toBe(2);
});

test("concurrent forced readers share one new request rather than a cached value", async () => {
    browser();
    setActiveUserScope("catalog-concurrent");
    let reads = 0;
    const response = deferred<ReturnType<typeof envelope>>();
    apiClient.request = (async (config) => {
        if (config.method === "post") return envelope([]);
        reads += 1;
        return reads === 1 ? envelope(["cached"]) : response.promise;
    }) as typeof apiClient.request;
    await addSkill("invalidate");
    await listAddedSkills();
    const first = listAddedSkills({ force: true });
    const second = listAddedSkills({ force: true });
    const regular = listAddedSkills();
    expect(reads).toBe(2);
    response.resolve(envelope(["fresh"]));
    for (const result of await Promise.all([first, second, regular])) {
        expect(result.skills.map((item) => item.skillId)).toEqual(["fresh"]);
    }
});

test("a late old-account response cannot overwrite a completed new-account cache", async () => {
    browser();
    setActiveUserScope("catalog-late-A");
    const old = deferred<ReturnType<typeof envelope>>();
    let reads = 0;
    apiClient.request = (async (config) => {
        if (config.method === "post") return envelope([]);
        reads += 1;
        return reads === 1 ? old.promise : envelope(["B"]);
    }) as typeof apiClient.request;
    await addSkill("invalidate");
    const pending = listAddedSkills({ force: true });
    setActiveUserScope("catalog-late-B");
    await listAddedSkills({ force: true });
    old.resolve(envelope(["A"]));
    await expect(pending).rejects.toThrow();
    expect((await listAddedSkills()).skills.map((item) => item.skillId)).toEqual(["B"]);
    expect(reads).toBe(2);
});

for (const fails of [false, true]) {
    test(`account switching ignores a stale ${fails ? "error" : "success"} and clears the previous catalog`, async () => {
        browser();
        setActiveUserScope(`catalog-A-${fails}`);
        useUserStore.getState().setUser(user(`catalog-A-${fails}`));
        const stale = deferred<ReturnType<typeof envelope>>();
        const current = deferred<ReturnType<typeof envelope>>();
        let reads = 0;
        apiClient.request = (async (config) => {
            if (config.method === "post") return envelope([]);
            reads += 1;
            if (reads === 1) return envelope(["A"]);
            return reads === 2 ? stale.promise : current.promise;
        }) as typeof apiClient.request;
        await addSkill("invalidate");
        const catalog = await mountCatalog();
        expect(catalog().skills.map((item) => item.skillId)).toEqual(["A"]);
        await act(async () => { catalog().refresh(); });
        await act(async () => {
            setActiveUserScope(`catalog-B-${fails}`);
            useUserStore.getState().setUser(user(`catalog-B-${fails}`));
        });
        expect(catalog().skills).toEqual([]);
        expect(catalog().loading).toBe(true);
        await act(async () => {
            if (fails) stale.reject(new Error("A request failed"));
            else stale.resolve(envelope(["stale-A"]));
        });
        expect(catalog().error).toBe("");
        expect(catalog().skills).toEqual([]);
        expect(catalog().loading).toBe(true);
        await act(async () => { current.resolve(envelope(["B"])); });
        expect(catalog().skills.map((item) => item.skillId)).toEqual(["B"]);
        expect(catalog().loading).toBe(false);
        expect((await listAddedSkills()).skills.map((item) => item.skillId)).toEqual(["B"]);
    });
}

test("a catalog response from a changed account rejects before it can be consumed", async () => {
    browser();
    setActiveUserScope("catalog-read-A");
    const response = deferred<ReturnType<typeof envelope>>();
    apiClient.request = (async (config) => config.method === "post" ? envelope([]) : response.promise) as typeof apiClient.request;
    await addSkill("invalidate");
    const result = listAddedSkills({ force: true });
    setActiveUserScope("catalog-read-B");
    response.resolve(envelope(["A"]));
    await expect(result).rejects.toThrow();
});

test("a failed refresh clears stale skills and a later focus refresh recovers", async () => {
    const target = browser();
    setActiveUserScope("catalog-failure");
    useUserStore.getState().setUser(user("catalog-failure"));
    let failure = false;
    apiClient.request = (async (config) => {
        if (config.method === "post") return envelope([]);
        if (failure) throw new Error("Catalog unavailable");
        return envelope(["owned"]);
    }) as typeof apiClient.request;
    await addSkill("invalidate");
    const catalog = await mountCatalog();
    failure = true;
    await act(async () => { catalog().refresh(); });
    expect(catalog().skills).toEqual([]);
    expect(catalog().error).toBe("Catalog unavailable");
    expect(catalog().loading).toBe(false);
    failure = false;
    await act(async () => { target.dispatchEvent(new Event("focus")); });
    expect(catalog().skills.map((item) => item.skillId)).toEqual(["owned"]);
    expect(catalog().error).toBe("");
});

test("unmounted catalogs ignore focus and library-change events", async () => {
    const target = browser();
    setActiveUserScope("catalog-unmount");
    useUserStore.getState().setUser(user("catalog-unmount"));
    let reads = 0;
    apiClient.request = (async (config) => {
        if (config.method !== "post") reads += 1;
        return envelope([]);
    }) as typeof apiClient.request;
    await addSkill("invalidate");
    await mountCatalog();
    await unmount!();
    unmount = undefined;
    await act(async () => {
        target.dispatchEvent(new Event("focus"));
        target.dispatchEvent(new Event("canvas-skills-changed"));
    });
    expect(reads).toBe(1);
});
