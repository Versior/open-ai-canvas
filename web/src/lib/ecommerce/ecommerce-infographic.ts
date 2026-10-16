/**
 * 信息图——电商图上唯一**必须**用真实文字的那一类。
 *
 * 为什么它和别的图不是一回事：
 *
 * 主图、场景图、种草图都可以让模型画，文字交给排版层留位就行。信息图不行——
 * 它的全部价值就在那些字上：参数、尺寸、材质、卖点。数字写错一位就是虚假宣传，
 * 字糊成一团就是废图。
 *
 * 默认走提示词：标题、每条标注（带左/右方位）、规格表原文**逐字进提示词**，
 * 压一条硬规矩——不得改写、四舍五入、补充或增删行列。位置用方位词不用坐标，
 * 因为模型读得懂「标注框在画面右侧」，读不懂百分比。
 *
 * 文字错不起时改走本地精确合成：商品图由生成链路出，标注、引线、规格表
 * 全部在浏览器里按真实字体排版。两条路的取舍写在界面上，用户自己选。
 *
 * 通用 AI 生图工具（Photoroom、Flair、Pebblely）一律不做信息图，
 * 因为扩散模型渲染文字不可靠；做这件事的全是专门的合成器
 * （ReelWand 整个定位就是「渲染真实、清晰、可读的文字，避开 AI 乱码」）。
 * 影策两条路都留着：模型渲染省一道工序，本地合成保证一个错字都不会有。
 *
 * 几条来自行业的硬规矩，直接写进校验：
 * - 一张图只讲一件事，标注最多 5 个（超过就没人看）
 * - 2000px 画布上正文不小于 32px，否则手机端读不了
 * - 规格数字必须有来源，不能编
 * - 对比图不点名竞品
 */

/** 信息图的七种骨架。每种决定了版面怎么分、标注往哪摆。 */
export type EcommerceInfographicArchetype = "feature" | "dimensions" | "material" | "comparison" | "whatsinbox" | "specs" | "sizechart";

export const ECOMMERCE_INFOGRAPHIC_ARCHETYPES: { id: EcommerceInfographicArchetype; name: string; hint: string }[] = [
    { id: "feature", name: "卖点标注", hint: "引线指向商品的各个部位，一处一句话。最常用的一张" },
    { id: "dimensions", name: "尺寸标注", hint: "标出长宽高与容量，用引线和刻度线表达" },
    { id: "material", name: "材质分解", hint: "把商品拆成几层，每层标注材质与作用" },
    { id: "comparison", name: "规格对比", hint: "多规格并排或列表对比，差异一眼看清" },
    { id: "whatsinbox", name: "包装内容", hint: "列出随商品到手的所有东西，逐件标注" },
    { id: "specs", name: "参数表", hint: "纯表格，适合参数密集的 3C 与家电" },
    { id: "sizechart", name: "尺码表", hint: "服装类目退货率的头号原因；量体说明必须带上" },
];

/** 一条标注：从商品上的某个点引一条线到一侧的标注框。 */
export type EcommerceInfographicCallout = {
    id: string;
    /** 引线指向商品上的哪个点，用画面百分比（0–100）。 */
    targetX: number;
    targetY: number;
    /** 标注框落在哪一侧。 */
    side: "left" | "right";
    /** 标注主文字，一句话。 */
    label: string;
    /** 补充说明，一行。 */
    detail: string;
};

export type EcommerceInfographicTable = {
    id: string;
    title: string;
    columns: string[];
    rows: string[][];
};

export type EcommerceInfographic = {
    name: string;
    archetype: EcommerceInfographicArchetype;
    /** 顶部主标题。信息图的标题是结论，不是品类名。 */
    headline: string;
    subhead: string;
    callouts: EcommerceInfographicCallout[];
    table: EcommerceInfographicTable | null;
    /** 底部信任条：依据、认证、售后。留空则不画。 */
    footer: string;
};

export function createEcommerceInfographicCallout(label = "", detail = ""): EcommerceInfographicCallout {
    return { id: `callout-${Math.random().toString(36).slice(2, 10)}`, targetX: 50, targetY: 50, side: "right", label, detail };
}

export function createEcommerceInfographicTable(): EcommerceInfographicTable {
    return { id: `table-${Math.random().toString(36).slice(2, 10)}`, title: "", columns: ["项目", "数值"], rows: [["", ""], ["", ""]] };
}

export function createEcommerceInfographic(name = "未命名信息图"): EcommerceInfographic {
    return { name, archetype: "feature", headline: "", subhead: "", callouts: [], table: null, footer: "" };
}

/** 有多少条标注真的写了字——空的标注不画，也不该占位。 */
export function ecommerceInfographicCalloutCount(info: EcommerceInfographic | undefined) {
    if (!info) return 0;
    return info.callouts.filter((callout) => callout.label.trim()).length;
}

