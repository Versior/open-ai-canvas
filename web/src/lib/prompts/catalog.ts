import type { CanvasGenerationMode } from "@/types/canvas";
import type { SrtEntry } from "@/types/timeline";

export type CanvasPromptPreset = {
    id: string;
    name: string;
    description: string;
    prompt: string;
    modes: CanvasGenerationMode[];
    source: "builtin" | "skill";
    /**
     * 只在某一类画布里出现。缺省（undefined）表示两边都给。
     *
     * 上面那批预设是给创作片用的（角色设定图、多机位、电影光影），
     * 在电商画布里点开只会让人困惑——商品图不需要「角色一致性」。
     * 反过来，商品一致性复述、详情页单屏这些在自由画布里也没有意义。
     */
    scope?: "ecommerce" | "film";
};

export const CANVAS_BUILTIN_PRESETS: CanvasPromptPreset[] = [
    {
        id: "character-sheet",
        name: "角色设定图",
        description: "正面、侧面、背面与表情参考，锁定角色一致性",
        prompt: "生成角色设定图：保持同一角色身份、五官、发型、服装和体态一致，包含正面、侧面、背面和关键表情参考，背景简洁，便于后续镜头复用。",
        modes: ["image"],
        source: "builtin",
        scope: "film",
    },
    {
        id: "multi-angle",
        name: "多机位视角",
        description: "围绕同一主体生成连续、可衔接的机位变化",
        prompt: "围绕同一主体设计多机位画面，保持人物、服装、场景和光线一致，分别给出远景、全景、中景、近景、特写、侧面、背面和俯拍视角，镜头之间具有连续性。",
        modes: ["image", "video"],
        source: "builtin",
        scope: "film",
    },
    {
        id: "next-shot",
        name: "画面推演",
        description: "推演当前画面的前后动作与镜头衔接",
        prompt: "基于当前画面推演下一个连续镜头：保持角色和场景一致，明确主体接下来的动作、视线、环境变化、镜头运动和自然衔接方式，不要跳变构图或身份。",
        modes: ["image", "video"],
        source: "builtin",
        scope: "film",
    },
    {
        id: "story-beats",
        name: "连续镜头",
        description: "将短剧情拆成可生成的连续镜头节拍",
        prompt: "把这段内容拆成连续镜头节拍。每个镜头写清主体动作、景别、构图、机位、运镜、光线、情绪和与前后镜头的衔接，并保持角色、场景和道具一致。",
        modes: ["text", "image", "video"],
        source: "builtin",
        scope: "film",
    },
    {
        id: "cinematic-light",
        name: "电影光影优化",
        description: "保留内容，优化真实光线、层次和融合感",
        prompt: "保留主体身份、动作和原始构图，优化为真实电影摄影光线：明确主光方向、环境反射、阴影层次、肤色和背景融合，降低塑料感与过度锐化，不改变画面内容。",
        modes: ["image", "video"],
        source: "builtin",
        scope: "film",
    },
    {
        id: "video-prompt",
        name: "视频提示词优化",
        description: "整理为模型更容易执行的时序化镜头指令",
        prompt: "将当前要求改写为结构化视频提示词，按时间顺序描述开场画面、主体动作、镜头运动、环境变化、声音和结束画面；消除冲突指令，保留所有关键约束。",
        modes: ["text", "video"],
        source: "builtin",
        scope: "film",
    },
];

/**
 * 电商画布的预设。
 *
 * 上面那批是给创作片用的（角色设定图、多机位、电影光影）——在电商画布里点开
 * 只会让人困惑：商品图不需要「角色一致性」。所以两边各自一套，按画布种类过滤。
 *
 * 这几条覆盖的是电商创作里最常重复的几件事：复述商品锁定、出详情页单屏、
 * 出信息图底图、出种草图、出白底主图、出长图。每条都带上电商的硬约束
 * （商品逐字锁定、文字不进画面或逐字准确），而不是泛泛的「生成一张图」。
 */
