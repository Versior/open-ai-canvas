import { ecommercePlatform, ecommerceRoleSpec, type EcommercePlatformId, type EcommerceImageRole } from "@/lib/ecommerce/ecommerce-platform-specs";
import { studioCleanNotes, studioLanguage, studioMarket, studioShooting } from "./brief";
import { STUDIO_DESIGN_TONES, STUDIO_DETAIL_LAYOUTS, STUDIO_TACKY_DESIGN, studioForbidsEnglishHeading } from "./detail-plan";
import { studioActivePlan, studioStyleReferences } from "./runs";
import { STUDIO_COMPOSITIONS } from "./art-direction";
import { studioTypeInstruction } from "./typography";
import { studioFamilyRule, studioProductStyle, studioShotSpec, studioTweakInstruction, type StudioShotSpec } from "./shot-specs";
import {
    STUDIO_FACT_GROUP_LABEL,
    STUDIO_VIEW_LABEL,
    studioFactUsable,
    type StudioBrief,
    type StudioCompositionId,
    type StudioDesignToneId,
    type StudioFact,
    type StudioFactGroup,
    type StudioModelCast,
    type StudioModelPick,
    type StudioPhoto,
    type StudioPlan,
    type StudioProduct,
    type StudioShot,
    type StudioTextMode,
} from "./types";

/**
 * 分层编译：商品真值 + 镜头规格 + 风格锁 + 品类规则 + 平台规则 + 文案 + 模型适配。
 * 每层都标出来源，界面可以逐层展示；超长时按优先级裁掉修饰层，商品真值与这张图的目标永远保留。
 */
export type StudioModelFamily = "gpt-image" | "seedream" | "gemini" | "qwen" | "flux" | "generic";

export type StudioModelAdapter = {
    family: StudioModelFamily;
    label: string;
    /** 模型画中文的稳定程度，决定"模型直出文字"是否可用。 */
    textRendering: "strong" | "fair" | "weak";
};

export type StudioPromptLayerId =
    "truth" | "revision" | "goal" | "duty" | "visual" | "model" | "composition" | "shooting" | "lighting" | "style" | "product-design" | "set" | "category" | "market" | "audience" | "layout" | "design" | "copy" | "extra" | "adjust" | "quality";

export type StudioPromptLayer = {
    id: StudioPromptLayerId;
    title: string;
    source: string;
    text: string;
};

export type StudioCompiledPrompt = {
    prompt: string;
    layers: StudioPromptLayer[];
    textMode: StudioTextMode;
    textModeNotice?: string;
    adapter: StudioModelAdapter;
    /** 商品外观依据，排在参考图最前面。 */
    references: StudioPhoto[];
    /** 模特库的人脸、姿势参考，排在商品图之后、风格参考之前。 */
    modelReferences: StudioPhoto[];
    /** 风格或版式参考，排在模特参考之后。 */
    styleReferences: StudioPhoto[];
    revisionReference?: StudioPhoto;
    /** 模型能接收的参考图不够时，没带上的参考图说明。 */
    referenceNotice?: string;
    /** 生成前的区域参考；不替代商品真值，也不用于生成后的文字合成。 */
    layoutGuide?: { composition: StudioCompositionId; ratio: string };
    /** 因长度上限被裁掉的层。 */
    trimmed: StudioPromptLayerId[];
};

export type StudioCompileInput = {
    product: StudioProduct;
    /** 助手方案按方案的文字方式；表单记录直接传 textMode。 */
    plan?: Pick<StudioPlan, "textMode">;
    textMode?: StudioTextMode;
    shot: StudioShot;
    model: string;
    /** 模型能力里的提示词上限；缺省按 4000 字处理。 */
    maxChars?: number;
    /** 模型单次可接收的参考图数量；缺省 4 张。 */
    maxReferences?: number;
    /** 必须是本镜头已有的成功成品，不把其他资源当商品真值。 */
    revisionResourceId?: string;
    /** 表单参数：传入时追加市场与语言、拍法、人群定位、参考图和补充要求。 */
    brief?: StudioBrief;
    /** 模板套图的模板名与整套视觉规范：有规范时代替风格锁。 */
    suite?: { name: string; style: string; designAnalysis?: string; tone?: StudioDesignToneId; concept?: string; motifs?: string[] };
};

const DEFAULT_MAX_CHARS = 4000;
const DEFAULT_MAX_REFERENCES = 4;
// 真值、构图、色板、文案和用户要求是生成契约；不能为满足长度静默丢掉已选配色。
const TRIM_ORDER: StudioPromptLayerId[] = ["quality", "category", "set", "lighting", "audience"];
const TRUTH_GROUP_ORDER: StudioFactGroup[] = ["identity", "appearance", "material", "structure", "text", "spec", "package", "usage"];
const VIEW_ORDER = ["front", "side", "back", "detail", "package", "scene", "other", "tag"] as const;

