import type { EcommerceDraft, EcommercePlan, EcommercePlanImage, EcommerceRound } from "@/services/api/ecommerce";
import { createClientUUID } from "@/lib/client-id";

export function commerceCanvasImages(plan: EcommercePlan | null): EcommercePlanImage[] {
    return plan ? [...(plan.previousImages || []), ...plan.images] : [];
}

export function commercePlanWithHistory(active: EcommercePlan | null, rounds: EcommerceRound[]): EcommercePlan | null {
    const previousImages = [...rounds].reverse().flatMap((round) => round.plan?.images || []);
    if (active) return { ...active, previousImages: previousImages.length ? previousImages : undefined };
    return previousImages.length ? { productSummary: "", confirmedFacts: [], uncertainFacts: [], visualStrategy: "", qualityChecks: [], images: [], previousImages } : null;
}

/** Archive admitted tasks only. Pending sketches never become historical results. */
export function archiveCommercePlan(plan: EcommercePlan | null, source?: EcommerceDraft): EcommercePlan | null {
    if (!plan) return null;
    const previousImages = [
        ...new Map(
            commerceCanvasImages(plan)
                .filter((image) => image.taskId)
                .map((image) => [image.id, image.sourceDraft || !source ? image : { ...image, sourceDraft: source }]),
        ).values(),
    ];
    return previousImages.length ? { ...plan, images: [], previousImages } : null;
}

export function continueCommercePlan(next: EcommercePlan, previous: EcommercePlan | null, source?: EcommerceDraft): EcommercePlan {
    const previousImages = commerceCanvasImages(archiveCommercePlan(previous, source));
    const ids = new Set(previousImages.map((image) => image.id));
    const images = next.images.map((image) => {
        const id = ids.has(image.id) ? createClientUUID() : image.id;
        ids.add(id);
        return { ...image, id, operationId: createClientUUID() };
    });
    return { ...next, images, previousImages };
}

export function updateCommerceCanvasImage(plan: EcommercePlan, id: string, update: (image: EcommercePlanImage) => EcommercePlanImage): EcommercePlan {
    const apply = (image: EcommercePlanImage) => (image.id === id ? update(image) : image);
    return { ...plan, images: plan.images.map(apply), previousImages: plan.previousImages?.map(apply) };
}
