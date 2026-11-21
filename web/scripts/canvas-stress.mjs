/**
 * node scripts/canvas-stress.mjs /absolute/path/to/dist [case ...]
 * 复用本机 Playwright（PLAYWRIGHT_MODULE 可指向其 index.mjs）和 Chrome（可指定 CHROME_BIN）。
 * 每例使用新浏览器上下文、随机回环端口、合成 JPEG 和隔离 API，不操作任何真实账号和数据库。
 * slow* 只给媒体请求和取签加延迟，所有媒体流共用 128 KiB/s；CPU 倍数不是实物低端机。
 * MAX_DRAG_P95_MS、MAX_PAGE_RELEASE_MS 可分别限制持续拖动的 P95 与松手→页面双 rAF。HISTORY_PROBE=1 在采样结束后逐节点验证撤销/重做的本地保存。
 * TIMING_PROBE=1 同时记录页面内松手→双 rAF 和外部双 rAF。STORAGE_PROBE=1 观察匹配快照的原生 put 与 transaction.complete，不主动读写数据库。
 * TRACE_RELEASE_INVALIDATIONS=1 配合 TRACE_OUT 单独记录松手时的样式失效，采样本身会产生明显开销。
 * TRACE_OUT / CPU_PROFILE_OUT / AUDIO_PROBE / TOOLBAR_PROBE / RELEASE_UI_PROBE / STORAGE_PROBE / AGENT_LAYOUT_PROBE / SEARCH_UI_PROBE / CURSOR_UI_PROBE 为独立诊断开关，
 * 不与正式性能采样混算。对带位置虚拟化的新版运行可设 STRESS_EXPECT_OPTIMIZED=1。
 */
import assert from "node:assert/strict";
import { readFile, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const count = 1000;
const cols = 40;
const rows = count / cols;
const date = "2026-01-01T00:00:00.000Z";
const clock = () => performance.now();
const round = Math.round;
const rate = 128 * 1024;
const latency = 160;
const cases = {
    drag100: { selected: 100, cpu: 1 },
    drag500: { selected: 500, cpu: 1 },
    noEdges4: { selected: 500, cpu: 4 },
    linked1: { selected: 500, cpu: 1, edges: true },
    drag1000: { selected: 1000, cpu: 1 },
    linked4: { selected: 500, cpu: 4, edges: true },
    zoom4: { selected: 500, cpu: 4, edges: true, zoom: true },
    all6: { selected: 1000, cpu: 6 },
    partialToAll6: { selected: 1000, cpu: 6, previousSelection: 500 },
    bound6: { selected: 1000, cpu: 6, boundAssets: true },
    near4: { selected: 1000, cpu: 4, scale: 1 },
    cross4: { selected: 1000, cpu: 4, scale: 1, cross: true, edges: true },
    slow: { cpu: 1, slow: true },
    slowPan: { cpu: 1, slow: true, earlyPan: true },
    slow4: { cpu: 4, slow: true },
    slowDrag4: { cpu: 4, slow: true, selected: 1000, scale: 1, whileLoading: true },
    fastload: { cpu: 1 },
};
const mime = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".webp": "image/webp",
    ".woff2": "font/woff2",
    ".wasm": "application/wasm",
};
if (!process.argv[2]) throw new Error(`Usage: node scripts/canvas-stress.mjs DIST [${Object.keys(cases).join(" | ")}]`);
const dist = resolve(process.argv[2]);
assert((await stat(resolve(dist, "index.html"))).isFile());
const names = process.argv.slice(3).length ? process.argv.slice(3) : Object.keys(cases);
for (const name of names) assert(Object.hasOwn(cases, name), `Unknown case: ${name}`);
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE)).href : "playwright");

async function makeImages(browser) {
    const page = await browser.newPage();
    const images = await page.evaluate((count) => {
        const canvas = document.createElement("canvas");
        canvas.width = 640;
        canvas.height = 360;
        const context = canvas.getContext("2d");
        return Array.from({ length: count }, (_, id) => {
            const gradient = context.createLinearGradient(0, 0, 640, 360);
            gradient.addColorStop(0, `hsl(${(id * 73) % 360} 70% 30%)`);
            gradient.addColorStop(1, `hsl(${(id * 131) % 360} 65% 62%)`);
            context.fillStyle = gradient;
            context.fillRect(0, 0, 640, 360);
            for (let mark = 0; mark < 90; mark++) {
                context.fillStyle = `hsl(${(id + mark * 43) % 360} 60% 54%)`;
                context.fillRect((mark * 73) % 640, (id + mark * 271) % 360, 18, 12);
            }
            context.fillStyle = "white";
            context.font = "60px sans-serif";
            context.fillText(`Image ${id + 1}`, 30, 130);
            return canvas.toDataURL("image/jpeg", 0.85).split(",")[1];
        });
    }, count);
    await page.close();
    return images.map((image) => Buffer.from(image, "base64"));
}

