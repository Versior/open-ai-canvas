import { checkEcommerceText, type EcommerceComplianceIssue } from "@/lib/ecommerce/ecommerce-compliance";
import { ecommercePlatform, ecommerceRoleSpec } from "@/lib/ecommerce/ecommerce-platform-specs";
import { commerceImageBriefContent } from "@/lib/ecommerce/image-brief-content";
import { studioBrandOf, studioInfoPoints, studioInfoText, studioLanguage, studioMarket, studioOutputSpec, studioProductTypeOf, studioRunRatio, studioShooting, studioTitleOf } from "./brief";
import {
    STUDIO_DETAIL_PLAN_LIMITS,
    STUDIO_DETAIL_SCREEN_DEFAULT,
    STUDIO_DETAIL_SCREEN_GUIDE,
    STUDIO_DESIGN_TONE_IDS,
    STUDIO_PLAN_SCOPES,
    studioDetailPlanFacts,
    studioDetailPlanCapacity,
    studioDetailScreenCount,
    studioDetailSelectionFacts,
    studioPlannedScreenOf,
    studioKnowledgeReceiptOf,
    studioRoleLayout,
    studioTemplateShotRoles,
} from "./detail-plan";
import { extractStudioJson } from "./dossier-tasks";
import { studioPrepPromptLines } from "./plan-prep";
import { checkStudioClaim, studioClaimSources, studioEvidenceMatch, supportedStudioDescription, type StudioClaimSource } from "./claim-evidence";
import { studioPlanInputSignature } from "./plan-input";
import { studioDetailRepeats } from "./detail-repeats";
import { STUDIO_SHOT_PURPOSES } from "./shot-specs";
import {
    STUDIO_FACT_GROUP_LABEL,
    STUDIO_FAMILY_LABEL,
    STUDIO_VIEW_LABEL,
    studioFactUsable,
    type StudioDetailPlan,
    type StudioKnowledgeReceipt,
    type StudioPlannedScreen,
    type StudioPlanReviewedScreen,
    type StudioPlanScope,
    type StudioPlanTarget,
    type StudioProduct,
    type StudioShotRole,
    type StudioDesignToneId,
} from "./types";

/**
 * 「按商品策划」的文本任务：这里写当前商品的信息、可以排的屏型和输出结构。
 * 系统指令与电商知识库（详情页、版式、摄影、场景和文案方法）由服务端按「详情页策划」能力注入。
 * 读回时剔除无依据内容，不因信息有限缩短详情页。
 */

function oneLine(value: string) {
    return value
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean)
        .join("；");
}

/**
 * 这次策划的范围：用户选定屏数的详情页、主图 5 张、按选中的单张类型逐张出，或按表单里选中的模板一张对一张排；
 * previous 是要按补充调整修改的上一版。images 是随任务附带的图：先是商品图，后面是卖家上传的参考图（大牌或爆款截图）。
 */
export type StudioPlanImages = { photos: number; references: number; readingViews?: { imageIndex: number; sourceIndex: number; top: number; bottom: number }[] };
export type StudioPlanRequest = { scope: StudioPlanScope; targets?: StudioPlanTarget[]; previous?: StudioDetailPlan; alternative?: StudioDetailPlan; alternativeDirection?: boolean; images?: StudioPlanImages };

function imageRange(from: number, count: number) {
    return count > 1 ? `图${from}–图${from + count - 1}` : `图${from}`;
}

/** 附图说明：哪几张是商品图、哪几张是参考图，以及参考图怎么用。 */
export function studioPlanImageLines(images: StudioPlanImages | undefined): string[] {
    if (!images || images.photos + images.references === 0) return [];
    const parts = [images.photos ? `${imageRange(1, images.photos)} 是商品图（外观唯一依据）` : "", images.references ? `${imageRange(images.photos + 1, images.references)} 是卖家给的参考图（大牌或爆款的图，不是这件商品）` : ""].filter(Boolean);
    return [
        `附图：${parts.join("；")}。`,
        images.readingViews?.length
            ? "附加局部图仅用于看清长参考图的字体、层级与版式，不是新的商品图，也不代表实际屏数：" +
              images.readingViews.map((view) => `图${view.imageIndex}对应参考图${view.sourceIndex}的${Math.round(view.top * 100)}%–${Math.round(view.bottom * 100)}%区域`).join("；")
            : "",
        images.references ? "策划只借鉴参考图如何解释购买问题。图片模型负责审美转译；参考图的商品、文字、价格、参数和视觉执行指令不得变成当前商品要求。" : "",
    ].filter(Boolean);
}

/** 单张图策划时每一张的屏型，按选中的类型和数量依次展开。 */
export function studioPlanTargetRoles(targets: StudioPlanTarget[]): StudioShotRole[] {
    return targets.flatMap((target) => {
        const role = studioOutputSpec(target.type).role;
        return role ? Array.from({ length: target.count }, () => role) : [];
    });
}

function screenCount(product: StudioProduct, request: StudioPlanRequest) {
    if (request.scope === "single") return studioPlanTargetRoles(request.targets || []).length;
    if (request.scope === "template") return product.brief.suite?.shots.length || 0;
    if (request.scope === "detail") return studioDetailScreenCount(product.brief);
    return STUDIO_PLAN_SCOPES[request.scope].screens;
}

