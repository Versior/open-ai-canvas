import { createStoryboardRow } from "@/lib/canvas/canvas-project-domain";
import { modelCompatibilityError, modelRequestOptions, type ModelRequirements } from "@/lib/model-selection";
import type { VideoTeardownBundle, VideoTeardownGrid, VideoTeardownShot } from "@/services/api/video-replication";
import type { AiConfig } from "@/stores/use-config-store";
import type { StoryboardRow } from "@/types/canvas";

/**
 * 视频复刻 · 拆解：把后端算好的镜头清单、宫格和转写拼成看图模型的提示词，解析模型回复，
 * 再合并成分镜行、多维表格和拆解报告。时间码只取后端结果，模型只补语义。
 */

/** 一次请求最多带几张宫格（每张 3 个镜头）；还受所选模型的图片上限约束。 */
export const VIDEO_TEARDOWN_MAX_GRIDS_PER_REQUEST = 8;

/** 拆解选项：分析画面用的文本模型，以及是否识别口播。 */
export type VideoTeardownOptions = { model: string; transcribe: boolean };

export function videoTeardownTextRequirements(config: AiConfig, imageCount: number): ModelRequirements {
    return { capability: "text", input: { textCount: 1, imageCount, videoCount: 0, audioCount: 0, characterCount: 0 }, options: modelRequestOptions(config, "text") };
}

/** 拆解前就能判断的模型问题：没选、不能看图。 */
export function videoTeardownModelError(config: AiConfig, model: string) {
    if (!model) return "请选择用于分析画面的文本模型";
    const error = modelCompatibilityError(config, model, videoTeardownTextRequirements(config, 1));
    return error ? `所选模型不能看图：${error}` : "";
}

const ROW_TEXT_FIELDS = [
    "plotDescription",
    "dialogue",
    "onScreenText",
    "product",
    "keyColors",
    "shotSize",
    "camera",
    "motion",
    "lightingAndAtmosphere",
    "emotion",
    "audioEffects",
    "production",
    "productionConfidence",
    "imageGenerationPrompt",
    "videoMotionPrompt",
    "continuityOut",
] as const;

export type VideoTeardownDialogueSource = "asr" | "subtitle" | "none";

/**
 * 商品在这一镜里的角色，决定复刻时怎么重做（参考 daihuo-fanpai 的 product_role）：
 * none 没有商品；dynamic 商品出镜但质感不必极真；hero_real 质感特写，AI 难画对，要用真实商品图；
 * package_text 包装上的字要看清，要用包装真图或后期贴字。空字符串表示早期分析没有这一项。
 */
export type VideoTeardownProductRole = "" | "none" | "dynamic" | "hero_real" | "package_text";

const PRODUCT_ROLES: VideoTeardownProductRole[] = ["none", "dynamic", "hero_real", "package_text"];

export const PRODUCT_ROLE_LABELS: Record<Exclude<VideoTeardownProductRole, "">, string> = {
    none: "没有商品",
    dynamic: "商品出镜",
    hero_real: "商品质感特写",
    package_text: "包装文字要清楚",
};

export type VideoTeardownAnalysisRow = { shotNumber: number; dialogueSource: VideoTeardownDialogueSource; productRole: VideoTeardownProductRole } & Record<(typeof ROW_TEXT_FIELDS)[number], string>;

/** 「商品」一栏：角色和出镜方式，例如「商品质感特写：一只手把海参掰开，占画面一半」。没有商品时为空。 */
export function videoTeardownProductLabel(row: Pick<VideoTeardownAnalysisRow, "product" | "productRole"> | undefined) {
    if (!row || row.productRole === "none") return "";
    const role = row.productRole ? PRODUCT_ROLE_LABELS[row.productRole] : "";
    return [role, row.product].filter(Boolean).join("：");
}

/**
 * 去画布复刻的两种方式：remake 按分镜重新生成每一镜（不用原片画面和人物），
 * reuse 原片关键帧直接当首帧（只给自己的或已授权的视频用）。两种方式下有商品的镜头都可以换成用户的商品。
 */
export type VideoReplicaMode = "remake" | "reuse";

