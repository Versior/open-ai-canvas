import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { AnimationClip, QuaternionKeyframeTrack, VectorKeyframeTrack, type Group } from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { deliveryFileStem, xmlText } from "@/lib/delivery-text";
import { packagingFoldQuaternion } from "./scene";
import { packagingRoles, type PackagingDocument, type PackagingLayout, type PackagingRole, type Point } from "./types";
import { parsePackagingDocument } from "./import-contract";
import { compilePackaging } from "./geometry";
import { packagingPreflight, type PackagingImageSize } from "./preflight";
import { packagingLayerClip, packagingLayerMarkup, packagingResourceIds, packagingVisibleLayers } from "./layers";
import type { PackagingTextMeasureFactory } from "./typography";

export const packagingPath = (points: Point[], close = true) => points.map((point, index) => `${index ? "L" : "M"}${point[0].toFixed(3)} ${point[1].toFixed(3)}`).join(" ") + (close ? " Z" : "");

function svgArtwork(d: PackagingDocument, layout: PackagingLayout, images: Map<string, string>, textMeasure?: PackagingTextMeasureFactory) {
    const ids = packagingResourceIds(d);
    if (ids.some((id) => !images.has(id))) throw new Error("图稿尚未加载，无法导出完整设计");
    const defs =
        `<clipPath id="structure"><path d="${layout.cuts.map((v) => packagingPath(v)).join(" ")}" clip-rule="evenodd"/></clipPath>` +
        layout.panels.map((p) => `<clipPath id="${p.id}"><path d="${[p.points, ...p.holes].map((v) => packagingPath(v)).join(" ")}" clip-rule="evenodd"/></clipPath>`).join("") +
        packagingVisibleLayers(d, "artwork")
            .map(
                (a) =>
                    `<clipPath id="print-${xmlText(a.id)}"><path d="${packagingLayerClip(a, layout, d.parameters.bleed)
                        .map((v) => packagingPath(v))
                        .join(" ")}" clip-rule="evenodd"/></clipPath>`,
            )
            .join("") +
        ids.map((id) => `<image id="asset-${xmlText(id)}" width="1" height="1" preserveAspectRatio="none" href="${xmlText(images.get(id)!)}"/>`).join("") +
        `<filter id="mask-luminance" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="0.2126 0.7152 0.0722 0 0 0.2126 0.7152 0.0722 0 0 0.2126 0.7152 0.0722 0 0 0 0 0 1 0"/></filter>`;
    const art = (role: PackagingDocument["artworks"][number]["role"]) =>
        packagingVisibleLayers(d, role)
            .map(
                (a) =>
                    `<g clip-path="url(#${xmlText(role === "artwork" ? `print-${a.id}` : a.panelId || "structure")})"><g opacity="${a.opacity}" transform="rotate(${a.rotation} ${a.x + a.width / 2} ${a.y + a.height / 2})"${role === "artwork" || a.content ? "" : ' filter="url(#mask-luminance)"'}>${a.content ? packagingLayerMarkup(a, "", role === "artwork" ? undefined : "white", a.content.kind === "text" ? textMeasure?.(a) : undefined) : `<use href="#asset-${xmlText(a.resourceId)}" transform="translate(${a.x} ${a.y}) scale(${a.width} ${a.height})"/>`}</g></g>`,
            )
            .join("");
    return { defs, art };
}

