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
export type StudioStyleId = "mist" | "warm" | "noir" | "fresh" | "vivid";
/** 表单里的「出图类型」：单张类型按数量出图，套图类型按品类排好整组镜头；mix 是同时选了几种单张类型。 */
export type StudioOutputType = "main" | "white" | "scene" | "selling" | "closeup" | "model" | "angles" | "poster" | "main-set" | "detail-set" | "template-set" | "mix";
export type StudioMarket = "cn" | "hk-tw" | "sea" | "jp-kr" | "west" | "mena";
export type StudioLanguage = "zh" | "zh-hant" | "en" | "ja" | "ko" | "none";
export type StudioShooting = "auto" | "studio" | "lifestyle" | "model" | "hand" | "flatlay" | "macro";

export type StudioShotRole =
    | "main-white"
    | "main-selling"
    | "main-scene"
    | "main-detail"
    | "main-angle"
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
    attempts: StudioAttempt[];
    adopted?: StudioOutput;
};

/** 从模特库选中的一项。人脸和姿势带 resourceId（已复制到自己资源库的原图），模特样式只用文字。 */
export type StudioModelPick = { itemId: string; name: string; prompt: string; resourceId?: string; width?: number; height?: number };

/** 这个商品出模特图时用的模特设定：长相、姿势、造型各选一项，都可以不选。 */
export type StudioModelCast = { face?: StudioModelPick; pose?: StudioModelPick; style?: StudioModelPick };

/** 模板里的一张图。ratio 来自模板的画幅；noText 表示模板要求这张图不放文字。 */
export type StudioSuiteShot = { title: string; duty: string; ratio?: string; noText?: boolean };

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
};

/**
 * 生图表单的参数。品牌、商品类型和拍法这类描述写进提示词；数量、质量、比例决定提交几张、什么规格。
 * 核心标题存在 copy.headline，卖点与商品信息存在 sellerNotes，助手读写的是同一份。
 */
export type StudioBrief = {
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
    /** 质量或分辨率档位，取值随模型变化；空字符串表示用模型默认值。 */
    quality: string;
    /** "auto" 表示按出图类型和平台推荐。 */
    ratio: string;
    /** 出图类型为「模板套图」时选中的模板。 */
    suite?: StudioSuite;
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
    /** 模板套图：模板名与整套视觉规范，在点生成那一刻定下来。 */
    suite?: { id: string; name: string; style: string };
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