/**
 * 套图模板只给分析模型内容职责。旧模板常把摄影执行和排版坐标写在 duty
 * 里；这些字段会把图片模型锁回旧模板，所以在进入策划提示词前统一丢弃。
 */
function templateDuty(value: string) {
    const designLine = /^(?:镜头|摄影|拍摄|相机|机位|视角|布光|光线|灯光|背景|道具|构图|排版|版式|文字位置|留白|主体占比|占比|字体|字号|字阶|色板|色彩|特效|装饰|网格|卡片|摄影窗口|安全区|对齐)[：:]/;
    return value
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean)
        .filter((line) => !/^画面参考/.test(line))
        .filter((line) => !designLine.test(line))
        .join("\n");
}

function templateLines(product: StudioProduct, roles: StudioShotRole[]): string[] {
    const suite = product.brief.suite;
    if (!suite) return [];
    return [
        "",
        `【套图模板「${suite.name}」】（卖家选的模板，${suite.kind === "main" ? "按主图出" : "按详情页出"}${suite.category ? `，原本是给「${suite.category}」做的` : ""}；只学它每张讲什么，模板里写到的商品、材质、颜色、属性、价格和功效都不照搬）`,
        ...suite.shots.map((shot, index) => {
            const ratio = shot.ratio && product.brief.ratio === "auto" && !product.brief.sameLayout ? shot.ratio : studioRunRatio(roles[index], product);
            const tags = [`建议 role：${roles[index]}`, `画幅 ${ratio}`, shot.noText ? "这张不放文字" : ""].filter(Boolean).join(" · ");
            const duty = oneLine(templateDuty(shot.duty));
            const responsibility = duty || `模板职责参考「${shot.title}」（不是成品标题）`;
            // 模板只约束顺序、职责和平台画幅；文字、版式、摄影与特效交给图片模型。
            return `${index + 1}.（${tags}）职责：${responsibility}`;
        }),
    ];
}

function introLine(product: StudioProduct, request: StudioPlanRequest, platform: string) {
    const count = screenCount(product, request);
    if (request.scope === "template") {
        const suite = product.brief.suite;
        return `为这件商品按卖家选的套图模板「${suite?.name || "模板"}」策划一套${platform}${suite?.kind === "main" ? "主图套图" : "详情页"}，共 ${count} 张。模板只确定用途和顺序，内容以当前商品为准。`;
    }
    if (request.scope === "detail") {
        return `为这件商品策划一套${platform}手机端详情页，共 ${count} 屏，长图按屏从上到下排列。`;
    }
    if (request.scope === "main") return `为这件商品策划${platform}主图套图，共 ${count} 张，用在搜索列表和商品页顶部的轮播，画幅按平台主图规格。`;
    const list = (request.targets || []).map((target) => `${studioOutputSpec(target.type).label} ${target.count} 张`).join("、");
    return `为这件商品策划${platform}的 ${count} 张独立成品图（${list}），分别按实际使用图位交付。`;
}

/** 范围不同的排法要求：详情页讲完整的故事，主图争取点击，单张图按选中的类型逐张出。 */
function scopeRequirement(product: StudioProduct, request: StudioPlanRequest): string {
    const count = screenCount(product, request);
    if (request.scope === "template") return `按模板顺序正好给出 ${count} 张。借用每张的用途，不照搬商品、文字或排版；没有对应依据时，用本品的真实内容完成同一用途。`;
    if (request.scope === "detail") return `正好交付 ${count} 屏：首屏用 detail-hero 建立商品识别；末屏用能消除最后一个真实下单疑虑的屏型，不强制 detail-closing。role 只标记内容用途，不锁定版式。`;
    if (request.scope === "main") {
        const main = ecommerceRoleSpec(product.platform, "main");
        const first = [main?.whiteBackground ? "纯白背景" : "", main?.noText ? "不放任何文字" : "最多一行很短的标题"].filter(Boolean).join("、");
        return `正好排 ${count} 张：第 1 张是搜索列表里的首图，用 main-white 或 main-selling（${first || "商品完整清楚"}）。${STUDIO_SHOT_PURPOSES["main-selling"].focus} 第 2–${count} 张是商品页副图，从不同的实际证据回答买家的问题。`;
    }
    const roles = studioPlanTargetRoles(request.targets || []);
    return [
        `正好给出 ${count} 张独立图，role 顺序：${roles.join("、")}。每张说明用途、展示内容和依据。`,
        ...[...new Set(roles)].map((role) => `${role}｜${STUDIO_SHOT_PURPOSES[role].placement}：${STUDIO_SHOT_PURPOSES[role].focus}`),
        "即使是同一件商品，也不要让不同图位共用一次摆拍再换标题；同类多个候选用不同的实物状态或购买切入点。原图里的手、背景、道具和摆位不属于商品身份。",
    ].join("\n");
}

