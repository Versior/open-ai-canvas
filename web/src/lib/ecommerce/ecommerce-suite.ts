/**
 * 电商套图提示词——一次出图的那张表。
 *
 * 每一行同时保存生图提示词、可编辑文案与排版快照。详情页提示词把画面与确认文案一起交给图片模型；
 * 独立文案与版式继续保留，只用于本地编辑和排版回退。
 *
 * 所以这一版的单位是「一张图一条提示词」：
 * - 分析时，文本模型读商品实拍 + 商品档案，为每一张规划底图、文案与版式；
 * - 用户在表里逐条看、逐条改；
 * - 出图时那一行原样交给图片模型（商品锁定与模特锁定由编译时自动前置）。
 *
 * 表里没有的图不生成，表里的字不编——生成使用用户核对过的快照。
 */
import { createEcommerceShotSetFromSlots, ecommerceLanguageRule, ecommerceShotPreset } from "./ecommerce-recipes";
import { ecommerceShotLines, type EcommerceCopy, type EcommerceProductProfile, type EcommerceStyle } from "./ecommerce-contract";
import { ECOMMERCE_LAYOUT_PRESETS, createEcommerceLayoutFromPreset, type EcommerceLayout } from "./ecommerce-layout";
import { ECOMMERCE_ONE_CLICK_FLOWS, ecommerceOneClickFlow, ecommerceOneClickScreens, type EcommerceOneClickFlow, type EcommerceOneClickFlowId } from "./ecommerce-oneclick";
import { ecommercePlatformGuidance } from "./ecommerce-platform-guidance";

export type EcommerceSuiteRow = {
    /** 交付物槽位 id。它决定这一行对应画布上哪个节点，所以要稳定。 */
    slotId: string;
    /** `false` 时跳过这一屏；缺失与 `true` 都保持旧数据的启用语义。 */
    enabled?: boolean;
    /** 这一行是什么，例如「详情01 · 痛点共情」。**可改**——行业套路只是起手式。 */
    title: string;
    /** 这一张要解决什么。**可改**，而且它会被写进分析提示词当方向。 */
    duty: string;
    /**
     * 这一张的生图提示词；旧数据可能仍是无字底图提示词。
     *
     * 出图时原样交给图片模型；商品锁定与模特锁定由编译时自动前置。
     */
    prompt: string;
    /** 竞品大纲的采用方式；普通创作表行可以没有。 */
    stance?: "follow" | "differentiate";
    /** 与底图分离的可编辑文案。旧数据可以没有。 */
    copy?: EcommerceCopy;
    /** 分析时选定的排版快照。旧数据可以没有。 */
    layout?: EcommerceLayout;
    /** 用户明确采用的结果；缺失时使用最近一次成功结果。 */
    resultNodeId?: string;
    /**
     * 这一行按哪一版提示词合同写的。
     *
     * 缺省 = 旧数据：详情页的文案可能还混在 `prompt` 里（旧自由文本），只能读、不能拿去新生成。
     * `1` = 新合同：`copy` 是唯一可见营销文案来源，`prompt` 只写画面/摆放/风格/负面。
     */
    imagePromptContractVersion?: 1;
};

export type EcommerceSuite = {
    schemaVersion?: number;
    flow: string;
    rows: EcommerceSuiteRow[];
    /** 这份提示词是怎么来的：模型分析出来的，还是按行业套路铺的底。 */
    source: "draft" | "preset";
    updatedAt: string;
};

/**
 * 2 起的差别只有一条：同样 flow 的空表就是**用户删空了**，不再被当成「还没建表」补回十屏。
 * 所以读过一次 1 的表必须留下标记，否则下次加载又会把删掉的屏还回去。
 */
export const CURRENT_ECOMMERCE_SUITE_SCHEMA_VERSION = 2;