export function studioModelAdapter(model: string): StudioModelAdapter {
    const name = model.toLowerCase();
    if (/gpt[-_ ]?image|dall[-_ ]?e/.test(name)) return { family: "gpt-image", label: "GPT Image", textRendering: "strong" };
    if (/seedream|doubao|seededit/.test(name)) return { family: "seedream", label: "Seedream", textRendering: "strong" };
    if (/qwen/.test(name)) return { family: "qwen", label: "通义千问图像", textRendering: "strong" };
    if (/gemini|nano[-_ ]?banana|imagen/.test(name)) return { family: "gemini", label: "Gemini 图像", textRendering: "fair" };
    if (/flux/.test(name)) return { family: "flux", label: "FLUX", textRendering: "weak" };
    return { family: "generic", label: "通用图像模型", textRendering: "fair" };
}

/** 出图用的参考图：只取外观真值图，正面优先，吊牌这类读文字的图不进生图参考。 */
export function studioReferencePhotos(photos: StudioPhoto[], maxReferences = DEFAULT_MAX_REFERENCES) {
    const truth = photos.filter((photo) => photo.truth && photo.view !== "tag");
    const ordered = [...truth].sort((a, b) => VIEW_ORDER.indexOf(a.view) - VIEW_ORDER.indexOf(b.view));
    return ordered.slice(0, Math.max(1, maxReferences));
}

export function studioShotHasCopy(shot: Pick<StudioShot, "headline" | "subline" | "lines">, spec: Pick<StudioShotSpec, "copySlot">) {
    if (spec.copySlot === "none") return false;
    return Boolean(shot.headline.trim() || shot.subline.trim() || shot.lines.some((line) => line.trim()));
}

export function studioEffectiveTextMode(_plan: Pick<StudioPlan, "textMode">, adapter: StudioModelAdapter): { mode: "model"; notice?: string } {
    return { mode: "model", ...(adapter.textRendering === "weak" ? { notice: `${adapter.label} 文字表现可能不稳定，请核对成品或选择擅长文字的图片模型` } : {}) };
}

/** 平台对这类图的硬性要求。这张图本来就要写字时不再加「不出现文字」，避免和文案要求互相矛盾。 */
export function studioPlatformRuleText(platformId: EcommercePlatformId, role: EcommerceImageRole, hasCopy = false) {
    const spec = ecommerceRoleSpec(platformId, role);
    if (!spec) return "";
    const rules: string[] = [];
    if (spec.whiteBackground) rules.push("纯白背景");
    if (spec.minSubjectRatio) rules.push(`主体占比不低于 ${Math.round(spec.minSubjectRatio * 100)}%`);
    if (spec.noText && !hasCopy) rules.push("画面不出现额外文字");
    else if (spec.maxTextRatio) rules.push(`文字面积不超过画面的 ${Math.round(spec.maxTextRatio * 100)}%`);
    return rules.length ? `平台要求：${rules.join("，")}。` : "";
}

function quote(value: string) {
    return `「${value.trim()}」`;
}

function sentence(value: string) {
    const text = value.trim();
    if (!text) return "";
    return /[。！？.!?]$/.test(text) ? text : `${text}。`;
}

function factText(fact: StudioFact) {
    const value = fact.group === "text" ? quote(fact.value) : fact.value.trim();
    return `${fact.label.trim()} ${value}`;
}

function oneLine(value: string) {
    return value
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean)
        .join("；");
}

/** 这张图有没有模特：上身效果镜头，或者表单选了「模特穿搭/使用」拍法。 */
export function studioShotUsesModel(shot: Pick<StudioShot, "role">, brief?: Pick<StudioBrief, "shooting">) {
    return shot.role === "detail-model" || brief?.shooting === "model";
}

type CastImageKind = "face" | "figure" | "pose";
const CAST_IMAGE_LABEL: Record<CastImageKind, string> = { face: "模特人脸", figure: "全身模特", pose: "姿势" };

function castReference(kind: CastImageKind, pick: StudioModelPick): StudioPhoto {
    return { id: `model-${kind}-${pick.itemId}`, resourceId: pick.resourceId!, url: "", view: "other", truth: false, name: `${CAST_IMAGE_LABEL[kind]}-${pick.name}`, width: pick.width, height: pick.height, addedAt: "" };
}