function startFixture(images, config) {
    const records = [];
    const writes = new Map();
    const pending = new Set();
    let revision = 1;
    let assetPuts = 0;
    let base;
    let lastTick = clock();
    const cadence = 20;
    const ticker = setInterval(() => {
        const now = clock();
        // No idle credit: all concurrent responses share one physical byte budget.
        let budget = Math.floor((rate * Math.min(now - lastTick, cadence * 2)) / 1000);
        lastTick = now;
        const eligible = [...pending].filter(({ start }) => now >= start + latency);
        for (const [index, rec] of eligible.entries()) {
            const bytes = Math.min(rec.body.length - rec.bytes, Math.floor(budget / (eligible.length - index)));
            if (bytes <= 0) continue;
            const next = rec.bytes + bytes;
            rec.response.write(rec.body.subarray(rec.bytes, next));
            rec.bytes = next;
            budget -= bytes;
            if (next === rec.body.length) {
                rec.end = now;
                pending.delete(rec);
                rec.response.end();
            }
        }
    }, cadence);
    const nodes = Array.from({ length: count }, (_, index) => ({ id: `image-${index}`, type: "image", title: `Image ${index + 1}`, position: { x: (index % cols) * 320, y: Math.floor(index / cols) * 208 }, width: 256, height: 144 }));
    const tables = process.env.SEARCH_UI_PROBE
        ? [
              {
                  id: "probe-table",
                  title: "引用验收表格",
                  type: "batch-table",
                  position: { x: 15000, y: 500 },
                  width: 900,
                  height: 460,
                  metadata: { manualSize: true, batchTable: { operation: "creative", concurrency: 1, referenceMode: "cells", referenceColumns: [{ id: "ref", label: "参考图" }], rows: [{ id: "task", enabled: true, inputNodeIds: [], prompt: "" }] } },
              },
          ]
        : [];
    const project = () => ({
        id: "bench",
        revision,
        title: "Canvas stress fixture",
        createdAt: date,
        updatedAt: date,
        nodes: (process.env.CURSOR_UI_PROBE ? nodes.slice(0, 4) : nodes)
            .map((node, index) => ({
                ...node,
                position: writes.get(node.id) || node.position,
                metadata: {
                    content: `${base}/media/original/${index}.jpg`,
                    ...(!config.selected || config.whileLoading ? { storageKey: `resource:bench-${index}`, mimeType: "image/jpeg" } : {}),
                    ...(config.boundAssets ? { assetId: `asset-${index}` } : {}),
                    naturalWidth: 640,
                    naturalHeight: 360,
                    manualSize: true,
                    ...(process.env.CURSOR_UI_PROBE && index === 2 ? { locked: true } : {}),
                },
            }))
            .concat(tables),
        connections: config.edges ? nodes.slice(1).map((node, index) => ({ id: `edge-${index}`, fromNodeId: nodes[index].id, toNodeId: process.env.RELEASE_UI_PROBE && config.cross && index === 2 ? nodes[cols + 3].id : node.id })) : [],
        chatSessions: [],
        activeChatId: null,
        backgroundMode: "dots",
        showImageInfo: false,
        viewport: { x: 120, y: 145, k: config.scale ?? (config.zoom ? 0.12 : config.selected ? 0.1 : 1) },
        previsScenes: [],
    });
    async function serve(req, res) {
        const path = new URL(req.url, base).pathname;
        if (path.startsWith("/media/")) {
            const [, variant, id] = /^\/media\/(original|thumbnail)\/(\d+)\.jpg$/.exec(path) || [];
            const body = images[id];
            if (!body) throw new Error(`Missing fixture image: ${path}`);
            res.writeHead(200, { "Content-Type": "image/jpeg", "Cache-Control": "public,max-age=86400", "Content-Length": body.length });
            const rec = { variant, id: +id, start: clock(), bytes: 0, end: 0, body, response: res };
            records.push(rec);
            if (!config.slow) {
                rec.bytes = body.length;
                res.end(body);
                rec.end = clock();
            } else {
                pending.add(rec);
                res.on("close", () => pending.delete(rec));
            }
            return;
        }
        if (path.startsWith("/api/")) {
            let data;
            if (path === "/api/auth/session") data = { user: { id: "stress-user", username: "stress-user", displayName: "Stress", role: "user", status: "active" } };
            else if (path === "/api/canvas-projects/bench") data = { project: project() };
            else if (path === "/api/user-data/snapshot") data = { projects: [project()], assets: [], folders: [] };
            else if (path.endsWith("/sync-status")) data = { revision, leases: [], serverTime: date };
            else if (path === "/api/model-catalog") data = { logicalModels: [], channels: [] };
            else if (path === "/api/assets/batch" && config.boundAssets) {
                const chunks = [];
                for await (const chunk of req) chunks.push(chunk);
                data = {
                    assets: JSON.parse(Buffer.concat(chunks).toString()).ids.map((id) => {
                        const index = Number(id.slice(6));
                        const url = `${base}/media/original/${index}.jpg`;
                        return {
                            id,
                            kind: "image",
                            title: `Image ${index + 1}`,
                            coverUrl: url,
                            tags: [],
                            createdAt: date,
                            updatedAt: date,
                            status: "confirmed",
                            category: "material",
                            data: { dataUrl: url, width: 640, height: 360, bytes: images[index].length, mimeType: "image/jpeg" },
                        };
                    }),
                };
            } else if (path.startsWith("/api/assets/") && req.method === "PUT") {
                assetPuts++;
                data = { asset: { id: path.split("/").at(-1), updatedAt: date } };
            } else if (path.endsWith("/operations") || path === "/api/resources/access") {
                const chunks = [];
                for await (const chunk of req) chunks.push(chunk);
                const payload = JSON.parse(Buffer.concat(chunks).toString());
                if (path.endsWith("/operations")) {
                    for (const op of payload.operations) if (op.type === "patch_node" && Object.hasOwn(op.patch, "position.x")) writes.set(op.id, { x: op.patch["position.x"], y: op.patch["position.y"] });
                    data = { mutationId: payload.mutationId, project: { id: "bench", revision: ++revision, updatedAt: date } };
                } else {
                    if (config.slow) await sleep(latency);
                    data = { items: payload.map(({ resourceId, variant }) => ({ resourceId, access: { url: `${base}/media/${variant}/${resourceId.slice(6)}.jpg`, actualVariant: variant, originalWidth: 640, originalHeight: 360 } })) };
                }
            } else data = { items: [], assets: [], folders: [], projects: [], tasks: [], plugins: [] };
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ code: 0, data, msg: "" }));
            return;
        }
        const file = resolve(dist, "." + (path === "/canvas/bench" ? "/index.html" : decodeURIComponent(path)));
        assert(file.startsWith(dist + sep));
        const body = await readFile(file);
        res.writeHead(200, {
            "Content-Type": mime[extname(file)] || "application/octet-stream",
            ...(extname(file) === ".html" ? { "Content-Security-Policy": "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; connect-src 'self' data: blob:" } : {}),
        });
        res.end(body);
    }
    const server = createServer((req, res) =>
        serve(req, res).catch((error) => {
            res.writeHead(error.code === "ENOENT" ? 404 : 500);
            res.end();
            if (error.code !== "ENOENT") console.error(error);
        }),
    );
    return new Promise((ready) =>
        server.listen(0, "127.0.0.1", () => {
            base = `http://127.0.0.1:${server.address().port}`;
            ready({
                base,
                records,
                writes,
                nodes,
                get assetPuts() {
                    return assetPuts;
                },
                get mediaInFlight() {
                    return pending.size;
                },
                close: () => {
                    clearInterval(ticker);
                    server.closeAllConnections();
                    return new Promise((done) => server.close(done));
                },
            });
        }),
    );
}

const selector = (index) => `[data-node-id="image-${index}"]`;
const afterPaint = (page) => page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(performance.now())))));
const pageClock = (page) => page.evaluate(() => performance.now());
const center = ({ x, y, width, height }) => ({ x: round(x + width / 2), y: round(y + height / 2) });
async function checkToolbar(page, selected) {
    const metrics = await page.getByText(`已选 ${selected}`, { exact: true }).evaluate((text) => {
        const toolbar = text.closest("[data-canvas-no-zoom]").getBoundingClientRect();
        const selection = document.querySelector("[data-canvas-selection-bounds]").getBoundingClientRect();
        const screen = document.querySelector("[data-canvas-viewport]").getBoundingClientRect();
        const expected = Math.max(screen.left + 12 + toolbar.width / 2, Math.min(screen.right - 12 - toolbar.width / 2, selection.x + selection.width / 2));
        return { center: toolbar.x + toolbar.width / 2, expected, leftMargin: toolbar.left - screen.left, rightMargin: screen.right - toolbar.right };
    });
    assert(metrics.leftMargin >= 10 && metrics.rightMargin >= 10 && Math.abs(metrics.center - metrics.expected) <= 2, `toolbar bounds and clipping: ${JSON.stringify(metrics)}`);
    return metrics.center;
}
const edgeInk = (page, x, y) =>
    page.evaluate(
        ({ x, y }) => {
            const canvases = document.querySelectorAll("[data-canvas-leafer-underlay] canvas");
            return [...canvases].some((canvas) => {
                const rect = canvas.getBoundingClientRect();
                if (!rect.width || !rect.height) return false;
                const px = Math.round(((x - rect.x) * canvas.width) / rect.width);
                const py = Math.round(((y - rect.y) * canvas.height) / rect.height);
                if (px < 2 || py < 2 || px >= canvas.width - 2 || py >= canvas.height - 2) return false;
                const pixels = canvas.getContext("2d").getImageData(px - 2, py - 2, 5, 5).data;
                return pixels.some((value, index) => index % 4 === 3 && value > 20);
            });
        },
        { x, y },
    );