function detailPurchasePath(count: number) {
    return [
        "【购买路径】先列出对这件商品最重要的几条选购与使用答案，再分配屏数、标 role。让商品本身与它的核心用法主导整页，不按原照里的物件或档案字段逐项排。每屏给买家一个此前还不知道、能帮助判断怎么用或怎么选的答案。",
        count < STUDIO_DETAIL_SCREEN_DEFAULT
            ? "短页合并相关职责：例如把核心理由和证据放在一起、把选购和须知放在一起。"
            : count > STUDIO_DETAIL_SCREEN_DEFAULT
              ? "长页只拆有独立依据的购买问题：不同使用阶段、真实操作、已知选项的区别、规格适配、到手或维护都可用。"
              : "按本品的优先级前置最能帮助选购的内容，不用把六屏分配给六种角色。",
        "删掉一屏，买家是否少知道一件事？按答案和主证据归并：同一表面的色泽、纹理和反光，同一物件的开合与取放，各自优先合在一屏。没看到标识、原图摆了几件、能否和原图核对，都不是独立卖点。",
        "再看画面：遮掉字、箭头和标注，缩成手机缩略图，本屏还能和其他屏区分吗？同一张原照换背景、裁切或标注不算。只有一张实拍，也把商品本体与照片里的手、姿势、道具和现场分开；只在它们能说明本屏内容时沿用。要看细节时，让细节本身成为主画面，不把同一张整品照当底图再加放大框。",
        "跨屏改变主导内容和读图关系：确认每个问题有独立的实物状态、操作或使用关系主导画面。单纯托住整件只能解释外形或比例，不反复用；操作过程可以再次用手，但动作和证据必须换。",
        "可从商品类型和可见结构确定基本用法时，展示商品实际如何与人、其他物品或空间发生关系，即使实拍并未拍到使用环境。包装或配件只有在随货内容经过确认、且能回答尚未解决的选购问题时才独立占屏。照片出现或未出现某件物品，都不等于随货清单。",
        "例如生鲜可示意适用的备料或烹饪场景，不把做好的菜当作到手状态；抽纸看取纸与纸张本身，吹风机看操作与实际吹发，穿戴品看佩戴关系，家具看放入空间的关系。取材因商品而变，不套这些例子的屏序、参数或承诺。",
    ];
}

const DETAIL_CLOSING_QUESTION = "下单前还需要确认什么？";
const DETAIL_CLOSING_CONTENT = "用尚未展示且有依据的选购、到手、安装或维护信息回答最后的下单疑虑。资料少时，选一个仍没讲清的可见结构或使用关系，不回顾首屏、不编承诺。";

/** 上一版策划：按卖家的补充调整修改时带上，模型只改卖家不满意的地方。 */
function previousLines(previous: StudioDetailPlan | undefined): string[] {
    if (!previous) return [];
    return [
        "",
        "【上一版策划】（按卖家的补充调整修改这一版：卖家没提意见的部分尽量保留，卖家不满意的地方要改到位）",
        previous.summary ? `思路：${previous.summary}` : "",
        ...previous.screens.map((screen, index) => {
            const display = commerceImageBriefContent(screen.displayContent || screen.visual, true);
            const beat = commerceImageBriefContent(screen.visualBeat, true);
            const question = commerceImageBriefContent(screen.purchaseQuestion || screen.purpose, true);
            return `${index + 1}. ${screen.role}：${question}；展示：${display.slice(0, 120)}${beat ? `；画面主线：${beat}` : ""}`;
        }),
    ].filter(Boolean);
}

