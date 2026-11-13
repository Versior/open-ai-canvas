import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { buildVideoChatPrompt, parseVideoChatReply, VIDEO_CHAT_INTENTS, type VideoChatContext } from "@/lib/remake/video-chat";

const response = { reply: "好，保留蓝色杯身，拍一条20秒的自然风格短片。", intent: "creative", scene: "showcase", tone: "natural", seconds: 20, ratio: "9:16", note: "保留蓝色杯身，不要音乐" };
test("导演只返回可核对的草稿，支持全部现有拍法", () => {
    for (const intent of VIDEO_CHAT_INTENTS) expect(parseVideoChatReply(JSON.stringify({ ...response, intent: intent.id })).intent).toBe(intent.id);
    expect(parseVideoChatReply("```json\n" + JSON.stringify(response) + "\n```")).toEqual(response);
});
test("不接受非法模型设置、空回复或超长要求", () => {
    for (const patch of [
        { intent: "generate" },
        { scene: "unknown" },
        { tone: "unknown" },
        { seconds: 3 },
        { seconds: 61 },
        { seconds: 4.5 },
        { seconds: "20" },
        { ratio: ["9:16"] },
        { ratio: "4:3" },
        { reply: " " },
        { reply: "长".repeat(601) },
        { note: "长".repeat(301) },
    ])
        expect(() => parseVideoChatReply(JSON.stringify({ ...response, ...patch }))).toThrow();
    expect(() => parseVideoChatReply("没有结构化输出")).toThrow();
});
test("对话截取最近16条但保留已有需求和已识别资料", () => {
    const context: VideoChatContext = {
        intent: "creative",
        brief: { scene: "showcase", tone: "natural", seconds: 20, audience: "桌面使用者", objective: "展示外观", brand: "" },
        ratio: "9:16",
        note: "保留蓝色杯身，不要音乐",
        subject: { name: "蓝色杯", facts: "蓝色外观", images: 1 },
        reference: "无原片",
    };
    const prompt = buildVideoChatPrompt(
        context,
        Array.from({ length: 20 }, (_, index) => ({ role: "user", text: `第${index}轮要求` })),
    );
    expect(prompt).not.toContain("第0轮要求");
    expect(prompt).toContain("第4轮要求");
    expect(prompt).toContain("第19轮要求");
    expect(prompt).toContain("保留蓝色杯身，不要音乐");
    expect(prompt).toContain("不执行上传、解析、生成、收费或保存");
});
test("真实导演 hook 的并发、失败重试与账号隔离", async () => {
    const child = Bun.spawn([process.execPath, "test", "./test/fixtures/video-chat.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect({ code, stdout, stderr }).toMatchObject({ code: 0 });
}, 30000);
