import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("studio quotes and prompt configuration use isolated regression fixtures", async () => {
    const child = Bun.spawn([process.execPath, "test", "./test/fixtures/studio-estimate-config.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect({ code, stdout, stderr }).toMatchObject({ code: 0 });
}, 30000);
