import type { EcommerceModel } from "./ecommerce-models";
import { ecommerceModelLockBlock } from "./ecommerce-models";
import type { EcommerceReplica } from "./ecommerce-replica";
import { ecommerceReplicaBlock } from "./ecommerce-replica";
import type { EcommerceTeardown } from "./ecommerce-teardown";
import { ecommerceTeardownBlock } from "./ecommerce-teardown";

/**
 * 电商创作的两块基石：商品档案与拍法。
 *
 * 商品一致性靠两件事分开管：
 * - 外观（商品长什么样）→ 商品档案，用户确认后逐字进提示词，不允许模型发挥
 * - 空间与摄影（怎么拍）→ 拍法，可以换、可以复用、可以叠加
 *
 * 两条通道分开，是因为它们混在一段提示词里时，模型改构图会顺手把商品也改了。
 */

/** 商品参考视角。按需绑定画布图片节点，缺哪一档就退回已有里最接近的。 */
export type EcommerceProductView = "front" | "side" | "back" | "detail" | "packaging";

export const ECOMMERCE_PRODUCT_VIEWS: { id: EcommerceProductView; label: string; hint: string }[] = [
    { id: "front", label: "正面", hint: "主要参考，决定商品默认朝向" },
    { id: "side", label: "侧面", hint: "补厚度与轮廓" },
    { id: "back", label: "背面", hint: "补背面结构与标识" },
    { id: "detail", label: "细节", hint: "材质、工艺、纹理" },
    { id: "packaging", label: "包装", hint: "包装形态与包装上的文字" },
];

/**
 * 商品档案——一个商品的持久身份。
 *
 * 四个字段都是用户确认过的事实，不是模型从图里猜的。模型猜出来的必须先标成待确认，
 * 确认之后才进提示词。这是整个电商创作的信任基础：用户敢说"这就是我那件商品"。
 */
export type EcommerceProductProfile = {
    /** 商品名。只用于展示和节点标题，不进提示词。 */
    name: string;
    /** 品类，例如「保温杯」「连衣裙」。进提示词。 */
    category: string;
    /** 外观：颜色、材质、图案、结构。一项一行。 */
    appearance: string;
    /** 标识：Logo、包装文字。逐字保留，含位置。 */
    marks: string;
    /** 禁止项：明确不能出现的变化。 */
    forbidden: string;
    /**
     * 目标人群与使用场景。文案要靠它说人话。
     *
     * 这是「详情页文案母版」的最小信息集里最容易漏、也最要命的一项：
     * 没有它，写出来的每句话都只能停在商品层面（「304 不锈钢」），
     * 而买家买的是「早上倒的水中午还烫」。
     */
    audience: string;
    /**
     * 卖点与可核实的依据，一条一行，格式「卖点：依据」。
     *
     * 这是文案的**事实来源**。没有它，模型只剩两条路：编，或者写「暂未提供」。
     * 两条都不能要——所以要在这里逼用户先给事实，而不是让模型自己找补。
     */
    facts: string;
    /** 价格或价格带。空着就不在图上出现价格，不编。 */
    price: string;
    /** 多视角证据：视角 → 画布图片节点 ID。 */
    views: Partial<Record<EcommerceProductView, string>>;
};

export function createEcommerceProductProfile(name = "未命名商品"): EcommerceProductProfile {
    return { name, category: "", appearance: "", marks: "", forbidden: "", audience: "", facts: "", price: "", views: {} };
}

/** 档案填得够不够——空档案不该被当成有效商品放进生成。 */
export function ecommerceProductReady(profile: EcommerceProductProfile | undefined) {
    if (!profile) return false;
    return Boolean(profile.category.trim() || profile.appearance.trim());
}

/**
 * 写文案之前，档案里还缺什么。
 *
 * 判据来自「详情页文案母版」的最小信息集：产品名、品类、价格带、
 * 2–3 个核心卖点、目标用户或场景。缺了这些，模型只有两条路——
 * 编，或者写「暂未提供」。两条都不能要，所以要在起草之前拦下来。
 *
 * 外观和标识不算在内：它们影响的是「画得像不像」，不影响「话说不说得出来」。
 */
export function ecommerceCopySourceIssues(profile: EcommerceProductProfile | undefined) {
    const issues: string[] = [];
    if (!profile?.category.trim()) issues.push("品类");
    if (!profile?.facts.trim()) issues.push("卖点与依据");
    if (!profile?.audience.trim()) issues.push("目标人群与场景");
    return issues;
}

/** 已绑定的视角数量，用于齐全度提示。 */
export function ecommerceProductViewCount(profile: EcommerceProductProfile | undefined) {
    if (!profile) return 0;
    return ECOMMERCE_PRODUCT_VIEWS.filter((view) => profile.views[view.id]).length;
}

