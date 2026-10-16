/**
 * 信息图的本地合成。
 *
 * 和排版层同一个原则——只在导出时跑一次——但这里没有「编辑期间不烧像素」的余地：
 * 信息图的全部价值就是那些字和引线，必须一次画准。
 *
 * 画的东西比排版层多三类：引线、标注框、规格表网格。这三样都是模型画不好的，
 * 也正是通用生图工具不做信息图的原因。
 */
import { ecommerceInfographicBodyFontSize, ecommerceInfographicLayout, ecommerceInfographicTableRowHeight, type EcommerceInfographic } from "./ecommerce-infographic";
import type { EcommerceRasterSize } from "./ecommerce-rasterize";

/** 与界面一致的无衬线栈，导出结果与预览观感一致。 */
const FONT_STACK = '"PingFang SC", "Microsoft YaHei", "Noto Sans SC", system-ui, sans-serif';

/** 信息图的墨色。不跟随画布主题——成品图要上架，配色必须固定。 */
const INK = "#111111";
const MUTED = "#5A5A5A";
const LINE = "#C9C9C9";
const PLATE = "#FFFFFFE6";
const ACCENT = "#C8341F";

function loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const image = new Image();
        if (!url.startsWith("data:")) image.crossOrigin = "anonymous";
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("商品图加载失败，无法合成信息图"));
        image.src = url;
    });
}

function drawCover(context: CanvasRenderingContext2D, image: HTMLImageElement, size: EcommerceRasterSize) {
    const scale = Math.max(size.width / image.naturalWidth, size.height / image.naturalHeight);
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    context.drawImage(image, (size.width - width) / 2, (size.height - height) / 2, width, height);
}

/** 单行截断，超出加省略号。信息图的字必须放得下，宁可截断也不能溢出压住商品。 */
function fitLine(context: CanvasRenderingContext2D, text: string, maxWidth: number) {
    if (context.measureText(text).width <= maxWidth) return text;
    let current = "";
    for (const char of text) {
        if (context.measureText(`${current}${char}…`).width > maxWidth) break;
        current += char;
    }
    return `${current}…`;
}

function drawPlate(context: CanvasRenderingContext2D, box: { left: number; top: number; width: number; height: number }, radius: number, fill = PLATE) {
    context.fillStyle = fill;
    context.beginPath();
    context.roundRect(box.left, box.top, box.width, box.height, radius);
    context.fill();
}

/**
 * 合成信息图并返回 data URL。
 *
 * imageUrl 为空时按纯色底出图——参数表、对比表这类不带商品图的纯表格也走得通。
 */
export async function rasterizeEcommerceInfographic({ imageUrl, info, size, background = "#FFFFFF" }: { imageUrl: string; info: EcommerceInfographic; size: EcommerceRasterSize; background?: string }): Promise<string> {
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

    const longSide = Math.max(size.width, size.height);
    const body = ecommerceInfographicBodyFontSize(longSide);
    const radius = Math.max(3, longSide * 0.012);
    const layout = ecommerceInfographicLayout(info, size);

    // 标注先画线后画框：线要压在框下面，否则线头会露在字上
    context.lineCap = "round";
    for (const { leader } of layout.callouts) {
        context.strokeStyle = LINE;
        context.lineWidth = Math.max(1.5, longSide * 0.0018);
        context.beginPath();
        context.moveTo(leader.fromX, leader.fromY);
        context.lineTo(leader.toX, leader.toY);
        context.stroke();
        // 指向商品那一端点一个实心圆，明确是「这一处」
        context.fillStyle = ACCENT;
        context.beginPath();
        context.arc(leader.toX, leader.toY, Math.max(3, longSide * 0.0045), 0, Math.PI * 2);
        context.fill();
    }

    for (const { callout, box } of layout.callouts) {
        drawPlate(context, box, radius);
        const padding = body * 0.5;
        context.textBaseline = "top";
        context.fillStyle = INK;
        context.font = `700 ${body * 1.1}px ${FONT_STACK}`;
        context.fillText(fitLine(context, callout.label.trim(), box.width - padding * 2), box.left + padding, box.top + padding);
        if (callout.detail.trim()) {
            context.fillStyle = MUTED;
            context.font = `400 ${body}px ${FONT_STACK}`;
            context.fillText(fitLine(context, callout.detail.trim(), box.width - padding * 2), box.left + padding, box.top + padding + body * 1.5);
        }
    }

    // 标题带：主标题压在顶部，垫一层底色保证任何商品图上都读得清
    drawPlate(context, { left: 0, top: 0, width: size.width, height: layout.headline.top + layout.headline.height + body * 0.6 }, 0, "#FFFFFFD9");
    context.textBaseline = "top";
    if (info.headline.trim()) {
        context.fillStyle = INK;
        context.font = `700 ${body * 1.9}px ${FONT_STACK}`;
        context.fillText(fitLine(context, info.headline.trim(), layout.headline.width), layout.headline.left, layout.headline.top);
    }
    if (layout.subhead && info.subhead.trim()) {
        context.fillStyle = MUTED;
        context.font = `400 ${body * 1.05}px ${FONT_STACK}`;
        context.fillText(fitLine(context, info.subhead.trim(), layout.subhead.width), layout.subhead.left, layout.subhead.top);
    }

    if (layout.table && info.table) drawTable(context, info.table, layout.table, body, radius);

    if (layout.footer && info.footer.trim()) {
        drawPlate(context, layout.footer, radius);
        const padding = body * 0.4;
        context.fillStyle = MUTED;
        context.font = `400 ${body * 0.95}px ${FONT_STACK}`;
        context.fillText(fitLine(context, info.footer.trim(), layout.footer.width - padding * 2), layout.footer.left + padding, layout.footer.top + padding);
    }

    return canvas.toDataURL("image/png");
}

/** 画规格表：表头一行加底色，数据行等分，列宽按列数均分。 */
function drawTable(context: CanvasRenderingContext2D, table: NonNullable<EcommerceInfographic["table"]>, box: { left: number; top: number; width: number; height: number }, body: number, radius: number) {
    const rows = table.rows.filter((row) => row.some((cell) => cell.trim()));
    if (!rows.length) return;
    drawPlate(context, box, radius);
    const columns = Math.max(1, table.columns.length);
    const columnWidth = box.width / columns;
    const rowHeight = ecommerceInfographicTableRowHeight(box, rows.length);
    const padding = body * 0.35;

    context.textBaseline = "top";
    context.fillStyle = INK;
    context.font = `700 ${body}px ${FONT_STACK}`;
    table.columns.forEach((column, index) => {
        context.fillText(fitLine(context, column, columnWidth - padding * 2), box.left + index * columnWidth + padding, box.top + padding);
    });

    context.strokeStyle = LINE;
    context.lineWidth = 1;
    const headerBottom = box.top + rowHeight;
    context.beginPath();
    context.moveTo(box.left + padding, headerBottom);
    context.lineTo(box.left + box.width - padding, headerBottom);
    context.stroke();

    context.font = `400 ${body}px ${FONT_STACK}`;
    rows.forEach((row, rowIndex) => {
        const top = headerBottom + (rowIndex + 0.5) * rowHeight;
        context.fillStyle = INK;
        row.forEach((cell, index) => {
            context.fillText(fitLine(context, cell.trim(), columnWidth - padding * 2), box.left + index * columnWidth + padding, top);
        });
    });
}
