import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("复刻上传、保存中编辑、返回生成台与剪辑草稿恢复", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/remake-workbench.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 45000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
}, 50000);