async function dragCase(page, fixture, config, session) {
    const node = (id) => page.locator(selector(id));
    if (config.zoom) {
        const layer = page.locator("[data-canvas-world-raster-layer]");
        const oldScale = await layer.evaluate((element) => new DOMMatrix(getComputedStyle(element).transform).a);
        await page.mouse.move(124, 137);
        await page.keyboard.down("Control");
        await page.mouse.wheel(0, 340);
        await page.keyboard.up("Control");
        await page.waitForFunction((before) => new DOMMatrix(getComputedStyle(document.querySelector("[data-canvas-world-raster-layer]")).transform).a < before, oldScale);
    }
    if (config.whileLoading) await page.locator(`${selector(0)} img[data-image-pack-result][src]`).waitFor();
    else if (config.scale === 1) await page.locator(`${selector(cols * 2 + 2)} img[data-image-pack-result][src]`).waitFor();
    else await page.waitForFunction((count) => document.querySelectorAll("[data-node-id] img[data-image-pack-result][src]").length === count, count, { timeout: 120000, polling: 200 });
    const mountedBeforeSelection = await page.locator("[data-node-id]").count();
    const first = await node(0).boundingBox();
    const columns = config.selected / rows;
    async function marquee(columnCount) {
        const last = await node(cols * (rows - 1) + columnCount - 1).boundingBox();
        await page.mouse.move(first.x - 3, first.y - 3);
        await page.mouse.down();
        await page.mouse.move(last.x + last.width + 2, last.y + last.height + 2, { steps: 8 });
        await page.mouse.up();
    }
    if (config.previousSelection) {
        await marquee(config.previousSelection / rows);
        await page.getByText(`已选 ${config.previousSelection}`, { exact: true }).waitFor();
        await afterPaint(page);
    }
    const inside = config.cross ? [cols + 3, cols * 2 + 2, cols * 2 + 3] : config.scale === 1 ? [cols + 1, 0, cols * 2 + 2] : [cols * 6 + 1, cols * 12 + Math.min(columns - 1, 25), cols * 21 + 2];
    const outside = columns < cols ? [cols * 9 + columns, cols * 20 + cols - 1] : [];
    const samples = [...inside, ...outside];
    const geometry = () =>
        page.evaluate(
            (ids) =>
                ids.map((id) => {
                    const bounds = document.querySelector(`[data-node-id="image-${id}"]`).getBoundingClientRect();
                    return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
                }),
            samples,
        );
    const entering = cols + 6;
    if (config.cross) assert.equal(await node(entering).count(), 0, "the seventh column should initially be virtualized");
    const trace = [];
    const releaseInvalidations = process.env.TRACE_OUT && process.env.TRACE_RELEASE_INVALIDATIONS;
    if (process.env.TRACE_OUT) {
        session.on("Tracing.dataCollected", ({ value }) => trace.push(...value));
        if (!releaseInvalidations) await session.send("Tracing.start", { categories: "devtools.timeline,blink.user_timing,disabled-by-default-devtools.timeline", transferMode: "ReportEvents" });
    }
    if (process.env.CPU_PROFILE_OUT) {
        await session.send("Profiler.enable");
        await session.send("Profiler.start");
    }
    const selectStarted = await page.evaluate(
        ({ keyboard, count }) => {
            const state = (window.stressSelection = {});
            const stamp = (name) => performance.mark(`stress-select-${name}`).startTime;
            function finish() {
                state.accepted = stamp("input");
                requestAnimationFrame(() => requestAnimationFrame(() => (state.painted = stamp("paint"))));
                const observeToolbar = () => {
                    const badge = Array.from(document.getElementsByClassName("aceternity-floating-panel")).find((element) => element.textContent.trim() === `已选 ${count}`);
                    if (badge?.checkVisibility({ opacityProperty: true, visibilityProperty: true })) state.toolbar = stamp("toolbar");
                    else requestAnimationFrame(observeToolbar);
                };
                requestAnimationFrame(observeToolbar);
            }
            if (keyboard) {
                const shortcut = (event) => {
                    if (event.key.toLowerCase() !== "a" || !(event.ctrlKey || event.metaKey)) return;
                    window.removeEventListener("keydown", shortcut, true);
                    state.started = stamp("start");
                    finish();
                };
                window.addEventListener("keydown", shortcut, true);
            } else {
                window.addEventListener("pointerdown", () => (state.started = stamp("start")), { capture: true, once: true });
                window.addEventListener("pointerup", finish, { capture: true, once: true });
            }
            return performance.now();
        },
        { keyboard: columns === cols, count: config.selected },
    );
    if (columns === cols) await page.keyboard.press("Control+a");
    else await marquee(columns);
    await page.getByText(`已选 ${config.selected}`, { exact: true }).waitFor({ timeout: 15000 });
    const selectMs = round((await pageClock(page)) - selectStarted);
    await page.waitForFunction(() => window.stressSelection.toolbar && window.stressSelection.painted, null, { timeout: 15000 });
    const selection = await page.evaluate(() => {
        const { started, accepted, painted, toolbar } = window.stressSelection;
        return { gestureMs: Math.round(accepted - started), confirmPaint: Math.round(painted - accepted), toolbarVisible: Math.round(toolbar - accepted) };
    });
    selection.input = columns === cols ? "shortcut" : "marquee";
    const toolbarCenters = [];
    if (process.env.TOOLBAR_PROBE) toolbarCenters.push(await checkToolbar(page, config.selected));
    const releaseUi = process.env.RELEASE_UI_PROBE ? {} : undefined;
    const edgeId = releaseUi && config.cross ? "edge-2" : null;
    async function hoverConnection() {
        const point = await page.locator(`[data-connection-id="${edgeId}"]`).evaluate((path) => {
            const point = path.getPointAtLength(path.getTotalLength() / 2).matrixTransform(path.getScreenCTM());
            const hits = document.elementsFromPoint(point.x, point.y);
            return { x: point.x, y: point.y, hit: hits[0] === path && getComputedStyle(path).pointerEvents === "stroke", stack: hits.slice(0, 4).map((el) => [el.tagName, el.getAttribute("data-connection-id") || el.getAttribute("class")]) };
        });
        assert(point.hit, `the actual pointer must hit ${edgeId}: ${JSON.stringify(point)}`);
        await page.mouse.move(point.x, point.y);
        await page.waitForFunction((id) => document.querySelector(`[data-connection-id="${id}"]`)?.parentElement.querySelector("circle")?.getBoundingClientRect().width > 0, edgeId);
        return true;
    }
    if (releaseUi) {
        await page.getByText(`已选 ${config.selected}`, { exact: true }).evaluate((badge) => (window.stressToolbar = badge.closest("[data-canvas-selection-toolbar], [data-canvas-no-zoom]")));
        if (edgeId) {
            releaseUi.edgeFixture = "diagonal between image-2 and image-43";
            releaseUi.hoverBefore = await hoverConnection();
        }
    }
    const mountedAfterSelection = await page.locator("[data-node-id]").count();
    const enteringMountedAfterSelection = config.cross ? Boolean(await node(entering).count()) : undefined;
    const initial = await geometry();
    const start = center(initial[0]);
    const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest("[data-node-id]")?.dataset.nodeId, start);
    assert.equal(hit, `image-${inside[0]}`, "drag must start on selected node, not toolbar");
    await page.mouse.move(start.x, start.y);
    await afterPaint(page);
    await page.evaluate(
        ({ capturePaint, captureStore }) => {
            const state = (window.stressDrag = { frames: [], events: {}, writes: 0 });
            if (captureStore) {
                const probe = (window.stressStore = { transactions: [], notify: null });
                const originalPut = IDBObjectStore.prototype.put;
                IDBObjectStore.prototype.put = function (...args) {
                    if (state.events.pointerup == null || this.transaction.db.name !== "yingce" || this.name !== "app_state" || args[1] !== "yingce:canvas_store:user:stress-user") return Reflect.apply(originalPut, this, args);
                    const started = performance.now();
                    const request = Reflect.apply(originalPut, this, args);
                    const sample = { value: args[0], started, returned: performance.now(), completed: null };
                    probe.transactions.push(sample);
                    this.transaction.addEventListener(
                        "complete",
                        () => {
                            sample.completed = performance.now();
                            probe.notify?.();
                        },
                        { once: true },
                    );
                    return request;
                };
            }
            for (const type of ["pointerdown", "pointerup"])
                window.addEventListener(
                    type,
                    () => {
                        state.events[type] = performance.mark(`stress-drag-${type}`).startTime;
                        if (capturePaint && type === "pointerup") requestAnimationFrame(() => requestAnimationFrame(() => (state.events.pointerupPaint = performance.mark("stress-drag-in-page-paint").startTime)));
                    },
                    { once: true, capture: true },
                );
            const sample = (time) => {
                state.frames.push(time);
                state.raf = requestAnimationFrame(sample);
            };
            state.raf = requestAnimationFrame(sample);
        },
        { capturePaint: Boolean(process.env.TIMING_PROBE || process.env.MAX_PAGE_RELEASE_MS), captureStore: Boolean(process.env.STORAGE_PROBE) },
    );
    await afterPaint(page);
    let mediaInFlightAtDown, bytesAtDown;
    if (config.whileLoading) {
        mediaInFlightAtDown = fixture.mediaInFlight;
        assert(mediaInFlightAtDown > 0, "slow drag must start during an actual image transfer");
        bytesAtDown = fixture.records.reduce((sum, record) => sum + record.bytes, 0);
    }
    await page.mouse.down();
    const afterDown = await afterPaint(page);
    if (releaseUi) {
        releaseUi.toolbarDuring = await page.evaluate(() => {
            const toolbar = window.stressToolbar;
            const button = toolbar.querySelector("button");
            button.focus({ preventScroll: true });
            return { connected: toolbar.isConnected, hidden: getComputedStyle(toolbar).visibility === "hidden", inert: toolbar.inert, focusBlocked: document.activeElement !== button };
        });
        if (edgeId) {
            const edgePath = page.locator(`[data-connection-id="${edgeId}"]`);
            await edgePath.dispatchEvent("mouseover", { buttons: 1 });
            await afterPaint(page);
            releaseUi.edgeDuring = await edgePath.evaluate((path) => {
                const visual = path.parentElement.querySelector("[data-canvas-connection-visual]");
                return {
                    hidden: visual ? getComputedStyle(visual).display === "none" : !path.parentElement.querySelector("circle, [data-connection-beam]"),
                    hitPathRetained: path.isConnected && getComputedStyle(path).pointerEvents === "stroke",
                    suppressedHoverGroup: Boolean(visual?.querySelector("circle")),
                };
            });
            assert(releaseUi.edgeDuring.hidden && releaseUi.edgeDuring.hitPathRetained);
            await edgePath.dispatchEvent("mouseout", { buttons: 1 });
            await afterPaint(page);
        }
    }
    const beforeMove = await page.evaluate(() => {
        performance.mark("stress-move-start");
        return performance.now();
    });
    function check(positions, expectedX, expectedY, phase) {
        const dx = positions[0].x - initial[0].x;
        const dy = positions[0].y - initial[0].y;
        assert(Math.abs(dx - expectedX) <= 8 && Math.abs(dy - expectedY) <= 8, `${phase} selected displacement ${dx}, ${dy} vs ${expectedX}, ${expectedY}`);
        for (let index = 1; index < samples.length; index++) {
            const selected = index < inside.length;
            assert(Math.abs(positions[index].x - initial[index].x - (selected ? dx : 0)) < 0.5 && Math.abs(positions[index].y - initial[index].y - (selected ? dy : 0)) < 0.5, `${phase} inconsistent displacement on image-${samples[index]}`);
        }
        return { dx, dy };
    }
    const distance = config.cross ? -864 : 96;
    for (let step = 1; step <= 32; step++) {
        await page.mouse.move(start.x + (step * distance) / 32, start.y + step);
        if (step === 16) {
            await afterPaint(page);
            check(await geometry(), distance / 2, 16, "mid-drag");
        }
    }
    await afterPaint(page);
    const preview = check(await geometry(), distance, 32, "last preview");
    const moveEnd = await page.evaluate(() => {
        performance.mark("stress-move-end");
        return performance.now();
    });
    let enteringLiveMs;
    let enteringEdge;
    if (config.cross) {
        const started = await pageClock(page);
        const expected = { index: entering, x: first.x + fixture.nodes[entering].position.x + preview.dx, y: first.y + fixture.nodes[entering].position.y + preview.dy };
        await page.waitForFunction(
            ({ index, x, y }) => {
                const element = document.querySelector(`[data-node-id="image-${index}"]`);
                const rect = element?.getBoundingClientRect();
                return rect && rect.x >= 0 && rect.x < innerWidth && Math.abs(rect.x - x) < 0.5 && Math.abs(rect.y - y) < 0.5;
            },
            expected,
            { timeout: 2500, polling: 32 },
        );
        enteringEdge = await edgeInk(page, expected.x - 32, expected.y + 72);
        enteringLiveMs = round((await pageClock(page)) - started);
    }
    const mediaBytesDuringDrag = config.whileLoading ? fixture.records.reduce((sum, record) => sum + record.bytes, 0) - bytesAtDown : undefined;
    if (config.whileLoading) assert(mediaBytesDuringDrag > 0, "downloading must overlap the gesture");
    if (releaseInvalidations) {
        assert.equal(await page.locator('[data-canvas-node-dragging="true"]').count(), 1);
        await session.send("Tracing.start", { categories: "devtools.timeline,blink.user_timing,disabled-by-default-devtools.timeline,disabled-by-default-devtools.timeline.invalidationTracking", transferMode: "ReportEvents" });
    }
    await page.mouse.up();
    const afterUp = await afterPaint(page);
    if (process.env.CPU_PROFILE_OUT) {
        const { profile } = await session.send("Profiler.stop");
        await writeFile(process.env.CPU_PROFILE_OUT, JSON.stringify(profile));
    }
    if (process.env.TRACE_OUT) {
        const finished = new Promise((done) => session.once("Tracing.tracingComplete", done));
        await session.send("Tracing.end");
        await finished;
        await writeFile(process.env.TRACE_OUT, JSON.stringify({ traceEvents: trace }));
    }
    await sleep(180);
    const committed = check(await geometry(), distance, 32, "committed");
    const singleNodePanels = await page.locator("[data-canvas-node-panel]").count();
    assert(Math.abs(committed.dx - preview.dx) < 0.5 && Math.abs(committed.dy - preview.dy) < 0.5, `release must retain preview: ${JSON.stringify({ preview, committed })}`);
    const timeline = await page.evaluate(() => {
        const { raf, frames, events } = window.stressDrag;
        cancelAnimationFrame(raf);
        return { frames, events };
    });
    if (releaseUi) {
        releaseUi.toolbarAfter = await page.getByText(`已选 ${config.selected}`, { exact: true }).evaluate((badge) => {
            const toolbar = badge.closest("[data-canvas-selection-toolbar], [data-canvas-no-zoom]");
            return { same: toolbar === window.stressToolbar, visible: toolbar.checkVisibility({ visibilityProperty: true }), interactive: !toolbar.inert };
        });
        assert(releaseUi.toolbarAfter.visible && releaseUi.toolbarAfter.interactive);
        if (edgeId) releaseUi.hoverAfter = await hoverConnection();
        if (process.env.STRESS_EXPECT_RELEASE) {
            assert(Object.values(releaseUi.toolbarDuring).every(Boolean) && releaseUi.toolbarAfter.same, `selection toolbar lifecycle: ${JSON.stringify(releaseUi)}`);
            if (edgeId) assert(releaseUi.edgeDuring.suppressedHoverGroup, "the SVG hit path and its populated, CSS-hidden hover group must coexist during dragging");
        }
    }
    const k = initial[0].width / 256;
    let storage;
    if (process.env.STORAGE_PROBE) {
        storage = await page.evaluate(
            ({ delta, scale }) =>
                new Promise((resolve, reject) => {
                    const probe = window.stressStore;
                    const release = window.stressDrag.events.pointerup;
                    const timer = setTimeout(() => {
                        probe.notify = null;
                        reject(new Error("No matching canvas IndexedDB transaction completed after release"));
                    }, 8000);
                    probe.notify = () => {
                        for (const sample of probe.transactions) {
                            if (sample.completed == null || sample.checked) continue;
                            sample.checked = true;
                            const project = JSON.parse(sample.value).state.projects.find((item) => item.id === "bench");
                            const anchor = project?.nodes.find((node) => node.id === "image-0");
                            if (!anchor || Math.abs(anchor.position.x * scale - delta.dx) >= 0.5 || Math.abs(anchor.position.y * scale - delta.dy) >= 0.5) continue;
                            clearTimeout(timer);
                            probe.notify = null;
                            resolve({
                                releaseToPut: Math.round(sample.started - release),
                                putCall: Math.round(sample.returned - sample.started),
                                putToComplete: Math.round(sample.completed - sample.started),
                                releaseToComplete: Math.round(sample.completed - release),
                                snapshotChars: sample.value.length,
                            });
                            return;
                        }
                    };
                    probe.notify();
                }),
            { delta: committed, scale: k },
        );
    }
    async function checkPersisted(offset, phase) {
        const deadline = clock() + 8000;
        let stored;
        do {
            stored = await page.evaluate(
                async ({ expectedX, scale }) => {
                    const doc = await new Promise((done, reject) => {
                        const db = indexedDB.open("yingce");
                        db.onerror = () => reject(db.error);
                        db.onsuccess = () => {
                            const tx = db.result.transaction("app_state");
                            const request = tx.objectStore("app_state").get("yingce:canvas_store:user:stress-user");
                            request.onsuccess = () => done(request.result && JSON.parse(request.result));
                            request.onerror = () => reject(request.error);
                            tx.oncomplete = () => db.result.close();
                        };
                    });
                    const saved = doc?.state.projects.find((p) => p.id === "bench")?.nodes;
                    const anchor = saved?.find(({ id }) => id === "image-0");
                    return anchor && Math.abs(anchor.position.x - expectedX) * scale < 0.5 && saved.map(({ id, position }) => ({ id, position }));
                },
                { expectedX: offset.dx / k, scale: k },
            );
            if (stored) break;
            await sleep(120);
        } while (clock() < deadline);
        assert(Array.isArray(stored), `${phase}: timed out waiting for the expected persisted drag position`);
        const byId = new Map(stored.map(({ id, position }) => [id, position]));
        assert.equal(byId.size, count);
        for (const [index, item] of fixture.nodes.entries()) {
            const patch = byId.get(item.id);
            if (index % cols >= columns || (!offset.dx && !offset.dy)) assert.deepEqual(patch, item.position, `${phase}: unexpected persisted position on ${item.id}`);
            else {
                assert(patch && Math.abs((patch.x - item.position.x) * k - offset.dx) < 0.5 && Math.abs((patch.y - item.position.y) * k - offset.dy) < 0.5, `${phase}: persisted delta for ${item.id}`);
            }
        }
    }
    await checkPersisted(committed, "commit");
    let history;
    if (process.env.HISTORY_PROBE) {
        await page.keyboard.press("Control+z");
        await checkPersisted({ dx: 0, dy: 0 }, "undo");
        await afterPaint(page);
        check(await geometry(), 0, 0, "undo");
        await page.keyboard.press("Control+y");
        await checkPersisted(committed, "redo");
        await afterPaint(page);
        check(await geometry(), committed.dx, committed.dy, "redo");
        history = { undoVerified: count, redoVerified: count };
    }
    const { frames, events } = timeline;
    const bucket = (start, end, inside = false) => {
        const times = frames
            .slice(1)
            .flatMap((time, index) => ((inside ? frames[index] >= start && time <= end : time > start && frames[index] < end) ? [time - frames[index]] : []))
            .sort((left, right) => left - right);
        return { samples: times.length, p95: round(times[Math.ceil(times.length * 0.95) - 1]), max: round(times.at(-1)), over50: times.filter((ms) => ms > 50.5).length };
    };
    if (process.env.TOOLBAR_PROBE) {
        toolbarCenters.push(await checkToolbar(page, config.selected));
        await page.keyboard.down("Space");
        await page.mouse.move(1000, 710);
        await page.mouse.down();
        await page.mouse.move(885, 702, { steps: 8 });
        await page.mouse.up();
        await page.keyboard.up("Space");
        await afterPaint(page);
        toolbarCenters.push(await checkToolbar(page, config.selected));
        const raster = page.locator("[data-canvas-world-raster-layer]");
        const beforeZoom = await raster.evaluate((element) => new DOMMatrix(getComputedStyle(element).transform).a);
        await page.mouse.move(225, 460);
        await page.keyboard.down("Control");
        await page.mouse.wheel(0, -180);
        await page.keyboard.up("Control");
        await page.waitForFunction((before) => new DOMMatrix(getComputedStyle(document.querySelector("[data-canvas-world-raster-layer]")).transform).a > before, beforeZoom);
        await afterPaint(page);
        toolbarCenters.push(await checkToolbar(page, config.selected));
        assert(Math.max(...toolbarCenters) - Math.min(...toolbarCenters) > 70, "toolbars must follow the selection position, not a fixed overlay");
        await node(inside[0]).click({ button: "right" });
        await page.getByText(`已选 ${config.selected} 个节点`, { exact: true }).waitFor();
        await page.keyboard.press("Escape");
    }
    return {
        toolbarCenters: toolbarCenters.length ? toolbarCenters.map(round) : undefined,
        mediaInFlightAtDown,
        mediaBytesDuringDrag,
        scale: +k.toFixed(3),
        localPersisted: config.selected,
        mountedBeforeSelection,
        mountedAfterSelection,
        enteringMountedAfterSelection,
        enteringLiveMs,
        enteringEdge,
        selectMs,
        selection,
        history,
        storage,
        releaseUi,
        previewDx: round(preview.dx),
        singleNodePanels,
        downPaint: round(afterDown - events.pointerdown),
        move: bucket(beforeMove, moveEnd, true),
        upPaint: round(afterUp - events.pointerup),
        upPaintInPage: events.pointerupPaint ? round(events.pointerupPaint - events.pointerup) : undefined,
        up: bucket(events.pointerup, afterUp),
    };
}