/**
 * 商品锁定块。
 *
 * 空字段整段省略，不输出「外观：」这种空标题——空标题会让模型以为那是一项待填的自由项。
 * 一段都填不出来时返回空串，调用方据此判定商品没准备好。
 */
export function ecommerceProductLockBlock(profile: EcommerceProductProfile | undefined) {
    if (!profile) return "";
    const lines: string[] = [];
    if (profile.category.trim()) lines.push(`品类：${profile.category.trim()}`);
    if (profile.appearance.trim()) lines.push(`外观：${profile.appearance.trim()}`);
    if (profile.marks.trim()) lines.push(`标识：${profile.marks.trim()}`);
    if (profile.forbidden.trim()) lines.push(`禁止：${profile.forbidden.trim()}`);
    if (!lines.length) return "";
    return [
        "【商品锁定】以下特征必须逐字保留，不得改写、美化、替换、增减或重新设计：",
        ...lines,
        "商品必须是参考图中的同一件实物，不是相似款。",
    ].join("\n");
}

/**
 * 拍法——一组图的拍摄方案，是一张**拍摄清单**，不是一个节点的方案。
 *
 * 为什么是「一组」而不是「一张」：
 *
 * 一次上新出的是成套的图（主图五张、详情页九屏），这些图之间的差异是**清单上的行**，
 * 不是彼此独立的节点。把五张主图拆成五个拍法节点，用户要填五遍几乎一样的表，
 * 还得在画布上四处找哪一份对应哪张图——而设计师真正的工作方式是列一张单子，
 * 一行一张，一眼看完。
 *
 * 每张图保留完整字段，因为主图 1（白底棚拍）和主图 3（家居场景）的光线、镜头、背景
 * 本来就不一样，硬把字段提成「整组共用」会把差异藏起来。真正共用的东西只有一件——
 * 整组统一的调性要求，那个单独一个字段写一遍。
 *
 * 所有字段都只描述「怎么拍」，一个字都不描述商品长什么样。
 * 换商品不换拍法，是这套设计的复用单位。
 */
export type EcommerceShot = {
    /** 与产物图片节点上的 ecommerceShotId 对应，决定这张图用哪一行。 */
    id: string;
    /** 这一张叫什么，进节点标题与提示词。 */
    title: string;
    /** 用途：这张图拿去做什么。进提示词，决定信息层级。 */
    purpose: string;
    composition: string;
    lighting: string;
    color: string;
    lens: string;
    background: string;
    /** 文案位：留给排版的位置。模型只留空，不生成文字。 */
    copyZone: string;
    /** 排除项。 */
    negative: string;
};

export type EcommerceShotSet = {
    /** 拍法名。只用于展示和节点标题，不进提示词。 */
    name: string;
    /** 整组统一要求：只写一遍，会并进每一张的提示词。 */
    global: string;
    /** 清单本体，一行一张。 */
    shots: EcommerceShot[];
};

export function createEcommerceShot(title = "未命名", id = ""): EcommerceShot {
    return { id: id || `shot-${Math.random().toString(36).slice(2, 10)}`, title, purpose: "", composition: "", lighting: "", color: "", lens: "", background: "", copyZone: "", negative: "" };
}

export function createEcommerceShotSet(name = "未命名拍法"): EcommerceShotSet {
    return { name, global: "", shots: [] };
}

/** 拍法填得够不够。有一行填出构图、背景或光线就算可用。 */
export function ecommerceShotSetReady(set: EcommerceShotSet | undefined) {
    if (!set) return false;
    return set.shots.some((shot) => shot.composition.trim() || shot.background.trim() || shot.lighting.trim());
}

const SHOT_LABELS: { key: keyof Omit<EcommerceShot, "id" | "title">; label: string }[] = [
    { key: "purpose", label: "用途" },
    { key: "composition", label: "构图" },
    { key: "lighting", label: "光线" },
    { key: "color", label: "色彩" },
    { key: "lens", label: "镜头" },
    { key: "background", label: "背景" },
    { key: "copyZone", label: "文案位" },
    { key: "negative", label: "排除" },
];

/** 单行的提示词文本。空字段整段省略。 */
export function ecommerceShotLines(shot: EcommerceShot) {
    return SHOT_LABELS.filter(({ key }) => shot[key].trim()).map(({ key, label }) => `${label}：${shot[key].trim()}`);
}

/**
 * 拍法块。
 *
 * 传了 shotId 就只展开那一行——每张图拿到的是「整组统一 + 本张」，不是整张清单。
 * 把五行的要求全塞进一次生成，模型会试图在一张图里同时做到五件事，那是灾难。
 *
 * 没传 shotId 且清单只有一行时，那一行就是全部——单张主图走的就是这条路。
 * 清单多行又没指定行号时只输出整组统一：与其猜，不如不猜，卡片上会提示哪张图没认领。
 */
