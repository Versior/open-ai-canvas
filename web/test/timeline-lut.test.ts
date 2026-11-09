import { expect, test } from "bun:test";
import { parseCubeLut, timelineLutCube, TIMELINE_LUT_PRESETS, validateTimelineLut } from "@/lib/timeline/timeline-lut";
import { createEditorStore } from "@/stores/editor/editor-store";
import { normalizeTimelineProject } from "@/lib/timeline/timeline-tracks";
import type { TimelineProject } from "@/types/timeline";

const identity = 'TITLE "Identity"\nLUT_3D_SIZE 2\nDOMAIN_MIN 0 0 0\nDOMAIN_MAX 1 1 1\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n';

test(".cube 导入保留红色最快的顺序、输入范围；拒绝缺行、恶意头、越界和非有限数", () => {
    const lut = parseCubeLut(identity, "相机.cube");
    expect(lut.cube).toMatchObject({ size: 2, domainMin: [0, 0, 0], domainMax: [1, 1, 1] });
    expect(lut.cube!.values.slice(3, 6)).toEqual([1, 0, 0]);
    for (const bad of [
        identity.replace("\n1 1 1\n", "\n"),
        identity + "1 1 1",
        identity.replace("LUT_3D_SIZE 2", "LUT_3D_SIZE 64"),
        identity.replace("\n1 1 1\n", "\nNaN 1 1\n"),
        identity.replace("\n1 1 1\n", "\n1.1 1 1\n"),
        identity.replace("DOMAIN_MAX 1 1 1", "DOMAIN_MAX 0 1 1"),
        identity.replace("TITLE", "file=/etc/passwd;TITLE"),
    ])
        expect(() => parseCubeLut(bad, "bad.cube")).toThrow();
    expect(() => validateTimelineLut({ name: "bad", preset: "warm;movie=/etc/passwd", strength: 1 })).toThrow();
    expect(() => validateTimelineLut({ ...lut, strength: -0.1 })).toThrow();
    expect(() => validateTimelineLut({ ...lut, strength: NaN })).toThrow();
});

test("预设是真实17阶LUT，黑白去色；所有预设有效且色表不同", () => {
    const tables = TIMELINE_LUT_PRESETS.map((p) => timelineLutCube({ name: p.label, preset: p.id, strength: 1 }));
    expect(tables.every((cube) => cube.values.length === 17 ** 3 * 3 && cube.values.every((v) => v >= 0 && v <= 1))).toBe(true);
    expect(new Set(tables.map((cube) => JSON.stringify(cube.values))).size).toBe(TIMELINE_LUT_PRESETS.length);
    const mono = tables.at(-1)!;
    expect(mono.values[48]).toBe(mono.values[49]);
    expect(mono.values[49]).toBe(mono.values[50]);
});

test("LUT经命令保存、撤销/重做、清除与规范化恢复；无效命令不改草稿", async () => {
    let saved: TimelineProject | undefined;
    const store = createEditorStore({
        saveTimeline: async (value) => {
            saved = structuredClone(value);
        },
    });
    store.getState().load(normalizeTimelineProject(null));
    const lut = parseCubeLut(identity, "自定义.cube");
    store.getState().dispatch({ op: "setColorLut", payload: { lut } });
    lut.cube!.values[0] = 0.5;
    expect(store.getState().project!.colorLut!.cube!.values[0]).toBe(0);
    store.getState().undo();
    expect(store.getState().project!.colorLut).toBeUndefined();
    store.getState().redo();
    await store.getState().flushSave();
    expect(normalizeTimelineProject(saved).colorLut!.name).toBe("自定义.cube");
    const before = store.getState().project;
    store.getState().dispatch({ op: "setColorLut", payload: { lut: { ...lut, strength: 2 } } });
    expect(store.getState().project).toBe(before);
    expect(store.getState().saveError).toBeTruthy();
    store.getState().dispatch({ op: "setColorLut", payload: { lut: null } });
    await store.getState().flushSave();
    expect(store.getState().project!.colorLut).toBeUndefined();
});
