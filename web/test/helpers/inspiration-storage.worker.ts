import assert from "node:assert/strict";
import localforage from "localforage";
const values = new Map<string, string>();
const localValues = new Map<string, string>();
(globalThis as { window?: unknown }).window = {
    localStorage: {
        getItem: (key: string) => localValues.get(key) ?? null,
        setItem: (key: string, value: string) => localValues.set(key, value),
        removeItem: (key: string) => localValues.delete(key),
    },
};
localforage.getItem = (async (key: string) => values.get(key) ?? null) as typeof localforage.getItem;
localforage.setItem = (async (key: string, value: string) => {
    values.set(key, value);
    return value;
}) as typeof localforage.setItem;
const { setActiveUserScope, withUserScopedPersistenceSuppressed } = await import("../../src/lib/user-scope");
setActiveUserScope("check-A");
const { useInspirationStore: inspirations, normalizeDraft } = await import("../../src/stores/use-inspiration-store");
await inspirations.persist.rehydrate();
const key = (name: string, scope: string) => `${name}:user:${scope}`;
withUserScopedPersistenceSuppressed(() => inspirations.setState({ custom: [], overrides: {}, hidden: [], favorites: [], hydrated: false }));
await inspirations.persist.rehydrate();
inspirations.getState().createEntry({ title: "Private A", description: "", image: "/sample.jpg", mode: "image", prompt: "Private A prompt" });
setActiveUserScope("check-B");
await inspirations.persist.rehydrate();
inspirations.getState().toggleFavorite("original:example");
assert.deepEqual(JSON.parse(values.get(key("open_ai_canvas:inspirations", "check-B"))!).state.custom, []);
setActiveUserScope("check-A");
await inspirations.persist.rehydrate();
const old = { title: "Editable", description: "Old", image: "/sample.jpg", mode: "image" as const, prompt: "Main", promptZh: "Old translation", category: "Old", ratio: "16:9", tags: ["Old"] };
const id = inspirations.getState().createEntry(old);
inspirations.getState().updateEntry(id, normalizeDraft({ ...old, description: "", promptZh: "", category: "", ratio: "", tags: [] }));
const edited = inspirations.getState().custom.find((item) => item.id === id)!;
assert.equal(edited.description, "");
assert.equal(edited.promptZh, "");
assert.equal(edited.category, "");
assert.equal(edited.ratio, "");
assert.deepEqual(edited.tags, []);
console.log("Inspiration account isolation and edit persistence checks passed.");
