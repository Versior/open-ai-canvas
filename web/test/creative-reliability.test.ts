import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("creative workflows preserve task identity and isolate project sessions", async () => {
    const child = Bun.spawn([process.execPath, "test", "./test/fixtures/creative-reliability.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect({ code, stdout, stderr }).toMatchObject({ code: 0 });
}, 30000);