const NO_PRODUCT_TEXT = /^(无|没有|未出现|不出现|画面中没有|这一镜没有)/;

/** 分析判断有商品的镜头：判了商品角色时按角色；早期分析没有角色，就看「商品出镜」有没有写内容。 */
export function videoTeardownRowHasProduct(row: Pick<VideoTeardownAnalysisRow, "product" | "productRole"> | undefined) {
    if (!row) return false;
    if (row.productRole) return row.productRole !== "none";
    const product = row.product.trim();
    return Boolean(product) && !NO_PRODUCT_TEXT.test(product);
}

/** 分镜行版本的 videoTeardownRowHasProduct。 */
export function videoTeardownProductShot(row: Pick<StoryboardRow, "sourceAnalysis">) {
    return videoTeardownRowHasProduct({ product: row.sourceAnalysis?.product || "", productRole: (row.sourceAnalysis?.productRole || "") as VideoTeardownProductRole });
}

/**
 * 换商品镜头的首帧提示词。reuse 时第一张参考图是这一镜的原画面，其余是商品图；remake 时参考图只有商品图。
 * 原片提示词里的商品描述保留在后面，模型按参考图改成新商品。
 */
export function videoReplicaProductFramePrompt(row: Pick<StoryboardRow, "imageGenerationPrompt" | "plotDescription">, mode: VideoReplicaMode, productNote: string) {
    const note = productNote.trim() ? `（${productNote.trim()}）` : "";
    const lead =
        mode === "reuse"
            ? `第一张参考图是原画面：保持构图、人物、动作、场景和光线不变，只把画面里的商品换成后面商品图里的商品${note}，商品的外观、颜色、比例和包装文字以商品图为准。`
            : `画面里的商品换成参考图里的商品${note}，商品的外观、颜色、比例和包装文字以参考图为准，不要画成原片里的商品。`;
    return [lead, (row.imageGenerationPrompt || row.plotDescription).trim()].filter(Boolean).join("\n");
}

/** 换商品镜头的视频提示词：首帧已经是新商品，提醒视频模型保持住，不要变回原片商品。 */
export function videoReplicaProductVideoPrompt(row: Pick<StoryboardRow, "videoMotionPrompt" | "plotDescription">, productNote: string) {
    const note = productNote.trim() ? `（${productNote.trim()}）` : "";
    return [`画面里的商品始终是首帧里的那件${note}，外观和包装文字不要变。`, (row.videoMotionPrompt || row.plotDescription).trim()].filter(Boolean).join("\n");
}

export type VideoTeardownBeat = { name: string; shots: number[]; purpose: string };

export type VideoTeardownSummary = {
    genre: string;
    /** 原片卖的是什么：商品名称或品类和外观；不是带货视频时为空。 */
    product: string;
    hook: string;
    beats: VideoTeardownBeat[];
    whyItWorks: string[];
    music: string;
    textStyle: string;
    replicationTips: string[];
};

export type VideoTeardownAnalysis = { title: string; summary: VideoTeardownSummary | null; rows: VideoTeardownAnalysisRow[] };

const ROW_SCHEMA = `    {
      "shotNumber": 1,
      "plotDescription": "画面里发生了什么：主体、动作的过程（手怎么动、东西怎么变）、场景",
      "dialogue": "这一镜的口播或台词，没有就写空字符串",
      "dialogueSource": "asr | subtitle | none",
      "onScreenText": "画面上的字幕、花字、标题、价格贴纸，没有就写空字符串",
      "product": "商品在这一镜怎么出现：是哪件、占画面多大、怎么被拿或用；没有商品就写空字符串",
      "productRole": "none | dynamic | hero_real | package_text",
      "keyColors": "关键物体的颜色，例如橙色液体、红色瓶盖；没有就写空字符串",
      "shotSize": "景别",
      "camera": "机位和构图",
      "motion": "运镜",
      "lightingAndAtmosphere": "光线和色调",
      "emotion": "情绪",
      "audioEffects": "画面里能看出的声音线索（歌词字幕、音效花字等），没有线索就写空字符串",
      "production": "实拍 | AI生成 | 3D | 录屏 | 图文动效 | 混合",
      "productionConfidence": "高 | 中 | 低",
      "imageGenerationPrompt": "还原这一镜首帧的画面提示词，写进主体、商品和关键颜色",
      "videoMotionPrompt": "主体动作的过程和运镜，便于用视频模型重做同样结构的镜头",
      "continuityOut": "这一镜结尾时的画面状态"
    }`;

