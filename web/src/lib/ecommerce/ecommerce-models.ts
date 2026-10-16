/**
 * 电商模特库——「出这个商品的图上，人是谁」。
 *
 * 和角色卡的区别：角色卡是**短剧项目级**的（跟着一部剧走，带声纹与剧本定义），
 * 模特库是**用户级**的（跟着店铺走，跨画布复用）。一个电商设计师手上就那么几个
 * 常合作的模特，每上新一款都要用同一批人——这是「品牌视觉一致性」的一半。
 *
 * **模特就是图，不是一段文字。**
 *
 * 早期版本把模特写成一段外观描述（「亚洲女性，约 22 岁，身高 168cm……」），
 * 那是错的：描述写不全，模型也不会照描述画人。同一个人九屏不漂移，靠的是
 * **把同一批参考图每次都送进去**，不是靠把五官写成文字让模型重新画一遍。
 * 文字只留一句「按参考图，别美化」——那句话是给模型的护栏，不是模特本身。
 *
 * 所以一个模特 = 一个名字 + 一组参考图。用户上传一张图就能存成模特，
 * 画布上生成出来的图也能一键存进来。没有需要手填的性别、体型、年龄、姿势——
 * 这些要么在图上，要么该由参考图决定，不该由用户抄一遍。
 *
 * 公共模特库不再是人设文字，而是**十二个可以一键出参考图的起手式**：
 * 手上还没有模特实拍的人，先生成一张，再用它去锁后面所有的图。
 */
import type { EcommerceProductView } from "./ecommerce-contract";

export type EcommerceModelKind = "preset" | "custom";

export type EcommerceModel = {
    id: string;
    name: string;
    kind: EcommerceModelKind;
    /**
     * 参考图，存 storageKey。
     *
     * 第一张是主图。全部会作为参考图送进生成——多一张不同角度的图，
     * 模型就多一分「这是同一个人」的依据。
     *
     * 为什么必须是 storageKey：直传失败时会退回本机，那时 url 是个重启就失效的
     * blob URL；存它等于模特库过一夜全部变空白。
     */
    refs: string[];
    /** 适配品类标签，只用于筛选与显示，不进提示词。 */
    tags: string[];
    createdAt: string;
    lastUsedAt: string;
};

/**
 * 公共模特库的一个起手式。
 *
 * `brief` 只用来**生成第一张参考图**，之后再不参与商品图生成——
 * 它描述的是「要一个什么样的人」，不是「这个人长什么样」。
 * 这两件事的区别就是这个文件开头讲的那件事。
 */
export type EcommerceModelPreset = {
    id: string;
    name: string;
    /** 卡片上的一句话，说明这个起手式适合什么品类。 */
    hint: string;
    /** 生成参考图的提示词。 */
    brief: string;
    tags: string[];
};

/** 参考图统一按这个规格出：全身、正面、影棚白底——它定身高与身材比例。 */
export const ECOMMERCE_MODEL_REFERENCE_SUFFIX =
    "正面全身站姿，自然放松，双臂自然垂放不遮挡身体轮廓，影棚均匀柔光，纯白无缝背景，全身入画（头顶与脚底留出余量），高清写实摄影，不要任何文字、水印、logo、道具与背景装饰。";

export const ECOMMERCE_MODEL_PRESETS: EcommerceModelPreset[] = [
    {
        id: "preset-female-young-slim", name: "女装 · 青年纤细",
        hint: "女装、连衣裙、配饰",
        tags: ["女装", "连衣裙", "配饰"],
        brief: "亚洲女性，约 22 岁，纤细身材，鹅蛋脸，黑色中长发齐肩，自然裸妆，肤色偏冷调白皙，气质清新。",
    },
    {
        id: "preset-female-regular", name: "女装 · 通勤标准",
        hint: "通勤装、包袋、女装",
        tags: ["女装", "通勤装", "包袋"],
        brief: "亚洲女性，约 28 岁，标准身材，短发干练，淡妆，肤色自然暖调，气质干净利落。",
    },
    {
        id: "preset-female-mature", name: "女装 · 成熟知性",
        hint: "珠宝、家居、成熟女装",
        tags: ["女装", "珠宝", "家居"],
        brief: "亚洲女性，约 38 岁，标准身材，锁骨发，淡妆偏知性，肤色自然，面部有自然的成熟感，不磨皮成少女。",
    },
    {
        id: "preset-female-plus", name: "女装 · 丰满体型",
        hint: "大码女装、内衣",
        tags: ["大码女装", "内衣"],
        brief: "亚洲女性，约 30 岁，丰满身材，黑色长卷发，自然妆，肤色暖调，笑容亲和。",
    },
    {
        id: "preset-male-young-slim", name: "男装 · 青年清瘦",
        hint: "男装、鞋类",
        tags: ["男装", "鞋类"],
        brief: "亚洲男性，约 23 岁，清瘦身材，短发干净，肤色自然，气质清爽。",
    },
    {
        id: "preset-male-athletic", name: "男装 · 运动健硕",
        hint: "运动服、户外、男装",
        tags: ["运动服", "男装", "户外"],
        brief: "亚洲男性，约 26 岁，运动型身材，肩背肌肉线条明显，短发，肤色偏健康小麦色。",
    },
    {
        id: "preset-male-mature", name: "男装 · 成熟商务",
        hint: "商务男装、腕表",
        tags: ["男装", "商务", "腕表"],
        brief: "亚洲男性，约 40 岁，标准身材，短发略带灰白，面相沉稳，气质商务。",
    },
    {
        id: "preset-female-shoe", name: "鞋类 · 腿部特写",
        hint: "女鞋、袜类、裤装",
        tags: ["女鞋", "袜类", "裤装"],
        brief: "亚洲女性，约 24 岁，腿部修长、线条匀称，皮肤细腻无明显瑕疵，浅色系穿搭。只拍小腿以下入镜，全身其余部分不入画。",
    },
    {
        id: "preset-female-hand", name: "配饰 · 手部特写",
        hint: "珠宝、腕表、美妆",
        tags: ["珠宝", "腕表", "配饰", "美妆"],
        brief: "亚洲女性，约 25 岁，手指修长匀称，指甲修剪干净无长甲，手背皮肤细腻无青筋突出，腕围细。只拍手部与前臂入镜。",
    },
    {
        id: "preset-girl-kids", name: "童装 · 女孩",
        hint: "童装、儿童用品、文具",
        tags: ["童装", "儿童用品", "文具"],
        brief: "亚洲女孩，约 8 岁，儿童体型自然比例，不做成人化处理，齐肩短发或双马尾，表情自然不摆拍，肤色健康。",
    },
    {
        id: "preset-boy-kids", name: "童装 · 男孩",
        hint: "童装、儿童用品、运动",
        tags: ["童装", "儿童用品", "运动"],
        brief: "亚洲男孩，约 9 岁，儿童体型自然比例，短发，表情自然，动作放松，肤色健康。",
    },
    {
        id: "preset-hands-only", name: "无脸 · 只出手与身形",
        hint: "内衣、美妆、私护、食品",
        tags: ["内衣", "美妆", "私护", "食品"],
        brief: "不出现面部：只入镜手部、肩颈与躯干局部。手部皮肤自然，指甲修剪干净，服装合身。",
    },
];

