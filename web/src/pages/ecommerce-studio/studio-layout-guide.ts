import { STUDIO_COMPOSITIONS, STUDIO_IMAGE_ZONES } from "@/lib/ecommerce-studio/art-direction";
import type { StudioCompiledPrompt } from "@/lib/ecommerce-studio/prompt-compiler";
import { planStudioArtwork, STUDIO_TYPE_STACK } from "@/lib/ecommerce-studio/typeset";
import { resourceStorageKey, uploadResourceFile } from "@/services/api/resources";
import type { ReferenceImage } from "@/types/image";

type Guide = NonNullable<StudioCompiledPrompt["layoutGuide"]>;

function guideSize(guide: Guide) {
    const [rw, rh] = guide.ratio.split(":").map(Number);
    if (!(rw > 0 && rh > 0)) throw new Error("布局参考的画幅无效");
    return { width: Math.max(1, Math.round((768 * rw) / Math.max(rw, rh))), height: Math.max(1, Math.round((768 * rh) / Math.max(rw, rh))) };
}

export function renderStudioLayoutGuide(guide: Guide, copy?: StudioCompiledPrompt["copySnapshot"]) {
    const { width: w, height: h } = guideSize(guide);
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
    if (guide.proof) {
        if (!copy) throw new Error("这次生成没有定稿文案，无法绘制排版参考");
        const artwork = planStudioArtwork({
            canvas: { width: w, height: h },
            zone,
            layout: guide.layout,
            content: copy,
            measure: (text, size, weight, family) => {
                context.font = `${weight} ${size}px ${family || STUDIO_TYPE_STACK}`;
                return context.measureText(text).width;
            },
        });
        context.textBaseline = "top";
        for (const op of artwork.text) {
            context.font = `${op.weight} ${op.size}px ${op.family || STUDIO_TYPE_STACK}`;
            context.textAlign = op.align;
            context.fillStyle = op.tone === "ink" ? "#1f2931" : "#445560";
            context.fillText(op.text, op.x, op.y);
        }
        context.strokeStyle = "#74808c";
        for (const rule of artwork.rules) {
            context.beginPath();
            context.moveTo(rule.x1, rule.y1);
            context.lineTo(rule.x2, rule.y2);
            context.stroke();
        }
    } else {
        const left = zone.x * w,
            width = zone.width * w,
            top = (zone.vAlign === "center" ? zone.y + zone.height * 0.3 : zone.y) * h;
        for (let line = 0; line < 2; line++) {
            context.fillStyle = "#303640";
            context.fillRect(left, top + line * 0.065 * h, width * (line ? 0.8 : 1), 0.045 * h);
        }
        context.fillStyle = "#7b8490";
        for (let line = 0; line < 2; line++) context.fillRect(left, top + (0.17 + line * 0.028) * h, width * 0.82, 0.012 * h);
    }
    return canvas;
}

export async function studioLayoutGuideReference(guide: Guide, attemptId: string, scope: string, signal: AbortSignal, copy?: StudioCompiledPrompt["copySnapshot"]): Promise<{ resourceId: string; image: ReferenceImage }> {
    const size = guideSize(guide);
    const image = { id: `studio-layout-${guide.composition}-${guide.ratio}`, name: guide.proof ? "定稿排版参考.png" : "图文区域参考.png", type: "image/png", dataUrl: "", ...size };
    if (guide.resourceId) return { resourceId: guide.resourceId, image: { ...image, storageKey: resourceStorageKey(guide.resourceId) } };
    const canvas = renderStudioLayoutGuide(guide, copy);
    try {
        const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => (value ? resolve(value) : reject(new Error("无法生成布局参考图片"))), image.type));
        const resource = await uploadResourceFile(blob, "image", { fileName: image.name, ...size, idempotencyKey: `studio-layout:${attemptId}` }, undefined, { expectedScope: scope, signal });
        return { resourceId: resource.id, image: { ...image, storageKey: resourceStorageKey(resource.id) } };
    } finally {
        canvas.width = canvas.height = 0;
    }
}