async function cursorUi(page) {
    page.setDefaultTimeout(8000);
    const source = page.locator(selector(0));
    const host = page.locator(selector(2));
    const viewport = page.locator("[data-canvas-viewport]");
    const marker = "[data-canvas-drag-cursor]";
    const frameSelector = "iframe[data-stress-cursor-frame]";
    await host.locator(".canvas-node-shell").evaluate((shell) => {
        const frame = document.createElement("iframe");
        frame.dataset.stressCursorFrame = "";
        frame.title = "Cursor test embed";
        frame.setAttribute("sandbox", "allow-same-origin");
        frame.srcdoc = '<!doctype html><meta charset="utf-8"><body style="margin:0;min-height:1400px"><label style="position:fixed;top:12px;left:12px"><input type="checkbox">Frame input</label></body>';
        frame.style.cssText = "position:absolute;inset:8px;width:calc(100% - 16px);height:calc(100% - 16px);z-index:20;border:0;";
        shell.append(frame);
    });
    const iframe = page.locator(frameSelector);
    const checkbox = page.frameLocator(frameSelector).getByRole("checkbox", { name: "Frame input" });
    await checkbox.check();
    assert(await checkbox.isChecked());
    const frameCenter = center(await iframe.boundingBox());
    const initial = await source.boundingBox();
    const sourceCenter = center(initial);
    const blankPoint = { x: initial.x + initial.width + 32, y: initial.y + initial.height + 36 };
    const endPoint = { x: frameCenter.x + 130, y: frameCenter.y + 275 };
    await page.evaluate(() => {
        window.stressCursorMoves = [];
        window.addEventListener(
            "mousemove",
            (event) => {
                const element = event.target;
                if (!(element instanceof Element)) return;
                const node = element.closest("[data-node-id]");
                window.stressCursorMoves.push({
                    x: event.clientX,
                    y: event.clientY,
                    node: node?.getAttribute("data-node-id"),
                    tag: element.tagName,
                    cursor: getComputedStyle(element).cursor,
                    markedCursor: node?.hasAttribute("data-canvas-drag-cursor") ? getComputedStyle(node).cursor : null,
                    markers: document.querySelectorAll("[data-canvas-drag-cursor]").length,
                });
            },
            { capture: true },
        );
    });
    const normal = async () => {
        assert.notEqual(await viewport.getAttribute("data-canvas-node-dragging"), "true");
        assert.equal(await page.locator(marker).count(), 0);
        assert.notEqual(await iframe.evaluate((element) => getComputedStyle(element).pointerEvents), "none");
    };
    const begin = async () => {
        const spot = center(await source.boundingBox());
        await page.mouse.move(spot.x, spot.y);
        assert.equal(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest("[data-node-id]")?.dataset.nodeId, spot), "image-0");
        await page.mouse.down();
        await afterPaint(page);
        assert.equal(await viewport.getAttribute("data-canvas-node-dragging"), "true");
        const marked = await page.locator(marker).evaluateAll((items) => items.map((element) => [element.dataset.nodeId, getComputedStyle(element).cursor, element.matches(":hover")]));
        assert.deepEqual(marked, [["image-0", "grabbing", true]]);
        assert.equal(await iframe.evaluate((element) => getComputedStyle(element).pointerEvents), "none");
        return spot;
    };
    await normal();
    await begin();
    await page.mouse.move(blankPoint.x, blankPoint.y);
    await afterPaint(page);
    await page.mouse.move(frameCenter.x, frameCenter.y);
    await afterPaint(page);
    await page.mouse.move(endPoint.x, endPoint.y, { steps: 8 });
    await page.mouse.up();
    await afterPaint(page);
    await normal();
    const latest = await source.boundingBox();
    assert(Math.abs(latest.x - initial.x - (endPoint.x - sourceCenter.x)) <= 8 && Math.abs(latest.y - initial.y - (endPoint.y - sourceCenter.y)) <= 8, "release must commit the real pointer position");
    const moves = await page.evaluate(() => window.stressCursorMoves);
    const at = (point) => moves.find((sample) => sample.x === Math.round(point.x) && sample.y === Math.round(point.y));
    const blank = at(blankPoint);
    assert(blank && !blank.node && !blank.markers && blank.cursor !== "grabbing", `blank should retain its original target and cursor: ${JSON.stringify(blank)}`);
    const embedded = at(frameCenter);
    assert(embedded?.node === "image-2" && embedded.tag !== "IFRAME" && embedded.markedCursor === "grabbing", `movement over iframe must reach and mark its underlying node: ${JSON.stringify(embedded)}`);
    assert(moves.every((sample) => sample.markers <= 1));
    assert.equal(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, frameCenter), "IFRAME");
    await page.mouse.move(frameCenter.x, frameCenter.y);
    await page.mouse.wheel(0, 140);
    await page.waitForFunction((selector) => document.querySelector(selector).contentDocument.scrollingElement.scrollTop > 0, frameSelector, { timeout: 3000 });
    await checkbox.uncheck();
    assert(!(await checkbox.isChecked()));
    for (const reason of ["pointercancel", "blur"]) {
        const spot = await begin();
        await page.mouse.move(spot.x - 47, spot.y + 25, { steps: 4 });
        await afterPaint(page);
        assert(Math.abs((await source.boundingBox()).x - latest.x) > 20);
        await page.evaluate((event) => window.dispatchEvent(event === "pointercancel" ? new PointerEvent(event, { pointerId: 1, pointerType: "mouse" }) : new FocusEvent(event)), reason);
        await afterPaint(page);
        await normal();
        await page.mouse.up();
        const restored = await source.boundingBox();
        assert(Math.abs(restored.x - latest.x) < 0.5 && Math.abs(restored.y - latest.y) < 0.5, `${reason} must not commit a preview`);
        await checkbox.setChecked(reason === "pointercancel");
        assert.equal(await checkbox.isChecked(), reason === "pointercancel");
    }
    const imagePoint = center(await source.boundingBox());
    await page.mouse.dblclick(imagePoint.x, imagePoint.y);
    const preview = page.getByRole("dialog").filter({ has: page.getByRole("img", { name: "Image 1", exact: true }) });
    await preview.waitFor();
    await page.keyboard.press("Escape");
    await preview.waitFor({ state: "hidden" });
    await normal();
    return { markerLimit: 1, realBlankHit: true, doubleClickPreview: true, cancelSignals: ["pointercancel", "blur"], iframe: "conditional sandbox DOM fixture in a real locked node", nativeFrameInputAndWheelRestored: true };
}