/** Upgrade only the unambiguous nine-screen detail skeleton; versioned user edits are authoritative. */
export function migrateLegacyEcommerceSuite(suite: EcommerceSuite): EcommerceSuite {
    if (suite.schemaVersion === CURRENT_ECOMMERCE_SUITE_SCHEMA_VERSION) return suite;
    // 带版本号 = 用户确认过的结构，升版本只改标号，绝不补行。
    if (suite.schemaVersion !== undefined) return { ...suite, schemaVersion: CURRENT_ECOMMERCE_SUITE_SCHEMA_VERSION };
    if (suite.flow !== "detail" || suite.rows.length !== 9 || suite.rows.some((row, index) => row.slotId !== `detail-${index + 1}`)) return suite;
    const detail = ecommerceOneClickFlow("detail")!;
    return { ...suite, schemaVersion: CURRENT_ECOMMERCE_SUITE_SCHEMA_VERSION, rows: [...suite.rows, ecommerceSuiteSkeleton(detail)[9]] };
}

/**
 * 这一套实际用哪张表。
 *
 * **表是唯一真相，行业套路只是它的初始值。** 几张、每张干什么，由表决定——
 * 用户可以加行、删行、换序、改职责，分析模型只补全用户已经确认的结构。
 * 上一版把「九屏」写死在交付物常量里，用户改不动，只能接受行业套路给的九屏。
 *
 * 表是别的入口留下的（先跑过详情页、又打开主图）时退回默认骨架：槽位对不上，
 * 硬用会让每一行都找不到节点。
 *
 * 唯独「同 flow 但一行都没有」不能当没建表——那是用户把屏删光了，
 * 补回十屏等于否决他的编辑。骨架只给真正没表的时候。
 */
export function ecommerceSuiteRows(flow: EcommerceOneClickFlow, suite: EcommerceSuite | undefined): EcommerceSuiteRow[] {
    if (suite?.flow === flow.id) return suite.rows;
    return ecommerceSuiteSkeleton(flow);
}

/**
 * 这一套里每一行的空壳（有屏次和职责，还没提示词）。
 *
 * 标题去掉「详情01 ·」那段前缀：序号由面板按下标显示，存在标题里会跟着编辑走，
 * 用户把它改成「痛点」之后标题就成了「详情01 · 痛点」——前缀叠前缀。
 */
export function ecommerceSuiteSkeleton(flow: EcommerceOneClickFlow): EcommerceSuiteRow[] {
    return ecommerceOneClickScreens(flow).map((screen) => ({ slotId: screen.slotId, title: screen.title.replace(/^[^·]*·\s*/, "") || screen.title, duty: screen.duty, prompt: "" }));
}

/**
 * 新加一行的槽位 id。
 *
 * 沿用 `detail-1` 这种「入口前缀 + 序号」的形状，序号取当前最大值的下一个——
 * 而不是随机串。槽位 id 会出现在画布节点上、编译日志里和用户的截图里，
 * 一串随机字符没法读。前缀认不出来时退回一个稳定可读的形状。
 */
export function ecommerceSuiteRowId(flow: EcommerceOneClickFlow, rows: EcommerceSuiteRow[]) {
    const prefix = flow.set.slots[0]?.id.replace(/\d+$/, "") || `${flow.id}-`;
    const used = new Set(rows.map((row) => row.slotId));
    let index = rows.length + 1;
    while (used.has(`${prefix}${index}`)) index += 1;
    return `${prefix}${index}`;
}

/**
 * 兜底：按每一屏自带的拍法预设铺一份**能直接用**的提示词。
 *
 * 存在的意义是「分析没跑或跑砸时，这一套仍然出得了图」。行业套路里的拍法预设
 * （构图 / 光线 / 色彩 / 镜头 / 背景 / 文案位 / 排除）本来就是按张写好的，
 * 拿它当底比让用户从空白开始强得多。
 *
 * 详情页铺底只写画面四类：画面构成、产品摆放、视觉风格、负面提示词。
 * 文案与卖点由共享编译器按 copy 补齐——铺底里留一句「主标题：…」，
 * 模型就会在没有文案时自己从资料里造字，这一版不再这么写。
 */
