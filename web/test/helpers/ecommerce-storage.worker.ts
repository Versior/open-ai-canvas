import assert from "node:assert/strict";
import localforage from "localforage";

const values = new Map<string, string>();
const localValues = new Map<string, string>();
(globalThis as { window?: unknown }).window = { localStorage: {
    getItem: (key: string) => localValues.get(key) ?? null,
    setItem: (key: string, value: string) => localValues.set(key, value),
    removeItem: (key: string) => localValues.delete(key),
} };
let failWrites = false;
let delayedRead: ((key: string) => Promise<string | null> | undefined) | undefined;
localforage.getItem = (async (key: string) => delayedRead?.(key) ?? values.get(key) ?? null) as typeof localforage.getItem;
localforage.setItem = (async (key: string, value: string) => {
    if (failWrites) throw new Error("storage unavailable");
    values.set(key, value);
    return value;
}) as typeof localforage.setItem;

const { setActiveUserScope, withUserScopedPersistenceSuppressed } = await import("../../src/lib/user-scope");
setActiveUserScope("check-A");
const { useEcommerceModelLibrary: library, saveModelFromImage } = await import("../../src/stores/use-ecommerce-model-library");
const { useEcommerceSuitePrompt: director } = await import("../../src/stores/use-ecommerce-suite-prompt");
const { useInspirationStore: inspirations, normalizeDraft } = await import("../../src/stores/use-inspiration-store");
await inspirations.persist.rehydrate();
const key = (name: string, scope: string) => `${name}:user:${scope}`;
const model = { id: "owned-model", name: "Owned model", kind: "custom", refs: ["resource:own"], tags: [], createdAt: "2026-10-01", lastUsedAt: "2026-10-01" };
const modelKey = key("ecommerce-model-library", "check-A");

values.set(modelKey, JSON.stringify({ version: 2, models: [model] }));
await library.getState().hydrate();
setActiveUserScope("check-B");
await library.getState().hydrate();
await library.getState().touchModel(model.id);
assert.deepEqual(library.getState().models, []);
assert.deepEqual(JSON.parse(values.get(key("ecommerce-model-library", "check-B"))!).models, []);

setActiveUserScope("check-A");
director.getState().reset();
values.set(key("ecommerce-suite-prompt", "check-A"), "A's instructions");
values.set(key("ecommerce-suite-prompt", "check-B"), "B's instructions");
await director.getState().hydrate();
setActiveUserScope("check-B");
await director.getState().hydrate();
assert.equal(director.getState().director, "B's instructions");
await director.getState().setDirector("B's edited instructions");
assert.equal(values.get(key("ecommerce-suite-prompt", "check-B")), "B's edited instructions");
assert.equal(values.get(key("ecommerce-suite-prompt", "check-A")), "A's instructions");

setActiveUserScope("check-A");
withUserScopedPersistenceSuppressed(() => inspirations.setState({ custom: [], overrides: {}, hidden: [], favorites: [], hydrated: false }));
await inspirations.persist.rehydrate();
inspirations.getState().createEntry({ title: "Private A", description: "", image: "/sample.jpg", mode: "image", prompt: "Private A prompt" });
setActiveUserScope("check-B");
await inspirations.persist.rehydrate();
inspirations.getState().toggleFavorite("original:example");
assert.deepEqual(JSON.parse(values.get(key("open_ai_canvas:inspirations", "check-B"))!).state.custom, []);

setActiveUserScope("check-A");
library.getState().reset();
values.set(modelKey, JSON.stringify({ version: 2, models: [model] }));
await saveModelFromImage("resource:new", "New model");
assert.equal(JSON.parse(values.get(modelKey)!).models.length, 2);
assert.ok(library.getState().models.some((item) => item.id === model.id));
await library.getState().removeModels(library.getState().models.filter((item) => item.id !== model.id).map((item) => item.id));
assert.deepEqual(library.getState().models.map((item) => item.id), [model.id]);

library.getState().reset();
values.set(modelKey, JSON.stringify({ version: 2, models: [model, { ...model, id: "default", kind: "preset" }] }));
await library.getState().hydrate();
assert.deepEqual(library.getState().models.map((item) => item.id), [model.id]);
assert.deepEqual(JSON.parse(values.get(modelKey)!).models.map((item: { id: string }) => item.id), [model.id]);

await Promise.all([
    library.getState().updateModel(model.id, (current) => ({ refs: [...current.refs, "resource:concurrent-A"] })),
    library.getState().updateModel(model.id, (current) => ({ refs: [...current.refs, "resource:concurrent-B"] })),
]);
assert.deepEqual(library.getState().models[0]!.refs, ["resource:own", "resource:concurrent-A", "resource:concurrent-B"]);

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

const before = values.get(modelKey);
failWrites = true;
await assert.rejects(() => saveModelFromImage("resource:failed", "Failed save"), /storage unavailable/);
failWrites = false;
assert.equal(values.get(modelKey), before);
assert.deepEqual(library.getState().models.map((item) => item.id), [model.id]);

library.getState().reset();
let release!: (value: string | null) => void;
delayedRead = (name) => name === modelKey ? new Promise((resolve) => { release = resolve; }) : undefined;
const oldRead = library.getState().hydrate();
setActiveUserScope("check-B");
await library.getState().hydrate();
release(JSON.stringify({ version: 2, models: [model] }));
await oldRead;
delayedRead = undefined;
assert.equal(library.getState().scope, "check-B");
assert.deepEqual(library.getState().models, []);
console.log("Account isolation, hydration, clear semantics, preset removal and persistence checks passed.");