/** 模特设定：人脸、全身模特和姿势有参考图时按图号说明用法，放不下参考图时退回文字描述；造型只用文字。全身模特和人脸二选一，都有时用全身模特。 */
function modelLayer(cast: StudioModelCast, modelReferences: StudioPhoto[], offset: number): StudioPromptLayer | undefined {
    const lines: string[] = [];
    const indexOf = (kind: CastImageKind) => {
        const index = modelReferences.findIndex((photo) => photo.id.startsWith(`model-${kind}-`));
        return index < 0 ? 0 : offset + index + 1;
    };
    if (cast.figure) {
        const index = indexOf("figure");
        if (index)
            lines.push(
                `画面里的模特以图${index}的人物为准：长相、发型、肤色、身材比例与气质保持一致，是同一个人${cast.pose ? "" : `，没有另选姿势时可以参考图${index}的站姿`}；图${index}只提供人物本身，不照搬它的服装、配饰、背景和光线。${cast.figure.prompt ? `外貌与身材：${sentence(cast.figure.prompt)}` : ""}`,
            );
        else lines.push(`模特外貌与身材：${sentence(cast.figure.prompt || cast.figure.name)}`);
    } else if (cast.face) {
        const index = indexOf("face");
        if (index) lines.push(`画面里的模特以图${index}的人物为准：脸型、五官、肤色、发型与气质保持一致，是同一个人；图${index}只提供人物长相，不照搬它的服装、背景和光线。${cast.face.prompt ? `外貌：${sentence(cast.face.prompt)}` : ""}`);
        else lines.push(`模特外貌：${sentence(cast.face.prompt || cast.face.name)}`);
    }
    if (cast.pose) {
        const index = indexOf("pose");
        if (index) lines.push(`模特的身体姿势参考图${index}：身体朝向、四肢位置和重心与图${index}一致；图${index}只提供姿势，不照搬它的服装、体型和背景。${cast.pose.prompt ? `姿势：${sentence(cast.pose.prompt)}` : ""}`);
        else lines.push(`姿势：${sentence(cast.pose.prompt || cast.pose.name)}`);
    }
    if (cast.style?.prompt.trim()) lines.push(`造型：${sentence(cast.style.prompt)}`);
    if (!lines.length) return undefined;
    lines.push("模特身份以所选资料为准，穿戴或使用的是这件商品；商品的外观仍以商品图为准，模特设定不改变商品。");
    return { id: "model", title: "模特设定（模特库）", source: "模特库", text: lines.join("\n") };
}

function truthLayer(product: StudioProduct, references: StudioPhoto[], styleReferences: StudioPhoto[], brief?: StudioBrief, modelReferences: StudioPhoto[] = []): StudioPromptLayer {
    const dossier = product.dossier;
    const range = references.length > 1 ? `图1–图${references.length}` : "图1";
    const lines: string[] = [];
    const productType = brief?.productType.trim() || dossier?.category.trim() || "";
    const identity = [productType, dossier?.summary.trim() || ""].filter(Boolean).join("：");
    if (identity) lines.push(sentence(identity));
    else if (product.name.trim()) lines.push(`商品：${product.name.trim()}，外观以参考图为准。`);
    if (brief?.brand.trim()) lines.push(`品牌：${brief.brand.trim()}（商品上的标识按商品图原样保留，不另外加品牌字样）。`);
    if (brief && product.sellerNotes.trim()) lines.push(`卖家提供的商品信息：${oneLine(studioCleanNotes(product.sellerNotes)).slice(0, 600)}。`);
    if (dossier) {
        const usable = dossier.facts.filter((fact) => studioFactUsable(fact) && fact.group !== "usage");
        for (const group of TRUTH_GROUP_ORDER) {
            // 品类与名称已经写在首行，身份组里只保留品牌、系列这类额外信息。
            const facts = usable.filter((fact) => fact.group === group && !(group === "identity" && /^(品类|类目|名称|商品名称)$/.test(fact.label.trim())));
            if (!facts.length) continue;
            const suffix = group === "text" ? "（逐字保留内容与位置）" : "";
            lines.push(`${STUDIO_FACT_GROUP_LABEL[group]}${suffix}：${facts.map(factText).join("；")}。`);
        }
    }
    const attached = [
        ...references.map((photo, index) => `图${index + 1} ${STUDIO_VIEW_LABEL[photo.view]}`),
        ...modelReferences.map((photo, index) => `图${references.length + index + 1} ${photo.id.startsWith("model-face-") ? "模特长相参考" : photo.id.startsWith("model-figure-") ? "模特全身参考" : "模特姿势参考"}（不是这件商品）`),
        ...styleReferences.map((_, index) => `图${references.length + modelReferences.length + index + 1} 参考图（不是这件商品）`),
    ];
    if (attached.length) lines.push(`附图：${attached.join("，")}。`);
    lines.push("商品图只锁定商品身份。按本屏方案重新拍摄或排版，不照搬原图的背景、台面、光线、投影、裁切与商品占位；风格参考只参考色调与摄影语言，不复制其标题位置。");
    const invariants = (dossier?.invariants || []).map((item) => item.trim()).filter(Boolean);
    lines.push(`保持形状、比例、颜色、材质、标识和刻字位置完全不变${invariants.length ? `，尤其注意：${invariants.join("、")}` : ""}；不添加商品图里没有的部件，不生成相似款。`);
    return { id: "truth", title: `商品真值｜${range}是外观唯一依据`, source: brief ? "商品图 + 表单里的商品信息 + 已确认的档案事实" : "商品档案（只取图片可见与已确认的事实）", text: lines.join("\n") };
}