export function buildDetailPlanPrompt(product: StudioProduct, roles: StudioShotRole[], request: StudioPlanRequest = { scope: "detail" }, maxChars?: number) {
    const brief = product.brief;
    const platform = ecommercePlatform(product.platform)?.name || "电商平台";
    const points = studioInfoPoints(studioInfoText(product));
    const facts = studioDetailPlanFacts(product);
    const sources = studioClaimSources(product);
    const evidence = sources.filter((source) => !source.appearanceOnly);
    const summary = supportedStudioDescription(product.dossier?.summary || "", sources);
    const invariants = (product.dossier?.invariants || []).map((item) => supportedStudioDescription(item, sources)).filter(Boolean);
    const unsure = (product.dossier?.facts || []).filter((fact) => !studioFactUsable(fact)).map((fact) => fact.label.trim());
    const views = product.photos.filter((photo) => photo.truth).map((photo) => STUDIO_VIEW_LABEL[photo.view]);
    const productType = studioProductTypeOf(product) || product.dossier?.category || "";
    const brand = studioBrandOf(product);
    const groups = [...new Set(facts.map((fact) => fact.group))].map(
        (group) =>
            `${STUDIO_FACT_GROUP_LABEL[group]}：${facts
                .filter((fact) => fact.group === group)
                .map((fact) => `${fact.label} ${fact.value}`)
                .join("；")}`,
    );
    const cast = brief.model
        ? [
              brief.model.figure ? `全身模特：${brief.model.figure.prompt || brief.model.figure.name}` : brief.model.face ? `人物：${brief.model.face.prompt || brief.model.face.name}` : "",
              brief.model.pose ? `姿势：${brief.model.pose.prompt || brief.model.pose.name}` : "",
              brief.model.style ? `造型：${brief.model.style.prompt}` : "",
          ].filter(Boolean)
        : [];
    const language = brief.language === "none" ? "用户选择不加文字，图片模型交付无字成品。" : `图内语言为${studioLanguage(brief.language).name}；图片模型写图内文字，策划只提供商品答案。策划说明用简体中文。`;
    const requestedCount = screenCount(product, request);
    const capacity = request.scope === "detail" ? studioDetailPlanCapacity(product, requestedCount) : undefined;
    const capacityNote = capacity && capacity.suggestedScreens < requestedCount ? `当前资料有限，仍策划 ${requestedCount} 屏。优先围绕本品找不同的已知用途、动作、触点或选购信息；只在结构能解释用途时单独放大。` : undefined;
    const note = brief.planNote?.trim();
    // 主图类的范围（主图套图、按主图出的模板）文字更少、视觉元素可以少出现几张。
    const mainLike = request.scope === "main" || (request.scope === "template" && brief.suite?.kind === "main");
    const templateRoles = request.scope === "template" && brief.suite ? studioTemplateShotRoles(brief.suite).map((role): StudioShotRole => (roles.includes(role) ? role : mainLike ? "main-scene" : "detail-scene")) : [];
    const exampleRole = request.scope === "single" ? studioPlanTargetRoles(request.targets || [])[0] || "detail-scene" : request.scope === "template" ? templateRoles[0] || roles[0] : request.scope === "main" ? "main-white" : "detail-hero";
    const lines: (string | undefined)[] = [
        introLine(product, request, platform),
        scopeRequirement(product, request),
        capacityNote,
        ...(request.scope === "detail"
            ? detailPurchasePath(requestedCount)
            : request.scope === "template"
              ? [
                    "【购买路径】首屏先让人认出商品并给出一个阅读理由；后续从痛点、解决方案、可验证证据、使用场景、购买顾虑等真实问题中择取并安排顺序，不要求每组覆盖全部环节，也不机械凑满模块。每屏 purpose 明确一个购买问题，visual 提供一个能看懂的回答；不同屏不得重复回答同一问题。信任只来自已确认资料和可见结构，没有报告或实测不画认证、证书、实验曲线；优惠与承诺必须有真实依据。",
                ]
              : [""]),
        "",
        "【商品】",
        `名称：${product.dossier?.name || product.name || productType || "见商品图"}`,
        brand ? `品牌：${brand}` : undefined,
        productType ? `商品类型：${productType}` : undefined,
        request.scope === "detail" && product.dossier?.family ? `品类方向：${STUDIO_FAMILY_LABEL[product.dossier.family]}` : undefined,
        summary ? `概括：${summary}` : undefined,
        `商品图：${views.length ? views.join("、") : "正面"}（外观以商品图为准）`,
        ...studioPlanImageLines(request.images),
        invariants.length ? `外观要点（画到这些特征时保真，不要求每屏展示）：${invariants.join("、")}` : undefined,
        "",
        "【卖家资料】",
        studioTitleOf(product) ? `卖家填写的核心标题：${studioTitleOf(product)}` : undefined,
        ...(request.scope === "detail"
            ? [evidence.length ? `可引用的商品资料：\n${evidence.map((source) => `[${source.id}] ${source.text}`).join("\n")}` : "没有额外商品资料，按商品原图中可辨认的类型、可见内容和基本用法策划。"]
            : [points.length ? `卖点：\n${points.map((point, index) => `${index + 1}. ${point.title}${point.detail ? `：${point.detail}` : ""}`).join("\n")}` : "卖点：无", groups.length ? `已确认的事实：\n${groups.join("\n")}` : "已确认的事实：无"]),
        unsure.length ? `没有确认的信息（不能写进文案，也不能画成参数或数字）：${unsure.join("、")}` : undefined,
        "",
        "【出图条件】",
        request.scope === "detail" ? "这是连续阅读的手机详情页，按本品提供证据，不按平台案例套图文编排。" : undefined,
        `市场：${studioMarket(brief.market).label}。${language}`,
        brief.ratio !== "auto" ? `用户选择画幅：${brief.ratio}。` : "画幅按平台与实际模型规格。",
        brief.shooting !== "auto" ? `拍法偏好：${studioShooting(brief.shooting).prompt}按各屏职责落实，白底、参数与纯细节屏不强塞人物或场景。` : undefined,
        brief.audience.trim() ? `目标人群：${brief.audience.trim()}` : undefined,
        brief.positioning.trim() ? `价格定位：${brief.positioning.trim()}` : undefined,
        brief.extra.trim() ? `卖家补充要求：${oneLine(brief.extra)}` : undefined,
        cast.length ? `已选人物资料：${cast.join("；")}。需要人物的屏继承同一身份、年龄和体态，与商品建立真实使用关系；屏型按购买目标选，不为带模特把所有屏都改成 detail-model。白底、参数与纯细节图不强塞人物。` : undefined,
        ...studioPrepPromptLines(brief.prep ? { ...brief.prep, picked: undefined } : undefined, Boolean(request.alternative), Boolean(note)),
        request.scope === "template" ? templateLines(product, templateRoles).join("\n") : undefined,
        note ? "" : undefined,
        note ? `【卖家对这次策划的补充调整】（优先照做；和商品事实、平台规则冲突时以事实和规则为准）\n${note}` : undefined,
        ...previousLines(request.previous),
        ...(request.alternative
            ? [
                  "【重新策划】保留商品事实、所选类型与张数，找另一条能用本品证据说明的购买路径。不只改写原问题或替换背景。",
                  ...request.alternative.screens.map((screen, index) => {
                      const display = commerceImageBriefContent(screen.displayContent || screen.visual, true);
                      const beat = commerceImageBriefContent(screen.visualBeat, true);
                      return `旧版 ${index + 1}：${commerceImageBriefContent(screen.purchaseQuestion || screen.purpose, true).slice(0, 120)}；${display.slice(0, 120)}${beat ? `；画面主线：${beat}` : ""}`;
                  }),
              ]
            : []),
        "",
        ...(request.scope === "detail"
            ? [
                  `可用 role（仅作内部分类，可重复，不是逐项清单或画法）：${roles.join("、")}。`,
                  "按答案和主证据编排整页后再写 JSON，不边写边补位。全页任意两屏如果只能靠标题、裁切或换背景区分，就合并旧内容，为后一屏另找实物状态、真实用法或选购依据。不改变屏数，不输出检查过程。",
              ]
            : request.scope === "single"
              ? []
              : [`可用 role（只标记用途，不规定画法）：${roles.join("、")}。`]),
        "【逐张内容】purchaseQuestion 写唯一的购买问题，displayContent 写要看见的商品状态、动作或关系，visualFocus 写要看清的实物证据，visualBeat 简述本张独有的主体或动作。不要用同一张商品照换几个说明来凑数。",
        "图片模型直接看商品原图，一次完成成品文案、摄影、排版、艺术字和特效。策划字段只写买家该看到的实物和关系，不夹写短文案、品牌题字、图位、字体、配色、相机、图内语言或无字指令；也不输出核对备注。",
        "evidence 原样抄本张使用的资料编号，保留 fact: 前缀；只用原图或基本用法就填空数组。不要从摆拍或未拍到的物件推断随货内容；缺资料就换一个可诚实展示的用途，不删除整屏。",
        "只输出 JSON。先写 summary，再按顺序给 screens，数量和所选一致。不输出美术方案或成品文案。",
        `{"summary":"购买路径","screens":[{"role":"${exampleRole}","purchaseQuestion":"买家要确认什么","displayContent":"需要展示的实物或使用关系","evidence":[],"visualFocus":"先看到哪项证据","visualBeat":"与其他屏不同的实物状态或动作"}]}`,
    ];
    const prompt = lines.filter((line): line is string => line !== undefined).join("\n");
    const length = Array.from(prompt).length;
    if (!maxChars || length <= maxChars) return prompt;
    throw new Error(`策划内容与商品资料共 ${length} 字，超过文本模型的 ${maxChars} 字输入上限。请精简补充要求或更换模型；未提交策划任务。`);
}

