import { describe, expect, test } from "bun:test";
import { PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { newPackagingDocument, packagingRoles, type PackagingArtwork } from "../src/lib/packaging/types";
import { compilePackaging } from "../src/lib/packaging/geometry";
import { packagingSampleDocument } from "../src/lib/packaging/sample";
import { packagingLayerClip, packagingLayerMarkup, packagingResourceIds, reflowPackagingLayers } from "../src/lib/packaging/layers";
import { packagingPreflight } from "../src/lib/packaging/preflight";
import { parsePackagingDocument } from "../src/lib/packaging/import-contract";
import { packagingProcessSvg, packagingProjectZip, readPackagingProjectZip } from "../src/lib/packaging/delivery";
import { packagingArtworkPdf, packagingPrintPixels } from "../src/lib/packaging/print-artwork";
import { buildPackagingScene } from "../src/lib/packaging/scene";
import ClipperLib from "clipper-lib";
import { alignPackagingLayer, packagingSafeArea, transferPackagingLayer } from "../src/lib/packaging/design";
import { artworkBounds } from "../src/lib/packaging/artwork";
import { packagingTextLayout, packagingTextSize, type PackagingTextMeasureFactory } from "../src/lib/packaging/typography";
import { strFromU8, unzipSync } from "fflate";

const document = newPackagingDocument(
    {
        id: "tuck",
        name: "双插盒",
        category: "折叠纸盒",
        structure: "tuck",
        description: "",
        enabled: true,
        defaults: { length: 120, width: 60, height: 80, thickness: 0.45, bleed: 3, glue: 12, tab: 15, gap: 1, frontHeight: 30, windowWidth: 0, windowHeight: 0, inflation: 0.6, spoutRadius: 8 },
    },
    { id: "card", name: "白卡", color: "#ffffff", insideColor: "#eeeeee", thickness: 0.45, roughness: 0.65, metalness: 0, enabled: true },
);
const art: PackagingArtwork = {
    id: "brand",
    resourceId: "",
    name: "品牌",
    panelId: "box-front",
    role: "foil",
    x: 10,
    y: 10,
    width: 80,
    height: 15,
    rotation: 20,
    opacity: 1,
    content: { kind: "text", value: "品牌<&", font: "sans", weight: 700, align: "center", color: "#112233" },
};

// A fixed-width font makes the line-break boundary deterministic; real font metrics are verified in-browser.
const fixedFont: PackagingTextMeasureFactory = (art) => (value) => ({
    width: [...value].reduce((width, char) => width + packagingTextSize(art) * (/\s/.test(char) ? 0.25 : /[\u4e00-\u9fff]/u.test(char) ? 1 : 0.5) + (art.content?.kind === "text" ? (art.content.letterSpacing ?? 0) : 0), 0),
    actualBoundingBoxDescent: value ? packagingTextSize(art) * 0.2 : 0,
});

describe("文字排版与面板编辑", () => {
    const text: PackagingArtwork = { ...art, rotation: 0, width: 8, height: 40, content: { kind: "text", value: "甲乙丙丁", font: "sans", weight: 400, color: "#112233", align: "left", fontSize: 4, lineHeight: 1.5, wrap: true } };
    test("中文、英文单词、超长单词、空行与字距按实际测量分行", () => {
        const layout = (value: string, width = 8, letterSpacing = 0) => {
            const candidate = { ...text, width, content: { ...text.content!, value, letterSpacing } } as PackagingArtwork;
            return packagingTextLayout(candidate, fixedFont(candidate));
        };
        expect(layout("甲乙丙丁").lines).toEqual(["甲乙", "丙丁"]);
        expect(layout("AB CD").lines).toEqual(["AB", "CD"]);
        expect(layout("AB  CD", 12).lines).toEqual(["AB  CD"]);
        expect(packagingLayerMarkup(art, "")).toContain('xml:space="preserve"');
        expect(layout("ABCDEFGHI", 6).lines).toEqual(["ABC", "DEF", "GHI"]);
        expect(layout("甲乙\n\n丙丁").lines).toEqual(["甲乙", "", "丙丁"]);
        expect(layout("甲乙", 8, 0.5).lines).toEqual(["甲", "乙"]);
        expect(layout("甲乙丙丁").height).toBe(12);
        expect(layout("甲乙丙丁").width).toBe(8);
        const unwrapped = { ...text, content: { ...text.content!, wrap: false } } as PackagingArtwork;
        expect(packagingTextLayout(unwrapped, fixedFont(unwrapped)).width).toBe(16);
        const descender = { ...text, content: { ...text.content!, value: "gy", lineHeight: 1 } } as PackagingArtwork;
        expect(packagingTextLayout(descender, fixedFont(descender)).height).toBeCloseTo(4.8);
    });
    test("非法文字字段在文档入口被拒绝，旧图层无需填写新字段", () => {
        expect(parsePackagingDocument({ ...document, artworks: [art] }).artworks[0]).toEqual(art);
        for (const [field, value] of [
            ["fontSize", 0],
            ["fontSize", 2001],
            ["fontSize", Infinity],
            ["lineHeight", 0.9],
            ["lineHeight", 3.1],
            ["letterSpacing", -1],
            ["letterSpacing", 21],
            ["wrap", "true"],
        ]) {
            expect(() => parsePackagingDocument({ ...document, artworks: [{ ...text, content: { ...text.content, [field as string]: value } }] })).toThrow();
        }
    });
    test("文字溢出阻断交付，隐藏或透明文字不阻断；SVG 和 ZIP 保存相同分行", async () => {
        const d = { ...document, artworks: [text] },
            layout = compilePackaging(d);
        const overflow = { ...text, height: 6 };
        const report = packagingPreflight({ ...d, artworks: [overflow] }, layout, new Map(), fixedFont);
        expect(report.status).toBe("blocked");
        expect(report.issues.find((i) => i.code === "text_overflow")?.severity).toBe("error");
        for (const patch of [{ visible: false }, { opacity: 0 }]) expect(packagingPreflight({ ...d, artworks: [{ ...overflow, ...patch }] }, layout, new Map(), fixedFont).issues.some((i) => i.code === "text_overflow")).toBe(false);
        await expect(packagingProjectZip("溢出", { ...d, artworks: [overflow] }, new Map(), layout, new Map(), fixedFont)).rejects.toThrow("文字超出");
        const bytes = new Uint8Array(await (await packagingProjectZip("换行", d, new Map(), layout, new Map(), fixedFont)).arrayBuffer());
        expect(readPackagingProjectZip(bytes).document).toEqual(d);
        const files = unzipSync(bytes);
        expect(strFromU8(files["process-foil.svg"])).toContain("甲乙</text>");
        expect(strFromU8(files["process-foil.svg"])).toContain('y="10"');
        expect(JSON.parse(strFromU8(files["preflight.json"])).artworks[0].text.lines).toBe(2);
    });
    test("九宫格按旋转外框对齐，跨面复制保持相对中心并等比缩放字号", () => {
        const bounds = { x: 100, y: 200, width: 200, height: 100 };
        for (const x of [0, 0.5, 1] as const)
            for (const y of [0, 0.5, 1] as const) {
                const aligned = artworkBounds({ ...art, ...alignPackagingLayer(art, bounds, x, y) });
                expect(aligned.x + aligned.width * x).toBeCloseTo(bounds.x + bounds.width * x);
                expect(aligned.y + aligned.height * y).toBeCloseTo(bounds.y + bounds.height * y);
            }
        const source = compilePackaging(document).panels.find((p) => p.id === art.panelId)!;
        const target = {
            ...source,
            id: "target",
            points: [
                [100, 200],
                [160, 200],
                [160, 320],
                [100, 320],
            ] as typeof source.points,
        };
        const moved = transferPackagingLayer(
            text,
            {
                ...source,
                points: [
                    [0, 0],
                    [100, 0],
                    [100, 80],
                    [0, 80],
                ],
            },
            target,
        );
        expect((moved.x + moved.width / 2 - 100) / 60).toBeCloseTo((text.x + text.width / 2) / 100);
        expect((moved.y + moved.height / 2 - 200) / 120).toBeCloseTo((text.y + text.height / 2) / 80);
        expect(moved.width / moved.height).toBeCloseTo(text.width / text.height);
        expect(packagingTextSize(moved)).toBeCloseTo(2.4);
        expect(moved.panelId).toBe("target");
        expect(text.panelId).toBe("box-front");
        const trackingOnly = { ...art, content: { ...art.content!, letterSpacing: 1 } } as PackagingArtwork;
        const legacyMoved = transferPackagingLayer(
            trackingOnly,
            {
                ...source,
                points: [
                    [0, 0],
                    [100, 0],
                    [100, 80],
                    [0, 80],
                ],
            },
            target,
        );
        expect(legacyMoved.content?.kind === "text" && legacyMoved.content.letterSpacing).toBeCloseTo(0.6);
    });
    test("3mm 安全区缩进外边并扩大开窗，不把孔洞当安全区", () => {
        const compiled = compilePackaging(document);
        const panel = {
            ...compiled.panels[0],
            id: "box-front",
            points: [
                [0, 0],
                [100, 0],
                [100, 80],
                [0, 80],
            ] as (typeof compiled.cuts)[0],
            holes: [
                [
                    [40, 30],
                    [60, 30],
                    [60, 50],
                    [40, 50],
                ],
            ] as typeof compiled.cuts,
        };
        const layout = { ...compiled, panels: [panel], cuts: [panel.points, ...panel.holes] };
        const safe = packagingSafeArea(layout);
        expect(Math.abs(safe.reduce((sum, polygon) => sum + ClipperLib.Clipper.Area(polygon.map(([X, Y]) => ({ X, Y }))), 0))).toBeCloseTo(94 * 74 - 26 * 26);
        for (const [x, y, warned] of [
            [5, 5, false],
            [1, 5, true],
            [44, 32, true],
        ] as const) {
            const a = { ...text, x, y, width: 8, height: 12 };
            expect(packagingPreflight({ ...document, artworks: [a] }, layout, new Map(), fixedFont).issues.some((i) => i.code === "text_safety")).toBe(warned);
        }
    });
});

describe("原生设计与方案合同", () => {
    test("所有工艺可用于原生图层，非法字体与伪装的资源引用被拒绝", () => {
        for (const role of packagingRoles) expect(parsePackagingDocument({ ...document, artworks: [{ ...art, role }] }).artworks[0].role).toBe(role);
        expect(() => parsePackagingDocument({ ...document, artworks: [{ ...art, resourceId: "foreign" }] })).toThrow("不能引用");
        expect(() => parsePackagingDocument({ ...document, artworks: [{ ...art, content: { ...art.content, font: "https://invalid.test" } }] })).toThrow();
        expect(() => parsePackagingDocument({ ...document, surface: { ...document.surface, quality: "2048" } })).toThrow();
        expect(packagingResourceIds({ ...document, artworks: [art] })).toEqual([]);
    });
    test("文字与形状不虚报图片缺失，工艺 SVG 转义内容并输出白色轮廓", () => {
        const d = { ...document, artworks: [art] };
        const layout = compilePackaging(d);
        expect(packagingPreflight(d, layout, new Map()).issues.some((i) => i.code === "resource_missing")).toBe(false);
        const svg = packagingProcessSvg(d, layout, new Map(), "foil");
        expect(svg).toContain("品牌&lt;&amp;");
        expect(svg).toContain('fill="white"');
        expect(svg).not.toContain('id="CUT"');
        expect(packagingLayerMarkup({ ...art, content: { kind: "shape", shape: "ellipse", color: "#ffffff" } }, "")).toContain("<ellipse");
    });
    test("完整原生方案 ZIP 无需伪造图片，可重新导入所有图层与材质", async () => {
        const sample = packagingSampleDocument(document.template, document.material);
        const blob = await packagingProjectZip("原生方案", sample, new Map(), compilePackaging(sample), new Map());
        const imported = readPackagingProjectZip(new Uint8Array(await blob.arrayBuffer()));
        expect(imported.document).toEqual(sample);
        expect(imported.resources.size).toBe(0);
        expect(sample.artworks.some((a) => a.role === "foil")).toBe(true);
    });
    test("调整同一盒型的尺寸，保持面板中相对中心与图层比例", () => {
        const d = { ...document, artworks: [art] };
        const before = compilePackaging(d),
            after = compilePackaging({ ...d, parameters: { ...d.parameters, length: 200, height: 120 } });
        const changed = reflowPackagingLayers(d, before, after)[0];
        const bounds = (layout: typeof before) => {
            const p = layout.panels.find((p) => p.id === art.panelId)!;
            const x = Math.min(...p.points.map((p) => p[0])),
                y = Math.min(...p.points.map((p) => p[1]));
            return { x, y, w: Math.max(...p.points.map((p) => p[0])) - x, h: Math.max(...p.points.map((p) => p[1])) - y };
        };
        const a = bounds(before),
            b = bounds(after);
        expect((changed.x + changed.width / 2 - b.x) / b.w).toBeCloseTo((art.x + art.width / 2 - a.x) / a.w);
        expect(changed.width / changed.height).toBeCloseTo(art.width / art.height);
        expect(changed.rotation).toBe(art.rotation);
    });
    test("面板出血扩展只进入外轮廓，不跨入相邻面板", () => {
        const layout = compilePackaging(document);
        const clip = packagingLayerClip(art, layout, document.parameters.bleed);
        const panel = layout.panels.find((p) => p.id === art.panelId)!;
        expect(clip[0]).toEqual(panel.points);
        expect(clip.length).toBeGreaterThan(1);
        const right = Math.max(...panel.points.map((p) => p[0]));
        expect(Math.max(...clip.flat().map((p) => p[0]))).toBeLessThanOrEqual(right + 3.001);
    });
    test("隐藏图层退出视觉分版，锁定图层保留在完整方案", async () => {
        const d = { ...document, artworks: [{ ...art, visible: false, locked: true }] };
        expect(packagingProcessSvg(d, compilePackaging(d), new Map(), "foil")).not.toContain("品牌&lt;&amp;");
        const imported = readPackagingProjectZip(new Uint8Array(await (await packagingProjectZip("隐藏图层", d, new Map(), compilePackaging(d), new Map())).arrayBuffer()));
        expect(imported.document.artworks[0]).toEqual(d.artworks[0]);
    });
    test("折叠开合保持印刷面坐标方向", () => {
        const scene = buildPackagingScene(document, compilePackaging(document));
        expect(scene.root.scale.toArray()).toEqual([-1, 1, 1]);
        scene.apply(0.5, 0.5);
        expect(scene.root.scale.toArray()).toEqual([-1, 1, 1]);
        scene.dispose();
    });
});

describe("彩稿与工艺 PDF", () => {
    const rgba = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255, 255, 128, 128, 128, 255]);
    test("CMYK 转换保留黑版；灰度分版反相为黑色工艺区域", () => {
        expect([...packagingPrintPixels(rgba, "cmyk").slice(0, 8)]).toEqual([0, 255, 255, 0, 0, 0, 0, 255]);
        expect([...packagingPrintPixels(rgba, "gray")]).toEqual([201, 255, 0, 127]);
    });
    test("实际 PDF 图像色彩、矢量专色、叠印、裁切框与比例正确", async () => {
        const layout = compilePackaging(document);
        const blob = await packagingArtworkPdf("印刷验收", layout, rgba, 2, 2, "cmyk");
        const pdf = await PDFDocument.load(await blob.arrayBuffer());
        const page = pdf.getPages()[0];
        expect(page.getWidth()).toBeCloseTo(((layout.bounds.width + 12) * 72) / 25.4);
        expect(page.getTrimBox().width).toBeCloseTo(((layout.bounds.width - 6) * 72) / 25.4, 3);
        const streams = pdf.context
            .enumerateIndirectObjects()
            .map(([, object]) => object)
            .filter((object): object is PDFRawStream => object instanceof PDFRawStream);
        const image = streams.find((stream) => stream.dict.get(PDFName.of("Subtype"))?.toString() === "/Image")!;
        expect(image.dict.get(PDFName.of("ColorSpace"))?.toString()).toBe("/DeviceCMYK");
        expect([...decodePDFRawStream(image).decode()]).toEqual([...packagingPrintPixels(rgba, "cmyk")]);
        const bytes = streams
            .filter((s) => s !== image)
            .map((s) => new TextDecoder().decode(decodePDFRawStream(s).decode()))
            .join("");
        expect(bytes).toContain("/Overprint gs");
        expect(bytes).toContain("/Cut CS 1 SCN");
        expect(page.node.Resources().toString()).toContain("/CutContour");
        expect(page.node.Resources().toString()).toContain("/OP true");
        const plate = await PDFDocument.load(await (await packagingArtworkPdf("工艺版", layout, rgba, 2, 2, "gray")).arrayBuffer());
        const plateStreams = plate.context
            .enumerateIndirectObjects()
            .map(([, o]) => o)
            .filter((o): o is PDFRawStream => o instanceof PDFRawStream);
        expect(
            plateStreams
                .filter((s) => s.dict.get(PDFName.of("Subtype"))?.toString() !== "/Image")
                .map((s) => new TextDecoder().decode(decodePDFRawStream(s).decode()))
                .join(""),
        ).not.toContain("/Cut CS");
    });
});
