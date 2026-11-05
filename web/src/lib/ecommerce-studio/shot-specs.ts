import type { EcommerceImageRole } from "@/lib/ecommerce/ecommerce-platform-specs";
import { studioPromptOverride, studioPromptText } from "./prompt-overrides";
import type { StudioBrief, StudioCategoryFamily, StudioPlanKind, StudioProduct, StudioShotRole, StudioStyleId, StudioStylePresetId } from "./types";

/**
 * 镜头规格：每种图承担一个目标，并写清"怎么拍"——构图占比、机位焦段、具名布光、布景上限。
 * 这是提示词质量的主要来源；风格锁、品类规则和平台规则在编译时叠加。
 */
export type StudioCopySlot = "none" | "headline" | "headline-subline" | "points";

/** 程序排字的文字区，坐标是占画布宽高的比例。 */
export type StudioTextZone = { x: number; y: number; width: number; height: number; align: "left" | "center"; vAlign: "top" | "center" | "bottom" };

export type StudioShotSpec = {
    role: StudioShotRole;
    title: string;
    purpose: string;
    platformRole: EcommerceImageRole;
    composition: string;
    camera: string;
    lighting: string;
    set: string;
    copySlot: StudioCopySlot;
    /** 给模型看的文字区描述。 */
    textZone?: string;
    overlayZone?: StudioTextZone;
    avoid: string[];
    /** 白底这类图不叠加风格锁的背景色。 */
    neutralBackground?: boolean;
    familyOverrides?: Partial<Record<StudioCategoryFamily, Partial<Pick<StudioShotSpec, "title" | "purpose" | "composition" | "set" | "avoid">>>>;
};

