import { http } from "./request";
import { FASHION_TOOLS, fashionDraftProblem, type FashionWork, type FashionImage } from "@/lib/fashion/workflow";

const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, max: number): value is string => typeof value === "string" && Boolean(value.trim()) && Array.from(value).length <= max;
const optionalId = (value: unknown) => value === undefined || text(value, 200);
const image = (value: unknown): value is FashionImage =>
    object(value) && text(value.resourceId, 200) && typeof value.name === "string" && value.name.length <= 300 && [value.width, value.height].every((n) => n === undefined || (typeof n === "number" && Number.isFinite(n) && n > 0));

export function parseFashionWork(value: unknown): FashionWork | undefined {
    if (!object(value) || value.kind !== "fashion") return undefined;
    const invalid = () => {
        throw new Error("模特作品数据损坏，请重新读取或联系管理员检查保存记录");
    };
    if (!text(value.id, 120) || !text(value.title, 160) || !text(value.model, 200) || !Number.isSafeInteger(value.revision) || (value.revision as number) < 0 || !text(value.createdAt, 60) || !Number.isFinite(Date.parse(value.createdAt))) return invalid();
    const draft = value.draft;
    if (
        !object(draft) ||
        !FASHION_TOOLS.some((tool) => tool.id === draft.tool) ||
        typeof draft.note !== "string" ||
        draft.note.length > 600 ||
        ![draft.models, draft.garments, draft.faces, draft.poses].every((items) => Array.isArray(items) && items.length <= 6 && items.every(image))
    )
        return invalid();
    if (!Array.isArray(value.units) || value.units.length < 1 || value.units.length > 6) return invalid();
    const ids = new Set<string>();
    for (const unit of value.units) {
        if (
            !object(unit) ||
            !text(unit.id, 120) ||
            ids.has(unit.id) ||
            !text(unit.title, 300) ||
            !text(unit.prompt, 4000) ||
            !["pending", "submitting", "running", "succeeded", "failed"].includes(String(unit.status)) ||
            !Array.isArray(unit.references) ||
            unit.references.length < 1 ||
            unit.references.length > 2 ||
            !unit.references.every(image) ||
            !optionalId(unit.taskId) ||
            !optionalId(unit.resourceId) ||
            (unit.status === "succeeded" && !unit.resourceId) ||
            (unit.error !== undefined && typeof unit.error !== "string")
        )
            return invalid();
        ids.add(unit.id);
        const video = unit.video;
        if (
            video !== undefined &&
            (!object(video) ||
                !text(video.model, 200) ||
                !Number.isInteger(video.seconds) ||
                (video.seconds as number) < 1 ||
                (video.seconds as number) > 120 ||
                !text(video.prompt, 2000) ||
                !optionalId(video.taskId) ||
                !optionalId(video.resourceId) ||
                (video.status !== undefined && !["pending", "running", "succeeded", "failed"].includes(String(video.status))) ||
                (video.status === "succeeded" && !video.resourceId) ||
                (video.error !== undefined && typeof video.error !== "string"))
        )
            return invalid();
    }
    // 上述逐层检查覆盖保存协议；再验证工具所需素材和批量配对边界。
    const work = value as unknown as FashionWork;
    if (fashionDraftProblem(work.draft)) return invalid();
    return work;
}

/** 与视频作品共用私有文档和资源归属检查，通过 kind 隔离列表。 */
export async function listFashionWorks(signal?: AbortSignal) {
    const data = await http.get<{ items: unknown[] }>("/ecommerce/product-videos", { signal });
    if (!Array.isArray(data.items)) throw new Error("模特作品列表响应无效");
    return data.items.map(parseFashionWork).filter((item): item is FashionWork => Boolean(item));
}

export async function saveFashionWork(work: FashionWork) {
    const { revision, ...item } = work;
    const data = await http.put<{ item: unknown }>(`/ecommerce/product-videos/${encodeURIComponent(work.id)}`, { item, expectedRevision: revision });
    const saved = parseFashionWork(data.item);
    if (!saved) throw new Error("模特作品保存响应无效");
    return saved;
}
