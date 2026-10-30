// Adapted from EcomGen platform-guidance.ts, f8e6e7b, MIT.
// Copyright (c) 2026 linbei0; see ecommerce-platform-LICENSE.txt.
import { ecommercePlatform, resolveEcommercePlatformId, type EcommercePlatformId } from "./ecommerce-platform-specs";
import type { EcommerceOneClickFlowId } from "./ecommerce-oneclick";

const playbooks: Record<EcommercePlatformId, { preference: string; forbidden: string }> = {
    taobao: { preference: "干净浅底或品牌底，缩略图先认出商品；后续画面按商品真实卖点选择材质、细节或场景，不固定每张职责。", forbidden: "极限词、大面积促销字、未核验价格、假认证和额外 Logo" },
    jd: { preference: "主图克制、居中、信息干净；辅图优先呈现可核对的规格、材质与工艺，再按品类补场景。", forbidden: "诱导点击、拼接主图、未核验价格、假认证和额外 Logo" },
    pdd: { preference: "高对比且一眼看懂商品，减少装饰与无效留白；屏次按最能促成决策的商品事实排序。", forbidden: "极限词、杂乱装饰、未核验价格、假认证和额外 Logo" },
    douyin: { preference: "生活场景优先，中心主体清晰、色块对比强；真实使用感优先，人物、场景和屏次跟随品类变化。", forbidden: "二维码、其他平台标识、大面积促销字、未核验价格和额外 Logo" },
    xiaohongshu: { preference: "3:4 竖版优先，像真实种草内容而非硬广；用使用场景、细节与体验证据建立可信感，标题层级简洁。", forbidden: "虚假体验、过度广告化排版、未核验功效或认证、照搬参考图和额外 Logo" },
    amazon: { preference: "主图使用纯白 #FFFFFF 并完整识别商品；卖点信息、对比和场景只放辅图，顺序按品类购买决策调整。", forbidden: "主图文字、额外 Logo、水印、边框、未包含的配件和未核验认证" },
    walmart: { preference: "主图保持统一白底与清晰尺度；辅图按商品需要组合场景、信息图、细节与包装，不机械套固定张序。", forbidden: "主图文字、水印、过度留白、未包含配件和未核验宣称" },
    etsy: { preference: "突出真实材质、手作细节和使用尺度；首图兼顾搜索裁切，后续按商品故事与购买疑问安排画面。", forbidden: "透明背景、虚构手作过程、未核验材质与夸大功效" },
    tiktokshop: { preference: "商品卡先清楚识别商品，竖版内容强调真实演示和快速理解；画面主题随品类与使用痛点变化。", forbidden: "未披露的纯 AI 商品图、二维码、其他平台标识、未核验价格与功效" },
    shopify: { preference: "统一白底或品牌底，集合页缩略图可识别；后续按商品需要展示场景、细节和尺度，全套裁切与调性一致。", forbidden: "大面积促销字、未核验价格、假认证和每张更换风格" },
};

/** Upstream creative guidance, not a claim of current platform approval. */
export function ecommercePlatformGuidance(platform?: string, flowId?: EcommerceOneClickFlowId) {
    const id = resolveEcommercePlatformId(platform);
    // 项目自己的默认十屏 3:4 与平台口径是两回事，不因平台数值未核验而降级。
    const projectRule = flowId === "detail" ? "本项目自身要求：详情页默认十屏；用户确认的行计划优先，不补回删掉的屏。每屏 3:4 竖版，只讲一个核心主题；单张生图只生成当前屏，不把整套拼进一张图。此要求与平台规范无关。\n" : "";
    if (!id) {
        const label = platform?.trim() || "未指定平台";
        return `【平台规则 · ${label}】\n${projectRule}适配状态：尚未专属适配，使用通用规则。\n参考规范（未核验官方出处，仅作自查建议）：不编造参数、价格、认证或功效；严格还原商品外观、颜色、LOGO、结构和细节，上架前核对目标平台商家后台。\n创作偏好（按商品变化）：每屏只讲一个核心主题，画面职责、场景和顺序由商品事实与用户需求决定，不套固定模板。\n禁止项：照搬参考图、虚构商品信息、擅改真实标识。通用创作偏好仅用于画面规划。`;
    }
    const spec = ecommercePlatform(id)!;
    const book = playbooks[id];
    if (flowId) {
        const requestedRole = flowId === "main" ? "main" : flowId === "seed" ? "cover" : "detail";
        const role = requestedRole === "cover" && !spec.roles.cover ? "main" : requestedRole;
        const roleSpec = spec.roles[role];
        const roleLabel = role === "main" ? "主图" : role === "cover" ? "封面" : "详情/辅图";
        const preference =
            role === "main"
                ? "只规划主图位，优先保证缩略图可识别、商品主体清晰，构图服从上面的参考规范与商品事实。"
                : role === "cover"
                  ? "只规划内容封面，优先保证首屏识别与阅读层级，构图服从上面的参考规范与商品事实。"
                  : "只规划详情/辅图，每张围绕一个可核实主题组织场景、卖点、细节或对比，顺序随品类购买决策调整。";
        return `【平台规则 · ${spec.name}】\n${projectRule}参考规范（未核验官方出处，仅作自查建议）· ${roleLabel}：${roleSpec?.note || "当前未收录该角色的专属规范，上架前核对目标平台商家后台"}\n创作偏好（按商品变化）：${preference}\n禁止项：照搬参考图、虚构商品信息、未核验价格参数认证功效、擅改真实标识或增加额外 Logo。创作偏好仅用于画面规划；平台硬规则以上架时商家后台为准，实拍上的真实标识不可擅自改造。`;
    }
    const hardRules = [spec.roles.main?.note && `主图：${spec.roles.main.note}`, spec.roles.detail?.note && `详情/辅图：${spec.roles.detail.note}`].filter(Boolean).join("；");
    return `【平台规则 · ${spec.name}】\n参考规范（未核验官方出处，仅作自查建议）：${hardRules}\n创作偏好（按商品变化）：${book.preference}\n禁止项：${book.forbidden}。创作偏好仅用于画面规划；平台硬规则以上架时商家后台为准，实拍上的真实标识不可擅自改造。`;
}