export function ecommerceShotSetBlock(set: EcommerceShotSet | undefined, shotId?: string) {
    if (!set) return "";
    const lines: string[] = [];
    if (set.global.trim()) lines.push(`整组统一：${set.global.trim()}`);
    const shot = shotId
        ? set.shots.find((item) => item.id === shotId)
        : set.shots.length === 1 ? set.shots[0] : undefined;
    if (shot) {
        const detail = ecommerceShotLines(shot);
        if (detail.length) lines.push(`本张（${shot.title.trim() || "未命名"}）：${detail.join("；")}`);
    }
    if (!lines.length) return "";
    return [`【拍摄方案】${set.name.trim() || "未命名拍法"}`, ...lines].join("\n");
}

/**
 * 卖点——一条可验证的商品主张。
 *
 * 卖点和商品档案分开：档案是"商品长什么样"，卖点是"凭什么买它"。
 * 依据字段是硬要求：没有依据的卖点会被模型编成假话（功效、销量、认证），
 * 所以缺依据的卖点在编译时会带上待核实标记，而不是悄悄混进提示词。
 */
export type EcommerceSellingPoint = {
    id: string;
    claim: string;
    evidence: string;
};

export function createEcommerceSellingPoint(claim = "", evidence = ""): EcommerceSellingPoint {
    return { id: `sp-${Math.random().toString(36).slice(2, 10)}`, claim, evidence };
}

/** 文案——图上要出现的文字。模型只负责留位，不负责写字。 */
export type EcommerceCopy = {
    headline: string;
    subhead: string;
    cta: string;
    price: string;
};

export function createEcommerceCopy(): EcommerceCopy {
    return { headline: "", subhead: "", cta: "", price: "" };
}

export function ecommerceCopyReady(copy: EcommerceCopy | undefined) {
    if (!copy) return false;
    return Boolean(copy.headline.trim() || copy.subhead.trim() || copy.cta.trim() || copy.price.trim());
}

/**
 * 风格——品牌视觉。跨整组图统一。
 *
 * 这是"拍法可以换、品牌不能换"的那一半：拍法决定怎么拍，风格决定看起来像谁。
 * 竞品里 Seedream 把它做成"风格锚点"（12 维特征、色相偏差 ≤3°），
 * 影策的做法更直接：色板 + 色调 + 气质 + 字体，逐字进每一张图的提示词。
 */
export type EcommerceStyle = {
    name: string;
    /** 品牌色板，十六进制。 */
    palette: string[];
    /** 色调：冷暖、饱和、明度倾向。 */
    tone: string;
    /** 气质：干净、克制、热烈…… */
    mood: string;
    /** 字体气质：决定文案位的排布观感。 */
    typography: string;
};

export function createEcommerceStyle(name = "未命名风格"): EcommerceStyle {
    return { name, palette: [], tone: "", mood: "", typography: "" };
}

export function ecommerceStyleReady(style: EcommerceStyle | undefined) {
    if (!style) return false;
    return Boolean(style.palette.length || style.tone.trim() || style.mood.trim() || style.typography.trim());
}

/** 编译器的全部输入。缺哪一块就整段省略，不输出空标题。 */
export type EcommercePromptSources = {
    profile?: EcommerceProductProfile;
    shotSet?: EcommerceShotSet;
    /** 这张图认领清单里的哪一行。来自产物节点上的 ecommerceShotId。 */
    shotId?: string;
    sellingPoints?: EcommerceSellingPoint[];
    copy?: EcommerceCopy;
    style?: EcommerceStyle;
    uniformPrompt?: string;
    styleReferenceNames?: string[];
    imageDrivenStyle?: boolean;
    /** 爆款复刻：参考图给结构。见 ecommerce-replica.ts。 */
    replica?: import("./ecommerce-replica").EcommerceReplica;
    /** 竞品拆解：别人的页面结构，只作参考不复述文案。见 ecommerce-teardown.ts。 */
    teardown?: import("./ecommerce-teardown").EcommerceTeardown;
    /**
     * 文案是否交给模型直接渲染。
     *
     * **电商画布里默认交给模型**——一条提示词里同时给画面和文字，模型一次画完。
     * 传 false 只在一种情况下有意义：文字必须逐字准确、错一个字就是事故
     * （价格、认证编号），那时改走本地按像素合成。
     */
    renderCopyText?: boolean;
    /** 模特库里的模特：锁住「图上的人是谁」。见 ecommerce-models.ts。 */
    model?: EcommerceModel;
};

