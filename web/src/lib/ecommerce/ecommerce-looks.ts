/**
 * 出图风格——画布上那颗「风格」按钮在电商画布里该给什么。
 *
 * 自由画布的风格按钮给的是**模型调性**（赛博朋克、水墨、胶片……），那是给创作片用的。
 * 电商画布里这个位置该给的是**商品的拍法**：白底主图、真实种草图、模特上身图、高级海报。
 * 这两者不是同一个东西——设计师点「风格」时想的是「这张图拿去干什么」，
 * 不是「这张图看起来像什么流派」。
 *
 * 所以这里不新写内容，而是把已有的拍法预设**编译成可直接插进提示词的片段**：
 * 同一套构图/光线/背景，在拍法节点里是一行清单，在这里是一句话。
 * 一份内容两个入口，改的时候不会两边不同步。
 *
 * 分组按「这张图拿去干什么」排，不按摄影术语排——用户找的是「我要一张种草图」。
 */
import { ecommerceShotPreset, ECOMMERCE_STYLE_PRESETS } from "./ecommerce-recipes";
import { ecommerceShotLines } from "./ecommerce-contract";

export type EcommerceLook = {
    id: string;
    name: string;
    group: string;
    hint: string;
    /** 编译好的提示词片段，直接插进输入框。 */
    prompt: string;
};

/** 把一条拍法预设编译成可插入的提示词。空字段整段省略。 */
function lookFromPreset(presetId: string, group?: string): EcommerceLook | null {
    const preset = ecommerceShotPreset(presetId);
    if (!preset) return null;
    const lines = ecommerceShotLines({ id: preset.id, title: preset.name, ...preset.shot });
    if (!lines.length) return null;
    return { id: preset.id, name: preset.name, group: group || preset.group, hint: preset.hint, prompt: lines.join("；") };
}

/**
 * 精选的十五个「拍法」。不是把 33 种全搬过来——
 * 那颗按钮是给常用项开的口子，全量清单在拍法节点的库里。
 */
const LOOK_PRESET_IDS: { presetId: string; group: string }[] = [
    { presetId: "studio-white", group: "主图" },
    { presetId: "studio-grey", group: "主图" },
    { presetId: "flat-lay", group: "主图" },
    { presetId: "lifestyle-home", group: "场景" },
    { presetId: "lifestyle-kitchen", group: "场景" },
    { presetId: "lifestyle-cafe", group: "场景" },
    { presetId: "lifestyle-outdoor", group: "场景" },
    { presetId: "model-wearing", group: "人物" },
    { presetId: "model-holding", group: "人物" },
    { presetId: "ugc-lifestyle", group: "种草" },
    { presetId: "buyer-show", group: "种草" },
    { presetId: "plog-desk", group: "种草" },
    { presetId: "ootd", group: "种草" },
    { presetId: "unboxing", group: "种草" },
    { presetId: "promo-keyvisual", group: "营销" },
    { presetId: "new-arrival", group: "营销" },
];

export const ECOMMERCE_LOOKS: EcommerceLook[] = LOOK_PRESET_IDS
    .map(({ presetId, group }) => lookFromPreset(presetId, group))
    .filter((look): look is EcommerceLook => Boolean(look));

/** 品牌调性：六套色板与气质，编译成一句话。 */
function styleLookPrompt(presetId: string) {
    const preset = ECOMMERCE_STYLE_PRESETS.find((item) => item.id === presetId);
    if (!preset) return "";
    const { palette, tone, mood, typography } = preset.style;
    const lines = [
        palette.length ? `色板 ${palette.join("、")}` : "",
        tone.trim(),
        mood.trim(),
        typography.trim() ? `字体气质：${typography.trim()}` : "",
    ].filter(Boolean);
    return lines.join("；");
}

export const ECOMMERCE_STYLE_LOOKS: EcommerceLook[] = ECOMMERCE_STYLE_PRESETS
    .map((preset) => ({
        id: `style-${preset.id}`,
        name: preset.style.name,
        group: "品牌调性",
        hint: preset.hint,
        prompt: styleLookPrompt(preset.id),
    }))
    .filter((look) => Boolean(look.prompt));

export const ECOMMERCE_LOOK_GROUPS = ["主图", "场景", "人物", "种草", "营销", "品牌调性"] as const;

export function ecommerceLooksByGroup(): { group: string; looks: EcommerceLook[] }[] {
    const all = [...ECOMMERCE_LOOKS, ...ECOMMERCE_STYLE_LOOKS];
    return ECOMMERCE_LOOK_GROUPS
        .map((group) => ({ group, looks: all.filter((look) => look.group === group) }))
        .filter((entry) => entry.looks.length);
}
