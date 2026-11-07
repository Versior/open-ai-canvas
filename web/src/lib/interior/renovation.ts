export type RenovationSpec = {
    scope: "room" | "wall" | "floor" | "countertop";
    stage: "refresh" | "renovation" | "new";
    widthMm: number;
    heightMm: number;
    material: "marble" | "sintered" | "quartz" | "tile" | "wood";
    finish: "honed" | "polished" | "textured";
    pattern: "straight" | "bookmatch" | "fourway" | "staggered";
    slabWidthMm: number;
    slabHeightMm: number;
    seamMm: number;
    wastePercent: number;
    materialPrice: number;
    laborPrice: number;
    budget: number;
    preserve: string;
    lighting: "daylight" | "warm" | "neutral";
    texture?: { resourceId: string };
};

export const RENOVATION_OPTIONS = {
    scope: { room: "空间整体", wall: "背景墙", floor: "地面铺装", countertop: "厨房 / 卫浴台面" },
    stage: { refresh: "软装焕新", renovation: "旧房改造", new: "毛坯装修" },
    material: { marble: "天然大理石", sintered: "岩板", quartz: "石英石", tile: "瓷砖", wood: "木材" },
    finish: { honed: "哑光 / 磨面", polished: "抛光", textured: "纹理面" },
    pattern: { straight: "顺纹直铺", bookmatch: "左右对纹", fourway: "四向对纹", staggered: "错缝铺装" },
    lighting: { daylight: "自然日光", warm: "暖光氛围", neutral: "中性工作光" },
} as const;

export const DEFAULT_RENOVATION: RenovationSpec = {
    scope: "wall",
    stage: "renovation",
    widthMm: 3600,
    heightMm: 2600,
    material: "marble",
    finish: "honed",
    pattern: "bookmatch",
    slabWidthMm: 1800,
    slabHeightMm: 2600,
    seamMm: 2,
    wastePercent: 10,
    materialPrice: 0,
    laborPrice: 0,
    budget: 0,
    preserve: "保留门窗位置、承重结构和原始透视",
    lighting: "daylight",
};

export function renovationProblem(spec: RenovationSpec) {
    for (const key of ["scope", "stage", "material", "finish", "pattern", "lighting"] as const) if (!Object.hasOwn(RENOVATION_OPTIONS[key], spec[key])) return "方案选项无效";
    for (const key of ["widthMm", "heightMm", "slabWidthMm", "slabHeightMm"] as const) if (!Number.isFinite(spec[key]) || spec[key] < 100 || spec[key] > 30000) return "尺寸须在 100–30000 mm 以内";
    if (!Number.isFinite(spec.seamMm) || spec.seamMm < 0 || spec.seamMm > 20) return "拼缝须在 0–20 mm 以内";
    if (!Number.isFinite(spec.wastePercent) || spec.wastePercent < 0 || spec.wastePercent > 50) return "预留损耗须在 0–50% 以内";
    for (const key of ["materialPrice", "laborPrice", "budget"] as const) if (!Number.isFinite(spec[key]) || spec[key] < 0 || spec[key] > 10000000) return "报价与预算须在 0–10000000 以内";
    if (spec.preserve.length > 300) return "保留要求不能超过 300 字";
    return "";
}

export function readRenovation(value: unknown): RenovationSpec | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const spec = value as RenovationSpec;
    if (typeof spec.preserve !== "string" || renovationProblem(spec)) return undefined;
    if (spec.texture !== undefined && (!spec.texture || typeof spec.texture.resourceId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(spec.texture.resourceId))) return undefined;
    return spec;
}

export type StonePiece = { id: string; x: number; y: number; width: number; height: number; flipX: boolean; flipY: boolean };

