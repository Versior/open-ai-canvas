import type { EcommercePlatformId } from "@/lib/ecommerce/ecommerce-platform-specs";

/**
 * 电商生图台的数据模型。整份商品对象由前端定义、服务端按商品整体保存；
 * 图片一律以 resourceId 字段引用已上传资源，孤儿清理据此识别"仍被引用"。
 */
export const STUDIO_PRODUCT_SCHEMA = 1;

/** 证据等级：图片可见 / 合理推断 / 待确认 / 卖家已确认。只有可见与已确认能进入出图提示词。 */
export type StudioEvidence = "visible" | "inferred" | "pending" | "confirmed";
export type StudioPhotoView = "front" | "side" | "back" | "detail" | "tag" | "package" | "scene" | "other";
export type StudioCategoryFamily = "apparel" | "bags-shoes" | "jewelry" | "beauty" | "food" | "electronics" | "home" | "baby-toys" | "generic";
export type StudioFactGroup = "identity" | "appearance" | "material" | "structure" | "text" | "spec" | "usage" | "package";
export type StudioStep = "dossier" | "plan" | "generate" | "deliver";
export type StudioPlanKind = "main" | "detail";
/** model：模型直接把文字画进图里；overlay：模型只出留白底图，文字由程序排版。 */
export type StudioTextMode = "model" | "overlay";
/** 详情页一屏的版式：决定画面怎么分区、要点文字排成图标标签、引线标签还是参数行。 */
export type StudioDetailLayoutId = "poster" | "split" | "icons" | "callout" | "compare" | "grid" | "scene" | "data" | "spec" | "closing" | "pain" | "mechanism" | "ingredients" | "proof";
/** 构图骨架与内容版式分开：决定文字留白、主体位置和裁切。 */
export type StudioCompositionId = "left" | "right" | "top" | "bottom" | "center" | "corner";
/** 「调整这一张」里修改要求的字数上限。 */
export const STUDIO_SHOT_ADJUST_MAX = 200;
/** 质感预设；auto 表示按商品推荐：策划详情页时由策划挑，不策划时按品类挑。 */
export type StudioStylePresetId = "mist" | "warm" | "noir" | "fresh" | "vivid" | "pure" | "wood" | "cream" | "tech" | "oriental" | "luxe" | "sport" | "candy" | "organic" | "editorial";
export type StudioStyleId = StudioStylePresetId | "auto";
/** 表单里的「出图类型」：单张类型按数量出图，套图类型按品类排好整组镜头；mix 是同时选了几种单张类型。 */
export type StudioOutputType =
    "main" | "white" | "scene" | "selling" | "closeup" | "model" | "angles" | "poster" | "seeding" | "compare" | "steps" | "collocation" | "flatlay" | "campaign" | "ugc" | "size" | "spec" | "package" | "main-set" | "detail-set" | "template-set" | "mix";
export type StudioMarket = "cn" | "hk-tw" | "sea" | "jp-kr" | "west" | "mena";
export type StudioLanguage = "zh" | "zh-hant" | "en" | "ja" | "ko" | "none";
export type StudioShooting = "auto" | "studio" | "lifestyle" | "model" | "hand" | "flatlay" | "macro";

export type StudioShotRole =
    | "main-white"
    | "main-selling"
    | "main-scene"
    | "main-detail"
    | "main-angle"
    | "main-flatlay"
    | "detail-hero"
    | "detail-selling"
    | "detail-model"
    | "detail-scene"
    | "detail-material"
    | "detail-closeup"
    | "detail-angles"
    | "detail-spec"
    | "detail-size"
    | "detail-package"
    | "detail-seeding"
    | "detail-compare"
    | "detail-steps"
    | "detail-collocation"
    | "detail-campaign"
    | "detail-ugc"
    | "detail-closing";

export type StudioPhoto = {
    id: string;
    resourceId: string;
    url: string;
    view: StudioPhotoView;
    /** 外观真值图：出图时作为商品外观的唯一依据。 */
    truth: boolean;
    name?: string;
    width?: number;
    height?: number;
    addedAt: string;
};

export type StudioFact = {
    id: string;
    group: StudioFactGroup;
    label: string;
    value: string;
    evidence: StudioEvidence;
    /** 依据来源，如「图1」「吊牌」「卖家」。 */
    source?: string;
};

export type StudioDossier = {
    name: string;
    category: string;
    family: StudioCategoryFamily;
    summary: string;
    facts: StudioFact[];
    /** 出图时绝不能改动的外观要点。 */
    invariants: string[];
    /** 需要卖家确认的问题。 */
    questions: string[];
    recognizedAt?: string;
    recognizedWith?: string;
};

