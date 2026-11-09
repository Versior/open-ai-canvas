import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
test("director planner uses the real React component and task submission boundary", () => {
    const result = spawnSync(process.execPath, ["test", "./test/fixtures/video-director-planner.harness.tsx"], { cwd: import.meta.dir + "/..", encoding: "utf8", timeout: 30000 });
    expect(result.status, result.stdout + result.stderr).toBe(0);
});
