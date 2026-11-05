import { STUDIO_MARKETS, STUDIO_SHOOTINGS } from "./brief";
import { STUDIO_FAMILY_RULES, STUDIO_SHOT_PROMPT_FIELDS, STUDIO_STYLES, STUDIO_TWEAKS, studioDefaultShotSpec, studioShotPromptKey, type StudioShotPromptField } from "./shot-specs";
import { STUDIO_FAMILY_LABEL, type StudioCategoryFamily, type StudioShotRole } from "./types";

/**
 * 后台「出图提示词」能改的条目清单：编号、显示名和内置写法。编号与出图时查覆盖用的编号一致，
 * 新增可改的提示词时在这里登记，后台编辑器和服务端校验（编号格式、条数上限）都按它来。
 */
export type StudioPromptEntry = { key: string; label: string; defaultText: string };
export type StudioPromptGroup = { id: string; title: string; hint: string; entries: StudioPromptEntry[] };

const ROLES: StudioShotRole[] = [
    "main-white",
    "main-selling",
    "main-scene",
    "main-detail",
    "main-angle",
    "main-flatlay",
    "detail-hero",
    "detail-selling",
    "detail-model",
    "detail-scene",
    "detail-material",
    "detail-closeup",
    "detail-angles",
    "detail-spec",
    "detail-size",
    "detail-package",
    "detail-seeding",
    "detail-compare",
    "detail-steps",
    "detail-collocation",
    "detail-campaign",
    "detail-ugc",
    "detail-closing",
];

const FIELD_LABEL: Record<StudioShotPromptField, string> = {
    purpose: "这张图做什么",
    composition: "构图",
    camera: "机位与镜头",
    lighting: "光线",
    set: "背景与道具",
    avoid: "约束（多条用「；」分隔）",
};

export function studioPromptGroups(): StudioPromptGroup[] {
    const shots = ROLES.map((role): StudioPromptGroup => {
        const spec = studioDefaultShotSpec(role);
        return {
            id: `shot.${role}`,
            title: `${role.startsWith("main-") ? "主图" : "详情页"} · ${spec.title}`,
            hint: `出图类型或套图镜头为「${spec.title}」时使用（${role}）。`,
            entries: STUDIO_SHOT_PROMPT_FIELDS.map((field) => ({ key: studioShotPromptKey(role, field), label: FIELD_LABEL[field], defaultText: field === "avoid" ? spec.avoid.join("；") : spec[field] })),
        };
    });
    return [
        ...shots,
        {
            id: "shooting",
            title: "拍摄方式",
            hint: "表单里选了拍摄方式时追加的要求；「按出图类型」不加文字。",
            entries: STUDIO_SHOOTINGS.filter((item) => item.id !== "auto").map((item) => ({ key: `shooting.${item.id}`, label: item.label, defaultText: item.prompt })),
        },
        { id: "market", title: "市场", hint: "按目标市场写的审美与人物要求。", entries: STUDIO_MARKETS.map((item) => ({ key: `market.${item.id}`, label: item.label, defaultText: item.prompt })) },
        {
            id: "style",
            title: "质感（风格锁）",
            hint: "整套图共用的气质与光影；色板仍按内置。",
            entries: STUDIO_STYLES.flatMap((style) => [
                { key: `style.${style.id}.mood`, label: `${style.name} · 气质`, defaultText: style.mood },
                { key: `style.${style.id}.light`, label: `${style.name} · 光影`, defaultText: style.light },
            ]),
        },
        {
            id: "family",
            title: "品类规则",
            hint: "按商品品类追加的易错点与质感要求。",
            entries: (Object.keys(STUDIO_FAMILY_RULES) as StudioCategoryFamily[]).map((family) => ({ key: `family.${family}`, label: STUDIO_FAMILY_LABEL[family], defaultText: STUDIO_FAMILY_RULES[family] })),
        },
        { id: "tweak", title: "微调标签", hint: "大图里「调整这一张」的标签写进提示词的说法。", entries: STUDIO_TWEAKS.map((tweak) => ({ key: `tweak.${tweak.id}`, label: tweak.label, defaultText: tweak.instruction })) },
    ];
}

/** 和内置写法一样的、空的覆盖都去掉；一条都不剩时返回 undefined，保存时不带这个字段。 */
export function compactStudioPrompts(value: Record<string, string> | undefined, groups = studioPromptGroups()): Record<string, string> | undefined {
    if (!value) return undefined;
    const defaults = new Map(groups.flatMap((group) => group.entries.map((entry) => [entry.key, entry.defaultText] as const)));
    const kept = Object.entries(value).filter(([key, text]) => defaults.has(key) && text.trim() && text.trim() !== defaults.get(key)?.trim());
    return kept.length ? Object.fromEntries(kept.map(([key, text]) => [key, text.trim()])) : undefined;
}
