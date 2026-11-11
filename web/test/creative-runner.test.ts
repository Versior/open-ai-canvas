import { expect, test } from "bun:test";
import { resolve } from "node:path";
test("商品视频策划保存、幂等恢复和旧响应隔离", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/creative-runner.harness.ts"], { cwd: resolve(import.meta.dir, ".."), timeout: 30000 });
    expect(result.exitCode, new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr)).toBe(0);
}, 35000);
