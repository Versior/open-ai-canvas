import { expect, test } from "bun:test";
import { createCanvasNode } from "../src/lib/canvas/canvas-project-domain";
import { canvasPersistentNodes } from "../src/lib/canvas/canvas-persistent-nodes";
import { ecommerceOneClickFlow } from "../src/lib/ecommerce/ecommerce-oneclick";
import { CURRENT_ECOMMERCE_SUITE_SCHEMA_VERSION, ecommerceSuiteRows, ecommerceSuiteSkeleton, migrateLegacyEcommerceSuite, type EcommerceSuite } from "../src/lib/ecommerce/ecommerce-suite";
import { ecommerceSuiteMetadata, ecommerceTableMetadata, replaceEcommerceTableOutlineRows, syncEcommerceTables } from "../src/lib/ecommerce/ecommerce-table";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";

function legacy(prompt = "旧提示词"): EcommerceSuite {
    return {
        flow: "detail",
        source: "draft",
        updatedAt: "old",
        rows: Array.from({ length: 9 }, (_, i) => ({
            slotId: `detail-${i + 1}`,
            enabled: i !== 1,
            title: `旧标题 ${i + 1}`,
            duty: `旧职责 ${i + 1}`,
            prompt: `${prompt} ${i + 1}`,
            stance: i === 2 ? ("differentiate" as const) : undefined,
            copy: i === 3 ? { headline: "主", subhead: "副", price: "88", cta: "行动" } : undefined,
            resultNodeId: i === 4 ? "result" : undefined,
        })),
    };
}

function batchRows(suite: EcommerceSuite) {
    return suite.rows.map((row) => ({ id: row.slotId, enabled: row.enabled !== false, inputNodeIds: [], prompt: row.prompt, cells: { title: row.title, duty: row.duty } }));
}

function table(direct?: EcommerceSuite, indexed?: EcommerceSuite): CanvasNodeData {
    const node = createCanvasNode(CanvasNodeType.BatchTable, { x: 0, y: 0 });
    const suite = direct || indexed!;
    return {
        ...node,
        metadata: {
            ...node.metadata,
            ecommerceFlowId: "detail",
            ...(direct ? { ecommerceSuite: direct } : {}),
            ...(indexed ? { ecommerceSuitesByFlow: { detail: indexed } } : {}),
            batchTable: { operation: "product", concurrency: 10, rows: batchRows(suite) },
        },
    };
}

test("strict legacy detail-1..detail-9 upgrades once without changing old rows", () => {
    const before = legacy();
    const after = migrateLegacyEcommerceSuite(before);
    expect(after).not.toBe(before);
    expect(after.schemaVersion).toBe(CURRENT_ECOMMERCE_SUITE_SCHEMA_VERSION);
    expect(after.rows.slice(0, 9)).toEqual(before.rows);
    before.rows.forEach((row, i) => expect(after.rows[i]).toBe(row));
    expect(after.rows[9]).toEqual(ecommerceSuiteSkeleton(ecommerceOneClickFlow("detail")!)[9]);
    const deleted = { ...after, rows: after.rows.slice(0, 9) };
    expect(migrateLegacyEcommerceSuite(deleted)).toBe(deleted);
});

test("the suite schema is at least version 2, and a v1 stamp upgrades without touching rows", () => {
    expect(CURRENT_ECOMMERCE_SUITE_SCHEMA_VERSION).toBe(2);
    const v1: EcommerceSuite = { ...legacy(), schemaVersion: 1 };
    const after = migrateLegacyEcommerceSuite(v1);
    expect(after.schemaVersion).toBe(CURRENT_ECOMMERCE_SUITE_SCHEMA_VERSION);
    expect(after.rows).toBe(v1.rows);
    // 升版本不能补行，也不能反复造新对象。
    expect(migrateLegacyEcommerceSuite(after)).toBe(after);
});

test("a suite that matches the flow but has no rows stays empty — deleted screens are not refilled", () => {
    const flow = ecommerceOneClickFlow("detail")!;
    const emptied: EcommerceSuite = { flow: "detail", rows: [], source: "draft", updatedAt: "", schemaVersion: CURRENT_ECOMMERCE_SUITE_SCHEMA_VERSION };
    expect(ecommerceSuiteRows(flow, emptied)).toEqual([]);
    // 没有表（或表是别的入口的）才铺骨架。
    expect(ecommerceSuiteRows(flow, undefined)).toEqual(ecommerceSuiteSkeleton(flow));
    expect(ecommerceSuiteRows(flow, { ...emptied, flow: "main" })).toEqual(ecommerceSuiteSkeleton(flow));
});

test("versioned, ten-screen, custom-slot and non-detail suites keep identity", () => {
    const before = legacy();
    const cases: EcommerceSuite[] = [
        { ...before, schemaVersion: CURRENT_ECOMMERCE_SUITE_SCHEMA_VERSION },
        { ...before, rows: ecommerceSuiteSkeleton(ecommerceOneClickFlow("detail")!) },
        { ...before, rows: before.rows.map((row, i) => (i === 4 ? { ...row, slotId: "custom" } : row)) },
        { ...before, flow: "main" },
    ];
    cases.forEach((suite) => expect(migrateLegacyEcommerceSuite(suite)).toBe(suite));
});

