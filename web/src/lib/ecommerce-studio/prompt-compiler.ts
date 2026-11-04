import { ecommercePlatform, ecommerceRoleSpec, type EcommercePlatformId, type EcommerceImageRole } from "@/lib/ecommerce/ecommerce-platform-specs";
import { studioLanguage, studioMarket, studioShooting } from "./brief";
import { studioStyleReferences } from "./runs";
import { STUDIO_FAMILY_RULES, STUDIO_TWEAKS, studioShotSpec, studioStyle, type StudioShotSpec } from "./shot-specs";
import { STUDIO_FACT_GROUP_LABEL, STUDIO_VIEW_LABEL, studioFactUsable, type StudioBrief, type StudioFact, type StudioFactGroup, type StudioPhoto, type StudioPlan, type StudioProduct, type StudioShot, type StudioTextMode } from "./types";

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

export type StudioPromptLayerId = "truth" | "goal" | "composition" | "shooting" | "lighting" | "style" | "set" | "category" | "market" | "audience" | "layout" | "copy" | "extra" | "quality";

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
    /** 风格或版式参考，排在商品图之后。 */
    styleReferences: StudioPhoto[];
    /** 模型能接收的参考图不够时，没带上的参考图说明。 */
    referenceNotice?: string;
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
    /** 表单参数：传入时追加市场与语言、拍法、人群定位、参考图和补充要求。 */
    brief?: StudioBrief;
};

const DEFAULT_MAX_CHARS = 4000;
const DEFAULT_MAX_REFERENCES = 4;
// 裁剪顺序：越靠前越先裁。真值、目标、构图、文案、参考图和用户的补充要求不参与裁剪。
const TRIM_ORDER: StudioPromptLayerId[] = ["quality", "category", "style", "set", "lighting", "audience"];
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