const SHOT_SPECS: Record<StudioShotRole, StudioShotSpec> = {
    "main-white": {
        role: "main-white",
        title: "白底主图",
        purpose: "平台搜索列表里的第一张图：一眼认出商品，缩成小图也清楚。",
        platformRole: "white",
        composition: "商品完整居中，四周留出均匀的呼吸空间，主体约占画面 80%；以略带四分之三角度的正面呈现，让正面和一个侧面同时可见。",
        camera: "机位与商品中心齐平，等效 100mm 镜头压缩透视，全景深，商品从前到后都清晰。",
        lighting: "高调棚拍：顶部大型柔光箱加左右两条长条灯，光线均匀包裹商品，只在底部留下一道极淡的接触阴影。",
        set: "纯白无缝背景（#FFFFFF），没有台面纹理，没有道具。",
        copySlot: "none",
        avoid: ["画面中只出现这一件商品", "不加任何文字、角标、水印或边框"],
        neutralBackground: true,
    },
    "main-selling": {
        role: "main-selling",
        title: "卖点主图",
        purpose: "让人一秒读懂一个最有说服力的利益点。",
        platformRole: "main",
        composition: "商品放在画面右侧五分之三区域，主体高度约占画面 70%；左侧五分之二保持干净、连续、无纹理的背景，作为文案区。",
        camera: "机位与商品中部齐平、轻微俯视约 5°，等效 85mm 镜头，透视克制。",
        lighting: "左上方 45° 大面积柔光作主光，右侧白色反光板补光，商品边缘一道细轮廓光把主体从背景里托出来。",
        set: "使用风格锁色板做竖向渐变背景，台面简洁；最多一件呼应卖点的小道具，且不遮挡商品。",
        copySlot: "headline-subline",
        textZone: "画面左侧五分之二的上半部分",
        overlayZone: { x: 0.07, y: 0.12, width: 0.36, height: 0.5, align: "left", vAlign: "top" },
        avoid: ["文字不压在商品上", "除指定文案外不出现其他文字、价格或角标"],
    },
    "main-scene": {
        role: "main-scene",
        title: "场景主图",
        purpose: "让买家想象商品出现在自己生活里的样子。",
        platformRole: "main",
        composition: "把商品放进一个与品类和目标人群匹配的真实使用场景，商品是唯一视觉中心，约占画面 55%–65%；道具不超过 3 件，并且都服务于商品用途。",
        camera: "等效 50mm 镜头，略高于商品的视角，中等景深，背景柔和虚化。",
        lighting: "自然窗光从一侧进入，阴影方向一致，接触阴影和反射符合真实物理。",
        set: "场景色调与风格锁一致，环境干净，不出现其他品牌、文字或屏幕内容。",
        copySlot: "none",
        avoid: ["商品形状和尺寸比例与场景协调", "不出现第二件同类商品"],
    },
    "main-detail": {
        role: "main-detail",
        title: "细节特写",
        purpose: "用一个细节证明品质。",
        platformRole: "main",
        composition: "放大商品上最能说明品质的部位（材质纹理、走线、接口、五金或边缘工艺），细节占据画面主要区域，角落保留一小部分商品轮廓帮助定位。",
        camera: "等效 100mm 微距，浅景深，焦点精准落在细节上。",
        lighting: "低角度侧向掠射光勾出表面纹理和立体层次，高光受控，不过曝。",
        set: "与风格锁一致的中性渐变背景，不放道具。",
        copySlot: "none",
        avoid: ["只放大参考图里真实存在的细节", "不凭空添加纹理、划痕或工艺"],
    },
    "main-angle": {
        role: "main-angle",
        title: "多角度",
        purpose: "补全买家想看的另一个角度。",
        platformRole: "main",
        composition: "与白底主图保持同一光线和比例，换成侧面或背面展示商品的结构与厚度；参考图里没有的角度就选三分之四侧后方，不虚构看不到的结构。",
        camera: "机位与商品中心齐平，等效 85mm 镜头。",
        lighting: "与主图一致的柔光棚拍，阴影方向与主图相同。",
        set: "浅灰到白的无缝背景，没有道具。",
        copySlot: "none",
        avoid: ["颜色、材质和标识与正面一致"],
        neutralBackground: true,
    },
    "detail-hero": {
        role: "detail-hero",
        title: "头图海报",
        purpose: "详情页第一屏：建立第一印象，说清这是什么、凭什么值得买。",
        platformRole: "detail",
        composition: "商品位于画面下方约三分之二处，以三分之四角度呈现、轮廓完整；画面上方三分之一保持干净，作为主标题区。",
        camera: "略低机位轻微仰视，等效 70mm 镜头，让商品显得挺拔有质感。",
        lighting: "一盏主光加柔和补光，再配一道细轮廓光，背景有自然的明暗层次。",
        set: "风格锁色板的渐变或纯色背景，可以加一处呼应气质的光影或材质元素，不堆砌装饰。",
        copySlot: "headline-subline",
        textZone: "画面上方三分之一，水平居中",
        overlayZone: { x: 0.1, y: 0.07, width: 0.8, height: 0.24, align: "center", vAlign: "top" },
        avoid: ["标题区内不放商品和道具"],
    },
    "detail-selling": {
        role: "detail-selling",
        title: "核心卖点",
        purpose: "把三个核心卖点讲清楚。",
        platformRole: "detail",
        composition: "商品放在画面右侧，约占一半宽度；左侧留出竖向排布三条卖点的干净区域，商品对应卖点的部位清晰可见。",
        camera: "平视机位，等效 85mm 镜头。",
        lighting: "均匀柔光，商品每个部位都清晰可读。",
        set: "浅色干净背景，可以有极淡的几何纹理；配色跟随风格锁，只用一个强调色。",
        copySlot: "points",
        textZone: "画面左侧约 45% 的区域，自上而下排三条卖点",
        overlayZone: { x: 0.07, y: 0.12, width: 0.4, height: 0.76, align: "left", vAlign: "center" },
        avoid: ["卖点区内不放商品"],
    },
    "detail-model": {
        role: "detail-model",
        title: "上身效果",
        purpose: "展示穿戴或使用后的真实效果。",
        platformRole: "detail",
        composition: "一位成年模特自然穿戴或使用商品，三分之四身构图，商品是画面最清晰的焦点；姿态放松，表情克制。",
        camera: "等效 85mm 人像镜头，浅景深，焦点落在商品上。",
        lighting: "柔和的时尚侧光，肤色自然，保留真实皮肤纹理。",
        set: "简洁的摄影棚或与商品气质一致的真实场景，背景只保留一到两件道具。",
        copySlot: "headline",
        textZone: "画面顶部一条窄区域",
        overlayZone: { x: 0.08, y: 0.05, width: 0.84, height: 0.12, align: "left", vAlign: "top" },
        avoid: ["版型、颜色和细节与商品图一致，不瘦身、不改款", "只出现一位成年模特"],
    },
    "detail-scene": {
        role: "detail-scene",
        title: "使用场景",
        purpose: "呈现一个具体的使用时刻。",
        platformRole: "detail",
        composition: "商品正在被使用的真实瞬间，动作与商品用途一致，商品清晰完整，约占画面一半；画面上方留出一块安静区域。",
        camera: "等效 50mm 镜头，环境人像式构图，中等景深。",
        lighting: "自然光或柔和室内光，光线方向与场景一致。",
        set: "与目标人群匹配的真实场景，道具不超过 3 件。",
        copySlot: "headline-subline",
        textZone: "画面左上角约三分之一宽度的区域",
        overlayZone: { x: 0.07, y: 0.06, width: 0.5, height: 0.2, align: "left", vAlign: "top" },
        avoid: ["人物只作为使用者，不抢商品"],
    },
    "detail-material": {
        role: "detail-material",
        title: "材质工艺",
        purpose: "说明用料和做工。",
        platformRole: "detail",
        composition: "画面分主次两区：主区是关键材质与工艺的特写，次区保留完整商品的一部分作为参照；底部留一条横向文案区。",
        camera: "45° 斜拍，等效 100mm 微距。",
        lighting: "侧向掠射光表现纹理、厚度和光泽，颜色准确。",
        set: "中性无缝台面，不放道具。",
        copySlot: "headline-subline",
        textZone: "画面底部约五分之一的横向区域",
        overlayZone: { x: 0.08, y: 0.78, width: 0.84, height: 0.16, align: "left", vAlign: "bottom" },
        avoid: ["不虚构材料、厚度或工艺"],
    },
    "detail-closeup": {
        role: "detail-closeup",
        title: "细节特写",
        purpose: "放大一个让人信服的细节。",
        platformRole: "detail",
        composition: "放大最能说明品质的部位，细节占画面约 70%，角落放一个完整商品的小轮廓帮助定位；底部留出文案区。",
        camera: "等效 100mm 微距，浅景深。",
        lighting: "低角度掠射光表现触感，高光受控，不出现塑料感反光。",
        set: "克制的深色渐变或浅色石材台面，跟随风格锁。",
        copySlot: "headline-subline",
        textZone: "画面底部约五分之一的横向区域",
        overlayZone: { x: 0.08, y: 0.78, width: 0.84, height: 0.16, align: "left", vAlign: "bottom" },
        avoid: ["只放大参考图里真实存在的细节"],
    },
    "detail-angles": {
        role: "detail-angles",
        title: "多角度展示",
        purpose: "一屏看全商品的形态。",
        platformRole: "detail",
        composition: "同一画面里以统一灯光展示正面、侧面和背面三个角度，三个视角大小一致、阴影方向一致，像在同一台转台上拍摄；参考图里看不到的结构不虚构。",
        camera: "每个视角都平视，等效 85mm，比例一致。",
        lighting: "统一的柔光棚拍，三个视角明暗一致。",
        set: "无缝浅色渐变背景，视角之间用留白分隔。",
        copySlot: "headline",
        textZone: "画面顶部一条窄区域",
        overlayZone: { x: 0.08, y: 0.05, width: 0.84, height: 0.1, align: "center", vAlign: "top" },
        avoid: ["三个视角的颜色、比例和标识完全一致"],
    },
    "detail-spec": {
        role: "detail-spec",
        title: "规格参数",
        purpose: "让买家快速核对参数。",
        platformRole: "detail",
        composition: "商品完整轮廓位于画面上半部分居中，下半部分保留整齐的留白区域，用来排布参数表。",
        camera: "正面平视，等效 85mm 镜头。",
        lighting: "均匀柔光，轮廓清晰。",
        set: "浅色干净背景，可以有极淡的工程网格。",
        copySlot: "points",
        textZone: "画面下半部分，整齐排布参数",
        overlayZone: { x: 0.1, y: 0.56, width: 0.8, height: 0.38, align: "left", vAlign: "top" },
        avoid: ["参数只用档案里已确认的数据"],
    },
    "detail-size": {
        role: "detail-size",
        title: "尺寸参考",
        purpose: "让买家对大小有直观感受。",
        platformRole: "detail",
        composition: "商品与一个常见参照物（成年人的手、标准水杯或 A4 纸，按品类选最合适的一个）放在同一平面，比例真实；画面留出标注尺寸的空白边。",
        camera: "正面平视或垂直俯拍，透视不变形。",
        lighting: "均匀柔光，阴影柔和。",
        set: "浅色干净台面。",
        copySlot: "headline-subline",
        textZone: "画面顶部一条窄区域",
        overlayZone: { x: 0.08, y: 0.05, width: 0.84, height: 0.14, align: "left", vAlign: "top" },
        avoid: ["不生成具体尺寸数字，尺寸由排版添加", "参照物不遮挡商品"],
        familyOverrides: {
            apparel: {
                title: "尺码参考",
                composition: "服装完整平铺，版型舒展、左右对称，领口、袖长、衣长清楚可量；四周留出标注尺码的空白边。",
                avoid: ["不生成尺码数字，尺码由排版添加", "版型与商品图一致"],
            },
        },
    },
    "detail-package": {
        role: "detail-package",
        title: "包装与配件",
        purpose: "说明到手会收到什么。",
        platformRole: "detail",
        composition: "商品本体、外包装和随附配件按前后层次自然摆放，只展示参考图里确认存在的物品，标签和包装正面朝向镜头。",
        camera: "45° 俯拍，等效 50mm 镜头。",
        lighting: "柔和顶光，阴影自然。",
        set: "安静的哑光台面（亚麻、纸板或浅色木纹，按风格锁选择）。",
        copySlot: "headline",
        textZone: "画面顶部一条窄区域",
        overlayZone: { x: 0.08, y: 0.05, width: 0.84, height: 0.12, align: "left", vAlign: "top" },
        avoid: ["不新增赠品、线材、说明书或配件"],
    },
    "detail-closing": {
        role: "detail-closing",
        title: "购买理由",
        purpose: "收尾一屏：回顾核心卖点，给出购买理由。",
        platformRole: "detail",
        composition: "商品以最好看的角度位于画面中央，上方保留标题区，下方留出一条横向区域排列要点。",
        camera: "平视，等效 70mm 镜头。",
        lighting: "与头图一致的主光和轮廓光，首尾呼应。",
        set: "与头图同一套背景色板，整体更简洁。",
        copySlot: "points",
        textZone: "画面上方标题区与底部横向要点区",
        overlayZone: { x: 0.1, y: 0.06, width: 0.8, height: 0.2, align: "center", vAlign: "top" },
        avoid: ["画面安静克制，不堆促销元素"],
    },
};

