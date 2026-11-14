import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { AnimationClip, QuaternionKeyframeTrack, VectorKeyframeTrack, type Group } from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { deliveryFileStem, xmlText } from "@/lib/delivery-text";
import { packagingFoldQuaternion } from "./scene";
import { type PackagingDocument, type PackagingLayout, type Point } from "./types";
import { parsePackagingDocument } from "./import-contract";
import { compilePackaging } from "./geometry";

export const packagingPath = (points: Point[], close = true) => points.map((point, index) => `${index ? "L" : "M"}${point[0].toFixed(3)} ${point[1].toFixed(3)}`).join(" ") + (close ? " Z" : "");

export function packagingSvg(d: PackagingDocument, layout: PackagingLayout, images: Map<string, string> = new Map(), withDimensions = true) {
    const b = layout.bounds;
    const pad = withDimensions ? 25 : 0;
    const defs =
        `<clipPath id="structure"><path d="${layout.cuts.map((v) => packagingPath(v)).join(" ")}" clip-rule="evenodd"/></clipPath>` +
        layout.panels.map((p) => `<clipPath id="${p.id}"><path d="${[p.points, ...p.holes].map((v) => packagingPath(v)).join(" ")}" clip-rule="evenodd"/></clipPath>`).join("");
    const art = d.artworks
        .filter((a) => a.role === "artwork")
        .map((a) =>
            images.has(a.resourceId)
                ? `<g clip-path="url(#${xmlText(a.panelId || "structure")})"><image x="${a.x}" y="${a.y}" width="${a.width}" height="${a.height}" opacity="${a.opacity}" transform="rotate(${a.rotation} ${a.x + a.width / 2} ${a.y + a.height / 2})" href="${xmlText(images.get(a.resourceId)!)}"/></g>`
                : "",
        )
        .join("");
    const cuts = layout.cuts.map((p) => `<path d="${packagingPath(p)}"/>`).join("");
    const creases = layout.creases.map((p) => `<path d="${packagingPath(p, false)}"/>`).join("");
    const bleed = layout.bleed.map((p) => `<path d="${packagingPath(p)}"/>`).join("");
    const dimensions = withDimensions
        ? layout.dimensions.map((v) => `<path d="${packagingPath([v.a, v.b], false)}"/><text x="${(v.a[0] + v.b[0]) / 2}" y="${(v.a[1] + v.b[1]) / 2 - 2}" text-anchor="middle" stroke="none" fill="#555" font-size="4">${xmlText(v.label)}</text>`).join("")
        : "";
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${b.width + pad * 2}mm" height="${b.height + pad * 2}mm" viewBox="${b.x - pad} ${b.y - pad} ${b.width + pad * 2} ${b.height + pad * 2}"><title>${xmlText(d.template.name)} · 包装刀板</title><desc>毫米单位；切线红色、折线蓝色、出血绿色。投产前核对白样与纸厚。</desc><defs>${defs}</defs><g id="ARTWORK">${art}</g><g fill="none" stroke-width="0.2"><g id="CUT" stroke="#d83243">${cuts}</g><g id="CREASE" stroke="#386dc2" stroke-dasharray="2 1">${creases}</g><g id="BLEED" stroke="#529858">${bleed}</g><g id="DIMENSION" stroke="#555">${dimensions}</g></g></svg>`;
}

export function packagingDxf(layout: PackagingLayout) {
    const lines: (number | string)[] = [0, "SECTION", 2, "HEADER", 9, "$ACADVER", 1, "AC1021", 9, "$INSUNITS", 70, 4, 0, "ENDSEC", 0, "SECTION", 2, "TABLES", 0, "TABLE", 2, "LAYER", 70, 4];
    for (const [name, color] of [
        ["CUT", 1],
        ["CREASE", 5],
        ["BLEED", 3],
        ["DIMENSION", 7],
    ])
        lines.push(0, "LAYER", 2, name, 70, 0, 62, color, 6, "CONTINUOUS");
    lines.push(0, "ENDTAB", 0, "ENDSEC", 0, "SECTION", 2, "ENTITIES");
    const path = (points: Point[], layer: string, closed: boolean) => {
        lines.push(0, "LWPOLYLINE", 100, "AcDbEntity", 8, layer, 100, "AcDbPolyline", 90, points.length, 70, closed ? 1 : 0);
        for (const [x, y] of points) lines.push(10, x, 20, -y);
    };
    layout.cuts.forEach((v) => path(v, "CUT", true));
    layout.creases.forEach((v) => path(v, "CREASE", false));
    layout.bleed.forEach((v) => path(v, "BLEED", true));
    for (const v of layout.dimensions) {
        path([v.a, v.b], "DIMENSION", false);
        lines.push(0, "TEXT", 100, "AcDbEntity", 8, "DIMENSION", 100, "AcDbText", 10, (v.a[0] + v.b[0]) / 2, 20, -(v.a[1] + v.b[1]) / 2, 30, 0, 40, 4, 1, v.label);
    }
    lines.push(0, "ENDSEC", 0, "EOF");
    return lines.join("\r\n");
}

