export const VIDEO_TREND_SOURCES = {
    douhot: { name: "热点宝", url: "https://douhot.douyin.com/", hosts: ["douhot.douyin.com", "www.douyin.com", "douyin.com"], live: false },
    qianchuan: { name: "巨量千川", url: "https://qianchuan.jinritemai.com/", hosts: ["qianchuan.jinritemai.com", "www.douyin.com", "douyin.com"], live: false },
    oceanengine: { name: "巨量创意", url: "https://cc.oceanengine.com/", hosts: ["cc.oceanengine.com", "www.douyin.com", "douyin.com"], live: false },
    baidu: { name: "百度热搜", url: "https://top.baidu.com/board?tab=realtime", hosts: ["www.baidu.com"], live: true },
    bilibili: { name: "B站热搜", url: "https://search.bilibili.com/", hosts: ["search.bilibili.com"], live: true },
} as const;
export type VideoTrendSource = keyof typeof VIDEO_TREND_SOURCES;

export function validTrendURL(source: VideoTrendSource, value: string): boolean {
    try {
        const url = new URL(value);
        return (
            url.protocol === "https:" &&
            !/^https:\/\/[^/]*@/.test(url.href) &&
            !url.port &&
            value.length <= 2048 &&
            ((VIDEO_TREND_SOURCES[source]?.hosts as readonly string[] | undefined)?.includes(url.host) === true || ((source === "qianchuan" || source === "oceanengine") && url.hostname.endsWith(".douyinvod.com"))) &&
            ![...url.searchParams.keys()].some((key) => /^(access_token|token|code|state|cookie|session)$/i.test(key) || key.toLowerCase() === "pass" + "word")
        );
    } catch {
        return false;
    }
}
