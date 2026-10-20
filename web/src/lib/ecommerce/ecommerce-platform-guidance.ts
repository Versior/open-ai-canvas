// Adapted from EcomGen platform-guidance.ts, f8e6e7b, MIT.
// Copyright (c) 2026 linbei0; see ecommerce-platform-LICENSE.txt.
const playbooks = [
    {
        names: ["淘宝", "天猫", "taobao", "tmall"],
        hero: "干净浅底或纯色，缩略图能立刻认出商品，主体约占 70–85%。",
        support: "后续画面各讲一个卖点、材质或简洁场景，避免每张都做促销海报。张数足够时可在计划内安排无字纯白底图，不擅自增加张数。",
        forbidden: "极限词、大面积促销字、未核验价格、假认证和额外 Logo",
    },
    { names: ["京东", "jd"], hero: "纯白 #FFFFFF，商品居中，主体约占 80%，不拼接、不加文字。", support: "辅图先讲规格、材质与工艺，再给场景；偏可核对细节。", forbidden: "诱导点击、拼接主图、未核验价格、假认证和额外 Logo" },
    { names: ["拼多多", "pdd"], hero: "高对比纯色或干净浅底，主体至少约占 70%，画面极简。", support: "一眼看懂商品，场景从简，避免杂志式大留白；白底图占计划内张数。", forbidden: "极限词、杂乱装饰、未核验价格、假认证和额外 Logo" },
    { names: ["抖音", "抖店", "douyin"], hero: "生活场景优先，中心主体清晰、色块对比强，避免缩在角落。", support: "按商品卡和信息流构图，真实使用感优先；人物和场景服从品类。", forbidden: "二维码、其他平台标识、大面积促销字、未核验价格和额外 Logo" },
    { names: ["amazon", "亚马逊"], hero: "纯白 #FFFFFF，主体约占 85% 以上；主图不加文字、徽章、边框或无关道具。", support: "卖点字、对比和场景只放辅图，并仅用已核验事实。", forbidden: "主图文字、额外 Logo、水印、边框、未包含的配件和未核验认证" },
    { names: ["shopify", "独立站"], hero: "统一白底或品牌底，集合页缩略图可识别，主体清晰，克制留白。", support: "第二张起展示生活场景、细节和尺度；全套背景和裁切一致。", forbidden: "大面积促销字、未核验价格、假认证和每张更换风格" },
] as const;

/** Upstream creative guidance, not a claim of current platform approval. */
export function ecommercePlatformGuidance(platform?: string) {
    const value = platform?.trim().toLowerCase();
    const book = playbooks.find((book) => book.names.some((name) => name === value));
    return book ? `【平台画面参考 · ${platform}】\n主图：${book.hero}\n辅图：${book.support}\n避免：${book.forbidden}。仅用于画面规划，上架前核对商家后台当前要求；实拍上的真实标识不可擅自改造。` : "";
}