export type StudioSellingPoint = {
    id: string;
    title: string;
    detail: string;
    evidence: StudioEvidence;
    factIds: string[];
    enabled: boolean;
};

export type StudioCopy = {
    headline: string;
    subhead: string;
    listingTitle: string;
    bullets: string[];
};

export type StudioOutput = {
    resourceId: string;
    url: string;
    width?: number;
    height?: number;
};

export type StudioAttemptStatus = "submitting" | "queued" | "running" | "succeeded" | "failed" | "cancelled";

export type StudioAttempt = {
    id: string;
    taskId?: string;
    status: StudioAttemptStatus;
    model: string;
    tweaks: string[];
    createdAt: string;
    completedAt?: string;
    error?: string;
    outputs: StudioOutput[];
};

export type StudioShot = {
    id: string;
    role: StudioShotRole;
    title: string;
    ratio: string;
    headline: string;
    subline: string;
    /** 详情页卖点屏、参数屏等多行内容。 */
    lines: string[];
    sellingPointIds: string[];
    /** 微调标签，只影响这张图的镜头规格层。 */
    tweaks: string[];
    /** 模板套图里模板给这张图的职责；出图时优先于镜头规格的构图与光线。 */
    duty?: string;
    /** 详情页策划给这一屏写的目的与画面；有它时代替镜头规格的构图、光线和背景。 */
    visual?: string;
    /** 详情页策划给这一屏选的版式，决定要点文字怎么排（图标标签、引线标签等）。 */
    layout?: StudioDetailLayoutId;
    composition?: StudioCompositionId;
    /** 主标题上方的英文或编号小标题。 */
    eyebrow?: string;
    /** 用户在「调整这一张」里写的修改要求，只影响这一张。 */
    adjust?: string;
    attempts: StudioAttempt[];
    adopted?: StudioOutput;
};

/** 从模特库选中的一项。人脸、全身模特和姿势带 resourceId（已复制到自己资源库的原图），模特样式只用文字。 */
export type StudioModelPick = { itemId: string; name: string; prompt: string; resourceId?: string; width?: number; height?: number };

/** 这个商品出模特图时用的模特设定：人脸或全身模特（二选一）定是谁，姿势定动作，造型定妆发穿搭，都可以不选。 */
export type StudioModelCast = { face?: StudioModelPick; figure?: StudioModelPick; pose?: StudioModelPick; style?: StudioModelPick };

/** 模板里的一张图。ratio 来自模板的画幅；noText 表示模板要求这张图不放文字。 */
export type StudioSuiteShot = { title: string; duty: string; ratio?: string; noText?: boolean };

/**
 * 「详情页策划」给这件商品排的一屏。role 对到最接近的镜头规格（平台规则、模特设定沿用）；
 * visual 写到能直接出图，文案只用表单里的标题、卖点和已确认的事实。
 */
export type StudioPlannedScreen = {
    role: StudioShotRole;
    title: string;
    /** 这一屏要让买家明白什么。 */
    purpose: string;
    /** 具体画面：场景、商品摆放与角度、人物、道具、色调、光线和文字位置。 */
    visual: string;
    /** 版式：海报大字、图标卖点、引线标注、细节拼格等。 */
    layout: StudioDetailLayoutId;
    composition?: StudioCompositionId;
    /** 信息元素：几个图标各画什么、引线指向哪些部位、拼格每格放什么。 */
    elements: string;
    /** 主标题上方的英文或编号小标题，可以为空。 */
    eyebrow: string;
    headline: string;
    subline: string;
    lines: string[];
    /** 依据的事实名称，只用于展示。 */
    facts: string[];
    noText?: boolean;
};

/** 策划的范围：用户选定屏数的详情页、主图套图（5 张）、选中的几种单张图，或按选中的套图模板逐张策划。 */
export type StudioPlanScope = "detail" | "main" | "single" | "template";
/** 单张图策划时选中的类型和每种几张；选择变了策划就不再适用。 */
export type StudioPlanTarget = { type: StudioOutputType; count: number };
/** 设计调性：决定版面节奏、字体、文案语气和摄影，由策划按商品挑。 */
export type StudioDesignToneId = "global-minimal" | "editorial" | "oriental" | "lifestyle" | "tech" | "care" | "hot-seller" | "playful";
/** 出图策划：按商品与用户选定数量排的一组图。 */
export type StudioDetailPlan = {
    id: string;
    createdAt: string;
    /** 策划用的文本模型。 */
    model: string;
    /** 策划思路。 */
    summary: string;
    /** 整套视觉规范，出图时代替风格锁。 */
    style: string;
    /** 质感选「按商品推荐」时策划挑的质感预设。 */
    styleId?: StudioStylePresetId;
    /** 策划挑的设计调性。 */
    tone?: StudioDesignToneId;
    /** 差异化定位：这件商品和同类比凭什么不一样。 */
    positioning?: string;
    /** 创意主线：由定位推出的视觉主题，一个具体的世界或场景。 */
    concept?: string;
    /** 视觉元素库：从主题里取的几个能反复使用的元素，每张选用一两个。 */
    motifs?: string[];
    /** 从同类爆款套图和卖家给的参考图里借鉴了什么。 */
    inspiration?: string;
    /** 单张图策划：策划时选中的类型和数量。 */
    targets?: StudioPlanTarget[];
    /** 模板套图策划：按哪套模板排的；换了模板策划就不再适用。 */
    suiteId?: string;
    /** 详情页策划时用户选择的屏数；修改屏数后须重新策划。 */
    requestedScreens?: number;
    screens: StudioPlannedScreen[];
};

