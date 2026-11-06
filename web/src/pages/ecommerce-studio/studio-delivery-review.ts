import { reviewStudioDelivery, studioEdgeAudit, type StudioDeliveryMeasure } from "@/lib/ecommerce-studio/delivery-review";
import type { StudioPlan, StudioProduct } from "@/lib/ecommerce-studio/types";
import type { StudioComposedShot } from "./studio-delivery";

/** 对实际交付文件测尺寸、大小和边缘色；不依赖模型返回的尺寸元数据。 */
export async function inspectStudioDelivery(product: StudioProduct, plan: StudioPlan, shots: StudioComposedShot[], signal?: AbortSignal) {
    const measurements = new Map<string, StudioDeliveryMeasure>();
    for (const item of shots) {
        if (signal?.aborted) throw new DOMException("检查已停止", "AbortError");
        const response = await fetch(item.url, { signal });
        if (!response.ok) throw new Error(`「${item.shot.title}」成品读取失败`);
        const blob = await response.blob();
        const bitmap = await createImageBitmap(blob);
        try {
            const canvas = document.createElement("canvas");
            const scale = Math.min(1, 256 / Math.max(bitmap.width, bitmap.height));
            canvas.width = Math.max(1, Math.round(bitmap.width * scale));
            canvas.height = Math.max(1, Math.round(bitmap.height * scale));
            const context = canvas.getContext("2d", { willReadFrequently: true });
            if (!context) throw new Error("浏览器无法读取图像像素，未完成交付检查");
            context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
            const audit = studioEdgeAudit(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
            measurements.set(item.shot.id, { width: bitmap.width, height: bitmap.height, bytes: blob.size, audit });
        } finally {
            bitmap.close();
        }
    }
    return reviewStudioDelivery(product, plan.shots, measurements, new Set(shots.map((item) => item.shot.id)));
}
