import { STUDIO_COMPOSITIONS, STUDIO_IMAGE_ZONES } from "@/lib/ecommerce-studio/art-direction";
import type { StudioCompositionId } from "@/lib/ecommerce-studio/types";
import { resourceStorageKey, uploadResourceFile } from "@/services/api/resources";
import type { ReferenceImage } from "@/types/image";

/** 生成前的区域参考，不参与成品合成，也不写入任何成品文案。 */
export async function studioLayoutGuideReference(guide: { composition: StudioCompositionId; ratio: string; resourceId?: string }, attemptId: string, scope: string, signal: AbortSignal): Promise<{ resourceId: string; image: ReferenceImage }> {
    const [rw, rh] = guide.ratio.split(":").map(Number);
    if (!(rw > 0 && rh > 0)) throw new Error("布局参考的画幅无效");
    const w = Math.max(1, Math.round((768 * rw) / Math.max(rw, rh)));
    const h = Math.max(1, Math.round((768 * rh) / Math.max(rw, rh)));
    const image = { id: `studio-layout-${guide.composition}-${guide.ratio}`, name: "图文区域参考.png", type: "image/png", dataUrl: "", width: w, height: h };
    if (guide.resourceId) return { resourceId: guide.resourceId, image: { ...image, storageKey: resourceStorageKey(guide.resourceId) } };
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("浏览器无法准备布局参考");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, w, h);
    const zone = STUDIO_COMPOSITIONS[guide.composition].zone;
    context.fillStyle = "#d8dce1";
    for (const imageZone of STUDIO_IMAGE_ZONES[guide.composition]) context.fillRect(imageZone[0] * w, imageZone[1] * h, imageZone[2] * w, imageZone[3] * h);
    // 深色粗线仅表示标题行，浅细线表示注解；模型须在这些位置一次完成真实文字与摄影。
    const left = zone.x * w,
        width = zone.width * w,
        top = (zone.vAlign === "center" ? zone.y + zone.height * 0.3 : zone.y) * h;
    for (let line = 0; line < 2; line++) {
        context.fillStyle = "#303640";
        context.fillRect(left, top + line * 0.065 * h, width * (line ? 0.8 : 1), 0.045 * h);
    }
    context.fillStyle = "#7b8490";
    for (let line = 0; line < 2; line++) context.fillRect(left, top + (0.17 + line * 0.028) * h, width * 0.82, 0.012 * h);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => (value ? resolve(value) : reject(new Error("无法生成布局参考图片"))), image.type));
    const resource = await uploadResourceFile(blob, "image", { fileName: image.name, width: w, height: h, idempotencyKey: `studio-layout:${attemptId}` }, undefined, { expectedScope: scope, signal });
    return { resourceId: resource.id, image: { ...image, storageKey: resourceStorageKey(resource.id) } };
}
