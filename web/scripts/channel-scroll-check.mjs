import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Scroll with browser input, not scrollTop assignments: only real input reproduces the nested 1px scroll trap.
export async function checkChannelScroll(page, url, narrow) {
    await page.setViewportSize(narrow ? { width: 390, height: 844 } : { width: 1440, height: 960 });
    await page.goto(url, { waitUntil: "domcontentloaded" });
    const groups = page.locator(".admin-channel-key-group");
    const row = groups.first().locator("tr.ant-table-row").first();
    const cell = row.locator("td").nth(1);
    const second = groups.nth(1).locator("tr.ant-table-row").first();
    await second.waitFor({ timeout: 60000 });
    await cell.waitFor();
    await page.evaluate(() => document.fonts.ready);
    const ownerSelector = narrow ? ".admin-channel-workspace" : ".admin-channel-key-groups";
    const owner = page.locator(ownerSelector);
    const top = () => owner.evaluate((e) => e.scrollTop);
    const position = async () => {
        await cell.scrollIntoViewIfNeeded();
        const { x, y, width, height } = await cell.boundingBox();
        return { x: x + Math.min(width / 2, 100), y: y + height / 2 };
    };
    const waitTop = (y, down) => page.waitForFunction(([s, v, d]) => (d ? document.querySelector(s).scrollTop >= v : document.querySelector(s).scrollTop <= v), [ownerSelector, y, down], { timeout: 4000 });
    const start = await position();
    assert.ok(await cell.evaluate((e, { x, y }) => e.contains(document.elementFromPoint(x, y)), start));
    await page.mouse.move(start.x, start.y);
    const initial = await top();
    await page.mouse.wheel(0, 310);
    await waitTop(initial + 300, true);
    const after = await top();
    const verticalOwners = await cell.evaluate((e, selector) => {
        const owners = [];
        for (; e; e = e.parentElement) if (e.scrollHeight > e.clientHeight && /^(auto|scroll)$/.test(getComputedStyle(e).overflowY)) owners.push(e.matches(selector) ? selector : e.className);
        return owners;
    }, ownerSelector);
    assert.deepEqual(verticalOwners, [ownerSelector], "only one vertical scrollbar over the model rows");
    await page.mouse.wheel(0, -310);
    await waitTop(initial + 1, false);
    const secondY = (await second.boundingBox()).y - start.y + initial;
    assert.ok(secondY > initial + 310);
    for (let y = initial; y < secondY; y += 400) {
        const delta = Math.min(400, Math.ceil(secondY - y));
        await page.mouse.wheel(0, delta);
        await waitTop(y + delta - 1, true);
    }
    assert.ok(await second.evaluate((e, { x, y }) => e.contains(document.elementFromPoint(x, y + 8)), start), "second group row reachable under the pointer");
    await page.mouse.wheel(0, -Math.ceil(secondY - initial));
    await waitTop(initial + 1, false);
    if (!narrow) {
        const thumb = await owner.evaluate((e) => {
            const r = e.getBoundingClientRect(),
                gutter = e.offsetWidth - e.clientWidth;
            return { x: r.right - gutter / 2, y: r.top + 18 + e.clientHeight ** 2 / e.scrollHeight / 3, end: r.top + r.height * 0.75, gutter };
        });
        assert.ok(thumb.gutter > 0, "launch Chrome with visible native scrollbars");
        await page.mouse.move(thumb.x, thumb.y);
        await page.mouse.down();
        await page.mouse.move(thumb.x, thumb.end, { steps: 12 });
        await waitTop(initial + 310, true);
        const dragged = await top();
        await page.mouse.move(thumb.x, thumb.y, { steps: 12 });
        await page.mouse.up();
        await waitTop(initial + 1, false);
        console.log(`Desktop: wheel ${initial} -> ${after}; crossed groups both ways; native scrollbar drag ${initial} -> ${dragged} -> ${await top()}.`);
        return;
    }
    const cdp = await page.context().newCDPSession(page);
    try {
        await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
        const swipe = async (x, y, dx, dy) => {
            await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
            for (let i = 1; i <= 8; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + (dx * i) / 8, y: y + (dy * i) / 8 }] });
            await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        };
        await swipe(start.x, start.y, 0, -140);
        await waitTop(initial + 70, true);
        const content = groups.first().locator(".ant-table-content");
        const reset = await position();
        const { x, width } = await content.boundingBox();
        for (let i = 0; i < 5 && (await content.evaluate((e) => e.scrollLeft + e.clientWidth < e.scrollWidth - 1)); i++) await swipe(x + width - 20, reset.y, -(width - 50), 0);
        const action = row.getByRole("button", { name: /^删除模型 / });
        assert.ok(
            await action.evaluate((e) => {
                const r = e.getBoundingClientRect();
                return e.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
            }),
            "action column reachable by horizontal touch alone",
        );
        assert.equal(await owner.evaluate((e) => Math.max(window.scrollX, document.documentElement.scrollWidth - innerWidth, e.scrollLeft, e.scrollWidth - e.clientWidth)), 0);
        console.log(`Narrow: wheel ${initial} -> ${after}; crossed groups both ways; vertical touch and horizontal touch to actions (${await content.evaluate((e) => e.scrollLeft)}px), no page overflow.`);
    } finally {
        await cdp.detach();
    }
}

// Standalone replay against a local frontend. All API responses are fixtures; no credentials or backend writes.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    const origin = new URL(process.argv[2] || "http://127.0.0.1:3000").origin;
    assert.ok(["127.0.0.1", "localhost"].includes(new URL(origin).hostname));
    const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE)).href : "playwright");
    const browser = await chromium.launch({ ...(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : { channel: "chrome" }), ignoreDefaultArgs: ["--hide-scrollbars"] });
    const site = { id: "scroll-site", name: "滚动验收", baseUrl: "https://example.invalid/v1", apiFormat: "openai", headers: [], keyCount: 2 };
    const channels = [23, 21].map((n, i) => ({ ...site, websiteId: site.id, id: `key-${i}`, name: `分组 ${i + 1}`, enabled: false, models: Array.from({ length: n }, (_, j) => `scroll-${i}-${j}`) }));
    try {
        const context = await browser.newContext({ serviceWorkers: "block" });
        await context.route(/^https?:/, async (route) => {
            const req = route.request(),
                url = new URL(req.url());
            if (url.origin !== origin) return route.abort();
            if (!url.pathname.startsWith("/api/")) return route.continue();
            if (req.method() !== "GET") return route.fulfill({ status: 405 });
            let data = { items: [], models: [], plugins: [], providers: [], channels: [], logicalModels: [], assets: [], folders: [], projects: [] };
            if (url.pathname === "/api/auth/session") data = { user: { id: "scroll-admin", username: "scroll-admin", role: "admin", status: "active" } };
            else if (url.pathname === "/api/admin/channels") data = { channels, total: channels.length };
            else if (url.pathname === "/api/admin/channel-websites") data = { websites: [site] };
            else if (/^\/api\/admin\/channels\/[^/]+\/models$/.test(url.pathname)) {
                const channel = channels.find((c) => c.id === url.pathname.split("/")[4]);
                data = { models: channel.models.map((key) => ({ id: key, channelId: channel.id, modelKey: key, enabled: false, tags: [], priceTiers: [] })) };
            }
            return route.fulfill({ json: { code: 0, data, msg: "" } });
        });
        for (const narrow of [false, true]) {
            const page = await context.newPage();
            await checkChannelScroll(page, `${origin}/admin/channels?website=${site.id}`, narrow);
            await page.close();
        }
    } finally {
        await browser.close();
    }
}