async function searchUi(page) {
    const latest = "改名后引用验收图";
    const search = page.getByRole("textbox", { name: "搜索画布节点" });
    const openSearch = async (query) => {
        await page.keyboard.press("Control+f");
        await search.fill(query);
    };
    async function focus(query, id) {
        await openSearch(query);
        await page.locator(`#canvas-node-search-result-${id}`).getByText(query, { exact: true }).waitFor();
        await search.press("Enter");
        await search.waitFor({ state: "hidden" });
        await page.waitForFunction(
            (id) => {
                const target = document.querySelector(`[data-node-id="${id}"]`)?.getBoundingClientRect();
                const view = document.querySelector("[data-canvas-viewport]")?.getBoundingClientRect();
                return target && view && Math.abs(target.left + target.width / 2 - view.left - view.width / 2) < 4 && Math.abs(target.top + target.height / 2 - view.top - view.height / 2) < 4;
            },
            id,
            { timeout: 8000 },
        );
    }
    await openSearch(latest);
    await page.getByText("没有匹配节点", { exact: true }).waitFor();
    await search.press("Escape");
    await search.waitFor({ state: "hidden" });
    const image = page.locator(selector(0));
    await image.getByRole("button", { name: "编辑节点名称：Image 1", exact: true }).click();
    const title = image.getByRole("textbox", { name: "节点名称" });
    await title.fill(latest);
    await title.press("Enter");
    await image.getByRole("button", { name: `编辑节点名称：${latest}` }).waitFor();
    await focus(latest, "image-0");
    await focus("引用验收表格", "probe-table");
    const cell = page.locator('[data-batch-reference-cell][data-row-id="task"][data-column-id="ref"]');
    await cell.locator("button.canvas-batch-thumbnail").click();
    const filter = page.getByRole("textbox", { name: "搜索画布图片" });
    await filter.fill(latest);
    const option = page.getByRole("button", { name: `选择图片 ${latest}`, exact: true });
    await option.waitFor();
    await filter.press("Escape");
    await filter.waitFor({ state: "hidden" });
    await cell.locator("button.canvas-batch-thumbnail").click();
    await filter.fill(latest);
    await option.click();
    await filter.waitFor({ state: "hidden" });
    await cell.locator("img").waitFor();
    await cell.getByRole("button", { name: /清除.*引用/ }).waitFor();
    return { searchRenamedAndFocused: true, escapeClosedSearch: true, pickerReopened: true, selectedReference: latest };
}

