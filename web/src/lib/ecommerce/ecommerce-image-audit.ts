/**
 * 图片规范的自检——前端能算的那部分。
 *
 * 白底是不是纯白、边缘有没有杂色，这些不需要模型，采样边缘像素就能算出来。
 * 主体占比和文字占比需要理解画面，交给模型判定（`EcommerceImageAudit.subjectRatio`
 * / `textRatio`），这里**不猜**——测不了就留空，让报告如实显示"未检测"。
 */
import type { EcommerceImageAudit } from "./ecommerce-platform-specs";

/** 判定为纯白的容差。JPEG 压缩会让 255 掉到 250 上下，卡太死会误报。 */
const WHITE_TOLERANCE = 8;

function loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const image = new Image();
        if (!url.startsWith("data:")) image.crossOrigin = "anonymous";
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("图片加载失败，无法自检"));
        image.src = url;
    });
}

function isWhite(data: Uint8ClampedArray, index: number) {
    return data[index] >= 255 - WHITE_TOLERANCE && data[index + 1] >= 255 - WHITE_TOLERANCE && data[index + 2] >= 255 - WHITE_TOLERANCE;
}

function toHex(r: number, g: number, b: number) {
    return `#${[r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

/**
 * 采样边缘像素判断背景是否纯白。
 *
 * 采样四条边各一圈（各取 1% 厚度，至少 2px），不采样四角单点——单点容易被
 * 阴影或圆角误伤。返回边缘纯白占比与四角平均色，供报告直接展示。
 */
export async function auditImageBackground(dataUrl: string): Promise<EcommerceImageAudit> {
    const image = await loadImage(dataUrl);
    const canvas = document.createElement("canvas");
    // 缩到固定尺寸再采样：原图可能很大，逐像素扫太慢，边缘特征缩放后依然成立
    const sample = 256;
    canvas.width = sample;
    canvas.height = sample;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return {};
    context.drawImage(image, 0, 0, sample, sample);
    const { data } = context.getImageData(0, 0, sample, sample);

    const thickness = Math.max(2, Math.round(sample * 0.01));
    let white = 0;
    let total = 0;
    for (let y = 0; y < sample; y += 1) {
        for (let x = 0; x < sample; x += 1) {
            const onEdge = x < thickness || y < thickness || x >= sample - thickness || y >= sample - thickness;
            if (!onEdge) continue;
            total += 1;
            if (isWhite(data, (y * sample + x) * 4)) white += 1;
        }
    }

    const corners: [number, number][] = [[0, 0], [sample - 1, 0], [0, sample - 1], [sample - 1, sample - 1]];
    const cornerColors = corners.map(([x, y]) => {
        const index = (y * sample + x) * 4;
        return [data[index], data[index + 1], data[index + 2]] as [number, number, number];
    });
    const average = cornerColors.reduce((acc, color) => [acc[0] + color[0] / 4, acc[1] + color[1] / 4, acc[2] + color[2] / 4], [0, 0, 0]);

    return {
        whiteEdgeRatio: total ? white / total : undefined,
        cornerColor: toHex(Math.round(average[0]), Math.round(average[1]), Math.round(average[2])),
    };
}

/** 从画布节点的图片内容或资源键取一张可用于自检的 data URL。 */
export async function auditNodeImage(dataUrl: string): Promise<EcommerceImageAudit> {
    try {
        return await auditImageBackground(dataUrl);
    } catch (error) {
        console.warn("图片自检失败", error);
        return {};
    }
}
