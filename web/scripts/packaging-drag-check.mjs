import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE)).href : "playwright");
const distribution = resolve(process.argv[2] || "dist");
const origin = "http://127.0.0.1:9179";
const parameters = { length: 120, width: 60, height: 180, thickness: 0.45, bleed: 3, glue: 12, tab: 15, gap: 1, frontHeight: 40, windowWidth: 0, windowHeight: 0, inflation: 0.6, spoutRadius: 8 };
const template = { id: "tuck", name: "插舌盒", enabled: true, structure: "tuck", category: "折叠纸盒", description: "", defaults: parameters };
const paper = { id: "white-card", name: "白卡", enabled: true, color: "#f0ece3", insideColor: "#e5ddcc", thickness: 0.45, roughness: 0.65, metalness: 0 };
const user = { id: "packaging-fixture", username: "packaging-fixture", displayName: "合成测试", role: "user", status: "active" };
const contentTypes = { ".css": "text/css", ".js": "text/javascript", ".html": "text/html", ".json": "application/json", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".wasm": "application/wasm" };
const percentile = (sample, fraction) => Math.round([...sample].sort((left, right) => left - right)[Math.ceil(sample.length * fraction) - 1] * 10) / 10;
const browser = await chromium.launch({ headless: true, channel: "chrome", args: ["--enable-unsafe-swiftshader"] });
try {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, serviceWorkers: "block" });
    let saved;
    const errors = [];
    await context.route("**/*", async (route) => {
        const request = route.request(),
            url = new URL(request.url());
        if (url.origin !== origin) return route.abort();
        if (url.pathname.startsWith("/api/")) {
            let data = { items: [], assets: [], folders: [], tasks: [], projects: [], plugins: [], skills: [] };
            if (url.pathname === "/api/auth/session") data = { user };
            else if (url.pathname.endsWith("/packaging/catalog")) data = { enabled: true, maxProjects: 30, revision: 1, templates: [template], materials: [paper] };
            else if (url.pathname === "/api/model-catalog") data = { logicalModels: [], channels: [] };
            else if (url.pathname === "/api/packaging/projects" && request.method() === "POST") data = saved = { ...request.postDataJSON(), id: "saved", userId: user.id, revision: 1, createdAt: "2026-01-01", updatedAt: "2026-01-01" };
            else if (url.pathname === "/api/packaging/projects") data = { items: saved ? [saved] : [], total: saved ? 1 : 0 };
            else if (url.pathname === "/api/packaging/projects/saved") data = request.method() === "PUT" ? (saved = { ...saved, ...request.postDataJSON(), revision: saved.revision + 1 }) : saved;
            else if (request.method() !== "GET") throw new Error(`Unexpected fixture write: ${request.method()} ${url.pathname}`);
            return route.fulfill({ json: { code: 0, msg: "", data } });
        }
        const path = resolve(distribution, "." + (url.pathname === "/packaging" ? "/index.html" : decodeURIComponent(url.pathname)));
        assert(path.startsWith(distribution + sep));
        try {
            return await route.fulfill({ body: await readFile(path), contentType: contentTypes[extname(path)] || "application/octet-stream" });
        } catch {
            return route.fulfill({ status: 404, body: "not found" });
        }
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
        window.textureCopies = 0;
        const read = CanvasRenderingContext2D.prototype.getImageData;
        CanvasRenderingContext2D.prototype.getImageData = function (...args) {
            const result = read.apply(this, args);
            if (result.width === 2048 && result.height > 1000) window.textureCopies++;
            return result;
        };
        const fill = CanvasRenderingContext2D.prototype.fill;
        CanvasRenderingContext2D.prototype.fill = function (...args) {
            if (this.canvas.width === 2048 && this.fillStyle === "#294e4a") {
                const matrix = this.getTransform();
                window.textureX = matrix.e / matrix.a;
            }
            return fill.apply(this, args);
        };
    });
    await page.goto(origin + "/packaging");
    await page.getByRole("button", { name: "并排", exact: true }).click();
    await page.waitForSelector(".pkg-art-image rect");
    await page.waitForSelector(".pkg-model canvas");
    await page.evaluate(() => document.fonts.ready.then(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
    const point = await page
        .locator(".pkg-art-image rect")
        .first()
        .evaluate((rect) => {
            const local = rect.getBBox(),
                matrix = rect.getScreenCTM();
            const p = new DOMPoint(local.x + local.width * 0.46, local.y + local.height * 0.54).matrixTransform(matrix);
            return { x: p.x, y: p.y };
        });
    const artworkX = () => page.locator(".pkg-art-image svg").first().getAttribute("x").then(Number);
    const startX = await artworkX();
    const originalTextureX = await page.evaluate(() => window.textureX);
    assert.ok(Number.isFinite(originalTextureX));
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.evaluate(() => {
        window.probe = { start: performance.now(), frames: [], longTasks: [], startingReads: window.textureCopies };
        new PerformanceObserver((list) => {
            for (const task of list.getEntries()) window.probe.longTasks.push({ start: task.startTime, duration: task.duration });
        }).observe({ type: "longtask" });
        document.addEventListener(
            "pointermove",
            (event) => {
                if (event.buttons === 1) {
                    const start = performance.now();
                    requestAnimationFrame(() => requestAnimationFrame(() => window.probe.frames.push(performance.now() - start)));
                }
            },
            true,
        );
    });
    for (let index = 1; index <= 12; index++) {
        await page.mouse.move(point.x + index * 2, point.y + index);
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    }
    const liveX = await artworkX();
    const finish = await page.evaluate(() => ({ time: performance.now(), reads: window.textureCopies }));
    await page.mouse.up();
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const result = await page.evaluate(() => ({ ...window.probe, textureReads: window.textureCopies, textureX: window.textureX }));
    const finalX = await artworkX();
    assert.notEqual(liveX, startX, "2D must move before release");
    assert.equal(finalX, liveX);
    assert.equal(result.frames.length, 12);
    const longs = result.longTasks.filter((task) => task.start >= result.start && task.start < finish.time);
    const readsDuring = finish.reads - result.startingReads;
    console.log(
        JSON.stringify({
            chrome: browser.version(),
            moves: result.frames.length,
            eventToDoubleRafP50Ms: percentile(result.frames, 0.5),
            eventToDoubleRafP95Ms: percentile(result.frames, 0.95),
            longestTaskMs: Math.max(0, ...longs.map((t) => t.duration)),
            textureReadsDuring: readsDuring,
            textureReadsAfterRelease: result.textureReads - finish.reads,
            startX,
            finalX,
        }),
    );
    if (process.env.EXPECT_FIXED === "1") {
        assert.equal(readsDuring, 0);
        assert.ok(result.textureReads > finish.reads);
    }
    assert.ok(Math.abs(result.textureX - originalTextureX - (finalX - startX)) < 0.01, "the 3D texture and the dieline must move the same distance in millimeters");
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await page.waitForFunction(() => document.body.textContent.includes("已保存到服务器"));
    assert.equal(saved.document.artworks.find((art) => art.id === "sample-base").x, finalX);
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "SVG", exact: true }).click();
    const file = await download;
    const stream = await file.createReadStream();
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const svg = Buffer.concat(chunks).toString();
    assert.ok(svg.includes(`<svg x="${finalX}"`));
    if (process.env.EXPECT_FIXED === "1") {
        await page.getByRole("button", { name: "撤销包装编辑" }).click();
        assert.equal(await artworkX(), startX);
        await page.mouse.move(point.x, point.y);
        await page.mouse.down();
        await page.mouse.move(point.x - 15, point.y + 8, { steps: 3 });
        assert.notEqual(await artworkX(), startX);
        await page.keyboard.press("Escape");
        await page.mouse.up();
        assert.equal(await artworkX(), startX);
        await page.getByRole("button", { name: "重做包装编辑" }).click();
        assert.equal(await artworkX(), finalX);
        await page.getByRole("button", { name: /结构$/ }).first().click();
        await page.getByText("结构细节与开窗", { exact: true }).click();
        const width = page.getByRole("spinbutton", { name: "开窗宽", exact: true });
        const height = page.getByRole("spinbutton", { name: "开窗高", exact: true });
        await width.fill("30");
        assert.equal(await height.inputValue(), "0");
        await page.getByRole("button", { name: "应用开窗尺寸" }).click();
        await page.getByRole("alert").filter({ hasText: "开窗宽高" }).waitFor();
        await height.fill("20");
        await page.getByRole("button", { name: "应用开窗尺寸" }).click();
        await page.getByRole("button", { name: "保存", exact: true }).click();
        await page.waitForFunction(() => document.body.textContent.includes("已保存到服务器 · v2"));
        assert.deepEqual([saved.document.parameters.windowWidth, saved.document.parameters.windowHeight], [30, 20]);
        const cutCount = () => page.locator('.pkg-paper g[stroke="#ce4f60"] path').count();
        const withHole = await cutCount();
        await page.reload();
        await page.waitForFunction(() => document.body.textContent.includes("已保存到服务器 · v2"));
        await page.getByRole("button", { name: /结构$/ }).first().click();
        await page.getByText("结构细节与开窗", { exact: true }).click();
        assert.equal(await width.inputValue(), "30");
        await width.fill("25");
        await page.getByRole("button", { name: "应用开窗尺寸" }).click();
        assert.equal(await cutCount(), withHole);
        const downloadText = async (label) => {
            const pending = page.waitForEvent("download");
            await page.getByRole("button", { name: label, exact: true }).click();
            const reader = await (await pending).createReadStream();
            const chunks = [];
            for await (const chunk of reader) chunks.push(chunk);
            return Buffer.concat(chunks).toString();
        };
        const holePath = await page.locator('.pkg-paper g[stroke="#ce4f60"] path').last().getAttribute("d");
        assert.ok((await downloadText("SVG")).split('<g id="CUT"')[1].includes(holePath));
        const dxf = await downloadText("DXF");
        assert.equal((dxf.match(/8\r\nCUT\r\n100\r\nAcDbPolyline/g) || []).length, withHole);
        await width.fill("0");
        await height.fill("0");
        await page.getByRole("button", { name: "应用开窗尺寸" }).click();
        assert.equal(await cutCount(), withHole - 1);
    }
    assert.deepEqual(errors, []);
    console.log("verified live 2D, saved project and downloaded SVG");
} finally {
    await browser.close();
}
