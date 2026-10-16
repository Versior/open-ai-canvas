/**
 * 电商交付物的行业标准结构。
 *
 * 这些不是我们编的：主图五张的构成、详情页九屏的顺序，都是行业里跑了很多年的固定套路
 * （淘宝/天猫美工工作规范、9 屏金字塔）。工具应该照搬行业结构，而不是自己发明一套
 * "单张主图 / 基础套图"这种听起来合理、用起来对不上活的分类。
 *
 * 一次上新要交的是**一整套**：主图五张 + 详情页八到十二屏 + 若干场景与 SKU 图。
 */

export type EcommerceDeliverableSlot = {
    id: string;
    /** 这一张在整套里的位置与职责，进节点标题 */
    title: string;
    /** 这一屏要解决什么——来自行业套路，不是我们想的 */
    duty: string;
    /** 用哪个拍法预设起手 */
    presetId: string;
};

export type EcommerceDeliverableSet = {
    id: string;
    name: string;
    hint: string;
    /**
     * 这一套产出的是图还是片。
     *
     * 视频在电商里已经和图片平级：淘宝主图视频权重高、审核不过就不展示；
     * 抖音商品视频是流量入口；亚马逊品牌备案后是「6 图 + 1 视频」。
     * 所以视频套件不是「图片套件的附属」，它有自己的节点类型与规格。
     */
    kind?: "image" | "video";
    /** 产物槽位 */
    slots: EcommerceDeliverableSlot[];
    /**
     * 一并铺的辅助节点。
     *
     * delivery 是这条链的终点：交付节点汇总上游、按平台校验、按命名规范出清单。
     * 只出一两张图时不铺它（那点量自己看就行），成规模的交付物才铺——
     * 十六张图散在画布上，人眼判断不了「这套齐了没有」。
     */
    extras?: ("style" | "sellingPoints" | "copy" | "layout" | "delivery" | "video")[];
};

/**
 * 主图五张的标准构成。
 *
 * 顺序是行业共识：第 1 张决定点击率（搜索页只展示这一张），主体要占画面七成以上、
 * 文字面积不超过一成；第 5 张部分类目强制白底，白底图还能被手淘"猜你喜欢"自动抓取。
 */
export const ECOMMERCE_MAIN_IMAGE_SET: EcommerceDeliverableSet = {
    id: "main-five",
    name: "主图 5 张",
    hint: "行业标准构成：核心展示 / 卖点 / 场景 / 细节 / 规格",
    slots: [
        { id: "main-1", title: "主图1 · 核心展示", duty: "搜索页只展示这一张，决定点击率；主体占画面七成以上，文字面积不超过一成", presetId: "studio-white" },
        { id: "main-2", title: "主图2 · 卖点结构", duty: "讲清功能与结构，配合卖点节点给出的主张", presetId: "selling-point" },
        { id: "main-3", title: "主图3 · 场景使用", duty: "让买家代入自己的使用场景", presetId: "lifestyle-home" },
        { id: "main-4", title: "主图4 · 细节放大", duty: "证明材质与工艺，打消「便宜货」疑虑", presetId: "macro-material" },
        { id: "main-5", title: "主图5 · 规格包装", duty: "交代规格、包装与服务；部分类目第 5 张强制纯白底", presetId: "flat-lay" },
    ],
    extras: ["sellingPoints", "copy"],
};

/**
 * 详情页九屏金字塔。
 *
 * 顺序不能乱：先共情痛点，再给量化利益，然后才是卖点与参数。加信任背书后
 * 加购率平均提升 15–25%。超过 14 屏跳出率明显上升，所以默认铺 9 屏。
 */
export const ECOMMERCE_DETAIL_PAGE_SET: EcommerceDeliverableSet = {
    id: "detail-nine",
    name: "详情页 9 屏",
    hint: "痛点 → 利益 → 信任 → 卖点 → 场景 → 评价 → 参数 → 售后",
    slots: [
        { id: "detail-1", title: "详情01 · 痛点共情", duty: "首屏海报，说出买家正在遇到的问题", presetId: "promo-keyvisual" },
        { id: "detail-2", title: "详情02 · 利益承诺", duty: "把卖点翻成买家能得到什么，要量化（如「保温 12 小时」）", presetId: "selling-point" },
        { id: "detail-3", title: "详情03 · 信任背书", duty: "检测报告、认证、销量；档案里没有就改写工艺与用料的可见之处，不要写「暂无」", presetId: "spec-compare" },
        { id: "detail-4", title: "详情04 · 核心卖点", duty: "最强的那一条，占最大版面", presetId: "selling-point" },
        { id: "detail-5", title: "详情05 · 次强卖点", duty: "第二条与第三条卖点合并展示", presetId: "selling-point" },
        { id: "detail-6", title: "详情06 · 使用场景", duty: "在真实生活里用起来的样子", presetId: "in-use" },
        { id: "detail-7", title: "详情07 · 细节工艺", duty: "放大材质与做工，建立品质感", presetId: "macro-craft" },
        { id: "detail-8", title: "详情08 · 参数规格", duty: "尺寸、容量、材质、型号，一项不编", presetId: "size-guide" },
        { id: "detail-9", title: "详情09 · 售后保障", duty: "退换、质保、服务承诺；承诺必须真实可履行", presetId: "studio-grey" },
    ],
    extras: ["style", "sellingPoints", "copy", "layout", "delivery"],
};

