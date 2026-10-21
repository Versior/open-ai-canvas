import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("model presets run through the actual picker, editor form and save payload", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/channel-model-presets.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 20000 });
    if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr));
    expect(result.exitCode).toBe(0);
}, 25000);
