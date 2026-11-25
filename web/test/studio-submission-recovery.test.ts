import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("真实生图台导航、表单与提交回执在独立 DOM 中通过", async () => {
    const child = Bun.spawn([process.execPath, "test", "./test/fixtures/studio-submission-recovery.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect(code, stdout + stderr).toBe(0);
    expect(stdout + stderr).toContain("6 pass");
}, 30000);