export function ecommerceSuiteFromPresets(flow: EcommerceOneClickFlow): EcommerceSuiteRow[] {
    const screens = ecommerceOneClickScreens(flow);
    if (flow.id === "detail") {
        return screens.map((screen) => {
            const preset = ecommerceShotPreset(screen.presetId);
            const prompt = [
                `画面构成：${screen.aspectRatio} 竖版商业详情页，每屏只讲「${screen.title.replace(/^[^·]*·\s*/, "") || screen.title}」一个核心主题；根据商品与平台动态规划层级，不套固定模板`,
                `产品摆放：根据商品形态、结构、真实使用方式与本屏主题动态决定位置、角度、景别和占比，不把同一摆法复制到其他屏`,
                `视觉风格：${preset?.hint || "依据商品与平台动态确定"}；整套色彩、字体气质与商业质感统一，只学习参考图的信息层级、氛围和排版逻辑`,
                "负面提示词：商品变形、颜色偏差、LOGO 错字或消失、结构改动、细节丢失、无依据文案、占位词入画、虚构参数认证功效、照搬参考图、重复构图、低清晰度",
                "严格还原产品外观、颜色、LOGO、结构和细节；不得增加、删除、改写商品原有 LOGO 或标识",
            ].join("；\n");
            return { slotId: screen.slotId, title: screen.title, duty: screen.duty, prompt, imagePromptContractVersion: 1 as const };
        });
    }
    const set = createEcommerceShotSetFromSlots(flow.set.name, flow.set.slots);
    return screens.map((screen) => {
        const shot = set.shots.find((item) => item.id === screen.slotId);
        const lines = shot ? ecommerceShotLines(shot) : [];
        const preset = ecommerceShotPreset(screen.presetId);
        const prompt = lines.length ? `${preset?.hint || screen.duty}。${lines.join("。")}` : screen.duty;
        return { slotId: screen.slotId, title: screen.title, duty: screen.duty, prompt };
    });
}


/**
 * 默认的分析指令——**面板里可改的那一段**。
 *
 * 拆出来的理由：写提示词这件事上每个店铺都有自己的说法（品类不同、平台不同、
 * 自己攒的模板不同），把整段写死在代码里等于让人适应工具。所以「怎么写」交出去，
 * 「要写哪些行、依据什么事实」留在系统手里——见 ecommerceSuiteDraftPrompt。
 */
export const ECOMMERCE_SUITE_DIRECTOR_PROMPT = [
    "你是电商出图导演。看随附的商品实拍，读下面的商品档案，为这一套的每一张图规划文案、版式和一条**可以直接拿去出图的无字底图提示词**。",
    "图就在这次请求里，直接看图，不要说自己看不到。",
    "",
    "【无字底图提示词必须说清三件事】",
    "1. 画面主体与状态：商品怎么摆、在人身上还是在台面上、占画面多大比例",
    "2. 场景与背景：纯白底、真实生活场景、还是带氛围的背景",
    "3. 光线与镜头：什么光、什么机位、什么景别与景深",
    "文案独立输出，不得写进无字底图提示词；价格没有卖家确认值时必须留空。",
    "",
    "【每一张都不一样】",
    "- 主图：干净、商品占七成以上、通常无字或只有一行标题",
    "- 模特上身：画面里要有人、有穿着或佩戴的状态，能看出合不合身",
    "- 细节图：近、能看到材质与工艺的纹理",
    "- 场景图：有生活痕迹，不能像影棚",
    "**不要把同一套描述复制到每一张**——九张一样的图比九张都没有更浪费。",
    "",
    "【硬规矩】",
    "1. 不许出现「暂未提供」「暂无」「不予填写」这类说明，也不许说你看不到图。你不是在汇报缺失，你是在写要出图的指令。",
    "2. 不许编造档案与图里都没有的材质、参数、认证、销量、价格、功效。事实不够时换一个不依赖该事实的写法（使用感受、使用建议、场景）。",
    "3. 广告法极限词一律不用：国家级、最高级、最佳、第一、唯一、顶级、极致、完美、万能、永久、100%、全网最低、销量领先、绝对安全。",
    "4. 图片模型只生成无文字、Logo 和水印的底图；标题、副文案、价格与行动引导必须作为独立文案输出。",
].join("\n");

