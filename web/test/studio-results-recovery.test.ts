import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("真实生图结果 UI 接回保存失败原任务且阻止费用未知任务重新生成", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/studio-results-recovery.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 20000 });
    expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0);
});
