import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("studio planning and read-only result recovery across the real form and runner", async () => {
    const child = Bun.spawn([process.execPath, "test", "./test/fixtures/studio-plan-lifecycle.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect({ stdout, stderr, code }).toMatchObject({ code: 0 });
}, 30000);
