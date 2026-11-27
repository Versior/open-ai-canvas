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
import { studioDetailSourceOf, studioPlanImageNumber } from "./reference-selection";
import { studioDetailRepeats } from "./detail-repeats";
import { studioDetailEditorialCandidates } from "./detail-editorial";
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
    type StudioPlanReceipt,
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
type StudioPlanImageBindings = Pick<StudioPlanReceipt, "photoEvidence" | "designReferences">;
export type StudioPlanImages = StudioPlanImageBindings & { photos: number; references: number; readingViews?: { imageIndex: number; sourceIndex: number; top: number; bottom: number }[] };
export type StudioPlanRequest<Images = StudioPlanImages> = { scope: StudioPlanScope; targets?: StudioPlanTarget[]; previous?: StudioDetailPlan; alternative?: StudioDetailPlan; alternativeDirection?: boolean; images?: Images };

function screenStyleChoices(product: StudioProduct, request: StudioPlanRequest<StudioPlanImageBindings>) {
    if (request.scope !== "detail" || product.brief.sameLayout || !request.images?.designReferences) return [];
    const resources = new Set(product.references.filter((photo) => !photo.truth && photo.resourceId).map((photo) => photo.resourceId));
    for (const photo of product.photos) resources.delete(photo.resourceId);
    const choices = request.images.designReferences.filter(({ resourceId }) => resources.delete(resourceId));
    return choices.length > 1 ? choices : [];
}

function imageRange(from: number, count: number) {
    return count > 1 ? `图${from}–图${from + count - 1}` : `图${from}`;
}