export async function packagingGlb(root: Group, layout: PackagingLayout, animated: boolean) {
    const copy = root.clone(true);
    copy.scale.setScalar(0.001);
    const animations: AnimationClip[] = [];
    if (animated) {
        const times = Array.from({ length: 41 }, (_, i) => i / 10);
        const tracks = layout.panels
            .filter((p) => p.hinge)
            .map(
                (panel) =>
                    new QuaternionKeyframeTrack(
                        `${panel.id}.quaternion`,
                        times,
                        times.flatMap((time) => packagingFoldQuaternion(panel, time / 4).toArray()),
                    ),
            );
        animations.push(new AnimationClip("Packaging fold", 4, tracks));
        const opening = layout.panels
            .filter((p) => p.hinge)
            .map(
                (panel) =>
                    new QuaternionKeyframeTrack(
                        `${panel.id}.quaternion`,
                        times,
                        times.flatMap((time) =>
                            packagingFoldQuaternion(panel, 1)
                                .slerp(packagingFoldQuaternion(panel, panel.lid ? 0 : 1), time / 4)
                                .toArray(),
                        ),
                    ),
            );
        const movement = layout.parts
            .filter((p) => p.openTranslation.some((v) => v !== 0))
            .map(
                (part) =>
                    new VectorKeyframeTrack(
                        `${part.id}.position`,
                        times,
                        times.flatMap((time) => part.translation.map((v, index) => v + (part.openTranslation[index] * time) / 4)),
                    ),
            );
        animations.push(new AnimationClip("Packaging open", 4, [...opening, ...movement]));
        for (const panel of layout.panels.filter((p) => p.hinge)) copy.getObjectByName(panel.id)!.quaternion.identity();
        for (const part of layout.parts) copy.getObjectByName(part.id)!.position.set(...part.translation);
    }
    const result = await new GLTFExporter().parseAsync(copy, { binary: true, animations, maxTextureSize: 4096, trs: true });
    if (!(result instanceof ArrayBuffer)) throw new Error("GLB 导出未返回有效二进制模型");
    return new Blob([result], { type: "model/gltf-binary" });
}

export async function packagingProjectZip(name: string, document: PackagingDocument, resources: Map<string, Blob>, layout: PackagingLayout) {
    const embedded = new Map<string, string>();
    for (const [id, blob] of resources)
        embedded.set(
            id,
            await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result));
                reader.onerror = () => reject(reader.error);
                reader.readAsDataURL(blob);
            }),
        );
    const files: Record<string, Uint8Array> = {
        "project.json": strToU8(JSON.stringify({ format: "yingce-packaging", version: 1, name, document, resourceTypes: Object.fromEntries([...resources].map(([id, blob]) => [id, blob.type])) }, null, 2)),
        "dieline.svg": strToU8(packagingSvg(document, layout, embedded)),
        "dieline.dxf": strToU8(packagingDxf(layout)),
        "README.txt": strToU8("包装方案包含毫米刀版、图稿与参数。可在包装刀板页面导入。图稿与结构需经白样及印前校核；此包不表示已完成生产验证。"),
    };
    for (const [id, blob] of resources) files[`artworks/${id}`] = new Uint8Array(await blob.arrayBuffer());
    return new Blob([zipSync(files, { level: 6 })], { type: "application/zip" });
}

export function readPackagingProjectZip(bytes: Uint8Array) {
    if (bytes.byteLength > 100 * 1024 * 1024) throw new Error("方案包不能超过 100 MB");
    let total = 0;
    const files = unzipSync(bytes, {
        filter: (file) => {
            const included = file.name === "project.json" ? file.originalSize <= 256 * 1024 : /^artworks\/[A-Za-z0-9_-]{1,80}$/.test(file.name) && file.originalSize <= 25 * 1024 * 1024;
            if (included) total += file.originalSize;
            if (total > 100 * 1024 * 1024) throw new Error("解压后的图稿不能超过 100 MB");
            return included;
        },
    });
    if (!files["project.json"]) throw new Error("不是有效包装方案包");
    const data = JSON.parse(strFromU8(files["project.json"])) as { format?: unknown; version?: unknown; name?: unknown; document?: unknown; resourceTypes?: Record<string, unknown> };
    if (data.format !== "yingce-packaging" || data.version !== 1 || typeof data.name !== "string" || !data.name.trim() || [...data.name].length > 120) throw new Error("包装方案格式或版本无效");
    const document = parsePackagingDocument(data.document);
    const layout = compilePackaging(document);
    const resources = new Map<string, Blob>();
    for (const art of document.artworks) {
        if (art.panelId && !layout.panels.some((p) => p.id === art.panelId)) throw new Error("图稿引用了不存在的面板");
        if (!/^[A-Za-z0-9_-]{1,80}$/.test(art.resourceId) || !files[`artworks/${art.resourceId}`]) throw new Error("方案缺少原始图稿");
        const mime = data.resourceTypes?.[art.resourceId];
        if (typeof mime !== "string" || !["image/png", "image/jpeg", "image/webp", "image/svg+xml"].includes(mime)) throw new Error("方案图稿类型无效");
        resources.set(art.resourceId, new Blob([files[`artworks/${art.resourceId}`]], { type: mime }));
    }
    return { name: data.name, document, resources };
}

export function downloadPackaging(blob: Blob, name: string, extension: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${deliveryFileStem(name)}.${extension}`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}
