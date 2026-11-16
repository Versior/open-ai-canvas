import { describe, expect, test } from "bun:test";
import ClipperLib from "clipper-lib";
import { Box3, Vector3, type Mesh } from "three";
import { zipSync, strToU8 } from "fflate";
import { compilePackaging } from "../src/lib/packaging/geometry";
import { buildPackagingScene, packagingUv, panelOrigin } from "../src/lib/packaging/scene";
import { packagingDxf, packagingSvg, readPackagingProjectZip } from "../src/lib/packaging/delivery";
import { newPackagingDocument, type PackagingStructure, type PackagingTemplate } from "../src/lib/packaging/types";

const structures: PackagingStructure[] = ["tuck", "reverse-tuck", "mailer", "tray", "display", "lid-base", "drawer", "book", "double-door", "pillow", "pouch", "spout-pouch"];
const template = (structure: PackagingStructure): PackagingTemplate => ({
    id: structure,
    name: structure,
    category: "折叠纸盒",
    description: "",
    enabled: true,
    structure,
    defaults: { length: 120, width: 60, height: 80, thickness: 0.45, bleed: 3, glue: 12, tab: 15, gap: 1, frontHeight: 30, windowWidth: 0, windowHeight: 0, inflation: 0.6, spoutRadius: 8 },
});
const document = (structure: PackagingStructure) => newPackagingDocument(template(structure), { id: "white-card", name: "白卡", enabled: true, color: "#fafafa", insideColor: "#bbbbbb", thickness: 0.45, roughness: 0.65, metalness: 0 });

