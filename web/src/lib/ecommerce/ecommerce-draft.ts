/**
 * 让助手起草——把「填表」变成「核对」。
 *
 * 调研里这一块是明确的缺口：用户连入商品图之后，商品档案、卖点、文案全是从空白
 * 输入框开始写。而模型是多模态的，图递过去它就能读。
 *
 * **「图递过去」这四个字是这里全部的关键。** 上一版走的是云 agent，那边没有取图工具，
 * 模型只能回一句「当前环境未挂载视觉查看工具，且系统未传入图片节点的画面像素数据」——
 * 用户看到的是一句关于工具链的抱怨，而不是档案。现在两条起草都改走
 * `runBackendGenerationTask` 并把商品实拍放进 `referenceImages`，模型直接看图。
 *
 * 这里的每条指令都带同一条硬约束：**模型猜出来的必须标成待确认，不能直接当成事实。**
 * 商品锁定块是整个电商创作的信任基础——用户敢说「这就是我那件商品」，靠的是
 * 那段字逐字来自他的确认。把模型从图里猜的结论直接写进去，比留空更危险：
 * 生成出来的图会带着一个没人确认过的「事实」，而且越生成越跑。
 */
import type { EcommerceDetailPageSuggestion, EcommerceProductParameter, EcommerceProductProfile, EcommerceProductSellingPoint } from "./ecommerce-contract";

type EcommerceProductProfileDraftScalar =
    | "name"
    | "englishBrandName"
    | "chineseBrandName"
    | "logoText"
    | "brandStyle"
    | "category"
    | "productModel"
    | "appearance"
    | "functions"
    | "marks"
    | "forbidden"
    | "audience"
    | "painPoints"
    | "purchaseReasons"
    | "facts";

export type EcommerceProductProfileDraft = Partial<Pick<EcommerceProductProfile, EcommerceProductProfileDraftScalar>> & {
    parameters?: EcommerceProductParameter[];
    sellingPoints?: EcommerceProductSellingPoint[];
    detailPageSuggestions?: EcommerceDetailPageSuggestion[];
    unsure?: string;
};