export function packagingSvg(d: PackagingDocument, layout: PackagingLayout, images: Map<string, string> = new Map(), withDimensions = true, textMeasure?: PackagingTextMeasureFactory) {
    const b = layout.bounds;
    const pad = withDimensions ? 25 : 0;
    const content = svgArtwork(d, layout, images, textMeasure);
    const cuts = layout.cuts.map((p) => `<path d="${packagingPath(p)}"/>`).join("");
    const creases = layout.creases.map((p) => `<path d="${packagingPath(p, false)}"/>`).join("");
    const bleed = layout.bleed.map((p) => `<path d="${packagingPath(p)}"/>`).join("");
    const dimensions = withDimensions
        ? layout.dimensions.map((v) => `<path d="${packagingPath([v.a, v.b], false)}"/><text x="${(v.a[0] + v.b[0]) / 2}" y="${(v.a[1] + v.b[1]) / 2 - 2}" text-anchor="middle" stroke="none" fill="#555" font-size="4">${xmlText(v.label)}</text>`).join("")
        : "";
    const masks = packagingRoles
        .filter((role) => role !== "artwork")
        .filter((role) => packagingVisibleLayers(d, role).length)
        .map((role) => `<g id="${role.toUpperCase()}" display="none"><rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" fill="black"/>${content.art(role)}</g>`)
        .join("");
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${b.width + pad * 2}mm" height="${b.height + pad * 2}mm" viewBox="${b.x - pad} ${b.y - pad} ${b.width + pad * 2} ${b.height + pad * 2}"><title>${xmlText(d.template.name)} · 包装刀板</title><desc>毫米单位；切线红色、折线蓝色、出血绿色。工艺组默认隐藏，白色生效、黑色无作用。图稿可延伸到外轮廓出血区；必须检查实际覆盖。文字使用所选系统字体。投产前核对白样、色彩与纸厚。</desc><defs>${content.defs}</defs><g id="ARTWORK">${content.art("artwork")}</g>${masks}<g fill="none" stroke-width="0.2"><g id="CUT" stroke="#d83243">${cuts}</g><g id="CREASE" stroke="#386dc2" stroke-dasharray="2 1">${creases}</g><g id="BLEED" stroke="#529858">${bleed}</g><g id="DIMENSION" stroke="#555">${dimensions}</g></g></svg>`;
}

export function packagingProcessSvg(d: PackagingDocument, layout: PackagingLayout, images: Map<string, string>, role: Exclude<PackagingRole, "artwork">, textMeasure?: PackagingTextMeasureFactory) {
    const content = svgArtwork({ ...d, artworks: d.artworks.filter((a) => a.role === role) }, layout, images, textMeasure);
    const b = layout.bounds;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${b.width + 50}mm" height="${b.height + 50}mm" viewBox="${b.x - 25} ${b.y - 25} ${b.width + 50} ${b.height + 50}"><title>${xmlText(d.template.name)} · ${role.toUpperCase()}</title><desc>与 dieline.svg 使用相同毫米画幅和坐标。白色作用、黑色无作用；灰度为预览强度，生产阈值与工艺线宽须由工厂核对。没有切折线。</desc><defs>${content.defs}</defs><g id="${role.toUpperCase()}"><rect x="${b.x - 25}" y="${b.y - 25}" width="${b.width + 50}" height="${b.height + 50}" fill="black"/>${content.art(role)}</g></svg>`;
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
        if (v.label) lines.push(0, "TEXT", 100, "AcDbEntity", 8, "DIMENSION", 100, "AcDbText", 10, (v.a[0] + v.b[0]) / 2, 20, -(v.a[1] + v.b[1]) / 2, 30, 0, 40, 4, 1, v.label);
    }
    lines.push(0, "ENDSEC", 0, "EOF");
    return lines.join("\r\n");
}