/** 尺寸均为 mm。逐行切边，错缝首块半幅；不把面积下限冒充工厂开料。 */
export function planStoneLayout(spec: RenovationSpec) {
    const problem = renovationProblem(spec);
    if (problem) throw new Error(problem);
    const { widthMm: w, heightMm: h, slabWidthMm: sw, slabHeightMm: sh, seamMm: gap } = spec;
    const rows = Math.ceil(h / (sh + gap));
    const columns = Math.ceil(w / (sw + gap));
    if (rows * (columns + 1) > 600) throw new Error("分块超过 600，请分区域设计或增大板材尺寸");
    const pieces: StonePiece[] = [];
    for (let row = 0; row < rows; row++) {
        let x = 0;
        let col = 0;
        while (x < w) {
            const width = Math.min(w - x, spec.pattern === "staggered" && row % 2 && col === 0 ? sw / 2 : sw);
            pieces.push({
                id: `R${row + 1}-C${col + 1}`,
                x,
                y: row * (sh + gap),
                width,
                height: Math.min(sh, h - row * (sh + gap)),
                flipX: (spec.pattern === "bookmatch" || spec.pattern === "fourway") && col % 2 === 1,
                flipY: spec.pattern === "fourway" && row % 2 === 1,
            });
            x += width + gap;
            col++;
        }
    }
    const netArea = pieces.reduce((sum, piece) => sum + piece.width * piece.height, 0) / 1e6;
    const purchaseArea = netArea * (1 + spec.wastePercent / 100);
    const materialCost = spec.materialPrice ? purchaseArea * spec.materialPrice : null;
    const laborCost = spec.laborPrice ? netArea * spec.laborPrice : null;
    const total = materialCost !== null && laborCost !== null ? materialCost + laborCost : null;
    const warnings = ["尺寸来自手工输入；图纸需现场复尺。采购面积含用户预留损耗，未计算切割锯缝、开孔、运输和基层处理。"];
    if (spec.pattern === "bookmatch" || spec.pattern === "fourway") warnings.push("镜像预览仅表达设计方向。天然石材需同批连号实板照片，由加工厂确认纹理、正反面与板号。");
    if ((spec.pattern === "bookmatch" && columns % 2) || (spec.pattern === "fourway" && (columns % 2 || rows % 2))) warnings.push("当前分块不是完整对纹组，边缘需裁切或调整板幅后确认中心轴。");
    if (spec.material === "marble" && (spec.scope === "countertop" || spec.scope === "floor")) warnings.push("确认石材吸水、耐污及表面防护；湿区地面需确认防滑与防水节点。");
    if (spec.scope === "countertop") warnings.push("台面开孔、悬挑、转角、挡水与边型需加工方核定，本工具未做结构计算。");
    if (spec.budget && total !== null && total > spec.budget) warnings.push(`材料与铺装估算超预算 ${Math.ceil(total - spec.budget)} 元。`);
    return { pieces, netArea, purchaseArea, materialCost, laborCost, total, warnings };
}

export function renovationRenderNote(spec: RenovationSpec) {
    return `${RENOVATION_OPTIONS.stage[spec.stage]} · ${RENOVATION_OPTIONS.scope[spec.scope]}：${spec.widthMm}×${spec.heightMm} mm。使用${RENOVATION_OPTIONS.material[spec.material]}，${RENOVATION_OPTIONS.finish[spec.finish]}，${RENOVATION_OPTIONS.pattern[spec.pattern]}，板幅 ${spec.slabWidthMm}×${spec.slabHeightMm} mm，拼缝 ${spec.seamMm} mm。${RENOVATION_OPTIONS.lighting[spec.lighting]}。保留要求：${spec.preserve}。展示真实分缝、材料比例和收口，不在效果图里虚构施工图或报价。`;
}

/** 独立 SVG 图纸，尺寸不依赖浏览器 CSS。照片可在同一个交付包中相对引用。 */
export function stoneLayoutSvg(spec: RenovationSpec, imageFile?: string) {
    const { pieces } = planStoneLayout(spec);
    const escape = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]!);
    const cells = pieces
        .map((p) => {
            const texture = imageFile
                ? `<svg x="${p.x}" y="${p.y}" width="${p.width}" height="${p.height}" viewBox="0 0 ${p.width} ${p.height}" overflow="hidden"><image href="${escape(imageFile)}" width="${spec.slabWidthMm}" height="${spec.slabHeightMm}" preserveAspectRatio="none" transform="translate(${p.flipX ? spec.slabWidthMm : 0},${p.flipY ? spec.slabHeightMm : 0}) scale(${p.flipX ? -1 : 1},${p.flipY ? -1 : 1})"/></svg>`
                : "";
            return `${texture}<rect x="${p.x}" y="${p.y}" width="${p.width}" height="${p.height}" fill="${imageFile ? "none" : "#eef0f2"}" stroke="#343b42" stroke-width="${spec.widthMm / 800}"/><text x="${p.x + p.width / 2}" y="${p.y + p.height / 2}" text-anchor="middle" fill="#20252a" font-size="${Math.min(p.width / 7, spec.widthMm / 42)}">${p.id}</text>`;
        })
        .join("");
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${spec.widthMm} ${spec.heightMm}"><title>材料排板 ${spec.widthMm}×${spec.heightMm} mm · 需现场复尺</title>${cells}</svg>`;
}
