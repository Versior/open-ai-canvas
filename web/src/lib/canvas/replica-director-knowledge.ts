/** 拍法是本工作台的策划建议，不作为平台审核规则、流量保证或实验结论。 */
export const REPLICA_PLATFORM_PLAYBOOKS = {
    douyin: {
        name: "抖音",
        opening: "先给出可见动作或具体选购问题，让商品与问题在同一画面出现",
        proof: "上手演示回答一个购买顾虑，细节特写接住口播",
        pace: "把信息集中在关键动作，不机械按秒切镜；避免各镜重复卖点",
        action: "按视频目标说明适用人群或下一步，不虚构福利与限时",
        delivery: "移动端竖屏构图；商品、手部和关键信息避开界面遮挡，文字留给剪辑",
    },
    xiaohongshu: {
        name: "小红书",
        opening: "从具体生活困扰、使用条件或选购标准切入",
        proof: "完整展示使用步骤、细节和适用边界；个人亲测需要用户提供事实",
        pace: "允许观众看清细节，用一镜回答一个问题，避免只堆口号",
        action: "总结适合谁、不适合谁或值得收藏的操作要点",
        delivery: "按笔记观看场景安排近景和场景关系；封面主张与正片一致",
    },
    kuaishou: {
        name: "快手",
        opening: "真人或手部直接展示使用场景，语言具体、平实",
        proof: "连贯操作建立可信感，展示实际接触与使用过程",
        pace: "交代动作因果，避免没有解释的快剪和假反应",
        action: "用明确适用条件帮助选择，避免编造价格和购买人数",
        delivery: "优先保证移动端商品与人声清楚，人物和产品尺寸关系一致",
    },
    wechat: {
        name: "微信视频号",
        opening: "用熟悉的生活问题、人物关系或实用结论打开",
        proof: "说明为什么、怎么用、何时适用，保留步骤之间的因果",
        pace: "信息分层，重要步骤留足辨认时间；语速由时长和目标人群决定",
        action: "围绕转发、收藏或选购建议收束，不混用所有目标",
        delivery: "口播和剪辑字幕表达同一信息，避免字幕遮住操作过程",
    },
    tiktok: {
        name: "TikTok",
        opening: "用当地语言提出明确问题、展示意外动作或直接给结果",
        proof: "让演示承担说服职责，商品参考图锁外观，声音与动作节奏协同",
        pace: "围绕 hook、展开与收束组织信息，按素材决定节奏",
        action: "行动与广告或自然内容目标一致，不把原片促销搬到新商品",
        delivery: "竖屏、清晰素材、声音和安全区域须核对；广告素材与商品详情视频分开",
    },
    shorts: {
        name: "YouTube Shorts",
        opening: "先给问题或结果，再解释步骤；静音观看也能理解首镜",
        proof: "操作或对照带来新信息，最后回答开头的问题",
        pace: "简明叙事与完整步骤兼顾，不因短视频而删掉关键因果",
        action: "按说明、品牌或互动目标选择单一收束",
        delivery: "竖屏或方形短视频；实际时长、音频版权与上传规则以官方文档为准",
    },
    reels: {
        name: "Instagram Reels",
        opening: "主体与动作清楚，首镜建立风格或使用语境",
        proof: "生活方式画面与细节证据交替，避免只有漂亮空镜",
        pace: "动作与声音节拍协同，运镜服务商品信息",
        action: "从适用情境、记忆点或一个明确操作收束",
        delivery: "移动端构图预留界面空间；自然发布与广告投放的规格分别核对",
    },
    amazon: {
        name: "亚马逊商品视频",
        opening: "先看清产品是什么、怎么用，不用悬念拖延商品识别",
        proof: "结构、操作、尺寸关系和随附件分别展示，所有数据引用真实档案",
        pace: "用稳定镜头留出辨认时间；购买问题优先于剧情",
        action: "以适配条件或操作总结收束，详情页不写外部引流",
        delivery: "区分商品详情视频与 Sponsored Brands 广告；横竖版和具体规格按投放入口核对",
    },
} as const;