export function ecommerceInfographicReady(info: EcommerceInfographic | undefined) {
    if (!info) return false;
    return Boolean(info.headline.trim() || ecommerceInfographicCalloutCount(info) || info.table?.rows.some((row) => row.some((cell) => cell.trim())));
}

// ── 校验 ────────────────────────────────────────────────────

export type EcommerceInfographicIssue = { level: "block" | "warn"; message: string };

/** 行业上限：一张图超过五条标注，读者一条也记不住。 */
const MAX_CALLOUTS = 5;

/**
 * 信息图能不能出。
 *
 * 只报能确定的：标注数量、正文字号、对比表里有没有出现竞品名。
 * 「数字是不是真的」测不了——那是人核对的事，所以表格只要填了字就提醒一次来源。
 */
export function ecommerceInfographicIssues(info: EcommerceInfographic | undefined, canvasLongSide = 2000): EcommerceInfographicIssue[] {
    if (!info) return [];
    const issues: EcommerceInfographicIssue[] = [];
    const count = ecommerceInfographicCalloutCount(info);

    if (count > MAX_CALLOUTS) {
        issues.push({ level: "block", message: `${count} 条标注超过上限 ${MAX_CALLOUTS} 条——一张图只讲一件事，超出的挪到下一张` });
    }
    // 尺码表不用标注，它整张就是表格，所以这两条对 sizechart 不适用
    if (info.archetype !== "sizechart" && count && count < 2 && info.archetype !== "specs") {
        issues.push({ level: "warn", message: "只有一条标注，读者会以为漏画了；补到 2–4 条更成立" });
    }
    // 2000px 画布上正文 32px 是行业下限，再小手机端列表里读不出来
    const bodyPx = ecommerceInfographicBodyFontSize(canvasLongSide);
    if (count && bodyPx < 32) {
        issues.push({ level: "warn", message: `画布 ${canvasLongSide}px 上标注正文约 ${Math.round(bodyPx)}px，低于手机端可读的 32px——导出尺寸再大一点` });
    }

    const hasTable = Boolean(info.table?.rows.some((row) => row.some((cell) => cell.trim())));
    if (hasTable) {
        // 编造参数是虚假宣传，工具能做的是每次都提醒一次来源
        issues.push({ level: "warn", message: "规格表里的数字必须来自实测或官方参数，模型不会替你核对——导出前逐项确认" });
        if (info.archetype === "comparison" && tableMentionsCompetitor(info.table)) {
            issues.push({ level: "block", message: "对比表里出现了疑似竞品名称；对比图只讲自己的规格，点名竞品在多数平台算不正当竞争" });
        }
    }
    return issues;
}

export function ecommerceInfographicBlocked(issues: EcommerceInfographicIssue[]) {
    return issues.some((issue) => issue.level === "block");
}

/** 行业里点名过的竞品词与品牌后缀，用于粗筛。认不出来就不报，不硬凑。 */
const COMPETITOR_HINTS = ["竞品", "他家", "别家", "友商", "同行", "vs ", "VS ", "对比某"];

function tableMentionsCompetitor(table: EcommerceInfographicTable | null) {
    if (!table) return false;
    const text = [table.title, ...table.columns, ...table.rows.flat()].join(" ");
    return COMPETITOR_HINTS.some((hint) => text.includes(hint));
}

// ── 版面几何 ────────────────────────────────────────────────

export type EcommerceInfographicBox = { left: number; top: number; width: number; height: number };
export type EcommerceInfographicLeader = { fromX: number; fromY: number; toX: number; toY: number };

export type EcommerceInfographicLayout = {
    headline: EcommerceInfographicBox;
    subhead: EcommerceInfographicBox | null;
    callouts: { callout: EcommerceInfographicCallout; box: EcommerceInfographicBox; leader: EcommerceInfographicLeader }[];
    table: EcommerceInfographicBox | null;
    footer: EcommerceInfographicBox | null;
};

/** 顶部标题带的高度，占画面高度。 */
const HEADER_RATIO = 0.16;
const FOOTER_RATIO = 0.07;
/** 标注框宽度，占画面宽度。 */
const CALLOUT_WIDTH_RATIO = 0.3;

/** 正文基准字号，占短边百分比。32px @2000 短边 ≈ 1.6%。 */
const BODY_FONT_RATIO = 0.016;

/** 按画布长边算出的标注正文字号（px）。导出尺寸变了字号跟着变，观感一致。 */
export function ecommerceInfographicBodyFontSize(longSide: number) {
    return longSide * BODY_FONT_RATIO;
}

/**
 * 把信息图排成绝对坐标。
 *
 * 全部用画面百分比，所以同一份信息图在 1:1、3:4、16:9 上都能出——横向画幅标注框会
 * 自动收窄，竖向画幅会拉高标题带。
 *
 * 标注框按 side 分左右两列，同侧的按 targetY 从上往下排，避免互相压住。
 */
