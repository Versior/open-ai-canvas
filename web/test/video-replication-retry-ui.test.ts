import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("视频分析失败后可以直接切换模型重试并保留已有结果", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/video-replication-retry.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 30000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
}, 35000);
