import type { StudioTextZone } from "./shot-specs";
import type { StudioDesignToneId } from "./types";
import { STUDIO_SANS, studioCopyPair, studioTypography, type StudioTypography } from "./typography";

/**
 * 程序排字：模型只出留白底图，文字在浏览器里排上去，保证每个字都准确、事后还能改。
 * 排版计算是纯函数（注入测量函数），绘制只负责执行结果，方便单测。
 */
export const STUDIO_TYPE_STACK = '"PingFang SC", "Hiragino Sans GB", "Source Han Sans SC", "Noto Sans CJK SC", "Microsoft YaHei", "Inter", sans-serif';

export type StudioTypesetText = { headline: string; subline: string; lines: string[]; eyebrow?: string };
export type StudioTypesetOp = { text: string; x: number; y: number; size: number; weight: number; tone: "ink" | "soft"; align: "left" | "center"; family?: string; tracking?: number };
export type StudioMeasure = (text: string, size: number, weight: number, family?: string) => number;

type Block = { text: string; size: number; weight: number; tone: "ink" | "soft"; gapBefore: number; family?: string; tracking?: number };

/** 英文按单词换行，中文和超长词逐字换行。 */
export function wrapStudioText(text: string, maxWidth: number, measure: (value: string) => number) {
    const lines: string[] = [];
    let current = "";
    for (const token of text.match(/\n|[A-Za-z0-9.%+\-/#]+|[^\S\n]+|./gu) || []) {
        if (token === "\n") {
            lines.push(current.trimEnd());
            current = "";
            continue;
        }
        const next = current + token;
        if (!current || measure(next) <= maxWidth) {
            current = next;
            continue;
        }
        lines.push(current.trimEnd());
        current = token.trimStart();
        while (current && measure(current) > maxWidth && current.length > 1) {
            let cut = current.length - 1;
            while (cut > 1 && measure(current.slice(0, cut)) > maxWidth) cut -= 1;
            lines.push(current.slice(0, cut));
            current = current.slice(cut);
        }
    }
    if (current.trim()) lines.push(current.trimEnd());
    return lines;
}

function blocksFor(content: StudioTypesetText, base: number, typography?: StudioTypography): Block[] {
    const blocks: Block[] = [];
    if (content.eyebrow?.trim()) blocks.push({ text: content.eyebrow.trim(), size: base * 0.28, weight: 600, tone: "soft", gapBefore: 0 });
    if (content.headline.trim())
        blocks.push({ text: content.headline.trim(), size: base, weight: typography?.headlineWeight || 700, family: typography?.family, tracking: (typography?.tracking || 0) * base, tone: "ink", gapBefore: blocks.length ? base * 0.24 : 0 });
    if (content.subline.trim()) blocks.push({ text: content.subline.trim(), size: base * (typography ? typography.sublineScale || 0.34 : 0.48), weight: 400, tone: "soft", gapBefore: blocks.length ? base * 0.32 : 0 });
    content.lines
        .map((line) => line.trim())
        .filter(Boolean)
        .forEach((line, index) => {
            const [title, detail] = studioCopyPair(line);
            const gap = blocks.length ? base * (index === 0 ? 0.7 : 0.46) : 0;
            blocks.push({ text: title.trim(), size: base * 0.5, weight: 600, tone: "ink", gapBefore: gap });
            if (detail?.trim()) blocks.push({ text: detail.trim(), size: base * 0.4, weight: 400, tone: "soft", gapBefore: base * 0.12 });
        });
    return blocks;
}

/** 在文字区内排版；放不下时等比缩小字号，最多缩到 55%。 */
export function planStudioTypeset(input: { canvas: { width: number; height: number }; zone: StudioTextZone; content: StudioTypesetText; measure: StudioMeasure; typography?: StudioTypography }): StudioTypesetOp[] {
    const { canvas, zone, content, measure, typography } = input;
    const box = { x: zone.x * canvas.width, y: zone.y * canvas.height, width: zone.width * canvas.width, height: zone.height * canvas.height };
    const start = Math.min(canvas.width, canvas.height) * 0.075 * (typography?.headlineScale || 1);
    const steps = 9;
    for (let step = 0; step <= steps; step += 1) {
        const scale = 1 - step * 0.05;
        const lines: (Omit<Block, "gapBefore"> & { top: number })[] = [];
        let cursor = 0;
        for (const block of blocksFor(content, start * scale, typography)) {
            cursor += block.gapBefore;
            for (const line of wrapStudioText(block.text, box.width, (value) => measure(value, block.size, block.weight, block.family) + Math.max(0, Array.from(value).length - 1) * (block.tracking || 0))) {
                lines.push({ ...block, text: line, top: cursor });
                cursor += block.size * (block.family ? typography?.lineHeight || 1.28 : 1.28);
            }
        }
        if (cursor > box.height) {
            if (step < steps) continue;
            throw new Error("文案超出排版区域，请缩短文字或拆屏后再导出");
        }
        if (lines.some((line) => measure(line.text, line.size, line.weight, line.family) + Math.max(0, Array.from(line.text).length - 1) * (line.tracking || 0) > box.width)) throw new Error("文字区太窄，请调整版式后再导出");
        const offset = zone.vAlign === "bottom" ? box.height - cursor : zone.vAlign === "center" ? (box.height - cursor) / 2 : 0;
        return lines.map((line) => ({
            text: line.text,
            x: zone.align === "center" ? box.x + box.width / 2 : box.x,
            y: box.y + Math.max(0, offset) + line.top,
            size: line.size,
            weight: line.weight,
            tone: line.tone,
            align: zone.align,
            ...(line.family ? { family: line.family, tracking: line.tracking } : {}),
        }));
    }
    return [];
}

export type StudioArtwork = { text: StudioTypesetOp[]; rules: { x1: number; y1: number; x2: number; y2: number }[] };

/** 表格、卖点网格与数字海报各自排版，所有坐标仍限制在生成时约定的留白内。 */
export function planStudioArtwork(input: { canvas: { width: number; height: number }; zone: StudioTextZone; content: StudioTypesetText; measure: StudioMeasure; layout?: string; tone?: StudioDesignToneId }): StudioArtwork {
    const { canvas, zone, content, measure, layout } = input;
    const typography = studioTypography(input.tone);
    const rows = content.lines.filter((line) => line.trim());
    const structured = rows.length > 0 && ["spec", "icons", "closing", "compare"].includes(layout || "");
    const titleType = layout === "data" ? { ...typography, headlineScale: 2, headlineWeight: 300 as const } : typography;
    const result: StudioArtwork = {
        text: planStudioTypeset({ canvas, zone: structured ? { ...zone, height: zone.height * 0.38, vAlign: "top" } : zone, content: structured ? { ...content, lines: [] } : content, measure, typography: titleType }),
        rules: [],
    };
    if (!structured) return result;
    const start = zone.y + zone.height * 0.44;
    const available = zone.height * 0.56;
    // 窄侧栏用单列；宽版的卖点卡片与对照用两列或三列，不能缩成六行小字。
    const columns = layout === "spec" || zone.width < 0.5 ? 1 : layout === "compare" ? 2 : Math.min(3, rows.length);
    const rowCount = Math.ceil(rows.length / columns);
    const gap = zone.width * 0.045;
    const cellWidth = (zone.width - gap * (columns - 1)) / columns;
    const cellHeight = available / rowCount;
    const detailType = { ...typography, family: STUDIO_SANS, headlineScale: 0.5, headlineWeight: 600 as const, tracking: 0, sublineScale: 0.7 };
    rows.forEach((line, index) => {
        const x = zone.x + (index % columns) * (cellWidth + gap);
        const y = start + Math.floor(index / columns) * cellHeight;
        const cell: StudioTextZone = { x, y: y + cellHeight * 0.12, width: cellWidth, height: cellHeight * 0.8, align: "left", vAlign: "top" };
        const [label, value] = studioCopyPair(line);
        result.rules.push({ x1: x * canvas.width, y1: y * canvas.height, x2: (x + cellWidth) * canvas.width, y2: y * canvas.height });
        if (layout === "spec" && value) {
            result.text.push(...planStudioTypeset({ canvas, zone: { ...cell, width: cell.width * 0.32 }, content: { headline: "", subline: label, lines: [] }, measure, typography: detailType }));
            result.text.push(
                ...planStudioTypeset({
                    canvas,
                    zone: { ...cell, x: cell.x + cell.width * 0.37, width: cell.width * 0.63 },
                    content: { headline: value, subline: "", lines: [] },
                    measure,
                    typography: { ...detailType, headlineScale: 0.48, headlineWeight: 500 },
                }),
            );
        } else {
            result.text.push(...planStudioTypeset({ canvas, zone: cell, content: { headline: label, subline: value, lines: [] }, measure, typography: detailType }));
        }
    });
    return result;
}

function loadImage(url: string) {
    return new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        if (!url.startsWith("data:") && !url.startsWith("blob:")) image.crossOrigin = "anonymous";
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("成品图加载失败，无法排字"));
        image.src = url;
    });
}

