import type { FashionImage } from "./workflow";
import type { TimelineProject } from "@/types/timeline";
import { imageReferenceLabel } from "@/lib/image-reference-prompt";
import { seedanceReferenceLabel } from "@/lib/seedance-video";

export const FASHION_VIDEO_TOOLS = [
    { id: "tryon", title: "视频换装", text: "沿用原视频动作，替换指定服装", needs: ["garments"], source: true },
    { id: "multi-garment", title: "一人多套视频", text: "同一条原片，逐款服装独立出片", needs: ["garments"], source: true },
    { id: "multi-model", title: "多模特同款视频", text: "同款服装和原动作，逐位模特出片", needs: ["models", "garments"], source: true },
    { id: "face", title: "视频换脸", text: "保留头发与身体，替换面部身份", needs: ["faces"], source: true },
    { id: "head", title: "视频换头", text: "替换头部与发型，保持身体动作", needs: ["faces"], source: true },
    { id: "motion", title: "动作参考视频", text: "用动作视频驱动指定人物或角色", needs: ["models"], source: true },
    { id: "print", title: "印花上身视频", text: "让平面图案跟随原衣物与褶皱运动", needs: ["garments"], source: true },
    { id: "showcase", title: "模特展示视频", text: "从确认后的模特图拍摄展示片段", needs: ["models"], source: false },
] as const;
export type FashionVideoTool = (typeof FASHION_VIDEO_TOOLS)[number]["id"];
export type FashionVideoSource = FashionImage & { durationMs: number; width: number; height: number; hasAudio?: boolean };
export type FashionVideoDraft = {
    tool: FashionVideoTool;
    source?: FashionVideoSource;
    startMs: number;
    seconds: number;
    models: FashionImage[];
    garments: FashionImage[];
    faces: FashionImage[];
    region: "upper" | "lower" | "dress";
    audio: "original" | "model" | "mute";
    motion: string;
    note: string;
    authorized: boolean;
};
export type FashionVideoUnit = {
    id: string;
    title: string;
    prompt: string;
    references: FashionImage[];
    status: "pending" | "submitting" | "running" | "rendering" | "succeeded" | "failed";
    taskId?: string;
    resourceId?: string;
    durationMs?: number;
    width?: number;
    height?: number;
    render?: { started: true; taskId?: string; resourceId?: string };
    error?: string;
    parts?: (FashionVideoUnit & { startMs: number; endMs: number; clipResourceId: string })[];
};
export type FashionVideoWork = {
    kind: "fashion-video";
    id: string;
    revision: number;
    title: string;
    createdAt: string;
    model: string;
    ratio: string;
    resolution: string;
    draft: FashionVideoDraft;
    units: FashionVideoUnit[];
    clip?: { key: string; taskId?: string; resourceId?: string; keyframeResourceId?: string; hasAudio?: boolean; segments?: { startMs: number; endMs: number; resourceId: string; keyframeResourceId: string }[] };
};
export const emptyFashionVideoDraft = (): FashionVideoDraft => ({ tool: "tryon", startMs: 0, seconds: 5, models: [], garments: [], faces: [], region: "upper", audio: "mute", motion: "缓慢转身，手部自然，镜头稳定", note: "", authorized: false });
export const fashionVideoTool = (id: FashionVideoTool) => FASHION_VIDEO_TOOLS.find((tool) => tool.id === id)!;

export function fashionVideoProblem(draft: FashionVideoDraft, requireAuthorization = true) {
    const tool = fashionVideoTool(draft.tool);
    if (!tool) return "请选择有效的视频处理方式";
    if (!Number.isFinite(draft.seconds) || !Number.isSafeInteger(Math.round(draft.seconds * 1000)) || draft.seconds < 4 || draft.seconds > (tool.source ? 120 : 30)) return tool.source ? "请选择4–120秒的原视频范围" : "展示视频须为4–30秒";
    if (!Number.isSafeInteger(draft.startMs) || draft.startMs < 0 || [...draft.note].length > 600 || [...draft.motion].length > 300) return "片段范围或视频要求无效";
    if (!(["upper", "lower", "dress"] as string[]).includes(draft.region) || !(["original", "model", "mute"] as string[]).includes(draft.audio)) return "服装区域或声音方式无效";
    if (tool.source && (!draft.source?.resourceId || !Number.isFinite(draft.source.durationMs) || draft.startMs + Math.round(draft.seconds * 1000) > draft.source.durationMs)) return "请添加原视频，并选择视频范围内的处理片段";
    if (!tool.source && draft.audio === "original") return "模特图展示没有原视频声音，请选择模型声音或静音";
    if (draft.audio === "original" && draft.source?.hasAudio === false) return "原视频没有音轨，请选择模型声音或静音";
    for (const slot of ["models", "garments", "faces"] as const) {
        if (!Array.isArray(draft[slot]) || draft[slot].length > 6 || draft[slot].some((image) => !image.resourceId)) return "每类素材最多6张，且须上传完成";
    }
    for (const slot of tool.needs) if (!draft[slot].length) return `请添加${slot === "models" ? "目标人物图" : slot === "faces" ? "身份参考图" : draft.tool === "print" ? "平面印花图" : "服装参考图"}`;
    if (draft.tool === "multi-model" && (draft.models.length < 2 || draft.garments.length !== 1)) return "多模特同款需要至少两位模特和一件服装";
    if (draft.tool === "multi-garment" && draft.garments.length < 2) return "一人多套需要至少两件服装";
    if (!["multi-model", "multi-garment", "showcase"].includes(draft.tool) && tool.needs.some((slot) => draft[slot].length !== 1)) return "当前处理每类素材选择一张，批量请用多模特或多套视频";
    if (requireAuthorization && !draft.authorized) return "请确认原素材和人物形象的使用授权";
    return "";
}