describe("包装真实结构", () => {
    for (const structure of structures)
        test(`${structure}：展开、成型、折边与独立部件`, () => {
            const d = document(structure);
            const layout = compilePackaging(d);
            const scene = buildPackagingScene(d, layout);
            expect(layout.areaMm2).toBeGreaterThan(0);
            expect(layout.cuts.length).toBeGreaterThanOrEqual(layout.parts.length);
            expect(layout.panels.every((p) => p.points.flat().every(Number.isFinite))).toBe(true);
            for (const fold of [0, 0.3, 0.7, 1]) {
                scene.apply(fold, 0);
                expect(new Box3().setFromObject(scene.root).getSize(new Vector3()).toArray().every(Number.isFinite)).toBe(true);
                for (const panel of layout.panels.filter((p) => p.hinge)) {
                    const parent = layout.panels.find((p) => p.id === panel.parentId)!;
                    const childOrigin = panelOrigin(panel);
                    const parentOrigin = panelOrigin(parent);
                    for (const point of panel.hinge!) {
                        const child = scene.panels.get(panel.id)!.localToWorld(new Vector3(point[0] - childOrigin[0], childOrigin[1] - point[1], 0));
                        const attached = scene.panels.get(parent.id)!.localToWorld(new Vector3(point[0] - parentOrigin[0], parentOrigin[1] - point[1], 0));
                        expect(child.distanceTo(attached)).toBeLessThan(0.00001);
                    }
                }
            }
            for (let i = 0; i < layout.parts.length; i++)
                for (let j = i + 1; j < layout.parts.length; j++) {
                    const clip = new ClipperLib.Clipper();
                    const paths = (id: string) => layout.panels.filter((p) => p.partId === id).map((p) => p.points.map(([X, Y]) => ({ X: Math.round(X * 1000), Y: Math.round(Y * 1000) })));
                    clip.AddPaths(paths(layout.parts[i].id), ClipperLib.PolyType.ptSubject, true);
                    clip.AddPaths(paths(layout.parts[j].id), ClipperLib.PolyType.ptClip, true);
                    const intersection: ClipperLib.Paths = [];
                    clip.Execute(ClipperLib.ClipType.ctIntersection, intersection, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
                    expect(intersection.length).toBe(0);
                }
            scene.dispose();
        });
    test("双插盒外尺寸包含材料厚度；印刷面在外侧", () => {
        const d = document("tuck");
        const layout = compilePackaging(d);
        const scene = buildPackagingScene(d, layout);
        const size = new Box3().setFromObject(scene.root).getSize(new Vector3());
        expect(size.x).toBeCloseTo(d.parameters.length, 1);
        expect(size.z).toBeCloseTo(d.parameters.width, 1);
        expect(size.y).toBeCloseTo(d.parameters.height, 1);
        const printed = scene.root.getObjectByName("box-front-print") as Mesh;
        expect(printed.geometry.getAttribute("position").getZ(0)).toBeLessThan(-d.parameters.thickness / 2);
        expect(packagingUv([layout.bounds.x, layout.bounds.y], layout)).toEqual([0, 1]);
        scene.dispose();
    });
    test("抽屉沿套筒开口滑动，天地盖独立提起", () => {
        for (const structure of ["drawer", "lid-base"] as const) {
            const d = document(structure);
            const layout = compilePackaging(d);
            const scene = buildPackagingScene(d, layout);
            const id = structure === "drawer" ? "base" : "lid";
            const before = scene.root.getObjectByName(id)!.position.clone();
            scene.apply(1, 1);
            const delta = scene.root.getObjectByName(id)!.position.clone().sub(before);
            expect(structure === "drawer" ? delta.z : delta.y).toBeGreaterThan(20);
            scene.dispose();
        }
    });
    test("插舌、粘口和防尘翼按纸厚进入内层，不与外壁穿插", () => {
        for (const structure of ["tuck", "reverse-tuck"] as const)
            for (const thickness of [0.1, 0.45, 2]) {
                const d = document(structure);
                d.parameters.thickness = thickness;
                const layout = compilePackaging(d);
                const scene = buildPackagingScene(d, layout);
                const box = (id: string) => new Box3().setFromObject(scene.root.getObjectByName(`box-${id}-paper`)!);
                expect(box("top-tab").min.z - box("front").max.z).toBeGreaterThan(-0.001);
                expect(box("glue").min.z - box("front").max.z).toBeGreaterThan(-0.001);
                expect(box("top").min.y - box("top-right-wing").max.y).toBeGreaterThan(-0.001);
                expect(box("top").min.y - box("top-left-wing").max.y).toBeGreaterThan(-0.001);
                scene.apply(0, 0);
                expect((scene.root.getObjectByName("box-top-tab-paper") as Mesh).position.z).toBe(0);
                scene.dispose();
            }
    });
    test("飞机盒闭合外高包含上下纸厚", () => {
        for (const thickness of [0.1, 0.45, 2, 4]) {
            const d = document("mailer");
            d.parameters.thickness = thickness;
            const scene = buildPackagingScene(d, compilePackaging(d));
            expect(new Box3().setFromObject(scene.root).getSize(new Vector3()).y).toBeCloseTo(d.parameters.height, 1);
            scene.dispose();
        }
    });
    test("硬盒切线不包含铰链，粘耳保持连接", () => {
        for (const structure of structures.filter((s) => !["pouch", "spout-pouch", "pillow"].includes(s))) {
            const layout = compilePackaging(document(structure));
            expect(layout.cuts.length).toBe(layout.parts.length);
            for (const [a, b] of layout.creases) {
                const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
                const projection = (p: [number, number]) => ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / length;
                const cross = (p: [number, number]) => Math.abs((p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0])) / length;
                for (const cut of layout.cuts)
                    for (let i = 0; i < cut.length; i++) {
                        const c = cut[i],
                            e = cut[(i + 1) % cut.length];
                        if (cross(c) > 0.01 || cross(e) > 0.01) continue;
                        expect(Math.min(length, Math.max(projection(c), projection(e))) - Math.max(0, Math.min(projection(c), projection(e)))).toBeLessThan(0.01);
                    }
            }
        }
    });
    test("多种纸厚和间隙下盖底、抽屉与翻盖真实套合", () => {
        for (const structure of ["lid-base", "drawer", "book", "double-door"] as const)
            for (const thickness of [0.1, 0.45, 2, 4])
                for (const gap of [0.1, 1, 3]) {
                    const d = document(structure);
                    d.parameters = { ...d.parameters, width: 100, height: 60, thickness, gap };
                    const layout = compilePackaging(d);
                    const scene = buildPackagingScene(d, layout);
                    const box = (name: string) => new Box3().setFromObject(scene.root.getObjectByName(name)!);
                    const base = box("base");
                    const part = structure === "lid-base" ? "lid" : structure === "drawer" ? "sleeve" : "cover";
                    const top = structure === "lid-base" ? "bottom" : structure === "drawer" ? "front" : structure === "book" ? "lid" : "left-lid";
                    expect(box(`${part}-${top}-paper`).min.y - base.max.y).toBeGreaterThanOrEqual(gap - 0.01);
                    if (structure === "lid-base" || structure === "drawer") {
                        expect(box(`${part}-left-paper`).min.x - base.max.x).toBeGreaterThanOrEqual(gap - 0.01);
                        expect(base.min.x - box(`${part}-right-paper`).max.x).toBeGreaterThanOrEqual(gap - 0.01);
                    }
                    if (structure === "drawer") expect(base.min.y - box("sleeve-back-paper").max.y).toBeGreaterThanOrEqual(gap - 0.01);
                    if (structure === "lid-base") {
                        expect(base.min.z - box("lid-front-paper").max.z).toBeGreaterThanOrEqual(gap - 0.01);
                        expect(box("lid-back-paper").min.z - base.max.z).toBeGreaterThanOrEqual(gap - 0.01);
                    }
                    scene.dispose();
                }
    });
    test("软袋具有可渲染外面与内衬，封边不鼓胀，袋口可打开", () => {
        const d = document("pouch");
        const layout = compilePackaging(d);
        const scene = buildPackagingScene(d, layout);
        const face = scene.root.getObjectByName("bag-front-print") as Mesh;
        expect(Array.isArray(face.material)).toBe(false);
        expect(scene.root.getObjectByName("bag-front-lining")).toBeDefined();
        const edge = face.geometry.getAttribute("position").getZ(16);
        scene.apply(1, 1);
        expect(face.geometry.getAttribute("position").getZ(16)).toBeLessThan(edge - 1);
        expect(face.geometry.getAttribute("position").getZ(0)).toBeCloseTo(-d.parameters.thickness, 2);
        scene.dispose();
    });
    test("开窗同时进入切线和实体孔洞，过大窗口拒绝", () => {
        const d = document("tuck");
        d.parameters.windowWidth = 30;
        d.parameters.windowHeight = 25;
        const layout = compilePackaging(d);
        expect(layout.panels.find((p) => p.id === "box-front")!.holes[0]).toHaveLength(4);
        expect(layout.cuts).toContainEqual(layout.panels.find((p) => p.id === "box-front")!.holes[0]);
        const scene = buildPackagingScene(d, layout);
        const mesh = scene.root.getObjectByName("box-front-print") as Mesh;
        expect(mesh.geometry.getAttribute("position").count).toBeGreaterThan(4);
        d.parameters.windowHeight = 79;
        expect(() => compilePackaging(d)).toThrow("容不下");
        scene.dispose();
    });
});