/**
 * 整套上新物料——主图 + 详情页 + 场景与模特。
 *
 * 单独定义一次，因为它在两处被引用（常用组合与全部可选）。之前写成两份，
 * 改一份忘一份就会让「常用」和「全部」里的同一套东西悄悄不一样。
 */
export const ECOMMERCE_FULL_LISTING_SET: EcommerceDeliverableSet = {
    id: "full-listing",
    name: "整套上新物料",
    hint: "主图 5 张 + 详情页 9 屏 + 场景与模特图",
    slots: [
        ...ECOMMERCE_MAIN_IMAGE_SET.slots,
        ...ECOMMERCE_DETAIL_PAGE_SET.slots,
        { id: "extra-model", title: "模特图", duty: "服饰与配件的上身效果", presetId: "model-wearing" },
        { id: "extra-outdoor", title: "场景图 · 户外", duty: "第二套使用场景，用于推广位", presetId: "lifestyle-outdoor" },
    ],
    extras: ["style", "sellingPoints", "copy", "layout", "delivery"],
};

/** 常用组合：只出主图、只出详情页、整套物料。 */
export const ECOMMERCE_DELIVERABLE_SETS: EcommerceDeliverableSet[] = [
    ECOMMERCE_MAIN_IMAGE_SET,
    ECOMMERCE_DETAIL_PAGE_SET,
    ECOMMERCE_FULL_LISTING_SET,
];

/**
 * 种草图套图——发在小红书、抖音的内容图。
 *
 * 和主图是**相反**的两件事：主图求「精致 + 信息密度」，用户带着购买意图来搜；
 * 种草图求「真实感 + 场景感」，用户是在刷内容。产品太突出、太像广告，就被划走。
 *
 * 所以这一套的拍法全部是「不像拍出来的」：桌面随手拍、对镜自拍、外出打卡。
 * 封面按小红书规范：3:4、文字 10–20 字、避开底部 15%（会被标题遮）。
 */
export const ECOMMERCE_SEED_CONTENT_SET: EcommerceDeliverableSet = {
    id: "seed-content",
    name: "种草图 4 张",
    hint: "小红书 / 抖音图文：封面 + 场景 + 穿搭 + 细节，求真实感不求精致",
    slots: [
        { id: "seed-1", title: "种草01 · 封面", duty: "决定点不点开；画面要像用户随手拍的，标题区留大，商品不占满", presetId: "plog-desk" },
        { id: "seed-2", title: "种草02 · 使用场景", duty: "让刷到的人代入自己的生活；要有人的痕迹，不摆拍", presetId: "checkin" },
        { id: "seed-3", title: "种草03 · 上身或手持", duty: "建立尺度感与真实感；手部或人物入镜是「真有人用」的证据", presetId: "ootd" },
        { id: "seed-4", title: "种草04 · 细节", duty: "证明东西不廉价；细节图也要是随手拍的角度，不能变成产品图", presetId: "macro-material" },
    ],
    extras: ["copy"],
};

/**
 * 买家秀套图——评价区与详情页的「真实晒单」。
 *
 * 主流 AI 工具全在卷「更精致」，没人卷「更像买家随手拍」。但评价配图是转化率最高的一屏，
 * 而它要的恰恰是不精致：室内灯光、色温偏黄、桌面有杂物、包装盒还在旁边。
 */
export const ECOMMERCE_UGC_SET: EcommerceDeliverableSet = {
    id: "buyer-show",
    name: "买家秀 3 张",
    hint: "评价区与详情页的晒单图，求「不像广告」不求好看",
    slots: [
        { id: "ugc-1", title: "买家秀01 · 到手", duty: "开箱瞬间，包装还在旁边；这是评价区最常被点开的一张", presetId: "unboxing" },
        { id: "ugc-2", title: "买家秀02 · 在用", duty: "正在使用的样子，动作自然；不要摆拍角度", presetId: "in-use" },
        { id: "ugc-3", title: "买家秀03 · 随手放", duty: "商品在家里随手一放的样子，环境要真实可辨", presetId: "buyer-show" },
    ],
};