function goalLayer(product: StudioProduct, shot: StudioShot, spec: StudioShotSpec, hasCopy: boolean, planned: boolean): StudioPromptLayer {
    const platform = ecommercePlatform(product.platform);
    const rule = studioPlatformRuleText(product.platform, spec.platformRole, hasCopy);
    // 策划过的屏把这一屏的目的写在画面层里，不再套镜头规格的通用目的。
    const text = `${platform?.name || "电商平台"}·${shot.title || spec.title}，画幅 ${shot.ratio}。${planned ? "" : sentence(spec.purpose)}${rule ? `\n${rule}` : ""}`;
    return { id: "goal", title: "这张图做什么", source: planned ? "出图策划 + 平台规则" : "镜头规格 + 平台规则", text };
}

/** 出图策划给这一屏写的目的与画面：代替镜头规格的构图、机位、光线和背景；商品外观仍只看商品图。 */
function visualLayer(shot: StudioShot): StudioPromptLayer {
    return {
        id: "visual",
        title: "这一屏的画面",
        source: "出图策划",
        text: `${shot.visual!.trim()}\n画面里提到的商品外观和属性以上面的商品真值为准，不新增商品没有的部件、功能和配件。${/包装|盒/.test(shot.visual!) ? "" : "这一屏只出现画面里写到的商品部分，不要把包装盒也摆进来。"}`,
    };
}

/** 表单里的市场、语言、拍法、人群和补充要求；没填的项不出现。 */
function briefLayers(brief: StudioBrief, hasCopy: boolean): StudioPromptLayer[] {
    const layers: StudioPromptLayer[] = [];
    const shooting = studioShooting(brief.shooting);
    if (shooting.prompt) layers.push({ id: "shooting", title: `拍摄方式「${shooting.label}」`, source: "生图表单", text: shooting.prompt });
    const language = studioLanguage(brief.language);
    const languageText = brief.language === "none" ? "画面中不出现任何文字（商品本身的标识除外）。" : hasCopy ? `画面上的文字使用${language.name}。` : "";
    layers.push({ id: "market", title: "市场与语言", source: "生图表单", text: `${studioMarket(brief.market).prompt}${languageText}` });
    const audience = [brief.audience.trim() ? `目标人群：${brief.audience.trim()}` : "", brief.positioning.trim() ? `价格定位：${brief.positioning.trim()}` : ""].filter(Boolean);
    if (audience.length) layers.push({ id: "audience", title: "人群与定位", source: "生图表单", text: `${audience.join("；")}。画面气质、场景和道具与之匹配；不写价格和促销信息。` });
    return layers;
}

function layoutLayer(brief: StudioBrief, references: StudioPhoto[], styleReferences: StudioPhoto[], modelCount = 0): StudioPromptLayer | undefined {
    if (!styleReferences.length) return undefined;
    const first = references.length + modelCount + 1;
    const range = styleReferences.length > 1 ? `图${first}–图${first + styleReferences.length - 1}` : `图${first}`;
    const productRange = references.length > 1 ? `图1–图${references.length}` : "图1";
    if (brief.sameLayout) {
        return {
            id: "layout",
            title: "按参考图版式出图（同款）",
            source: "参考图",
            text: `照着${range}的版式出图：商品摆放位置、构图、文字区位置、配色和装饰元素尽量一致，与上面的构图要求冲突时以参考图为准。画面里的商品换成${productRange}这件商品；不照搬参考图里的商品、品牌和文字。`,
        };
    }
    return { id: "layout", title: "风格参考", source: "参考图", text: `参考${range}的色调、光线和氛围，构图按上面的要求；不要出现参考图里的商品、品牌和文字。` };
}

/** 模板给这张图的职责：排在镜头规格前，冲突时以它为准；商品外观仍只看商品图。 */
function dutyLayer(shot: StudioShot): StudioPromptLayer | undefined {
    const duty = shot.duty?.trim();
    if (!duty) return undefined;
    return {
        id: "duty",
        title: "套图模板对这张图的要求",
        source: "套图模板",
        text: `${duty}\n与下面的构图、机位、光线和背景要求冲突时，以这一条为准；商品外观仍以商品图为准，模板里提到的属性、价格和功效不照搬。`,
    };
}