export function ecommerceInfographicLayout(info: EcommerceInfographic, canvas: { width: number; height: number }): EcommerceInfographicLayout {
    const width = canvas.width;
    const height = canvas.height;
    const headerHeight = height * HEADER_RATIO;
    const footerHeight = info.footer.trim() ? height * FOOTER_RATIO : 0;
    const bodyTop = headerHeight;
    const bodyHeight = Math.max(0, height - headerHeight - footerHeight);

    const headline: EcommerceInfographicBox = { left: width * 0.06, top: headerHeight * 0.22, width: width * 0.88, height: headerHeight * 0.46 };
    const subhead: EcommerceInfographicBox | null = info.subhead.trim()
        ? { left: width * 0.06, top: headerHeight * 0.68, width: width * 0.88, height: headerHeight * 0.24 }
        : null;

    const calloutWidth = width * CALLOUT_WIDTH_RATIO;
    const gap = height * 0.03;
    const usable = Math.max(0, bodyHeight - gap * 2);

    const placed: EcommerceInfographicLayout["callouts"] = [];
    for (const side of ["left", "right"] as const) {
        const column = info.callouts.filter((callout) => callout.label.trim() && callout.side === side);
        if (!column.length) continue;
        const boxHeight = Math.min(height * 0.16, usable / column.length - gap);
        column.forEach((callout, index) => {
            const top = bodyTop + gap + index * (boxHeight + gap);
            const left = side === "left" ? width * 0.04 : width * 0.96 - calloutWidth;
            placed.push({
                callout,
                box: { left, top, width: calloutWidth, height: boxHeight },
                // 引线从标注框靠商品的那条边出发，指到商品上的目标点
                leader: {
                    fromX: side === "left" ? left + calloutWidth : left,
                    fromY: top + boxHeight / 2,
                    toX: (callout.targetX / 100) * width,
                    toY: (callout.targetY / 100) * height,
                },
            });
        });
    }

    const hasTable = Boolean(info.table?.rows.some((row) => row.some((cell) => cell.trim())));
    const table: EcommerceInfographicBox | null = hasTable
        ? { left: width * 0.08, top: bodyTop + bodyHeight * 0.58, width: width * 0.84, height: bodyHeight * 0.38 }
        : null;

    const footer: EcommerceInfographicBox | null = footerHeight
        ? { left: width * 0.06, top: height - footerHeight * 0.78, width: width * 0.88, height: footerHeight * 0.6 }
        : null;

    return { headline, subhead, callouts: placed, table, footer };
}

/** 表格的行高：标题占一行，表头一行，其余数据行平分剩余高度。 */
export function ecommerceInfographicTableRowHeight(box: EcommerceInfographicBox, rowCount: number) {
    const lines = Math.max(1, rowCount + 1);
    return box.height / (lines + 0.6);
}

/**
 * 把信息图编译成提示词。
 *
 * 标注与表格**逐字进提示词，交给模型画**——项目里所有产出都是提示词走 API，
 * 信息图也不例外。位置用九宫格方位表达（左/右/上/下），不写具体坐标：
 * 坐标对模型没有意义，方位词才有。
 *
 * 表格另附一句「数字必须与给定值完全一致，不得改写、四舍五入或补充」——
 * 参数图最要命的错是模型顺手把 500ml 写成 约500ml 或自己补一列。
 */
export function ecommerceInfographicPromptBlock(info: EcommerceInfographic | undefined) {
    if (!info || !ecommerceInfographicReady(info)) return "";
    const lines: string[] = [];
    if (info.headline.trim()) lines.push(`主标题（画面顶部）：「${info.headline.trim()}」`);
    if (info.subhead.trim()) lines.push(`副标题（主标题下方）：「${info.subhead.trim()}」`);

    const callouts = info.callouts.filter((callout) => callout.label.trim());
    if (callouts.length) {
        lines.push(`标注（每条用引线指向商品对应部位，标注框放在${callouts[0].side === "left" ? "左" : "右"}侧）：`);
        for (const callout of callouts) {
            const side = callout.side === "left" ? "左侧" : "右侧";
            lines.push(`- 「${callout.label.trim()}」${callout.detail.trim() ? `，下方小字「${callout.detail.trim()}」` : ""}，标注框在画面${side}`);
        }
    }

    if (info.table?.rows.some((row) => row.some((cell) => cell.trim()))) {
        lines.push("规格表（放在画面下方，表格线细、表头加底色）：");
        lines.push(`| ${info.table.columns.join(" | ")} |`);
        for (const row of info.table.rows.filter((row) => row.some((cell) => cell.trim()))) {
            lines.push(`| ${info.table.columns.map((_, index) => row[index] || "").join(" | ")} |`);
        }
        lines.push("表格里的数字与文字必须与上表完全一致，不得改写、四舍五入、补充或增删行列。");
    }

    if (info.footer.trim()) lines.push(`底部信任条：「${info.footer.trim()}」`);
    lines.push("画面里的商品必须与参考图完全一致；除上述文字外不要添加任何其他文字、水印或图标。");
    return [`【信息图】${info.name.trim() || "未命名信息图"}`, ...lines].join("\n");
}