const SUMMARY_SCHEMA = `  "title": "给这条视频起一个简短标题",
  "summary": {
    "genre": "题材和类型，例如口播种草、开箱测评、剧情、教程",
    "product": "原片卖的是什么：商品名称或品类和外观（包装、颜色、形状）；不是带货视频就写空字符串",
    "hook": "前 3 秒用什么抓住人",
    "beats": [{ "name": "节拍名，例如钩子、痛点、卖点、证明、行动号召", "shots": [1, 2], "purpose": "这一段要达到什么目的" }],
    "whyItWorks": ["这条视频吸引人的原因，每条一句"],
    "music": "剪辑节奏（快切、卡点等）；配乐只在画面有明确线索时才写",
    "textStyle": "字幕和花字的风格",
    "replicationTips": ["复刻时保留什么、可以换什么，每条一句"]
  },`;

export function formatTeardownTime(ms: number) {
    const tenths = Math.max(0, Math.round(ms / 100));
    const minutes = Math.floor(tenths / 600);
    const seconds = Math.floor((tenths % 600) / 10);
    return `${minutes}:${String(seconds).padStart(2, "0")}.${tenths % 10}`;
}

/** 把时长上限写成「3 分钟」「45 秒」「1 分 30 秒」，和服务端超时长的提示一致。 */
export function formatDurationLimit(seconds: number) {
    if (seconds >= 60 && seconds % 60 === 0) return `${seconds / 60} 分钟`;
    if (seconds < 60) return `${seconds} 秒`;
    return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}

export function teardownTimeRange(shot: Pick<VideoTeardownShot, "startMs" | "endMs">) {
    return `${formatTeardownTime(shot.startMs)}–${formatTeardownTime(shot.endMs)}`;
}

const BOUNDARY_LABELS: Record<VideoTeardownShot["boundary"], string> = { start: "开头", cut: "切点", split: "同一长镜头切开，画面连续" };

export function orientationLabel(width: number, height: number) {
    if (width === height) return "方形";
    return width > height ? "横屏" : "竖屏";
}

function videoFacts(bundle: VideoTeardownBundle) {
    const { source } = bundle;
    return `视频信息：时长 ${(source.durationMs / 1000).toFixed(1)} 秒，画面 ${source.width}×${source.height}（${orientationLabel(source.width, source.height)}），${source.hasAudio ? "有音轨" : "没有音轨"}，共 ${bundle.shots.length} 个镜头。`;
}

/** 按转写片段的中点把口播分给镜头，一段话只算进一个镜头。 */
export function videoTeardownShotTranscripts(bundle: VideoTeardownBundle) {
    const texts = new Map<number, string[]>();
    for (const segment of bundle.transcript.segments) {
        const text = segment.text.trim();
        if (!text) continue;
        const middle = (segment.startMs + segment.endMs) / 2;
        const shot = bundle.shots.find((item) => middle >= item.startMs && middle < item.endMs) ?? bundle.shots[bundle.shots.length - 1];
        texts.set(shot.index, [...(texts.get(shot.index) || []), text]);
    }
    return new Map(Array.from(texts, ([index, parts]) => [index, parts.join(" ")]));
}

