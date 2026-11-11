import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("后台平台账号组件验证共享发布、OAuth账户、凭据清理与失败反馈", async () => {
    const child = Bun.spawn([process.execPath, "test", "./test/fixtures/video-trends-admin.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect({ code, stdout, stderr }).toMatchObject({ code: 0 });
}, 30000);