async function agentLayout(page, base) {
    const url = `${base}/canvas/bench?agent=1`;
    await page.goto(url);
    await page.locator(".agent-conversation-messages").waitFor({ state: "attached", timeout: 15000 });
    const messages = [
        { id: "question", role: "user", text: "Spacing question" },
        { id: "answer", role: "assistant", text: "First fixture paragraph.\n\nSecond fixture paragraph.\n\nمرحبا بالعالم" },
        { id: "next-question", role: "user", text: "Next spacing question" },
        { id: "next-answer", role: "assistant", text: "Final fixture paragraph." },
    ];
    await page.evaluate(
        async ({ messages, date }) => {
            const database = await new Promise((resolve, reject) => {
                const opening = indexedDB.open("yingce");
                opening.onerror = () => reject(opening.error);
                opening.onsuccess = () => resolve(opening.result);
            });
            try {
                const conversation = { id: "layout-probe", title: "Paragraph spacing fixture", messages, run: null, permissionMode: "read_only", createdAt: date, updatedAt: date };
                await new Promise((resolve, reject) => {
                    const transaction = database.transaction("app_state", "readwrite");
                    transaction.objectStore("app_state").put(JSON.stringify(conversation), `cloud-agent-conversations-v2:by-session:stress-user:${conversation.id}`);
                    transaction.oncomplete = resolve;
                    transaction.onerror = () => reject(transaction.error);
                });
                sessionStorage.setItem("cloud-agent-conversations-v2:active:user:stress-user", conversation.id);
            } finally {
                database.close();
            }
        },
        { messages, date },
    );
    await page.goto(url);
    await page.getByText("Final fixture paragraph.", { exact: true }).waitFor({ timeout: 15000 });
    const layout = await page.locator(".agent-conversation-messages").evaluate((box) => {
        const rows = [...box.children].filter((element) => element.hasAttribute("data-agent-role"));
        const prose = rows[1].querySelector(".agent-answer-prose");
        const wrappers = [...prose.querySelectorAll(":scope > [dir]")];
        const paragraphs = [...prose.querySelectorAll("p")];
        const margins = (elements) => [...elements].map((element) => parseFloat(getComputedStyle(element).marginBlockStart));
        const compatibility = (withWrapper) => {
            const source = prose.cloneNode(false);
            source.style.cssText = "position:absolute;visibility:hidden;pointer-events:none";
            const parent = withWrapper ? source.appendChild(wrappers[0].cloneNode(false)) : source;
            parent.append(...paragraphs.map((paragraph) => paragraph.cloneNode(true)));
            prose.after(source);
            const result = margins(parent.children);
            source.remove();
            return result;
        };
        return {
            roles: rows.map((row) => row.dataset.agentRole),
            rows: margins(rows),
            directions: wrappers.filter((wrapper) => wrapper.childElementCount).map((wrapper) => wrapper.dir),
            actualParagraphs: margins(paragraphs),
            bareCompatibility: compatibility(false),
            sharedDirCompatibility: compatibility(true),
        };
    });
    assert.deepEqual(layout.roles, ["user", "assistant", "user", "assistant"]);
    assert.equal(layout.rows[0], 0);
    assert(layout.rows[2] > layout.rows[1] && layout.rows[1] > 0);
    assert.deepEqual(layout.directions, ["ltr", "ltr", "rtl"]);
    assert(layout.actualParagraphs[0] === 0 && layout.actualParagraphs[1] > 0);
    assert.deepEqual(layout.bareCompatibility, layout.actualParagraphs);
    assert.deepEqual(layout.sharedDirCompatibility, layout.actualParagraphs);
    return layout;
}

