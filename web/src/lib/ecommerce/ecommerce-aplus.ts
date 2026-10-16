/**
 * A+ 内容模块——亚马逊详情页的固定版式，每个模块都有精确到像素的规格。
 *
 * 为什么值得单独建一层：A+ 不是「一张长图」，是**一组带硬性尺寸的槽位**。
 * 图放错尺寸会被审核拒；文字超字数会被截断。而调研里只有 Ecomtent、Pixii、
 * 亚马逊自带的 A+ Content Manager 在生成它，通用工具（Canva、Midjourney）
 * 只能产出**素材**，拼版还是人工。
 *
 * 亚马逊官方数据：基础 A+ 提升销售最多 8%，优质 A+ 最多 20%。所以这不是锦上添花。
 *
 * 尺寸与字数全部来自公开的模块规格。落地上架前应以卖家后台最新提示为准。
 */

/** A+ 模块。只收有硬性尺寸的常用模块，不把 17 个全搬进来。 */
export type EcommerceAplusModuleId =
    | "header-image-text"
    | "image-text-overlay"
    | "four-images-text"
    | "comparison-chart"
    | "technical-specs"
    | "single-image-sidebar"
    | "company-logo"
    | "product-description";

export type EcommerceAplusModule = {
    id: EcommerceAplusModuleId;
    name: string;
    /** 官方模块名，对账用。 */
    officialName: string;
    /** 图片最小尺寸（像素），按宽×高。 */
    imageMin?: { width: number; height: number };
    /** 推荐尺寸。 */
    imageBest?: { width: number; height: number };
    /** 标题字数上限。 */
    headlineMax?: number;
    /** 正文字数上限。 */
    bodyMax?: number;
    /** 图片数量。 */
    imageCount?: number;
    /** 对比表专有：最多几个商品、最多几行、单元格字数上限、图片最小尺寸。 */
    chart?: { maxProducts: number; maxRows: number; cellMax: number; imageMin: { width: number; height: number } };
    hint: string;
};

export const ECOMMERCE_APLUS_MODULES: EcommerceAplusModule[] = [
    {
        id: "header-image-text", name: "品牌头图", officialName: "Standard Image Header With Text",
        imageMin: { width: 970, height: 600 }, imageBest: { width: 1940, height: 600 },
        headlineMax: 150, bodyMax: 6000, imageCount: 1,
        hint: "页面开篇。标题加副标题合计 ≤150 字，正文 ≤6000 字——这里可以讲故事",
    },
    {
        id: "image-text-overlay", name: "图文叠加", officialName: "Standard Image Text Overlay",
        imageMin: { width: 970, height: 300 }, imageBest: { width: 1940, height: 600 },
        headlineMax: 70, bodyMax: 300, imageCount: 1,
        hint: "文字压在图上，用 70% 不透明度的深色或浅色蒙版保证可读；标题 ≤70 字，正文 ≤300 字。**文字走叠加层，不要烧进图里**",
    },
    {
        id: "four-images-text", name: "四图一文", officialName: "Standard Four Image & Text",
        imageMin: { width: 220, height: 220 }, imageCount: 4,
        headlineMax: 160, bodyMax: 1000,
        hint: "四个卖点并排，每个配一张方图。四张图风格要统一，否则页面看起来是拼的",
    },
    {
        id: "comparison-chart", name: "对比表", officialName: "Standard Comparison Chart",
        chart: { maxProducts: 6, maxRows: 10, cellMax: 250, imageMin: { width: 150, height: 300 } },
        hint: "最多 6 个商品、10 行、单元格 ≤250 字；商品图最小 150×300。**只对比自家系列，不点名竞品**",
    },
    {
        id: "technical-specs", name: "技术规格", officialName: "Standard Technical Specifications",
        bodyMax: 600,
        hint: "参数表。数字必须来自实测或官方参数——模型不会替你核对",
    },
    {
        id: "single-image-sidebar", name: "单图侧栏", officialName: "Standard Single Image & Sidebar",
        imageMin: { width: 300, height: 300 }, imageCount: 1,
        headlineMax: 160, bodyMax: 1000,
        hint: "图在一侧、文字在另一侧。适合讲单个卖点讲透",
    },
    {
        id: "company-logo", name: "品牌标识", officialName: "Standard Company Logo",
        imageMin: { width: 600, height: 180 }, imageCount: 1,
        hint: "页脚品牌条。这一块是品牌备案后才有意义的模块",
    },
    {
        id: "product-description", name: "商品描述", officialName: "Standard Product Description Text",
        bodyMax: 6000,
        hint: "纯文本。适合放使用说明与保养方式",
    },
];

export function ecommerceAplusModule(id: EcommerceAplusModuleId) {
    return ECOMMERCE_APLUS_MODULES.find((module) => module.id === id);
}

/** 一个已填的 A+ 模块实例。 */
export type EcommerceAplusBlock = {
    id: string;
    moduleId: EcommerceAplusModuleId;
    headline: string;
    body: string;
    /** 对比表的行：首列是项目名，其余列是各商品。 */
    chartRows?: string[][];
    chartColumns?: string[];
};

export function createEcommerceAplusBlock(moduleId: EcommerceAplusModuleId = "header-image-text"): EcommerceAplusBlock {
    return { id: `aplus-${Math.random().toString(36).slice(2, 10)}`, moduleId, headline: "", body: "" };
}

