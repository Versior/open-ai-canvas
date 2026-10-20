import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

test("actual media export hook guards account/source changes and lays out variable sizes", () => {
    const worker = fileURLToPath(new URL("./helpers/ecommerce-export.worker.tsx", import.meta.url));
    const result = Bun.spawnSync([process.execPath, worker], { stdout: "pipe", stderr: "pipe" });
    if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stderr));
    expect(result.exitCode).toBe(0);
}, 20_000);
