import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";

test("interior project editing, recovery and stage submissions use the real hooks", () => {
    const result = spawnSync(process.execPath, ["test", "./test/fixtures/interior-project-recovery.harness.tsx"], { cwd: import.meta.dir + "/..", encoding: "utf8", timeout: 30000 });
    expect(result.status, result.stdout + result.stderr).toBe(0);
}, 35000);
