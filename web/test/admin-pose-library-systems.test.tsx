import { expect, test } from "bun:test";
import { resolve } from "node:path";

// 管理页首次导入会初始化 DOM 和资源模块，隔离它们，避免污染其他画布测试。
test("姿势库体系管理在独立 DOM 中保留折叠、滚动和批量操作", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/admin-pose-library-systems.harness.tsx"], {
        cwd: resolve(import.meta.dir, ".."),
        timeout: 30000,
    });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("3 pass");
    expect(output).toContain("0 fail");
}, 35000);