/** 一批宫格对应的看图提示词。只有一批时顺带要全片总结，多批时总结单独再请求一次。 */
export function buildVideoTeardownPrompt(bundle: VideoTeardownBundle, grids: VideoTeardownGrid[], withSummary: boolean) {
    const shotNumbers = grids.flatMap((grid) => grid.shotIndexes);
    const shots = shotNumbers.map((index) => bundle.shots[index - 1]);
    const transcripts = videoTeardownShotTranscripts(bundle);
    const hasTranscript = bundle.transcript.source === "asr";
    const lines = [
        `你是短视频拉片和复刻策划。下面是一条视频的镜头清单和 ${grids.length} 张宫格图。切点和时间码由程序检测，已经确定。`,
        "",
        "宫格怎么看：",
        ...grids.map((grid, index) => `- 第 ${index + 1} 张宫格：从上到下是镜头 ${grid.shotIndexes.join("、")}`),
        "每张宫格一行一个镜头，每行最左边黑底白字的数字就是镜头编号；同一行的三格从左到右是这个镜头的开头、中间、结尾画面，三格都属于同一个镜头。按编号填写，不要自己数行。",
        "",
        videoFacts(bundle),
        "镜头清单：",
        ...shots.map((shot) => `- 镜头 ${shot.index}｜${teardownTimeRange(shot)}｜${BOUNDARY_LABELS[shot.boundary]}`),
        "",
        ...(hasTranscript ? ["语音转写（按镜头分好）：", ...shots.map((shot) => `- 镜头 ${shot.index}：${transcripts.get(shot.index) || "（这一镜没有转写到口播）"}`)] : ["没有语音转写。口播请从画面字幕读，读不到就写空字符串，不要编造。"]),
        "",
        "要求：",
        `1. 只填写这些镜头：${shotNumbers.join("、")}。镜头编号不能改，不能合并或拆分镜头。`,
        "2. 有语音转写时 dialogue 以转写为准，dialogueSource 写 asr；没有转写时从画面字幕读，写 subtitle；都没有就写空字符串和 none。",
        "3. 平台压缩会抹掉噪点等细节，判断制作方式拿不准时 productionConfidence 写“低”。",
        "4. 画面里的人只描述外观和动作，不要猜测真实身份。",
        "5. 你只能看到画面，听不到声音。配乐、音效只写画面里看得出的线索，不要编造。",
        "6. 纯白、全黑、纯色或糊得看不清的画面就照实写，不要套用前后镜头的内容。",
        "7. 动作写过程，不要只写结果：写“一只手把海参掰开”，不要只写“海参剖面”。imageGenerationPrompt 和 videoMotionPrompt 要把这一镜的主体、动作和 keyColors 原样写进去，不要概括掉。",
        "8. productRole 只能是四个值之一：none 画面里没有商品；dynamic 商品出镜，质感不必极真（拿在手里、摆在桌上）；hero_real 商品质感特写（剖面、质地、弹性等细节，AI 很难画对）；package_text 包装上的字要看清。",
        "9. 只输出一个 JSON 对象，不要 Markdown 代码块，不要解释。",
        "",
        "输出格式：",
        "{",
        ...(withSummary ? [SUMMARY_SCHEMA] : []),
        '  "rows": [',
        ROW_SCHEMA,
        "  ]",
        "}",
    ];
    return lines.join("\n");
}

/** 多批分析后的全片总结：不带图片，只给逐镜结果。 */
export function buildVideoTeardownSummaryPrompt(bundle: VideoTeardownBundle, rows: VideoTeardownAnalysisRow[]) {
    const byShot = new Map(rows.map((row) => [row.shotNumber, row]));
    const lines = [
        "你是短视频拉片和复刻策划。下面是一条视频逐镜头的拆解结果，请总结整条视频的结构。你没有听到声音，配乐不要编造。",
        "",
        videoFacts(bundle),
        "逐镜头：",
        ...bundle.shots.map((shot) => {
            const row = byShot.get(shot.index);
            const parts = [`镜头 ${shot.index}｜${teardownTimeRange(shot)}`, `画面：${row?.plotDescription || "（无）"}`];
            if (row?.dialogue) parts.push(`口播：${row.dialogue}`);
            if (row?.onScreenText) parts.push(`画面文字：${row.onScreenText}`);
            const product = videoTeardownProductLabel(row);
            if (product) parts.push(`商品：${product}`);
            if (row?.motion) parts.push(`运镜：${row.motion}`);
            return `- ${parts.join("｜")}`;
        }),
        "",
        "只输出一个 JSON 对象，不要 Markdown 代码块，不要解释：",
        "{",
        SUMMARY_SCHEMA.replace(/,$/, ""),
        "}",
    ];
    return lines.join("\n");
}

