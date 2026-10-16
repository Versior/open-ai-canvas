/**
 * SKU 变体——一个商品的多色多规格，一次出全套。
 *
 * 调研里的原话：AI 生成类工具（美图、WeShop、绘蛙）的批量是「排队制」——
 * 同一套参数跑 N 次。但铺货型店铺真正要的是**字段驱动**：表格里一行一个 SKU，
 * 颜色/容量/型号各不相同，AI 出图时把这些字段烧进画面与文案。
 * 这一层目前只有创客贴、稿定企业版、羚珑、深绘做到，纯 AI 工具普遍缺失。
 *
 * 影策的做法：变体挂在**商品节点**上（它是这件商品的属性，不是流程里的一个步骤），
 * 用 `{颜色}` 这样的占位符写进拍法、卖点、文案里，生成时按组合展开。
 *
 * 为什么用占位符而不是另做一套「变体字段」表单：因为变体要替换的位置是随场景变的——
 * 同一个「黑色」既要进构图描述（杯身是哑光黑），也要进文案（哑光黑 · 500ml）。
 * 占位符让用户自己决定替换到哪，比工具预设几个插槽灵活得多。
 */

/** 一条变体轴，例如「颜色：黑 / 白 / 米」。 */
export type EcommerceVariantAxis = {
    id: string;
    /** 轴名，同时是占位符名——写 `{颜色}` 就替换这里。 */
    name: string;
    values: string[];
};

export function createEcommerceVariantAxis(name = "", values: string[] = []): EcommerceVariantAxis {
    return { id: `axis-${Math.random().toString(36).slice(2, 10)}`, name, values };
}

/** 变体集合。 */
export type EcommerceVariantSet = {
    axes: EcommerceVariantAxis[];
};

export function createEcommerceVariantSet(): EcommerceVariantSet {
    return { axes: [] };
}

/** 只有填了轴名且至少有一个值的轴才算数——空轴会让组合数归零。 */
export function ecommerceUsableAxes(set: EcommerceVariantSet | undefined) {
    if (!set) return [];
    return set.axes.filter((axis) => axis.name.trim() && axis.values.filter((value) => value.trim()).length);
}

/**
 * 组合数。
 *
 * 单独算出来是因为它会爆炸：3 个轴各 4 个值就是 64 个 SKU，每个 SKU 出 5 张主图
 * 就是 320 张图。界面必须在用户按下生成**之前**把这个数字摆出来。
 */
export function ecommerceVariantCombinationCount(set: EcommerceVariantSet | undefined) {
    const axes = ecommerceUsableAxes(set);
    if (!axes.length) return 0;
    return axes.reduce((total, axis) => total * axis.values.filter((value) => value.trim()).length, 1);
}

/** 一组组合：轴名 → 值。 */
export type EcommerceVariantRow = {
    id: string;
    /** 这一行的标签，例如「黑 / 500ml」。 */
    label: string;
    values: Record<string, string>;
};

/**
 * 展开成所有组合（笛卡尔积）。
 *
 * 上限存在的理由不是性能，是**别让人误按**：三个轴各四个值就是 64 行，
 * 界面摆不下，人也没法逐行核对。超上限时截断并在调用处提示用户收窄。
 */
const MAX_VARIANT_ROWS = 120;

export function ecommerceVariantRows(set: EcommerceVariantSet | undefined): EcommerceVariantRow[] {
    const axes = ecommerceUsableAxes(set);
    if (!axes.length) return [];
    let rows: EcommerceVariantRow[] = [{ id: "variant-0", label: "", values: {} }];
    for (const axis of axes) {
        const values = axis.values.map((value) => value.trim()).filter(Boolean);
        rows = rows.flatMap((row) =>
            values.map((value) => {
                const values2 = { ...row.values, [axis.name.trim()]: value };
                return { id: `${row.id}-${value}`, label: Object.values(values2).join(" / "), values: values2 };
            }),
        );
        if (rows.length > MAX_VARIANT_ROWS) {
            rows = rows.slice(0, MAX_VARIANT_ROWS);
            break;
        }
    }
    return rows;
}

/**
 * 把 `{颜色}` 换成这一行的值。
 *
 * 认不出的占位符原样留着——它多半是用户打错了轴名，留着比静默删掉好，
 * 用户能一眼看出「这里没被替换」。
 */
export function applyEcommerceVariants(text: string, row: EcommerceVariantRow | undefined) {
    if (!text || !row) return text;
    return text.replace(/\{([^{}]+)\}/g, (match, name: string) => {
        const value = row.values[name.trim()];
        return value === undefined ? match : value;
    });
}

/** 一条文本里用到了哪些轴——用于提示「你写了 {材质} 但没有这个轴」。 */
export function ecommerceVariantPlaceholders(text: string) {
    const names = new Set<string>();
    for (const match of text.matchAll(/\{([^{}]+)\}/g)) names.add(match[1].trim());
    return [...names];
}

/**
 * 占位符与变体轴的对应检查。
 *
 * 只报能确定的：写了占位符但没有对应轴（永远不会被替换）、有轴但从没被用过
 * （用户可能白建了）。不报「某个值没被用」——同一个值在不同图里用不用是设计选择。
 */
export type EcommerceVariantIssue = { level: "warn"; message: string };

export function ecommerceVariantIssues(set: EcommerceVariantSet | undefined, texts: string[]): EcommerceVariantIssue[] {
    const axes = ecommerceUsableAxes(set);
    const names = new Set(axes.map((axis) => axis.name.trim()));
    const used = new Set(texts.flatMap((text) => ecommerceVariantPlaceholders(text)));
    const issues: EcommerceVariantIssue[] = [];

    const orphans = [...used].filter((name) => !names.has(name));
    if (orphans.length) {
        issues.push({ level: "warn", message: `{${orphans.join("}、{")}} 没有对应的变体轴，不会被替换——检查是不是轴名写错了` });
    }

    const unused = axes.filter((axis) => !used.has(axis.name.trim()));
    if (unused.length && used.size) {
        issues.push({ level: "warn", message: `变体轴「${unused.map((axis) => axis.name.trim()).join("、")}」在文案与拍法里都没被用到` });
    }

    return issues;
}

/** 组合数与张数的合计，用于生成前的确认文案。 */
export function ecommerceVariantPlanSummary(set: EcommerceVariantSet | undefined, imagesPerRow: number) {
    const rows = ecommerceVariantRows(set);
    return { rows: rows.length, images: rows.length * Math.max(0, imagesPerRow) };
}
