import { expect, test } from "bun:test";
import { mergeInteriorDocuments } from "@/pages/interior/interior-models";
import type { InteriorProjectDocument, InteriorRound } from "@/services/api/interior";

const round: InteriorRound = {
    id: "round",
    createdAt: "2026-11-01T00:00:00Z",
    surface: "pro",
    modeKey: "edit",
    modeName: "微调",
    params: {},
    count: 1,
    source: { resourceId: "source" },
    references: [],
    items: [
        { id: "a", taskId: "task-a", status: "pending", outputs: [] },
        { id: "b", taskId: "task-b", status: "pending", outputs: [] },
    ],
};
const doc = (value: InteriorRound): InteriorProjectDocument => ({ version: 1, rounds: [value] });

test("conflict keeps remote task result and an independent local result in the same round", () => {
    const server = structuredClone(round);
    server.items[0] = { ...server.items[0], status: "succeeded", outputs: [{ resourceId: "image-a" }] };
    const local = structuredClone(round);
    local.items[1] = { ...local.items[1], status: "succeeded", outputs: [{ resourceId: "image-b" }] };
    const merged = mergeInteriorDocuments(doc(server), doc(local), new Set(), doc(round));
    expect(merged.rounds[0].items.map((item) => item.outputs[0]?.resourceId)).toEqual(["image-a", "image-b"]);
});

test("remote deletion is not resurrected by unchanged local data", () => {
    expect(mergeInteriorDocuments({ version: 1, rounds: [] }, doc(round), new Set(), doc(round)).rounds).toEqual([]);
});

test("explicit deletion also filters stale local data", () => {
    expect(mergeInteriorDocuments(doc(round), doc(round), new Set([round.id])).rounds).toEqual([]);
});