/** 读商品图，起草可核对的结构化商品报告。 */
export function buildEcommerceProfileDraftPrompt() {
    return [
        "请仔细分析随附的商品实拍，自动提取产品信息，并输出结构化识别报告。图就在这次请求里，直接看图，不要说自己看不到。",
        "只把图片中明确可见或用户资料明确提供的内容写成事实；推测写入不确定项。参数、认证、功效没有明确证据时写‘未识别，不要编造’或‘待补充’，绝不补数字、认证或效果。",
        "严格记录产品外观、颜色、LOGO、结构和细节，供后续商品锁逐字保留。不要照搬参考图，只学习参考图的信息层级、氛围和排版逻辑。",
        "",
        "严格使用下面的 Markdown 标题和表格，不要输出代码块或表格外解释：",
        "# 产品信息智能提取报告",
        "",
        "一、品牌信息识别",
        "| 项目 | 识别结果 | 备注 |",
        "| --- | --- | --- |",
        "| 英文品牌名 | 识别值或‘未识别，不要编造’ | 可见位置或来源 |",
        "| 中文品牌名 | 识别值或‘未识别，不要编造’ | 可见位置或来源 |",
        "| LOGO文字 | 逐字抄录或‘未识别，不要编造’ | 位置、字体、颜色 |",
        "| 品牌风格 | 字体、图标、配色、材质感 | 只写可见特征 |",
        "",
        "二、产品类型判断",
        "| 项目 | 识别结果 | 备注 |",
        "| --- | --- | --- |",
        "| 产品类目 | 所属类目或‘未识别，不要编造’ | 判断依据 |",
        "| 产品名称 | 具体名称或‘未识别，不要编造’ | 文字来源 |",
        "| 产品型号 | 型号或‘未识别，不要编造’ | 可见位置 |",
        "| 外观特点 | 颜色、材质、图案、结构和细节 | 逐项写清 |",
        "| 主要功能 | 只写结构或资料能支持的功能 | 不推测功效 |",
        "| 其他标识 | 包装文字、铭牌等 | 逐字抄录并写位置 |",
        "| 禁止项 | 后续生成绝不能改变的外观、颜色、LOGO、结构和细节 | 商品一致性要求 |",
        "",
        "三、核心参数识别",
        "| 参数 | 数值 | 来源/备注 |",
        "| --- | --- | --- |",
        "| 每个实际相关参数单独一行 | 明确数值，否则‘未识别，不要编造’ | 图片位置或用户资料来源 |",
        "",
        "四、核心卖点提取",
        "| 卖点类型 | 卖点内容 | 可视化表达建议 |",
        "| --- | --- | --- |",
        "| 功能卖点 | 有证据的内容，否则‘待补充’ | 与该商品相关的画面建议 |",
        "| 体验卖点 | 有证据的内容，否则‘待补充’ | 与该商品相关的画面建议 |",
        "| 设计卖点 | 有证据的内容，否则‘待补充’ | 与该商品相关的画面建议 |",
        "| 场景卖点 | 有证据的内容，否则‘待补充’ | 与该商品相关的画面建议 |",
        "| 人群卖点 | 有证据的内容，否则‘待补充’ | 与该商品相关的画面建议 |",
        "| 卖点与依据 | 格式‘卖点：可核实依据’，多条用‘；’分隔；无依据写‘待补充’ | 不得把推测写成事实 |",
        "",
        "五、适用人群与购买动机",
        "| 项目 | 识别结果 | 备注 |",
        "| --- | --- | --- |",
        "| 主要目标用户 | 目标用户或‘待补充’ | 说明是可见事实还是建议 |",
        "| 使用痛点 | 有依据的痛点或‘待补充’ | 不夸大 |",
        "| 购买理由 | 由已核实卖点支持的理由或‘待补充’ | 不编造 |",
        "",
        "六、详情页结构建议",
        "| 屏数 | 主题 | 画面建议 | 文案方向 |",
        "| --- | --- | --- | --- |",
        "| 第1屏起逐屏列出 | 每屏只讲一个核心主题 | 根据商品证据动态建议构图、摆放和视觉风格，不固定每屏拍法 | 只基于已核实事实；参数、认证、功效缺失时写‘待补充’ |",
        "",
        "不确定项 | 汇总所有推测、未识别项和待补充证据；没有就写‘无’",
        "价格不要从图片猜测，也不要输出到报告。",
    ].join("\n");
}

const PRODUCT_SELLING_POINT_TYPES = new Set<EcommerceProductSellingPoint["type"]>(["功能卖点", "体验卖点", "设计卖点", "场景卖点", "人群卖点"]);

