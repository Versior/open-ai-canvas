/**
 * 尺码表——服装类目退货率的头号原因，也是国内头部 AI 工具集体没做深的一块。
 *
 * 调研结论：美图 A+ 有「尺寸/容量/尺码图」模块、看往有「尺码标注」，但都是标注工具；
 * 专门产品全是海外 Shopify 插件（含百万条评价数据做推荐），国内的尺码哥/LZL 是独立小站。
 * 而尺码表与设计工作流是割裂的——美工还是「去尺码工具做图 → 下载 → 放进详情页」。
 *
 * 所以这里只做两件事，都是「让尺码表长在画布里」的前提：
 * 1. **按品类给标准量体项**——不同品类的量体项不一样，从零开始列等于让用户背规范
 * 2. **量体位置说明**——买家不知道自己该量哪里，是尺码表失效的真正原因
 *
 * 表格的渲染复用信息图节点（它已经有规格表），不另起一套合成。
 */

export type EcommerceSizeChartCategory = "top" | "pants" | "dress" | "shoes" | "kids" | "bag";

export type EcommerceSizeChartField = {
    /** 列名，也是量体项的名字。 */
    label: string;
    /** 怎么量。买家看不懂列名时看这里。 */
    how: string;
    /** 单位 */
    unit: "cm" | "kg" | "mm";
};

export type EcommerceSizeChartTemplate = {
    id: EcommerceSizeChartCategory;
    name: string;
    /** 尺码列名，通常是 S/M/L 或 36/37/38。 */
    sizeColumn: string;
    /** 量体项。 */
    fields: EcommerceSizeChartField[];
    hint: string;
};

export const ECOMMERCE_SIZE_CHART_TEMPLATES: EcommerceSizeChartTemplate[] = [
    {
        id: "top", name: "上衣", sizeColumn: "尺码", hint: "T 恤、衬衫、卫衣、外套",
        fields: [
            { label: "胸围", how: "腋下 2cm 处水平环绕一周", unit: "cm" },
            { label: "衣长", how: "后领中点垂直量到下摆", unit: "cm" },
            { label: "肩宽", how: "左右肩点之间直线距离", unit: "cm" },
            { label: "袖长", how: "肩点沿袖子外侧量到袖口", unit: "cm" },
            { label: "建议体重", how: "该尺码适合的体重区间", unit: "kg" },
        ],
    },
    {
        id: "pants", name: "裤装", sizeColumn: "尺码", hint: "长裤、短裤、牛仔裤",
        fields: [
            { label: "腰围", how: "腰部最细处水平环绕一周", unit: "cm" },
            { label: "臀围", how: "臀部最丰满处水平环绕一周", unit: "cm" },
            { label: "裤长", how: "腰头沿外侧缝量到裤脚", unit: "cm" },
            { label: "前档", how: "腰头前中缝量到裆底", unit: "cm" },
            { label: "建议身高", how: "该尺码适合的身高区间", unit: "cm" },
        ],
    },
    {
        id: "dress", name: "裙装", sizeColumn: "尺码", hint: "连衣裙、半身裙",
        fields: [
            { label: "胸围", how: "腋下 2cm 处水平环绕一周", unit: "cm" },
            { label: "腰围", how: "腰部最细处水平环绕一周", unit: "cm" },
            { label: "臀围", how: "臀部最丰满处水平环绕一周", unit: "cm" },
            { label: "裙长", how: "肩点或腰头量到下摆", unit: "cm" },
            { label: "建议身高", how: "该尺码适合的身高区间", unit: "cm" },
        ],
    },
    {
        id: "shoes", name: "鞋靴", sizeColumn: "尺码", hint: "运动鞋、皮鞋、靴子",
        fields: [
            { label: "脚长", how: "脚跟到最长脚趾的直线距离", unit: "mm" },
            { label: "脚宽", how: "前掌最宽处直线距离", unit: "mm" },
            { label: "内长", how: "鞋内实际可用长度，通常比脚长多 5–10mm", unit: "mm" },
        ],
    },
    {
        id: "kids", name: "童装", sizeColumn: "身高", hint: "儿童服装按身高分码",
        fields: [
            { label: "建议身高", how: "该尺码适合的身高区间", unit: "cm" },
            { label: "胸围", how: "腋下 2cm 处水平环绕一周", unit: "cm" },
            { label: "衣长", how: "后领中点垂直量到下摆", unit: "cm" },
            { label: "建议体重", how: "该尺码适合的体重区间", unit: "kg" },
        ],
    },
    {
        id: "bag", name: "箱包", sizeColumn: "规格", hint: "背包、手提包、行李箱",
        fields: [
            { label: "长", how: "包身最长边", unit: "cm" },
            { label: "宽", how: "包身正面宽度", unit: "cm" },
            { label: "高", how: "包身垂直高度", unit: "cm" },
            { label: "容量", how: "可容纳的升数或可放下的物品", unit: "cm" },
        ],
    },
];

