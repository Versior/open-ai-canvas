import { ecommercePlatformGuidance } from "./ecommerce-platform-guidance";

export const ECOMMERCE_CAPABILITIES = [
    { id: "planning", name: "智能规划", description: "按商品事实与目标市场规划多种图型" },
    { id: "suite-forge", name: "套图工坊", description: "参考套图反推视觉锁与逐张画面职责" },
    { id: "model-cast", name: "模特选角", description: "创建模特身份与一致的多姿态参考图" },
    { id: "pattern", name: "花型工坊", description: "提取、起稿、衍生、改色与像素验缝" },
    { id: "listing", name: "Listing 文案", description: "根据已核实事实与图片编写多语言商品文案" },
    { id: "print-pack", name: "印刷规格包", description: "按物理尺寸输出 300DPI PNG 和预览" },
    { id: "pipeline", name: "成包流水线", description: "验缝、印刷包、Listing 按步骤执行并保存记录" },
    { id: "layers", name: "分层交付", description: "复用 AI 分层，导出图层 PNG、ZIP 与 PSD" },
] as const;
export type EcommerceCapability = (typeof ECOMMERCE_CAPABILITIES)[number]["id"];
export const DEFAULT_ECOMMERCE_BRIEF: EcommerceWorkbenchBrief = {
    name: "",
    facts: "",
    forbidden: "",
    market: "中国",
    platform: "淘宝",
    language: "中文",
    direction: "",
    imageTypes: ["商品主图", "生活场景", "细节特写"],
    count: 5,
    identity: "",
    poses: ["正面全身", "侧面全身", "背面全身"],
};
export type EcommerceWorkbenchAction = EcommerceCapability | "pattern-extract" | "pattern-draft" | "pattern-derive" | "recolor" | "seams" | "save-template" | "apply-plan" | "save-model" | "export-layers" | "studio-generate" | "studio-export";
export type EcommerceWorkbenchRequest = {
    action: EcommerceWorkbenchAction;
    brief: EcommerceWorkbenchBrief;
    sourceIds: string[];
    textModel: string;
    imageModel: string;
    from: string;
    to: string;
    tolerance: number;
    widthCm: number;
    heightCm: number;
    layout: "tile" | "contain" | "cover";
    layerVisibility: Record<string, boolean>;
    studioId?: string;
    shotIndices?: number[];
    requireStudioInputs?: boolean;
};
export const ecommerceActionCapability = (action: EcommerceWorkbenchAction): EcommerceCapability =>
    action.startsWith("pattern-") || ["recolor", "seams"].includes(action)
        ? "pattern"
        : ["apply-plan", "studio-generate", "studio-export"].includes(action)
          ? "planning"
          : action === "save-template"
            ? "suite-forge"
            : action === "save-model"
              ? "model-cast"
              : action === "export-layers"
                ? "layers"
                : (action as EcommerceCapability);
