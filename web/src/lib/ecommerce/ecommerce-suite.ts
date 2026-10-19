/**
 * 电商套图提示词——一次出图的那张表。
 *
 * **这一版把「文案」换成了「提示词」。** 前面几版让模型写的是每屏的一句话文案
 * （标题 + 正文），然后指望编译时把它拼进提示词。那是错的：文案只是图上那几个字，
 * 而每张图真正要的是**一条完整的出图指令**——主图画什么、模特上身图画什么、
 * 细节图画什么，三者的构图、光线、景别、有没有人，全都不一样。
 *
 * 所以这一版的单位是「一张图一条提示词」：
 * - 分析时，文本模型读商品实拍 + 商品档案，为每一张写一条可直接出图的提示词；
 * - 用户在表里逐条看、逐条改；
 * - 出图时那一行原样交给图片模型（商品锁定与模特锁定由编译时自动前置）。
 *
 * 表里没有的图不生成，表里的字不编——提示词是用户核对过的那一份。
 */
import { createEcommerceShotSetFromSlots, ecommerceLanguageRule, ecommerceShotPreset } from "./ecommerce-recipes";
import { ecommerceShotLines, type EcommerceProductProfile, type EcommerceStyle } from "./ecommerce-contract";
import { ecommerceOneClickScreens, type EcommerceOneClickFlow, type EcommerceOneClickFlowId } from "./ecommerce-oneclick";
import { ecommercePlatform, type EcommercePlatformId } from "./ecommerce-platform-specs";

export type EcommerceSuiteRow = {
    /** 交付物槽位 id。它决定这一行对应画布上哪个节点，所以要稳定。 */
    slotId: string;
    /** 这一行是什么，例如「详情01 · 痛点共情」。**可改**——行业套路只是起手式。 */
    title: string;
    /** 这一张要解决什么。**可改**，而且它会被写进分析提示词当方向。 */
    duty: string;
    /**
     * 这一张的完整提示词。
     *
     * 画面主体、场景背景、光线镜头、图上要出现的文字——四件事全在这一条里。
     * 出图时原样交给图片模型；商品锁定与模特锁定由编译时自动前置，不写在这里，
     * 免得用户改提示词时把它们删掉。
     */
    prompt: string;
};

export type EcommerceSuite = {
    flow: string;
    rows: EcommerceSuiteRow[];
    /** 这份提示词是怎么来的：模型分析出来的，还是按行业套路铺的底。 */
    source: "draft" | "preset";
    updatedAt: string;
};

/**
 * 这一套实际用哪张表。
 *
 * **表是唯一真相，行业套路只是它的初始值。** 几张、每张干什么，由表决定——
 * 用户可以加行、删行、改职责，也可以让模型按提示词里的要求重新规划几屏。
 * 上一版把「九屏」写死在交付物常量里，用户改不动，只能接受行业套路给的九屏。
 *
 * 表是别的入口留下的（先跑过详情页、又打开主图）时退回默认骨架：槽位对不上，
 * 硬用会让每一行都找不到节点。
 */
