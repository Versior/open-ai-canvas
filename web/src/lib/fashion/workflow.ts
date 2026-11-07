export const FASHION_TOOLS = [
    { id: "tryon", title: "模特换装", text: "保留人物，把指定服装穿上身", needs: ["models", "garments"] },
    { id: "multi-model", title: "多模特同款", text: "同一件服装，逐位模特独立出图", needs: ["models", "garments"] },
    { id: "multi-garment", title: "一模多衣", text: "同一位模特，逐件服装独立出图", needs: ["models", "garments"] },
    { id: "pose", title: "姿势参考", text: "迁移动作，保留人物与服装", needs: ["models", "poses"] },
    { id: "face", title: "模特换脸", text: "替换面部，保留发型与身体", needs: ["models", "faces"] },
    { id: "smart-face", title: "智能换脸", text: "以人脸参考匹配角度、表情与光线", needs: ["models", "faces"] },
    { id: "head", title: "智能换头", text: "替换头部与发型，保留身体造型", needs: ["models", "faces"] },
    { id: "print", title: "印花提取", text: "去除衣物形状与褶皱，提取平面图案", needs: ["garments"] },
] as const;
export type FashionTool = (typeof FASHION_TOOLS)[number]["id"];
export type FashionSlot = "models" | "garments" | "poses" | "faces";
export type FashionImage = { resourceId: string; name: string; width?: number; height?: number };
export type FashionDraft = { tool: FashionTool; models: FashionImage[]; garments: FashionImage[]; poses: FashionImage[]; faces: FashionImage[]; note: string };
export type FashionUnit = {
    id: string;
    title: string;
    prompt: string;
    references: FashionImage[];
    status: "pending" | "submitting" | "running" | "succeeded" | "failed";
    taskId?: string;
    resourceId?: string;
    error?: string;
    video?: { model: string; seconds: number; prompt: string; taskId?: string; resourceId?: string; status?: "pending" | "running" | "succeeded" | "failed"; error?: string };
};
export type FashionWork = { kind: "fashion"; id: string; revision: number; title: string; createdAt: string; model: string; draft: FashionDraft; units: FashionUnit[] };
export const FASHION_SLOT_LABEL: Record<FashionSlot, string> = { models: "目标模特 / 原图", garments: "服装 / 印花原图", poses: "姿势参考", faces: "人脸 / 头部参考" };
export const emptyFashionDraft = (): FashionDraft => ({ tool: "tryon", models: [], garments: [], poses: [], faces: [], note: "" });

export function fashionDraftProblem(draft: FashionDraft) {
    const tool = FASHION_TOOLS.find((item) => item.id === draft.tool);
    if (!tool) return "请选择有效的模特工具";
    if (draft.note.length > 600) return "补充要求不能超过 600 字";
    for (const slot of tool.needs) {
        const images = draft[slot];
        if (!images.length) return `请添加${FASHION_SLOT_LABEL[slot]}`;
        if (images.length > 6 || images.some((image) => !image.resourceId)) return "每类素材最多 6 张，且须上传完成";
    }
    if (draft.tool === "multi-model") {
        if (draft.models.length < 2 || draft.garments.length !== 1) return "多模特同款需要至少两位模特和一件服装";
    } else if (draft.tool === "multi-garment") {
        if (draft.models.length !== 1 || draft.garments.length < 2) return "一模多衣需要一位模特和至少两件服装";
    } else if (tool.needs.some((slot) => draft[slot].length !== 1)) return "这个工具每类素材选择一张；批量出图请用多模特同款或一模多衣";
    return "";
}

