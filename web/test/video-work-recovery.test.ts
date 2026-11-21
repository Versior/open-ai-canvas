import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("作品列表、旧元素替换和拆解恢复的服务端时序", () => {
    const child = Bun.spawnSync([process.execPath, "test", "./test/fixtures/video-work-recovery.harness.ts"], { cwd: resolve(import.meta.dir, ".."), timeout: 30000 });
    expect(child.exitCode, new TextDecoder().decode(child.stdout) + new TextDecoder().decode(child.stderr)).toBe(0);
}, 35000);
