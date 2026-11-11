import catalog from "../../../../backend/internal/ecommerceagent/studio_design_catalog.json";
import { STUDIO_COMPOSITIONS } from "./art-direction";
import { studioFactUsable, type StudioCompositionId, type StudioDetailLayoutId, type StudioProduct, type StudioShot, type StudioStylePresetId } from "./types";

/** 策划、直接生成与结果校验共用商品设计策略；这里的场景和色彩是候选方法，不是 SKU 事实。 */
type DesignProduct = Pick<StudioProduct, "style" | "dossier"> & Partial<Pick<StudioProduct, "name" | "brief">>;
type DesignProfile = { key: string; reason: string; styles: StudioStylePresetId[]; layouts: StudioDetailLayoutId[]; compositions: StudioCompositionId[]; scenes: string; avoid: string };
export const STUDIO_DESIGN_KNOWLEDGE_VERSION = catalog.version;

/** 从详情页设计心得与成品拆解提炼；策划、出图和成品检查使用同一标准。 */
export const STUDIO_POSTER_DESIGN_RULE = catalog.posterDesign.principles;
export const STUDIO_HERO_DESIGN_RULE = catalog.posterDesign.hero;

export function studioPosterDesignLines(shot: Pick<StudioShot, "role" | "layout">, hasCopy: boolean): string[] {
    const layout = shot.layout;
    const hero = ["detail-hero", "detail-campaign", "main-selling"].includes(shot.role) || layout === "poster" || layout === "color-block" || layout === "cutout";
    const evidence = ["callout", "macro", "grid", "material-board"].includes(layout || "") || /closeup|material|main-detail/.test(shot.role);
    const information = ["spec", "data", "icons", "checklist", "timeline", "compare"].includes(layout || "") || /spec|size|steps|compare/.test(shot.role);
    return [
        hasCopy ? STUDIO_POSTER_DESIGN_RULE : "无字画面先确定要展示的形态或使用关系，再用主体尺度、光影与负空间形成一个视觉焦点；摄影承担信息，辅助元素支持主体，保留系列色板与光影体系。保持无字，不添加题签或标签。",
        hero
            ? hasCopy
                ? STUDIO_HERO_DESIGN_RULE
                : "无字主视觉页：用真实形态的尺度差、轮廓与负空间或真实使用动作形成停留入口；主摄影建立商品识别，辅助景别与空间纵深按内容选用，不强加文字、标签和拼贴。"
            : evidence
              ? "证据页：让一个真实可见细节解释本屏结论，完整轮廓在需要时作小比例定位；微距、局部放大或拼版按证据选择，避免同一整件商品缩小后复制多次。标签与证据就近对应，必要的引线落在实际部位；细节与说明共享网格和间距。"
              : information
                ? "信息页：用对照、参数分列或有序动作解释一个购买问题；图、值与说明一一对应。手机端摄影或信息最多三栏，窄区改单列，文字长时扩大信息区，不缩成不可读的小字；数据和步骤只使用已确认资料。"
                : "场景与编辑页：真实动作、商品接触与环境关系回答本屏问题；主摄影与短注按自然负空间、摄影边界和阅读顺序组织。需要多图时让不同景别补充不同信息，场景道具不抢主体；满版与分区都可使用，不固定一大两小或统一标题条。",
    ];
}