/** 土味和口号腔的写法：提示词里禁止，读回时发现了也提示用户。 */
export const STUDIO_TACKY_COPY = ["神器", "必入", "闭眼入", "yyds", "绝绝子", "天花板", "谁用谁知道", "一眼就认", "颜值担当", "您值得拥有", "爆款", "种草了", "上头"];
/** 说明书口吻和空洞大词：不土，但低端，读回时一样提示。 */
export const STUDIO_FLAT_COPY = ["该有的", "就这么简单", "记清楚", "一次看清", "都写在", "品质之选", "匠心", "臻品", "甄选", "高端大气"];

export type StudioDetailPlanResult = {
    plan: StudioDetailPlan;
    warnings: StudioPlanIssue[];
    /** 模型排了但依据不够或格式不对、没收进清单的屏数。 */
    dropped: number;
    /** 因为带了原文里没有的数字被去掉的文案条数。 */
    ungrounded: number;
    issues: EcommerceComplianceIssue[];
    /** 文案里出现的土味写法。 */
    tacky: string[];
    /** 详情页用到几种版式、相邻两屏版式相同的有几处；版式变化不够时提示用户。 */
    layoutKinds: number;
    layoutRepeats: number;
    compositionKinds: number;
    compositionRepeats: number;
    /** 详情页资料不足时的建议屏数与缺失证据；其它策划范围不填。 */
    diagnostics?: ReturnType<typeof studioDetailPlanCapacity>;
    /** 后台知识库的版本与条目 ID凭证；不包含知识正文。 */
    knowledgeReceipt?: StudioKnowledgeReceipt;
};

export type StudioPlanIssue = { index?: number; field: string; message: string };

export class StudioPlanValidationError extends Error {
    constructor(
        public issues: StudioPlanIssue[],
        public review: StudioPlanReviewedScreen[] = [],
    ) {
        super(
            issues
                .slice(0, 3)
                .map((item) => `${item.index === undefined ? "" : `第 ${item.index + 1} 张 · `}${item.message}`)
                .join("；"),
        );
        this.name = "StudioPlanValidationError";
    }
}

const libraryRoles = new Set(["HERO", "DETAIL", "SCENE", "TRUST", "CTA", "VARIANT", "PAIN_POINT", "COMPARISON"]);

