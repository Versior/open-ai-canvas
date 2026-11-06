/** 积分显示：最多两位小数，和生图台、视频工作台一致。 */
export function formatProductVideoCredits(credits: number) {
    return credits.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
}