/**
 * 信息图套图——唯一必须用真实文字的那一套。
 *
 * 通用 AI 生图工具一律不做这个（扩散模型渲染文字不可靠），市场靠专门的合成器解决。
 * 这一套的产物图由生成链路出底图（画面里明确不要任何文字），标注、引线、规格表
 * 由信息图节点在浏览器里按真实字体合成。
 */
export const ECOMMERCE_INFOGRAPHIC_SET: EcommerceDeliverableSet = {
    id: "infographic",
    name: "信息图 5 张",
    hint: "卖点标注 / 尺寸 / 材质 / 对比 / 参数表——文字逐字进提示词，错不起时走本地合成",
    slots: [
        { id: "info-1", title: "信息图01 · 卖点标注", duty: "引线指向商品各部位，一处一句话；最多 5 条，超过就没人看", presetId: "info-feature" },
        { id: "info-2", title: "信息图02 · 尺寸标注", duty: "长宽高与容量；正视角，透视会让尺寸判断出错", presetId: "info-dimension" },
        { id: "info-3", title: "信息图03 · 材质分解", duty: "把商品拆成几层，每层标注材质与作用", presetId: "info-material" },
        { id: "info-4", title: "信息图04 · 规格对比", duty: "多规格并排；只讲自己的规格，点名竞品算不正当竞争", presetId: "spec-compare" },
        { id: "info-5", title: "信息图05 · 参数表", duty: "参数密集的 3C 与家电用；数字必须来自实测或官方参数，模型不会替你核对", presetId: "info-specs" },
    ],
    extras: ["sellingPoints"],
};

/**
 * 海外 listing 七图位——照着 Amazon 的图位逻辑排。
 *
 * 顺序是平台规范决定的：第 1 位纯白 + 主体 85% + 零文字，第 2–7 位才是场景、
 * 卖点、尺寸、细节、对比、包装。品牌备案后是 6 图 + 1 视频。
 *
 * 主体占比 85% 是亚马逊独有的硬线，比国内任何平台都高——所以第 1 张的拍法
 * 单独用海外白底，不能用国内的白底棚拍顶。
 */
export const ECOMMERCE_OVERSEAS_LISTING_SET: EcommerceDeliverableSet = {
    id: "overseas-listing",
    name: "海外 Listing 7 图位",
    hint: "Amazon / Walmart：白底主图 + 场景 + 卖点 + 尺寸 + 细节 + 对比 + 包装",
    slots: [
        { id: "amz-1", title: "图位1 · 白底主图", duty: "纯白 RGB(255,255,255)，主体占 85% 以上，零文字零道具；决定能否上架", presetId: "studio-white" },
        { id: "amz-2", title: "图位2 · 生活场景", duty: "商品在目标市场真实使用环境里，符合当地居住与使用习惯", presetId: "overseas-lifestyle" },
        { id: "amz-3", title: "图位3 · 卖点信息", duty: "讲清核心功能；标注走信息图节点合成，底图不要带文字", presetId: "info-feature" },
        { id: "amz-4", title: "图位4 · 尺寸比例", duty: "尺寸与比例，降低退货；正视角避免透视误判", presetId: "info-dimension" },
        { id: "amz-5", title: "图位5 · 细节特写", duty: "证明材质与工艺，打消「便宜货」疑虑", presetId: "macro-material" },
        { id: "amz-6", title: "图位6 · 规格对比", duty: "多规格并排；不点名竞品", presetId: "spec-compare" },
        { id: "amz-7", title: "图位7 · 包装内容", duty: "列出到手的所有东西，减少「和描述不符」的退货", presetId: "flat-lay" },
    ],
    extras: ["style", "sellingPoints", "delivery"],
};

/**
 * 主图视频——挂在商品主图位的短视频。
 *
 * 淘宝的规则决定了这一套的形态：比例只能 3:4 / 1:1 / 16:9（**9:16 上传后商详不展示**），
 * 建议 15 秒，前 3 个且比例为 1:1 或 3:4 且审核通过才进详情页。
 *
 * 素材是现成的——一套图已经出好了，视频要做的不是从零生成，而是**把图排成片**。
 * 所以这套铺出来的是镜头（图片节点），再接一个电商视频节点做编排。
 */
