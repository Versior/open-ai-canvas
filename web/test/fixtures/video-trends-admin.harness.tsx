import { afterAll, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import type { AdminVideoTrendInput, AdminVideoTrendSource, SiteTrendSource } from "@/services/api/video-trends-admin";

const dom = new Window({ url: "http://localhost/admin/video-replication?tab=trends" });
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLAnchorElement", "SVGElement", "ShadowRoot", "Element", "Node", "Event", "CustomEvent", "MutationObserver", "ResizeObserver"]) {
    Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? dom : key === "document" ? dom.document : dom[key as keyof Window] });
}
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
Object.defineProperty(globalThis, "getComputedStyle", { configurable: true, value: dom.getComputedStyle.bind(dom) });
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { App } = await import("antd");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { useUserStore } = await import("@/stores/use-user-store");
const sources: AdminVideoTrendSource[] = ["douhot", "qianchuan", "oceanengine"].map((source) => ({
    source: source as SiteTrendSource,
    enabled: false,
    configured: false,
    oauthAvailable: source !== "douhot",
    authorized: source !== "douhot",
    cookieConfigured: false,
    advertiserIds: source !== "douhot" ? ["456", "789"] : undefined,
    advertiserId: source !== "douhot" ? "456" : undefined,
}));
const connections: { source: string; input: AdminVideoTrendInput }[] = [];
const publications: boolean[] = [];
let fail = false;
mock.module("@/services/api/video-trends-admin", () => ({
    getAdminVideoTrendSources: async () => structuredClone(sources),
    connectAdminVideoTrends: async (source: SiteTrendSource, input: AdminVideoTrendInput) => {
        connections.push({ source, input });
        if (fail) throw new Error("平台暂时无法同步");
        const item = sources.find((entry) => entry.source === source)!;
        item.configured = true;
        item.cookieConfigured = source === "douhot";
        item.enabled = input.enabled;
        item.board = { source, status: "api", fetchedAt: new Date().toISOString(), topics: [{ title: "已验证的测试选题", url: "https://www.douyin.com/video/123", rank: 1 }] };
        return item.board;
    },
    setAdminVideoTrendVisibility: async (source: SiteTrendSource, enabled: boolean) => {
        publications.push(enabled);
        if (fail) throw new Error("平台暂时无法同步");
        sources.find((entry) => entry.source === source)!.enabled = enabled;
    },
    authorizeAdminVideoTrends: async () => ({ url: "https://qianchuan.jinritemai.com/openapi/qc/audit/oauth.html" }),
    refreshAdminVideoTrends: async () => {
        throw new Error("平台暂时无法同步");
    },
    disconnectAdminVideoTrends: async () => {},
}));
const { TrendAccountsPanel } = await import("@/pages/admin/video-replication/trend-accounts-panel");
const host = document.createElement("div");
document.body.append(host);
const root = createRoot(host);
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
let source: SiteTrendSource = "douhot";
async function paint() {
    await act(async () =>
        root.render(
            <QueryClientProvider client={client}>
                <App>
                    <TrendAccountsPanel
                        active
                        source={source}
                        onSourceChange={(next) => {
                            source = next;
                            void paint();
                        }}
                    />
                </App>
            </QueryClientProvider>,
        ),
    );
    await settle();
}
async function settle() {
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
    });
}
const button = (text: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.trim() === text)!;
async function fill(label: string, value: string) {
    const field = host.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), "value")!.set!.call(field, value);
    await act(async () => field.dispatchEvent(new dom.Event("input", { bubbles: true })));
}
async function submit() {
    await act(async () => host.querySelector("form")!.dispatchEvent(new dom.Event("submit", { bubbles: true, cancelable: true })));
    await settle();
}
afterAll(async () => {
    await act(async () => root.unmount());
    client.clear();
    await dom.happyDOM.abort();
});

test("管理员保存后凭据清空，先预览再发布，热点宝没有虚假扫码状态", async () => {
    await act(async () => useUserStore.getState().setUser({ id: "admin-fixture", username: "admin", role: "admin", status: "active" }));
    await paint();
    expect(host.textContent).toContain("打开登录页不会自动完成连接");
    expect(button("保存并同步").disabled).toBe(true);
    await fill("热点宝登录凭据", "sessionid=EXAMPLE_SESSION");
    await submit();
    expect(connections[0]).toEqual({ source: "douhot", input: { enabled: false, cookie: "sessionid=EXAMPLE_SESSION" } });
    expect(host.querySelector<HTMLInputElement>('[aria-label="热点宝登录凭据"]')!.value).toBe("");
    expect(host.textContent).toContain("已验证的测试选题");
    expect(host.querySelector('[aria-label="前台展示"]')!.getAttribute("aria-checked")).toBe("false");
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="前台展示"]')!.click());
    await settle();
    expect(publications).toEqual([true]);
    expect(host.querySelector('[aria-label="前台展示"]')!.getAttribute("aria-checked")).toBe("true");
});

test("OAuth账户用服务器列表，不向管理员再次索要令牌", async () => {
    source = "qianchuan";
    await paint();
    expect(host.querySelector('[aria-label="授权广告主"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="平台访问令牌"]')).toBeNull();
    await submit();
    expect(connections.at(-1)).toEqual({ source: "qianchuan", input: { enabled: false, advertiserId: "456" } });
});

test("巨量广告项目缺失不能提交，切换来源清理未保存凭据", async () => {
    source = "oceanengine";
    await paint();
    expect(button("保存并同步").disabled).toBe(true);
    await fill("广告项目 ID", "123");
    expect(button("保存并同步").disabled).toBe(false);
    source = "douhot";
    await paint();
    await fill("热点宝登录凭据", "sessionid=EXAMPLE_UNSAVED");
    source = "qianchuan";
    await paint();
    source = "douhot";
    await paint();
    expect(host.querySelector<HTMLInputElement>('[aria-label="热点宝登录凭据"]')!.value).toBe("");
});

test("同步与发布失败明确报错，不把开关或状态变成成功", async () => {
    fail = true;
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="前台展示"]')!.click());
    await settle();
    expect(host.querySelector('[aria-label="前台展示"]')!.getAttribute("aria-checked")).toBe("true");
    expect(host.querySelector('[role="alert"]')!.textContent).toContain("平台暂时无法同步");
    await fill("热点宝登录凭据", "sessionid=EXAMPLE_RETRY");
    await submit();
    expect(host.querySelector('[role="alert"]')!.textContent).toContain("平台暂时无法同步");
    expect(host.textContent).toContain("已验证的测试选题");
    fail = false;
});
