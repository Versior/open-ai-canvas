import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { strFromU8, unzipSync } from "fflate";
import { newPackagingDocument, type PackagingArtwork } from "../src/lib/packaging/types";
import { compilePackaging } from "../src/lib/packaging/geometry";
import { packagingPreflight } from "../src/lib/packaging/preflight";
import { packagingProcessSvg, packagingProjectZip, packagingSvg, readPackagingProjectZip } from "../src/lib/packaging/delivery";

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
const art: PackagingArtwork = { id: "a", resourceId: "r", name: "验收图稿", role: "artwork", panelId: "box-front", x: 10, y: 10, width: 80, height: 40, rotation: 0, opacity: 1 };

describe("交付自动检查", () => {
    test("真实像素与毫米的较低轴 DPI，缺失资源阻断，低 DPI 只警告", () => {
        const d = { ...document, artworks: [art] };
        const layout = compilePackaging(d);
        const loaded = packagingPreflight(d, layout, new Map([["r", { width: 1600, height: 200 }]]));
        expect(loaded.artworks[0].dpi).toBe(127);
        expect(loaded.issues.find((i) => i.code === "low_resolution")?.severity).toBe("warning");
        expect(loaded.status).toBe("review");
        const missing = packagingPreflight(d, layout, new Map());
        expect(missing.status).toBe("blocked");
        expect(missing.artworks[0].dpi).toBeNull();
        expect(missing.issues.find((i) => i.code === "resource_missing")?.severity).toBe("error");
        expect(loaded.issues.some((i) => i.code === "bleed_review")).toBe(true);
    });
    test("裁切检测使用实际轮廓和孔洞，旋转后面积准确", () => {
        const d = { ...document, parameters: { ...document.parameters, windowWidth: 30, windowHeight: 25 }, artworks: [art] };
        const layout = compilePackaging(d);
        const hole = layout.panels.find((p) => p.id === art.panelId)!.holes[0];
        const inHole = { ...art, x: Math.min(...hole.map((p) => p[0])) + 10, y: Math.min(...hole.map((p) => p[1])) + 8, width: 5, height: 5, rotation: 45 };
        const sizes = new Map([["r", { width: 1000, height: 1000 }]]);
        const invisible = packagingPreflight({ ...d, artworks: [inHole] }, layout, sizes);
        expect(invisible.artworks[0].visibleAreaMm2).toBe(0);
        expect(invisible.issues.some((i) => i.code === "invisible_artwork")).toBe(true);
        const rotated = packagingPreflight({ ...document, artworks: [{ ...art, x: 30, y: 15, width: 20, height: 20, rotation: 45 }] }, compilePackaging(document), sizes);
        expect(rotated.artworks[0].visibleAreaMm2).toBeCloseTo(400, 1);
        expect(rotated.artworks[0].visibleFraction).toBeCloseTo(1, 4);
        expect(() => packagingPreflight({ ...d, artworks: [{ ...art, width: -2 }] }, layout, sizes)).toThrow();
    });
    test("结构白样报告真实切折长度，无图稿不虚报缺资源", () => {
        const layout = compilePackaging(document);
        const result = packagingPreflight(document, layout, new Map());
        expect(result.status).toBe("ready");
        expect(result.cutLengthMm).toBeGreaterThan(100);
        expect(result.creaseLengthMm).toBeGreaterThan(100);
        expect(result.issues).toHaveLength(0);
    });
});

describe("工艺和方案交付", () => {
    const embedded = new Map([["r", "data:image/png;base64,AA=="]]);
    test("SVG 去重原稿、强制真实变换比例、完整隐藏工艺组", () => {
        const d = { ...document, artworks: [art, { ...art, id: "copy" }, { ...art, id: "foil", role: "foil" as const }, { ...art, id: "uv", role: "uv" as const }, { ...art, id: "emboss", role: "emboss" as const }] };
        const svg = packagingSvg(d, compilePackaging(d), embedded);
        expect(svg.match(/data:image\/png;base64,AA==/g)).toHaveLength(1);
        expect(svg).toContain('preserveAspectRatio="none"');
        expect(svg).toContain("scale(80 40)");
        for (const role of ["FOIL", "UV", "EMBOSS"]) expect(svg).toContain(`id="${role}" display="none"`);
        expect(() => packagingSvg(d, compilePackaging(d))).toThrow("图稿尚未加载");
    });
    test("独立工艺稿和刀版画幅/坐标相同，无刀折线，统一 sRGB 亮度", () => {
        const d = { ...document, artworks: [{ ...art, role: "foil" as const }] };
        const layout = compilePackaging(d);
        const mask = packagingProcessSvg(d, layout, embedded, "foil");
        const svg = packagingSvg(d, layout, embedded);
        expect(mask.match(/viewBox="[^"]+"/)?.[0]).toBe(svg.match(/viewBox="[^"]+"/)?.[0]);
        expect(mask.match(/width="[^"]+mm" height="[^"]+mm"/)?.[0]).toBe(svg.match(/width="[^"]+mm" height="[^"]+mm"/)?.[0]);
        expect(mask).not.toContain('id="CUT"');
        expect(mask).not.toContain('id="CREASE"');
        expect(mask).toContain('color-interpolation-filters="sRGB"');
        expect(mask).toContain('clip-path="url(#box-front)"');
        expect(mask).toContain('fill="black"');
    });
    test("真实 ZIP 含原稿、三工艺和报告，可重新导入，忽略未引用资源", async () => {
        const previous = globalThis.FileReader;
        const browser = new Window();
        Object.defineProperty(globalThis, "FileReader", { configurable: true, writable: true, value: browser.FileReader });
        try {
            const d = { ...document, artworks: [art, ...(["foil", "uv", "emboss"] as const).map((role) => ({ ...art, id: role, role }))] };
            const resources = new Map([
                ["r", new browser.Blob([new Uint8Array([1, 2, 3])], { type: "image/png" })],
                ["unused", new browser.Blob(["unused"])],
            ]);
            const blob = await packagingProjectZip("验收方案", d, resources, compilePackaging(d), new Map([["r", { width: 2000, height: 1000 }]]));
            const bytes = new Uint8Array(await blob.arrayBuffer());
            const files = unzipSync(bytes);
            for (const role of ["foil", "uv", "emboss"]) expect(files[`process-${role}.svg`]).toBeDefined();
            expect(files["artworks/unused"]).toBeUndefined();
            const report = JSON.parse(strFromU8(files["preflight.json"]));
            expect(report.artworks).toHaveLength(4);
            expect(readPackagingProjectZip(bytes).document).toEqual(d);
            expect(new Uint8Array(await readPackagingProjectZip(bytes).resources.get("r")!.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
        } finally {
            Object.defineProperty(globalThis, "FileReader", { configurable: true, writable: true, value: previous });
        }
    });
    test("缺图、空名称与超大图稿拒绝完整方案导出", async () => {
        const d = { ...document, artworks: [art] };
        const layout = compilePackaging(d);
        await expect(packagingProjectZip("方案", d, new Map(), layout, new Map())).rejects.toThrow("不能完整交付");
        await expect(packagingProjectZip(" ", document, new Map(), compilePackaging(document), new Map())).rejects.toThrow("项目名称");
        await expect(packagingProjectZip("方案", d, new Map([["r", new Blob([new Uint8Array(26 * 1024 * 1024)])]]), layout, new Map([["r", { width: 1000, height: 1000 }]]))).rejects.toThrow("25 MB");
    });
});