export async function packagingGlb(root: Group, layout: PackagingLayout, animated: boolean) {
    const copy = root.clone(true);
    copy.scale.multiplyScalar(0.001);
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
        const layers = layout.panels
            .filter((p) => p.inset)
            .flatMap((panel) =>
                ["paper", "print"].map(
                    (face) =>
                        new VectorKeyframeTrack(
                            `${panel.id}-${face}.position`,
                            times,
                            times.flatMap((time) => [0, 0, (panel.inset * time) / 4]),
                        ),
                ),
            );
        animations.push(new AnimationClip("Packaging fold", 4, [...tracks, ...layers]));
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
        const closedLayers = layout.panels.filter((p) => p.inset).flatMap((panel) => ["paper", "print"].map((face) => new VectorKeyframeTrack(`${panel.id}-${face}.position`, [0, 4], [0, 0, panel.inset, 0, 0, panel.inset])));
        animations.push(new AnimationClip("Packaging open", 4, [...opening, ...movement, ...closedLayers]));
        for (const panel of layout.panels.filter((p) => p.hinge)) copy.getObjectByName(panel.id)!.quaternion.identity();
        for (const panel of layout.panels.filter((p) => p.inset)) for (const face of ["paper", "print"]) copy.getObjectByName(`${panel.id}-${face}`)!.position.z = 0;
        for (const part of layout.parts) copy.getObjectByName(part.id)!.position.set(...part.translation);
    }
    const result = await new GLTFExporter().parseAsync(copy, { binary: true, animations, maxTextureSize: 4096, trs: true });
    if (!(result instanceof ArrayBuffer)) throw new Error("GLB 导出未返回有效二进制模型");
    return new Blob([result], { type: "model/gltf-binary" });
}

export async function packagingProjectZip(name: string, document: PackagingDocument, resources: Map<string, Blob>, layout: PackagingLayout, images: Map<string, PackagingImageSize>, textMeasure?: PackagingTextMeasureFactory) {
    if (!name.trim() || [...name].length > 120) throw new Error("项目名称须为 1–120 个字符");
    const preflight = packagingPreflight(document, layout, images, textMeasure);
    if (preflight.status === "blocked")
        throw new Error(
            preflight.issues
                .filter((i) => i.severity === "error")
                .map((i) => i.message)
                .join("；"),
        );
    const used = new Map(
        packagingResourceIds(document).map((id) => {
            const blob = resources.get(id);
            if (!blob) throw new Error("方案缺少原始图稿，无法导出完整设计");
            return [id, blob] as const;
        }),
    );
    const projectJson = JSON.stringify({ format: "yingce-packaging", version: 1, name, document, resourceTypes: Object.fromEntries([...used].map(([id, blob]) => [id, blob.type])) }, null, 2);
    if ([...used.values()].some((blob) => blob.size > 25 * 1024 * 1024)) throw new Error("单张图稿不能超过 25 MB");
    if (strToU8(projectJson).length > 256 * 1024 || [...used.values()].reduce((sum, blob) => sum + blob.size, strToU8(projectJson).length) > 100 * 1024 * 1024) throw new Error("方案原稿总量超过 100 MB，无法生成可重新导入的方案包");
    const embedded = new Map<string, string>();
    for (const [id, blob] of used)
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
        "project.json": strToU8(projectJson),
        "dieline.svg": strToU8(packagingSvg(document, layout, embedded, true, textMeasure)),
        "dieline.dxf": strToU8(packagingDxf(layout)),
        "preflight.json": strToU8(JSON.stringify(preflight, null, 2)),
        "README.txt": strToU8(
            "包装方案包含毫米刀版、原生图层、原稿与材质参数，可重新导入。preflight.json 记录自动检查。工艺 SVG 与 dieline.svg 同坐标，白色作用、黑色无作用，无切折线。图稿可延伸到外轮廓出血区，实际出血覆盖须复核。SVG 文字使用系统字体；图稿为 RGB。工艺灰度、线宽、色彩、套准、纸厚及白样须经工厂核对。",
        ),
    };
    for (const role of packagingRoles) if (role !== "artwork" && packagingVisibleLayers(document, role).length) files[`process-${role}.svg`] = strToU8(packagingProcessSvg(document, layout, embedded, role, textMeasure));
    for (const [id, blob] of used) files[`artworks/${id}`] = new Uint8Array(await blob.arrayBuffer());
    const bytes = zipSync(files, { level: 6 });
    if (bytes.length > 100 * 1024 * 1024) throw new Error("含交付文件的方案包超过 100 MB，请减少图稿后导出");
    return new Blob([bytes], { type: "application/zip" });
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
        if (art.content) continue;
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