/** 后台能改的镜头规格字段；avoid 在后台按「；」分隔成一段文字。 */
export const STUDIO_SHOT_PROMPT_FIELDS = ["purpose", "composition", "camera", "lighting", "set", "avoid"] as const;
export type StudioShotPromptField = (typeof STUDIO_SHOT_PROMPT_FIELDS)[number];

export function studioShotPromptKey(role: StudioShotRole, field: StudioShotPromptField) {
    return `shot.${role}.${field}`;
}

/** 内置的镜头规格，不含后台改动；后台编辑器用它显示默认写法。 */
export function studioDefaultShotSpec(role: StudioShotRole): StudioShotSpec {
    return SHOT_SPECS[role];
}

/** 镜头规格：后台改过的字段替换内置写法，品类专用写法（如服装的尺码参考）仍然优先。 */
export function studioShotSpec(role: StudioShotRole, family: StudioCategoryFamily = "generic"): StudioShotSpec {
    const base = SHOT_SPECS[role];
    const patched: StudioShotSpec = { ...base };
    for (const field of STUDIO_SHOT_PROMPT_FIELDS) {
        const text = studioPromptOverride(studioShotPromptKey(role, field));
        if (text === undefined) continue;
        if (field === "avoid")
            patched.avoid = text
                .split(/[；;\n]+/)
                .map((item) => item.trim())
                .filter(Boolean);
        else patched[field] = text;
    }
    const override = base.familyOverrides?.[family];
    return override ? { ...patched, ...override } : patched;
}