export function ecommerceSuiteRows(flow: EcommerceOneClickFlow, suite: EcommerceSuite | undefined): EcommerceSuiteRow[] {
    if (suite?.flow === flow.id && suite.rows.length) return suite.rows;
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
 * 它不写文字——文字是这一件商品特有的，只有模型读了图或用户自己填才知道。
 * 所以预设里那句「不生成任何文字」要翻译一下：预设是本地叠字那套留下的，
 * 现在文字和画面一起交给模型。照抄那句会得到一张干净但没字的图，
 * 而用户以为自己已经点过「铺底」了。改成「留出位置 + 要什么字自己补」，
 * 没补就留空——不编，但也不假装这一张不需要字。
 */
export function ecommerceSuiteFromPresets(flow: EcommerceOneClickFlow): EcommerceSuiteRow[] {
    const screens = ecommerceOneClickScreens(flow);
    const set = createEcommerceShotSetFromSlots(flow.set.name, flow.set.slots);
    return screens.map((screen) => {
        const shot = set.shots.find((item) => item.id === screen.slotId);
        const lines = shot ? ecommerceShotLines(shot) : [];
        const preset = ecommerceShotPreset(screen.presetId);
        const prompt = lines.length
            ? `${preset?.hint || screen.duty}。${lines.map(restateCopyZone).join("。")}`
            : screen.duty;
        return { slotId: screen.slotId, title: screen.title, duty: screen.duty, prompt };
    });
}

/**
 * 把预设里的「不生成任何文字」翻成现在这条链路上的说法。
 *
 * 画面和文字一起交给模型之后，这一句是唯一会让人拿到空白图的地方——
 * 而且它不报错，用户只会觉得模型没听话。
 */
function restateCopyZone(line: string) {
    return line.replace(/，不生成任何文字[^。]*/, "；图上文字以这条提示词里逐字引号的内容为准，没有就留空位、不要自己编字");
}

/**
 * 默认的分析指令——**面板里可改的那一段**。
 *
 * 拆出来的理由：写提示词这件事上每个店铺都有自己的说法（品类不同、平台不同、
 * 自己攒的模板不同），把整段写死在代码里等于让人适应工具。所以「怎么写」交出去，
 * 「要写哪些行、依据什么事实」留在系统手里——见 ecommerceSuiteDraftPrompt。
 */
export const ECOMMERCE_SUITE_DIRECTOR_PROMPT = [
    "你是电商出图导演。看随附的商品实拍，读下面的商品档案，为这一套的每一张图写一条**可以直接拿去出图的完整提示词**。",
    "图就在这次请求里，直接看图，不要说自己看不到。",
    "",
    "【一条提示词里必须说清四件事】",
    "1. 画面主体与状态：商品怎么摆、在人身上还是在台面上、占画面多大比例",
    "2. 场景与背景：纯白底、真实生活场景、还是带氛围的背景",
    "3. 光线与镜头：什么光、什么机位、什么景别与景深",
    "4. 图上文字：这一张要不要字；要的话把文字**逐字用引号写进提示词**，并说清位置与大小",
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
    "4. 图上文字要逐字写出来并用引号包住；不要让模型自己发挥文字内容。",
].join("\n");

/** 面板里改过的就用改过的，没改过就用默认。空串代表「没改过」。 */
export function ecommerceSuiteDirectorPrompt(override: string | undefined, flow?: EcommerceOneClickFlow) {
    if (override?.trim()) return override.trim();
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
 * **屏数不是固定的。** 表里给的是「照这么写」，但导演指令里可以要求不同的屏数
 * （用户在自己的提示词里写「拆成 6 屏，不要参数表」），模型返回几行就用几行——
 * 输出格式那一段明确说了这件事。
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

function uniformBlock(uniform: EcommerceSuiteUniform | undefined) {
    if (!uniform) return [];
    const lines: string[] = [];
    const platform = uniform.platformId ? ecommercePlatform(uniform.platformId as EcommercePlatformId) : undefined;
    if (platform) {
        // 平台口径是硬规范（文字面积上限、白底要求、禁促销词），不是审美偏好——
        // 写进提示词是让模型一次画对，而不是等上架被驳回再返工。
        const main = platform.roles.main;
        const detail = platform.roles.detail;
        lines.push(`【投放平台】${platform.name}`);
        if (main?.note) lines.push(`· 主图口径：${main.note}`);
        if (detail?.note) lines.push(`· 详情口径：${detail.note}`);
    }
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

export function ecommerceSuiteDraftPrompt(flow: EcommerceOneClickFlow, profile: EcommerceProductProfile | undefined, rows: EcommerceSuiteRow[], director?: string, uniform?: EcommerceSuiteUniform) {
    const facts = [
        profile?.name.trim() ? `商品名：${profile.name.trim()}` : "",
        profile?.category.trim() ? `品类：${profile.category.trim()}` : "",
        profile?.appearance.trim() ? `外观：${profile.appearance.trim()}` : "",
        profile?.marks.trim() ? `标识：${profile.marks.trim()}` : "",
        profile?.price.trim() ? `价格：${profile.price.trim()}` : "",
        profile?.audience.trim() ? `目标人群与使用场景：${profile.audience.trim()}` : "",
        profile?.facts.trim() ? `卖点与依据：\n${profile.facts.trim()}` : "",
    ].filter(Boolean).join("\n");

    return [
        director === " " ? "" : ecommerceSuiteDirectorPrompt(director),
        "",
        "【商品事实】以下是卖家确认过的档案，优先级高于你从图里看到的东西：",
        facts || "（档案是空的——那就只依据图里看得见的东西写）",
        ...uniformBlock(uniform),
        "【这一套现在按这几屏走】下面是表里已经定好的屏次与职责。照它写；",
        "但如果上面的导演指令要求了不同的屏数或不同的分工，**就按导演指令来**——",
        "你返回几行，这一套就是几行。",
        ...rows.map((row) => `${row.slotId} | ${row.title} | ${row.duty}`),
        "",
        "【输出格式】每行一条，四段竖线分隔，不要输出任何其他内容（不要序号、不要解释、不要代码块）：",
        "槽位id | 这一屏的标题 | 这一屏要解决什么 | 这一张的完整提示词",
        "",
        "照表走时槽位 id 原样抄上面的；你重新规划了几屏，就自己给每行起一个短 id（如 detail-1、detail-2……）。",
    ].join("\n");
}

/**
 * 解析分析结果。
 *
 * 吃两种形状：
 * - **四段**「槽位 | 标题 | 职责 | 提示词」—— 现在的格式，**模型可以重新规划屏数**，
 *   它返回几行这一套就是几行（用户在自己的导演指令里要求「拆成 6 屏」时走这条）。
 * - **两段**「槽位 | 提示词」—— 早期格式，也吃，免得旧提示词直接失效。
 *
 * 容忍度与别处一致：序号、全角竖线、代码块、加粗星号都能吃掉；
 * 提示词里本来就有竖线时只切前几刀（剩下的拼回提示词里）。
 * 认不出来的行跳过——那一行在表里是空的，用户看得见；报错会让整次分析白跑。
 *
 * 解析不出任何一行时返回 undefined，调用方据此决定要不要退回拍法预设。
 */
export function parseEcommerceSuiteDraft(text: string, flow: EcommerceOneClickFlow): EcommerceSuiteRow[] | undefined {
    const skeleton = new Map(ecommerceSuiteSkeleton(flow).map((row) => [row.slotId, row]));
    const parsed: EcommerceSuiteRow[] = [];
    const seen = new Set<string>();
    for (const rawLine of text.split("\n")) {
        const line = rawLine.replace(/^[\s>*\-•\d.、)]+/, "").replace(/[`*]/g, "").trim();
        if (!line) continue;
        const parts = line.split(/[|｜]/).map((part) => part.trim());
        if (parts.length < 2) continue;
        const slotId = parts[0].trim();
        // 槽位 id 只认短标识符。模型有时会写一行解释（「以上是九屏提示词，请核对 | …」），
        // 中文和空格都不该被当成屏次——那样表里会多出一行，用户还得出图删它。
        if (!/^[A-Za-z0-9._-]{1,40}$/.test(slotId)) continue;
        if (seen.has(slotId)) continue;
        const known = skeleton.get(slotId);
        const fourPart = parts.length >= 4;
        const title = (fourPart ? parts[1] : known?.title || slotId).replace(/^[^·]*·\s*/, "").trim() || slotId;
        const duty = (fourPart ? parts[2] : known?.duty || "").trim();
        const prompt = (fourPart ? parts.slice(3) : parts.slice(1))
            .join(" | ")
            .replace(/（这一张要解决：[^）]*）\s*$/, "")
            .trim();
        if (!prompt) continue;
        seen.add(slotId);
        parsed.push({ slotId, title, duty: duty || known?.duty || title, prompt });
    }
    if (!parsed.length) return undefined;
    return parsed;
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
    return suite.rows.filter((row) => !row.prompt.trim()).length;
}

/** 提示词齐了没有。齐了才让批量出图。 */
export function ecommerceSuiteReady(suite: EcommerceSuite | undefined) {
    return Boolean(suite && suite.rows.length && suite.rows.every((row) => row.prompt.trim()));
}
