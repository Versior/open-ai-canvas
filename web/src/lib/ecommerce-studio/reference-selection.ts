import type { StudioPhoto, StudioProduct } from "./types";

const VIEW_ORDER = ["front", "side", "back", "detail", "package", "scene", "other", "tag"] as const;

/** 先覆盖不同视角，再补同视角；吊牌用于识别，不作为生图外观依据。 */
export function studioReferencePhotos(photos: StudioPhoto[], maxReferences = 4, includeTags = false): StudioPhoto[] {
    const seen = new Set<string>();
    const ordered = photos
        .filter((photo) => {
            if (!photo.resourceId || !photo.truth || (!includeTags && photo.view === "tag") || seen.has(photo.resourceId)) return false;
            seen.add(photo.resourceId);
            return true;
        })
        .sort((a, b) => VIEW_ORDER.indexOf(a.view) - VIEW_ORDER.indexOf(b.view));
    const views = new Set<string>();
    const first = ordered.filter((photo) => {
        if (views.has(photo.view)) return false;
        views.add(photo.view);
        return true;
    });
    return [...first, ...ordered.filter((photo) => !first.includes(photo))].slice(0, Math.max(0, Math.floor(maxReferences)));
}

/** 文本模型按实际容量阅读商品和设计参考，不再固定最多两张商品图。 */
export function studioPlanningImages(product: StudioProduct, capacity: number, withReferences = true) {
    const budget = Math.max(0, Math.floor(capacity));
    const available = studioReferencePhotos(product.photos, product.photos.length, true);
    const uploaded = withReferences ? product.references.filter((photo) => photo.resourceId) : [];
    const reserved = Math.min(uploaded.length, Math.max(0, budget - Number(Boolean(available.length))), Math.max(1, Math.floor(budget / 2)));
    const photos = available.slice(0, budget - reserved);
    const references = uploaded.slice(0, budget - photos.length);
    const omitted = [available.length - photos.length ? `${available.length - photos.length}张商品图` : "", uploaded.length - references.length ? `${uploaded.length - references.length}张设计参考` : ""].filter(Boolean);
    const notice = omitted.length ? `当前策划模型最多读取 ${budget} 张图，本次未采用${omitted.join("和")}；需要这些资料时请选择支持更多参考图的文本模型` : undefined;
    return { photos, references, images: [...photos, ...references], notice };
}
