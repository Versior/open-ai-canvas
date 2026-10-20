import { readPatternPixels, patternCanvas, canvasPng } from "./ecommerce-pattern-tools";
import { createZip } from "@/lib/zip";
import { downloadName } from "@/lib/media-package";
import type { CanvasNodeData } from "@/types/canvas";
import type { PatternPixels } from "@/lib/ecommerce/ecommerce-pattern-pixels";

class Bytes {
    parts: Uint8Array[] = [];
    add(value: Uint8Array) {
        this.parts.push(value);
    }
    number(value: number, bytes: 1 | 2 | 4) {
        const data = new Uint8Array(bytes),
            view = new DataView(data.buffer);
        if (bytes === 1) view.setUint8(0, value);
        else if (bytes === 2) view.setUint16(0, value);
        else view.setUint32(0, value);
        this.add(data);
    }
    text(value: string) {
        this.add(new TextEncoder().encode(value));
    }
    result() {
        const result = new Uint8Array(this.parts.reduce((sum, p) => sum + p.length, 0));
        let offset = 0;
        for (const part of this.parts) {
            result.set(part, offset);
            offset += part.length;
        }
        return result;
    }
}
/** PSD v1, planar 8-bit RGBA, normal blend; every input is a real image layer. */
export function encodeLayeredPsd(layers: { name: string; pixels: PatternPixels; visible: boolean }[]) {
    if (!layers.length || layers.length > 50) throw new Error("请选择 1–50 个图层");
    const { width, height } = layers[0].pixels;
    if (layers.some((layer) => layer.pixels.width !== width || layer.pixels.height !== height) || width * height * layers.length > 32_000_000) throw new Error("PSD 图层尺寸须相同，总像素不能超过 3200 万");
    const records = new Bytes(),
        channels = new Bytes();
    records.number(layers.length, 2);
    for (const layer of layers) {
        records.number(0, 4);
        records.number(0, 4);
        records.number(height, 4);
        records.number(width, 4);
        records.number(4, 2);
        for (const channel of [0, 1, 2, -1]) {
            records.number(channel & 65535, 2);
            records.number(width * height + 2, 4);
            channels.number(0, 2);
            const bytes = new Uint8Array(width * height);
            for (let p = 0; p < bytes.length; p++) bytes[p] = layer.pixels.data[p * 4 + (channel === -1 ? 3 : channel)];
            channels.add(bytes);
        }
        records.text("8BIMnorm");
        records.number(255, 1);
        records.number(0, 1);
        records.number(layer.visible ? 0 : 2, 1);
        records.number(0, 1);
        const extra = new Bytes();
        extra.number(0, 4);
        extra.number(0, 4);
        const name = new TextEncoder().encode(layer.name.replace(/[^ -~]/g, "_")).slice(0, 255);
        extra.number(name.length, 1);
        extra.add(name);
        extra.add(new Uint8Array((4 - ((name.length + 1) % 4)) % 4));
        const unicode = new Bytes();
        unicode.number(layer.name.length, 4);
        for (let n = 0; n < layer.name.length; n++) unicode.number(layer.name.charCodeAt(n), 2);
        const unicodeBytes = unicode.result();
        extra.text("8BIMluni");
        extra.number(unicodeBytes.length, 4);
        extra.add(unicodeBytes);
        if (unicodeBytes.length % 2) extra.number(0, 1);
        const bytes = extra.result();
        records.number(bytes.length, 4);
        records.add(bytes);
    }
    records.add(channels.result());
    let info = records.result();
    if (info.length % 2) {
        const padded = new Uint8Array(info.length + 1);
        padded.set(info);
        info = padded;
    }
    const section = new Bytes();
    section.number(info.length, 4);
    section.add(info);
    section.number(0, 4);
    const out = new Bytes();
    out.text("8BPS");
    out.number(1, 2);
    out.add(new Uint8Array(6));
    out.number(4, 2);
    out.number(height, 4);
    out.number(width, 4);
    out.number(8, 2);
    out.number(3, 2);
    out.number(0, 4);
    out.number(0, 4);
    const layerSection = section.result();
    out.number(layerSection.length, 4);
    out.add(layerSection);
    out.number(0, 2);
    const merged = new Uint8ClampedArray(width * height * 4);
    for (const layer of [...layers].reverse().filter((layer) => layer.visible))
        for (let p = 0; p < merged.length; p += 4) {
            const a = layer.pixels.data[p + 3] / 255,
                old = merged[p + 3] / 255,
                alpha = a + old * (1 - a);
            for (let c = 0; c < 3; c++) merged[p + c] = alpha ? (layer.pixels.data[p + c] * a + merged[p + c] * old * (1 - a)) / alpha : 0;
            merged[p + 3] = alpha * 255;
        }
    for (let c = 0; c < 4; c++) {
        const bytes = new Uint8Array(width * height);
        for (let p = 0; p < bytes.length; p++) bytes[p] = merged[p * 4 + c];
        out.add(bytes);
    }
    return out.result();
}
export async function buildEcommerceLayerArchive(layers: { node: CanvasNodeData; visible: boolean }[], check?: () => void) {
    const loaded = [];
    for (const layer of layers) {
        check?.();
        loaded.push({ ...layer, pixels: await readPatternPixels(layer.node), name: layer.node.title || "图层" });
        check?.();
    }
    const psd = encodeLayeredPsd(loaded);
    const files: { name: string; data: BlobPart }[] = [{ name: "layers.psd", data: psd }];
    for (const [index, layer] of loaded.entries()) files.push({ name: "layers/" + String(index + 1).padStart(2, "0") + "_" + downloadName(layer.name) + ".png", data: await canvasPng(patternCanvas(layer.pixels)) });
    files.push({
        name: "manifest.json",
        data: JSON.stringify({ format: "yingce.layers", version: 1, layers: loaded.map((layer, index) => ({ index, name: layer.name, nodeId: layer.node.id, visible: layer.visible })), note: "按当前顺序导出，最上方为顶层；图层内容保持原像素" }, null, 2),
    });
    check?.();
    const archive = await createZip(files);
    check?.();
    return archive;
}
