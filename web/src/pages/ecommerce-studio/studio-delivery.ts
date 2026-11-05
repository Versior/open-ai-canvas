import { ecommerceFileName, ecommercePlatform } from "@/lib/ecommerce/ecommerce-platform-specs";
import { rasterizeEcommerceDetailPage, type EcommerceDetailPageResult } from "@/lib/ecommerce/ecommerce-rasterize";
import type { EcommerceSlicePlatform } from "@/lib/ecommerce/ecommerce-slice";
import { studioEffectiveTextMode, studioModelAdapter, studioShotHasCopy } from "@/lib/ecommerce-studio/prompt-compiler";
import { studioShotPreview } from "@/lib/ecommerce-studio/product";
import { studioShotSpec, studioStyle } from "@/lib/ecommerce-studio/shot-specs";
import { typesetStudioImage } from "@/lib/ecommerce-studio/typeset";
import type { StudioOutput, StudioPlan, StudioProduct, StudioShot } from "@/lib/ecommerce-studio/types";
import { createZip } from "@/lib/zip";
import { getResourceBlob, resourceStorageKey } from "@/services/api/resources";

/**
 * 交付：把每张成品按需排字，装订详情长图、按平台切片，并打包文案与清单。
 * 图片先读成 Blob 再处理，避免跨域存储让画布被污染而无法导出。
 */
export type StudioComposedShot = { shot: StudioShot; output: StudioOutput; url: string; composed: boolean };

const SLICE_PLATFORMS: Partial<Record<StudioProduct["platform"], EcommerceSlicePlatform>> = { taobao: "taobao", jd: "jd", pdd: "pdd", douyin: "douyin" };

export function studioSlicePlatform(product: StudioProduct): EcommerceSlicePlatform {
    return SLICE_PLATFORMS[product.platform] || "generic";
}

function attemptModel(shot: StudioShot, output: StudioOutput) {
    return shot.attempts.find((attempt) => attempt.outputs.some((item) => item.resourceId === output.resourceId))?.model || "";
}

async function objectUrl(output: StudioOutput) {
    const blob = await getResourceBlob(resourceStorageKey(output.resourceId));
    if (!blob) throw new Error("成品图读取失败，请刷新后重试");
    return URL.createObjectURL(blob);
}

/** 需要程序排字的镜头在这里排上文字；其余原样使用。返回的 URL 由调用方负责释放。 */
export async function composeStudioShots(product: StudioProduct, plan: StudioPlan, signal?: AbortSignal): Promise<StudioComposedShot[]> {
    const family = product.dossier?.family || "generic";
    const style = studioStyle(product.style);
    const results: StudioComposedShot[] = [];
    for (const shot of plan.shots) {
        if (signal?.aborted) break;
        const output = studioShotPreview(shot);
        if (!output) continue;
        const spec = studioShotSpec(shot.role, family);
        const source = await objectUrl(output);
        const overlay = studioShotHasCopy(shot, spec) && spec.overlayZone && studioEffectiveTextMode(plan, studioModelAdapter(attemptModel(shot, output))).mode === "overlay";
        if (!overlay || !spec.overlayZone) {
            results.push({ shot, output, url: source, composed: false });
            continue;
        }
        try {
            const url = await typesetStudioImage({ imageUrl: source, zone: spec.overlayZone, content: { headline: shot.headline, subline: shot.subline, lines: shot.lines }, ink: style.ink, inkSoft: style.inkSoft });
            results.push({ shot, output, url, composed: true });
        } finally {
            URL.revokeObjectURL(source);
        }
    }
    return results;
}

export function releaseComposed(shots: StudioComposedShot[]) {
    for (const item of shots) if (item.url.startsWith("blob:")) URL.revokeObjectURL(item.url);
}

export function bindStudioDetailPage(product: StudioProduct, shots: StudioComposedShot[]) {
    // 屏与屏之间不留间隔：默认的 8px 白底间隔在长图里就是一道道白条。
    return rasterizeEcommerceDetailPage({ imageUrls: shots.map((item) => item.url), platform: studioSlicePlatform(product), code: product.name || "详情页", gap: 0 });
}

export function studioCopyText(product: StudioProduct) {
    const lines = [`商品：${product.name || product.dossier?.name || "未命名商品"}`, `平台：${ecommercePlatform(product.platform)?.name || product.platform}`];
    if (product.copy?.listingTitle) lines.push(`商品标题：${product.copy.listingTitle}`);
    if (product.copy?.headline) lines.push(`主标题：${product.copy.headline}`);
    if (product.copy?.subhead) lines.push(`副标题：${product.copy.subhead}`);
    const points = product.sellingPoints.filter((point) => point.enabled);
    if (points.length) lines.push("卖点：", ...points.map((point, index) => `${index + 1}. ${point.title}${point.detail ? `｜${point.detail}` : ""}`));
    if (product.copy?.bullets.length) lines.push("要点：", ...product.copy.bullets.map((bullet) => `- ${bullet}`));
    return lines.join("\n");
}

async function bytes(url: string) {
    const response = await fetch(url);
    if (!response.ok) throw new Error("导出文件读取失败");
    return response.blob();
}

function extension(type: string) {
    if (type.includes("jpeg")) return "jpg";
    if (type.includes("webp")) return "webp";
    return "png";
}

export async function exportStudioZip(product: StudioProduct, plan: StudioPlan, shots: StudioComposedShot[], detail?: EcommerceDetailPageResult) {
    const code = product.name.trim() || "商品";
    const files: { name: string; data: BlobPart }[] = [];
    const manifest: { index: number; role: string; title: string; resourceId: string; file: string; typeset: boolean }[] = [];
    for (const [index, item] of shots.entries()) {
        const blob = await bytes(item.url);
        const spec = studioShotSpec(item.shot.role, product.dossier?.family || "generic");
        const file = `${plan.kind === "detail" ? "分屏" : "主图"}/${ecommerceFileName({ code, role: spec.platformRole, index: index + 1, platformId: product.platform, extension: extension(blob.type) })}`;
        manifest.push({ index: index + 1, role: item.shot.role, title: item.shot.title, resourceId: item.output.resourceId, file, typeset: item.composed });
        files.push({ name: file, data: blob });
    }
    if (detail) {
        files.push({ name: "详情页长图.png", data: await bytes(detail.longImage.dataUrl) });
        for (const [index, piece] of detail.pieces.entries()) files.push({ name: `切片/${detail.fileNames[index]}`, data: await bytes(piece.dataUrl) });
    }
    files.push({ name: "文案.txt", data: studioCopyText(product) });
    files.push({
        name: "manifest.json",
        data: JSON.stringify({ product: { id: product.id, name: product.name, platform: product.platform }, plan: plan.kind, textMode: plan.textMode, exportedAt: new Date().toISOString(), shots: manifest, slices: detail?.fileNames || [] }, null, 2),
    });
    return createZip(files);
}