export function studioFamilyRule(family: StudioCategoryFamily) {
    return studioPromptText(`family.${family}`, STUDIO_FAMILY_RULES[family]);
}

export function studioTweakInstruction(id: string) {
    const tweak = STUDIO_TWEAKS.find((item) => item.id === id);
    return tweak ? studioPromptText(`tweak.${id}`, tweak.instruction) : undefined;
}

export const STUDIO_MAIN_ROLES: StudioShotRole[] = ["main-white", "main-selling", "main-scene", "main-detail", "main-angle"];

const DETAIL_SEQUENCES: Record<StudioCategoryFamily, StudioShotRole[]> = {
    generic: ["detail-hero", "detail-selling", "detail-scene", "detail-material", "detail-closeup", "detail-angles", "detail-spec", "detail-size", "detail-package", "detail-closing"],
    apparel: ["detail-hero", "detail-selling", "detail-model", "detail-material", "detail-closeup", "detail-angles", "detail-scene", "detail-size", "detail-spec", "detail-closing"],
    "bags-shoes": ["detail-hero", "detail-selling", "detail-model", "detail-closeup", "detail-material", "detail-angles", "detail-scene", "detail-size", "detail-package", "detail-closing"],
    jewelry: ["detail-hero", "detail-selling", "detail-model", "detail-closeup", "detail-material", "detail-angles", "detail-package", "detail-size", "detail-scene", "detail-closing"],
    beauty: ["detail-hero", "detail-selling", "detail-material", "detail-scene", "detail-closeup", "detail-spec", "detail-angles", "detail-package", "detail-size", "detail-closing"],
    food: ["detail-hero", "detail-selling", "detail-scene", "detail-closeup", "detail-material", "detail-spec", "detail-package", "detail-angles", "detail-size", "detail-closing"],
    electronics: ["detail-hero", "detail-selling", "detail-spec", "detail-closeup", "detail-scene", "detail-angles", "detail-material", "detail-package", "detail-size", "detail-closing"],
    home: ["detail-hero", "detail-selling", "detail-scene", "detail-size", "detail-material", "detail-closeup", "detail-angles", "detail-spec", "detail-package", "detail-closing"],
    "baby-toys": ["detail-hero", "detail-selling", "detail-scene", "detail-material", "detail-closeup", "detail-size", "detail-angles", "detail-spec", "detail-package", "detail-closing"],
};

