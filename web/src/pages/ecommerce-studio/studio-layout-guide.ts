import { STUDIO_COMPOSITIONS } from "@/lib/ecommerce-studio/art-direction";
import type { StudioCompositionId } from "@/lib/ecommerce-studio/types";
import type { ReferenceImage } from "@/types/image";

/** 生成前的区域参考，不参与成品合成，也不写入任何成品文案。 */
export function studioLayoutGuideReference(guide: { composition: StudioCompositionId; ratio: string }): ReferenceImage {
    const [rw, rh] = guide.ratio.split(":").map(Number);
    if (!(rw > 0 && rh > 0)) throw new Error("布局参考的画幅无效");
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round((768 * rw) / Math.max(rw, rh)));
    canvas.height = Math.max(1, Math.round((768 * rh) / Math.max(rw, rh)));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("浏览器无法准备布局参考");
    const w = canvas.width,
        h = canvas.height;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, w, h);
    const zone = STUDIO_COMPOSITIONS[guide.composition].zone;
    const imageZone = guide.composition === "left" ? [0.5, 0.12, 0.44, 0.72] : guide.composition === "right" ? [0.06, 0.12, 0.46, 0.72] : guide.composition === "bottom" ? [0.06, 0.06, 0.88, 0.54] : [0.06, 0.42, 0.88, 0.52];
    context.fillStyle = "#d8dce1";
    context.fillRect(imageZone[0] * w, imageZone[1] * h, imageZone[2] * w, imageZone[3] * h);
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
    return { id: `studio-layout-${guide.composition}-${guide.ratio}`, name: "图文区域参考.png", type: "image/png", dataUrl: canvas.toDataURL("image/png"), width: w, height: h };
}