export function studioWorkbenchRequest(studioId: string, brief: EcommerceWorkbenchBrief, sourceIds: string[], action: EcommerceWorkbenchAction): EcommerceWorkbenchRequest {
    return { studioId, brief: structuredClone(brief), sourceIds, action, textModel: "", imageModel: "", from: "#000000", to: "#ffffff", tolerance: 24, widthCm: 20, heightCm: 20, layout: "contain", layerVisibility: {}, requireStudioInputs: true };
}
export const ECOMMERCE_IMAGE_TYPES = [
    ["hero", "商品主图"],
    ["scene", "生活场景"],
    ["flatlay", "平铺陈列"],
    ["macro", "细节特写"],
    ["banner", "海报横幅"],
    ["social", "社交封面"],
    ["ugc", "用户实拍"],
    ["model", "模特展示"],
    ["comparison", "对比图"],
    ["packaging", "包装展示"],
    ["infographic", "信息图"],
    ["concept", "创意概念"],
    ["size", "尺寸规格"],
    ["collection", "产品组合"],
    ["live", "直播背景"],
    ["tryon", "虚拟试穿"],
    ["exploded", "结构拆解"],
    ["mannequin", "隐形人台"],
    ["angles", "多视角"],
    ["editorial", "杂志大片"],
    ["seasonal", "节日活动"],
    ["luxury", "质感氛围"],
    ["device", "设备展示"],
    ["store", "店铺空间"],
    ["sports", "运动场景"],
] as const;
export const ECOMMERCE_SHOT_ROLES = ["主图", "痛点", "对比", "场景", "细节", "信任", "变体", "转化"] as const;
export type EcommerceWorkbenchBrief = {
    name: string;
    facts: string;
    forbidden: string;
    market: string;
    platform: string;
    language: string;
    direction: string;
    imageTypes: string[];
    count: number;
    identity: string;
    poses: string[];
    template?: import("@/services/api/ecommerce").EcommerceSuiteTemplate;
};
export function ecommerceWorkbenchPrompt(operation: EcommerceCapability | "pattern-extract" | "pattern-draft" | "pattern-derive", brief: EcommerceWorkbenchBrief) {
    if (!brief.name.trim() || brief.name.length > 200 || brief.facts.length > 12000 || brief.direction.length > 6000 || !Number.isInteger(brief.count) || brief.count < 1 || brief.count > 30)
        throw new Error("请填写名称，张数须为 1–30，商品事实与要求不能超长");
    const context = JSON.stringify({
        name: brief.name,
        verifiedFacts: brief.facts,
        forbidden: brief.forbidden,
        market: brief.market,
        platform: brief.platform,
        language: brief.language,
        direction: brief.direction,
        ...(["planning", "suite-forge", "listing"].includes(operation) ? { platformGuidance: ecommercePlatformGuidance(brief.platform) } : {}),
        ...(brief.template && operation === "planning"
            ? { templateReference: { name: brief.template.name, style: brief.template.style, shots: brief.template.shots }, templateRule: "模板属性与示例文案均非当前商品事实。保留视觉方向，按当前实拍、已核实事实和计划张数重新规划；替换所有占位符。" }
            : {}),
    });
    if (operation === "suite-forge")
        return (
            context +
            '\n按上传参考图顺序反推套图，并结合当前商品的已核实事实写完整生图提示词。只返回 JSON：{"name":"名称","style":"统一色板、光线、字体、背景、构图与禁用元素的 Campaign Style Lock","shots":[{"title":"标题","duty":"职责","prompt":"用于当前商品的完整生图提示词"}]}。1–30张。只提取视觉与结构，不把参考商品参数、品牌、价格当作当前商品事实。'
        );
    if (operation === "planning")
        return (
            context +
            "\n规划 " +
            brief.count +
            " 张。选用图型：" +
            brief.imageTypes.join("、") +
            "。分镜角色可选：" +
            ECOMMERCE_SHOT_ROLES.join("、") +
            '。只返回 JSON：{"name":"名称","style":"整套视觉锁","shots":[{"title":"图型与角色","duty":"本张职责","prompt":"可直接生成的完整提示词"}]}。只用已核实事实，缺事实标待核实，不得编造。'
        );
    if (operation === "listing") return context + "\n根据图片与已核实事实写目标平台与语种的 Listing，包含标题、五点卖点、描述、搜索词与待核实项。不可从外观推断材质、认证、功效，不得虚构销量价格。";
    if (operation === "model-cast") return context + "\n模特身份：" + brief.identity + "。生成姿态：" + brief.poses.join("、") + "。只描绘成年模特。参考图存在时保持同一身份、脸部特征与体型，不把不同姿态拼成多人合照。真实摄影、完整入画、无文字水印。";
    const goals = {
        "pattern-extract": "提取参考商品上的平面花型，去掉商品轮廓、褶皱、透视与场景，保持原图案形状与色彩。不要添加品牌标识。",
        "pattern-draft": "创建独立可用的 POD 花型。参考图或草图只用于视觉方向，输出完整平面图稿。",
        "pattern-derive": "根据参考花型衍生新画风或构图，保持主要设计主题。",
    };
    return context + "\n" + (goals[operation as keyof typeof goals] || brief.direction) + "。平铺能力必须经像素验缝验证，不承诺无缝。";
}
export type EcommerceWorkbenchPlan = { name: string; style: string; shots: { title: string; duty: string; prompt?: string }[] };
export function parseEcommerceWorkbenchPlan(text: string): EcommerceWorkbenchPlan {
    const fence = String.fromCharCode(96).repeat(3);
    const clean = text.trim();
    const value = JSON.parse(clean.startsWith(fence) ? clean.slice(clean.indexOf("\n") + 1, clean.lastIndexOf(fence)).trim() : clean);
    if (
        !value ||
        typeof value.name !== "string" ||
        !value.name.trim() ||
        value.name.length > 100 ||
        typeof value.style !== "string" ||
        value.style.length > 6000 ||
        !Array.isArray(value.shots) ||
        value.shots.length < 1 ||
        value.shots.length > 30 ||
        value.shots.some(
            (s: { title?: unknown; duty?: unknown; prompt?: unknown }) =>
                !s || typeof s.title !== "string" || !s.title.trim() || s.title.length > 100 || typeof s.duty !== "string" || !s.duty.trim() || s.duty.length > 12000 || (s.prompt !== undefined && (typeof s.prompt !== "string" || s.prompt.length > 20000)),
        )
    )
        throw new Error("模型返回的套图结构无效，请检查结果后重试");
    return value as { name: string; style: string; shots: { title: string; duty: string; prompt?: string }[] };
}
