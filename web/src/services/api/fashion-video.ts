import { http } from "./request";
import { fashionVideoProblem, planFashionVideos, type FashionVideoWork } from "@/lib/fashion/video-workflow";

const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, max: number) => typeof value === "string" && Boolean(value.trim()) && [...value].length <= max;
const id = (value: unknown) => text(value, 200) && /^[A-Za-z0-9_-]+$/.test(value as string);
const optionalId = (value: unknown) => value === undefined || id(value);
const positive = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value > 0;
const image = (value: unknown) => object(value) && id(value.resourceId) && typeof value.name === "string" && [...value.name].length <= 300;
export function parseFashionVideoWork(value: unknown): FashionVideoWork | undefined {
    if (!object(value) || value.kind !== "fashion-video") return undefined;
    const invalid = () => {
        throw new Error("视频模特作品数据无效，请重新读取原记录");
    };
    if (
        !id(value.id) ||
        !text(value.title, 120) ||
        !text(value.model, 200) ||
        !text(value.createdAt, 60) ||
        !Number.isFinite(Date.parse(value.createdAt as string)) ||
        !Number.isSafeInteger(value.revision) ||
        (value.revision as number) < 0 ||
        !text(value.ratio, 20) ||
        !text(value.resolution, 20)
    )
        return invalid();
    const draft = value.draft;
    if (
        !object(draft) ||
        typeof draft.motion !== "string" ||
        typeof draft.note !== "string" ||
        typeof draft.authorized !== "boolean" ||
        ![draft.models, draft.garments, draft.faces].every((items) => Array.isArray(items) && items.length <= 6 && items.every(image))
    )
        return invalid();
    if (
        draft.source !== undefined &&
        (!image(draft.source) || !object(draft.source) || !positive(draft.source.durationMs) || !positive(draft.source.width) || !positive(draft.source.height) || (draft.source.hasAudio !== undefined && typeof draft.source.hasAudio !== "boolean"))
    )
        return invalid();
    if (fashionVideoProblem(draft as unknown as FashionVideoWork["draft"])) return invalid();
    const clip = value.clip;
    if (clip !== undefined && (!object(clip) || !id(clip.key) || !optionalId(clip.taskId) || !optionalId(clip.resourceId) || !optionalId(clip.keyframeResourceId) || (clip.hasAudio !== undefined && typeof clip.hasAudio !== "boolean"))) return invalid();
    if (object(clip) && clip.segments !== undefined) {
        if (!Array.isArray(clip.segments) || !clip.segments.length || clip.segments.length > 30 || draft.tool === "showcase") return invalid();
        let cursor = Number(draft.startMs);
        for (const segment of clip.segments) {
            if (!object(segment) || segment.startMs !== cursor || !Number.isSafeInteger(segment.endMs) || Number(segment.endMs) - cursor < 4000 || Number(segment.endMs) - cursor > 30000 || !id(segment.resourceId) || !id(segment.keyframeResourceId))
                return invalid();
            cursor = Number(segment.endMs);
        }
        if (cursor !== Number(draft.startMs) + Math.round(Number(draft.seconds) * 1000)) return invalid();
    }
    if (!Array.isArray(value.units) || !value.units.length || value.units.length > 6) return invalid();
    const ids = new Set<unknown>();
    const pairs = planFashionVideos(draft as unknown as FashionVideoWork["draft"], () => "pair").map((unit) => unit.references.map((ref) => ref.resourceId).join(","));
    for (const unit of value.units) {
        if (
            !object(unit) ||
            !id(unit.id) ||
            ids.has(unit.id) ||
            !text(unit.title, 300) ||
            !text(unit.prompt, 4000) ||
            !["pending", "submitting", "running", "rendering", "succeeded", "failed"].includes(String(unit.status)) ||
            !Array.isArray(unit.references) ||
            unit.references.length < 1 ||
            unit.references.length > 2 ||
            !unit.references.every(image) ||
            !optionalId(unit.taskId) ||
            !optionalId(unit.resourceId) ||
            (unit.error !== undefined && typeof unit.error !== "string")
        )
            return invalid();
        ids.add(unit.id);
        if (unit.parts !== undefined) {
            if (!Array.isArray(unit.parts) || !object(clip) || !Array.isArray(clip.segments) || unit.parts.length !== clip.segments.length) return invalid();
            for (const [index, part] of unit.parts.entries()) {
                const segment = clip.segments[index];
                if (
                    !object(part) ||
                    !object(segment) ||
                    part.parts !== undefined ||
                    part.startMs !== segment.startMs ||
                    part.endMs !== segment.endMs ||
                    part.clipResourceId !== segment.resourceId ||
                    !Array.isArray(part.references) ||
                    part.references.map((ref) => ref.resourceId).join(",") !== unit.references.map((ref) => ref.resourceId).join(",")
                )
                    return invalid();
                if (ids.has(part.id)) return invalid();
                ids.add(part.id);
                parseFashionVideoWork({ ...value, draft: { ...draft, startMs: part.startMs, seconds: (Number(part.endMs) - Number(part.startMs)) / 1000 }, clip: undefined, units: [part] });
                if (unit.status === "succeeded" && part.status !== "succeeded") return invalid();
            }
        }
        const pairIndex = pairs.indexOf(unit.references.map((ref: { resourceId: string }) => ref.resourceId).join(","));
        if (pairIndex < 0) return invalid();
        pairs.splice(pairIndex, 1);
        for (const key of ["durationMs", "width", "height"]) if (unit[key] !== undefined && !positive(unit[key])) return invalid();
        const render = unit.render;
        if (render !== undefined && (!object(render) || render.started !== true || !optionalId(render.taskId) || !optionalId(render.resourceId))) return invalid();
        if (unit.status === "succeeded" && (!unit.resourceId || !object(render) || !render.resourceId)) return invalid();
        if (unit.status === "succeeded" && object(clip) && Array.isArray(clip.segments) && clip.segments.length > 1 && !Array.isArray(unit.parts)) return invalid();
    }
    return value as unknown as FashionVideoWork;
}
export async function listFashionVideoWorks(signal?: AbortSignal) {
    const data = await http.get<{ items: unknown[] }>("/ecommerce/product-videos", { signal });
    if (!Array.isArray(data.items)) throw new Error("视频模特作品列表响应无效");
    return data.items.map(parseFashionVideoWork).filter((item): item is FashionVideoWork => Boolean(item));
}
export async function saveFashionVideoWork(work: FashionVideoWork) {
    const { revision, ...item } = work;
    const data = await http.put<{ item: unknown }>(`/ecommerce/product-videos/${encodeURIComponent(work.id)}`, { item, expectedRevision: revision });
    const saved = parseFashionVideoWork(data.item);
    if (!saved) throw new Error("视频模特作品保存响应无效");
    return saved;
}
