import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("ecommerce entry opens the ecommerce library without creating a canvas", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/ecommerce-entry.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 15000 });
    expect(new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr)).toContain("0 fail");
    expect(result.exitCode).toBe(0);
});
