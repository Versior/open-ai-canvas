/**
 * 详情页长图切片——出图之后的最后一道手工活。
 *
 * 平台限制单图尺寸与加载性能，所以详情长图必须切成多张上传。行业里的实际做法是
 * 拿专门的切片工具切，切点在模块边界上，**不能切穿产品主体**——切穿了上架后
 * 每张图都缺一块。淘宝单张高 <1100px、抖店累计 ≤16000px、宽 750px。
 *
 * 这一层做两件事：
 * 1. **算切点**——按平台上限等分，但优先落在用户标出的安全位置（模块边界）
 * 2. **守住一条硬规矩**——切点不能落在被标记为「不可切」的区间里（产品主体、
 *    文字块），避不开就挪，挪不开就报警告让人决定
 *
 * 实际裁像素由调用方走 canvas 完成，这里只算方案——算方案是可以测的，裁像素不能。
 */

export type EcommerceSlicePlatform = "taobao" | "jd" | "pdd" | "douyin";

export type EcommerceSliceSpec = {
    id: EcommerceSlicePlatform;
    name: string;
    /** 宽（像素），长图按这个宽度出。 */
    width: number;
    /** 单张最大高度。 */
    maxSliceHeight: number;
    /** 单张最小高度，低于这个值平台会判异常。 */
    minSliceHeight: number;
    /** 全图累计高度上限；不填表示不限。 */
    maxTotalHeight?: number;
    note: string;
};

export const ECOMMERCE_SLICE_SPECS: EcommerceSliceSpec[] = [
    { id: "taobao", name: "淘宝 / 天猫", width: 750, maxSliceHeight: 1100, minSliceHeight: 200, note: "普通店 750px 宽，天猫 790px；单张高建议 800–1200，不超过 1100 最稳" },
    { id: "jd", name: "京东", width: 790, maxSliceHeight: 1200, minSliceHeight: 200, note: "PC 790px / 移动 750px" },
    { id: "pdd", name: "拼多多", width: 750, maxSliceHeight: 1500, minSliceHeight: 200, note: "宽 480–1200，单张高 ≤1500" },
    { id: "douyin", name: "抖音（抖店）", width: 750, maxSliceHeight: 2000, minSliceHeight: 200, maxTotalHeight: 16000, note: "宽 750；累计高度 ≤16000，超出自动折叠" },
];

export function ecommerceSliceSpec(platform: EcommerceSlicePlatform) {
    return ECOMMERCE_SLICE_SPECS.find((spec) => spec.id === platform);
}

/**
 * 不可切区间——产品主体、文字块所在的高度范围（相对长图顶部的像素）。
 *
 * 切点落进这些区间会让某张图缺一块主体或被腰斩的文字，上架后才发现。
 * 这是切片这件事唯一真正需要人告诉工具的信息，其余都能算。
 */
export type EcommerceSliceProtectedRange = {
    id: string;
    /** 距长图顶部的像素。 */
    top: number;
    height: number;
    /** 这一块是什么，报警告时要说清楚。 */
    label: string;
};

export function createEcommerceSliceProtectedRange(top = 0, height = 0, label = ""): EcommerceSliceProtectedRange {
    return { id: `protect-${Math.random().toString(36).slice(2, 10)}`, top, height, label };
}

/** 切点方案里的一张：从长图顶部算起的起止像素。 */
export type EcommerceSlicePiece = {
    index: number;
    top: number;
    height: number;
    /** 切点被挪动过时记下原因，界面要说明「为什么不是等分」。 */
    adjustedFrom?: number;
};

export type EcommerceSlicePlan = {
    pieces: EcommerceSlicePiece[];
    /** 挪不动的切点——它们切穿了主体或文字，需要人决定。 */
    conflicts: { top: number; label: string }[];
    /** 累计高度是否超平台上限。 */
    overTotalHeight: boolean;
};

/** 切点落在保护区间内、且留不出安全边距时，算冲突。 */
const SAFE_MARGIN = 8;

function collidesWith(range: EcommerceSliceProtectedRange, top: number) {
    return top > range.top + SAFE_MARGIN && top < range.top + range.height - SAFE_MARGIN;
}

/**
 * 算切片方案。
 *
 * 先按上限等分，再把每个切点挪到最近的安全位置：优先挪到保护区间上方的边界，
 * 挪不动就往下推。全程受最小片高约束——挪出一张过矮的图，平台会判异常。
 *
 * 挪不动的切点记进 conflicts 而不是静默接受：切穿产品主体是上架后才发现的问题，
 * 工具不该替用户吞掉。
 */
