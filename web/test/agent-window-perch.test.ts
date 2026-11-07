import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("perch retracts when idle and wakes for work and keyboard interaction", async () => {
    const child = Bun.spawn([process.execPath, "test", "./test/fixtures/agent-window-perch.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect({ code, stdout, stderr }).toMatchObject({ code: 0 });
}, 30000);