/** 模型常把 JSON 包在代码块或说明文字里：依次尝试全文、代码块和配平的大括号片段。 */
export function jsonCandidates(text: string) {
    const candidates = [text.trim(), ...Array.from(text.matchAll(/```(?:json)?\s*([\s\S]*?)\s*```/gi), (match) => match[1].trim())];
    let start = -1;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        if (inString) {
            if (escaped) escaped = false;
            else if (char === "\\") escaped = true;
            else if (char === '"') inString = false;
            continue;
        }
        if (char === '"') inString = true;
        else if (char === "{") {
            if (depth === 0) start = index;
            depth += 1;
        } else if (char === "}" && depth > 0) {
            depth -= 1;
            if (depth === 0 && start >= 0) candidates.push(text.slice(start, index + 1));
        }
    }
    const parsed: Record<string, unknown>[] = [];
    for (const candidate of candidates) {
        try {
            const value: unknown = JSON.parse(candidate);
            if (value && typeof value === "object" && !Array.isArray(value)) parsed.push(value as Record<string, unknown>);
        } catch {
            // 继续尝试下一个片段。
        }
    }
    return parsed;
}

function textValue(value: unknown): string {
    if (typeof value === "string") return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    if (Array.isArray(value)) return value.map(textValue).filter(Boolean).join("、");
    return "";
}

function textList(value: unknown) {
    return Array.isArray(value) ? value.map(textValue).filter(Boolean) : textValue(value) ? [textValue(value)] : [];
}

function dialogueSource(value: unknown, dialogue: string): VideoTeardownDialogueSource {
    const source = textValue(value).toLowerCase();
    if (source === "asr" || source === "subtitle") return dialogue ? source : "none";
    return dialogue ? "subtitle" : "none";
}

/** 不认识的值和早期分析里没有的都记成空，页面不猜。 */
function productRole(value: unknown): VideoTeardownProductRole {
    const role = textValue(value).toLowerCase() as VideoTeardownProductRole;
    return PRODUCT_ROLES.includes(role) ? role : "";
}

function parseSummary(value: unknown): VideoTeardownSummary | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const summary = value as Record<string, unknown>;
    const beats = Array.isArray(summary.beats)
        ? summary.beats.flatMap((beat): VideoTeardownBeat[] => {
              if (!beat || typeof beat !== "object") return [];
              const record = beat as Record<string, unknown>;
              const name = textValue(record.name);
              const shots = Array.isArray(record.shots) ? record.shots.map(Number).filter((shot) => Number.isSafeInteger(shot) && shot > 0) : [];
              return name ? [{ name, shots, purpose: textValue(record.purpose) }] : [];
          })
        : [];
    return {
        genre: textValue(summary.genre),
        product: textValue(summary.product),
        hook: textValue(summary.hook),
        beats,
        whyItWorks: textList(summary.whyItWorks),
        music: textValue(summary.music),
        textStyle: textValue(summary.textStyle),
        replicationTips: textList(summary.replicationTips),
    };
}

/**
 * 解析一批镜头的模型回复。期望的镜头必须全部出现，否则报错让调用方重试，不拿空行补齐；
 * 清单之外的行忽略。
 */
export function parseVideoTeardownAnalysis(text: string, expectedShots: number[], withSummary: boolean): VideoTeardownAnalysis {
    let missing: number[] = expectedShots;
    for (const candidate of jsonCandidates(text)) {
        if (!Array.isArray(candidate.rows)) continue;
        const byShot = new Map<number, VideoTeardownAnalysisRow>();
        for (const item of candidate.rows) {
            if (!item || typeof item !== "object" || Array.isArray(item)) continue;
            const record = item as Record<string, unknown>;
            const shotNumber = Number(record.shotNumber);
            if (!expectedShots.includes(shotNumber) || byShot.has(shotNumber)) continue;
            const fields = Object.fromEntries(ROW_TEXT_FIELDS.map((field) => [field, textValue(record[field])])) as Record<(typeof ROW_TEXT_FIELDS)[number], string>;
            byShot.set(shotNumber, { ...fields, shotNumber, dialogueSource: dialogueSource(record.dialogueSource, fields.dialogue), productRole: productRole(record.productRole) });
        }
        const absent = expectedShots.filter((shot) => !byShot.has(shot));
        if (absent.length) {
            if (absent.length < missing.length) missing = absent;
            continue;
        }
        return {
            title: withSummary ? textValue(candidate.title) : "",
            summary: withSummary ? parseSummary(candidate.summary) : null,
            rows: expectedShots.map((shot) => byShot.get(shot)!),
        };
    }
    throw new Error(missing.length === expectedShots.length ? "模型没有返回可用的拆解 JSON" : `模型返回的拆解结果缺少镜头 ${missing.join("、")}`);
}

