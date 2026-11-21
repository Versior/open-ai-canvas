import type { EcommercePlatformId } from "@/lib/ecommerce/ecommerce-platform-specs";
import { ecommerceDetailSlices, ecommerceLongImageGeometry } from "@/lib/ecommerce/ecommerce-rasterize";
import { ecommerceSliceSpec, type EcommerceSlicePlatform } from "@/lib/ecommerce/ecommerce-slice";

const PLATFORMS: Partial<Record<EcommercePlatformId, EcommerceSlicePlatform>> = { taobao: "taobao", jd: "jd", pdd: "pdd", douyin: "douyin" };

export function studioSlicePlatform(platform: EcommercePlatformId) {
    return PLATFORMS[platform] || "generic";
}

export function previewStudioDetailGeometry(platform: EcommercePlatformId, screens: readonly { title?: string; ratio: string }[]) {
    const slicePlatform = studioSlicePlatform(platform);
    const { width } = ecommerceSliceSpec(slicePlatform)!;
    const sizes = screens.map((screen) => {
        const [columns, rows] = screen.ratio.split(":").map(Number);
        return { width: columns, height: rows };
    });
    const missing = sizes.findIndex((size) => !(Number.isFinite(size.width) && size.width > 0 && Number.isFinite(size.height) && size.height > 0));
    if (!sizes.length || missing !== -1) return { width, height: null, longImageAvailable: false, sliceAvailable: false, issues: [missing >= 0 ? `第 ${missing + 1} 屏画幅未确定，暂不能预检切片。` : "先选择要交付的屏。"] };
    const geometry = ecommerceLongImageGeometry(sizes, width);
    if (!geometry.canvasSafe) return { width, height: geometry.height, longImageAvailable: false, sliceAvailable: false, issues: ["预计长图超过浏览器安全合成尺寸；请减少屏数、改用较矮画幅，或只导出分屏文件。"] };
    const { issues } = ecommerceDetailSlices(slicePlatform, geometry);
    return { width, height: geometry.height, longImageAvailable: true, sliceAvailable: !issues.length, issues };
}
