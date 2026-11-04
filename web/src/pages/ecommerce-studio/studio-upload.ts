import { nanoid } from "nanoid";
import { uploadResourceFile } from "@/services/api/resources";
import type { StudioPhoto, StudioPhotoView } from "@/lib/ecommerce-studio/types";

const ORDERED_VIEWS: StudioPhotoView[] = ["front", "side", "back"];
const NAME_HINTS: [RegExp, StudioPhotoView][] = [
    [/吊牌|标签|tag|label/i, "tag"],
    [/包装|礼盒|pack|box/i, "package"],
    [/细节|特写|detail|macro/i, "detail"],
    [/背面|back/i, "back"],
    [/侧面|side/i, "side"],
    [/正面|front|main|主图/i, "front"],
    [/场景|scene|lifestyle/i, "scene"],
];

/** 先按文件名猜视角，再按上传顺序补正、侧、背；吊牌只用来读文字，不作外观依据。 */
export function guessStudioView(name: string, index: number): StudioPhotoView {
    for (const [pattern, view] of NAME_HINTS) if (pattern.test(name)) return view;
    return ORDERED_VIEWS[index] || "detail";
}

async function imageSize(file: File): Promise<{ width?: number; height?: number }> {
    if (typeof createImageBitmap !== "function") return {};
    try {
        const bitmap = await createImageBitmap(file);
        const size = { width: bitmap.width, height: bitmap.height };
        bitmap.close();
        return size;
    } catch {
        return {};
    }
}

/** 改视角：改成吊牌就不再作外观依据；从吊牌改回其他视角时重新作为外观依据。 */
export function studioViewPatch(photo: Pick<StudioPhoto, "view">, view: StudioPhotoView): Pick<StudioPhoto, "view"> & Partial<Pick<StudioPhoto, "truth">> {
    if (view === "tag") return { view, truth: false };
    return photo.view === "tag" ? { view, truth: true } : { view };
}

export function studioImageFiles(list: FileList | File[] | null | undefined) {
    return Array.from(list || []).filter((file) => file.type.startsWith("image/"));
}

export async function uploadStudioPhoto(file: File, index: number): Promise<StudioPhoto> {
    const size = await imageSize(file);
    const resource = await uploadResourceFile(file, "image", { fileName: file.name, ...size });
    const view = guessStudioView(file.name, index);
    return {
        id: nanoid(10),
        resourceId: resource.id,
        url: `/api/resources/${resource.id}/file`,
        view,
        truth: view !== "tag",
        name: file.name,
        width: resource.width || size.width,
        height: resource.height || size.height,
        addedAt: new Date().toISOString(),
    };
}
