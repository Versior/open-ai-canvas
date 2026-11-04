import { createStoryboardRow } from "@/lib/canvas/canvas-project-domain";
import { modelCompatibilityError, modelRequestOptions, type ModelRequirements } from "@/lib/model-selection";
import type { VideoTeardownBundle, VideoTeardownGrid, VideoTeardownShot } from "@/services/api/video-replication";
import type { AiConfig } from "@/stores/use-config-store";
import type { CanvasBatchTableData, StoryboardRow } from "@/types/canvas";

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

export type VideoTeardownAnalysisRow = { shotNumber: number; dialogueSource: VideoTeardownDialogueSource } & Record<(typeof ROW_TEXT_FIELDS)[number], string>;

export type VideoTeardownBeat = { name: string; shots: number[]; purpose: string };

export type VideoTeardownSummary = {
    genre: string;
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
      "plotDescription": "画面里发生了什么：主体、动作、场景",
      "dialogue": "这一镜的口播或台词，没有就写空字符串",
      "dialogueSource": "asr | subtitle | none",
      "onScreenText": "画面上的字幕、花字、标题、价格贴纸，没有就写空字符串",
      "shotSize": "景别",
      "camera": "机位和构图",
      "motion": "运镜",
      "lightingAndAtmosphere": "光线和色调",
      "emotion": "情绪",
      "audioEffects": "画面里能看出的声音线索（歌词字幕、音效花字等），没有线索就写空字符串",
      "production": "实拍 | AI生成 | 3D | 录屏 | 图文动效 | 混合",
      "productionConfidence": "高 | 中 | 低",
      "imageGenerationPrompt": "还原这一镜首帧的画面提示词",
      "videoMotionPrompt": "主体动作和运镜，便于用视频模型重做同样结构的镜头",
      "continuityOut": "这一镜结尾时的画面状态"
    }`;

const SUMMARY_SCHEMA = `  "title": "给这条视频起一个简短标题",
  "summary": {
    "genre": "题材和类型，例如口播种草、开箱测评、剧情、教程",
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

export function teardownTimeRange(shot: Pick<VideoTeardownShot, "startMs" | "endMs">) {
    return `${formatTeardownTime(shot.startMs)}–${formatTeardownTime(shot.endMs)}`;
}

const BOUNDARY_LABELS: Record<VideoTeardownShot["boundary"], string> = { start: "开头", cut: "切点", split: "同一长镜头切开，画面连续" };

function orientationLabel(width: number, height: number) {
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
        ...grids.map((grid, index) => `- 第 ${index + 1} 张宫格：镜头 ${grid.shotIndexes.join("、")}`),
        "每张宫格一行一个镜头，三列从左到右是这个镜头的开头、中间、结尾画面。",
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
        "6. 只输出一个 JSON 对象，不要 Markdown 代码块，不要解释。",
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
function jsonCandidates(text: string) {
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
            byShot.set(shotNumber, { ...fields, shotNumber, dialogueSource: dialogueSource(record.dialogueSource, fields.dialogue) });
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
                production: row?.production || "",
                productionConfidence: row?.productionConfidence || "",
                dialogueSource: row?.dialogueSource || "none",
                keyframeResourceId: shot.keyframeResourceId,
            },
        });
    });
}

const TEARDOWN_TABLE_COLUMNS: Array<{ id: string; label: string }> = [
    { id: "teardown-time", label: "原片时间" },
    { id: "storyboard-durationSeconds", label: "时长（秒）" },
    { id: "storyboard-plotDescription", label: "画面描述" },
    { id: "storyboard-dialogue", label: "台词/旁白" },
    { id: "teardown-onScreenText", label: "画面文字" },
    { id: "storyboard-shotSize", label: "景别" },
    { id: "storyboard-camera", label: "镜头设计" },
    { id: "storyboard-motion", label: "运镜" },
    { id: "storyboard-lightingAndAtmosphere", label: "光影氛围" },
    { id: "storyboard-emotion", label: "情绪" },
    { id: "storyboard-audioEffects", label: "音效/音乐" },
    { id: "teardown-production", label: "制作方式" },
    { id: "storyboard-imageGenerationPrompt", label: "首帧提示词" },
    { id: "storyboard-videoMotionPrompt", label: "视频提示词" },
    { id: "storyboard-continuityOut", label: "结尾状态" },
];

