export type PatternPixels = { width: number; height: number; data: Uint8ClampedArray };
export function validatePatternPixels(image: PatternPixels) {
    if (!Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width < 3 || image.height < 3 || image.width * image.height > 32_000_000 || image.data.length !== image.width * image.height * 4)
        throw new Error("图片尺寸无效或超过 3200 万像素");
}
/** Compare premultiplied pixels: invisible RGB must not create a false seam. */
export function inspectPatternSeams(image: PatternPixels) {
    validatePatternPixels(image);
    const difference = (a: number, b: number) => {
        const aa = image.data[a + 3] / 255,
            ba = image.data[b + 3] / 255;
        return (Math.abs(image.data[a] * aa - image.data[b] * ba) + Math.abs(image.data[a + 1] * aa - image.data[b + 1] * ba) + Math.abs(image.data[a + 2] * aa - image.data[b + 2] * ba) + Math.abs(image.data[a + 3] - image.data[b + 3])) / 4;
    };
    const axis = (horizontal: boolean) => {
        const lines = horizontal ? image.height : image.width,
            length = horizontal ? image.width : image.height;
        const at = (line: number, n: number) => (horizontal ? line * image.width + n : n * image.width + line) * 4;
        let edge = 0,
            inside = 0;
        for (let line = 0; line < lines; line++) {
            edge += difference(at(line, 0), at(line, length - 1));
            for (let n = 0; n < length - 1; n++) inside += difference(at(line, n), at(line, n + 1));
        }
        const wrap = edge / lines,
            baseline = inside / (lines * (length - 1));
        return { edgeDifference: wrap, interiorDifference: baseline, score: Math.max(0, 1 - Math.max(0, wrap - baseline) / 255) };
    };
    const horizontal = axis(true),
        vertical = axis(false);
    return { horizontal, vertical, score: Math.min(horizontal.score, vertical.score), passed: Math.min(horizontal.score, vertical.score) >= 0.95, method: "premultiplied-edge-vs-mean-v1", note: "像素判定仅供验缝，仍需检查平铺预览；不会修复或改变图稿" };
}
function rgb(hex: string) {
    if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error("颜色须为六位 HEX");
    return [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
}
export function recolorPattern(image: PatternPixels, from: string, to: string, tolerance: number) {
    validatePatternPixels(image);
    if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 255) throw new Error("容差须为 0–255");
    const a = rgb(from),
        b = rgb(to),
        data = new Uint8ClampedArray(image.data);
    let changed = 0;
    for (let p = 0; p < data.length; p += 4) {
        if (!data[p + 3]) continue;
        if (Math.max(...a.map((value, c) => Math.abs(value - data[p + c]))) > tolerance) continue;
        for (let c = 0; c < 3; c++) data[p + c] = Math.max(0, Math.min(255, data[p + c] + b[c] - a[c]));
        changed++;
    }
    return { ...image, data, changed };
}
export function printPixelSize(widthCm: number, heightCm: number, dpi = 300) {
    if (![widthCm, heightCm, dpi].every((n) => Number.isFinite(n) && n > 0) || dpi !== 300) throw new Error("请填写有效物理尺寸，输出固定 300DPI");
    const width = Math.round((widthCm / 2.54) * dpi),
        height = Math.round((heightCm / 2.54) * dpi);
    if (width < 1 || height < 1 || width > 16384 || height > 16384 || width * height > 32_000_000) throw new Error("规格超过本地处理上限，请缩小尺寸或分块生产");
    return { width, height, dpi };
}
function crc32(data: Uint8Array) {
    let crc = 0xffffffff;
    for (const byte of data) {
        crc ^= byte;
        for (let n = 0; n < 8; n++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
}
/** Write actual PNG physical resolution; changing filenames is not DPI metadata. */
export function withPrintDpi(png: Uint8Array, dpi = 300) {
    if (png.length < 33 || png[0] !== 137 || String.fromCharCode(...png.slice(1, 4)) !== "PNG") throw new Error("印刷文件必须是 PNG");
    const chunk = new Uint8Array(21),
        view = new DataView(chunk.buffer);
    view.setUint32(0, 9);
    chunk.set([112, 72, 89, 115], 4);
    view.setUint32(8, Math.round(dpi / 0.0254));
    view.setUint32(12, Math.round(dpi / 0.0254));
    chunk[16] = 1;
    view.setUint32(17, crc32(chunk.slice(4, 17)));
    const parts: Uint8Array[] = [png.slice(0, 33), chunk];
    for (let offset = 33; offset < png.length;) {
        if (offset + 12 > png.length) throw new Error("PNG 数据损坏");
        const size = new DataView(png.buffer, png.byteOffset + offset, 4).getUint32(0) + 12;
        if (offset + size > png.length) throw new Error("PNG 数据损坏");
        if (String.fromCharCode(...png.slice(offset + 4, offset + 8)) !== "pHYs") parts.push(png.slice(offset, offset + size));
        offset += size;
    }
    const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let position = 0;
    for (const part of parts) {
        output.set(part, position);
        position += part.length;
    }
    return output;
}
