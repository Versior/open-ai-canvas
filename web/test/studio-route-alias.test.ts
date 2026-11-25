import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const router = readFileSync(new URL("../src/router.tsx", import.meta.url), "utf8");

test("旧电商生图台入口保留查询参数并跳转到新工作台", () => {
    expect(router).toContain('path: "/ecommerce-studio"');
    expect(router).toContain("function LegacyStudioRedirect()");
    expect(router).toContain('pathname: "/studio", search, hash');
});