export function planFashion(draft: FashionDraft, id: () => string): FashionUnit[] {
    const problem = fashionDraftProblem(draft);
    if (problem) throw new Error(problem);
    const tool = FASHION_TOOLS.find((item) => item.id === draft.tool)!;
    const pairs = draft.tool === "multi-model" ? draft.models.map((model) => [model, draft.garments[0]]) : draft.tool === "multi-garment" ? draft.garments.map((garment) => [draft.models[0], garment]) : [tool.needs.map((slot) => draft[slot][0])];
    return pairs.map((references, index) => {
        const instruction = {
            tryon: "图1是目标模特，图2是指定服装。只更换衣物，保留模特身份、发型、姿态、背景与镜头；准确还原图2的颜色、领型、袖型、材质、版型、图案和品牌文字。自然处理遮挡与衣物垂坠，不融合原衣物。",
            "multi-model": "图1是本张的目标模特，图2是同款服装。只给图1模特换上图2衣物；每张只有这一位模特。保留图1的身份与体型，服装的颜色、图案、材质、领袖和标识忠实于图2。",
            "multi-garment": "图1是固定模特，图2是本张指定服装。只换为图2这一件衣物，不混入其他款式。保留图1的身份、体型、发型、构图和光线，忠实还原服装的图案与结构。",
            pose: "图1是目标人物，图2仅作姿势参考。将图2的躯干、手脚动作和重心迁移到图1人物；保留图1的面部身份、服装、配饰与背景，不迁移图2的长相或衣服。手部、关节、遮挡自然。",
            face: "图1是待修改模特，图2是面部身份参考。只替换图1的面部，保留图1的发型、头部轮廓、姿态、身体、服装和背景；按图1的光线和透视融合肤色与边缘。",
            "smart-face": "图1是待修改人物，图2是面部身份参考。识别图1的面部位置、朝向、表情与遮挡，匹配图2身份并保持图1动作表情；调整面部光照和边缘融合。只处理面部，不替换发型、服装或背景。",
            head: "图1是待修改人物，图2是头部与身份参考。替换图1的完整头部，包括脸型、耳朵与发型，匹配原头部角度、颈部连接和光线；保留图1的身体、姿态、衣物和背景，不改变头身比例。",
            print: "图1是印花原图。仅提取其中已有的印花，展开为正视平面图案。去除衣物轮廓、人体、背景、褶皱阴影和摄影光照，保留原图案颜色、细节、边界与文字。不补造不可见区域，不重写品牌文字。输出干净纯白背景，供后续抠图与印刷复核。",
        }[draft.tool];
        return { id: id(), title: `${tool.title} ${index + 1} · ${references[0].name}`, prompt: `${instruction}\n${draft.note.trim() ? `补充要求：${draft.note.trim()}\n` : ""}不添加水印或新文案。只输出编辑后的图片。`, references, status: "pending" };
    });
}

export function fashionVideoPrompt(note: string, print = false) {
    if (print)
        return `以参考图的平面印花为唯一视觉素材，生成图案展示视频。忠实保留图案颜色、构成与文字，不补造不可见区域，不改写文字，不添加人物或服装。镜头缓慢推进与平移，保持图案清晰，不扭曲形状。${note.trim() ? `展示要求：${note.trim()}` : "在干净背景上缓慢推进，展示印花细节。"}`;
    return `以参考图作为人物和服装的视觉依据，生成自然的服装展示视频。保留人物身份、头发、衣物颜色、印花、领袖结构和背景，不换脸不换装，不添加其他人物。动作缓慢，避免遮挡核心图案，镜头稳定。${note.trim() ? `动作要求：${note.trim()}` : "模特轻微转身展示衣物，双手自然。"}`;
}

/** 新版本使用独立幂等键，旧任务与成品继续保留。 */
export function newFashionVersion(work: FashionWork, unit: FashionUnit, id: () => string): FashionWork {
    if (unit.status !== "succeeded" && unit.status !== "failed") throw new Error("请先恢复并确认原任务状态，再生成新版本");
    return {
        ...work,
        id: `fashion_${id()}`,
        revision: 0,
        createdAt: new Date().toISOString(),
        title: `${FASHION_TOOLS.find((tool) => tool.id === work.draft.tool)!.title} · 新版本`,
        units: [{ id: id(), title: unit.title, prompt: unit.prompt, references: unit.references, status: "pending" }],
    };
}
