import { jsonCandidates, teardownTimeRange, videoTeardownProductLabel, videoTeardownRowHasProduct, type VideoTeardownAnalysis, type VideoTeardownAnalysisRow } from "@/lib/canvas/video-teardown";
import type { VideoTeardownBundle } from "@/services/api/video-replication";
import { readReplicaCampaign, readReplicaDirection, readReplicaStrategy, replicaCampaignPrompt, REPLICA_DIRECTOR_OPTIONS, type ReplicaCampaign, type ReplicaDirection, type ReplicaStrategy } from "./replica-director";
import { replicaProductFacts } from "@/lib/remake/director-plan";

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

export type ReplicaScriptLine = { shotNumber: number; dialogue: string; onScreenText: string; director?: ReplicaDirection; imagePrompt?: string; videoPrompt?: string };

export type ReplicaScript = { id: string; angle: string; hook: string; lines: ReplicaScriptLine[]; model: string; createdAt: string; strategy?: ReplicaStrategy };

export type ReplicaShotPlan = { shotNumber: number; treatment: ReplicaShotTreatment; dialogue: string; onScreenText: string; imagePrompt: string; videoPrompt: string; director?: ReplicaDirection };

/** 按方案建过的一块画布：只用来在页面上列出和打开，画布本身在画布列表里。 */
export type ReplicaCanvasRef = { id: string; title: string; createdAt: string; shots: number };

export type VideoReplicaPlan = { version: 1; authorized: boolean; product: ReplicaProduct; scripts: ReplicaScript[]; activeScriptId: string; shots: ReplicaShotPlan[]; canvases: ReplicaCanvasRef[]; campaign?: ReplicaCampaign };

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
        const director = readReplicaDirection(record.director);
        byShot.set(shotNumber, {
            shotNumber,
            dialogue: str(record.dialogue, REPLICA_LIMITS.dialogue),
            onScreenText: str(record.onScreenText, REPLICA_LIMITS.onScreenText),
            ...(director ? { director } : {}),
            ...(str(record.imagePrompt, REPLICA_LIMITS.prompt) ? { imagePrompt: str(record.imagePrompt, REPLICA_LIMITS.prompt) } : {}),
            ...(str(record.videoPrompt, REPLICA_LIMITS.prompt) ? { videoPrompt: str(record.videoPrompt, REPLICA_LIMITS.prompt) } : {}),
        });
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
        const director = readReplicaDirection(item.director);
        return {
            shotNumber: base.shotNumber,
            ...(director ? { director } : {}),
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
                  const strategy = readReplicaStrategy(script.strategy);
                  return id && lines.length ? [{ id, angle: str(script.angle, 40), hook: str(script.hook, 120), lines, model: str(script.model, 200), createdAt: str(script.createdAt, 40), ...(strategy ? { strategy } : {}) }] : [];
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
        ...(readReplicaCampaign(record.campaign) ? { campaign: readReplicaCampaign(record.campaign) } : {}),
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
    return replicaProductFacts(product.sellingPoints);
}

/** 写进换商品镜头提示词的一句商品说明：名称加外观。 */
export function replicaProductNote(product: ReplicaProduct) {
    return [product.name, product.look].filter(Boolean).join("，");
}

/**
 * 按我的商品改写口播和画面字：保留原片的镜头数、节拍和每镜时长，只改说什么。
 * 一次要 count 个不同切入角度的版本；没被跳过的镜头每个版本都要写。
 */
