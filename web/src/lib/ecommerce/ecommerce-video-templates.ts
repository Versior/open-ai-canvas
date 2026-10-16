/**
 * 爆款视频模板库——八种跑通的带货视频结构。
 *
 * 调研里美图的爆款视频给了 8 种模板（UGC种草 / 带货短剧 / 产品演示 / 产品口播 /
 * TVC广告 / 痛点解决 / 开箱种草 / 反应展示），这是行业里沉淀最完整的一份清单。
 *
 * 这里把它们做成**分镜骨架**而不是「风格标签」：每种模板给出一段段的结构
 * （第几秒做什么、建议时长、这一段解决什么），点一下就铺成镜头表。
 *
 * 为什么必须是骨架而不是标签：视频的成败在结构。同一个商品用「痛点解决」
 * 和用「开箱种草」拍，是两条完全不同的片子——前者先共情再给方案，
 * 后者先给悬念再揭晓。只给一个「痛点风格」的标签，模型不知道先讲什么。
 */

import type { EcommerceVideoKind, EcommerceVideoPlatform } from "./ecommerce-video";

export type EcommerceVideoTemplateId =
    | "ugc"
    | "short-drama"
    | "demo"
    | "talking-head"
    | "tvc"
    | "pain-point"
    | "unboxing"
    | "reaction";

/** 分镜骨架里的一段。 */
export type EcommerceVideoBeat = {
    label: string;
    /** 建议秒数。 */
    seconds: number;
    /** 这一段解决什么。进字幕与提示词。 */
    purpose: string;
    /** 这一段的运镜。 */
    motion: "still" | "push" | "pull" | "pan-left" | "pan-right" | "tilt-up";
};

export type EcommerceVideoTemplate = {
    id: EcommerceVideoTemplateId;
    name: string;
    hint: string;
    /** 适合的投放平台。 */
    platforms: EcommerceVideoPlatform[];
    /** 对应的片子类型，用于铺节点时同步 kind。 */
    kind: EcommerceVideoKind;
    /** 对素材的要求——不满足就拍不出这个结构。 */
    needs: string;
    /** 结构说明：这个模板靠什么起作用。 */
    logic: string;
    beats: EcommerceVideoBeat[];
};