export function studioPlanRoles(kind: StudioPlanKind, family: StudioCategoryFamily): StudioShotRole[] {
    return kind === "main" ? STUDIO_MAIN_ROLES : DETAIL_SEQUENCES[family] || DETAIL_SEQUENCES.generic;
}

export const STUDIO_PLAN_META: Record<StudioPlanKind, { title: string; summary: string; ratio: string; defaultTextMode: "model" | "overlay" }> = {
    main: { title: "主图套图", summary: "白底、卖点、场景、细节、多角度，一组五张", ratio: "1:1", defaultTextMode: "model" },
    detail: { title: "一键详情页", summary: "按品类排十屏，出完装订成长图并按平台切片", ratio: "3:4", defaultTextMode: "overlay" },
};

/** 品类规则：只写这类商品最容易出错、最影响质感的地方。 */
export const STUDIO_FAMILY_RULES: Record<StudioCategoryFamily, string> = {
    apparel: "服装要表现面料的垂坠、纹理和真实褶皱；版型、领口、袖型、下摆长度、纽扣拉链和缝线保持原样，不瘦身、不收腰。",
    "bags-shoes": "包袋保持包体结构、包带长度、五金和缝线；鞋履保持鞋楦、鞋底纹路和左右一致。皮革、织物和金属分别呈现真实质感。",
    jewelry: "珠宝首饰用受控的渐变反射表现金属和宝石，保持宝石数量、切面、镶嵌和链节，不添加彩虹光或额外宝石。",
    beauty: "美妆个护保留瓶身、泵头、盖子和标签位置；玻璃保留通透和折射，膏体、液体的颜色与质地真实，不暗示医学功效。",
    food: "食品饮料突出新鲜感和可信的份量，包装与标签文字原样保留；食材点缀克制，不改变食品形状，不虚构配料。",
    electronics: "3C 数码保持机身边框、接口、按键、指示灯、镜头排列和线材完全一致；用受控的边缘高光和玻璃反射表现工业设计，屏幕留空或保持原样，不生成随机界面。",
    home: "家居家电保持真实尺寸与比例，与墙面、地面和家具的透视关系正确，产品稳定接地，不添加不存在的抽屉、门或按键。",
    "baby-toys": "母婴玩具画面明亮温和，保持结构、配件数量和安全扣件；人物只作尺寸参考，姿态安全，不暗示安全认证。",
    generic: "商品形状、比例、颜色、材质、标识和可见细节保持完全一致，材质表现真实。",
};

