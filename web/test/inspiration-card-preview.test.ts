import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("inspiration cards render clean metadata and release hover previews", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/inspiration-card-preview.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 15000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(output).toContain("0 fail");
    expect(result.exitCode).toBe(0);
}, 20000);