export const ECOMMERCE_MAIN_VIDEO_SET: EcommerceDeliverableSet = {
    id: "main-video",
    kind: "image",
    name: "主图视频 4 镜",
    hint: "15 秒讲清一件商品：全貌 → 卖点 → 细节 → 场景，最后接电商视频节点成片",
    slots: [
        { id: "mv-1", title: "镜1 · 全貌", duty: "开场两秒定调；商品完整入画，缓慢推近，让观众先看清是什么", presetId: "studio-grey" },
        { id: "mv-2", title: "镜2 · 卖点", duty: "讲最强的那一条卖点；画面留出字幕位，但不要把字画进去", presetId: "info-feature" },
        { id: "mv-3", title: "镜3 · 细节", duty: "放大材质与工艺，证明东西不廉价", presetId: "macro-craft" },
        { id: "mv-4", title: "镜4 · 场景", duty: "在真实使用场景里收尾，让观众代入自己的生活", presetId: "lifestyle-home" },
    ],
    extras: ["sellingPoints", "video"],
};

/**
 * 轮播视频——几张主图合成轮播，抖音商品卡的「一键制作」就是这种。
 *
 * 这是最省力的一档：主图已经出好了，轮播只是把它们按时长串起来。
 * 抖音商品卡支持关联 3–5 张主图自动合成，所以这一套只需要 5 张图 + 一个视频节点。
 */
export const ECOMMERCE_CAROUSEL_VIDEO_SET: EcommerceDeliverableSet = {
    id: "carousel-video",
    kind: "image",
    name: "轮播视频 5 图",
    hint: "5 张主图串成轮播，每张停 2–3 秒；抖音商品卡一键制作的形态",
    slots: [
        { id: "cv-1", title: "轮播1 · 白底主图", duty: "第一帧决定划不划走；纯白底、主体占七成以上", presetId: "studio-white" },
        { id: "cv-2", title: "轮播2 · 卖点", duty: "一句话讲清凭什么买它", presetId: "selling-point" },
        { id: "cv-3", title: "轮播3 · 细节", duty: "材质与做工，建立品质感", presetId: "macro-material" },
        { id: "cv-4", title: "轮播4 · 场景", duty: "在真实场景里用起来的样子", presetId: "in-use" },
        { id: "cv-5", title: "轮播5 · 规格", duty: "交代规格与包装，减少「和描述不符」的退货", presetId: "flat-lay" },
    ],
    extras: ["copy", "video"],
};

/**
 * 模特上身套图——服饰、配饰、鞋包最吃的一套。
 *
 * 和主图是两件事：主图求「商品本身看得清」，上身图求「穿在人身上什么样」。
 * 买家在服饰类目上最大的疑问是「我穿上是不是这样」，主图回答不了这个问题。
 *
 * 顺序按买家的核对顺序排：先看整体版型（正面全身），再看上身局部（半身），
 * 最后看背面——背面是退换货率最高的一屏，很多人买回来才发现背面不合身。
 */
export const ECOMMERCE_MODEL_WEARING_SET: EcommerceDeliverableSet = {
    id: "model-wearing",
    name: "模特上身 3 张",
    hint: "正面全身 / 半身细节 / 背面，回答「穿在我身上是什么样」",
    slots: [
        { id: "wear-1", title: "上身01 · 正面全身", duty: "整体版型与比例，买家判断合不合身的第一张", presetId: "model-wearing" },
        { id: "wear-2", title: "上身02 · 半身细节", duty: "领口、肩线、面料垂坠——上身之后才看得出的东西", presetId: "ootd" },
        { id: "wear-3", title: "上身03 · 背面", duty: "背面版型与结构；这一屏是退换货率最高的一屏", presetId: "model-wearing" },
    ],
    extras: [],
};

/** 全部可选交付物，按「一次交多少活」分组。 */
export const ECOMMERCE_ALL_DELIVERABLE_SETS: EcommerceDeliverableSet[] = [
    ECOMMERCE_MAIN_IMAGE_SET,
    ECOMMERCE_DETAIL_PAGE_SET,
    ECOMMERCE_MODEL_WEARING_SET,
    ECOMMERCE_SEED_CONTENT_SET,
    ECOMMERCE_UGC_SET,
    ECOMMERCE_INFOGRAPHIC_SET,
    ECOMMERCE_OVERSEAS_LISTING_SET,
    ECOMMERCE_MAIN_VIDEO_SET,
    ECOMMERCE_CAROUSEL_VIDEO_SET,
    ECOMMERCE_FULL_LISTING_SET,
];

export function ecommerceDeliverableSet(id: string) {
    return ECOMMERCE_ALL_DELIVERABLE_SETS.find((set) => set.id === id) || ECOMMERCE_DELIVERABLE_SETS.find((set) => set.id === id);
}

/** 轻量起手：只要一张时用它。单张不是"小号的一整套"，就是一张。 */
export const ECOMMERCE_SINGLE_SLOT: EcommerceDeliverableSet = {
    id: "single",
    name: "单张主图",
    hint: "只要一张，最轻",
    slots: [{ id: "single-1", title: "主图", duty: "单张起手，之后可以随时补成整套", presetId: "studio-white" }],
};