export function studioEffectiveTextMode(plan: Pick<StudioPlan, "textMode">, adapter: StudioModelAdapter): { mode: StudioTextMode; notice?: string } {
    if (plan.textMode === "model" && adapter.textRendering === "weak") return { mode: "overlay", notice: `${adapter.label} 画中文不稳定，这张图改为程序排字` };
    return { mode: plan.textMode };
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

function truthLayer(product: StudioProduct, references: StudioPhoto[], styleReferences: StudioPhoto[], brief?: StudioBrief): StudioPromptLayer {
    const dossier = product.dossier;
    const range = references.length > 1 ? `图1–图${references.length}` : "图1";
    const lines: string[] = [];
    const productType = brief?.productType.trim() || dossier?.category.trim() || "";
    const identity = [productType, dossier?.summary.trim() || ""].filter(Boolean).join("：");
    if (identity) lines.push(sentence(identity));
    else if (product.name.trim()) lines.push(`商品：${product.name.trim()}，外观以参考图为准。`);
    if (brief?.brand.trim()) lines.push(`品牌：${brief.brand.trim()}（商品上的标识按商品图原样保留，不另外加品牌字样）。`);
    if (brief && product.sellerNotes.trim()) lines.push(`卖家提供的商品信息：${oneLine(product.sellerNotes).slice(0, 600)}。`);
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
    const attached = [...references.map((photo, index) => `图${index + 1} ${STUDIO_VIEW_LABEL[photo.view]}`), ...styleReferences.map((_, index) => `图${references.length + index + 1} 参考图（不是这件商品）`)];
    if (attached.length) lines.push(`附图：${attached.join("，")}。`);
    const invariants = (dossier?.invariants || []).map((item) => item.trim()).filter(Boolean);
    lines.push(`保持形状、比例、颜色、材质、标识和刻字位置完全不变${invariants.length ? `，尤其注意：${invariants.join("、")}` : ""}；不添加商品图里没有的部件，不生成相似款。`);
    return { id: "truth", title: `商品真值｜${range}是外观唯一依据`, source: brief ? "商品图 + 表单里的商品信息 + 已确认的档案事实" : "商品档案（只取图片可见与已确认的事实）", text: lines.join("\n") };
}

function goalLayer(product: StudioProduct, shot: StudioShot, spec: StudioShotSpec, hasCopy: boolean): StudioPromptLayer {
    const platform = ecommercePlatform(product.platform);
    const rule = studioPlatformRuleText(product.platform, spec.platformRole, hasCopy);
    const text = `${platform?.name || "电商平台"}·${shot.title || spec.title}，画幅 ${shot.ratio}。${sentence(spec.purpose)}${rule ? `\n${rule}` : ""}`;
    return { id: "goal", title: "这张图做什么", source: "镜头规格 + 平台规则", text };
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

function layoutLayer(brief: StudioBrief, references: StudioPhoto[], styleReferences: StudioPhoto[]): StudioPromptLayer | undefined {
    if (!styleReferences.length) return undefined;
    const first = references.length + 1;
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

function compositionLayer(shot: StudioShot, spec: StudioShotSpec): StudioPromptLayer {
    const tweaks = shot.tweaks.map((id) => STUDIO_TWEAKS.find((tweak) => tweak.id === id)?.instruction).filter((item): item is string => Boolean(item));
    const text = [sentence(spec.composition), sentence(spec.camera), tweaks.length ? `本次调整：${tweaks.join("；")}。` : ""].filter(Boolean).join("\n");
    return { id: "composition", title: "构图与机位", source: "镜头规格", text };
}

function copyLayer(shot: StudioShot, spec: StudioShotSpec, mode: StudioTextMode, hasCopy: boolean, brief?: StudioBrief): StudioPromptLayer | undefined {
    if (!hasCopy) {
        if (spec.copySlot === "none") return undefined;
        // 表单选了不加文字：不再预留文字区，整张图都给商品和场景。
        if (brief?.language === "none") return { id: "copy", title: "文字", source: "生图表单", text: "这张图不放文字，构图不必预留文字区；画面中不生成任何文字（商品本身的标识除外）。" };
        return { id: "copy", title: "文字区", source: "镜头规格", text: `${spec.textZone || "文字区"}保持干净留白；画面中不生成任何文字（商品本身的标识除外）。` };
    }
    if (mode === "overlay") {
        return {
            id: "copy",
            title: "文字区",
            source: "文案由程序排字，模型只留白",
            text: `${spec.textZone || "文字区"}保持干净、连续、无纹理的背景，留给后期排字；画面中不生成任何文字、字母、数字或符号（商品本身的标识除外）。`,
        };
    }
    const lines: string[] = [`位置：${spec.textZone || "画面留白处"}。`];
    if (shot.headline.trim()) lines.push(`主标题${quote(shot.headline)}：粗体无衬线字体，深色，字高约为画面高度的 8%。`);
    if (shot.subline.trim()) lines.push(`副标题${quote(shot.subline)}：常规字重，字号约为主标题的一半，紧贴主标题下方。`);
    const items = shot.lines.map((line) => line.trim()).filter(Boolean);
    if (items.length) lines.push(`要点（每行一条，左对齐，行距宽松）：${items.map(quote).join(" ")}`);
    if (brief && brief.language !== "zh" && brief.language !== "none") lines.push(`图内文字使用${studioLanguage(brief.language).name}：上面的文案不是这种语言时，先准确翻译，再逐字呈现译文。`);
    lines.push("画面中不出现其他文字、价格、角标或水印。");
    return { id: "copy", title: "图内文字（逐字呈现，不增不减）", source: brief ? "生图表单里的标题与卖点" : "商品档案里的已确认文案", text: lines.join("\n") };
}

export function compileStudioPrompt(input: StudioCompileInput): StudioCompiledPrompt {
    const { product, shot, brief } = input;
    const textMode = input.textMode ?? input.plan?.textMode ?? "model";
    const family = product.dossier?.family || "generic";
    const spec = studioShotSpec(shot.role, family);
    const adapter = studioModelAdapter(input.model);
    const maxReferences = Math.max(1, input.maxReferences || DEFAULT_MAX_REFERENCES);
    // 商品图优先占参考图名额；有参考图时至少给它留一个位置，模型只收一张图时只带商品图。
    const wantedStyle = brief ? studioStyleReferences({ ...product, brief }, maxReferences) : [];
    const references = studioReferencePhotos(product.photos, wantedStyle.length && maxReferences > 1 ? maxReferences - 1 : maxReferences);
    const styleReferences = wantedStyle.slice(0, Math.max(0, maxReferences - references.length));
    const referenceNotice = wantedStyle.length > styleReferences.length ? `这个模型一次最多带 ${maxReferences} 张图，${styleReferences.length ? "多出的参考图" : "参考图"}没有带上` : undefined;
    const hasCopy = studioShotHasCopy(shot, spec);
    const effective = hasCopy ? studioEffectiveTextMode({ textMode }, adapter) : { mode: textMode };
    const style = studioStyle(product.style);
    const layers: StudioPromptLayer[] = [truthLayer(product, references, styleReferences, brief), goalLayer(product, shot, spec, hasCopy), compositionLayer(shot, spec)];
    const extra = brief ? briefLayers(brief, hasCopy) : [];
    const shooting = extra.find((layer) => layer.id === "shooting");
    if (shooting) layers.push(shooting);
    layers.push({ id: "lighting", title: "光线", source: "镜头规格", text: sentence(spec.lighting) });
    if (!spec.neutralBackground) {
        layers.push({
            id: "style",
            title: `风格锁「${style.name}」`,
            source: "整套共用的风格锁",
            text: `气质${style.mood}；色板 ${style.palette.map((color) => `${color.name} ${color.hex}`).join("、")}；光影${style.light}。整套图共用这一风格。`,
        });
    }
    layers.push({ id: "set", title: "背景与道具", source: "镜头规格", text: sentence(spec.set) });
    layers.push({ id: "category", title: "品类要求", source: "品类规则", text: STUDIO_FAMILY_RULES[family] });
    for (const layer of extra) if (layer.id !== "shooting") layers.push(layer);
    const layout = brief ? layoutLayer(brief, references, styleReferences) : undefined;
    if (layout) layers.push(layout);
    const copy = copyLayer(shot, spec, effective.mode, hasCopy, brief);
    if (copy) layers.push(copy);
    if (brief?.extra.trim()) layers.push({ id: "extra", title: "补充要求", source: "生图表单", text: `${sentence(brief.extra)}（以上要求不改变商品外观。）` });
    const avoid = [...spec.avoid];
    if (spec.copySlot === "none") avoid.push("画面中不出现任何文字（商品本身的标识除外）");
    layers.push({ id: "quality", title: "质感与约束", source: "镜头规格", text: `材质表现真实，边缘干净，没有塑料感和过度锐化；${avoid.join("；")}；商品自带的标识与文字按商品图保留，不出现乱码。` });

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
    return { prompt, layers: kept, textMode: effective.mode, textModeNotice: effective.notice, adapter, references, styleReferences, referenceNotice, trimmed };
}

export function renderStudioPrompt(layers: StudioPromptLayer[]) {
    return layers.map((layer) => `【${layer.title}】\n${layer.text}`).join("\n\n");
}