function screenFieldIssue(record: Record<string, unknown>): StudioPlanIssue | undefined {
    if (typeof record.role !== "string" || !record.role.trim()) return { field: "role", message: "role 缺失或不是非空文本" };
    const visualField = ["displayContent", "visual"].find((field) => typeof record[field] === "string" && record[field].trim());
    if (!visualField) return { field: "displayContent", message: "缺少本屏的商品展示内容" };
    for (const field of ["title", "purpose", "purchaseQuestion", "displayContent", "visualFocus", "visualBeat", "visual"]) if (record[field] != null && typeof record[field] !== "string") return { field, message: `${field} 不是文本` };
    if (record.evidence != null && typeof record.evidence !== "string" && !(Array.isArray(record.evidence) && record.evidence.every((item) => typeof item === "string"))) return { field: "evidence", message: "evidence 应为文本或文本数组" };
    for (const field of ["facts", "evidenceRefs"]) if (record[field] != null && (!Array.isArray(record[field]) || record[field].some((item) => typeof item !== "string"))) return { field, message: `${field} 应为文本数组` };
}

/**
 * 新策划合同只要求内容 brief。旧版字段仍可读回，但不能让图片模型被迫先
 * 写标题、版式或字块；这里把新字段映射到旧持久化结构，保持任务恢复兼容。
 */
function normalizePlanningScreenRecord(record: Record<string, unknown>): Record<string, unknown> {
    const { role, title, visualBeat, evidenceRefs } = record;
    const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
    const displayContent = text(record.displayContent);
    const visualFocus = text(record.visualFocus);
    const visual = displayContent || text(record.visual);
    const evidenceValues = Array.isArray(record.evidence) ? record.evidence.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim()) : [];
    const evidence = evidenceValues.join("；") || text(record.evidence);
    const facts = Array.isArray(record.facts) ? record.facts : evidenceValues.length ? evidenceValues : evidence ? [evidence] : Array.isArray(record.evidenceRefs) ? record.evidenceRefs : [];
    return {
        role,
        title,
        visualBeat,
        evidenceRefs,
        purchaseQuestion: text(record.purchaseQuestion) || text(record.purpose),
        displayContent: visual,
        visualFocus,
        purpose: text(record.purchaseQuestion) || text(record.purpose),
        visual,
        facts,
        evidence: record.evidence,
    };
}

export function studioPlanEvidenceMatch(sources: StudioClaimSource[], reference: string, allowTextMatch = true) {
    const id = reference
        .trim()
        .replace(/^[\[【(（]+|[\]】)）]+$/g, "")
        .trim();
    const match = sources.find((source) => source.id === id) || sources.find((source) => source.id === `fact:${id}`);
    return match || (allowTextMatch ? studioEvidenceMatch(sources, id) : undefined);
}