/**
 * 策划前补充：AI 按这件商品问卖家几个只有卖家知道的问题（真正的卖点、给谁用、在哪用、想要的感觉），
 * 选项是同类商品常见的候选，卖家勾选或写下的答案当作已确认的信息交给策划。
 */
export type StudioAsk = { id: string; question: string; options: string[]; multi: boolean; picked: string[]; note: string };
/** 视角方案：策划前给的几个不同方向（不同的买家视角或故事角度），卖家挑一个，策划按它排每一张。 */
export type StudioDirection = {
    id: string;
    /** 视角的名字，如「家长的安心」。 */
    angle: string;
    positioning: string;
    concept: string;
    tone?: StudioDesignToneId;
    /** 这个方向的色彩世界。 */
    palette: { name: string; hex: string }[];
    /** 首屏主标题示例。 */
    headline: string;
    /** 首屏画面一句话。 */
    visual: string;
    /** 适合谁、凭什么打动人。 */
    why: string;
};
/** 策划前的准备：卖家补充和视角方案，跟着商品走，详情页、主图和单张图的策划共用。 */
export type StudioPlanPrep = { asks: StudioAsk[]; askedAt?: string; directions: StudioDirection[]; directionsAt?: string; picked?: string };

/** 选中的套图模板快照：选中那一刻存进表单，之后后台改模板不影响已选的这一套。 */
export type StudioSuite = {
    id: string;
    name: string;
    /** admin：后台启用的模板；library：项目内置的 EcomGen 模板库。 */
    source: "admin" | "library";
    /** 主图类模板按主图规格出图，其余按详情页导出。 */
    kind: StudioPlanKind;
    category: string;
    /** 整套视觉规范，出图时代替风格锁。 */
    style: string;
    shots: StudioSuiteShot[];
};

export type StudioPlan = {
    id: string;
    kind: StudioPlanKind;
    createdAt: string;
    textMode: StudioTextMode;
    shots: StudioShot[];
    /** 表单历史记录的排字质感；导出时不随当前商品设置改变。 */
    styleId?: StudioStylePresetId;
    /** 程序排字沿用出图时的设计调性。 */
    tone?: StudioDesignToneId;
};

/**
 * 生图表单的参数。品牌、商品类型和拍法这类描述写进提示词；数量、质量、比例决定提交几张、什么规格。
 * 核心标题存在 copy.headline，卖点与商品信息存在 sellerNotes，助手读写的是同一份。
 */
export type StudioBrief = {
    /** 模型排字或在底图上程序排字，生成记录保存此选择。 */
    textMode?: StudioTextMode;
    brand: string;
    productType: string;
    outputType: StudioOutputType;
    /** 出图类型为 mix 时选中的单张类型（至少两种，按类型表的顺序）；数量是每种出几张。 */
    mix?: StudioOutputType[];
    market: StudioMarket;
    language: StudioLanguage;
    shooting: StudioShooting;
    audience: string;
    positioning: string;
    extra: string;
    /** 按参考图的版式出图（同款）；没有参考图时不生效。 */
    sameLayout: boolean;
    count: number;
    /** 详情页的总屏数，与单张类型的每种数量分别保存。 */
    detailScreens: number;
    /** 质量或分辨率档位，取值随模型变化；空字符串表示用模型默认值。 */
    quality: string;
    /** 清晰度档位（1k、2k、4k）：模型的质量和尺寸档位分开时才用；空字符串表示生图台默认（有 1K 用 1K）。 */
    resolution: string;
    /** "auto" 表示按出图类型和平台推荐；也可以是自定义的「宽:高」（各 1–99，长短边不超过 3:1）。 */
    ratio: string;
    /** 出图类型为「模板套图」时选中的模板。 */
    suite?: StudioSuite;
    /** 详情页按这件商品与所选屏数排好的策划；必须先有有效策划才能出图。 */
    detailPlan?: StudioDetailPlan;
    /** 主图套图的策划（5 张）；没有可用文本模型时允许按品类清单出。 */
    mainPlan?: StudioDetailPlan;
    /** 单张图的策划：只在选中的类型和数量与策划时一致时使用。 */
    singlePlan?: StudioDetailPlan;
    /** 模板套图的策划：模板定每张的顺序和职责，画面、版式和文案按这件商品排；只在选中的还是同一套模板时使用。 */
    templatePlan?: StudioDetailPlan;
    /** 写给策划的补充调整，每次策划和重新策划都带上。 */
    planNote?: string;
    /** 策划前的卖家补充和视角方案。 */
    prep?: StudioPlanPrep;
    /** 套图的镜头清单：调整后的顺序与这次不出的镜头。元素是镜头 key，内置套图为镜头角色，模板套图为 s 加序号。 */
    shotOrder: string[];
    shotSkip: string[];
    /** 模特设定：出模特图（上身效果、模特拍法）时使用。 */
    model?: StudioModelCast;
};