/** 选段保留毫秒精度，模型只接收能力范围内的均分片段，尾段不会变成不足四秒的碎片。 */
export function fashionVideoRanges(draft: FashionVideoDraft, maxSeconds: number) {
    if (!Number.isFinite(maxSeconds) || maxSeconds < 4) throw new Error("所选模型单段须支持至少4秒");
    const durationMs = Math.round(draft.seconds * 1000);
    const count = Math.ceil(durationMs / Math.floor(maxSeconds * 1000));
    if (durationMs / count < 4000) throw new Error("当前模型上限无法把选段分成至少4秒的片段，请选择单段上限更长的模型");
    return Array.from({ length: count }, (_, index) => ({ startMs: draft.startMs + Math.round((durationMs * index) / count), endMs: draft.startMs + Math.round((durationMs * (index + 1)) / count) }));
}

export function planFashionVideos(draft: FashionVideoDraft, id: () => string): FashionVideoUnit[] {
    const problem = fashionVideoProblem(draft);
    if (problem) throw new Error(problem);
    const tool = fashionVideoTool(draft.tool);
    const pairs =
        draft.tool === "multi-model"
            ? draft.models.map((model) => [model, draft.garments[0]])
            : draft.tool === "multi-garment"
              ? draft.garments.map((garment) => [garment])
              : draft.tool === "showcase"
                ? draft.models.map((model) => [model])
                : [tool.needs.map((slot) => draft[slot][0])];
    return pairs.map((references, index) => {
        const video = `@${seedanceReferenceLabel("video", 0)}`;
        const img = (i: number) => `@${imageReferenceLabel(i)}`;
        const region = { upper: "上身衣物", lower: "下身衣物", dress: "整件连衣裙" }[draft.region];
        const instruction = {
            tryon: `沿用${video}的人物身份、动作、镜头和背景，只把${region}换为${img(0)}的服装。`,
            "multi-garment": `沿用${video}的同一人物、动作和机位，只把${region}换为本次${img(0)}服装。每次只有这一款，不拼贴、不快速换多个款式。`,
            "multi-model": `动作和机位参考${video}，人物身份、体型、头发依据${img(0)}，${region}依据${img(1)}的同款服装。每次只有这一位模特，不混合身份。`,
            face: `以${video}为待修改视频，用${img(0)}替换面部身份。只修改面部，保留原发型、头部朝向、表情节奏、身体、衣物、背景和运镜。`,
            head: `以${video}为待修改视频，用${img(0)}替换完整头部、身份和发型。匹配每一帧的头部朝向、颈部连接、光照与遮挡，保留身体、衣物和原动作，不改变头身比例。`,
            motion: `人物外观、服装和场景只依据${img(0)}，动作节奏、肢体运动和表情参考${video}。不迁移原视频人物的身份或衣物。保持手脚接触、重心与遮挡连贯，不额外添加人物。`,
            print: `以${video}为原视频，只把${region}的可见印花替换为${img(0)}的平面图案。保留原衣物的版型、材质、人物、动作和背景；图案随布面透视、褶皱、遮挡连续变形，不漂浮、不逐帧跳位置，不补造图案不可见部分。`,
            showcase: `以${img(0)}为首帧与外观依据，拍摄模特服装展示视频。保留人物身份、头发、服装、图案和背景。动作：${draft.motion}。一镜完成，不换脸、不换装、不插入其他人物。`,
        }[draft.tool];
        const prompt = [
            `生成约${draft.seconds}秒的视频片段。${instruction}`,
            "全片时间一致性：首帧、动作中段和末帧保持同一身份、服装轮廓、颜色、印花和标识；转身及遮挡后仍是同一主体。光线按原场景匹配，边缘不闪烁。禁止用静态图片或逐帧独立改图冒充视频。",
            draft.tool !== "showcase" ? "保留所选原片的动作顺序、切换点与机位，不新增剧情或场景。复杂遮挡与背面没有参考时保持克制，不虚构服装结构。" : "缓慢动作，避免手臂遮住关键衣物细节。",
            draft.audio === "model" ? "声音由模型生成自然环境声，不编口播或台词。" : "本次只生成画面，不生成旁白和人声；原声或静音由后期处理。",
            draft.note.trim() ? `补充要求：${draft.note.trim()}` : "",
            "不添加字幕、水印或新文案，商品图案与既有文字保持原样。",
        ]
            .filter(Boolean)
            .join("\n");
        return { id: id(), title: `${tool.title} ${index + 1} · ${references[0].name}`, prompt, references, status: "pending" };
    });
}

