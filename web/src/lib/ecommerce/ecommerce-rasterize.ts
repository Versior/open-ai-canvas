/**
 * 把排版层合成成一张成品图。
 *
 * 只在**导出时**跑一次。编辑期间文字一直是 DOM 叠加，改一个字不重新生成、
 * 不重新合成——这是"文字不烧进像素"的全部意义。
 */
import { ecommerceLayoutVisibleBlocks, ecommerceRatioValue, type EcommerceLayout, type EcommerceLayoutBlock } from "./ecommerce-layout";
import type { EcommerceCopy } from "./ecommerce-contract";
import { ecommerceSliceFileName, ecommerceSlicePlan, type EcommerceSlicePlan, type EcommerceSlicePlatform } from "./ecommerce-slice";

/** 与界面一致的无衬线栈，导出结果与预览观感一致。 */
const FONT_STACK = '"PingFang SC", "Microsoft YaHei", "Noto Sans SC", system-ui, sans-serif';

export type EcommerceRasterSize = { width: number; height: number };

/** 按画幅算出导出尺寸。长边固定，短边按比例，避免不同画幅分辨率差太多。 */
export function ecommerceExportSize(ratio: string, longSide = 1600): EcommerceRasterSize {
    const value = ecommerceRatioValue(ratio);
    return value >= 1
        ? { width: Math.round(longSide), height: Math.round(longSide / value) }
        : { width: Math.round(longSide * value), height: Math.round(longSide) };
}

function loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const image = new Image();
        // data URL 与同源资源不需要跨域；带 crossOrigin 反而会让部分 data URL 加载失败
        if (!url.startsWith("data:")) image.crossOrigin = "anonymous";
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("成品图加载失败，无法合成"));
        image.src = url;
    });
}

/** 按 cover 规则把图铺满画布，保持比例、裁掉溢出。 */
function drawCover(context: CanvasRenderingContext2D, image: HTMLImageElement, size: EcommerceRasterSize) {
    const scale = Math.max(size.width / image.naturalWidth, size.height / image.naturalHeight);
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    context.drawImage(image, (size.width - width) / 2, (size.height - height) / 2, width, height);
}

/** 按换行符和宽度把文字切成行。中英文混排按字符宽度逐字累加。 */
function wrapText(context: CanvasRenderingContext2D, text: string, maxWidth: number) {
    return text.split("\n").flatMap((paragraph) => {
        if (!paragraph) return [""];
        const lines: string[] = [];
        let current = "";
        for (const char of paragraph) {
            const next = current + char;
            if (current && context.measureText(next).width > maxWidth) {
                lines.push(current);
                current = char;
            } else {
                current = next;
            }
        }
        if (current) lines.push(current);
        return lines;
    });
}

type PlacedBlock = { block: EcommerceLayoutBlock; text: string; lines: string[]; fontSize: number; inset: number; lineHeight: number; padding: { x: number; y: number } };

function placeBlock(context: CanvasRenderingContext2D, block: EcommerceLayoutBlock, text: string, size: EcommerceRasterSize): PlacedBlock {
    const shortSide = Math.min(size.width, size.height);
    const fontSize = (block.size / 100) * shortSide;
    const inset = (block.inset / 100) * shortSide;
    const lineHeight = fontSize * 1.25;
    const padding = block.plate ? { x: inset * 0.34, y: inset * 0.22 } : { x: 0, y: 0 };
    context.font = `${block.bold ? 700 : 400} ${fontSize}px ${FONT_STACK}`;
    const maxWidth = size.width - inset * 2 - padding.x * 2;
    return { block, text, lines: wrapText(context, text, maxWidth), fontSize, inset, lineHeight, padding };
}