export function buildReplicaScriptPrompt(bundle: VideoTeardownBundle, analysis: VideoTeardownAnalysis, plan: VideoReplicaPlan, count: number, imageCount = 0) {
    const rows = new Map(analysis.rows.map((row) => [row.shotNumber, row]));
    const kept = plan.shots.filter((shot) => shot.treatment !== "skip");
    const { product } = plan;
    const points = sellingPointList(product);
    const summary = analysis.summary;
    const lines = [
        plan.campaign
            ? `你是视频导演与创意策划。依据新商品、目标观众和平台观看情境，给出 ${count} 个全片策略与逐镜执行方案。保留镜头编号和时长，重新选择切入问题、动作证据和色调，不只改口播，不固定套五段模板。`
            : `你是短视频带货编导。下面是一条爆款视频逐镜头的拆解，请保留它的镜头结构和节奏，把口播和画面字改写成卖我的商品，给出 ${count} 个切入角度不同的版本。`,
        "",
        "我的商品：",
        imageCount ? `附件图1至图${imageCount}是新商品实拍，观察外观、颜色和可见结构来选择拍法与色调；图片不能证明性能、材质成分或操作方式。未附原视频，原片只依据文字拆解。` : "本请求未附图片或原视频，只依据文字档案和拆解策划，不能声称看过商品实拍。",
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
            const seconds = source ? (source.endMs - source.startMs) / 1000 : 3;
            const parts = [`镜头 ${shot.shotNumber}｜${source ? teardownTimeRange(source) : ""}｜约 ${seconds} 秒，口播最多 ${Math.floor(seconds * CHARS_PER_SECOND)} 字`, `画面：${row?.plotDescription || "（无）"}`];
            if (row?.dialogue) parts.push(`原口播：${row.dialogue}`);
            if (row?.onScreenText) parts.push(`原画面字：${row.onScreenText}`);
            const productLabel = videoTeardownProductLabel(row);
            if (productLabel) parts.push(`原片商品：${productLabel}`);
            if (shot.treatment === "product") parts.push("这一镜会换成我的商品");
            return `- ${parts.join("｜")}`;
        }),
        "",
        "要求：",
        ...(plan.campaign
            ? [
                  replicaCampaignPrompt(plan.campaign),
                  `每版先输出 strategy：audience（观众及购买角色）、insight（顾虑）、proposition（核心主张）、hook（首镜可见钩子）、method（明确拍法）、narrative（明确叙事）、rationale（商品/平台/镜头预算的选法理由与原片取舍）、visual（场景色调布光及理由）、sound（声音意图）、cta（目标对应收束）、missing（待补资料数组）。文本每项最多400字。method 从 ${Object.keys(
                      REPLICA_DIRECTOR_OPTIONS.style,
                  )
                      .filter((key) => key !== "auto")
                      .join("/")} 选，narrative 从 ${Object.keys(REPLICA_DIRECTOR_OPTIONS.narrative)
                      .filter((key) => key !== "auto")
                      .join("/")} 选；遵守用户明确选择。`,
                  `每条 lines 还要输出 imagePrompt（动作前的首帧摄影画面）、videoPrompt（动作过程与结束），以及 director：${JSON.stringify({ beat: REPLICA_DIRECTOR_OPTIONS.beat, framing: REPLICA_DIRECTOR_OPTIONS.framing, camera: REPLICA_DIRECTOR_OPTIONS.camera, transition: REPLICA_DIRECTOR_OPTIONS.transition })}中的枚举只选一个值，另写 purpose（本镜解决的问题）、start（动作前状态）、action（一个具体过程）、end（结束状态）、lighting（布光色调）、evidence（逐字引用一条商品卖点或空字符串）、sound（声音意图）。proof 必须填写原文依据，没有依据改成 demo。`,
              ]
            : []),
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
        plan.campaign
            ? '    { "angle":"切入角度", "hook":"首镜钩子", "strategy":{"audience":"","insight":"","proposition":"","hook":"","method":"demo","narrative":"howto","rationale":"","visual":"","sound":"","cta":"","missing":[]}, "lines":[{"shotNumber":1,"dialogue":"","onScreenText":"","imagePrompt":"","videoPrompt":"","director":{"beat":"demo","framing":"close","camera":"locked","transition":"cut","purpose":"","start":"","action":"","end":"","lighting":"","evidence":"","sound":""}}] }'
            : '    { "angle": "切入角度，四到六个字", "hook": "开头钩子一句话", "lines": [{ "shotNumber": 1, "dialogue": "这一镜的口播", "onScreenText": "画面字" }] }',
        "  ]",
        "}",
    ];
    return lines.join("\n");
}

/** 解析改写脚本：每个版本必须写到所有要求的镜头，缺镜头的版本丢掉；一个可用的都没有时报错。 */
export function parseReplicaScripts(text: string, shotNumbers: number[], meta: { model: string; createdAt: string; idPrefix: string; directed?: boolean; requireStrategy?: boolean; seconds?: Map<number, number>; facts?: string[] }): ReplicaScript[] {
    const required = new Set(shotNumbers);
    for (const candidate of jsonCandidates(text)) {
        if (!Array.isArray(candidate.scripts)) continue;
        const scripts = candidate.scripts.flatMap((item, index): ReplicaScript[] => {
            if (!item || typeof item !== "object") return [];
            const record = item as Record<string, unknown>;
            const strategy = readReplicaStrategy(record.strategy);
            if (meta.requireStrategy && !strategy) return [];
            if (
                meta.directed &&
                Array.isArray(record.lines) &&
                record.lines.some((item) => {
                    if (!item || typeof item !== "object") return true;
                    const line = item as Record<string, unknown>;
                    const director = line.director && typeof line.director === "object" ? (line.director as Record<string, unknown>) : {};
                    return [
                        [line.dialogue, REPLICA_LIMITS.dialogue],
                        [line.onScreenText, REPLICA_LIMITS.onScreenText],
                        [line.imagePrompt, REPLICA_LIMITS.prompt],
                        [line.videoPrompt, REPLICA_LIMITS.prompt],
                        [director.action, 300],
                        [director.evidence, 200],
                        [director.sound, 120],
                        [director.purpose, 200],
                        [director.start, 200],
                        [director.end, 200],
                        [director.lighting, 200],
                    ].some(([value, max]) => typeof value === "string" && [...value].length > Number(max));
                })
            )
                return [];
            const lines = readLines(record.lines, Math.max(...shotNumbers, 0)).filter((line) => required.has(line.shotNumber));
            if (lines.length !== required.size) return [];
            if (meta.directed && lines.some((line) => !line.director?.action || !line.imagePrompt || !line.videoPrompt)) return [];
            if (meta.requireStrategy && lines.some((line) => !line.director?.purpose || !line.director.start || !line.director.end || !line.director.lighting)) return [];
            if (meta.facts && lines.some((line) => (line.director?.beat === "proof" && !line.director.evidence) || (line.director?.evidence && !meta.facts?.includes(line.director.evidence)))) return [];
            if (meta.seconds && lines.some((line) => [...line.dialogue.replace(/\s/g, "")].length > Math.floor((meta.seconds?.get(line.shotNumber) || 0) * CHARS_PER_SECOND))) return [];
            return [{ id: `${meta.idPrefix}-${index + 1}`, angle: str(record.angle, 40) || `版本 ${index + 1}`, hook: str(record.hook, 120), lines, model: meta.model, createdAt: meta.createdAt, ...(strategy ? { strategy } : {}) }];
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
            return line
                ? {
                      ...shot,
                      dialogue: line.dialogue,
                      onScreenText: line.onScreenText,
                      ...(line.director ? { director: line.director } : {}),
                      ...(line.imagePrompt ? { imagePrompt: line.imagePrompt } : {}),
                      ...(line.videoPrompt ? { videoPrompt: line.videoPrompt } : {}),
                  }
                : shot;
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