const ECOMMERCE_DETAIL_SUITE_DIRECTOR_PROMPT = [
    "你是电商详情页出图导演。看随附的商品实拍和商品档案，为十屏详情页逐屏规划一条可以直接拿去出图的完整生图提示词，并为每屏写一份独立可见文案。",
    "图就在这次请求里，直接看图，不要说自己看不到。",
    "完整生图提示词与独立文案一起交给图片模型，一次生图完成画面与图上文字；同一份独立文案同时保留为结构化字段，只用于本地编辑和排版回退。",
    "",
    "【最后一段写什么】只写画面，四段固定顺序：",
    "1. 画面构成：3:4 竖版，每屏只讲一个核心主题，说明信息层级、场景、光线、镜头和留白。",
    "2. 产品摆放：说明商品的位置、角度、景别、占比和使用状态。",
    "3. 视觉风格：说明整套统一的色彩、字体气质、材质感和商业详情页氛围。",
    "4. 负面提示词：排除商品变形、错色、LOGO 错误、结构改动、细节丢失、虚构信息、照搬参考图和低清晰度。",
    "最后一段只写画面：主标题、副标题、卖点模块不要写进最后一段，不得在最后一段重复文案文字、卖点模块或其它营销内容。最终提示词里的这三项由共享编译器按独立文案列补齐（文案列为空就明确不生成），排布位置写在版式 preset 列。",
    "",
    "【动态规划】",
    "根据商品形态、投放平台、已确认事实和本屏主题动态决定画面构成与产品摆放；不得把同一构图复制到十屏。",
    "不要把同一套描述复制到每一张；十屏主题是信息结构，不是十套固定拍法。",
    "只学习参考图的信息层级、氛围和排版逻辑，不照搬参考图的商品、构图、文字或品牌。",
    "",
    "【商品与事实合同】",
    "每屏都必须强调：严格还原产品外观、颜色、LOGO、结构和细节，不得增加、删除或改写商品原有 LOGO 与标识。",
    "涉及参数、认证、功效时，商品图和档案没有明确依据即视为事实缺失，禁止展示相关宣称或数值；独立可见文案字段留空，完整生图提示词不得包含“待补充”等占位词。",
    "标题、副标题、价格和行动引导只写进独立文案列，它们是图上文字的**唯一**来源；最后一段只写画面四段（画面构成、产品摆放、视觉风格、负面提示词），不得在最后一段重复文案文字、卖点模块或其它营销内容。",
].join("\n");

/** 面板里改过的就用改过的，没改过就用默认。空串代表「没改过」。 */
export function ecommerceSuiteDirectorPrompt(override: string | undefined, flow?: EcommerceOneClickFlow) {
    if (override?.trim()) return override.trim();
    if (flow?.id === "detail") return ECOMMERCE_DETAIL_SUITE_DIRECTOR_PROMPT;
    const direction: Partial<Record<EcommerceOneClickFlowId, string>> = {
        detail: "本次是商品详情页：按用户理解顺序组织画面，从需求/痛点、解决方案、证据细节到使用与保障；相邻屏承担不同信息任务，整套阅读连贯。",
        main: "本次是商品搜索列表主图：优先保证缩略图识别与点击；主图干净突出商品，其余分别呈现核心卖点、真实场景、工艺细节和规格，不要做成长图分屏。",
        wear: "本次是模特上身图：每张明确人物姿态、穿着/佩戴状态、取景范围及商品与身体的比例；正面、局部、背面等视角按各行职责区分，商品外观忠于实拍。",
        seed: "本次是社交内容平台种草图：采用可信的生活化场景与自然表达，封面负责吸引注意，后续补充场景、上身体验和细节；避免电商详情页式硬广排版。",
    };
    return flow ? `${ECOMMERCE_SUITE_DIRECTOR_PROMPT}\n\n【本套专属要求】${direction[flow.id] || ""}` : ECOMMERCE_SUITE_DIRECTOR_PROMPT;
}

/**
 * 分析提示词：让文本模型读图 + 读档案，为每一张写一条完整的出图提示词。
 *
 * **分成两半：导演指令（用户可改）+ 任务清单（系统追加）。**
 *
 * 后一半不交给用户改，因为它不是「怎么写」而是「写哪些」——
 * 商品事实来自卖家确认过的档案（提示词里再抄一遍只会走样）、
 * 屏次与职责来自当前那张表、输出格式是解析器认的那一种。
 * 少了任何一段，用户手里的自定义提示词都会产出解析不了的东西，
 * 而那时他不会觉得是自己少写了格式，只会觉得功能坏了。
 *
 * **请求快照就是结构契约。** 用户可先在表格中增删、换序，或填写计划张数；
 * 分析模型只补全这份快照的内容，不能靠漏行、换序或自造槽位替用户改结构。
 *
 * @param rows 当前那张表——屏次与职责的真相。
 * @param director 面板里改过的导演指令；空着用 ECOMMERCE_SUITE_DIRECTOR_PROMPT。
 */
