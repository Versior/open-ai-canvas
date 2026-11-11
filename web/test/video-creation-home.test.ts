import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("视频首页复用素材入口，完整交接创作设置并隔离账号", async () => {
    const child = Bun.spawn([process.execPath, "test", "./test/fixtures/video-creation-home.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect({ code, stdout, stderr }).toMatchObject({ code: 0 });
}, 30000);

test("视频首页提交直接启动已有导演策划，保存与账号边界正确", async () => {
    const child = Bun.spawn([process.execPath, "test", "./test/fixtures/video-creation-director.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect({ code, stdout, stderr }).toMatchObject({ code: 0 });
}, 30000);
