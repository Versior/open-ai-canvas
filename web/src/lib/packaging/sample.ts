import { compilePackaging } from "./geometry";
import { packagingPanelBounds } from "./production";
import { newPackagingDocument, type PackagingArtwork, type PackagingMaterial, type PackagingTemplate } from "./types";

export function packagingSampleDocument(template: PackagingTemplate, material: PackagingMaterial) {
    const document = newPackagingDocument(template, material);
    const layout = compilePackaging(document);
    const panel = layout.panels.find((p) => p.id.endsWith("-front")) || layout.panels[0];
    const b = packagingPanelBounds(panel.points);
    const layer = (id: string, role: PackagingArtwork["role"], y: number, width: number, height: number, content: NonNullable<PackagingArtwork["content"]>): PackagingArtwork => ({
        id,
        resourceId: "",
        name: id === "sample-brand" ? "品牌 · 烫金文字" : id === "sample-mark" ? "标识 · 局部 UV" : id === "sample-base" ? "正面底色" : "产品说明",
        panelId: panel.id,
        role,
        x: b.x + (b.width - width) / 2,
        y: b.y + y,
        width,
        height,
        rotation: 0,
        opacity: 1,
        content,
    });
    document.artworks = [
        { ...layer("sample-base", "artwork", 0, b.width, b.height, { kind: "shape", shape: "rectangle", color: "#294e4a" }), x: b.x - 3, y: b.y - 3, width: b.width + 6, height: b.height + 6 },
        layer("sample-brand", "foil", b.height * 0.2, b.width * 0.82, b.height * 0.13, { kind: "text", value: "YINGCE", font: "serif", weight: 700, align: "center", color: "#d9b465" }),
        layer("sample-copy", "artwork", b.height * 0.4, b.width * 0.85, b.height * 0.12, { kind: "text", value: "包装设计\nDESIGNED WITH CARE", font: "sans", weight: 400, align: "center", color: "#f4ede0" }),
        layer("sample-mark", "uv", b.height * 0.65, b.width * 0.28, b.height * 0.12, { kind: "shape", shape: "ellipse", color: "#ffffff" }),
    ];
    document.surface = { ...document.surface!, film: "matte" };
    document.view.layout = "model";
    return document;
}