/**
 * 整组统一的几条：平台 / 语言 / 色彩美学 / 字体气质 / 风格参考图。
 *
 * 它们是**这一套的属性**，不是某一张的——同一套图里色调、字体、说什么语言
 * 必须一致，逐张去写就会写歪。所以它们进分析提示词（模型据此写每一条），
 * 也进生成时的约束块（见 resolveEcommerceInputs 读的 ecommerceStyle）。
 */
export type EcommerceSuiteUniform = {
    prompt?: string;
    styleReferenceNames?: string[];
    platformId?: string;
    languageId?: string;
    style?: EcommerceStyle;
    /**
     * 风格参考图——「照这个调性来，不要复刻画面」。
     *
     * 传名字而不是布尔：上游那几张图本来就都作为商品实拍送进模型了，
     * 不说清是哪一张，模型没法知道「参照的是这张的调性」。
     */
    styleReferenceName?: string;
};

function uniformBlock(uniform: EcommerceSuiteUniform | undefined, flowId: EcommerceOneClickFlowId) {
    if (!uniform) return [];
    const lines: string[] = [];
    if (uniform.platformId) lines.push(ecommercePlatformGuidance(uniform.platformId, flowId));
    const language = ecommerceLanguageRule(uniform.languageId);
    if (language) lines.push(`【图上文字的语言】${language}`);
    if (uniform.style && uniform.prompt === undefined && !uniform.styleReferenceNames?.length) {
        const style = uniform.style;
        if (style.palette.length) lines.push(`【色彩美学】${style.name}——色板 ${style.palette.join(" ")}；${style.tone}；${style.mood}`);
        if (style.typography) lines.push(`【字体风格】${style.typography}。文字要按这个气质排，不要用默认的系统字体观感。`);
    }
    if (uniform.styleReferenceName) {
        lines.push(`【风格参考图】随附的图里，名为「${uniform.styleReferenceName}」的那张是风格参考。**只取它的调性、质感与氛围，不要复刻它的构图、商品和文字**——画面主体永远是本次这个商品。`);
    }
    if (uniform.styleReferenceNames?.length) {
        lines.push(`【独立视觉参考】随附的「${uniform.styleReferenceNames.join("」「")}」用于整组的光线、空间感、质感、配色关系和文字气质。商品实拍才是主体身份依据，不要把视觉参考里的商品和文字搬过来。`);
    }
    if (uniform.prompt?.trim()) lines.push(`【整组提示词】${uniform.prompt.trim()}`);
    if (uniform.prompt !== undefined || uniform.styleReferenceNames?.length) {
        lines.push("整组风格以商品图、独立视觉参考和用户提示词共同确定；没有指定的色彩与文字气质从图片推导，不套固定色板或字体。");
    }
    if (!lines.length) return [];
    return ["", ...lines, ""];
}