export type EcommerceAplus = {
    name: string;
    blocks: EcommerceAplusBlock[];
};

export function createEcommerceAplus(name = "A+ 内容"): EcommerceAplus {
    return { name, blocks: [] };
}

export function ecommerceAplusReady(aplus: EcommerceAplus | undefined) {
    if (!aplus) return false;
    return aplus.blocks.some((block) => block.headline.trim() || block.body.trim());
}

/**
 * A+ 的完整性。
 *
 * 全部能机器判定：字数超限会被平台截断、模块重复会让页面冗长、对比表超列数会被拒。
 * 这是 A+ 相对其他图最不一样的地方——它有硬性规格，所以能真正校验。
 */
export type EcommerceAplusIssue = { level: "block" | "warn"; message: string };

export function ecommerceAplusIssues(aplus: EcommerceAplus | undefined): EcommerceAplusIssue[] {
    if (!aplus?.blocks.length) return [];
    const issues: EcommerceAplusIssue[] = [];

    for (const block of aplus.blocks) {
        const module = ecommerceAplusModule(block.moduleId);
        if (!module) continue;
        const label = `「${module.name}」`;

        if (module.headlineMax && block.headline.trim().length > module.headlineMax) {
            issues.push({ level: "block", message: `${label}标题 ${block.headline.trim().length} 字，超过上限 ${module.headlineMax} 字，平台上会被截断` });
        }
        if (module.bodyMax && block.body.trim().length > module.bodyMax) {
            issues.push({ level: "block", message: `${label}正文 ${block.body.trim().length} 字，超过上限 ${module.bodyMax} 字` });
        }
        if (module.chart && block.chartRows?.length) {
            const products = Math.max(0, (block.chartColumns?.length || 1) - 1);
            if (products > module.chart.maxProducts) {
                issues.push({ level: "block", message: `${label}列了 ${products} 个商品，超过上限 ${module.chart.maxProducts} 个` });
            }
            if (block.chartRows.length > module.chart.maxRows) {
                issues.push({ level: "block", message: `${label}有 ${block.chartRows.length} 行，超过上限 ${module.chart.maxRows} 行` });
            }
            const over = block.chartRows.flat().filter((cell) => cell.trim().length > module.chart!.cellMax).length;
            if (over) issues.push({ level: "block", message: `${label}有 ${over} 个单元格超过 ${module.chart.cellMax} 字` });
            // 对比表点名竞品在多数平台算不正当竞争，这一条是硬的
            const text = [block.headline, block.body, ...(block.chartColumns || []), ...block.chartRows.flat()].join(" ");
            if (/竞品|友商|他家|别家|vs |VS /.test(text)) {
                issues.push({ level: "block", message: `${label}里出现了疑似竞品名称；对比表只对比自家系列` });
            }
        }
        if (!block.headline.trim() && !block.body.trim()) {
            issues.push({ level: "warn", message: `${label}还是空的` });
        }
    }

    const moduleIds = aplus.blocks.map((block) => block.moduleId);
    const duplicated = moduleIds.filter((id, index) => moduleIds.indexOf(id) !== index);
    if (duplicated.length) {
        const names = [...new Set(duplicated)].map((id) => ecommerceAplusModule(id)?.name || id);
        issues.push({ level: "warn", message: `重复用了「${names.join("、")}」模块——同一个模块重复出现会让页面冗长，买家会跳过` });
    }

    return issues;
}

export function ecommerceAplusBlocked(issues: EcommerceAplusIssue[]) {
    return issues.some((issue) => issue.level === "block");
}

/**
 * 编译成给生成链路的约束。
 *
 * 关键的一句是「文字走叠加层，不要烧进图里」——A+ 的图文叠加模块本身就带蒙版层，
 * 如果模型把字画进图，再叠一层字就是两套字打架。
 */
export function ecommerceAplusBlock(aplus: EcommerceAplus | undefined) {
    if (!ecommerceAplusReady(aplus)) return "";
    const aplusValue = aplus!;
    const lines: string[] = [];
    for (const block of aplusValue.blocks) {
        const module = ecommerceAplusModule(block.moduleId);
        if (!module || (!block.headline.trim() && !block.body.trim())) continue;
        const size = module.imageBest || module.imageMin;
        const parts = [`- ${module.name}`];
        if (size) parts.push(`画面 ${size.width}×${size.height}`);
        if (block.headline.trim()) parts.push(`标题：${block.headline.trim()}`);
        if (block.body.trim()) parts.push(`正文：${block.body.trim()}`);
        lines.push(parts.join("；"));
    }
    if (!lines.length) return "";
    lines.push("每块按各自尺寸单独出图，画面里不要出现任何文字——标题与正文由叠加层添加。");
    return [`【A+ 内容】${aplusValue.name.trim() || "A+ 内容"}`, ...lines].join("\n");
}

/** 按模块规格算出导出尺寸。 */
export function ecommerceAplusExportSize(moduleId: EcommerceAplusModuleId, useBest = true) {
    const module = ecommerceAplusModule(moduleId);
    if (!module) return null;
    const size = useBest ? module.imageBest || module.imageMin : module.imageMin;
    return size ? { width: size.width, height: size.height } : null;
}