async function loadCase(page, fixture, config) {
    const view = await page.locator(selector(0)).boundingBox();
    const screen = page.viewportSize();
    const visibleIndices = (delta) =>
        fixture.nodes.flatMap(({ position, width, height }, index) => {
            const x = position.x + view.x + delta;
            const y = position.y + view.y;
            return x < screen.width && x + width > 0 && y < screen.height && y + height > 0 ? [index] : [];
        });
    const waitImages = (ids, every) =>
        page.waitForFunction(
            ({ ids, every }) => {
                const ready = (id) => {
                    const img = document.querySelector(`[data-node-id="image-${id}"] img[data-image-pack-result]`);
                    return img?.complete && img.naturalWidth > 0;
                };
                return every ? ids.every(ready) : ids.some(ready);
            },
            { ids, every },
            { timeout: 60000, polling: 50 },
        );
    const initial = visibleIndices(0);
    await waitImages(initial, false);
    const firstMs = round(await pageClock(page));
    if (!config.earlyPan) await waitImages(initial, true);
    const fullMs = config.earlyPan ? null : round(await pageClock(page));
    const firstScreenRequests = fixture.records.length;
    const recordsBefore = new Set(fixture.records.map(({ id }) => id));
    const bytesBefore = new Map(fixture.records.map((rec) => [rec.id, rec.bytes]));
    const panStarted = await pageClock(page);
    await page.keyboard.down("Space");
    await page.mouse.move(1200, 650);
    await page.mouse.down();
    await page.mouse.move(130, 650, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.up("Space");
    const delta = (await page.locator("[data-canvas-world-layer]").boundingBox()).x - view.x;
    assert(delta < -950, `actual pan delta: ${delta}`);
    const current = visibleIndices(delta);
    const after = current.filter((id) => !recordsBefore.has(id) && !initial.includes(id));
    assert(after.length > 0, "pan must uncover cold images");
    await waitImages(after, false);
    const panFirst = round((await pageClock(page)) - panStarted);
    await waitImages(after, true);
    const panFull = round((await pageClock(page)) - panStarted);
    const completed = fixture.records.filter(({ end }) => end);
    const span = clock() - Math.min(...fixture.records.map(({ start }) => start));
    const bytes = fixture.records.reduce((sum, rec) => sum + rec.bytes, 0);
    const bytesPerSec = round(bytes / (span / 1000));
    if (config.slow) assert(bytesPerSec <= rate * 1.04 && span >= latency, `invalid shared network cap: ${bytesPerSec} B/s`);
    const offscreenBytesAfterPan = fixture.records.filter(({ id }) => initial.includes(id) && !current.includes(id)).reduce((sum, rec) => sum + rec.bytes - (bytesBefore.get(rec.id) || 0), 0);
    const originals = fixture.records.filter(({ variant }) => variant === "original").length;
    assert.equal(originals, 0, "a signed thumbnail must not trigger the original");
    return {
        visible: initial.length,
        firstMs,
        fullMs,
        firstScreenRequests,
        coldAfterPan: after.length,
        panFirst,
        panFull,
        offscreenBytesAfterPan,
        requests: fixture.records.length,
        completed: completed.length,
        originals,
        bytes,
        transferSpan: round(span),
        bytesPerSec,
    };
}

const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : { channel: "chrome" }) });
try {
    const images = await makeImages(browser);
    for (const name of names) {
        const config = cases[name];
        const fixture = await startFixture(images, config);
        const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, serviceWorkers: "block" });
        const errors = [];
        try {
            const page = await context.newPage();
            // URL-scoped interception disables the HTTP cache in Chromium. Block external
            // traffic with CDP instead; signed-thumbnail counting depends on normal caching.
            if (process.env.AUDIO_PROBE)
                await page.addInitScript(() => {
                    let firstInput;
                    for (const type of ["pointerdown", "keydown"])
                        window.addEventListener(
                            type,
                            () => {
                                firstInput ??= { type, t: performance.now() };
                            },
                            { once: true, capture: true },
                        );
                    window.stressAudio = [];
                    window.AudioContext = new Proxy(window.AudioContext, {
                        construct(target, args, newTarget) {
                            const start = performance.now();
                            const context = Reflect.construct(target, args, newTarget);
                            window.stressAudio.push({ firstInput, inputToCtorMs: firstInput ? Math.round(start - firstInput.t) : null, ctorMs: Math.round(performance.now() - start) });
                            return context;
                        },
                    });
                });
            const session = await context.newCDPSession(page);
            await session.send("Network.enable");
            await session.send("Network.setBlockedURLs", {
                urlPatterns: [
                    { urlPattern: `${fixture.base}/*`, block: false },
                    { urlPattern: "http://*/*", block: true },
                    { urlPattern: "https://*/*", block: true },
                    { urlPattern: "ws://*/*", block: true },
                    { urlPattern: "wss://*/*", block: true },
                ],
            });
            await session.send("Emulation.setCPUThrottlingRate", { rate: config.cpu });
            page.on("pageerror", (error) => errors.push(error.message));
            await page.goto(`${fixture.base}/canvas/bench`, { waitUntil: "domcontentloaded", timeout: 60000 });
            await page.locator(selector(0)).waitFor({ timeout: 60000 });
            if (process.env.CURSOR_UI_PROBE) {
                const cursor = await cursorUi(page);
                assert.deepEqual(errors, []);
                console.log(JSON.stringify({ name: "cursor-ui", chrome: browser.version(), cursor }));
                continue;
            }
            if (process.env.SEARCH_UI_PROBE) {
                const search = await searchUi(page);
                assert.deepEqual(errors, []);
                console.log(JSON.stringify({ name: "search-ui", chrome: browser.version(), search }));
                continue;
            }
            if (process.env.AGENT_LAYOUT_PROBE) {
                const layout = await agentLayout(page, fixture.base);
                assert.deepEqual(errors, []);
                console.log(JSON.stringify({ name: "agent-layout", chrome: browser.version(), layout }));
                continue;
            }
            const metrics = config.selected ? await dragCase(page, fixture, config, session) : await loadCase(page, fixture, config);
            assert.deepEqual(errors, []);
            const audio = process.env.AUDIO_PROBE ? await page.evaluate(() => window.stressAudio) : undefined;
            let audioAfterControl;
            if (process.env.AUDIO_PROBE && process.env.STRESS_EXPECT_OPTIMIZED) {
                assert.equal(audio.length, 0, "canvas selection and dragging must not initialize audio");
                await page.getByRole("button", { name: "打开小地图", exact: true }).click();
                await page.waitForFunction(() => window.stressAudio.length === 1);
                audioAfterControl = await page.evaluate(() => window.stressAudio);
            }
            console.log(JSON.stringify({ name, chrome: browser.version(), ...config, ...metrics, assetPuts: fixture.assetPuts, audio, audioAfterControl }));
            if (config.boundAssets) assert.equal(fixture.assetPuts, 0, "bound assets must not recreate media");
            if (process.env.MAX_DRAG_P95_MS && metrics.move) assert(metrics.move.p95 <= Number(process.env.MAX_DRAG_P95_MS), `drag P95 exceeded ${process.env.MAX_DRAG_P95_MS} ms`);
            if (process.env.MAX_PAGE_RELEASE_MS && config.selected) assert(metrics.upPaintInPage <= Number(process.env.MAX_PAGE_RELEASE_MS), `pointerup to in-page double RAF: ${metrics.upPaintInPage} ms exceeds ${process.env.MAX_PAGE_RELEASE_MS} ms`);
            if (process.env.STRESS_EXPECT_OPTIMIZED && config.selected) {
                assert.equal(metrics.singleNodePanels, 0, "a group drag must not open a single-node editor");
                if (config.scale === 1) assert(metrics.mountedAfterSelection < 2 * metrics.mountedBeforeSelection, "select-all must not mount offscreen nodes");
                if (config.cross) {
                    assert.equal(metrics.enteringMountedAfterSelection, false, "the incoming node must not mount until the gesture");
                    assert.equal(metrics.enteringEdge, true, "the newly visible connection must be painted before release");
                }
            }
        } catch (error) {
            console.error(name, { errors, imagesRequested: fixture.records.length, saved: fixture.writes.size });
            throw error;
        } finally {
            await context.close();
            await fixture.close();
        }
    }
} finally {
    await browser.close();
}
