import { expect, test } from "bun:test";

function compact(source: string) {
    return source.replace(/\s+/g, " ").trim();
}

test("admin Domain MCP marketplace is routed and uses the shared HTTP client", async () => {
    const [router, shell, api] = await Promise.all([
        Bun.file(new URL("../src/router.tsx", import.meta.url)).text(),
        Bun.file(new URL("../src/pages/admin/components/admin-shell.tsx", import.meta.url)).text(),
        Bun.file(new URL("../src/services/api/domain-mcp.ts", import.meta.url)).text(),
    ]);

    expect(router).toContain('path: "mcp"');
    expect(router).toContain("<MCPMarketplacePage />");
    expect(shell).toContain('path: "/admin/mcp"');
    expect(api).toContain('import { http } from "@/services/api/request"');
    expect(api).not.toContain("axios");
    for (const endpoint of ["/admin/domain-mcp/catalog", "/admin/domain-mcp/installations"]) {
        expect(api).toContain(endpoint);
    }
});

test("marketplace exposes package, installation and write-only connection workflows", async () => {
    const [pageSource, cssSource] = await Promise.all([Bun.file(new URL("../src/pages/admin/mcp/mcp-marketplace-page.tsx", import.meta.url)).text(), Bun.file(new URL("../src/pages/admin/mcp/mcp-marketplace-page.css", import.meta.url)).text()]);
    const page = compact(pageSource);

    for (const label of ["推荐能力包", "已安装", "自定义连接", "数据说明", "工具数量", "权限", "服务来源"]) {
        expect(page).toContain(label);
    }
    expect(page).toContain('type="password"');
    expect(page).toContain("凭据只写不回显");
    expect(page).toContain("留空则保留现有凭据");
    expect(page).toContain("credentialConfigured");
    expect(page).not.toContain("value={installation.apiKey}");
    expect(page).toContain("data-canvas-wheel-scroll");
    expect(cssSource).toContain("overflow-y: auto");
    expect(page).toContain("await testDomainMCPInstallation");
    expect(page).toContain("await deleteDomainMCPInstallation");
});