export function fashionVideoTimeline(work: FashionVideoWork, unit: FashionVideoUnit): TimelineProject & { width: number; height: number; fit: "auto" } {
    if (unit.parts) {
        if (!work.draft.source || !unit.parts.length || unit.parts.some((part) => part.status !== "succeeded" || !part.render?.resourceId)) throw new Error("部分片段未成功，不能交付完整视频");
        return {
            version: 2,
            durationMs: Math.round(work.draft.seconds * 1000),
            width: work.draft.source.width,
            height: work.draft.source.height,
            fit: "auto",
            tracks: [{ id: "visual", kind: "video", label: "按原片顺序合成", order: 0 }],
            clips: unit.parts.map((part) => ({
                id: part.id,
                nodeId: part.id,
                trackId: "visual",
                kind: "video",
                startMs: part.startMs - work.draft.startMs,
                durationMs: part.endMs - part.startMs,
                sourceStartMs: 0,
                sourceDurationMs: part.endMs - part.startMs,
                directMedia: { id: part.render!.resourceId!, kind: "video", title: part.title, storageKey: `resource:${part.render!.resourceId!}` },
            })),
        };
    }
    if (!unit.resourceId || !unit.durationMs || !unit.width || !unit.height) throw new Error("视频成品的时长或尺寸尚未确认，请先检查原任务");
    const durationMs = Math.round(work.draft.seconds * 1000);
    if (unit.durationMs + 100 < durationMs) throw new Error("生成视频短于所选片段，不能截断原声或伪造完整视频，请生成新版本");
    const original = work.draft.audio === "original";
    if (original && (!work.clip?.resourceId || work.clip.hasAudio !== true)) throw new Error("所选原视频片段没有确认可用音轨，原声音合成未执行");
    return {
        version: 2,
        durationMs,
        width: fashionVideoTool(work.draft.tool).source ? work.draft.source!.width : unit.width,
        height: fashionVideoTool(work.draft.tool).source ? work.draft.source!.height : unit.height,
        fit: "auto",
        tracks: [
            { id: "visual", kind: "video", label: "生成画面", order: 0, muted: work.draft.audio !== "model" },
            { id: "sound", kind: "audio", label: "原片声音", order: 1 },
        ],
        clips: [
            {
                id: unit.id,
                nodeId: unit.id,
                trackId: "visual",
                kind: "video",
                startMs: 0,
                durationMs,
                sourceStartMs: 0,
                sourceDurationMs: unit.durationMs,
                directMedia: { id: unit.resourceId, kind: "video", title: unit.title, storageKey: `resource:${unit.resourceId}` },
            },
            ...(original
                ? [
                      {
                          id: "original-sound",
                          nodeId: "original-sound",
                          trackId: "sound",
                          kind: "audio" as const,
                          startMs: 0,
                          durationMs,
                          sourceStartMs: 0,
                          directMedia: { id: work.clip!.resourceId!, kind: "audio" as const, title: "原片声音", storageKey: `resource:${work.clip!.resourceId}` },
                      },
                  ]
                : []),
        ],
    };
}

/** 关联提交未知的原任务时，必须核对完整片段及声音，不能仅匹配其中一个素材。 */
export function fashionVideoRenderMatches(value: unknown, expected: ReturnType<typeof fashionVideoTimeline>) {
    if (!value || typeof value !== "object") return false;
    const timeline = value as ReturnType<typeof fashionVideoTimeline>;
    if (timeline.width !== expected.width || timeline.height !== expected.height || timeline.durationMs !== expected.durationMs || timeline.fit !== expected.fit) return false;
    if (!Array.isArray(timeline.clips) || !Array.isArray(timeline.tracks) || timeline.clips.length !== expected.clips.length || timeline.tracks.length !== expected.tracks.length) return false;
    return (
        expected.clips.every((clip, index) => {
            const actual = timeline.clips[index];
            return (
                actual &&
                actual.kind === clip.kind &&
                actual.trackId === clip.trackId &&
                actual.startMs === clip.startMs &&
                actual.durationMs === clip.durationMs &&
                (actual.sourceStartMs || 0) === (clip.sourceStartMs || 0) &&
                actual.directMedia?.storageKey === clip.directMedia?.storageKey
            );
        }) &&
        expected.tracks.every((track, index) => {
            const actual = timeline.tracks[index];
            return actual && actual.id === track.id && actual.kind === track.kind && Boolean(actual.muted) === Boolean(track.muted) && actual.order === track.order;
        })
    );
}
