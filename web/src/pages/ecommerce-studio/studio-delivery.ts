import { ecommerceFileName, ecommercePlatform } from "@/lib/ecommerce/ecommerce-platform-specs";
import { rasterizeEcommerceDetailPage, rasterizeEcommerceLongImage, rasterizeEcommerceNativeDetail } from "@/lib/ecommerce/ecommerce-rasterize";
import { ecommerceSliceFileName, ecommerceSliceSpec } from "@/lib/ecommerce/ecommerce-slice";
import { studioSlicePlatform } from "@/lib/ecommerce-studio/delivery-geometry";
import { studioCandidateCopy } from "@/lib/ecommerce-studio/delivery-copy";
import { studioDisplayName, studioLanguage } from "@/lib/ecommerce-studio/brief";
import { studioModelAdapter, studioShotHasCopy } from "@/lib/ecommerce-studio/prompt-compiler";
import { studioAttemptForOutput, studioShotPreview } from "@/lib/ecommerce-studio/product";
import { studioActivePlan } from "@/lib/ecommerce-studio/runs";
import { studioProductStyle, studioShotPlatformRole, studioShotSpec, studioStyle } from "@/lib/ecommerce-studio/shot-specs";
import { typesetStudioImage } from "@/lib/ecommerce-studio/typeset";
import { studioDesignZone } from "@/lib/ecommerce-studio/art-direction";
import type { StudioOutput, StudioPlan, StudioProduct, StudioShot } from "@/lib/ecommerce-studio/types";
import { createZip } from "@/lib/zip";
import { mediaFormatLabel } from "@/lib/media-spec";
import { assertCurrentUserSession, captureUserSession } from "@/lib/user-scope";
import { getResourceBlob, resourceStorageKey } from "@/services/api/resources";
import { downloadBrowserMedia } from "@/services/browser-download";
import type { StudioDeliveryReview } from "@/lib/ecommerce-studio/delivery-review";
import { prepareStudioDetailAssembly } from "./studio-detail-assembly";

/**
 * 交付：把每张成品按需排字，装订详情长图、按平台切片，并打包文案与清单。
 * 图片先读成 Blob 再处理，避免跨域存储让画布被污染而无法导出。
 */
export type StudioComposedShot = { shot: StudioShot; output: StudioOutput; url: string; composed: boolean };

export type StudioArchiveKind = "complete" | "originals" | "draft";

/** 只为历史无字底图保留旧排字；新候选的实际模式优先于所在旧方案。 */
export function studioOutputNeedsLegacyTypeset(plan: Pick<StudioPlan, "textMode">, shot: StudioShot, output: StudioOutput) {
    const attempt = shot.attempts.find((item) => item.outputs.some((value) => value.resourceId === output.resourceId));
    if (attempt?.textMode) return attempt.textMode === "overlay";
    // New planned screens are rendered by the image model in one pass. Some
    // historical attempts did not persist textMode, so the old weak-model
    // fallback must not turn a content brief back into programmatic overlay
    // typesetting. Only unplanned legacy shots use the fallback below.
    if (shot.visual?.trim() || shot.purchaseQuestion?.trim() || shot.displayContent?.trim() || shot.visualFocus?.trim() || shot.visualBeat?.trim()) return false;
    return plan.textMode === "overlay" || studioModelAdapter(attempt?.model || "").textRendering === "weak";
}

async function objectUrl(output: StudioOutput, signal?: AbortSignal) {
    const blob = await getResourceBlob(resourceStorageKey(output.resourceId), "ecommerce-export", signal);
    if (!blob) throw new Error("成品图读取失败，请刷新后重试");
    return URL.createObjectURL(blob);
}

/** 需要程序排字的镜头在这里排上文字；其余原样使用。返回的 URL 由调用方负责释放。 */
export async function composeStudioShots(product: StudioProduct, plan: StudioPlan, signal?: AbortSignal): Promise<StudioComposedShot[]> {
    const family = product.dossier?.family || "generic";
    const style = plan.styleId ? studioStyle(plan.styleId) : studioProductStyle(product, studioActivePlan(product)?.styleId);
    const results: StudioComposedShot[] = [];
    try {
        for (const shot of plan.shots) {
            if (signal?.aborted) throw new DOMException("导出已停止", "AbortError");
            const output = studioShotPreview(shot);
            if (!output) continue;
            const spec = studioShotSpec(shot.role, family);
            const source = await objectUrl(output, signal);
            const overlay = studioShotHasCopy(shot, spec) && spec.overlayZone && studioOutputNeedsLegacyTypeset(plan, shot, output);
            if (!overlay || !spec.overlayZone) {
                results.push({ shot, output, url: source, composed: false });
                continue;
            }
            try {
                const url = await typesetStudioImage({
                    imageUrl: source,
                    zone: studioDesignZone(shot, spec.overlayZone),
                    content: { headline: shot.headline, subline: shot.subline, lines: shot.lines, eyebrow: shot.eyebrow },
                    ink: style.ink,
                    inkSoft: style.inkSoft,
                    layout: shot.layout,
                    tone: plan.tone,
                });
                results.push({ shot, output, url, composed: true });
            } finally {
                URL.revokeObjectURL(source);
            }
        }
        if (signal?.aborted) throw new DOMException("导出已停止", "AbortError");
        return results;
    } catch (error) {
        releaseComposed(results);
        throw error;
    }
}

