import type { StudioPlanKind, StudioShotRole, StudioSuite, StudioSuiteShot } from "./types";

/**
 * 模板套图：后台启用的模板或项目内置的 EcomGen 模板库，只给每张图的标题和职责。
 * 选中时转成快照存进表单；出图时按标题对到最接近的镜头规格，文案位置、平台规则和避坑项沿用规格，职责在提示词里优先。
 */
export type StudioSuiteTemplateInput = { id: string; name: string; flow: string; category: string; style: string; shots: { title: string; duty: string }[] };

export const STUDIO_SUITE_LIMITS = { shots: 30, title: 40, duty: 1200, style: 1500, name: 100, category: 200 } as const;

const RATIO_PATTERN = /^([1-9]\d?):([1-9]\d?)$/;
const NONE_VALUE = /^(none|无|不需要|不放|n\/a)$/i;

function clip(value: string, max: number) {
    const text = value.trim();
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * 整理模板职责：内置模板最后一行是英文参考提示词，和生图台的分层提示词重复，去掉；
 * 「画幅」单独存，「道具：none」这类空值行不进提示词，「文字位置：none」记成这张不放文字。
 */
function cleanDuty(duty: string): Omit<StudioSuiteShot, "title"> {
    let ratio: string | undefined;
    let noText = false;
    const kept: string[] = [];
    for (const raw of duty.split(/\n+/)) {
        const line = raw.trim();
        if (!line) continue;
        if (/^画面参考/.test(line)) break;
        const field = line.match(/^([^：:]{1,8})[：:]\s*(.*)$/);
        if (field) {
            const [, label, value] = field;
            if (label === "画幅") {
                const ratioValue = value.trim();
                if (RATIO_PATTERN.test(ratioValue)) ratio = ratioValue;
                continue;
            }
            if (!value.trim() || NONE_VALUE.test(value.trim())) {
                if (label === "文字位置") noText = true;
                continue;
            }
        }
        kept.push(line);
    }
    return { duty: clip(kept.join("\n"), STUDIO_SUITE_LIMITS.duty), ...(ratio ? { ratio } : {}), ...(noText ? { noText: true } : {}) };
}

export function studioSuiteFromTemplate(template: StudioSuiteTemplateInput, source: StudioSuite["source"]): StudioSuite {
    const shots = template.shots.slice(0, STUDIO_SUITE_LIMITS.shots).map((shot) => ({ title: clip(shot.title, STUDIO_SUITE_LIMITS.title) || "未命名镜头", ...cleanDuty(shot.duty) }));
    return {
        id: template.id,
        name: clip(template.name, STUDIO_SUITE_LIMITS.name) || "未命名模板",
        source,
        kind: template.flow === "main" ? "main" : "detail",
        category: clip(template.category, STUDIO_SUITE_LIMITS.category),
        style: clip(template.style, STUDIO_SUITE_LIMITS.style),
        shots,
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function str(value: unknown, max: number) {
    return typeof value === "string" ? value.slice(0, max) : "";
}

/** 读回表单里的模板快照：字段不全或一张图都没有时当作没选。 */
export function normalizeStudioSuite(value: unknown): StudioSuite | undefined {
    if (!isRecord(value) || typeof value.id !== "string" || !value.id || !Array.isArray(value.shots)) return undefined;
    const shots = value.shots
        .filter(isRecord)
        .slice(0, STUDIO_SUITE_LIMITS.shots)
        .map((shot): StudioSuiteShot => {
            const ratio = typeof shot.ratio === "string" && RATIO_PATTERN.test(shot.ratio) ? shot.ratio : undefined;
            return { title: str(shot.title, STUDIO_SUITE_LIMITS.title) || "未命名镜头", duty: str(shot.duty, STUDIO_SUITE_LIMITS.duty), ...(ratio ? { ratio } : {}), ...(shot.noText === true ? { noText: true } : {}) };
        });
    if (!shots.length) return undefined;
    return {
        id: value.id.slice(0, 150),
        name: str(value.name, STUDIO_SUITE_LIMITS.name) || "未命名模板",
        source: value.source === "admin" ? "admin" : "library",
        kind: value.kind === "main" ? "main" : "detail",
        category: str(value.category, STUDIO_SUITE_LIMITS.category),
        style: str(value.style, STUDIO_SUITE_LIMITS.style),
        shots,
    };
}

// 按标题（其次是职责首行）里的关键词对镜头规格；靠前的规则优先，例如「模特场景」算上身效果、「参数信任屏」算参数。
const ROLE_RULES: { pattern: RegExp; main: StudioShotRole; detail: StudioShotRole }[] = [
    { pattern: /白底|纯白|白色背景/, main: "main-white", detail: "main-white" },
    { pattern: /收口|收尾|促单|总结/, main: "main-selling", detail: "detail-closing" },
    { pattern: /首屏|首图|头图|海报|封面|主视觉|KV/i, main: "main-selling", detail: "detail-hero" },
    { pattern: /模特|上身|穿搭|试穿|佩戴|上脚|上手|上妆|真人/, main: "detail-model", detail: "detail-model" },
    { pattern: /多角度|多视角|三视图|侧面|背面|侧视|后视|角度/, main: "main-angle", detail: "detail-angles" },
    { pattern: /尺码|尺寸|大小|容量/, main: "detail-size", detail: "detail-size" },
    { pattern: /参数|规格|配置|成分表|营养/, main: "detail-spec", detail: "detail-spec" },
    { pattern: /包装|配件|清单|开箱|礼盒/, main: "detail-package", detail: "detail-package" },
    { pattern: /材质|面料|材料|工艺|用料|成分/, main: "main-detail", detail: "detail-material" },
    { pattern: /细节|特写|微距|做工|局部/, main: "main-detail", detail: "detail-closeup" },
    { pattern: /场景|使用|生活|氛围|居家|户外|搭配/, main: "main-scene", detail: "detail-scene" },
    { pattern: /卖点|优势|亮点|功能|核心|利益|痛点|对比/, main: "main-selling", detail: "detail-selling" },
    { pattern: /购买理由|保障|售后|承诺|信任|背书/, main: "main-selling", detail: "detail-closing" },
];

function matchRole(text: string, kind: StudioPlanKind) {
    const rule = ROLE_RULES.find((item) => item.pattern.test(text));
    return rule ? rule[kind] : undefined;
}

/** 模板里第 index 张图对应的镜头规格；对不上时首张按头图、末张按收尾、中间按场景处理。 */
export function studioSuiteShotRole(shot: Pick<StudioSuiteShot, "title" | "duty">, kind: StudioPlanKind, index: number, total: number): StudioShotRole {
    const firstLine = shot.duty.split("\n")[0] || "";
    const matched = matchRole(shot.title, kind) || matchRole(firstLine, kind);
    if (matched) return matched;
    if (kind === "main") return index === 0 ? "main-selling" : "main-scene";
    if (index === 0) return "detail-hero";
    return index === total - 1 && total > 2 ? "detail-closing" : "detail-scene";
}
