import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("参考规划保存先于提交，丢响应与刷新恢复同一任务，跨账号不写回", async () => {
    const child = Bun.spawn([process.execPath, "test", "./test/fixtures/reference-replication-lifecycle.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect({ code, stdout, stderr }).toMatchObject({ code: 0 });
}, 30000);