export const ECOMMERCE_BUILTIN_PRESETS: CanvasPromptPreset[] = [
    {
        id: "ecom-product-lock",
        name: "商品一致性复述",
        description: "把商品的外观、材质、标识逐字复述一遍，压住模型的自由发挥",
        prompt: "画面里的商品必须是参考图中的同一件实物，不是相似款。逐字保留以下特征，不得改写、美化、替换、增减或重新设计：形状与比例、颜色与材质、图案位置、标识文字与字体、部件数量与结构。不添加参考图中不存在的部件，不改变商品朝向。",
        modes: ["image", "video"],
        source: "builtin",
        scope: "ecommerce",
    },
    {
        id: "ecom-detail-screen",
        name: "详情页单屏",
        description: "一屏讲一件事，上方商品下方文案位，风格与前后屏统一",
        prompt: "生成一张详情页单屏：商品占据画面上方约六成，下方留出文案区（不要生成任何文字，文案由排版环节添加）。背景干净、光线均匀，与同一套详情页的其他屏保持统一的色调与布光基调。一屏只讲一件事，不要在一屏里堆多个卖点。",
        modes: ["image"],
        source: "builtin",
        scope: "ecommerce",
    },
    {
        id: "ecom-infographic-base",
        name: "信息图底图",
        description: "商品居中或偏侧，四周留出标注位，画面里不要任何文字",
        prompt: "生成一张信息图的底图：商品完整入画、轮廓清晰，四周留出足够空间用于后续添加标注框与引线。画面里不要出现任何文字、数字、箭头、引线、图标或水印——标注由本地精确合成添加。背景简洁，商品与背景之间要有清晰的分离度。",
        modes: ["image"],
        source: "builtin",
        scope: "ecommerce",
    },
    {
        id: "ecom-seed-photo",
        name: "真实种草图",
        description: "第一人称、生活化、不像广告——种草图最要紧的是不假",
        prompt: "生成一张种草图：第一人称视角，生活场景，像用户自己随手拍的。光线用自然光或室内环境光，不要影棚布光；构图可以略微不完美（轻微倾斜、主体不居中），背景要有真实的生活痕迹。不要出现任何文字、价格、促销标签或品牌水印——种草图一像广告就失效。",
        modes: ["image"],
        source: "builtin",
        scope: "ecommerce",
    },
    {
        id: "ecom-main-white",
        name: "白底主图",
        description: "纯白背景、主体占 85% 以上、零文字零道具——决定能不能上架",
        prompt: "生成电商白底主图：纯白背景 RGB(255,255,255)，商品主体占画面 85% 以上，居中或按平台要求偏置。商品完整入画不裁切，边缘清晰、无锯齿。画面里不要出现任何文字、水印、道具、装饰或多余阴影——平台会因这些拒绝上架。",
        modes: ["image"],
        source: "builtin",
        scope: "ecommerce",
    },
    {
        id: "ecom-long-detail",
        name: "详情页长图",
        description: "多屏连排的长图：分屏列出每屏讲什么，屏与屏之间留切点",
        prompt: "生成一张详情页长图：竖向连排多个屏，每屏只讲一件事（依次为：整体展示、核心卖点、细节特写、使用场景、参数与规格、品牌与售后）。屏与屏之间保持统一的色调、布光和留白节奏；相邻两屏的接缝处留出干净的横向切点，不要跨越接缝放置商品主体。画面里不要生成任何文字。",
        modes: ["image"],
        source: "builtin",
        scope: "ecommerce",
    },
    {
        id: "ecom-model-wear",
        name: "模特上身图",
        description: "真实人体比例、自然姿态、服装版型清楚——服装类目最关键的一张",
        prompt: "生成模特上身图：真实人体比例，自然站姿或走动姿态，不要僵硬的正面展示。服装的版型、垂坠感、褶皱走向要符合真实面料，穿着位置正确（领口、袖长、下摆、裤腰）。光线用柔和自然光或影棚柔光，背景简洁不抢主体。模特面部可虚化或背身，但服装细节必须清晰。",
        modes: ["image"],
        source: "builtin",
        scope: "ecommerce",
    },
    {
        id: "ecom-promo-poster",
        name: "促销主视觉",
        description: "氛围强、预留价格与标题位，但画面里不要自己写字",
        prompt: "生成促销主视觉：氛围强烈、有推动力，商品是画面焦点。顶部或底部留出标题位，一角留出价格位——但画面里不要生成任何文字、数字或价格，这些由排版环节添加。背景可用色块、渐变或场景，但不要压过商品。",
        modes: ["image"],
        source: "builtin",
        scope: "ecommerce",
    },
];

export const IMAGE_PROMPT_REVERSE = `请根据参考图片反推一段适合用于 AI 生图的提示词。

要求：
1. 只输出提示词正文，不要解释。
2. 覆盖主体、构图、风格、光线、色彩、材质、镜头和氛围。
3. 尽量写成可直接用于生图模型的完整提示词。`;

export function workflowStarterPrompt(kind: "character_cards" | "character_three_view" | "storyboard_video", title: string, workflowTitle: string) {
    if (kind === "character_cards") return `请基于「${workflowTitle}」拆分主要角色，并为每个角色生成可用于后续创作的角色图片卡片：外观、服饰、身份、性格和视觉辨识点。`;
    if (kind === "character_three_view") return `请基于上游角色卡片生成「${title}」：同一角色的正面、侧面、背面三视图，保持服饰、发型、道具和比例一致。`;
    return `请基于上游角色三视图，为「${workflowTitle}」制作分镜剧情视频方案：包含镜头顺序、景别、动作、节奏和画面连续性。`;
}

export function buildTextRewritePrompt(sourceText: string, instruction: string) {
    return `请根据要求修改以下文本。\n\n原文：\n${sourceText}\n\n修改要求：\n${instruction}`;
}

export function buildVideoOperationPrompt(operation: string, prompt: string, operationLabel: string) {
    if (operation === "compare_versions") return `请对以下视频结果版本做对比分析，输出推荐版本、差异点和修改建议：\n${prompt}`;
    return `视频编辑任务：${operationLabel}\n创作要求：${prompt}`;
}

export function buildSubtitleHighlightSystemPrompt() {
    return `你是一个视频字幕关键词高亮助手。请输出严格 JSON。

任务目标：
- 为每条字幕判断是否需要高亮
- 每条字幕最多高亮 1 段
- 只返回最值得高亮的一个关键词或短语
- start 和 end 使用 JavaScript 字符串下标
- end 为 exclusive
- 没有明确重点时返回 shouldHighlight=false

高亮标准：
- 优先高亮结论词、数字、身份词、首次/突破词、强反差词
- 不要高亮虚词、口头语、整句长短语

边界约束：
- 不负责颜色、字号、位置、动效
- 只返回 highlights 数组
- highlightText 必须严格等于原字幕文本切片结果`;
}

export function buildSubtitleHighlightUserMessage(entries: SrtEntry[]) {
    const lines = entries.map((entry) => {
        return `entryIndex=${entry.index} | startMs=${entry.startMs} | endMs=${entry.endMs} | text=${entry.text}`;
    });
    return `请根据以下字幕和上下文，为每条字幕判断是否需要高亮，并返回 JSON：

{
  "highlights": [
    {
      "entryIndex": 1,
      "shouldHighlight": true,
      "highlightText": "示例",
      "start": 0,
      "end": 2
    }
  ]
}

字幕列表：
${lines.join("\n")}`;
}