/** 图文骨架先于摄影描述，避免系列规范或画面描述把左右分栏改成上文下图。 */
function compositionLayer(shot: StudioShot, spec: StudioShotSpec, planned: boolean, guideIndex?: number): StudioPromptLayer | undefined {
    const tweaks = shot.tweaks.map(studioTweakInstruction).filter((item): item is string => Boolean(item));
    const adjust = tweaks.length ? `本次调整：${tweaks.join("；")}。` : "";
    if (planned && !shot.composition) return adjust ? { id: "composition", title: "本次调整", source: "微调标签", text: adjust } : undefined;
    if (planned && shot.composition) {
        const composition = STUDIO_COMPOSITIONS[shot.composition];
        const zone = composition.zone;
        return {
            id: "composition",
            title: `本屏构图契约｜${composition.label}`,
            source: "选定的图文骨架",
            text: [
                `${composition.render}。主标题与注解限定在：左 ${Math.round(zone.x * 100)}%、上 ${Math.round(zone.y * 100)}%、宽 ${Math.round(zone.width * 100)}%、高 ${Math.round(zone.height * 100)}%。`,
                shot.composition === "left" || shot.composition === "right" ? "保持左右分栏，主标题不放到横跨画面的顶部；不能改成上文下图或商品居中、标题置顶。" : "按上述区域建立图文重心。",
                "本屏构图优先于画面描述、整套风格中相反的位置描述；这些描述只提供场景、商品焦点、色彩与光线。信息标签依附本屏信息元素，不替换主标题区。",
                guideIndex
                    ? `图${guideIndex}为本屏布局草图：深色粗条代表主标题、浅细条代表注解，浅灰大块代表商品摄影区。严格按草图分区安排真实文字与商品；草图不提供颜色、字体或商品形状，不照搬矩形、线条或空白。保持前面的真实商品外观，按本屏画面重新摄影，在文字区一次生成给定中文文案。`
                    : "",
                adjust,
            ]
                .filter(Boolean)
                .join("\n"),
        };
    }
    const text = [sentence(shot.composition ? STUDIO_COMPOSITIONS[shot.composition].render : spec.composition), sentence(spec.camera), adjust].filter(Boolean).join("\n");
    return { id: "composition", title: "构图与机位", source: "镜头规格", text };
}

function copyLayer(shot: StudioShot, spec: StudioShotSpec, mode: StudioTextMode, hasCopy: boolean, brief?: StudioBrief, planned = false, tone?: StudioDesignToneId): StudioPromptLayer | undefined {
    if (planned && !hasCopy) return { id: "copy", title: "文字", source: "出图策划", text: "这一屏不放文字，画面中不生成任何文字（商品本身的标识除外）。" };
    if (planned && mode === "model") {
        const layout = shot.layout ? STUDIO_DETAIL_LAYOUTS[shot.layout] : undefined;
        const composition = shot.composition ? STUDIO_COMPOSITIONS[shot.composition] : undefined;
        const lines: string[] = [composition ? `位置：遵守前面的「${composition.label}」构图契约。` : "位置：按本屏画面说明排，不压在商品上。", "整套共用字体家族与色板，标题位置、字号和留白随本屏内容变化。", studioTypeInstruction(tone)];
        if (shot.eyebrow?.trim()) lines.push(`栏目小标题${quote(shot.eyebrow)}：放在主标题上方，小号字、字距加宽，用整套规范里的强调色。`);
        // 字重跟设计调性走：极简调性要细到中等字重，爆款调性才用粗字重，不一律加粗。
        if (shot.headline.trim()) lines.push(`主标题${quote(shot.headline)}：这一屏最大的文字，按构图分行，海报屏可大胆放大，细节屏克制；字重按设计调性。`);
        if (shot.subline.trim()) lines.push(`注解${quote(shot.subline)}：常规黑体，字号约主标题的三分之一；与标题拉开呼吸间距，补充依据，不重复标题。`);
        const items = shot.lines.map((line) => line.trim()).filter(Boolean);
        if (items.length) lines.push(`${layout?.lines || "要点（每行一条，行距宽松）"}：${items.map(quote).join(" ")}`);
        const levels = [shot.eyebrow?.trim(), shot.headline.trim(), shot.subline.trim(), items.length ? "lines" : ""].filter(Boolean).length;
        if (levels > 1) lines.push("这几层文字字号拉开层级，主标题明显最大，其余逐级变小，对齐整齐。");
        if (brief && brief.language !== "zh" && brief.language !== "none") lines.push(`图内文字使用${studioLanguage(brief.language).name}：上面的文案不是这种语言时，先准确翻译，再逐字呈现译文。`);
        // 详情页是一张连续的长图：每屏不画页码、屏号和 01、02 这类序号；使用步骤和机理示意里的先后编号是内容，照常画。
        lines.push(
            shot.role === "detail-steps" ? "步骤用 1、2、3 这样的小编号标出先后，此外不加页码和屏号。" : shot.layout === "mechanism" ? "作用过程可以用 1、2、3 这样的小编号标出先后，此外不加页码和屏号。" : "画面里不出现页码、屏号和 01、02 这类序号。",
        );
        lines.push("除了上面这些文字，画面里可以有图标、细线、引线、圆点、色块和圆角信息卡这类设计元素，但不出现其他文字、数字、价格、角标或水印。");
        return { id: "copy", title: "图内文字（逐字呈现，不增不减）", source: "出图策划的文案", text: lines.join("\n") };
    }
    if (!hasCopy) {
        if (spec.copySlot === "none") return undefined;
        // 表单选了不加文字：不再预留文字区，整张图都给商品和场景。
        if (brief?.language === "none") return { id: "copy", title: "文字", source: "生图表单", text: "这张图不放文字，构图不必预留文字区；画面中不生成任何文字（商品本身的标识除外）。" };
        return { id: "copy", title: "文字区", source: "镜头规格", text: `${spec.textZone || "文字区"}保持干净留白；画面中不生成任何文字（商品本身的标识除外）。` };
    }
    const lines: string[] = [`位置：${shot.composition ? STUDIO_COMPOSITIONS[shot.composition].render : spec.textZone || "画面留白处"}。`];
    if (shot.headline.trim()) lines.push(`主标题${quote(shot.headline)}：粗体无衬线字体，深色，字高约为画面高度的 8%。`);
    if (shot.subline.trim()) lines.push(`副标题${quote(shot.subline)}：常规字重，字号约为主标题的一半，紧贴主标题下方。`);
    const items = shot.lines.map((line) => line.trim()).filter(Boolean);
    if (items.length) lines.push(`要点（每行一条，左对齐，行距宽松）：${items.map(quote).join(" ")}`);
    if (brief && brief.language !== "zh" && brief.language !== "none") lines.push(`图内文字使用${studioLanguage(brief.language).name}：上面的文案不是这种语言时，先准确翻译，再逐字呈现译文。`);
    lines.push("画面中不出现其他文字、价格、角标或水印。");
    return { id: "copy", title: "图内文字（逐字呈现，不增不减）", source: brief ? "生图表单里的标题与卖点" : "商品档案里的已确认文案", text: lines.join("\n") };
}

