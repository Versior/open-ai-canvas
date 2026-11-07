import type { StudioTextZone } from "./shot-specs";

/**
 * 程序排字：模型只出留白底图，文字在浏览器里排上去，保证每个字都准确、事后还能改。
 * 排版计算是纯函数（注入测量函数），绘制只负责执行结果，方便单测。
 */
export const STUDIO_TYPE_STACK = '"PingFang SC", "Hiragino Sans GB", "Source Han Sans SC", "Noto Sans CJK SC", "Microsoft YaHei", "Inter", sans-serif';

export type StudioTypesetText = { headline: string; subline: string; lines: string[]; eyebrow?: string };
export type StudioTypesetOp = { text: string; x: number; y: number; size: number; weight: 400 | 600 | 700; tone: "ink" | "soft"; align: "left" | "center" };
export type StudioMeasure = (text: string, size: number, weight: number) => number;

type Block = { text: string; size: number; weight: 400 | 600 | 700; tone: "ink" | "soft"; gapBefore: number };

/** 英文按单词换行，中文和超长词逐字换行。 */
export function wrapStudioText(text: string, maxWidth: number, measure: (value: string) => number) {
    const lines: string[] = [];
    let current = "";
    for (const token of text.match(/[A-Za-z0-9.%+\-/#]+|\s+|./gu) || []) {
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

function blocksFor(content: StudioTypesetText, base: number): Block[] {
    const blocks: Block[] = [];
    if (content.eyebrow?.trim()) blocks.push({ text: content.eyebrow.trim(), size: base * 0.28, weight: 600, tone: "soft", gapBefore: 0 });
    if (content.headline.trim()) blocks.push({ text: content.headline.trim(), size: base, weight: 700, tone: "ink", gapBefore: blocks.length ? base * 0.24 : 0 });
    if (content.subline.trim()) blocks.push({ text: content.subline.trim(), size: base * 0.48, weight: 400, tone: "soft", gapBefore: blocks.length ? base * 0.32 : 0 });
    content.lines
        .map((line) => line.trim())
        .filter(Boolean)
        .forEach((line, index) => {
            const [title, detail] = line.split("｜");
            const gap = blocks.length ? base * (index === 0 ? 0.7 : 0.46) : 0;
            blocks.push({ text: title.trim(), size: base * 0.5, weight: 600, tone: "ink", gapBefore: gap });
            if (detail?.trim()) blocks.push({ text: detail.trim(), size: base * 0.4, weight: 400, tone: "soft", gapBefore: base * 0.12 });
        });
    return blocks;
}

/** 在文字区内排版；放不下时等比缩小字号，最多缩到 55%。 */
export function planStudioTypeset(input: { canvas: { width: number; height: number }; zone: StudioTextZone; content: StudioTypesetText; measure: StudioMeasure }): StudioTypesetOp[] {
    const { canvas, zone, content, measure } = input;
    const box = { x: zone.x * canvas.width, y: zone.y * canvas.height, width: zone.width * canvas.width, height: zone.height * canvas.height };
    const start = Math.min(canvas.width, canvas.height) * 0.075;
    const steps = 9;
    for (let step = 0; step <= steps; step += 1) {
        const scale = 1 - step * 0.05;
        const lines: { text: string; size: number; weight: Block["weight"]; tone: Block["tone"]; top: number }[] = [];
        let cursor = 0;
        for (const block of blocksFor(content, start * scale)) {
            cursor += block.gapBefore;
            for (const line of wrapStudioText(block.text, box.width, (value) => measure(value, block.size, block.weight))) {
                lines.push({ text: line, size: block.size, weight: block.weight, tone: block.tone, top: cursor });
                cursor += block.size * 1.28;
            }
        }
        if (cursor > box.height) {
            if (step < steps) continue;
            throw new Error("文案超出排版区域，请缩短文字或拆屏后再导出");
        }
        if (lines.some((line) => measure(line.text, line.size, line.weight) > box.width)) throw new Error("文字区太窄，请调整版式后再导出");
        const offset = zone.vAlign === "bottom" ? box.height - cursor : zone.vAlign === "center" ? (box.height - cursor) / 2 : 0;
        return lines.map((line) => ({
            text: line.text,
            x: zone.align === "center" ? box.x + box.width / 2 : box.x,
            y: box.y + Math.max(0, offset) + line.top,
            size: line.size,
            weight: line.weight,
            tone: line.tone,
            align: zone.align,
        }));
    }
    return [];
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

export async function typesetStudioImage(input: { imageUrl: string; zone: StudioTextZone; content: StudioTypesetText; ink: string; inkSoft: string; layout?: string }): Promise<string> {
    if (document.fonts?.ready) await document.fonts.ready;
    const image = await loadImage(input.imageUrl);
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("当前浏览器无法排字");
    context.drawImage(image, 0, 0);
    const measure: StudioMeasure = (text, size, weight) => {
        context.font = `${weight} ${size}px ${STUDIO_TYPE_STACK}`;
        return context.measureText(text).width;
    };
    context.textBaseline = "top";
    const structured = ["spec", "data", "icons", "closing"].includes(input.layout || "");
    const content = structured ? { ...input.content, lines: [] } : input.content;
    const headingZone = structured ? { ...input.zone, height: input.zone.height * 0.42 } : input.zone;
    const ops = planStudioTypeset({ canvas, zone: headingZone, content, measure });
    if (structured && input.content.lines.length) {
        const rows = input.content.lines.filter((line) => line.trim());
        const start = input.zone.y + input.zone.height * 0.46;
        const rowHeight = (input.zone.height * 0.54) / rows.length;
        rows.forEach((line, index) => {
            const y = (start + index * rowHeight) * canvas.height;
            const x = input.zone.x * canvas.width;
            context.fillStyle = input.inkSoft;
            context.globalAlpha = 0.18;
            context.fillRect(x, y, input.zone.width * canvas.width, Math.max(1, canvas.height * 0.001));
            context.globalAlpha = 1;
            const [title, ...detail] = line.split("｜");
            const rowZone = { ...input.zone, y: start + index * rowHeight + rowHeight * 0.1, height: rowHeight * 0.8 };
            if (input.layout === "spec") {
                ops.push(...planStudioTypeset({ canvas, zone: { ...rowZone, width: rowZone.width * 0.32 }, content: { headline: "", subline: title, lines: [] }, measure }));
                ops.push(...planStudioTypeset({ canvas, zone: { ...rowZone, x: rowZone.x + rowZone.width * 0.36, width: rowZone.width * 0.64 }, content: { headline: "", subline: detail.join("｜"), lines: [] }, measure }));
            } else {
                ops.push(...planStudioTypeset({ canvas, zone: rowZone, content: { headline: "", subline: `${String(index + 1).padStart(2, "0")}  ${title}${detail.length ? ` · ${detail.join("｜")}` : ""}`, lines: [] }, measure }));
            }
        });
    }
    for (const op of ops) {
        context.font = `${op.weight} ${op.size}px ${STUDIO_TYPE_STACK}`;
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