export async function typesetStudioImage(input: { imageUrl: string; zone: StudioTextZone; content: StudioTypesetText; ink: string; inkSoft: string; layout?: string; tone?: StudioDesignToneId }): Promise<string> {
    await Promise.all([import("@fontsource-variable/noto-sans-sc/index.css"), import("@fontsource-variable/noto-serif-sc/index.css")]);
    const typography = studioTypography(input.tone);
    const allText = [input.content.headline, input.content.subline, input.content.eyebrow || "", ...input.content.lines].join("");
    await Promise.all([document.fonts.load(`400 24px ${STUDIO_SANS}`, allText), document.fonts.load(`${typography.headlineWeight} 24px ${typography.family}`, input.content.headline)]);
    const image = await loadImage(input.imageUrl);
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("当前浏览器无法排字");
    context.drawImage(image, 0, 0);
    const measure: StudioMeasure = (text, size, weight, family) => {
        context.font = `${weight} ${size}px ${family || STUDIO_SANS}`;
        return context.measureText(text).width;
    };
    context.textBaseline = "top";
    const artwork = planStudioArtwork({ canvas, zone: input.zone, content: input.content, layout: input.layout, measure, tone: input.tone });
    context.strokeStyle = input.inkSoft;
    context.globalAlpha = 0.25;
    context.lineWidth = Math.max(1, canvas.width * 0.001);
    for (const rule of artwork.rules) {
        context.beginPath();
        context.moveTo(rule.x1, rule.y1);
        context.lineTo(rule.x2, rule.y2);
        context.stroke();
    }
    context.globalAlpha = 1;
    for (const op of artwork.text) {
        context.font = `${op.weight} ${op.size}px ${op.family || STUDIO_SANS}`;
        context.letterSpacing = `${op.tracking || 0}px`;
        context.fillStyle = op.tone === "ink" ? input.ink : input.inkSoft;
        context.textAlign = op.align;
        context.fillText(op.text, op.x, op.y);
    }
    const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((result) => (result ? resolve(result) : reject(new Error("排版成品编码失败，无法导出"))), "image/png");
    });
    canvas.width = 0;
    canvas.height = 0;
    return URL.createObjectURL(blob);
}
