import { jsonCandidates, teardownTimeRange, videoTeardownProductLabel, videoTeardownRowHasProduct, type VideoTeardownAnalysis, type VideoTeardownAnalysisRow } from "@/lib/canvas/video-teardown";
import type { VideoTeardownBundle } from "@/services/api/video-replication";

/**
 * 视频复刻 · 复刻方案：商品档案、按商品改写的脚本、逐镜怎么处理。存在服务端（PUT /video-replication/teardowns/:id/plan），
 * 「去画布复刻」按它铺分镜。逐镜的台词、画面字和提示词存完整的当前值，初始值取自模型分析。
 */

/**
 * 一镜怎么处理：remake 按描述重做；product 换成我的商品（有商品图时用商品图做首帧参考）；
 * original 原片关键帧直接当首帧（要先确认是自己的或已授权的视频）；skip 这一镜不要。
 */
export type ReplicaShotTreatment = "remake" | "product" | "original" | "skip";

export const REPLICA_TREATMENTS: { value: ReplicaShotTreatment; label: string; hint: string }[] = [
    { value: "remake", label: "按描述重做", hint: "照着这一镜的描述重新生成首帧和视频" },
    { value: "product", label: "换成我的商品", hint: "首帧里的商品换成你的商品，有商品图时用商品图参考" },
    { value: "original", label: "沿用原片画面", hint: "原片关键帧直接当首帧，只用于自己的或已授权的视频" },
    { value: "skip", label: "不要这一镜", hint: "去画布时不放进分镜" },
];

export type ReplicaProductImage = { resourceId: string; width: number; height: number; mimeType: string; bytes: number };

export type ReplicaProduct = {
    name: string;
    /** 卖点，一行一条。 */
    sellingPoints: string;
    audience: string;
    /** 外观描述，写进换商品镜头的提示词，例如「白色磨砂瓶身、蓝色瓶盖」。 */
    look: string;
    images: ReplicaProductImage[];
};

export type ReplicaScriptLine = { shotNumber: number; dialogue: string; onScreenText: string };

export type ReplicaScript = { id: string; angle: string; hook: string; lines: ReplicaScriptLine[]; model: string; createdAt: string };

export type ReplicaShotPlan = { shotNumber: number; treatment: ReplicaShotTreatment; dialogue: string; onScreenText: string; imagePrompt: string; videoPrompt: string };

/** 按方案建过的一块画布：只用来在页面上列出和打开，画布本身在画布列表里。 */
export type ReplicaCanvasRef = { id: string; title: string; createdAt: string; shots: number };

export type VideoReplicaPlan = { version: 1; authorized: boolean; product: ReplicaProduct; scripts: ReplicaScript[]; activeScriptId: string; shots: ReplicaShotPlan[]; canvases: ReplicaCanvasRef[] };

export const REPLICA_LIMITS = { productName: 60, sellingPoints: 400, audience: 80, look: 120, images: 4, scripts: 6, dialogue: 300, onScreenText: 120, prompt: 2000, canvases: 20 };

const TREATMENTS = REPLICA_TREATMENTS.map((item) => item.value);
/** 中文口播大约每秒 4–5 个字；改写时按每秒 5 个字给上限。 */
const CHARS_PER_SECOND = 5;