/** 附图说明：哪几张是商品图、哪几张是参考图，以及参考图怎么用。 */
export function studioPlanImageLines(images: StudioPlanImages | undefined, citations?: ReadonlyMap<string, string>): string[] {
    if (!images || images.photos + images.references === 0) return [];
    const parts = [images.photos ? `${imageRange(1, images.photos)} 是商品图（外观唯一依据）` : "", images.references ? `${imageRange(images.photos + 1, images.references)} 是卖家给的参考图（大牌或爆款的图，不是这件商品）` : ""].filter(Boolean);
    const photos = images.photoEvidence?.flatMap(({ index, id }) => {
        const key = `photo:${id}`;
        const citation = citations ? citations.get(key) : key;
        return citation ? [`图${index} [${citation}]`] : [];
    });
    return [
        `附图：${parts.join("；")}。`,
        photos?.length ? `实拍编号：${photos.join("；")}。每屏只引用确实拍到主要部位或状态的实拍，不把其中的摆位、手和背景抄成画面要求。` : "",
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

function screenCount(product: StudioProduct, request: Pick<StudioPlanRequest, "scope" | "targets">) {
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
    if (request.scope === "detail") return `正好交付 ${count} 屏：首屏用 detail-hero 建立商品识别；末屏可交付最后一个问题的实物证据，不另设外观核对或总结，不强制 detail-closing。role 只标记内容用途，不锁定版式。`;
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

function detailPurchasePath(count: number, sameLayout: boolean) {
    return [
        "【整页内容编辑】先找这件商品的一条选购与使用主线，再分配屏数、标 role。summary 用一句话说出一个真实的生活问题和本品怎样参与。整页是一篇能顺着读的商品故事，不是逐屏提问的说明书。",
        count < STUDIO_DETAIL_SCREEN_DEFAULT
            ? "短页合并相关职责：例如把核心理由和证据放在一起、把选购和须知放在一起。"
            : count > STUDIO_DETAIL_SCREEN_DEFAULT
              ? "长页的屏数不等于卖点数。同一购买问题可以跨相邻屏，分别承担引入需要、让人看见动作、给出证据或划清适用边界；也可用不同商品和生活对象之间的搭配、使用前的准备、使用后的安排推进。不设固定屏序，不为集齐这些职责而硬编。"
              : "按本品的优先级前置最能帮助选购的内容，不用把六屏分配给六种角色。",
        "先从买家实际生活出发：商品会在什么时刻被用到、和什么对象发生关系、有哪些真实的选购区别？能从常识和可见结构确定的基本用法，可另设环境展示。首屏认整品，把最有用的答案排在零件外观之前。没有可确认的规格或选项，不用局部外形假装是选购理由。",
        "删掉一屏，整页是否少了有用的一步？同一个部位的外形、边缘、内部纹理和颜色先合并。一个动作不按不同的人体部位、朝向和道具拆分。主角和职责都相同的屏，只保留能直接证明答案的那一个；同一部件兼作其他屏的背景不等于新内容。",
        "再看画面：遮掉字、箭头和标注，缩成手机缩略图，本屏还能和其他屏区分吗？同一张原照换背景、裁切或标注不算。只有一张实拍，也把商品本体与照片里的手、姿势、道具和现场分开；只在它们能说明本屏内容时沿用。要看细节时，让细节本身成为主画面，不把同一张整品照当底图再加放大框。",
        "资料少不凑零件目录。考虑商品之外的真实对象：使用它之前正在做什么，要处理或搭配的是什么，买家自己要核对什么条件？让这些对象和动作也能成为主角；产品未必每次都要整件在手中。展示有证据的关系，不把画面当成性能数据。",
        sameLayout
            ? "同款详情的 transitionOut 只用于策划预览，可简述本屏与下一屏的阅读关系；末屏省略。"
            : "相邻屏是一幅长图的上下段。transitionOut 用一句话说清两屏都能画出的环境、物体或光影，怎样从本屏的内容引出下一屏的新内容。不只写‘接着看细节’，不为衔接新增卖点、复制参考图或指定版式。不靠装饰线，不把文字、人脸或商品本体拆在接缝两侧。没有自然承接就省略，末屏也省略。",
        "展示商品实际如何与人、其他物品或空间发生关系，即使实拍并未拍到环境。穿戴品可看佩戴关系，家具可看放入空间的关系，但展示放置不等于适配、护理或操作承诺。包装或配件只有在随货内容经过确认、且能回答尚未解决的选购问题时才独立占屏。",
    ];
}

const DETAIL_CLOSING_QUESTION = "下单前还需要确认什么？";
const DETAIL_CLOSING_CONTENT = "用尚未展示且有依据的选购、到手、安装或维护信息回答最后的下单疑虑。资料少时，选一个仍没讲清的可见结构或使用关系，不回顾首屏、不编承诺。";
const DETAIL_MAX_ALTERNATIVES = 6;

export function studioDetailOffersAlternatives(product: StudioProduct, scope: StudioPlanScope) {
    return scope === "detail" && !product.brief.planNote?.trim() && !product.brief.extra.trim();
}

/** 上一版策划：按卖家的补充调整修改时带上，模型只改卖家不满意的地方。 */
function previousLines(previous: StudioDetailPlan | undefined, sources: StudioClaimSource[]): string[] {
    if (!previous) return [];
    const content = (text: string | undefined) => supportedStudioDescription(commerceImageBriefContent(text, true), sources);
    const summary = content(previous.summary);
    return [
        "",
        "【上一版策划】（按卖家的补充调整修改这一版：卖家没提意见的部分尽量保留，卖家不满意的地方要改到位）",
        summary ? `思路：${summary}` : "",
        ...previous.screens.map((screen, index) => {
            const display = content(screen.displayContent || screen.visual);
            const beat = content(screen.visualBeat);
            const question = content(screen.purchaseQuestion || screen.purpose);
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
    const citations = request.scope === "detail" ? new Map(sources.map((source, index) => [source.id, `E${index + 1}`])) : undefined;
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
    const styleChoices = screenStyleChoices(product, request);
    const capacity = request.scope === "detail" ? studioDetailPlanCapacity(product, requestedCount) : undefined;
    const capacityNote =
        capacity && capacity.suggestedScreens < requestedCount
            ? `当前资料有限，仍交付 ${requestedCount} 个阅读画面，不编 ${requestedCount} 个卖点。先分整页职责，不逐句扩写商品档案。后一屏必须带来前面没有的可见信息；可以是新的使用情境、具体动作或未交代的选择条件，不一定是又一个产品参数。`
            : undefined;
    const note = brief.planNote?.trim();
    const withAlternatives = studioDetailOffersAlternatives(product, request.scope);
    // 主图类的范围（主图套图、按主图出的模板）文字更少、视觉元素可以少出现几张。
    const mainLike = request.scope === "main" || (request.scope === "template" && brief.suite?.kind === "main");
    const templateRoles = request.scope === "template" && brief.suite ? studioTemplateShotRoles(brief.suite).map((role): StudioShotRole => (roles.includes(role) ? role : mainLike ? "main-scene" : "detail-scene")) : [];
    const exampleRole = request.scope === "single" ? studioPlanTargetRoles(request.targets || [])[0] || "detail-scene" : request.scope === "template" ? templateRoles[0] || roles[0] : request.scope === "main" ? "main-white" : "detail-hero";
    const exampleScreen = {
        role: exampleRole,
        purchaseQuestion: request.scope === "detail" ? "本屏负责的阅读任务" : "买家要确认什么",
        displayContent: "需要展示的实物或使用关系",
        evidence: [],
        visualFocus: "先看到哪项证据",
        visualBeat: "与其他屏不同的实物状态或动作",
    };
    const outputShape = {
        summary: "购买路径",
        screens: [{ ...exampleScreen, ...(request.scope === "detail" ? { transitionOut: brief.sameLayout ? "与下一屏的阅读关系" : "跨两屏可见的线索怎样从本屏引出下一屏的新内容（可省略）" } : {}) }],
        ...(withAlternatives ? { alternatives: [{ ...exampleScreen, role: "detail-scene", purchaseQuestion: "尚未解答的购买问题", displayContent: "独立的实物证据或使用关系" }] } : {}),
    };
    const lines: (string | undefined)[] = [
        introLine(product, request, platform),
        scopeRequirement(product, request),
        capacityNote,
        ...(request.scope === "detail"
            ? detailPurchasePath(requestedCount, brief.sameLayout)
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
        ...studioPlanImageLines(request.images, citations),
        styleChoices.length
            ? `每屏可选一张最能借鉴其内容表达的卖家设计参考原图（${styleChoices.map(({ index }) => `图${index}`).join("、")}），如有合适的，在该屏 JSON 填 styleReference:"图N"，没有则省略。只选原图编号，不选实拍或长图阅读裁片，不提供任何固定版式、成品文字或商品事实。`
            : undefined,
        request.scope === "detail" && request.images?.photoEvidence?.length
            ? '当本屏要读一个局部（如控件、包边或接口），从已附的商品实拍中定位它，另填 detailSource:{"photo":"图序号，如图1","box":[左,上,右,下]}。四个数为原照宽高的百分比（0–100，左上为原点），包括目标和紧邻结构。整品、环境、看不到或不能定位的部位省略；绝不是成片构图。'
            : undefined,
        invariants.length ? `外观要点（画到这些特征时保真，不要求每屏展示）：${invariants.join("、")}` : undefined,
        "",
        "【卖家资料】",
        studioTitleOf(product) ? `卖家填写的核心标题：${studioTitleOf(product)}` : undefined,
        ...(request.scope === "detail"
            ? [evidence.length ? `可引用的商品资料：\n${evidence.map((source) => `[${citations!.get(source.id)}] ${source.text}`).join("\n")}` : "没有额外商品资料，按商品原图中可辨认的类型、可见内容和基本用法策划。"]
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
        ...previousLines(request.previous, sources),
        ...(request.alternative
            ? [
                  "【重新策划】保留商品事实、所选类型与张数，找另一条能用本品证据说明的购买路径。不只改写原问题或替换背景。",
                  ...request.alternative.screens.map((screen, index) => {
                      const display = supportedStudioDescription(commerceImageBriefContent(screen.displayContent || screen.visual, true), sources);
                      const beat = supportedStudioDescription(commerceImageBriefContent(screen.visualBeat, true), sources);
                      const question = supportedStudioDescription(commerceImageBriefContent(screen.purchaseQuestion || screen.purpose, true), sources);
                      return `旧版 ${index + 1}：${question.slice(0, 120)}；${display.slice(0, 120)}${beat ? `；画面主线：${beat}` : ""}`;
                  }),
              ]
            : []),
        "",
        ...(request.scope === "detail"
            ? [
                  `可用 role（仅作内部分类，可重复，不是逐项清单或画法）：${roles.join("、")}。`,
                  "按主线和证据编排整页。同一个基本使用动作不能按人体部位、操作角度或场景拆开占屏。主线跨屏时，前屏不要预先列出后屏将证明的细节；后一屏写清新增的信息。不能用之前的部件列表或下单核对凑尾屏。不输出检查过程。",
                  withAlternatives
                      ? `先找能替换重复屏的候补，再定正式屏。候补可以是同一主线还没上场的实物证据，不要求另一个卖点。其余最多 ${Math.min(DETAIL_MAX_ALTERNATIVES, Math.ceil(requestedCount / 2))} 项放进顶层 alternatives，字段与正式屏相同，不写 transitionOut。它是必填数组，不增加交付屏数；没有可证实的备选则返回空数组。不要把同一部件、颜色或动作换种说法放进去。`
                      : undefined,
              ]
            : request.scope === "single"
              ? []
              : [`可用 role（只标记用途，不规定画法）：${roles.join("、")}。`]),
        `【逐张内容】purchaseQuestion 写${request.scope === "detail" ? "本屏负责的阅读任务，可以是简短陈述；有具体选购疑问时才写本屏补上的子问题。不用每屏都问部件在哪、怎么拿" : "本图要回答的购买问题"}，displayContent 写买家在这里才能看到的实物、动作或关系。visualFocus 写哪项证据要成为主角；visualBeat 仅在还能补充不同的动作或状态时填写，不用三种说法再说一遍。`,
        "图片模型直接看商品原图，一次完成成品文案、摄影、排版、艺术字和特效。策划字段只写买家该看到的实物和关系，不夹写短文案、品牌题字、图位、字体、配色、相机、图内语言或无字指令；也不输出核对备注。",
        `evidence 只列直接回答本屏问题的资料编号，主证据排首位。${citations ? "照抄方括号内的 E 编号（如 E1），不加前缀，也不补造编号。" : "保留资料原有前缀。"}用法演示也引用能指认作用部位的实物证据；没有对应编号才填空数组。没拍到某部件不代表本品没有该部件或功能。缺资料就换一个可诚实展示的用途，不删除整屏。`,
        `只输出 JSON。先写 summary，再按顺序给出 ${requestedCount} 项 screens${withAlternatives ? "，最后写 alternatives（即使为空也保留此键）" : ""}。不输出美术方案或成品文案。`,
        JSON.stringify(outputShape),
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

export function studioPlanEvidenceMatch(sources: StudioClaimSource[], reference: string, { allowTextMatch = true, numbered = false } = {}) {
    const id = reference
        .trim()
        .replace(/^[\[【(（]+|[\]】)）]+$/g, "")
        .trim();
    const citation = numbered ? /^E([1-9]\d*)$/i.exec(id) : null;
    if (citation) return sources[Number(citation[1]) - 1];
    const match = sources.find((source) => source.id === id) || sources.find((source) => source.id === `fact:${id}`);
    return match || (allowTextMatch ? studioEvidenceMatch(sources, id) : undefined);
}

export function parseDetailPlan(
    raw: string,
    product: StudioProduct,
    roles: StudioShotRole[],
    meta: { id: string; model: string; createdAt: string },
    requested?: StudioPlanRequest<StudioPlanImages | StudioPlanImageBindings>,
    knowledgeReceipt?: unknown,
): StudioDetailPlanResult {
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
    const numbered = request.scope === "detail";
    const styleChoices = screenStyleChoices(product, request);
    const offered = data.screens;
    let ungrounded = 0;
    const textless = product.brief.language === "none";
    const screens: StudioPlannedScreen[] = [];
    const review: StudioPlanReviewedScreen[] = [];
    const lostEvidence = new Set<number>();
    const suite = request.scope === "template" ? product.brief.suite : undefined;
    const requestedCount = screenCount(product, request);
    const capacity = requested?.scope === "detail" ? studioDetailPlanCapacity(product, requestedCount) : undefined;
    // 资料容量不足时仍保留用户请求的屏数；重复与虚构由逐屏 warning/事实门处理，不能静默丢屏。
    const count = requestedCount;
    const singleRoles = request.scope === "single" ? studioPlanTargetRoles(request.targets || []) : undefined;
    const expectedRoles = suite ? studioTemplateShotRoles(suite) : singleRoles;
    const readScreen = (value: unknown, index: number, alternative = false) => {
        const notices = alternative ? [] : warnings;
        const reject = (field: string, message: string) => {
            if (!alternative) errors.push({ index, field, message });
        };
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
        const crop = numbered ? studioDetailSourceOf(rawScreen.detailSource) : undefined;
        const imageNumber = studioPlanImageNumber(crop?.photo);
        const attachedId = imageNumber && request.images?.photoEvidence?.find((photo) => photo.index === imageNumber)?.id;
        const cropPhoto = crop && studioPlanEvidenceMatch(sources, attachedId ? `photo:${attachedId}` : crop.photo, { allowTextMatch: false, numbered });
        const styleNumber = studioPlanImageNumber(rawScreen.styleReference);
        const styleReferenceResourceId = styleChoices.find(({ index }) => index === styleNumber)?.resourceId;
        const rawRole = String(record.role).trim();
        const knownRole = Object.hasOwn(STUDIO_DETAIL_SCREEN_GUIDE, rawRole);
        let role = rawRole as StudioShotRole;
        if (alternative && (!allowed.has(role) || role === "detail-hero")) return;
        if (!knownRole && !(suite && libraryRoles.has(rawRole))) {
            const fallback = request.scope === "detail" ? (index === 0 ? "detail-hero" : index === requestedCount - 1 ? "detail-closing" : "detail-scene") : roles[index] || roles[0];
            notices.push({ index, field: "role", message: `未知屏型 role「${rawRole.slice(0, 60)}」，已改为 ${fallback || "通用实拍"}` });
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
            notices.push({ index, field: "role", message: `屏型 ${role} 缺少当前商品依据，已改为 ${fallback}，用商品可见信息完成本屏` });
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
            const content = !unsupportedPackage && clean("displayContent");
            if (alternative && (!question || !content)) return;
            const display = content || fallbackDisplay;
            planned = studioPlannedScreenOf({
                role,
                title: unsupportedPackage ? guide.label : record.title,
                purpose: question,
                purchaseQuestion: question,
                displayContent: display,
                visual: display,
                visualFocus: unsupportedPackage ? "" : clean("visualFocus"),
                visualBeat: unsupportedPackage ? "" : clean("visualBeat"),
                detailSource: !unsupportedPackage && crop && cropPhoto?.id.startsWith("photo:") ? { ...crop, photo: cropPhoto.id } : undefined,
                styleReferenceResourceId: unsupportedPackage ? undefined : styleReferenceResourceId,
                transitionOut: request.scope === "detail" && !alternative && !unsupportedPackage && index < count - 1 && typeof rawScreen.transitionOut === "string" ? commerceImageBriefContent(rawScreen.transitionOut, true) : undefined,
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
        if (screen.detailSource) refs.add(screen.detailSource.photo);
        for (const raw of new Set(screen.evidenceRefs || [])) {
            const entry = studioPlanEvidenceMatch(sources, raw, { allowTextMatch: false, numbered });
            if (!entry) {
                notices.push({ index, field: "evidenceRefs", message: `资料里找不到依据编号「${raw.slice(0, 60)}」，已忽略并按当前商品资料重新核验` });
            } else refs.add(entry.id);
        }
        screen.facts = screen.facts.flatMap((reference) => {
            const entry = studioPlanEvidenceMatch(sources, reference, { numbered });
            if (entry) {
                refs.add(entry.id);
                return [numbered ? entry.id : reference];
            }
            notices.push({ index, field: "facts", message: `「${reference}」无法对应本品资料，未作事实采用` });
            return [];
        });
        const citedSources = sources.filter((source) => refs.has(source.id));
        const grounded = (value: string, field: string, blueprint = false) => {
            const checked = checkStudioClaim(value, citedSources.length ? citedSources : sources, blueprint);
            checked.refs.forEach((id) => refs.add(id));
            if (!checked.issue) return value;
            const allSources = citedSources.length ? checkStudioClaim(value, sources, blueprint) : undefined;
            if (allSources && !allSources.issue) {
                allSources.refs.forEach((id) => refs.add(id));
                notices.push({ index, field, message: "原依据不匹配，已改用对应的商品资料" });
                return value;
            }
            if (!alternative) ungrounded++;
            notices.push({ index, field, message: `${checked.issue}；未用于出图` });
            return blueprint ? supportedStudioDescription(value, sources) : "";
        };
        const questionSource = screen.purchaseQuestion || screen.purpose;
        const question = grounded(questionSource, "purchaseQuestion", true);
        screen.purchaseQuestion = screen.purpose = question || fallbackQuestion;
        const rawVisual = typeof rawScreen.visual === "string" ? rawScreen.visual.trim() : "";
        const display = grounded(screen.displayContent || screen.visual, "displayContent", true);
        screen.displayContent = display || fallbackDisplay;
        if (!alternative && index > 0 && (!display || (!question && screen.purchaseQuestion !== clean("purchaseQuestion")))) lostEvidence.add(index);
        // Keep the legacy draft text only in the compatibility field. Delivery
        // always reads displayContent, so planner-only copy/layout commands
        // cannot reach the image model while old saved plans remain inspectable.
        screen.visual = rawVisual || screen.displayContent;
        if (screen.visualBeat) screen.visualBeat = grounded(screen.visualBeat, "visualBeat", true) || undefined;
        if (screen.visualFocus) screen.visualFocus = grounded(screen.visualFocus, "visualFocus", true) || undefined;
        if (numbered && !question && display)
            screen.purchaseQuestion = screen.purpose =
                screen.visualFocus ||
                display
                    .split(/[，,。；;]/u)
                    .find((part) => part.trim())
                    ?.trim() ||
                display;
        if (screen.transitionOut) screen.transitionOut = grounded(screen.transitionOut, "transitionOut", true) || undefined;
        const listCover = (request.scope === "main" || suite?.kind === "main") && index === 0;
        if (textless || suite?.shots[index]?.noText || screen.role === "main-white" || (listCover && ecommerceRoleSpec(product.platform, "main")?.noText)) screen.noText = true;
        screen.evidenceRefs = refs.size ? [...refs] : undefined;
        // A bad source ID or a removed aside does not invalidate otherwise usable evidence.
        return alternative && (!question || question !== questionSource || !display) ? undefined : screen;
    };
    offered.forEach((value: unknown, index: number) => {
        if (index >= count) {
            warnings.push({ index, field: "screens", message: `超出用户选择的 ${count} 屏，已忽略多余策划，不影响前 ${count} 屏出图` });
            return;
        }
        const screen = readScreen(value, index);
        if (screen) {
            screens.push(screen);
            review.push({ index, title: screen.title, purpose: screen.purpose, headline: screen.headline, visual: screen.visual.slice(0, 240) });
        }
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
    const sameLayout = product.brief.sameLayout;
    const replaced = new Set<number>();
    if (studioDetailOffersAlternatives(product, request.scope)) {
        const alternatives = (Array.isArray(data.alternatives) ? data.alternatives : []).slice(0, DETAIL_MAX_ALTERNATIVES).flatMap((value) => {
            const screen = readScreen(value, 0, true);
            return screen ? [screen] : [];
        });
        const allFacts = studioDetailPlanFacts(product);
        const detailFacts = allFacts.filter((fact) => ["spec", "material", "usage", "structure"].includes(fact.group) && (fact.evidence === "confirmed" || fact.group === "structure"));
        const replacementIndex = ({ index, replaceIndex }: ReturnType<typeof studioDetailRepeats>[number]) => replaceIndex ?? index;
        let repeats = studioDetailRepeats(screens, sameLayout);
        const originalClusters = repeats
            .filter((repeat) => repeat.cluster)
            .map((repeat) => {
                const anchor = repeat.replaceIndex === undefined ? repeat.previousIndex : repeat.index;
                return { repeat, anchor, existing: screens[anchor] };
            });
        const unresolvedClusters: typeof repeats = [];
        for (const index of new Set([...lostEvidence, ...repeats.map(replacementIndex)])) {
            const matches = repeats.filter((repeat) => replacementIndex(repeat) === index);
            const original = originalClusters.find(({ repeat, anchor, existing }) => replacementIndex(repeat) === index && screens[anchor] === existing);
            if (original && !matches.some((match) => match.cluster)) matches.push(original.repeat);
            if (index === 0 || (!lostEvidence.has(index) && !matches.length)) continue;
            const distinct = (candidate: StudioPlannedScreen) =>
                !studioDetailRepeats(
                    screens.map((screen, position) => (position === index ? candidate : screen)),
                    sameLayout,
                    index,
                ).length;
            const choice = alternatives.findIndex(distinct);
            let candidate = choice >= 0 ? alternatives.splice(choice, 1)[0] : undefined;
            if (!candidate && matches.some(({ field }) => field === "purpose" || field === "visual")) {
                for (const fact of detailFacts) {
                    const id = `fact:${fact.id}`;
                    const source = sources.find((entry) => entry.id === id);
                    const label = fact.label.trim();
                    if (!source?.value || !label) continue;
                    const value = source.value;
                    if (screens.some((screen) => screen.evidenceRefs?.includes(id) || [screen.purchaseQuestion, screen.displayContent, screen.visualFocus].some((text) => text?.includes(label) || text?.includes(value)))) continue;
                    const role = fact.group === "spec" && allowed.has("detail-spec") ? "detail-spec" : fact.group === "usage" && allowed.has("detail-steps") ? "detail-steps" : "detail-closeup";
                    const brief = readScreen({ role, purchaseQuestion: `下单前要了解的${label}是什么？`, displayContent: source.text, visualFocus: label, evidence: [id] }, index, true);
                    if (brief && distinct(brief)) {
                        candidate = brief;
                        break;
                    }
                }
            }
            if (!candidate && matches.some(({ recap, cluster }) => recap || cluster)) {
                const rest = screens.filter((_, position) => position !== index);
                for (const edit of studioDetailEditorialCandidates(
                    product,
                    sources,
                    allFacts,
                    rest,
                    matches.some((match) => match.cluster),
                    screens[index + 1],
                )) {
                    const brief = readScreen(edit, index, true);
                    if (brief && distinct(brief)) {
                        candidate = brief;
                        break;
                    }
                }
            }
            if (!candidate) {
                if (original) unresolvedClusters.push(original.repeat);
                continue;
            }
            screens[index] = candidate;
            delete screens[index - 1].transitionOut;
            replaced.add(index);
            repeats = studioDetailRepeats(screens, sameLayout);
        }
        for (const repeat of unresolvedClusters) {
            const target = replacementIndex(repeat);
            const anchor = repeat.replaceIndex === undefined ? repeat.previousIndex : repeat.index;
            if (!replaced.has(target) && !replaced.has(anchor) && !repeats.some((current) => replacementIndex(current) === target && current.field === repeat.field)) {
                warnings.push({ index: target, field: repeat.field, message: `与第 ${anchor + 1} ${unit}${repeat.reason}。没有找到不同的商品依据，已保留原屏。` });
            }
        }
    }
    const finalWarnings = warnings.filter(({ index }) => index === undefined || !replaced.has(index));
    for (const { index, field, reason, previousIndex, replaceIndex } of studioDetailRepeats(screens, sameLayout)) {
        const suggestion = field === "purpose" ? "可以改成另一条有依据的选购问题，只换构图不算新内容。" : "可以改为另一种看得见的主体、状态或使用关系。";
        finalWarnings.push({ index: replaceIndex ?? index, field, message: `与第 ${(replaceIndex === undefined ? previousIndex : index) + 1} ${unit}${reason}。${suggestion}` });
    }
    const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");
    return {
        plan: {
            id: meta.id,
            createdAt: meta.createdAt,
            inputSignature: studioPlanInputSignature(product),
            model: meta.model,
            summary: replaced.size ? "" : text(data.summary, STUDIO_DETAIL_PLAN_LIMITS.summary),
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
        warnings: finalWarnings,
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
