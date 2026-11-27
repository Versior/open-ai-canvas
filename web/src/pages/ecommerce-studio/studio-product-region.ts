import type { StudioDetailSourceInput } from "@/lib/ecommerce-studio/types";
import { getActiveUserScope } from "@/lib/user-scope";
import { getResourceBlob, resourceStorageKey, uploadResourceFile } from "@/services/api/resources";

export async function prepareStudioProductRegion(region: StudioDetailSourceInput, scope: string, signal: AbortSignal) {
    const check = () => {
        signal.throwIfAborted();
        if (getActiveUserScope() !== scope || scope === "guest") throw new Error("登录账号已切换，已停止读取商品实拍");
    };
    check();
    const source = await getResourceBlob(resourceStorageKey(region.sourceResourceId), "ecommerce-export", signal);
    check();
    if (!source) throw new Error("本屏引用的商品实拍不可用");
    const bitmap = await createImageBitmap(source);
    const canvas = document.createElement("canvas");
    try {
        check();
        const [left, top, right, bottom] = region.box;
        const x = Math.floor((left / 100) * bitmap.width);
        const y = Math.floor((top / 100) * bitmap.height);
        const width = Math.ceil((right / 100) * bitmap.width) - x;
        const height = Math.ceil((bottom / 100) * bitmap.height) - y;
        const scale = Math.min(1, 1600 / Math.max(width, height));
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
        const context = canvas.getContext("2d");
        if (!context) throw new Error("浏览器无法读取商品实拍局部");
        context.drawImage(bitmap, x, y, width, height, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => (value ? resolve(value) : reject(new Error("商品实拍局部导出失败"))), "image/png"));
        check();
        const resource = await uploadResourceFile(blob, "image", { width: canvas.width, height: canvas.height, fileName: "本屏实拍局部.png", idempotencyKey: `studio-photo-box-v1:${region.sourceResourceId}:${x}:${y}:${width}:${height}` }, undefined, {
            expectedScope: scope,
            signal,
        });
        check();
        if (!resource.id || resource.kind !== "image" || resource.status !== "ready") throw new Error("商品实拍局部尚未保存");
        return resource.id;
    } finally {
        bitmap.close();
        canvas.width = canvas.height = 0;
    }
}
