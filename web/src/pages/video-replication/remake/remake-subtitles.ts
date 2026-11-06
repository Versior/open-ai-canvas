import { remakeSubtitleLayout } from "@/lib/remake/timeline";

// 烧录字幕在浏览器里画：服务器镜像没有中文字体，浏览器一定能显示用户看到的文字。
// 每句台词画成一张和成片同尺寸的透明 PNG，后端渲染时按时间叠到画面上。

const FONT_FAMILY = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "Noto Sans", "Helvetica Neue", Arial, sans-serif';

function font(size: number) {
    return `600 ${size}px ${FONT_FAMILY}`;
}

/** 白字黑描边、底部居中的一句字幕；返回 PNG。 */
export async function drawRemakeSubtitle(text: string, size: { width: number; height: number }): Promise<Blob> {
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("浏览器不能画字幕图");
    const layout = remakeSubtitleLayout(text, size, (value, fontSize) => {
        context.font = font(fontSize);
        return context.measureText(value).width;
    });
    context.font = font(layout.fontSize);
    context.textAlign = "center";
    context.textBaseline = "alphabetic";
    context.lineJoin = "round";
    context.lineWidth = layout.strokeWidth * 2;
    context.strokeStyle = "rgba(0, 0, 0, 0.85)";
    context.fillStyle = "#ffffff";
    layout.lines.forEach((line, index) => {
        const y = layout.bottomY - (layout.lines.length - 1 - index) * layout.lineHeight;
        context.strokeText(line, layout.centerX, y);
        context.fillText(line, layout.centerX, y);
    });
    return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("字幕图生成失败"))), "image/png"));
}
