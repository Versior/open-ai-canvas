import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";

test("功能状态刷新失败、重试与账户切换经过真实路由守卫", () => {
    const result = spawnSync(process.execPath, ["test", "./test/fixtures/require-feature-recovery.harness.tsx"], { cwd: import.meta.dir + "/..", encoding: "utf8", timeout: 30000 });
    expect(result.status, result.stdout + result.stderr).toBe(0);
}, 35000);