/** 点一次「生成商品图」产生的一组图。套图类型的镜头各不相同，单张类型是同一类图出多张。 */
export type StudioRun = {
    id: string;
    createdAt: string;
    type: StudioOutputType;
    /** 套图才有：决定导出长图与切片的方式。 */
    kind?: StudioPlanKind;
    textMode: StudioTextMode;
    quality: string;
    styleId?: StudioStylePresetId;
    /** 点生成那一刻的清晰度，重出这一组的图也按它。 */
    resolution?: string;
    /** 模板套图或策划：名字与整套视觉规范，在点生成那一刻定下来；策划另带设计调性和创意主线。 */
    suite?: { id: string; name: string; style: string; tone?: StudioDesignToneId; concept?: string; motifs?: string[] };
    shots: StudioShot[];
};

/** 助手交给页面的出图请求：只有用户在生图台确认后才会按镜头提交任务。 */
export type StudioGenerationRequest = {
    id: string;
    kind: StudioPlanKind;
    shotIds: string[];
    note?: string;
    source: "agent";
    createdAt: string;
};

export type StudioProduct = {
    lastAnalysisTaskId?: string;
    schema: number;
    id: string;
    /** 服务端维护的商品修订号，保存时按它比较交换；本地新建、尚未保存时为 0。 */
    revision: number;
    name: string;
    createdAt: string;
    updatedAt: string;
    platform: EcommercePlatformId;
    style: StudioStyleId;
    step: StudioStep;
    sellerNotes: string;
    photos: StudioPhoto[];
    /** 风格或版式参考图：只参考构图、配色和氛围，不作商品外观依据。 */
    references: StudioPhoto[];
    brief: StudioBrief;
    dossier?: StudioDossier;
    sellingPoints: StudioSellingPoint[];
    copy?: StudioCopy;
    /** 助手排的主图套图 / 详情页方案。 */
    plans: StudioPlan[];
    activePlan: StudioPlanKind;
    /** 表单生成的记录，新的在前。 */
    runs: StudioRun[];
    pendingGeneration?: StudioGenerationRequest;
};

export const STUDIO_EVIDENCE_LABEL: Record<StudioEvidence, string> = {
    visible: "图片可见",
    inferred: "合理推断",
    pending: "待确认",
    confirmed: "已确认",
};

export const STUDIO_VIEW_LABEL: Record<StudioPhotoView, string> = {
    front: "正面",
    side: "侧面",
    back: "背面",
    detail: "细节",
    tag: "吊牌",
    package: "包装",
    scene: "场景",
    other: "其他",
};

export const STUDIO_FACT_GROUP_LABEL: Record<StudioFactGroup, string> = {
    identity: "身份",
    appearance: "外观",
    material: "材质",
    structure: "结构",
    text: "文字与标识",
    spec: "参数",
    usage: "用途",
    package: "包装配件",
};

export const STUDIO_FAMILY_LABEL: Record<StudioCategoryFamily, string> = {
    apparel: "服装",
    "bags-shoes": "鞋包",
    jewelry: "珠宝配饰",
    beauty: "美妆个护",
    food: "食品饮料",
    electronics: "3C 数码",
    home: "家居家电",
    "baby-toys": "母婴玩具",
    generic: "通用",
};

/** 可以写进出图提示词和图上文案的事实。 */
export function studioFactUsable(fact: Pick<StudioFact, "evidence" | "value">) {
    return (fact.evidence === "visible" || fact.evidence === "confirmed") && fact.value.trim().length > 0;
}
