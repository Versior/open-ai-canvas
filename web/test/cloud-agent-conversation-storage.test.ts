import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("Agent 对话迁移、跨窗口存储与账号隔离", () => {
    const run = Bun.spawnSync([process.execPath, "test", "./test/fixtures/cloud-agent-conversation-storage.harness.ts"], { cwd: resolve(import.meta.dir, ".."), timeout: 15000 });
    const output = new TextDecoder().decode(run.stdout) + new TextDecoder().decode(run.stderr);
    expect(run.exitCode, output).toBe(0);
    expect(output).toContain("7 pass");
});