export type StudioStylePreset = {
    id: StudioStylePresetId;
    name: string;
    mood: string;
    palette: { name: string; hex: string }[];
    light: string;
    /** 程序排字用的文字颜色。 */
    ink: string;
    inkSoft: string;
};

export const STUDIO_STYLES: StudioStylePreset[] = [
    {
        id: "mist",
        name: "雾感极简",
        mood: "安静、克制、留白充足",
        palette: [
            { name: "雾蓝灰", hex: "#DDE5EC" },
            { name: "米白", hex: "#F6F4EF" },
            { name: "石墨灰", hex: "#4A4F57" },
        ],
        light: "大面积柔光，低对比，阴影轻而柔",
        ink: "#22262B",
        inkSoft: "#5B616B",
    },
    {
        id: "warm",
        name: "暖调生活",
        mood: "温暖、日常、亲和",
        palette: [
            { name: "奶油白", hex: "#F5EFE6" },
            { name: "原木色", hex: "#C9A27E" },
            { name: "暖灰", hex: "#8C7B6B" },
        ],
        light: "侧窗暖光，色温约 4500K，阴影柔和",
        ink: "#3B2F25",
        inkSoft: "#6E5D4E",
    },
    {
        id: "noir",
        name: "高级暗调",
        mood: "精致、聚焦、有戏剧张力",
        palette: [
            { name: "炭黑", hex: "#16171A" },
            { name: "石墨", hex: "#3A3D42" },
            { name: "香槟金点缀", hex: "#C8A96A" },
        ],
        light: "低调布光，细窄轮廓光勾边，局部聚光",
        ink: "#F4F1EA",
        inkSoft: "#C9C4BA",
    },
    {
        id: "fresh",
        name: "清透自然",
        mood: "清爽、通透、自然",
        palette: [
            { name: "薄荷白", hex: "#EEF6F1" },
            { name: "天空蓝", hex: "#CFE3F3" },
            { name: "浅草绿", hex: "#BFDCC8" },
        ],
        light: "明亮自然光，高调，色温约 5600K",
        ink: "#1F3A33",
        inkSoft: "#4C6A61",
    },
    {
        id: "vivid",
        name: "明亮活力",
        mood: "年轻、活泼、有冲击力",
        palette: [
            { name: "珊瑚橙", hex: "#FF7A59" },
            { name: "柠檬黄", hex: "#FFD45C" },
            { name: "纯白", hex: "#FFFFFF" },
        ],
        light: "明亮均匀光，饱和度适中，阴影干净",
        ink: "#2A1A14",
        inkSoft: "#5A4036",
    },
    {
        id: "pure",
        name: "纯净高级白",
        mood: "干净、理性、科技感的极简",
        palette: [
            { name: "纯白", hex: "#FFFFFF" },
            { name: "浅银灰", hex: "#EEF0F2" },
            { name: "深空灰", hex: "#1D1D1F" },
        ],
        light: "高调棚拍，大面积柔光箱，边缘高光清晰，阴影极淡",
        ink: "#1D1D1F",
        inkSoft: "#6E6E73",
    },
    {
        id: "wood",
        name: "日系原木",
        mood: "安静、自然、有生活温度",
        palette: [
            { name: "米白", hex: "#F3EEE6" },
            { name: "原木", hex: "#B8916A" },
            { name: "墨绿点缀", hex: "#3F5A4A" },
        ],
        light: "柔和的侧窗自然光，色温约 5000K，带一点树影或百叶光影",
        ink: "#2E2A24",
        inkSoft: "#6B6255",
    },
    {
        id: "cream",
        name: "奶油治愈",
        mood: "柔软、温柔、亲近，适合母婴和居家",
        palette: [
            { name: "奶油黄", hex: "#FBF3E2" },
            { name: "杏粉", hex: "#F2D3C4" },
            { name: "燕麦", hex: "#D9C7AE" },
        ],
        light: "大面积柔光，暖调，阴影圆润浅淡",
        ink: "#4A3B30",
        inkSoft: "#7D6A5C",
    },
    {
        id: "tech",
        name: "科技冷感",
        mood: "理性、精密、有未来感",
        palette: [
            { name: "深蓝黑", hex: "#0E1624" },
            { name: "冷银", hex: "#C9D2DC" },
            { name: "电光蓝", hex: "#2F7BFF" },
        ],
        light: "暗背景上的冷色轮廓光与条形高光，局部蓝色辉光",
        ink: "#F2F6FA",
        inkSoft: "#A9B6C4",
    },
    {
        id: "oriental",
        name: "新中式东方",
        mood: "雅致、留白、有东方韵味",
        palette: [
            { name: "宣纸白", hex: "#F4EFE4" },
            { name: "朱砂红", hex: "#B23A2E" },
            { name: "墨黑", hex: "#262422" },
        ],
        light: "柔和侧光，带一点窗格或竹影，低饱和",
        ink: "#262422",
        inkSoft: "#6A625A",
    },
    {
        id: "luxe",
        name: "轻奢金属",
        mood: "精致、明亮、有分寸的奢华",
        palette: [
            { name: "象牙白", hex: "#F7F3EC" },
            { name: "香槟金", hex: "#C9A66B" },
            { name: "烟灰", hex: "#5C5852" },
        ],
        light: "柔光主光加细窄的金属反光，高光干净，阴影柔和",
        ink: "#2B2824",
        inkSoft: "#6F6A62",
    },
    {
        id: "sport",
        name: "运动能量",
        mood: "速度、力量、高对比",
        palette: [
            { name: "炭黑", hex: "#141414" },
            { name: "荧光绿", hex: "#C6F432" },
            { name: "纯白", hex: "#FFFFFF" },
        ],
        light: "硬朗的侧逆光，高对比，边缘有动感的高光",
        ink: "#FFFFFF",
        inkSoft: "#C9C9C9",
    },
    {
        id: "candy",
        name: "童趣糖果",
        mood: "明亮、可爱、轻松，适合儿童和年轻用户",
        palette: [
            { name: "天空蓝", hex: "#BFE3FF" },
            { name: "柠檬黄", hex: "#FFE27A" },
            { name: "草莓粉", hex: "#FFB4C6" },
        ],
        light: "明亮均匀的高调光，阴影短而柔，色彩饱满不刺眼",
        ink: "#24324A",
        inkSoft: "#5A6680",
    },
    {
        id: "organic",
        name: "自然植萃",
        mood: "天然、清爽、可信赖",
        palette: [
            { name: "鼠尾草绿", hex: "#A9BFA0" },
            { name: "亚麻", hex: "#EFE8DC" },
            { name: "陶土", hex: "#C07A55" },
        ],
        light: "自然日光，带植物叶影，色温约 5300K",
        ink: "#2F3A2C",
        inkSoft: "#66705F",
    },
    {
        id: "editorial",
        name: "杂志大片",
        mood: "时髦、利落、像时尚杂志的版面",
        palette: [
            { name: "灰白", hex: "#EDEDEB" },
            { name: "纯黑", hex: "#111111" },
            { name: "一抹正红", hex: "#D72B2B" },
        ],
        light: "硬朗的单侧光，影子清楚，构图大胆留白",
        ink: "#111111",
        inkSoft: "#555555",
    },
];

