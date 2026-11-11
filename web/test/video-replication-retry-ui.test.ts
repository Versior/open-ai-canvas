import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("视频分析失败恢复与出片轨道候选预览联动", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/video-replication-retry.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 30000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
}, 35000);