export function ecommerceSizeChartTemplate(category: EcommerceSizeChartCategory) {
    return ECOMMERCE_SIZE_CHART_TEMPLATES.find((template) => template.id === category);
}

export type EcommerceSizeChart = {
    /** 用哪个品类的量体项。 */
    category: EcommerceSizeChartCategory;
    /** 尺码行，例如 S/M/L。 */
    sizes: string[];
    /** 每格填数值。键是 `${size}|${fieldLabel}`。 */
    cells: Record<string, string>;
    /** 是否附量体位置说明。 */
    showHowToMeasure: boolean;
};

export function createEcommerceSizeChart(category: EcommerceSizeChartCategory = "top"): EcommerceSizeChart {
    const template = ecommerceSizeChartTemplate(category)!;
    return { category, sizes: ["S", "M", "L", "XL"], cells: {}, showHowToMeasure: true };
}

export function ecommerceSizeChartCellKey(size: string, field: string) {
    return `${size}|${field}`;
}

/**
 * 转成信息图能吃的规格表。
 *
 * 首列是尺码列，其余列是量体项；列名带上单位——不带单位的尺码表是最常见的返工原因，
 * 买家分不清 38 是厘米还是码数。
 */
export function ecommerceSizeChartTable(chart: EcommerceSizeChart) {
    const template = ecommerceSizeChartTemplate(chart.category);
    if (!template) return { id: "size-chart", title: "尺码表", columns: [], rows: [] as string[][] };
    const columns = [template.sizeColumn, ...template.fields.map((field) => `${field.label}(${field.unit})`)];
    const rows = chart.sizes.filter((size) => size.trim()).map((size) => [
        size,
        ...template.fields.map((field) => chart.cells[ecommerceSizeChartCellKey(size, field.label)] || ""),
    ]);
    return { id: "size-chart", title: template.name + "尺码表", columns, rows };
}

/**
 * 尺码表的完整性。
 *
 * 只报能确定的：有没有尺码行、有没有填值、单位有没有写。
 * 数值对不对测不了——那要跟实际成衣比，是人的事。
 */
export type EcommerceSizeChartIssue = { level: "block" | "warn"; message: string };

export function ecommerceSizeChartIssues(chart: EcommerceSizeChart | undefined): EcommerceSizeChartIssue[] {
    if (!chart) return [];
    const template = ecommerceSizeChartTemplate(chart.category);
    if (!template) return [];
    const issues: EcommerceSizeChartIssue[] = [];
    const sizes = chart.sizes.filter((size) => size.trim());

    if (!sizes.length) issues.push({ level: "block", message: "还没有尺码行——尺码表没有尺码就不是尺码表" });

    const emptyCells = sizes.flatMap((size) => template.fields.filter((field) => !chart.cells[ecommerceSizeChartCellKey(size, field.label)]?.trim()).map(() => size));
    if (sizes.length && emptyCells.length) {
        issues.push({ level: "warn", message: `有 ${emptyCells.length} 格没填数值；留空的格子会让买家放弃查表，直接下单又退货` });
    }

    if (!chart.showHowToMeasure) {
        issues.push({ level: "warn", message: "关掉了量体说明——买家不知道自己该量哪里，是尺码表失效的真正原因" });
    }

    return issues;
}

export function ecommerceSizeChartBlocked(issues: EcommerceSizeChartIssue[]) {
    return issues.some((issue) => issue.level === "block");
}

/** 量体说明文本，进信息图的底部信任条。 */
export function ecommerceSizeChartHowToMeasure(chart: EcommerceSizeChart | undefined) {
    if (!chart?.showHowToMeasure) return "";
    const template = ecommerceSizeChartTemplate(chart.category);
    if (!template) return "";
    return `量体方式：${template.fields.map((field) => `${field.label}（${field.how}）`).join("；")}。数值为人工测量，允许 1–3cm 误差。`;
}
