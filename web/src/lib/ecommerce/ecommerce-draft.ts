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
import type { EcommerceProductProfile } from "./ecommerce-contract";

/** 读商品图，起草商品档案。 */
export function buildEcommerceProfileDraftPrompt() {
    return [
        "读随附的商品实拍，起草商品档案。图就在这次请求里，直接看图，不要说自己看不到。",
        "",
        "只写你**从图里能看见**的东西。看不见的一律留空——留空比编造好。",
        "",
        "【输出格式】每行一条，竖线分隔，不要输出任何其他内容（不要序号、不要解释、不要代码块）：",
        "category | 这件商品是什么，例如「保温杯」「连衣裙」",
        "appearance | 颜色、材质、图案、结构，用「；」分隔",
        "marks | 商品或包装上的 Logo、文字，逐字抄下来并说明位置；看不清就留空",
        "forbidden | 为了让下一张图保持一致，明确不能变的东西",
        "unsure | 上面哪几条是推测而不是直接看见的（没有就写「无」）",
        "",
        "商品锁定块是后面所有图的依据，写错一条整批图都会跑，所以推测的那几条一定要在 unsure 里点出来。",
    ].join("\n");
}

/**
 * 把模型读图写回的档案解析成字段。
 *
 * 容忍度和文案解析一样高：模型会加序号、会换全角竖线、会写「category：」前缀。
 * 认不出来的行跳过——档案里那几个字段在卡片上都看得见，填没填一眼就知道，
 * 报错会让整次读图白跑。
 */
export function parseEcommerceProfileDraft(text: string): Partial<Pick<EcommerceProductProfile, "category" | "appearance" | "marks" | "forbidden">> & { unsure?: string } {
    const fields: Record<string, "category" | "appearance" | "marks" | "forbidden"> = {
        category: "category", "品类": "category",
        appearance: "appearance", "外观": "appearance",
        marks: "marks", "标识": "marks",
        forbidden: "forbidden", "禁止": "forbidden", "禁止项": "forbidden",
    };
    const result: Partial<Pick<EcommerceProductProfile, "category" | "appearance" | "marks" | "forbidden">> & { unsure?: string } = {};
    for (const rawLine of text.split("\n")) {
        const line = rawLine.replace(/^[\s>*\-•\d.、)]+/, "").trim();
        if (!line) continue;
        const parts = line.split(/[|｜]/).map((part) => part.trim());
        if (parts.length < 2) continue;
        const key = parts[0].replace(/[`*]/g, "").replace(/[:：]\s*$/, "").trim().toLowerCase();
        const value = parts.slice(1).join(" | ").replace(/[`*]/g, "").replace(/^(无|没有|看不清|留空)$/, "").trim();
        if (key === "unsure" || key === "推测" || key === "不确定") {
            if (value) result.unsure = value;
            continue;
        }
        const field = fields[key] || fields[parts[0].replace(/[`*]/g, "").trim()];
        if (!field || !value) continue;
        result[field] = value;
    }
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
