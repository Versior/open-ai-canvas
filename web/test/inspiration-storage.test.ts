import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

test("inspiration store preserves account isolation and edited fields", () => {
    const worker = fileURLToPath(new URL("./helpers/inspiration-storage.worker.ts", import.meta.url));
    const result = Bun.spawnSync([process.execPath, worker], { stdout: "pipe", stderr: "pipe" });
    if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stderr));
    expect(result.exitCode).toBe(0);
}, 20_000);