function str(value: unknown, max: number) {
    return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function positive(value: unknown) {
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

function defaultShot(shotNumber: number, row: VideoTeardownAnalysisRow | undefined): ReplicaShotPlan {
    const plot = row?.plotDescription || "";
    return {
        shotNumber,
        treatment: videoTeardownRowHasProduct(row) ? "product" : "remake",
        dialogue: row?.dialogue || "",
        onScreenText: row?.onScreenText || "",
        imagePrompt: row?.imageGenerationPrompt || plot,
        videoPrompt: row?.videoMotionPrompt || [plot, row?.motion].filter(Boolean).join("；"),
    };
}

/** 还没有方案时的初始值：有商品的镜头换成我的商品，其余按描述重做；台词和提示词取自分析。 */
export function defaultReplicaPlan(bundle: VideoTeardownBundle, analysis: Pick<VideoTeardownAnalysis, "rows">): VideoReplicaPlan {
    const rows = new Map(analysis.rows.map((row) => [row.shotNumber, row]));
    return {
        version: 1,
        authorized: false,
        product: { name: "", sellingPoints: "", audience: "", look: "", images: [] },
        scripts: [],
        activeScriptId: "",
        shots: bundle.shots.map((shot) => defaultShot(shot.index, rows.get(shot.index))),
        canvases: [],
    };
}

function readImages(value: unknown): ReplicaProductImage[] {
    if (!Array.isArray(value)) return [];
    return value
        .flatMap((item): ReplicaProductImage[] => {
            if (!item || typeof item !== "object") return [];
            const record = item as Record<string, unknown>;
            const resourceId = str(record.resourceId, 128);
            return resourceId ? [{ resourceId, width: positive(record.width), height: positive(record.height), mimeType: str(record.mimeType, 120) || "image/png", bytes: positive(record.bytes) }] : [];
        })
        .slice(0, REPLICA_LIMITS.images);
}

function readLines(value: unknown, shotCount: number): ReplicaScriptLine[] {
    if (!Array.isArray(value)) return [];
    const byShot = new Map<number, ReplicaScriptLine>();
    for (const item of value) {
        if (!item || typeof item !== "object") continue;
        const record = item as Record<string, unknown>;
        const shotNumber = Number(record.shotNumber);
        if (!Number.isSafeInteger(shotNumber) || shotNumber < 1 || shotNumber > shotCount || byShot.has(shotNumber)) continue;
        byShot.set(shotNumber, { shotNumber, dialogue: str(record.dialogue, REPLICA_LIMITS.dialogue), onScreenText: str(record.onScreenText, REPLICA_LIMITS.onScreenText) });
    }
    return [...byShot.values()].sort((left, right) => left.shotNumber - right.shotNumber);
}

/**
 * 读回保存过的方案（展示路径）：缺的字段按分析补，镜头对不上的丢掉再按分析补齐。
 * 不是方案时返回分析生成的初始方案。
 */
export function readReplicaPlan(value: unknown, bundle: VideoTeardownBundle, analysis: Pick<VideoTeardownAnalysis, "rows">): VideoReplicaPlan {
    const fallback = defaultReplicaPlan(bundle, analysis);
    if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
    const record = value as Record<string, unknown>;
    if (record.version !== 1) return fallback;
    const product = (record.product && typeof record.product === "object" ? record.product : {}) as Record<string, unknown>;
    const shotCount = bundle.shots.length;
    const saved = new Map<number, Record<string, unknown>>();
    if (Array.isArray(record.shots))
        for (const item of record.shots) {
            if (!item || typeof item !== "object") continue;
            const shotNumber = Number((item as Record<string, unknown>).shotNumber);
            if (Number.isSafeInteger(shotNumber) && shotNumber >= 1 && shotNumber <= shotCount && !saved.has(shotNumber)) saved.set(shotNumber, item as Record<string, unknown>);
        }
    const authorized = record.authorized === true;
    const shots = fallback.shots.map((base) => {
        const item = saved.get(base.shotNumber);
        if (!item) return base;
        const treatment = TREATMENTS.includes(item.treatment as ReplicaShotTreatment) ? (item.treatment as ReplicaShotTreatment) : base.treatment;
        return {
            shotNumber: base.shotNumber,
            treatment: treatment === "original" && !authorized ? "remake" : treatment,
            dialogue: typeof item.dialogue === "string" ? str(item.dialogue, REPLICA_LIMITS.dialogue) : base.dialogue,
            onScreenText: typeof item.onScreenText === "string" ? str(item.onScreenText, REPLICA_LIMITS.onScreenText) : base.onScreenText,
            imagePrompt: str(item.imagePrompt, REPLICA_LIMITS.prompt) || base.imagePrompt,
            videoPrompt: str(item.videoPrompt, REPLICA_LIMITS.prompt) || base.videoPrompt,
        };
    });
    const scripts = Array.isArray(record.scripts)
        ? record.scripts
              .flatMap((item): ReplicaScript[] => {
                  if (!item || typeof item !== "object") return [];
                  const script = item as Record<string, unknown>;
                  const id = str(script.id, 64);
                  const lines = readLines(script.lines, shotCount);
                  return id && lines.length ? [{ id, angle: str(script.angle, 40), hook: str(script.hook, 120), lines, model: str(script.model, 200), createdAt: str(script.createdAt, 40) }] : [];
              })
              .slice(0, REPLICA_LIMITS.scripts)
        : [];
    const activeScriptId = str(record.activeScriptId, 64);
    const canvases = Array.isArray(record.canvases)
        ? record.canvases
              .flatMap((item): ReplicaCanvasRef[] => {
                  if (!item || typeof item !== "object") return [];
                  const canvas = item as Record<string, unknown>;
                  const id = str(canvas.id, 64);
                  return id ? [{ id, title: str(canvas.title, 120), createdAt: str(canvas.createdAt, 40), shots: positive(canvas.shots) }] : [];
              })
              .slice(0, REPLICA_LIMITS.canvases)
        : [];
    return {
        version: 1,
        authorized,
        product: {
            name: str(product.name, REPLICA_LIMITS.productName),
            sellingPoints: str(product.sellingPoints, REPLICA_LIMITS.sellingPoints),
            audience: str(product.audience, REPLICA_LIMITS.audience),
            look: str(product.look, REPLICA_LIMITS.look),
            images: readImages(product.images),
        },
        scripts,
        activeScriptId: scripts.some((script) => script.id === activeScriptId) ? activeScriptId : "",
        shots: shots.some((shot) => shot.treatment !== "skip") ? shots : fallback.shots,
        canvases,
    };
}

/** 保存前的问题：error 会挡住保存和去画布，warning 只提示。 */
export function replicaPlanIssues(plan: VideoReplicaPlan) {
    const errors: string[] = [];
    const warnings: string[] = [];
    const kept = plan.shots.filter((shot) => shot.treatment !== "skip");
    if (!kept.length) errors.push("至少保留一个镜头");
    if (!plan.authorized && plan.shots.some((shot) => shot.treatment === "original")) errors.push("沿用原片画面前，请先确认这是你自己的视频或已获授权");
    const productShots = kept.filter((shot) => shot.treatment === "product").map((shot) => shot.shotNumber);
    if (productShots.length && !plan.product.images.length) warnings.push(`镜头 ${productShots.join("、")} 要换成你的商品，还没有商品图，只能按文字描述画，外观和包装字不会准`);
    if (productShots.length && !plan.product.name && !plan.product.look) warnings.push("还没有填商品名称和外观，换商品的镜头不知道画成什么");
    return { errors, warnings };
}

function sellingPointList(product: ReplicaProduct) {
    return product.sellingPoints
        .split(/\n+/)
        .map((item) => item.replace(/^[\s\-*·•\d.、]+/, "").trim())
        .filter(Boolean);
}

/** 写进换商品镜头提示词的一句商品说明：名称加外观。 */
export function replicaProductNote(product: ReplicaProduct) {
    return [product.name, product.look].filter(Boolean).join("，");
}

/**
 * 按我的商品改写口播和画面字：保留原片的镜头数、节拍和每镜时长，只改说什么。
 * 一次要 count 个不同切入角度的版本；没被跳过的镜头每个版本都要写。
 */
export function buildReplicaScriptPrompt(bundle: VideoTeardownBundle, analysis: VideoTeardownAnalysis, plan: VideoReplicaPlan, count: number) {
    const rows = new Map(analysis.rows.map((row) => [row.shotNumber, row]));
    const kept = plan.shots.filter((shot) => shot.treatment !== "skip");
    const { product } = plan;
    const points = sellingPointList(product);
    const summary = analysis.summary;
    const lines = [
        `你是短视频带货编导。下面是一条爆款视频逐镜头的拆解，请保留它的镜头结构和节奏，把口播和画面字改写成卖我的商品，给出 ${count} 个切入角度不同的版本。`,
        "",
        "我的商品：",
        `- 名称：${product.name || "（没填，按卖点和外观理解）"}`,
        ...(points.length ? ["- 卖点：", ...points.map((point) => `  - ${point}`)] : ["- 卖点：（没填，只能写外观和使用场景，不要编造功效和数据）"]),
        ...(product.audience ? [`- 目标人群：${product.audience}`] : []),
        ...(product.look ? [`- 外观：${product.look}`] : []),
        "",
        "原片：",
        ...(summary?.genre ? [`- 题材：${summary.genre}`] : []),
        ...(summary?.product ? [`- 原片卖的是：${summary.product}`] : []),
        ...(summary?.hook ? [`- 开头钩子：${summary.hook}`] : []),
        ...(summary?.beats.length ? [`- 节拍：${summary.beats.map((beat) => `${beat.name}（镜头 ${beat.shots.join("、")}）${beat.purpose ? `：${beat.purpose}` : ""}`).join("；")}`] : []),
        "",
        "逐镜头（只改写这些镜头）：",
        ...kept.map((shot) => {
            const row = rows.get(shot.shotNumber);
            const source = bundle.shots[shot.shotNumber - 1];
            const seconds = source ? Math.max(1, Math.round((source.endMs - source.startMs) / 1000)) : 3;
            const parts = [`镜头 ${shot.shotNumber}｜${source ? teardownTimeRange(source) : ""}｜约 ${seconds} 秒，口播最多 ${seconds * CHARS_PER_SECOND} 字`, `画面：${row?.plotDescription || "（无）"}`];
            if (row?.dialogue) parts.push(`原口播：${row.dialogue}`);
            if (row?.onScreenText) parts.push(`原画面字：${row.onScreenText}`);
            const productLabel = videoTeardownProductLabel(row);
            if (productLabel) parts.push(`原片商品：${productLabel}`);
            if (shot.treatment === "product") parts.push("这一镜会换成我的商品");
            return `- ${parts.join("｜")}`;
        }),
        "",
        "要求：",
        "1. 每个版本都要写上面列出的全部镜头，镜头编号不能改、不能合并或拆分；原片这一镜没有口播的，可以继续没有（写空字符串）。",
        "2. 每镜口播不要超过给出的字数，读起来像真人说话，不要书面语。",
        "3. 原片商品的名称、品牌和卖点全部换掉，不要提原片的品牌。",
        "4. 只写我给出的卖点；没给的功效、数据、价格和承诺不要编。不用“最”“第一”“绝对”“根治”这类绝对化或医疗用语。",
        "5. 不同版本的开头钩子和切入角度要明显不同，例如痛点、对比、场景、福利、测评。",
        "6. onScreenText 是画面上要贴的字（标题、卖点花字），简短，没有就写空字符串。",
        "7. 只输出一个 JSON 对象，不要 Markdown 代码块，不要解释。",
        "",
        "输出格式：",
        "{",
        '  "scripts": [',
        '    { "angle": "切入角度，四到六个字", "hook": "开头钩子一句话", "lines": [{ "shotNumber": 1, "dialogue": "这一镜的口播", "onScreenText": "画面字" }] }',
        "  ]",
        "}",
    ];
    return lines.join("\n");
}

/** 解析改写脚本：每个版本必须写到所有要求的镜头，缺镜头的版本丢掉；一个可用的都没有时报错。 */
export function parseReplicaScripts(text: string, shotNumbers: number[], meta: { model: string; createdAt: string; idPrefix: string }): ReplicaScript[] {
    const required = new Set(shotNumbers);
    for (const candidate of jsonCandidates(text)) {
        if (!Array.isArray(candidate.scripts)) continue;
        const scripts = candidate.scripts.flatMap((item, index): ReplicaScript[] => {
            if (!item || typeof item !== "object") return [];
            const record = item as Record<string, unknown>;
            const lines = readLines(record.lines, Math.max(...shotNumbers, 0)).filter((line) => required.has(line.shotNumber));
            if (lines.length !== required.size) return [];
            return [{ id: `${meta.idPrefix}-${index + 1}`, angle: str(record.angle, 40) || `版本 ${index + 1}`, hook: str(record.hook, 120), lines, model: meta.model, createdAt: meta.createdAt }];
        });
        if (scripts.length) return scripts;
    }
    throw new Error("模型没有返回可用的改写脚本，换个模型或再试一次");
}

/** 选用一个改写版本：把它的口播和画面字写进对应镜头，其余字段不动。 */
export function applyReplicaScript(plan: VideoReplicaPlan, script: ReplicaScript): VideoReplicaPlan {
    const lines = new Map(script.lines.map((line) => [line.shotNumber, line]));
    return {
        ...plan,
        activeScriptId: script.id,
        shots: plan.shots.map((shot) => {
            const line = lines.get(shot.shotNumber);
            return line ? { ...shot, dialogue: line.dialogue, onScreenText: line.onScreenText } : shot;
        }),
    };
}

/** 把逐镜改回分析里的原样（台词、画面字和提示词），处理方式保留。 */
export function resetReplicaShot(shot: ReplicaShotPlan, row: VideoTeardownAnalysisRow | undefined): ReplicaShotPlan {
    return { ...defaultShot(shot.shotNumber, row), treatment: shot.treatment };
}

/** 记下按方案新建的画布，最新的排前面，最多留 20 块。 */
export function addReplicaCanvas(plan: VideoReplicaPlan, canvas: ReplicaCanvasRef): VideoReplicaPlan {
    return { ...plan, canvases: [canvas, ...plan.canvases.filter((item) => item.id !== canvas.id)].slice(0, REPLICA_LIMITS.canvases) };
}
