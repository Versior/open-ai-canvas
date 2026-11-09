import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";

test("drawing recovery uses the real studio component in an isolated DOM", () => {
    const result = spawnSync(process.execPath, ["test", "./test/fixtures/interior-drawing-recovery.harness.tsx"], { cwd: import.meta.dir + "/..", encoding: "utf8", timeout: 30_000 });
    expect(result.status, result.stdout + result.stderr).toBe(0);
}, 35000);