export function createEcommerceModel(name = "新模特", refs: string[] = []): EcommerceModel {
    const now = new Date().toISOString();
    return {
        id: `model-${Math.random().toString(36).slice(2, 10)}`,
        name,
        kind: "custom",
        refs: [...refs],
        tags: [],
        createdAt: now,
        lastUsedAt: now,
    };
}

/** 公共起手式生成参考图用的完整提示词。 */
export function ecommerceModelPresetPrompt(preset: EcommerceModelPreset) {
    return `${preset.brief}${ECOMMERCE_MODEL_REFERENCE_SUFFIX}`;
}

export function ecommerceModelPresetById(id: string | undefined) {
    if (!id) return undefined;
    return ECOMMERCE_MODEL_PRESETS.find((preset) => preset.id === id);
}

export function ecommerceModelById(id: string | undefined, custom: EcommerceModel[]) {
    if (!id) return undefined;
    return custom.find((model) => model.id === id);
}

/**
 * 能不能用来锁人。
 *
 * 判据只有一条：有没有参考图。没有图就没有「同一个人」可言，
 * 名字再具体也没用——这正是旧版本把外观描述当判据时最大的问题。
 */
export function ecommerceModelReady(model: EcommerceModel | undefined) {
    return Boolean(model && model.refs.some((ref) => Boolean(ref)));
}

/** 参考图数量。卡片上那一行统计读它。 */
export function ecommerceModelRefCount(model: EcommerceModel | undefined) {
    return model ? model.refs.filter(Boolean).length : 0;
}

/**
 * 模特锁定块。
 *
 * 只有三句护栏，因为「人长什么样」已经由参考图说完了：
 * 1. 以参考图为准——这是本人；
 * 2. 一套图里必须是同一个人；
 * 3. 不许美化。模型默认会往「更好看」改（磨皮、瘦脸、拉腿），
 *    三次生成之后人就不是同一个人了，不写这句锁不住。
 */
export function ecommerceModelLockBlock(model: EcommerceModel | undefined, pose?: string) {
    if (!ecommerceModelReady(model)) return "";
    const value = model!;
    const lines = [
        `以随附的模特参考图为准：图上就是本人。五官比例、脸型、发型与发色、肤色、身高与身材比例，逐项照参考图，不做任何改动。`,
        "同一套图里的所有张必须是同一个人。",
        "不要美化轮廓、不要磨皮瘦脸、不要拉长腿部比例、不要换发型发色——三次生成之后人就不是同一个了。",
    ];
    if (pose?.trim()) lines.push(`姿势：${pose.trim()}`);
    return [`【模特锁定】${value.name}`, ...lines].join("\n");
}

/** 参考图按顺序返回，用于接成生成链路的参考图。 */
export function ecommerceModelRefs(model: EcommerceModel | undefined) {
    return model ? model.refs.filter(Boolean) : [];
}

/** 卡片封面：第一张参考图。 */
export function ecommerceModelCoverRef(model: EcommerceModel | undefined) {
    return model?.refs.find(Boolean);
}

// 商品视角与模特参考是两套概念（一个看物品的构造，一个看人的呈现），
// 这里显式声明不共用枚举，避免后来者误用。
export type EcommerceModelAngleIsNotProductView = EcommerceProductView extends never ? never : true;