/**
 * 按商品材质的布光（与知识库 KB20 的布光条目同一套方法，这里是给图片模型的短句）：策划的屏不再套镜头规格的光线，
 * 商品是透明、凝胶、亮面瓶身或金属时，图片模型最容易拍得灰、平、脏，这里补一两句。
 */
const STUDIO_MATERIAL_LIGHTING: { pattern: RegExp; text: string }[] = [
    { pattern: /透明|亚克力|玻璃|镜片|水晶|通透/, text: "透明部分用背光或侧逆光打亮，边缘有清楚的深色轮廓线，透出背景的颜色，不要正面平光拍得发灰。" },
    { pattern: /凝胶|啫喱|乳液|精华|膏|霜|液|油/, text: "质地要看得见光泽和通透感：侧逆光让膏体或凝胶发亮，能看到细小气泡和柔和高光。" },
    { pattern: /软管|瓶|塑料|亮面|光面|罐/, text: "亮面沿真实形体方向保留干净高光，另一侧压暗出体积，商品标识清楚；不要因为材质相近添加瓶身、软管或其他商品结构。" },
    { pattern: /金属|不锈钢|铝|铜|镀|钛|合金/, text: "金属用大面积柔光做平滑的渐变高光，边缘有轮廓光，不要杂乱的亮点。" },
    { pattern: /棉|面料|针织|绒|皮革|丝|麻/, text: "面料用侧光掠过表面，打出纹理和起伏。" },
];

export function studioMaterialLighting(product: Pick<StudioProduct, "dossier" | "brief">) {
    const facts = (product.dossier?.facts || []).filter((fact) => ["material", "appearance", "structure"].includes(fact.group) && studioFactUsable(fact)).map((fact) => `${fact.label}${fact.value}`);
    const text = [product.brief.productType, product.dossier?.category, product.dossier?.name, ...facts].filter(Boolean).join(" ");
    return STUDIO_MATERIAL_LIGHTING.filter((item) => item.pattern.test(text))
        .slice(0, 2)
        .map((item) => item.text);
}