describe("包装交付边界", () => {
    test("SVG 带毫米、层和整版轮廓裁剪，DXF 为毫米", () => {
        const d = document("tuck");
        d.artworks = [{ id: "art", resourceId: "image", name: "图稿", panelId: "", role: "artwork", x: 0, y: 0, width: 100, height: 100, rotation: 0, opacity: 1 }];
        const layout = compilePackaging(d);
        const svg = packagingSvg(d, layout, new Map([["image", "data:image/png;base64,AA=="]]));
        expect(svg).toContain('mm"');
        expect(svg).toContain('clip-path="url(#print-art)"');
        expect(svg).toContain('id="CREASE"');
        expect(svg).toContain('id="BLEED"');
        expect(packagingDxf(layout)).toContain("$INSUNITS\r\n70\r\n4");
        expect(layout.bounds.width).toBeGreaterThan(2 * (d.parameters.length + d.parameters.width) - 4 * d.parameters.thickness);
    });
    test("完整参数包可读取，损坏设置与未知面引用被拒绝", () => {
        const d = document("tuck");
        const zip = (value: unknown) => zipSync({ "project.json": strToU8(JSON.stringify({ format: "yingce-packaging", version: 1, name: "测试", document: value })) });
        expect(readPackagingProjectZip(zip(d)).document).toEqual(d);
        expect(() => readPackagingProjectZip(zip({ ...d, view: { ...d.view, projection: "invalid" } }))).toThrow();
        expect(() => readPackagingProjectZip(zip({ ...d, material: undefined }))).toThrow();
        expect(() => readPackagingProjectZip(zip({ ...d, artworks: [{ id: "a", resourceId: "img", name: "a", panelId: "missing", role: "artwork", x: 0, y: 0, width: 100, height: 100, rotation: 0, opacity: 1 }] }))).toThrow("不存在的面板");
    });
});