export function ecommerceSuiteDraftPrompt(flow: EcommerceOneClickFlow, profile: EcommerceProductProfile | undefined, rows: EcommerceSuiteRow[], director?: string | null, uniform?: EcommerceSuiteUniform) {
    const detail = flow.id === "detail";
    const parameters = (profile?.parameters || [])
        .filter((item) => item.name?.trim() && item.value?.trim())
        .map((item) => `- ${item.name.trim()}：${item.value.trim()}${item.source?.trim() ? `（来源：${item.source.trim()}）` : ""}`)
        .join("\n");
    const sellingPoints = (profile?.sellingPoints || [])
        .filter((item) => item.type?.trim() && item.content?.trim())
        .map((item) => `- ${item.type.trim()}：${item.content.trim()}${item.visualization?.trim() ? `（可视化：${item.visualization.trim()}）` : ""}`)
        .join("\n");
    const detailPageSuggestions = (profile?.detailPageSuggestions || [])
        .filter((item) => item.screen?.trim() || item.theme?.trim() || item.visual?.trim() || item.copy?.trim())
        .map((item) => `- ${[item.screen, item.theme, item.visual, item.copy].map((value) => value?.trim() || "").join(" | ")}`)
        .join("\n");
    const productName = profile?.name.trim();
    const facts = [
        productName && productName !== "未命名商品" ? `商品名：${productName}` : "",
        profile?.englishBrandName?.trim() ? `英文品牌名：${profile.englishBrandName.trim()}` : "",
        profile?.chineseBrandName?.trim() ? `中文品牌名：${profile.chineseBrandName.trim()}` : "",
        profile?.logoText?.trim() ? `LOGO文字：${profile.logoText.trim()}` : "",
        profile?.brandStyle?.trim() ? `品牌视觉风格：${profile.brandStyle.trim()}` : "",
        profile?.category.trim() ? `品类：${profile.category.trim()}` : "",
        profile?.productModel?.trim() ? `产品型号：${profile.productModel.trim()}` : "",
        profile?.appearance.trim() ? `外观：${profile.appearance.trim()}` : "",
        profile?.functions?.trim() ? `主要功能：${profile.functions.trim()}` : "",
        parameters ? `核心参数：\n${parameters}` : "",
        sellingPoints ? `五类核心卖点：\n${sellingPoints}` : "",
        profile?.marks.trim() ? `标识：${profile.marks.trim()}` : "",
        profile?.price.trim() ? `价格：${profile.price.trim()}` : "",
        profile?.audience.trim() ? `目标人群与使用场景：${profile.audience.trim()}` : "",
        profile?.painPoints?.trim() ? `使用痛点：${profile.painPoints.trim()}` : "",
        profile?.purchaseReasons?.trim() ? `购买理由：${profile.purchaseReasons.trim()}` : "",
        profile?.facts.trim() ? `卖点与依据：\n${profile.facts.trim()}` : "",
        detailPageSuggestions ? `详情页逐屏建议：\n${detailPageSuggestions}` : "",
        profile?.forbidden.trim() ? `禁止宣称与禁止改动：${profile.forbidden.trim()}` : "",
    ]
        .filter(Boolean)
        .join("\n");

    return [
        director === null ? "" : ecommerceSuiteDirectorPrompt(director, flow),
        "",
        "【商品事实】以下是卖家确认过的档案，优先级高于你从图里看到的东西：",
        facts || "（档案是空的——那就只依据图里看得见的东西写）",
        ...uniformBlock(uniform, flow.id),
        "【这一套现在按这几屏走】下面是用户已经定好的屏次与职责。逐行照它写；",
        "不得增删、换序或改槽位 id。调整屏数必须先由用户修改表格或计划张数。",
        ...rows.filter((row) => row.enabled !== false).map((row) => `${row.slotId} | ${row.title} | ${row.duty}`),
        "",
        detail
            ? "【详情页完整生图合同】每行最后一段只写画面，四段固定顺序：画面构成、产品摆放、视觉风格、负面提示词。标题、副标题、价格和行动引导只写进独立文案列；主标题、副标题、卖点模块三项不写进最后一段——不得在最后一段重复文案文字、卖点模块或其它营销内容。最终七项由共享编译器按独立文案列生成（主标题=headline，副标题=subhead 首行，卖点模块=subhead 其余行），文案列是图上文字的**唯一**来源；位置、字号层级与模块形态写在版式 preset 列。严格还原产品外观、颜色、LOGO、结构和细节；主标题、副标题、价格和行动引导等独立可见文案字段只能填写有依据的内容，缺少事实依据时留空，禁止填写“待补充”等占位词，完整生图提示词不得包含“待补充”等占位词；参数、认证、功效没有明确依据即视为事实缺失，禁止展示相关宣称或数值，且不得编造。"
            : "【底图与文案分层】图片模型只生成无文字、Logo 和水印的底图；文案独立输出，禁止写进底图提示词。没有卖家确认的价格时，价格字段必须留空。",
        `版式 preset 只能从以下现有值选择：${ECOMMERCE_LAYOUT_PRESETS.map((preset) => preset.id).join("、")}`,
        "【输出格式】每行一条，九段竖线分隔，不要输出任何其他内容（不要序号、不要解释、不要代码块）：",
        detail
            ? "槽位id | 这一屏的标题 | 这一屏要解决什么 | 主标题 | 副标题 | 价格 | 行动引导 | 版式 preset | 完整生图提示词"
            : "槽位id | 这一屏的标题 | 这一屏要解决什么 | 主标题 | 副文案 | 价格 | 行动引导 | 版式 preset | 无字底图提示词",
        "",
        "每行槽位 id 必须原样抄上面的，并保持相同顺序与数量。",
    ].join("\n");
}