/** 画一个文字块：先垫底色，再逐行写字。 */
function drawBlock(context: CanvasRenderingContext2D, placed: PlacedBlock, size: EcommerceRasterSize) {
    const { block, lines, fontSize, lineHeight, inset, padding } = placed;
    const shortSide = Math.min(size.width, size.height);
    context.font = `${block.bold ? 700 : 400} ${fontSize}px ${FONT_STACK}`;
    const lineWidths = lines.map((line) => context.measureText(line).width);
    const textWidth = Math.max(0, ...lineWidths);
    const boxWidth = Math.min(size.width - inset * 2, textWidth + padding.x * 2);
    const boxHeight = lines.length * lineHeight + padding.y * 2;
    const [vertical, horizontal] = block.anchor.split("-");

    let x: number;
    if (horizontal === "left") x = inset;
    else if (horizontal === "right") x = size.width - inset - boxWidth;
    else x = (size.width - boxWidth) / 2;

    let y: number;
    if (vertical === "top") y = inset;
    else if (vertical === "bottom") y = size.height - inset - boxHeight;
    else y = (size.height - boxHeight) / 2;

    if (block.plate) {
        context.fillStyle = block.plate;
        const radius = Math.max(2, shortSide * 0.012);
        context.beginPath();
        context.roundRect(x, y, boxWidth, boxHeight, radius);
        context.fill();
    }

    context.fillStyle = block.color;
    context.textBaseline = "top";
    lines.forEach((line, index) => {
        const lineWidth = lineWidths[index];
        const textX = block.align === "left" ? x + padding.x
            : block.align === "right" ? x + boxWidth - padding.x - lineWidth
            : x + (boxWidth - lineWidth) / 2;
        context.fillText(line, textX, y + padding.y + index * lineHeight);
    });
}

export type RasterizeEcommerceLayoutInput = {
    /** 成品图。data URL 或同源地址。 */
    imageUrl: string;
    layout: EcommerceLayout;
    copy: EcommerceCopy;
    size: EcommerceRasterSize;
    background?: string;
};

/**
 * 合成并返回 data URL。
 *
 * 没有上游图时按纯色背景出图——文案本身就是完整交付物的情况（比如纯文字促销图）也走得通。
 */
export async function rasterizeEcommerceLayout({ imageUrl, layout, copy, size, background = "#FFFFFF" }: RasterizeEcommerceLayoutInput): Promise<string> {
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("当前浏览器无法合成图片");

    if (imageUrl) drawCover(context, await loadImage(imageUrl), size);
    else {
        context.fillStyle = background;
        context.fillRect(0, 0, size.width, size.height);
    }

    const blocks = ecommerceLayoutVisibleBlocks(layout, copy);
    for (const block of blocks) {
        drawBlock(context, placeBlock(context, block, copy[block.field].trim(), size), size);
    }

    return canvas.toDataURL("image/png");
}

/**
 * 把一屏一屏的详情页拼成一张长图。
 *
 * 这是纯装配，不是生成——九屏图已经出好了，长图只是把它们按顺序接起来。
 * 交给模型做才是错的：模型会顺手重画每一屏，商品就不一致了。
 *
 * 统一宽度：各屏原始尺寸可能不同，按目标宽度等比缩放后居中，两边补背景色。
 * 缩放而不是裁切——裁切会切掉商品，那比留白边严重得多。
 *
 * 每屏之间的接缝就是**切点**：切点落在屏边界上天然安全（不会切穿商品），
 * 所以拼接时在每屏之间留一条与背景同色的窄缝，让后续的切片算法有明确的落点。
 */
export type EcommerceLongImageInput = {
    imageUrls: string[];
    /** 目标宽度。缺省用第一张的宽度。 */
    width?: number;
    /** 屏与屏之间的窄缝高度，与背景同色。 */
    gap?: number;
    /** 背景色。 */
    background?: string;
    /** 每屏之间的接缝位置（用于切片规划的保护区间）。 */
};

export type EcommerceLongImageResult = {
    dataUrl: string;
    width: number;
    height: number;
    /** 每屏在长图里的纵向区间，作为切片的保护区间与切点候选。 */
    screens: { top: number; height: number }[];
};

