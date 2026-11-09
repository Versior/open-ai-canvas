import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("智能体动作在真实 React 生命周期中遵守待机与工作节奏", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/agent-pet-motion.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 15000 });
    expect(result.exitCode, new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr)).toBe(0);
}, 20000);