export const ECOMMERCE_VIDEO_TEMPLATES: EcommerceVideoTemplate[] = [
    {
        id: "pain-point", name: "痛点解决", kind: "main", platforms: ["taobao", "douyin", "jd"],
        hint: "先说出买家正在遇到的问题，再给方案。转化最直接的一种",
        needs: "商品 + 一个能演出来的痛点场景",
        logic: "先共情再给方案：买家在第三秒前认出「这说的就是我」，后面才有耐心看你怎么解决。直接讲卖点会被划走",
        beats: [
            { label: "痛点", seconds: 3, purpose: "说出买家正在遇到的问题，不要提商品", motion: "push" },
            { label: "转折", seconds: 2, purpose: "商品出现，作为问题的答案", motion: "still" },
            { label: "解决", seconds: 4, purpose: "展示它怎么解决问题，给一个可验证的细节", motion: "push" },
            { label: "结果", seconds: 3, purpose: "解决后的状态，让买家代入", motion: "still" },
            { label: "收尾", seconds: 2, purpose: "规格或价格收尾，不要喊口号", motion: "pull" },
        ],
    },
    {
        id: "unboxing", name: "开箱种草", kind: "main", platforms: ["taobao", "douyin"],
        hint: "从包装到第一眼，真实感优先。买家最想看「到手是什么样」",
        needs: "包装完好 + 商品实拍",
        logic: "开箱解决的是「到手会不会和图片不一样」这个最大的下单顾虑。所以画面必须朴素——一精致就变成广告，信任感反而没了",
        beats: [
            { label: "快递到手", seconds: 2, purpose: "包装完整入画，建立真实感", motion: "pull" },
            { label: "开盒", seconds: 3, purpose: "开盒瞬间，动作自然不摆拍", motion: "still" },
            { label: "第一眼", seconds: 3, purpose: "商品取出的第一眼，不要立刻精修", motion: "push" },
            { label: "上手", seconds: 4, purpose: "手部交互，建立尺度感", motion: "still" },
            { label: "细节", seconds: 3, purpose: "材质与做工的特写", motion: "push" },
        ],
    },
    {
        id: "demo", name: "产品演示", kind: "demo", platforms: ["taobao", "jd", "amazon"],
        hint: "把功能一个个演出来，不靠说。降低「买回来不会用」的退货",
        needs: "商品 + 可演示的功能点",
        logic: "演示比描述可信：一个能看见的动作胜过三句卖点文案。而且它同时降低了退货率——买家知道怎么用，就不会因为不会用而退",
        beats: [
            { label: "全貌", seconds: 2, purpose: "商品完整入画，交代是什么", motion: "push" },
            { label: "功能一", seconds: 4, purpose: "演示最主要的一个功能，动作要慢", motion: "still" },
            { label: "功能二", seconds: 4, purpose: "演示第二个功能，机位换一个角度", motion: "push" },
            { label: "场景", seconds: 3, purpose: "在真实使用场景里用一次", motion: "still" },
            { label: "收尾", seconds: 2, purpose: "规格收尾", motion: "pull" },
        ],
    },
    {
        id: "talking-head", name: "产品口播", kind: "selling", platforms: ["taobao", "douyin"],
        hint: "有人对着镜头讲。适合有明确卖点、需要解释的商品",
        needs: "出镜的人 + 商品 + 口播稿",
        logic: "口播的信任来自「有人在为它背书」。但口播视频最忌讳念参数——观众记不住数字，只记得住「他自己也在用」",
        beats: [
            { label: "开场钩子", seconds: 3, purpose: "一句话说清为什么值得看下去，不要自我介绍", motion: "still" },
            { label: "商品出现", seconds: 2, purpose: "把商品拿到画面里", motion: "push" },
            { label: "核心卖点", seconds: 5, purpose: "只讲一个卖点，讲透", motion: "still" },
            { label: "补充证据", seconds: 4, purpose: "拿出依据：检测报告、实测对比、上手感受", motion: "push" },
            { label: "收尾", seconds: 2, purpose: "给一个明确的下一步", motion: "still" },
        ],
    },
    {
        id: "ugc", name: "UGC 种草", kind: "seed", platforms: ["douyin"],
        hint: "像用户随手拍的分享，求真实感不求精致",
        needs: "生活场景 + 手部或人物入镜",
        logic: "UGC 的全部价值在「不像广告」。产品太突出、画面太精致，观众一眼识别为推广就划走。所以构图要随意、光线要自然、可以有生活痕迹",
        beats: [
            { label: "场景", seconds: 3, purpose: "先给生活场景，不要先给商品", motion: "still" },
            { label: "拿出来", seconds: 2, purpose: "自然地从桌上或包里拿出来", motion: "push" },
            { label: "在用", seconds: 5, purpose: "正在使用的样子，动作随意", motion: "still" },
            { label: "感受", seconds: 4, purpose: "一个具体的、不夸张的使用感受", motion: "push" },
            { label: "随手放", seconds: 2, purpose: "随手放下，画面收在生活里", motion: "still" },
        ],
    },
    {
        id: "reaction", name: "反应展示", kind: "seed", platforms: ["douyin"],
        hint: "先给反应再给商品。悬念驱动的短平快",
        needs: "出镜的人 + 商品",
        logic: "人对「别人正在惊讶」的画面有天然的好奇。先给反应、后揭晓商品，能把前两秒的留存拉起来——而前两秒决定这条视频有没有下一轮推荐",
        beats: [
            { label: "反应", seconds: 2, purpose: "先给反应，不要露商品", motion: "still" },
            { label: "揭晓", seconds: 3, purpose: "商品入画，把悬念落地", motion: "push" },
            { label: "上手体验", seconds: 5, purpose: "真实的体验过程，可以有意外的小细节", motion: "still" },
            { label: "结论", seconds: 3, purpose: "一句话结论，不要喊口号", motion: "push" },
        ],
    },
    {
        id: "short-drama", name: "带货短剧", kind: "seed", platforms: ["douyin"],
        hint: "有情节的短片，商品是剧情的一部分",
        needs: "演员 + 场景 + 剧本",
        logic: "短剧把商品藏进情节里，观众为了看故事留下来，商品作为情节的必需品出现。最难也最贵，但爆的时候天花板最高",
        beats: [
            { label: "情境", seconds: 4, purpose: "建立人物与困境，不要提商品", motion: "still" },
            { label: "冲突", seconds: 4, purpose: "困境升级，让观众想知道怎么办", motion: "push" },
            { label: "商品介入", seconds: 4, purpose: "商品作为解决办法出现，要自然", motion: "still" },
            { label: "解决", seconds: 4, purpose: "问题被解决，人物状态变化", motion: "push" },
            { label: "收尾", seconds: 2, purpose: "回到商品，一句话", motion: "pull" },
        ],
    },
    {
        id: "tvc", name: "TVC 广告", kind: "main", platforms: ["taobao", "jd", "amazon"],
        hint: "品牌质感广告。慢、干净、留白多",
        needs: "高质量素材 + 品牌视觉规范",
        logic: "TVC 不卖货，卖质感。所以它和前面七种的结构正好相反：不留钩子、不喊卖点、节奏慢——用画面的完成度说话",
        beats: [
            { label: "氛围开场", seconds: 3, purpose: "用光线与材质开场，不露商品全貌", motion: "push" },
            { label: "商品登场", seconds: 4, purpose: "商品完整入画，缓慢运动", motion: "pull" },
            { label: "细节", seconds: 4, purpose: "材质与工艺特写，节奏要慢", motion: "push" },
            { label: "场景", seconds: 4, purpose: "在符合品牌调性的场景里出现", motion: "still" },
            { label: "落版", seconds: 3, purpose: "商品定格，留出品牌标识位", motion: "still" },
        ],
    },
];

export function ecommerceVideoTemplate(id: EcommerceVideoTemplateId) {
    return ECOMMERCE_VIDEO_TEMPLATES.find((template) => template.id === id);
}

/** 按平台筛可用模板——UGC 与短剧是 9:16 的形态，放淘宝没意义。 */
export function ecommerceVideoTemplatesForPlatform(platform: EcommerceVideoPlatform) {
    return ECOMMERCE_VIDEO_TEMPLATES.filter((template) => template.platforms.includes(platform));
}

export function ecommerceVideoTemplateSeconds(template: EcommerceVideoTemplate) {
    return template.beats.reduce((total, beat) => total + beat.seconds, 0);
}

/**
 * 把模板压进平台时长上限。
 *
 * 和从一套图铺镜头一样，超上限按比例压而不砍段落——砍掉「收尾」会让片子
 * 断在半空，砍掉「痛点」会让整条逻辑垮掉。段落结构是模板的全部价值。
 */
export function ecommerceVideoTemplateBeats(template: EcommerceVideoTemplate, platform: EcommerceVideoPlatform, maxSeconds: number): EcommerceVideoBeat[] {
    const total = ecommerceVideoTemplateSeconds(template);
    if (total <= maxSeconds) return template.beats;
    const scale = maxSeconds / total;
    return template.beats.map((beat) => ({ ...beat, seconds: Math.max(1, Math.round(beat.seconds * scale * 10) / 10) }));
}
