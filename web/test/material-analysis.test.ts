import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { parseCreativeMaterialSuggestion } from "@/lib/remake/materials";
import { validTrendURL } from "@/lib/remake/trends";

test("素材识别只回填有事实依据的卖点，保留待确认信息", () => {
    const result = parseCreativeMaterialSuggestion(
        JSON.stringify({
            name: "蓝色杯",
            family: "kitchen",
            facts: [
                { label: "颜色", value: "蓝色", group: "appearance", evidence: "visible" },
                { label: "材质", value: "不锈钢", group: "material", evidence: "inferred" },
            ],
            points: [
                { title: "蓝色杯身", facts: ["颜色"] },
                { title: "不锈钢", facts: ["材质"] },
                { title: "保温24小时", facts: [] },
            ],
            questions: ["材质需要确认"],
            creative: { audience: "桌面使用者", note: "展示杯身", tone: "unknown" },
        }),
        "test-model",
    );
    expect(result.sellingPoints).toBe("蓝色杯身");
    expect(result.audience).toBe("桌面使用者");
    expect(result.questions).toEqual(["材质需要确认"]);
    expect(result.tone).toBeUndefined();
});
test("官方素材链接允许带入策划，拒绝伪装域名和登录参数", () => {
    expect(validTrendURL("qianchuan", "https://v3-default.douyinvod.com/video.mp4")).toBe(true);
    for (const value of ["https://douyinvod.com.evil.example/video", "https://v3-default.douyinvod.com:8080/video", "https://v3-default.douyinvod.com/video?access_token=FAKE", "https://127.0.0.1/video"])
        expect(validTrendURL("qianchuan", value)).toBe(false);
    expect(validTrendURL("douhot", "https://v3-default.douyinvod.com/video.mp4")).toBe(false);
});
test("自动分析防抖、账号和素材隔离以及失败重试边界", async () => {
    const child = Bun.spawn([process.execPath, "test", "./test/fixtures/material-analysis.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect({ code, stdout, stderr }).toMatchObject({ code: 0 });
}, 30000);
