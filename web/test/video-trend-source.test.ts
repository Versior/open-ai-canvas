import { expect, test } from "bun:test";
import { validTrendURL } from "@/lib/remake/trends";
test("作品选题来源拒绝凭据链接与跨来源域名", () => {
    expect(validTrendURL("douhot", "https://www.douyin.com/video/123")).toBe(true);
    for (const url of ["https://www.douyin.com.evil.test/video/123", "http://www.douyin.com/video/123", "https://douhot.douyin.com/?access_token=FAKE", "https://douhot.douyin.com/?state=FAKE", "https://www.baidu.com/s?wd=test"])
        expect(validTrendURL("douhot", url)).toBe(false);
});