function productionLabel(row: StoryboardRow) {
    const production = row.sourceAnalysis?.production || "";
    const confidence = row.sourceAnalysis?.productionConfidence || "";
    return production && confidence ? `${production}（把握${confidence}）` : production;
}

/**
 * 拆解分镜表：每行一个镜头，参考列是这一镜的关键帧。storyboardRows 保留原片时间码和拆解信息，
 * 从表格生成视频脚本时沿用。
 */
export function videoTeardownBatchTable(storyboardRows: StoryboardRow[], options: { title: string; sourceNodeId: string; keyframeNodeIds: string[] }): CanvasBatchTableData {
    return {
        operation: "creative",
        concurrency: 10,
        aiGenerated: true,
        contentKind: "storyboard",
        storyboardRows,
        storyboardTitle: options.title,
        storyboardSourceNodeIds: [options.sourceNodeId],
        referenceColumns: [{ id: "ai-ref", label: "关键帧", type: "image" }],
        textColumns: TEARDOWN_TABLE_COLUMNS.map((column) => ({ ...column, type: "text" as const })),
        rows: storyboardRows.map((row, index) => ({
            id: row.id,
            enabled: true,
            inputNodeIds: options.keyframeNodeIds[index] ? [options.keyframeNodeIds[index]] : [],
            prompt: row.videoMotionPrompt || row.plotDescription,
            cells: {
                "teardown-time": row.sourceStartMs !== undefined && row.sourceEndMs !== undefined ? teardownTimeRange({ startMs: row.sourceStartMs, endMs: row.sourceEndMs }) : "",
                "storyboard-durationSeconds": String(row.durationSeconds),
                "storyboard-plotDescription": row.plotDescription,
                "storyboard-dialogue": row.dialogue,
                "teardown-onScreenText": row.sourceAnalysis?.onScreenText || "",
                "storyboard-shotSize": row.shotSize,
                "storyboard-camera": row.camera,
                "storyboard-motion": row.motion,
                "storyboard-lightingAndAtmosphere": row.lightingAndAtmosphere,
                "storyboard-emotion": row.emotion,
                "storyboard-audioEffects": row.audioEffects,
                "teardown-production": productionLabel(row),
                "storyboard-imageGenerationPrompt": row.imageGenerationPrompt,
                "storyboard-videoMotionPrompt": row.videoMotionPrompt,
                "storyboard-continuityOut": row.continuityOut,
            },
        })),
    };
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
        `- 口播：${bundle.transcript.source === "asr" ? "来自语音转写" : "没有语音转写，来自画面字幕"}`,
    ];
    if (summary?.genre) lines.push(`- 题材：${summary.genre}`);
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
    lines.push("", "## 逐镜速览", "", "| 镜头 | 原片时间 | 画面 | 口播 | 制作方式 |", "| --- | --- | --- | --- | --- |");
    for (const row of rows) {
        lines.push(`| ${row.shotNumber} | ${shotTime(row.shotNumber)} | ${markdownCell(row.plotDescription)} | ${markdownCell(row.dialogue)} | ${markdownCell(productionLabel(row))} |`);
    }
    lines.push("", "## 说明", "");
    for (const warning of bundle.warnings) lines.push(`- ${warning}`);
    lines.push("- 切点和时间码由程序检测；画面、口播和制作方式是模型判断，可在分镜表里修改。");
    lines.push("- 拆解用于学习结构和节奏。复刻请使用你有权使用的素材和形象，不要搬运原视频的画面、音乐或人物。");
    return lines.join("\n");
}