/** 质感选「按商品推荐」又没有策划时，按品类挑一个。 */
const STUDIO_FAMILY_STYLE: Record<StudioCategoryFamily, StudioStylePresetId> = {
    apparel: "editorial",
    "bags-shoes": "luxe",
    jewelry: "luxe",
    beauty: "organic",
    food: "warm",
    electronics: "tech",
    home: "wood",
    "baby-toys": "cream",
    generic: "pure",
};

export function studioStyle(id: StudioStyleId): StudioStylePreset {
    const style = STUDIO_STYLES.find((item) => item.id === id) || STUDIO_STYLES[0];
    return { ...style, mood: studioPromptText(`style.${style.id}.mood`, style.mood), light: studioPromptText(`style.${style.id}.light`, style.light) };
}

/** 这件商品实际用的质感：选了预设就用预设；选「按商品推荐」时用策划挑的，没有策划按品类挑。 */
export function studioProductStyle(product: Pick<StudioProduct, "style" | "dossier"> & { brief?: Pick<StudioBrief, "detailPlan" | "outputType"> }): StudioStylePreset {
    if (product.style !== "auto") return studioStyle(product.style);
    const planned = product.brief?.outputType === "detail-set" ? product.brief.detailPlan?.styleId : undefined;
    return studioStyle(planned || STUDIO_FAMILY_STYLE[product.dossier?.family || "generic"]);
}

/** 微调标签：只改这张图的镜头规格，不碰商品真值。 */
export const STUDIO_TWEAKS: { id: string; label: string; instruction: string }[] = [
    { id: "brighter", label: "更明亮", instruction: "整体更明亮通透，暗部更干净" },
    { id: "warmer", label: "更暖", instruction: "色温更暖一些" },
    { id: "cooler", label: "更清冷", instruction: "色温更冷静清爽" },
    { id: "bigger", label: "商品再大一点", instruction: "商品在画面中更大，占比提高约 10%" },
    { id: "cleaner", label: "背景更干净", instruction: "背景更干净，去掉多余道具" },
    { id: "angle", label: "换个角度", instruction: "换一个更有表现力的拍摄角度，商品外观保持不变" },
    { id: "softer", label: "更柔和", instruction: "阴影更柔和，对比更低" },
    { id: "dramatic", label: "更有质感", instruction: "对比更强，轮廓光更明显" },
];