export function releaseComposed(shots: StudioComposedShot[]) {
    for (const item of shots) if (item.url.startsWith("blob:")) URL.revokeObjectURL(item.url);
}

export async function downloadStudioComposed(product: StudioProduct, plan: StudioPlan) {
    const shots = await composeStudioShots(product, plan);
    try {
        for (const [index, item] of shots.entries()) {
            if (index) await new Promise((resolve) => window.setTimeout(resolve, 400));
            const fileName = `${product.name || "商品"}-${item.shot.title || "商品图"}-${index + 1}.png`.replace(/[\\/:*?"<>|]+/g, "_");
            await downloadBrowserMedia({ fileName, url: item.url });
        }
    } finally {
        releaseComposed(shots);
    }
}

function deliveryRows(plan: StudioPlan, shots: StudioComposedShot[], kind: StudioArchiveKind) {
    if (!shots.length) throw new Error("没有可交付的成品图");
    const byId = new Map(shots.map((item) => [item.shot.id, item]));
    const rows = plan.shots.map((shot, index) => ({ index: index + 1, shot, item: byId.get(shot.id) }));
    const missing = rows.filter((row) => !row.item);
    if (kind !== "draft" && missing.length) throw new Error(`完整交付缺第 ${missing.map((row) => row.index).join("、")} 张；请补齐，或明确下载已出分屏草稿。`);
    return rows;
}

export function bindStudioLongImage(product: StudioProduct, plan: StudioPlan, shots: StudioComposedShot[], signal?: AbortSignal, inspectAll = false) {
    const ordered = deliveryRows(plan, shots, "complete").map((row) => row.item!);
    const width = ecommerceSliceSpec(studioSlicePlatform(product.platform))!.width;
    if (plan.kind !== "detail") return rasterizeEcommerceLongImage({ imageUrls: ordered.map((item) => item.url), width, gap: 0 });
    return prepareStudioDetailAssembly(ordered, signal, inspectAll).then(async (assembly) => {
        try {
            return await rasterizeEcommerceLongImage({ imageUrls: assembly.imageUrls, width, gap: 0 });
        } finally {
            assembly.release();
        }
    });
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

export async function exportStudioNativeDetail(product: StudioProduct, selected: StudioOutput, signal?: AbortSignal): Promise<Blob> {
    const session = captureUserSession();
    const boundary = signal ? AbortSignal.any([signal, session.signal]) : session.signal;
    boundary.throwIfAborted();
    if (session.userId === "guest") throw new Error("请登录后导出章节原图");
    const resourceId = selected.resourceId;
    if (!product.id || !resourceId) throw new Error("缺少商品或原图标识");
    const groups = [...product.runs, ...product.plans];
    const native = groups.some((group) => group.shots.some((shot) => studioAttemptForOutput(shot, resourceId)?.status === "succeeded" && !studioOutputNeedsLegacyTypeset(group, shot, selected)));
    if (!native) throw new Error("请选择当前商品已完成的原生图片");

    const original = await getResourceBlob(resourceStorageKey(resourceId), "ecommerce-export", boundary);
    assertCurrentUserSession(session);
    if (!original) throw new Error("章节原图读取失败，请刷新后重试");
    const platform = studioSlicePlatform(product.platform);
    const { sourceSize, longImage, pieces } = await rasterizeEcommerceNativeDetail(original, platform, boundary);
    const format = mediaFormatLabel(original.type).toLowerCase();
    const originalFile = `原图/原生章节.${original.type.startsWith("image/") && /^[a-z0-9]{2,5}$/.test(format) ? format : "bin"}`;
    const longFile = "详情页长图.png";
    const code = studioDisplayName(product)
        .replace(/[\\/:*?"<>|]+/g, "_")
        .slice(0, 60);
    const slices = pieces.map(({ index, top, height }) => ({ index, left: 0, top, width: longImage.width, height, file: `切片/${ecommerceSliceFileName({ code, index, total: pieces.length, extension: "png" })}` }));
    const manifest = {
        archiveKind: "native-detail",
        product: { id: product.id, name: product.name, platform: product.platform },
        slicePlatform: platform,
        source: { resourceId, file: originalFile, ...sourceSize },
        longImage: { file: longFile, width: longImage.width, height: longImage.height },
        sliceCount: slices.length,
        slices,
    };
    const zip = await createZip([
        { name: originalFile, data: original },
        { name: longFile, data: longImage.blob },
        ...pieces.map((piece, index) => ({ name: slices[index].file, data: piece.blob })),
        { name: "manifest.json", data: JSON.stringify(manifest, null, 2) },
    ]);
    assertCurrentUserSession(session);
    boundary.throwIfAborted();
    return zip;
}

export async function exportStudioZip(product: StudioProduct, plan: StudioPlan, shots: StudioComposedShot[], kind: StudioArchiveKind, review: StudioDeliveryReview, signal?: AbortSignal, inspectAll = false) {
    const code = product.name.trim() || "商品";
    const files: { name: string; data: BlobPart }[] = [];
    const rows = deliveryRows(plan, shots, kind);
    const assembly =
        kind === "complete" && plan.kind === "detail"
            ? await prepareStudioDetailAssembly(
                  rows.map((row) => row.item!),
                  signal,
                  inspectAll,
              )
            : undefined;
    let detail: Awaited<ReturnType<typeof rasterizeEcommerceDetailPage>> | undefined;
    if (assembly) {
        try {
            detail = await rasterizeEcommerceDetailPage({ imageUrls: assembly.imageUrls, platform: studioSlicePlatform(product.platform), code, gap: 0 });
        } finally {
            assembly.release();
        }
    }
    const label = kind === "draft" ? "草稿 · 仅已出分屏，不是完整交付" : kind === "originals" ? "原始分屏 · 未生成平台切片" : "完整文件包 · 上架前仍须人工复核";
    const copyText = [label, `商品：${code}`, `平台：${ecommercePlatform(product.platform)?.name || product.platform}`, "按选购阅读顺序。定稿不等于图中实际文字，须对照成图复核。"];
    if (product.copy?.listingTitle) copyText.push(`商品上架标题：${product.copy.listingTitle}`);
    const manifest = [];
    for (const { index, shot, item } of rows) {
        signal?.throwIfAborted();
        copyText.push("", `第 ${index} 张 · ${shot.title}`);
        if (!item) {
            copyText.push("缺图，未交付");
            continue;
        }
        const blob = await bytes(item.url);
        const role = studioShotPlatformRole(shot.role, plan.kind, index);
        const file = `${plan.kind === "detail" ? "分屏" : "主图"}/${ecommerceFileName({ code, role, index, platformId: product.platform, extension: extension(blob.type) })}`;
        const copy = studioCandidateCopy(shot, item.output, product.brief.language, item.composed);
        const sourceLabel = copy.source === "plan-only" ? "仅策划记录；旧候选没有提交定稿快照，画面文字／译文待核对" : copy.source === "typeset" ? "本次排字使用的文案" : "该候选提交定稿";
        copyText.push(`目标语言：${studioLanguage(copy.language).label} · ${sourceLabel}`);
        if (copy.eyebrow) copyText.push(`栏目：${copy.eyebrow}`);
        if (copy.headline) copyText.push(`主标题：${copy.headline}`);
        if (copy.subline) copyText.push(`注解：${copy.subline}`);
        copyText.push(...copy.lines.map((line) => `要点：${line}`));
        if (!(copy.eyebrow || copy.headline || copy.subline || copy.lines.length)) copyText.push(copy.source === "submitted" && copy.language !== "none" ? "无锁定文案；图内文字以成品为准" : "无定稿文案记录");
        manifest.push({ index, role: shot.role, title: shot.title, resourceId: item.output.resourceId, file, typeset: item.composed, copy });
        files.push({ name: file, data: blob });
    }
    if (detail) {
        files.push({ name: "详情页长图.png", data: detail.longImage.blob });
        for (const [index, piece] of detail.pieces.entries()) files.push({ name: `切片/${detail.fileNames[index]}`, data: piece.blob });
    }
    files.push({ name: "文案.txt", data: copyText.join("\n") });
    files.push({ name: "交付检查.json", data: JSON.stringify(review, null, 2) });
    const findings = review.issues.map((issue) => `- ${issue.title}：${issue.message}`);
    files.push({ name: "交付检查.txt", data: [label, `成品文件 ${review.delivered}/${review.total} 张。图内文字、事实与平台上架资格尚未核实。`, ...findings, "人工复核：", ...review.manualChecks.map((item) => `- ${item}`)].join("\n") });
    files.push({
        name: "manifest.json",
        data: JSON.stringify(
            {
                product: { id: product.id, name: product.name, platform: product.platform },
                plan: plan.kind,
                textMode: plan.textMode,
                archiveKind: kind,
                exportedAt: new Date().toISOString(),
                expectedShots: plan.shots.length,
                complete: rows.every((row) => row.item),
                missingShots: rows.filter((row) => !row.item).map(({ index, shot }) => ({ index, id: shot.id, title: shot.title })),
                shots: manifest,
                slices: detail?.fileNames || [],
                ...(assembly?.joins.length ? { joins: assembly.joins } : {}),
                reviewIssues: review.issues.length,
                publication: review.publication,
            },
            null,
            2,
        ),
    });
    return createZip(files);
}
