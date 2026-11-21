import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("记忆审批冲突与终态回执在设置和聊天的真实组件中一致", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/agent-memory-review.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 30000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("11 pass");
    expect(output).toContain("0 fail");
}, 35000);