export function parseVideoTeardownSummary(text: string): { title: string; summary: VideoTeardownSummary } {
    for (const candidate of jsonCandidates(text)) {
        const summary = parseSummary(candidate.summary);
        if (summary) return { title: textValue(candidate.title), summary };
    }
    throw new Error("模型没有返回可用的全片总结");
}

/** 分镜行：时长、原片时间码、关键帧时间只取后端结果，画面、口播、运镜等取模型分析。 */
export function videoTeardownStoryboardRows(bundle: VideoTeardownBundle, rows: VideoTeardownAnalysisRow[]): StoryboardRow[] {
    const byShot = new Map(rows.map((row) => [row.shotNumber, row]));
    return bundle.shots.map((shot) => {
        const row = byShot.get(shot.index);
        const plotDescription = row?.plotDescription || "";
        return createStoryboardRow(shot.index, {
            durationSeconds: Math.max(1, Math.round((shot.endMs - shot.startMs) / 1000)),
            sourceStartMs: shot.startMs,
            sourceEndMs: shot.endMs,
            keyframeTimeMs: shot.keyframeTimeMs,
            plotDescription,
            dialogue: row?.dialogue || "",
            shotSize: row?.shotSize || "",
            camera: row?.camera || "",
            motion: row?.motion || "",
            lightingAndAtmosphere: row?.lightingAndAtmosphere || "",
            emotion: row?.emotion || "",
            audioEffects: row?.audioEffects || "",
            imageGenerationPrompt: row?.imageGenerationPrompt || plotDescription,
            videoMotionPrompt: row?.videoMotionPrompt || [plotDescription, row?.motion].filter(Boolean).join("；"),
            continuityOut: row?.continuityOut || "",
            sourceAnalysis: {
                boundary: shot.boundary,
                onScreenText: row?.onScreenText || "",
                product: row?.product || "",
                productRole: row?.productRole || "",
                keyColors: row?.keyColors || "",
                production: row?.production || "",
                productionConfidence: row?.productionConfidence || "",
                dialogueSource: row?.dialogueSource || "none",
                keyframeResourceId: shot.keyframeResourceId,
            },
        });
    });
}

function productionLabel(row: StoryboardRow) {
    const production = row.sourceAnalysis?.production || "";
    const confidence = row.sourceAnalysis?.productionConfidence || "";
    return production && confidence ? `${production}（把握${confidence}）` : production;
}

function markdownCell(value: string) {
    return value.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ");
}

