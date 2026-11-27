import type { StudioDetailSource, StudioPhoto, StudioPlanReceipt, StudioProduct } from "./types";

const VIEW_ORDER = ["front", "side", "back", "detail", "package", "scene", "other", "tag"] as const;

export const studioPhotoEvidenceId = (photo: Pick<StudioPhoto, "id">) => `photo:${photo.id}`;

export function studioPlanImageNumber(value: unknown) {
    const number = typeof value === "string" && /^图\s*([1-9]\d*)$/u.exec(value.trim());
    return number ? Number(number[1]) : undefined;
}

export function studioPlanImageBindings({ photos, references }: Pick<ReturnType<typeof studioPlanningImages>, "photos" | "references">, sameLayout: boolean): Pick<StudioPlanReceipt, "photoEvidence" | "designReferences"> {
    const photoEvidence = photos.flatMap((photo, index) => (photo.view === "tag" ? [] : [{ index: index + 1, id: photo.id }]));
    const seen = new Set(photos.map((photo) => photo.resourceId));
    const designReferences = sameLayout
        ? []
        : references.flatMap((photo, index) => {
              if (photo.truth || !photo.resourceId || seen.has(photo.resourceId)) return [];
              seen.add(photo.resourceId);
              return [{ index: photos.length + index + 1, resourceId: photo.resourceId }];
          });
    return { ...(photoEvidence.length ? { photoEvidence } : {}), ...(designReferences.length >= 2 ? { designReferences } : {}) };
}

export function studioDetailSourceOf(value: unknown): StudioDetailSource | undefined {
    if (!value || typeof value !== "object" || !("photo" in value) || typeof value.photo !== "string" || !value.photo.trim() || !("box" in value)) return;
    const box = value.box;
    if (!Array.isArray(box) || box.length !== 4 || !box.every((item) => typeof item === "number" && Number.isFinite(item) && item >= 0 && item <= 100)) return;
    const [left, top, right, bottom] = box;
    if (left >= right || top >= bottom || (left === 0 && top === 0 && right === 100 && bottom === 100)) return;
    return { photo: value.photo.trim(), box: [left, top, right, bottom], ...("framing" in value && value.framing === "locate" ? { framing: "locate" as const } : {}) };
}

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

export function studioScreenReferencePhotos(photos: StudioPhoto[], evidenceRefs?: string[]) {
    const available = studioReferencePhotos(photos, photos.length);
    const cited = [...new Set(evidenceRefs?.flatMap((id) => available.filter((photo) => studioPhotoEvidenceId(photo) === id)))];
    if (!cited.length) return available;
    const front = available.find((photo) => photo.view === "front");
    return front && !cited.includes(front) ? [...cited, front] : cited;
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