export const REPLICA_METHODS = {
    auto: { name: "根据商品与原片选择", fit: "由策划比较拍法后选择并说明理由", execution: "先分析观众顾虑、商品可展示的证据和镜头预算", avoid: "不得固定套用开头、痛点、演示、证明、购买的同一顺序" },
    demo: { name: "真实演示", fit: "操作过程能证明价值的商品", execution: "动作开始、过程、结束都能看见，用近景说明关键操作", avoid: "没有资料的性能实验和演示结果" },
    story: { name: "人物情境故事", fit: "需要交代人物需求和使用动机", execution: "人物遇到具体问题，用商品完成一个有因果的动作", avoid: "商品只在结尾露面、表演与需求脱节" },
    studio: { name: "商业棚拍", fit: "外观、结构和品牌识别是主要诉求", execution: "稳定布光、明确轮廓，景别变化揭示真实细节", avoid: "漂亮空镜代替购买理由" },
    ugc: { name: "创作者口述与上手", fit: "需要自然讲解和实际操作", execution: "镜头对着真实操作，口播解释条件、步骤与限制", avoid: "虚构亲测、购买经历和素人身份" },
    unboxing: { name: "开箱与配件清点", fit: "包装、配置或安装流程影响决策", execution: "拆封、取出、清点、操作，保持部件前后数量一致", avoid: "杜撰随附件或包装内容" },
    tutorial: { name: "步骤教程", fit: "用法、佩戴或维护需要解释", execution: "每镜一个操作步骤，手部接触和最后状态可回查", avoid: "跳步骤和不能执行的动作" },
    comparison: { name: "条件对照", fit: "已提供对照条件或尺寸数据", execution: "同机位同条件展示差异，标明比较对象与事实依据", avoid: "虚构竞品、实验数值和优越性" },
    macro: { name: "材质与工艺特写", fit: "纹理、接缝或机构有可见细节", execution: "微距与整体交替，局部与实物尺寸关系一致", avoid: "微观画面臆造材质、技术和功能" },
    lifestyle: { name: "生活方式场景", fit: "商品与生活环境、搭配或习惯相关", execution: "让人物和商品完成生活动作，以真实环境建立语境", avoid: "装饰性场景遮住商品及用法" },
    interview: { name: "问答选购", fit: "用户有明确顾虑或选购问题", execution: "问题、演示、答复对应；每镜解决一个顾虑", avoid: "冒充专家、证言或权威背书" },
    stopmotion: { name: "定格与节奏陈列", fit: "部件、颜色或组合有已知差异", execution: "物件按节奏呈现，数量和结构不变，复杂定格留给后期", avoid: "要求单次视频生成实现精确逐帧摆拍" },
    documentary: { name: "纪实过程", fit: "有真实制作、安装或服务资料", execution: "动作连续，交代操作环境与顺序，用资料支持过程", avoid: "臆造工厂、实验室、检测或产能" },
} as const;

export const REPLICA_NARRATIVES = { auto: "根据观众问题选择", feature: "商品与价值先行", problem: "问题到解决", howto: "操作步骤", objection: "逐个回答顾虑", experience: "使用情境递进", reveal: "细节逐步揭示", story: "人物目标与结果" } as const;

export const REPLICA_PLATFORM_SOURCES: Partial<Record<keyof typeof REPLICA_PLATFORM_PLAYBOOKS, { title: string; url: string; scope: string }[]>> = {
    tiktok: [{ title: "TikTok 效果广告创意建议", url: "https://ads.tiktok.com/resources/help/article/creative-best-practices?lang=en", scope: "官方建议包含声音、9:16、至少720P与界面安全区域；建议持续测试，不保证效果。" }],
    shorts: [{ title: "YouTube 三分钟 Shorts", url: "https://support.google.com/youtube/answer/15424877?hl=en", scope: "官方说明方形或竖屏及最长三分钟的分类条件；超过一分钟且有有效版权声明的短片存在阻断限制。" }],
};

export function replicaPlatformGuidance(platform: keyof typeof REPLICA_PLATFORM_PLAYBOOKS) {
    const entry = REPLICA_PLATFORM_PLAYBOOKS[platform];
    return [`开场：${entry.opening}`, `证据：${entry.proof}`, `节奏：${entry.pace}`, `收束：${entry.action}`, `交付：${entry.delivery}`].join("\n");
}

export function replicaMethodGuidance(style: keyof typeof REPLICA_METHODS) {
    const method = REPLICA_METHODS[style];
    return `适用：${method.fit}。执行：${method.execution}。避免：${method.avoid}。`;
}