export async function rasterizeEcommerceLongImage(input: EcommerceLongImageInput): Promise<EcommerceLongImageResult> {
    const urls = input.imageUrls.filter(Boolean);
    if (!urls.length) throw new Error("没有可拼接的图");
    const gap = Math.max(0, input.gap ?? 8);
    const background = input.background || "#FFFFFF";
    const images = await Promise.all(urls.map(loadImage));
    const width = Math.max(1, Math.round(input.width || images[0].naturalWidth || 800));
    const screens: { top: number; height: number }[] = [];
    let cursor = 0;
    for (const image of images) {
        const scale = width / (image.naturalWidth || width);
        const height = Math.max(1, Math.round((image.naturalHeight || width) * scale));
        screens.push({ top: cursor, height });
        cursor += height + gap;
    }
    const totalHeight = Math.max(1, cursor - gap);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = totalHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法创建合成画布");
    context.fillStyle = background;
    context.fillRect(0, 0, width, totalHeight);
    images.forEach((image, index) => {
        const screen = screens[index];
        context.drawImage(image, 0, screen.top, width, screen.height);
    });
    return { dataUrl: canvas.toDataURL("image/png"), width, height: totalHeight, screens };
}

/**
 * 一键详情页：一屏一屏的图 → 一张长图 → 按平台上限切好的片。
 *
 * 交付时平台限制的是**单图尺寸**，详情长图必须切成多张上传。这段流程原本
 * 全靠人肉（拼图软件 + 手动量切点 + 导出时还要避开切穿商品）。
 *
 * 切点优先落在**屏与屏之间**：那里天然是模块边界，切穿了也不会伤到商品。
 * 所以拼接时先记下每屏的区间，把它们作为保护区间交给切片算法——算法会先把
 * 等分的切点往上挪到最近的屏边界，挪不动才记 conflict，不静默接受。
 *
 * 长图与切片都返回：长图给用户看一眼整体，切片拿去上传。
 */
export type EcommerceDetailPagePiece = {
    index: number;
    top: number;
    height: number;
    dataUrl: string;
};

export type EcommerceDetailPageResult = {
    /** 整张长图，供预览与留档。 */
    longImage: EcommerceLongImageResult;
    plan: EcommerceSlicePlan;
    pieces: EcommerceDetailPagePiece[];
    fileNames: string[];
};

async function cropPiece(image: HTMLImageElement, top: number, height: number, width: number): Promise<string> {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = Math.max(1, Math.round(height));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法创建切图画布");
    context.drawImage(image, 0, top, width, height, 0, 0, width, height);
    return canvas.toDataURL("image/png");
}

export async function rasterizeEcommerceDetailPage(input: {
    imageUrls: string[];
    platform: EcommerceSlicePlatform;
    width?: number;
    gap?: number;
    background?: string;
    /** 交付命名用的商品编码；缺省用「详情页」。 */
    code?: string;
    version?: number;
}): Promise<EcommerceDetailPageResult> {
    const longImage = await rasterizeEcommerceLongImage({
        imageUrls: input.imageUrls,
        width: input.width,
        gap: input.gap,
        background: input.background,
    });
    // 屏与屏之间的接缝即切点候选；保护区间用每屏自身的区间，
    // 这样切点只会落在屏边界，不会切穿某一屏里的商品。
    const plan = ecommerceSlicePlan({
        totalHeight: longImage.height,
        platform: input.platform,
        protected: longImage.screens.map((screen, index) => ({ id: `screen-${index + 1}`, top: screen.top, height: screen.height, label: `第 ${index + 1} 屏` })),
    });
    const stitched = await loadImage(longImage.dataUrl);
    const pieces: EcommerceDetailPagePiece[] = [];
    const fileNames: string[] = [];
    for (const piece of plan.pieces) {
        pieces.push({ index: piece.index, top: piece.top, height: piece.height, dataUrl: await cropPiece(stitched, piece.top, piece.height, longImage.width) });
        fileNames.push(ecommerceSliceFileName({
            code: input.code?.trim() || "详情页",
            index: piece.index,
            total: plan.pieces.length,
            version: input.version,
        }));
    }
    return { longImage, plan, pieces, fileNames };
}
