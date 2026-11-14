import { assertMediaSettings, resolvedMediaConfig } from "@/lib/media-settings";
import { modelCompatibilityError, modelRequestOptions, type ModelRequirements } from "@/lib/model-selection";
import type { AiConfig } from "@/stores/use-config-store";
import type { PackagingProject } from "./types";

export const packagingMockupScenes = [
    { id: "studio", name: "白底棚拍", prompt: "白色无缝摄影棚，柔和大面积侧光，自然接触阴影，包装完整清楚，专业电商商品摄影。" },
    { id: "campaign", name: "品牌主视觉", prompt: "简洁的品牌主视觉场景，协调包装配色的背景与抽象展台，清晰的材质和层次，不添加海报标题、价格或宣传文字。" },
    { id: "lifestyle", name: "生活场景", prompt: "自然生活场景，柔和窗光、克制的布景与合理尺度，包装作为主体，避免杂物遮挡包装。" },
    { id: "detail", name: "工艺特写", prompt: "包装纸材、印刷与表面工艺特写，真实纸张纹理与柔和高光，保留参考图实际可见的工艺，不凭空添加金属或压凸。" },
    { id: "design", name: "包装创意提案", prompt: "基于参考包装提出一张视觉设计效果图，按补充要求探索配色、装饰图形、印刷排版和材质表现。保留结构与已确认品牌信息，不增加产品功效、认证、价格或虚构卖点。输出为创意预览，不视为印刷生产稿。" },
] as const;

export const packagingMockupInput = { textCount: 1, imageCount: 1, referenceImageCount: 1, videoCount: 0, audioCount: 0, characterCount: 0 };

export function packagingMockupRequirements(config: AiConfig): ModelRequirements {
    return { capability: "image", input: packagingMockupInput, options: modelRequestOptions(config, "image") };
}

export function packagingMockupConfig(config: AiConfig) {
    if (!config.model) throw new Error("请选择支持参考图编辑的图片模型");
    const problem = modelCompatibilityError(config, config.model, packagingMockupRequirements(config));
    if (problem) throw new Error(problem);
    assertMediaSettings(config, "image", config.model);
    return resolvedMediaConfig({ ...config, taskWorkflowProvider: "model", count: "1" }, "image", config.model);
}

export function packagingMockupPrompt(project: PackagingProject, scene: string, note: string) {
    const selected = packagingMockupScenes.find((item) => item.id === scene);
    if (!selected) throw new Error("请选择有效的包装效果图场景");
    if (note.length > 1200) throw new Error("效果图补充要求不能超过 1200 个字符");
    return [
        scene === "design"
            ? "以参考图中的包装为结构基础，保留结构轮廓、开合状态、比例、Logo 和已有文字，不重新设计刀版。根据用户要求探索包装视觉，不改变已确认的品牌与产品事实。"
            : "以输入参考图中的包装为唯一包装主体，生成一张真实摄影风格的效果图。保留结构轮廓、开合状态、比例、印刷布局、颜色、Logo 和已有文字，不重新设计刀版，不增加品牌、卖点、价格或认证。参考图没有展示的包装面不得臆造文字。",
        `包装：${project.document.template.name}；外尺寸 ${project.document.parameters.length} × ${project.document.parameters.width} × ${project.document.parameters.height} mm；材料 ${project.document.material.name}；表面 ${project.document.view.finish}。尺寸仅供比例理解，不写进画面。`,
        selected.prompt,
        note.trim() ? `补充场景要求：${note.trim()}` : "",
    ]
        .filter(Boolean)
        .join("\n");
}
