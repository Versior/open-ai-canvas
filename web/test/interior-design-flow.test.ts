import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";

test("drawing confirmation and structure preserving furnishing use the real studio pipeline", () => {
    const result = spawnSync(process.execPath, ["test", "./test/fixtures/interior-design-flow.harness.tsx"], { cwd: import.meta.dir + "/..", encoding: "utf8", timeout: 30000 });
    expect(result.status, result.stdout + result.stderr).toBe(0);
}, 35000);