export function ecommerceSlicePlan(input: { totalHeight: number; platform: EcommerceSlicePlatform; protected?: EcommerceSliceProtectedRange[] }): EcommerceSlicePlan {
    const spec = ecommerceSliceSpec(input.platform);
    const ranges = (input.protected || []).filter((range) => range.height > 0).sort((a, b) => a.top - b.top);
    const totalHeight = Math.max(0, Math.floor(input.totalHeight));
    if (!spec || totalHeight <= spec.maxSliceHeight) {
        return { pieces: totalHeight ? [{ index: 1, top: 0, height: totalHeight }] : [], conflicts: [], overTotalHeight: false };
    }

    const count = Math.ceil(totalHeight / spec.maxSliceHeight);
    const evenHeight = totalHeight / count;
    const cuts: number[] = [];
    for (let index = 1; index < count; index += 1) cuts.push(Math.round(evenHeight * index));

    const conflicts: EcommerceSlicePlan["conflicts"] = [];
    const resolved = cuts.map((cut, index) => {
        const hit = ranges.find((range) => collidesWith(range, cut));
        if (!hit) return cut;
        // 往上挪到保护区间之前——那里通常正好是模块边界
        const up = hit.top;
        // 上下的片高都要够
        const previous = index === 0 ? 0 : cuts[index - 1];
        const next = index === cuts.length - 1 ? totalHeight : cuts[index + 1];
        if (up - previous >= spec.minSliceHeight && next - up >= spec.minSliceHeight) return up;
        // 挪不动就往下推一整个保护区间
        const down = hit.top + hit.height;
        if (down - previous >= spec.minSliceHeight && next - down >= spec.minSliceHeight) return down;
        conflicts.push({ top: cut, label: hit.label || "未命名区块" });
        return cut;
    });

    const boundaries = [0, ...resolved, totalHeight];
    const pieces: EcommerceSlicePiece[] = [];
    for (let index = 0; index < boundaries.length - 1; index += 1) {
        const top = boundaries[index];
        const height = boundaries[index + 1] - top;
        if (height <= 0) continue;
        pieces.push({ index: index + 1, top, height, ...(cuts[index] !== undefined && cuts[index] !== boundaries[index + 1] ? { adjustedFrom: cuts[index] } : {}) });
    }

    return {
        pieces,
        conflicts,
        overTotalHeight: Boolean(spec.maxTotalHeight && totalHeight > spec.maxTotalHeight),
    };
}

export type EcommerceSliceIssue = { level: "block" | "warn"; message: string };

/**
 * 切片方案的问题。
 *
 * 能确定的全报：冲突切点、超累计高度、片高过矮、切点太碎。
 */
export function ecommerceSliceIssues(plan: EcommerceSlicePlan, platform: EcommerceSlicePlatform): EcommerceSliceIssue[] {
    const spec = ecommerceSliceSpec(platform);
    if (!spec) return [];
    const issues: EcommerceSliceIssue[] = [];

    if (plan.conflicts.length) {
        issues.push({ level: "block", message: `有 ${plan.conflicts.length} 个切点落在「${plan.conflicts.map((conflict) => conflict.label).join("、")}」上，挪不开——切穿了上架后每张图都缺一块，需要你决定怎么切` });
    }
    if (plan.overTotalHeight && spec.maxTotalHeight) {
        issues.push({ level: "block", message: `长图累计 ${Math.round(plan.pieces.reduce((total, piece) => total + piece.height, 0))}px 超过平台上限 ${spec.maxTotalHeight}px，会被自动折叠` });
    }
    const tooShort = plan.pieces.filter((piece) => piece.height < spec.minSliceHeight);
    if (tooShort.length) {
        issues.push({ level: "warn", message: `有 ${tooShort.length} 张低于最小高度 ${spec.minSliceHeight}px，平台可能判异常` });
    }
    const tooTall = plan.pieces.filter((piece) => piece.height > spec.maxSliceHeight);
    if (tooTall.length) {
        issues.push({ level: "warn", message: `有 ${tooTall.length} 张超过单张上限 ${spec.maxSliceHeight}px` });
    }
    return issues;
}

export function ecommerceSliceBlocked(issues: EcommerceSliceIssue[]) {
    return issues.some((issue) => issue.level === "block");
}

/** 切片的交付命名：`编码_详情_序号_v版本`。 */
export function ecommerceSliceFileName(input: { code: string; index: number; total: number; version?: number; extension?: string }) {
    const code = input.code.trim() || "ITEM";
    const index = String(input.index).padStart(2, "0");
    const total = String(input.total).padStart(2, "0");
    return `${code}_详情_${index}of${total}_v${input.version ?? 1}.${input.extension || "jpg"}`;
}
