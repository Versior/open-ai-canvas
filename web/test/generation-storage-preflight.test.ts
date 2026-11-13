import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("生成存储能力预检发生在实际 API 请求之前", async () => {
    const child = Bun.spawn([process.execPath, "test", "./test/fixtures/generation-storage-preflight.harness.ts"], { cwd: resolve(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect({ code, stdout, stderr }).toMatchObject({ code: 0 });
}, 30000);