export function ecommerceSellingPointsBlock(points: EcommerceSellingPoint[] | undefined) {
    const usable = (points || []).filter((point) => point.claim.trim());
    if (!usable.length) return "";
    const lines = usable.map((point) => {
        const evidence = point.evidence.trim();
        // 没依据的卖点要显式标记，让模型知道这是待核实的表述，不是可以展开的事实
        return evidence ? `- ${point.claim.trim()}（依据：${evidence}）` : `- ${point.claim.trim()}（尚未提供依据，不要展开成具体数据、功效或认证）`;
    });
    return ["【商品卖点】以下主张可以出现在画面信息里，不得编造未列出的卖点：", ...lines].join("\n");
}

/**
 * 文案块。
 *
 * renderText 决定模型是「画上去」还是「留出位置」：
 * - true（电商画布的默认）：文字与画面一起交给模型，一条提示词画完，不用二次合成
 * - false：模型只留位，文字由本地按像素叠——只在文字必须逐字准确时用
 *   （价格、认证编号，错一个字就是事故）
 */
export function ecommerceCopyBlock(copy: EcommerceCopy | undefined, renderText = true) {
    if (!copy) return "";
    const lines: string[] = [];
    if (copy.headline.trim()) lines.push(`标题：${copy.headline.trim()}`);
    if (copy.subhead.trim()) lines.push(`副文案：${copy.subhead.trim()}`);
    if (copy.cta.trim()) lines.push(`行动引导：${copy.cta.trim()}`);
    if (copy.price.trim()) lines.push(`价格：${copy.price.trim()}`);
    if (!lines.length) return "";
    return [
        renderText
            ? "【文案】以下文字要出现在画面上，逐字准确，不得改写、翻译或省略；字号要够大，手机端列表里也能读清："
            : "【文案】以下文字由排版环节添加，画面只需留出对应位置，不要自行生成任何文字：",
        ...lines,
    ].join("\n");
}

export function ecommerceStyleBlock(style: EcommerceStyle | undefined) {
    if (!style) return "";
    const lines: string[] = [];
    if (style.palette.length) lines.push(`品牌色板：${style.palette.join("、")}`);
    if (style.tone.trim()) lines.push(`色调：${style.tone.trim()}`);
    if (style.mood.trim()) lines.push(`气质：${style.mood.trim()}`);
    if (style.typography.trim()) lines.push(`字体气质：${style.typography.trim()}`);
    if (!lines.length) return "";
    return [
        `【品牌风格】${style.name.trim() || "未命名风格"}。整组图共用，保持统一：`,
        ...lines,
    ].join("\n");
}

export function ecommerceUniformBlock(prompt?: string, referenceNames: string[] = [], imageDriven = false) {
    if (!imageDriven && !prompt?.trim() && !referenceNames.length) return "";
    return [
        "【图片参考职责】商品身份与视觉参考分开处理：",
        "商品图用于确认形状、材质、颜色和标识，画面主体必须是本次商品，不得替换成视觉参考中的商品。",
        ...referenceNames.map((name) => `名为「${name}」的图是视觉参考：借鉴其光线、空间感、质感、配色关系与文字气质，不复制商品、标识和文案。`),
        prompt?.trim() ? `整组要求：${prompt.trim()}` : "未另行指定的风格跟随商品图与视觉参考，不套用固定色板或固定字体。",
        "各张构图可以不同，但整组的视觉语言保持一致；商品真实性优先于风格模仿。",
    ].join("\n");
}

/**
 * 把各块编译成最终提示词。
 *
 * 顺序固定，从硬到软：
 *   商品锁定（外观不可动）→ 模特锁定（人是谁）→ 复刻参考（结构从哪来）
 *   → 竞品参考（别人的页面顺序）→ 品牌风格（视觉统一）→ 商品卖点（信息依据）
 *   → 文案（文字留位）→ 拍摄方案（怎么拍）
 *
 * 模特锁定紧跟在商品锁定之后：这两块是同一类东西（不可动的身份），
 * 而且模特比复刻/风格更硬——风格可以换，人不能换。
 *
 * 复刻与竞品两块排在品牌风格前面，因为它们是「这一张参照什么」；风格是「我们长什么样」。
 * 参照在前、自我在后，模型才不会把参考图的调性当成自己的。
 *
 * 全部为空就返回空串——调用方据此拦住没有内容的生成。
 */
export function compileEcommercePrompt(sources: EcommercePromptSources) {
    return [
        ecommerceProductLockBlock(sources.profile),
        ecommerceModelLockBlock(sources.model),
        ecommerceReplicaBlock(sources.replica),
        ecommerceTeardownBlock(sources.teardown),
        ecommerceStyleBlock(sources.style),
        ecommerceUniformBlock(sources.uniformPrompt, sources.styleReferenceNames, sources.imageDrivenStyle),
        ecommerceSellingPointsBlock(sources.sellingPoints),
        ecommerceCopyBlock(sources.copy, sources.renderCopyText),
        ecommerceShotSetBlock(sources.shotSet, sources.shotId),
    ].filter(Boolean).join("\n\n");
}
