import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("跨入口开包的挂载、历史记录、失败与图片加载合同", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/image-generation-pack.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 20000 });
    expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0);
});
