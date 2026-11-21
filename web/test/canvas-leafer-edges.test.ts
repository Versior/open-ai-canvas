import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("真实 Leafer 连线的拖动、提交和滚动几何", () => {
    const run = Bun.spawnSync([process.execPath, "test", "./test/fixtures/canvas-leafer-edges.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 30_000 });
    expect(run.exitCode, new TextDecoder().decode(run.stdout) + new TextDecoder().decode(run.stderr)).toBe(0);
}, 30_000);