/** 拆解报告（Markdown 节点内容）：全片结构、逐镜速览和注意事项。 */
export function videoTeardownReportMarkdown(bundle: VideoTeardownBundle, analysis: Pick<VideoTeardownAnalysis, "title" | "summary">, rows: StoryboardRow[]) {
    const { source } = bundle;
    const summary = analysis.summary;
    const shotTime = (shot: number) => {
        const item = bundle.shots[shot - 1];
        return item ? teardownTimeRange(item) : "";
    };
    const lines = [
        `# 拆解报告：${analysis.title || "视频拆解"}`,
        "",
        `- 时长 ${(source.durationMs / 1000).toFixed(1)} 秒 · ${bundle.shots.length} 个镜头 · ${source.width}×${source.height}（${orientationLabel(source.width, source.height)}）`,
        `- 口播：${bundle.transcript.source === "asr" ? "来自语音转写" : `没有语音转写${bundle.transcript.note ? `（${bundle.transcript.note}）` : ""}，来自画面字幕`}`,
    ];
    if (summary?.genre) lines.push(`- 题材：${summary.genre}`);
    if (summary?.product) lines.push(`- 原片商品：${summary.product}`);
    if (summary?.hook) lines.push("", "## 钩子", "", summary.hook);
    if (summary?.beats.length) {
        lines.push("", "## 节拍", "", "| 节拍 | 镜头 | 原片时间 | 目的 |", "| --- | --- | --- | --- |");
        for (const beat of summary.beats) {
            const first = beat.shots[0];
            const last = beat.shots[beat.shots.length - 1];
            const time = first && last && bundle.shots[first - 1] && bundle.shots[last - 1] ? `${formatTeardownTime(bundle.shots[first - 1].startMs)}–${formatTeardownTime(bundle.shots[last - 1].endMs)}` : "";
            lines.push(`| ${markdownCell(beat.name)} | ${beat.shots.join("、")} | ${time} | ${markdownCell(beat.purpose)} |`);
        }
    }
    if (summary?.whyItWorks.length) lines.push("", "## 为什么能吸引人", "", ...summary.whyItWorks.map((item) => `- ${item}`));
    if (summary?.music || summary?.textStyle) {
        lines.push("", "## 声音与花字", "");
        if (summary.music) lines.push(`- 节奏与配乐：${summary.music}`);
        if (summary.textStyle) lines.push(`- 字幕与花字：${summary.textStyle}`);
    }
    if (summary?.replicationTips.length) lines.push("", "## 复刻建议", "", ...summary.replicationTips.map((item) => `- ${item}`));
    lines.push("", "## 逐镜速览", "", "| 镜头 | 原片时间 | 画面 | 口播 | 商品 | 制作方式 |", "| --- | --- | --- | --- | --- | --- |");
    for (const row of rows) {
        const product = videoTeardownProductLabel({ product: row.sourceAnalysis?.product || "", productRole: row.sourceAnalysis?.productRole || "" });
        lines.push(`| ${row.shotNumber} | ${shotTime(row.shotNumber)} | ${markdownCell(row.plotDescription)} | ${markdownCell(row.dialogue)} | ${markdownCell(product)} | ${markdownCell(productionLabel(row))} |`);
    }
    lines.push("", "## 说明", "");
    for (const warning of bundle.warnings) lines.push(`- ${warning}`);
    lines.push("- 切点和时间码由程序检测；画面、口播和制作方式是模型判断，可在分镜表里修改。");
    lines.push("- 拆解用于学习结构和节奏。复刻请使用你有权使用的素材和形象，不要搬运原视频的画面、音乐或人物。");
    return lines.join("\n");
}

/** 视频复刻页面保存到服务端的分析：所用模型、标题、全片总结和逐镜结果，镜头编号与拆解结果一一对应。 */
export type VideoReplicationAnalysisDocument = { version: 1; model: string; title: string; summary: VideoTeardownSummary | null; rows: VideoTeardownAnalysisRow[] };

export function videoReplicationAnalysisDocument(analysis: VideoTeardownAnalysis, model: string): VideoReplicationAnalysisDocument {
    return { version: 1, model, title: analysis.title, summary: analysis.summary, rows: analysis.rows };
}

/**
 * 读回保存过的分析（展示路径）：复用模型回复的解析规则，字段缺失按空字符串显示。
 * 版本不对或镜头对不上时返回 null，页面按“还没有分析”处理并提供重新分析。
 */
export function readVideoReplicationAnalysis(value: unknown, shotCount: number): (VideoTeardownAnalysis & { model: string }) | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    if (record.version !== 1 || !Array.isArray(record.rows) || shotCount < 1) return null;
    const expected = Array.from({ length: shotCount }, (_, index) => index + 1);
    try {
        const parsed = parseVideoTeardownAnalysis(JSON.stringify({ title: record.title, summary: record.summary, rows: record.rows }), expected, true);
        return { ...parsed, model: textValue(record.model) };
    } catch {
        return null;
    }
}