const PROFILES: Record<string, DesignProfile> = {
    kids: {
        key: "kids",
        reason: "家长判断适用条件，孩子感受色彩与使用情境",
        styles: ["candy", "fresh", "cream", "vivid"],
        layouts: ["color-block", "storyboard", "lookbook", "cutout", "macro", "checklist"],
        compositions: ["arch", "diagonal", "window", "orbit", "mosaic", "ribbon", "macro"],
        scenes: "上学准备、窗边阅读、户外观察等与实际用途相符的明亮情境；儿童眼镜可用眼前景物与镜框形状呼应，不模拟视力改善",
        avoid: "自动方向不用整套灰白、冷银或压抑暗场；不默认婴幼儿卡通，不从眼镜推导防蓝光、近视矫正或耐摔",
    },
    eyewear: {
        key: "eyewear",
        reason: "先辨认框形、透明度与佩戴关系，再看已确认规格",
        styles: ["editorial", "fresh", "luxe", "vivid"],
        layouts: ["lookbook", "cutout", "macro", "editorial", "callout"],
        compositions: ["sidebar", "macro", "window", "diptych", "orbit", "vertical"],
        scenes: "实际人群的阅读、出行或穿搭；镜框轮廓和可见连接处做微距，镜片反射与边缘受控",
        avoid: "眼镜不是数码实验舱；未知镜片功能不画蓝光过滤、治疗效果或剖面",
    },
    electronics: {
        key: "electronics",
        reason: "真实接口、操作与规格帮助判断适用性",
        styles: ["tech", "pure", "editorial", "vivid"],
        layouts: ["callout", "macro", "timeline", "checklist", "grid"],
        compositions: ["sidebar", "mosaic", "macro", "ribbon", "timeline", "left"],
        scenes: "用途对应的桌面与操作特写；接口、按键及可见轮廓作证据",
        avoid: "不编芯片、参数、兼容性、内部爆炸图和虚假 UI",
    },
    food: {
        key: "food",
        reason: "包装识别、真实食物质地与已确认原料帮助选购",
        styles: ["vivid", "warm", "organic", "oriental"],
        layouts: ["macro", "flatlay", "material-board", "storyboard", "color-block"],
        compositions: ["macro", "diagonal", "mosaic", "ribbon", "top", "corner"],
        scenes: "真实餐桌、食用或分享时刻；质地与份量清楚，道具不冒充配方",
        avoid: "不用灰蒙低对比压食欲，不编健康功效和成分",
    },
    beauty: {
        key: "beauty",
        reason: "包装、已确认质地与用法建立可信的产品识别",
        styles: ["organic", "luxe", "fresh", "vivid"],
        layouts: ["macro", "material-board", "editorial", "timeline", "cutout"],
        compositions: ["macro", "sidebar", "window", "orbit", "ribbon", "vertical"],
        scenes: "真实梳妆空间与已确认用法；包装和质地分主次展示",
        avoid: "不编成分，不画未提供的功效前后对比",
    },
    apparel: {
        key: "apparel",
        reason: "实际穿戴、版型和织纹比装饰信息更有助于判断",
        styles: ["editorial", "vivid", "wood", "luxe"],
        layouts: ["lookbook", "editorial", "macro", "flatlay", "storyboard"],
        compositions: ["sidebar", "window", "triptych", "diagonal", "macro", "corner"],
        scenes: "真实穿搭情境与可见走线、织纹；保留版型、比例和商品颜色",
        avoid: "不从外观推导材料成分，不改版型，不把搭配单品当随赠",
    },
    home: {
        key: "home",
        reason: "空间尺度、用途与可见材料帮助买家理解日常使用",
        styles: ["wood", "warm", "fresh", "editorial"],
        layouts: ["storyboard", "editorial", "macro", "checklist", "flatlay"],
        compositions: ["window", "corner", "sidebar", "ribbon", "mosaic", "bottom"],
        scenes: "用途对应的住宅空间、真实接触与收纳关系；尺寸只用已确认值",
        avoid: "不统一套洞石展台，不把道具或房间尺寸当商品事实",
    },
    general: {
        key: "general",
        reason: "用途尚不明确时先展示可见轮廓与真实细节",
        styles: ["fresh", "editorial", "warm", "vivid"],
        layouts: ["cutout", "macro", "editorial", "grid", "scene"],
        compositions: ["window", "macro", "sidebar", "mosaic", "ribbon", "left"],
        scenes: "用途明确时安排真实使用；未知时用无道具静物与可见局部",
        avoid: "不假装识别未知用途，不编买家动机或功能",
    },
};

export function studioDesignProfile(product: DesignProduct): DesignProfile {
    const dossier = product.dossier;
    const audienceFacts = (dossier?.facts || []).filter((fact) => studioFactUsable(fact) && /人群|年龄|适用/.test(fact.label)).map((fact) => fact.value);
    const answers = (product.brief?.prep?.asks || []).filter((ask) => /谁|人群|年龄|多大/.test(ask.question)).flatMap((ask) => [...ask.picked, ask.note]);
    const text = [product.name, dossier?.name, dossier?.category, product.brief?.productType, product.brief?.audience, ...audienceFacts, ...answers].filter(Boolean).join(" ");
    const family = dossier?.family;
    if (family === "baby-toys" || /儿童|孩子|宝宝|婴幼|童装|童鞋|小学|kids?\b|children|baby\b/i.test(text)) return PROFILES.kids;
    if (/眼镜|镜框|太阳镜|eyewear|glasses/i.test(text)) return PROFILES.eyewear;
    if (family === "electronics" || /耳机|键盘|手机|数码|headphone|keyboard/i.test(text)) return PROFILES.electronics;
    if (family === "food" || /零食|食品|饮料|咖啡豆|饼干|snack|food/i.test(text)) return PROFILES.food;
    if (family === "beauty" || /护肤|精华|香水|美妆|洗发|serum|cosmetic/i.test(text)) return PROFILES.beauty;
    if (["apparel", "bags-shoes", "jewelry"].includes(family || "") || /服装|衬衫|鞋|项链|dress|apparel/i.test(text)) return PROFILES.apparel;
    if (family === "home" || /保温杯|陶瓷杯|家具|家居|椅|灯|沙发|furniture/i.test(text)) return PROFILES.home;
    return PROFILES.general;
}

