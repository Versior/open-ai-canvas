import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("欢迎页在固定工作区外壳中也可切换章节", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/welcome-navigation.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 30000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
}, 35000);