export function parseDetailPlan(raw: string, product: StudioProduct, roles: StudioShotRole[], meta: { id: string; model: string; createdAt: string }, requested?: StudioPlanRequest, knowledgeReceipt?: unknown): StudioDetailPlanResult {
    const request = requested ?? { scope: "detail" };
    let data: Record<string, unknown>;
    try {
        data = extractStudioJson(raw);
    } catch (error) {
        throw new StudioPlanValidationError([{ field: "json", message: error instanceof Error ? error.message : "策划不是可读取的 JSON 对象" }]);
    }
    const errors: StudioPlanIssue[] = [];
    const warnings: StudioPlanIssue[] = [];
    const receipt = studioKnowledgeReceiptOf(knowledgeReceipt);
    if (!Array.isArray(data.screens)) throw new StudioPlanValidationError([...errors, { field: "screens", message: "策划结果不完整：缺少 screens 数组，不能把 shots 等其它结果当作逐屏策划" }]);
    const allowed = new Set(roles);
    const sources = studioClaimSources(product);
    const offered = data.screens;
    let ungrounded = 0;
    const textless = product.brief.language === "none";
    const screens: StudioPlannedScreen[] = [];
    const review: StudioPlanReviewedScreen[] = [];
    const suite = request.scope === "template" ? product.brief.suite : undefined;
    const requestedCount = screenCount(product, request);
    const capacity = requested?.scope === "detail" ? studioDetailPlanCapacity(product, requestedCount) : undefined;
    // 资料容量不足时仍保留用户请求的屏数；重复与虚构由逐屏 warning/事实门处理，不能静默丢屏。
    const count = requestedCount;
    const singleRoles = request.scope === "single" ? studioPlanTargetRoles(request.targets || []) : undefined;
    const expectedRoles = suite ? studioTemplateShotRoles(suite) : singleRoles;
    offered.forEach((value: unknown, index: number) => {
        const reject = (field: string, message: string) => errors.push({ index, field, message });
        if (index >= count) {
            warnings.push({ index, field: "screens", message: `超出用户选择的 ${count} 屏，已忽略多余策划，不影响前 ${count} 屏出图` });
            return;
        }
        if (!value || typeof value !== "object" || Array.isArray(value)) {
            reject("screen", "不是逐屏 JSON 对象");
            return;
        }
        const rawScreen = value as Record<string, unknown>;
        const badField = screenFieldIssue(rawScreen);
        if (badField) {
            reject(badField.field, badField.message);
            return;
        }
        const record = normalizePlanningScreenRecord(rawScreen);
        const rawRole = String(record.role).trim();
        const knownRole = Object.hasOwn(STUDIO_DETAIL_SCREEN_GUIDE, rawRole);
        let role = rawRole as StudioShotRole;
        if (!knownRole && !(suite && libraryRoles.has(rawRole))) {
            const fallback = request.scope === "detail" ? (index === 0 ? "detail-hero" : index === requestedCount - 1 ? "detail-closing" : "detail-scene") : roles[index] || roles[0];
            warnings.push({ index, field: "role", message: `未知屏型 role「${rawRole.slice(0, 60)}」，已改为 ${fallback || "通用实拍"}` });
            if (!fallback) {
                reject("role", "没有可用屏型");
                return;
            }
            role = fallback;
        }
        if (singleRoles) role = singleRoles[index];
        else if (suite && (!knownRole || !allowed.has(role))) role = allowed.has(expectedRoles![index]) ? expectedRoles![index] : suite.kind === "main" ? "main-scene" : "detail-scene";
        else if (!allowed.has(role)) {
            const fallback = request.scope === "detail" ? (index === 0 ? "detail-hero" : index === requestedCount - 1 ? "detail-closing" : "detail-scene") : roles[index] || roles[0];
            warnings.push({ index, field: "role", message: `屏型 ${role} 缺少当前商品依据，已改为 ${fallback}，用商品可见信息完成本屏` });
            role = fallback;
        }
        const unsupportedPackage = request.scope === "detail" && rawRole === "detail-package" && role !== rawRole;
        const clean = (field: string) => commerceImageBriefContent(record[field] as string | undefined, true);
        const guide = STUDIO_DETAIL_SCREEN_GUIDE[role];
        const closing = request.scope === "detail" && role === "detail-closing";
        const fallbackQuestion = closing ? DETAIL_CLOSING_QUESTION : guide.use;
        const fallbackDisplay = closing ? DETAIL_CLOSING_CONTENT : `${guide.use}。让商品图中的可见内容提供依据，不补写未知信息。`;
        let planned: StudioPlannedScreen | undefined;
        try {
            const question = unsupportedPackage ? fallbackQuestion : clean("purchaseQuestion");
            const display = (!unsupportedPackage && clean("displayContent")) || fallbackDisplay;
            planned = studioPlannedScreenOf({
                role,
                title: unsupportedPackage ? guide.label : record.title,
                purpose: question,
                purchaseQuestion: question,
                displayContent: display,
                visual: display,
                visualFocus: unsupportedPackage ? "" : clean("visualFocus"),
                visualBeat: unsupportedPackage ? "" : clean("visualBeat"),
                facts: unsupportedPackage ? [] : record.facts,
                evidenceRefs: unsupportedPackage ? [] : record.evidenceRefs,
            });
        } catch (error) {
            reject("visual/elements", error instanceof Error ? error.message : "无法读取画面");
            return;
        }
        if (!planned) {
            reject("visual", "没有可执行的画面");
            return;
        }
        const screen = planned;
        screen.copySource = "assistant";
        const refs = new Set<string>();
        for (const raw of new Set(screen.evidenceRefs || [])) {
            const entry = studioPlanEvidenceMatch(sources, raw, false);
            if (!entry) {
                warnings.push({ index, field: "evidenceRefs", message: `资料里找不到依据编号「${raw.slice(0, 60)}」，已忽略并按当前商品资料重新核验` });
            } else refs.add(entry.id);
        }
        screen.facts = screen.facts.filter((reference) => {
            const entry = studioPlanEvidenceMatch(sources, reference);
            if (entry) {
                refs.add(entry.id);
                return true;
            }
            warnings.push({ index, field: "facts", message: `「${reference}」无法对应本品资料，未作事实采用` });
            return false;
        });
        const citedSources = sources.filter((source) => refs.has(source.id));
        const grounded = (value: string, field: string, blueprint = false) => {
            const checked = checkStudioClaim(value, citedSources.length ? citedSources : sources, blueprint);
            checked.refs.forEach((id) => refs.add(id));
            if (!checked.issue) return value;
            const allSources = citedSources.length ? checkStudioClaim(value, sources, blueprint) : undefined;
            if (allSources && !allSources.issue) {
                allSources.refs.forEach((id) => refs.add(id));
                warnings.push({ index, field, message: "原依据不匹配，已改用对应的商品资料" });
                return value;
            }
            ungrounded++;
            warnings.push({ index, field, message: `${checked.issue}；未用于出图` });
            return blueprint ? supportedStudioDescription(value, sources) : "";
        };
        const question = grounded(screen.purchaseQuestion || screen.purpose, "purchaseQuestion", true);
        screen.purchaseQuestion = screen.purpose = question || fallbackQuestion;
        const rawVisual = typeof rawScreen.visual === "string" ? rawScreen.visual.trim() : "";
        screen.displayContent = grounded(screen.displayContent || screen.visual, "displayContent", true) || fallbackDisplay;
        // Keep the legacy draft text only in the compatibility field. Delivery
        // always reads displayContent, so planner-only copy/layout commands
        // cannot reach the image model while old saved plans remain inspectable.
        screen.visual = rawVisual || screen.displayContent;
        if (screen.visualBeat) screen.visualBeat = grounded(screen.visualBeat, "visualBeat", true) || undefined;
        if (screen.visualFocus) screen.visualFocus = grounded(screen.visualFocus, "visualFocus", true) || undefined;
        const listCover = (request.scope === "main" || suite?.kind === "main") && index === 0;
        if (textless || suite?.shots[index]?.noText || screen.role === "main-white" || (listCover && ecommerceRoleSpec(product.platform, "main")?.noText)) screen.noText = true;
        screen.evidenceRefs = refs.size ? [...refs] : undefined;
        screens.push(screen);
        review.push({ index, title: screen.title, purpose: screen.purpose, headline: screen.headline, visual: screen.visual.slice(0, 240) });
    });
    for (let index = offered.length; index < count; index++) {
        if (request.scope !== "detail") {
            errors.push({ index, field: "screens", message: "缺少这一张的策划" });
            continue;
        }
        const unused = roles.filter((role) => role !== "detail-hero" && role !== "detail-closing" && !screens.some((screen) => screen.role === role));
        const usedEvidence = new Set(screens.flatMap((screen) => screen.evidenceRefs || []));
        const freshFacts = (role: StudioShotRole) => studioDetailSelectionFacts(product, role).filter((fact) => !usedEvidence.has(`fact:${fact.id}`));
        const choice = unused.find((role) => freshFacts(role).length > 0);
        const fallbackRole = index === 0 ? "detail-hero" : choice || (index === count - 1 ? "detail-closing" : unused[0] || "detail-closeup");
        const guide = STUDIO_DETAIL_SCREEN_GUIDE[fallbackRole];
        const purchaseQuestion = fallbackRole === "detail-closing" ? DETAIL_CLOSING_QUESTION : guide.use;
        const fallback = studioPlannedScreenOf(
            {
                role: fallbackRole,
                title: guide.label,
                purchaseQuestion,
                displayContent: fallbackRole === "detail-closing" ? DETAIL_CLOSING_CONTENT : `${guide.use}。只用整套尚未展示的商品原图或已确认资料，不添加未证实的属性。`,
                evidenceRefs: freshFacts(fallbackRole)
                    .slice(0, STUDIO_DETAIL_PLAN_LIMITS.facts)
                    .map((fact) => `fact:${fact.id}`),
                layout: studioRoleLayout(fallbackRole),
                noText: textless,
            },
            true,
        );
        if (fallback) {
            fallback.copySource = "assistant";
            screens.push(fallback);
            review.push({ index, title: fallback.title, purpose: fallback.purpose, headline: "", visual: fallback.visual.slice(0, 240) });
            warnings.push({ index, field: "screens", message: "策划少了这一屏，已补入可用的商品展示任务，不改变所选屏数" });
        }
    }
    if (!count || screens.length !== count) {
        const description = suite ? `模板 ${count} 张，只排好 ${screens.length} 张` : `选择 ${count} 屏，有效 ${screens.length} 屏`;
        errors.unshift({ field: "screens", message: `策划结果不完整（${description}）` });
    }
    if (errors.length) throw new StudioPlanValidationError(errors, review);
    const first = request.scope === "main" ? screens.findIndex((screen) => screen.role === "main-white" || screen.role === "main-selling") : -1;
    if (first > 0) screens.unshift(screens.splice(first, 1)[0]);
    const unit = request.scope === "detail" || suite?.kind === "detail" ? "屏" : "张";
    for (const { index, field, reason, previousIndex } of studioDetailRepeats(screens, product.brief.sameLayout)) {
        const suggestion = field === "purpose" ? "可以改成另一条有依据的选购问题，只换构图不算新内容。" : "可以改为另一种看得见的主体、状态或使用关系。";
        warnings.push({ index, field, message: `与第 ${previousIndex + 1} ${unit}${reason}。${suggestion}` });
    }
    const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");
    return {
        plan: {
            id: meta.id,
            createdAt: meta.createdAt,
            inputSignature: studioPlanInputSignature(product),
            model: meta.model,
            summary: text(data.summary, STUDIO_DETAIL_PLAN_LIMITS.summary),
            style: typeof data.style === "string" && request.scope !== "detail" ? text(data.style, STUDIO_DETAIL_PLAN_LIMITS.style) : "",
            ...(typeof data.tone === "string" && request.scope !== "detail" && STUDIO_DESIGN_TONE_IDS.includes(data.tone as StudioDesignToneId) ? { tone: data.tone as StudioDesignToneId } : {}),
            ...(receipt ? { knowledgeReceipt: receipt } : {}),
            ...(request.scope === "single" ? { targets: request.targets } : {}),
            ...(suite ? { suiteId: suite.id } : {}),
            ...(request.scope === "detail" ? { requestedScreens: requestedCount, ...(capacity && capacity.suggestedScreens < requestedCount ? { suggestedScreens: capacity.suggestedScreens, capacityDiagnostics: capacity } : {}) } : {}),
            screens,
        },
        dropped: request.scope === "single" || request.scope === "template" ? 0 : Math.max(0, offered.length - count),
        ungrounded,
        warnings,
        issues: [],
        tacky: [],
        layoutKinds: new Set(screens.map((screen) => screen.layout)).size,
        layoutRepeats: screens.filter((screen, index) => index > 0 && screen.layout === screens[index - 1].layout).length,
        compositionKinds: new Set(screens.map((screen) => screen.composition).filter(Boolean)).size,
        compositionRepeats: screens.filter((screen, index) => index > 0 && screen.composition && screen.composition === screens[index - 1].composition).length,
        ...(capacity && capacity.suggestedScreens < requestedCount ? { diagnostics: capacity } : {}),
        ...(receipt ? { knowledgeReceipt: receipt } : {}),
    };
}
