import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("复刻生成与核对流程不串测试 mock", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/remake-quality-runner.harness.ts"], { cwd: resolve(import.meta.dir, ".."), timeout: 20000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
}, 25000);