test("load normalization synchronizes suite fields then mirrors batch rows", () => {
    const before = legacy();
    const node = table(structuredClone(before), structuredClone(before));
    const after = syncEcommerceTables([node], [])[0];
    expect(after.metadata?.ecommerceSuite).toEqual(after.metadata?.ecommerceSuitesByFlow?.detail);
    // json-canonicalize rejects two metadata paths that share one object, so the representations must be separate copies.
    expect(after.metadata?.ecommerceSuite).not.toBe(after.metadata?.ecommerceSuitesByFlow?.detail);
    expect(after.metadata?.ecommerceSuite?.schemaVersion).toBe(CURRENT_ECOMMERCE_SUITE_SCHEMA_VERSION);
    expect(after.metadata?.ecommerceSuite?.rows.slice(0, 9)).toEqual(before.rows);
    expect(after.metadata?.batchTable?.rows.map((row) => row.id)).toEqual(Array.from({ length: 10 }, (_, i) => `detail-${i + 1}`));
    expect(() => canvasPersistentNodes([after], [node])).not.toThrow();
    expect(syncEcommerceTables([after], [])[0]).toBe(after);
});

test("a single representation upgrades, but conflicting representations stay untouched", () => {
    for (const node of [table(legacy()), table(undefined, legacy())]) {
        const after = syncEcommerceTables([node], [])[0];
        expect(after.metadata?.ecommerceSuite).toEqual(after.metadata?.ecommerceSuitesByFlow?.detail);
        expect(after.metadata?.ecommerceSuite).not.toBe(after.metadata?.ecommerceSuitesByFlow?.detail);
        expect(after.metadata?.batchTable?.rows).toHaveLength(10);
        expect(() => canvasPersistentNodes([after], [node])).not.toThrow();
    }
    const direct = legacy("direct");
    const indexed = legacy("indexed");
    const node = table(direct, indexed);
    const nodes = [node];
    expect(syncEcommerceTables(nodes, [])).toBe(nodes);
    expect(node.metadata?.ecommerceSuite).toBe(direct);
    expect(node.metadata?.ecommerceSuitesByFlow?.detail).toBe(indexed);
});

test("new and replaced tables carry the current suite version", () => {
    const product = createCanvasNode(CanvasNodeType.Product, { x: 0, y: 0 });
    const metadata = ecommerceTableMetadata(product, "detail");
    const replaced = replaceEcommerceTableOutlineRows(createCanvasNode(CanvasNodeType.BatchTable, { x: 0, y: 0 }, metadata), legacy().rows);
    expect(metadata.ecommerceSuite?.schemaVersion).toBe(CURRENT_ECOMMERCE_SUITE_SCHEMA_VERSION);
    expect(replaced.metadata?.ecommerceSuite?.schemaVersion).toBe(CURRENT_ECOMMERCE_SUITE_SCHEMA_VERSION);
    expect(replaced.metadata?.ecommerceSuitesByFlow?.detail?.schemaVersion).toBe(CURRENT_ECOMMERCE_SUITE_SCHEMA_VERSION);
});

test("the shared suite write entry stamps the version without refilling edited rows", () => {
    const before = legacy();
    const written = ecommerceSuiteMetadata(undefined, before);
    expect(written.ecommerceSuite?.schemaVersion).toBe(CURRENT_ECOMMERCE_SUITE_SCHEMA_VERSION);
    expect(written.ecommerceSuite).toEqual(written.ecommerceSuitesByFlow?.detail);
    expect(written.ecommerceSuite).not.toBe(written.ecommerceSuitesByFlow?.detail);
    expect(written.ecommerceSuite?.rows).toEqual(before.rows);
});

test("a user who deletes a row keeps nine rows after reload", () => {
    const nineRows = ecommerceSuiteSkeleton(ecommerceOneClickFlow("detail")!).slice(0, 9);
    const metadata = ecommerceSuiteMetadata(undefined, { flow: "detail", rows: nineRows, source: "draft", updatedAt: "" });
    const node: CanvasNodeData = {
        ...createCanvasNode(CanvasNodeType.BatchTable, { x: 0, y: 0 }),
        metadata: { ...metadata, ecommerceFlowId: "detail", batchTable: { operation: "product", concurrency: 10, rows: [] } },
    };
    const after = syncEcommerceTables([node], [])[0];
    expect(after.metadata?.ecommerceSuite?.rows).toHaveLength(9);
    expect(after.metadata?.ecommerceSuite?.rows.map((row) => row.slotId)).toEqual(nineRows.map((row) => row.slotId));
    expect(after.metadata?.batchTable?.rows).toHaveLength(9);
    expect(syncEcommerceTables([after], [])[0]).toBe(after);
});

test("a suite stamped for another flow is never overwritten during load", () => {
    const foreign: EcommerceSuite = { ...legacy("foreign"), flow: "main" };
    // Stale rows force the write path, so this exercises the flow guard rather than the "rows already mirror" shortcut.
    const node = { ...table(foreign, undefined), metadata: { ...table(foreign, undefined).metadata, batchTable: { operation: "product" as const, concurrency: 10, rows: [] } } };
    const after = syncEcommerceTables([node], [])[0];
    expect(after.metadata?.ecommerceSuite).toBe(foreign);
    expect(after.metadata?.ecommerceSuitesByFlow?.detail).toBeUndefined();
});