/** 只有已确认资料才能解锁会暗示性能、材料或作用过程的版式。 */
export function studioEvidenceLayouts(product: StudioProduct, layouts: StudioDetailLayoutId[]) {
    const facts = (product.dossier?.facts || []).filter(studioFactUsable);
    const seller = product.sellerNotes;
    const confirmed = facts.map((fact) => `${fact.label} ${fact.value}`).join(" ") + " " + seller;
    return layouts.filter((id) => {
        if (id === "mechanism") return /原理|作用机制|结构图|剖面|mechanism/i.test(confirmed);
        if (id === "ingredients" || id === "material-board") return facts.some((fact) => fact.group === "material") || /成分|原料|材质/i.test(seller);
        if (id === "data") return /\d/.test(confirmed.replace(/#[0-9a-f]{3,8}\b/gi, ""));
        if (id === "timeline") return facts.some((fact) => fact.group === "usage") || /步骤|用法|操作/i.test(seller);
        return true;
    });
}

/** 候选按购买问题排序，而不是按库的登记顺序抽取。模型仍可在可用目录中另选并说明依据。 */
export function studioDesignKnowledgeLines(product: StudioProduct): string[] {
    const profile = studioDesignProfile(product);
    const layouts = studioEvidenceLayouts(product, profile.layouts);
    return [
        `【商品设计匹配 · ${STUDIO_DESIGN_KNOWLEDGE_VERSION}】这是方法候选，不是商品事实。匹配：${profile.key}；依据：${profile.reason}。`,
        `优先信息版式：${layouts.join("、")}；优先图文骨架：${profile.compositions.map((id) => `${id}（${STUDIO_COMPOSITIONS[id].label}）`).join("、")}。逐屏先写购买问题和已有证据，再选信息表达与图文位置；不按序号轮转固定几种。`,
        `场景与摄影：${profile.scenes}。边界：${profile.avoid}。`,
        `【平面设计标准】${STUDIO_POSTER_DESIGN_RULE}`,
        `【首屏与海报构成】${STUDIO_HERO_DESIGN_RULE}`,
        "色彩判断：商品本色、背景主色、强调色分别考虑。灰色镜腿或透明镜片是商品颜色，不代表整套背景应该灰；按人群与品牌方向选择背景，用明度与色相差展示真实轮廓。给出背景主色、辅助色、文字色的色名与 HEX，并说明各自作用。",
        "先遵守白底与无字等平台硬规则。卖家明确选择的质感、参考同款、已选方向和本次调整优先；候选不得覆盖用户锁定的设计。designAnalysis 说明实际证据、所选版式及未选其他套路的原因。",
    ];
}

/** 不暗中把模型灰板换成彩板；无明确锁定时拒绝不适合儿童的自动方向，错误直接回到策划界面。 */
export function studioAutoColorIssue(product: StudioProduct, design: { style?: string; styleId?: string; palette?: { hex: string }[] }): string | undefined {
    const prep = product.brief.prep;
    if (product.style !== "auto" || product.brief.outputType === "white" || studioDesignProfile(product).key !== "kids" || product.brief.sameLayout || prep?.directions.some((direction) => direction.id === prep.picked)) return;
    const request = `${product.brief.extra} ${product.brief.planNote}`;
    if (/灰|银|黑白|暗调|极简|冷调|冷色/i.test(request) && !/(?:不要|不用|避免|拒绝|别用|去掉)[^。；\n]{0,12}(?:灰|银|黑白|暗调|极简|冷调|冷色)/.test(request)) return;
    const style = design.style || "";
    const colors = [...(design.palette?.map((color) => color.hex) || []), ...(style.match(/#[0-9a-f]{6}\b/gi) || [])];
    const colorful =
        colors.some((color) => {
            const channels = [1, 3, 5].map((start) => Number.parseInt(color.slice(start, start + 2), 16));
            return Math.max(...channels) > 100 && Math.max(...channels) - Math.min(...channels) > 26;
        }) || /黄|橙|粉|珊瑚|糖果|草绿|天空蓝|薄荷|杏色/.test(style);
    if (!colorful && (colors.length >= 2 || /灰白|黑白|冷灰|冷银|暗场/.test(style) || ["mist", "pure", "noir", "tech"].includes(design.styleId || "")))
        return "儿童商品的自动策划给出了灰白或暗场色板，缺少适合人群的色彩。请重新策划；如需此风格，请明确选定质感或补充要求";
}