/** 把模型输出的 Markdown 报告或旧版竖线草稿解析成商品档案字段。 */
export function parseEcommerceProfileDraft(text: string): EcommerceProductProfileDraft {
    const fields: Record<string, EcommerceProductProfileDraftScalar> = {
        name: "name", "产品名称": "name", "商品名称": "name",
        englishbrandname: "englishBrandName", "英文品牌名": "englishBrandName",
        chinesebrandname: "chineseBrandName", "中文品牌名": "chineseBrandName",
        logotext: "logoText", logo: "logoText", "logo文字": "logoText", "LOGO文字": "logoText",
        brandstyle: "brandStyle", "品牌风格": "brandStyle", "品牌视觉风格": "brandStyle",
        category: "category", "品类": "category", "产品类目": "category", "产品所属类目": "category",
        productmodel: "productModel", "产品型号": "productModel", "型号": "productModel",
        appearance: "appearance", "外观": "appearance", "外观特点": "appearance",
        functions: "functions", "主要功能": "functions", "功能判断": "functions", "产品主要功能": "functions",
        marks: "marks", "标识": "marks", "其他标识": "marks",
        forbidden: "forbidden", "禁止": "forbidden", "禁止项": "forbidden",
        audience: "audience", "人群": "audience", "目标人群": "audience", "目标人群与场景": "audience", "主要目标用户": "audience",
        painpoints: "painPoints", "使用痛点": "painPoints", "痛点": "painPoints",
        purchasereasons: "purchaseReasons", "购买理由": "purchaseReasons",
        facts: "facts", "卖点": "facts", "卖点与依据": "facts",
    };
    const result: EcommerceProductProfileDraft = {};
    const parameters: EcommerceProductParameter[] = [];
    const sellingPoints: EcommerceProductSellingPoint[] = [];
    const detailPageSuggestions: EcommerceDetailPageSuggestion[] = [];
    let section: "" | "brand" | "product" | "parameters" | "sellingPoints" | "audience" | "detail" = "";
    const clean = (value: string) => value.replace(/[`*]/g, "").trim();
    const missing = (value: string) => /^(无|没有|看不清|留空|未知|未识别[，,、：:]?不要编造|待补充)$/.test(value.trim());

    for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) continue;
        const heading = line.replace(/^[#\s]+/, "").replace(/[：:]$/, "");
        if (heading.includes("品牌信息")) section = "brand";
        else if (heading.includes("产品类型")) section = "product";
        else if (heading.includes("核心参数")) section = "parameters";
        else if (heading.includes("核心卖点")) section = "sellingPoints";
        else if (heading.includes("适用人群")) section = "audience";
        else if (heading.includes("详情页结构")) section = "detail";

        const parts = line.replace(/^[>\s*•\d.、)\-]+/, "").split(/[|｜]/).map(clean);
        if (parts[0] === "") parts.shift();
        if (parts.at(-1) === "") parts.pop();
        if (parts.length < 2 || parts.every((part) => /^:?-{2,}:?$/.test(part))) continue;
        const rawKey = parts[0].replace(/[:：]\s*$/, "").trim();
        const key = rawKey.toLowerCase();
        if (["项目", "参数", "卖点类型", "屏数"].includes(rawKey)) continue;

        if (section === "parameters" && rawKey !== "parameter" && rawKey !== "参数项") {
            parameters.push({ name: rawKey, value: parts[1] || "", source: parts.slice(2).join(" | ") });
            continue;
        }
        if (key === "parameter" || rawKey === "参数项") {
            if (parts[1]) parameters.push({ name: parts[1], value: parts[2] || "", source: parts.slice(3).join(" | ") });
            continue;
        }
        if (section === "sellingPoints" && PRODUCT_SELLING_POINT_TYPES.has(rawKey as EcommerceProductSellingPoint["type"])) {
            sellingPoints.push({ type: rawKey as EcommerceProductSellingPoint["type"], content: parts[1] || "", visualization: parts.slice(2).join(" | ") });
            continue;
        }
        if (key === "sellingpoint" && PRODUCT_SELLING_POINT_TYPES.has(parts[1] as EcommerceProductSellingPoint["type"])) {
            sellingPoints.push({ type: parts[1] as EcommerceProductSellingPoint["type"], content: parts[2] || "", visualization: parts.slice(3).join(" | ") });
            continue;
        }
        if (section === "detail" && /^第?\d+屏?$/.test(rawKey)) {
            detailPageSuggestions.push({ screen: rawKey, theme: parts[1] || "", visual: parts[2] || "", copy: parts.slice(3).join(" | ") });
            continue;
        }
        if (key === "screensuggestion" || key === "screen") {
            if (parts[1]) detailPageSuggestions.push({ screen: parts[1], theme: parts[2] || "", visual: parts[3] || "", copy: parts.slice(4).join(" | ") });
            continue;
        }
        const value = parts[1] || "";
        if (key === "unsure" || rawKey === "推测" || rawKey === "不确定" || rawKey === "不确定项") {
            if (value && value !== "无") result.unsure = value;
            continue;
        }
        const field = fields[key] || fields[rawKey];
        if (field && value && !missing(value)) result[field] = value;
    }
    if (parameters.length) result.parameters = parameters;
    if (sellingPoints.length) result.sellingPoints = sellingPoints;
    if (detailPageSuggestions.length) result.detailPageSuggestions = detailPageSuggestions;
    return result;
}

/** 依据商品档案起草卖点。 */
export function buildEcommerceSellingPointsDraftPrompt(input?: { category?: string; appearance?: string }) {
    const context = [input?.category?.trim(), input?.appearance?.trim()].filter(Boolean).join("；");
    return [
        "请为这件商品起草卖点清单，每条一句话。",
        context ? `已知的商品事实：${context}` : "先读商品节点的档案。",
        "",
        "硬要求：",
        "- **每条必须带依据**。依据可以是实测数据、检测报告、材质参数、工艺说明——但必须是我能提供的",
        "- 想不出依据的卖点，把「依据」留空并标出来，不要自己编一个数字或认证",
        "- 不要写「行业领先」「销量第一」这类无法验证的话",
        "- 不要写功效承诺（美白、治疗、防过敏之类），那是广告法红线",
        "",
        "写完逐条告诉我：哪几条你有把握、哪几条需要我补依据。",
    ].join("\n");
}

/** 依据商品与卖点起草文案。 */
export function buildEcommerceCopyDraftPrompt(input?: { headline?: string; points?: string[] }) {
    const points = (input?.points || []).filter(Boolean);
    return [
        "请为这件商品起草图上文案。",
        points.length ? `可用的卖点：${points.join("；")}` : "先读卖点节点的清单。",
        "",
        "要写的四项：",
        "- 标题：主视觉上最大的那行，一句结论，不要品类名",
        "- 副文案：补充说明，一行",
        "- 行动引导：按钮或角标上的字，例如「立即购买」",
        "- 价格：**不要写**——价格必须来自真实定价，留空让我自己填",
        "",
        "约束：标题不超过 12 字，副文案不超过 20 字，行动引导不超过 6 字。"
        + "文案会由排版层叠到图上，模型不负责把字画进画面，所以这里只关心「读起来对不对」。",
    ].join("\n");
}

/** 从参考图提取品牌风格。 */
export function buildEcommerceStyleDraftPrompt() {
    return [
        "请读这张参考图，提取它的视觉规范，供整组商品图共用。",
        "",
        "需要提取的：",
        "- 色板：4–6 个主要颜色，给十六进制值，按面积从大到小排",
        "- 色调：冷暖、饱和、明度倾向，以及大致色温",
        "- 气质：用三到五个词描述，例如「干净、克制、留白充足」",
        "- 字体气质：字重对比、衬线还是无衬线、行距松紧",
        "",
        "只描述视觉规范，不要描述画面内容。色值请尽量准确——色板会逐字进每一张图的提示词，"
        + "写错了整组图都会偏色。",
    ].join("\n");
}

/** 拆解竞品详情页的结构。 */
export function buildEcommerceCompetitorDraftPrompt() {
    return [
        "请读这张竞品详情页或主图，拆解它的**结构**。",
        "",
        "按维度逐条输出，每条一行：",
        "- 页面结构：分几屏、每屏解决什么",
        "- 卖点顺序：先讲什么后讲什么，最强卖点在第几屏",
        "- 证据类型：每个卖点用什么证据支撑",
        "- 信任模块：背书、认证、售后出现在哪些位置",
        "- 版式层级：标题、正文、图片的关系",
        "",
        "**不要复述它的文案原文**，只描述它讲了什么、按什么顺序讲——复述会把别人的文案"
        + "带进我们的提示词，那是抄袭。",
    ].join("\n");
}