export function compileStudioPrompt(input: StudioCompileInput): StudioCompiledPrompt {
    const { product, shot, brief } = input;
    if (studioForbidsEnglishHeading([product.brief.planNote, brief?.extra ?? product.brief.extra, shot.adjust].join("\n")) && /[A-Za-z]/.test(shot.eyebrow || "")) {
        throw new Error("这张图含有明确禁止的英文栏目，请重新策划或把栏目改为中文后再生成");
    }
    const textMode: StudioTextMode = "model";
    const family = product.dossier?.family || "generic";
    const spec = studioShotSpec(shot.role, family);
    const adapter = studioModelAdapter(input.model);
    const capacity = Math.max(1, input.maxReferences || DEFAULT_MAX_REFERENCES);
    const revisionOutput = input.revisionResourceId
        ? shot.attempts
              .filter((attempt) => attempt.status === "succeeded")
              .flatMap((attempt) => attempt.outputs)
              .find((output) => output.resourceId === input.revisionResourceId)
        : undefined;
    if (input.revisionResourceId && !revisionOutput) throw new Error("用于修正的成品已不在这张图的成功记录里，请重新选择");
    if (revisionOutput && capacity < 2) throw new Error("当前模型只能带一张图，无法同时核对商品和修正成品，请选择支持多参考图的模型");
    const revisionReference: StudioPhoto | undefined = revisionOutput ? { id: revisionOutput.resourceId, resourceId: revisionOutput.resourceId, url: "", view: "other", truth: false, name: "待修正成品.png", addedAt: "" } : undefined;
    const maxReferences = capacity - (revisionReference ? 1 : 0);
    // 商品图优先占参考图名额，至少一张；剩下的依次给模特（全身模特或人脸）、姿势和风格参考，模型只收一张图时只带商品图。
    const cast = brief && studioShotUsesModel(shot, brief) ? brief.model : undefined;
    const person = cast?.figure ? castReference("figure", cast.figure) : cast?.face ? castReference("face", cast.face) : undefined;
    const wantedModel = [person, cast?.pose ? castReference("pose", cast.pose) : undefined].filter((photo): photo is StudioPhoto => Boolean(photo?.resourceId));
    const wantedStyle = brief ? studioStyleReferences({ ...product, brief }, maxReferences) : [];
    const extras = wantedModel.length + (wantedStyle.length ? 1 : 0);
    const references = studioReferencePhotos(product.photos, Math.max(1, maxReferences - Math.min(extras, maxReferences - 1)));
    const modelReferences = wantedModel.slice(0, Math.max(0, maxReferences - references.length));
    const styleReferences = wantedStyle.slice(0, Math.max(0, maxReferences - references.length - modelReferences.length));
    const dropped = [wantedModel.length > modelReferences.length ? "模特参考图" : "", wantedStyle.length > styleReferences.length ? (styleReferences.length ? "多出的参考图" : "参考图") : ""].filter(Boolean);
    const referenceNotice = dropped.length ? `这个模型一次最多带 ${capacity} 张图${revisionReference ? "，已为待修正成品预留一张" : ""}，${dropped.join("和")}没有带上${wantedModel.length > modelReferences.length ? "，模特改用文字描述" : ""}` : undefined;
    const hasCopy = studioShotHasCopy(shot, spec);
    const effective = hasCopy ? studioEffectiveTextMode({ textMode }, adapter) : { mode: textMode };
    const style = studioProductStyle(product, studioActivePlan({ brief: brief ?? product.brief })?.styleId);
    // 策划过的屏：画面层代替镜头规格的构图、光线、背景和避坑项，免得每件商品都套同一套写法。
    const planned = Boolean(shot.visual?.trim());
    const referenceCount = references.length + modelReferences.length + styleReferences.length;
    const layoutGuide =
        planned && hasCopy && (brief ?? product.brief).language !== "none" && shot.composition && shot.composition !== "corner" && !brief?.sameLayout && !revisionReference && referenceCount < maxReferences
            ? { composition: shot.composition, ratio: shot.ratio }
            : undefined;
    const layers: StudioPromptLayer[] = [truthLayer(product, references, styleReferences, brief, modelReferences), goalLayer(product, shot, spec, hasCopy, planned)];
    if (revisionReference)
        layers.splice(1, 0, {
            id: "revision",
            title: "修正当前成品",
            source: "大图中选定的候选",
            text: `图${referenceCount + 1}是待修正的当前成品，不是商品真值。以这张图为编辑起点，按本次修改要求调整图文位置、文字或画面，保留无需修改的设计。成品里已有的错误位置、错字、多余装饰和商品变形不能继承；商品外观仍以最前面的商品实拍为准，文案以本次给定文字为准。图片模型在同一次编辑中完成文字和画面，不输出待叠字底图。`,
        });
    const duty = dutyLayer(shot);
    if (duty) layers.push(duty);
    const composition = compositionLayer(shot, spec, planned, layoutGuide ? referenceCount + 1 : undefined);
    if (composition) layers.push(composition);
    if (planned) layers.push(visualLayer(shot));
    const extra = brief ? briefLayers(brief, hasCopy) : [];
    const shooting = extra.find((layer) => layer.id === "shooting");
    if (shooting) layers.push(shooting);
    const modelSetting = cast ? modelLayer(cast, modelReferences, references.length) : undefined;
    if (modelSetting) layers.push(modelSetting);
    if (!planned) {
        // 没策划的图也按商品材质补布光：透明、凝胶、亮面瓶身和金属最容易拍得灰、平、脏。
        const lighting = studioMaterialLighting(product);
        layers.push({ id: "lighting", title: "光线", source: lighting.length ? "镜头规格 + 设计策划知识（KB20）" : "镜头规格", text: [sentence(spec.lighting), ...lighting].join("\n") });
    } else {
        const lighting = studioMaterialLighting(product);
        if (lighting.length) layers.push({ id: "lighting", title: "按材质布光", source: "设计策划知识（KB20）", text: lighting.join("\n") });
    }
    const suite = input.suite?.style.trim() ? input.suite : undefined;
    if (!spec.neutralBackground && suite) {
        layers.push({
            id: "style",
            title: `整套视觉规范「${suite.name}」`,
            source: planned ? "出图策划" : "套图模板",
            // 创意主线和视觉元素是整套的方向，不是每张都要贴上的图形：每张只选用一两个，换着形式出现。
            // 系列规范保持品牌识别；逐屏构图优先，避免旧策划的固定栏目头再次覆盖新位置。
            text: `${sentence(suite.style)}${suite.concept?.trim() ? `创意主线：${sentence(suite.concept)}` : ""}${suite.motifs?.length ? `视觉元素库：${suite.motifs.join("、")}，这张图按画面需要选用其中一两个，换着形式出现，不是每张都要全用。` : ""}整套共用字体家族、色板、边距与图形语言${planned ? "；标题位置、字号与主体裁切以本屏图文构图为准，优先于整套规范中固定栏目头的位置要求，不能把每张套成同一模板" : ""}。`,
        });
    } else if (!spec.neutralBackground) {
        layers.push({
            id: "style",
            title: `风格锁「${style.name}」`,
            source: "整套共用的风格锁",
            text: `气质${style.mood}；色板 ${style.palette.map((color) => `${color.name} ${color.hex}`).join("、")}；光影${style.light}。整套图共用这一风格。`,
        });
    }
    // 策划挑的设计调性：版面节奏、字体和摄影的写法，整组一致。
    const tone = planned && suite?.tone ? STUDIO_DESIGN_TONES[suite.tone] : undefined;
    if (tone) layers.push({ id: "design", title: `设计调性「${tone.label}」`, source: "出图策划", text: sentence(tone.render) });
    if (!spec.neutralBackground && suite?.designAnalysis?.trim()) layers.push({ id: "product-design", title: "商品设计依据", source: "商品图文策划", text: sentence(suite.designAnalysis) });
    if (!planned) layers.push({ id: "set", title: "背景与道具", source: "镜头规格", text: sentence(spec.set) });
    if (!planned) layers.push({ id: "category", title: "品类要求", source: "品类规则", text: studioFamilyRule(family) });
    for (const layer of extra) if (layer.id !== "shooting") layers.push(layer);
    const layout = brief ? layoutLayer(brief, references, styleReferences, modelReferences.length) : undefined;
    if (layout) layers.push(layout);
    const copy = copyLayer(shot, spec, effective.mode, hasCopy, brief, planned, input.suite?.tone);
    if (copy) layers.push(copy);
    if (brief?.extra.trim()) layers.push({ id: "extra", title: "补充要求", source: "生图表单", text: `${sentence(brief.extra)}（以上要求不改变商品外观。）` });
    if (shot.adjust?.trim()) layers.push({ id: "adjust", title: "这一张的修改要求", source: "调整这一张", text: `${sentence(shot.adjust)}与上面的画面、构图要求冲突时以这一条为准；商品外观仍以商品图为准。` });
    const avoid = planned ? ["只出现商品图里有的部件、配件和细节", "不出现其他品牌、价格、促销角标和水印"] : [...spec.avoid];
    if (!planned && spec.copySlot === "none") avoid.push("画面中不出现任何文字（商品本身的标识除外）");
    // 策划的屏要像设计过的详情页，而不是一张商品照片加一行字。
    const designed = planned && hasCopy ? "整张是排过版的电商画面，不是单纯的商品照片：有一个一眼抓住人的视觉焦点，视觉层级清楚，元素对齐，疏密有致，图标和装饰的风格整组统一；摄影是商业大片级别，光线有方向和明暗层次，不要平光和灰蒙蒙的低对比；" : "";
    // 有字的图都不许出现显得廉价的字效和装饰。
    if (hasCopy && effective.mode === "model") avoid.push(STUDIO_TACKY_DESIGN);
    layers.push({ id: "quality", title: "质感与约束", source: planned ? "出图策划" : "镜头规格", text: `${designed}材质表现真实，边缘干净，没有塑料感和过度锐化；${avoid.join("；")}；商品自带的标识与文字按商品图保留，不出现乱码。` });

    const budget = Math.max(400, input.maxChars || DEFAULT_MAX_CHARS);
    const trimmed: StudioPromptLayerId[] = [];
    let kept = layers;
    let prompt = renderStudioPrompt(kept);
    for (const id of TRIM_ORDER) {
        if (prompt.length <= budget) break;
        if (!kept.some((layer) => layer.id === id)) continue;
        kept = kept.filter((layer) => layer.id !== id);
        trimmed.push(id);
        prompt = renderStudioPrompt(kept);
    }
    if (prompt.length > budget) throw new Error(`这张图的提示词超过模型上限 ${budget} 字，请精简商品信息或补充要求后再生成`);
    return { prompt, layers: kept, textMode: effective.mode, textModeNotice: effective.notice, adapter, references, modelReferences, styleReferences, revisionReference, referenceNotice, layoutGuide, trimmed };
}

export function renderStudioPrompt(layers: StudioPromptLayer[]) {
    return layers.map((layer) => `【${layer.title}】\n${layer.text}`).join("\n\n");
}
