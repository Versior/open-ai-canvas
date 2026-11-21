import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";

test("canvas sharing separates saving, receipt recovery and clipboard feedback in the real dialog", () => {
    const result = spawnSync(process.execPath, ["test", "./test/fixtures/canvas-share-feedback.harness.tsx"], { cwd: import.meta.dir + "/..", encoding: "utf8", timeout: 30000 });
    expect(result.status, result.stdout + result.stderr).toBe(0);
}, 35000);