/**
 * 解析分析结果。
 *
 * 吃三种形状：
 * - **九段**「槽位 | 标题 | 职责 | 主标题 | 副文案 | 价格 | 行动引导 | 版式 | 无字底图提示词」；
 * - **四段**「槽位 | 标题 | 职责 | 提示词」——现在的格式；
 * - **两段**「槽位 | 提示词」——早期格式，也吃，免得旧提示词直接失效。
 *
 * 容忍度与别处一致：序号、全角竖线、代码块、加粗星号都能吃掉；
 * 提示词里本来就有竖线时只切前几刀（剩下的拼回提示词里）。
 * 认不出来的行先跳过，后续合并阶段会按请求快照校验槽位、顺序和数量并拒绝残缺结果。
 *
 * 解析不出任何一行时返回 undefined，调用方据此保留当前表格并提示重试。
 */
export function parseEcommerceSuiteDraft(text: string, flow: EcommerceOneClickFlow): EcommerceSuiteRow[] | undefined {
    const skeleton = new Map(ecommerceSuiteSkeleton(flow).map((row) => [row.slotId, row]));
    const parsed: EcommerceSuiteRow[] = [];
    const seen = new Set<string>();
    const candidates = text
        .split("\n")
        .map((rawLine) =>
            rawLine
                .replace(/^[\s>*\-•\d.、)]+/, "")
                .replace(/[`*]/g, "")
                .trim(),
        )
        .filter(Boolean)
        .map((line) => line.split(/[|｜]/).map((part) => part.trim()))
        .filter((parts) => parts.length >= 2 && /^[A-Za-z0-9._-]{1,40}$/.test(parts[0]));
    // 旧四段提示词可含任意多竖线，不能只按段数判断。已知 preset 本身足以确认九段；
    // 未知紧凑标识还要求第六段像价格，避免把「右侧留白」这类旧提示词片段误判成版式。
    const ninePartBatch = candidates.some((parts) => {
        if (parts.length < 9) return false;
        if (ECOMMERCE_LAYOUT_PRESETS.some((preset) => preset.id === parts[7])) return true;
        const priceLike = !parts[5] || /^(?:[¥￥$€£]\s*)?\d[\d,.]*(?:\s*(?:元|起|元起))?$/.test(parts[5]);
        return priceLike && /^[\p{L}\p{N}_-]{1,40}$/u.test(parts[7]);
    });
    for (const parts of candidates) {
        const slotId = parts[0];
        const known = skeleton.get(slotId);
        const ninePart = ninePartBatch && parts.length >= 9;
        const fourPart = !ninePart && parts.length >= 4;
        const title = (fourPart || ninePart ? parts[1] : known?.title || slotId).replace(/^[^·]*·\s*/, "").trim() || slotId;
        const duty = (fourPart || ninePart ? parts[2] : known?.duty || "").trim();
        const layout = ninePart ? createEcommerceLayoutFromPreset(parts[7]) : undefined;
        if (ninePart && !layout) return undefined;
        if (seen.has(slotId)) continue;
        const prompt = (ninePart ? parts.slice(8) : fourPart ? parts.slice(3) : parts.slice(1))
            .join(" | ")
            .replace(/（这一张要解决：[^）]*）\s*$/, "")
            .trim();
        if (!prompt) continue;
        seen.add(slotId);
        if (!ninePart) {
            parsed.push({ slotId, title, duty: duty || known?.duty || title, prompt });
            continue;
        }
        parsed.push({
            slotId,
            title,
            duty: duty || known?.duty || title,
            prompt,
            copy: { headline: parts[3], subhead: parts[4], price: parts[5] || "", cta: parts[6] },
            layout: layout!,
            // 九段合同里文案与画面已经分开：这是新合同下规划出来的行。
            ...(flow.id === "detail" ? { imagePromptContractVersion: 1 as const } : {}),
        });
    }
    if (!parsed.length) return undefined;
    return parsed;
}

/**
 * 仅在模型逐项匹配请求快照时合并内容；跳过行原位保留。
 *
 * **结构归用户，内容归模型。** 屏次顺序、标题、职责是用户核对过的信息结构
 * （brief：手改结构保留），重新分析只该刷新提示词、文案与版式。早先这里用
 * `...parsed` 无条件覆盖 title/duty，等于模型每分析一次就把用户改过的屏名改回去。
 *
 * 但「没表态」和「改过」必须分开：默认骨架的 slotId/title/duty 原样未动、prompt 也还空着，
 * 说明这一屏只是还没轮到模型说话——这时采纳模型给的动态主题；否则用户的骨架会被锁死，
 * 十屏永远写着「品牌主视觉 / 核心卖点一」，模型读图读出来的真实主题一次都进不来。
 */
export function reconcileEcommerceSuiteDraftRows(previousRows: EcommerceSuiteRow[], parsedRows: EcommerceSuiteRow[]): EcommerceSuiteRow[] | undefined {
    const enabled = previousRows.filter((row) => row.enabled !== false);
    if (parsedRows.length !== enabled.length || parsedRows.some((row, index) => row.slotId !== enabled[index].slotId)) return undefined;
    // 默认骨架按 flow 取：槽位 id 前缀就是 flow，`detail-1` 不会跟 `main-1` 混。
    const skeletonOf = (slotId: string) => {
        const flow = ECOMMERCE_ONE_CLICK_FLOWS.find((item) => item.id === slotId.replace(/\d+.*$/, "").replace(/-$/, ""));
        return flow ? ecommerceSuiteSkeleton(flow).find((row) => row.slotId === slotId) : undefined;
    };
    let parsedIndex = 0;
    return previousRows.map((previous) => {
        if (previous.enabled === false) return previous;
        const parsed = parsedRows[parsedIndex++];
        const copy = parsed.copy ?? previous.copy;
        const layout = parsed.layout ?? previous.layout;
        // 「没表态」= 这一行还是那张默认骨架：标题职责逐字未改，提示词也还空着。
        const skeleton = skeletonOf(previous.slotId);
        const untouched = Boolean(skeleton) && previous.prompt.trim() === "" && previous.title.trim() === skeleton!.title.trim() && previous.duty.trim() === skeleton!.duty.trim();
        return {
            ...parsed,
            title: untouched || !previous.title.trim() ? parsed.title : previous.title,
            duty: untouched || !previous.duty.trim() ? parsed.duty : previous.duty,
            ...(copy ? { copy } : {}),
            ...(layout ? { layout } : {}),
            enabled: previous.enabled,
            stance: previous.stance,
            resultNodeId: previous.resultNodeId,
        };
    });
}

/**
 * 把某一行往前或往后挪一格。
 *
 * **顺序不是装饰**：出图按表的顺序提交，装订长图也按这个顺序接——
 * 「先讲痛点还是先摆参数」是详情页的叙事，改不了顺序就等于改不了叙事。
 */
export function ecommerceSuiteMoveRow(rows: EcommerceSuiteRow[], slotId: string, delta: number): EcommerceSuiteRow[] {
    const index = rows.findIndex((row) => row.slotId === slotId);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= rows.length) return rows;
    const next = [...rows];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    return next;
}

/**
 * 还有几张没有提示词。
 *
 * `total` 是这一套的张数：**从没分析过时（suite 是 undefined）缺的是全部**，
 * 不是零。卡片上要报这个数——报「0 条待写」会让用户以为已经可以出图了。
 */
export function ecommerceSuiteMissing(suite: EcommerceSuite | undefined, total: number) {
    if (!suite?.rows.length) return total;
    return suite.rows.filter((row) => row.enabled !== false && !row.prompt.trim()).length;
}

/** 提示词齐了没有。齐了才让批量出图。 */
export function ecommerceSuiteReady(suite: EcommerceSuite | undefined) {
    const rows = suite?.rows.filter((row) => row.enabled !== false) || [];
    return Boolean(rows.length && rows.every((row) => row.prompt.trim()));
}
