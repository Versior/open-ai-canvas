// Adapted from EcomGen f8e6e7b, MIT; see ecommerce-platform-LICENSE.txt.
export const ECOMMERCE_PRINT_SPEC_VERSION = "2026.09";
export const ECOMMERCE_MOCKUP_SCENE_VERSION = "2026.10.1";
export type EcommercePodCategory = "TSHIRT" | "HOODIE" | "MUG_11OZ" | "POSTER" | "TOTE_BAG" | "PHONE_CASE";
export const ECOMMERCE_PRINT_SPECS = [
    { id: "tshirt-front-12x16", category: "TSHIRT", label: "T恤前片 · 12×16 英寸", width: 3600, height: 4800, safeMarginPct: 6 },
    { id: "hoodie-front-12x16", category: "HOODIE", label: "卫衣前片 · 12×16 英寸", width: 3600, height: 4800, safeMarginPct: 6 },
    { id: "mug-11oz-wrap", category: "MUG_11OZ", label: "11oz 马克杯环面 · 8.5×3.7 英寸", width: 2550, height: 1110, safeMarginPct: 2 },
    { id: "poster-18x24", category: "POSTER", label: "海报 · 18×24 英寸", width: 5400, height: 7200, safeMarginPct: 6 },
    { id: "tote-15x15", category: "TOTE_BAG", label: "帆布袋 · 15×15 英寸", width: 4500, height: 4500, safeMarginPct: 6 },
    { id: "phonecase-generic", category: "PHONE_CASE", label: "手机壳 · 通用近似初稿", width: 900, height: 1650, safeMarginPct: 4 },
] as const;
export function ecommercePrintSpec(id?: string) {
    if (!id) return undefined;
    const spec = ECOMMERCE_PRINT_SPECS.find((item) => item.id === id);
    if (!spec) throw new Error("印刷品类规格不存在，请重新选择");
    return spec;
}
