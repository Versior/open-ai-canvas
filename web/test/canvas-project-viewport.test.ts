import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("project loading preserves the centered product and user viewport across cloud restoration", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/canvas-project-viewport.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 15000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(output).toContain("0 fail");
    expect(result.exitCode).toBe(0);
});
