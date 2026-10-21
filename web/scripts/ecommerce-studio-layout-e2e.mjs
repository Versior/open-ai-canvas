import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import assert from "node:assert/strict";

// Uses the existing Vite server and the real CanvasNode; no account or model calls.
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
await new Promise((resolve) => server.close(resolve));
const profile = mkdtempSync(join(tmpdir(), "ecommerce-layout-"));
const chrome = spawn(process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--window-size=1440,1100", "about:blank"], { stdio: "ignore" });
let ws;
const pending = new Map();
let id = 0;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const send = (method, params = {}) => new Promise((resolve, reject) => {
    const key = ++id;
    const timer = setTimeout(() => { pending.delete(key); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
    pending.set(key, (message) => { clearTimeout(timer); message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result); });
    ws.send(JSON.stringify({ id: key, method, params }));
});
const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
};
const click = async (selector) => {
    const point = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error('Missing control: ' + ${JSON.stringify(selector)}); el.scrollIntoView({block: 'center'}); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    await send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...point });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...point });
    await pause(350);
};
const fill = async (selector, value) => {
    await click(selector);
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 4, commands: ['selectAll'] });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 4 });
    await send('Input.insertText', { text: value });
    await pause(100);
};
try {
    let targets;
    for (let attempt = 0; attempt < 60; attempt++) {
        try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); break; } catch { await pause(200); }
    }
    assert(targets, "Chrome starts");
    ws = new WebSocket(targets.find((target) => target.type === "page").webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.addEventListener("open", resolve, { once: true }); ws.addEventListener("error", reject, { once: true }); });
    ws.addEventListener("message", (event) => { const message = JSON.parse(event.data); const callback = pending.get(message.id); if (callback) { pending.delete(message.id); callback(message); } });
    await send("Page.enable");
    await send("Runtime.enable");
    await send("Log.enable");
    ws.addEventListener("message", (event) => { const message = JSON.parse(event.data); if (message.method === "Log.entryAdded") console.error(JSON.stringify(message.params.entry)); if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") console.error(JSON.stringify(message.params.args)); });
    await send("Network.enable");
    const inflight = new Map();
    ws.addEventListener("message", (event) => { const message = JSON.parse(event.data); if (message.method === "Network.requestWillBeSent") inflight.set(message.params.requestId, message.params.request.url); if (["Network.loadingFinished", "Network.loadingFailed"].includes(message.method)) inflight.delete(message.params.requestId); if (message.method === "Network.loadingFailed") console.error(JSON.stringify(message.params)); });
    ws.addEventListener("message", (event) => { const message = JSON.parse(event.data); if (message.method === "Runtime.exceptionThrown") console.error(JSON.stringify(message.params.exceptionDetails)); });
    // Bound fixture requests to anonymous, read-only catalog responses.
    await send("Fetch.enable", { patterns: [{ urlPattern: "http://localhost:3000/api/*" }] });
    ws.addEventListener("message", async (event) => {
        const message = JSON.parse(event.data);
        if (message.method !== "Fetch.requestPaused") return;
        const { requestId, request } = message.params;
        const data = request.url.includes("skills") ? { skills: [], revision: 0 } : {};
        await send("Fetch.fulfillRequest", { requestId, responseCode: 200, responseHeaders: [{ name: "Content-Type", value: "application/json" }], body: Buffer.from(JSON.stringify({ code: 0, data, msg: "" })).toString("base64") });
    });
    if (process.env.PARAMETER_CHECK) {
        for (const theme of ['light', 'dark']) for (const scale of [1, 0.65, 0.35]) {
            await send('Page.navigate', { url: `http://localhost:3000/test/fixtures/ecommerce-studio-layout.html?theme=${theme}&width=540&scale=${scale}&scenario=parameters` });
            let ready = false;
            for (let attempt = 0; attempt < 150; attempt++) { ready = await evaluate("!!document.querySelector('.ecommerce-studio-generation-settings summary')"); if (ready) break; await pause(100); }
            assert(ready, 'Actual studio shared settings mounted');
            await click('.ecommerce-studio-generation-settings summary');
            assert(await evaluate("!!document.querySelector('.ecommerce-image-settings .image-size-ratios button[aria-pressed=true]')"), 'Saved ratio visibly selected');
            await click('.ecommerce-image-settings .image-size-picker > .image-size-tiers button:nth-child(2)');
            await pause(100);
            await click('.ecommerce-image-settings .image-size-ratios button[title^="3:4"]');
            await click('.ecommerce-image-settings [aria-label=质量] button:last-child');
            await pause(100);
            assert.equal(await evaluate("JSON.parse(document.querySelector('[data-studio-brief]').dataset.studioBrief).imageSettings.size"), '1728x2304');
            assert.equal(await evaluate("JSON.parse(document.querySelector('[data-studio-brief]').dataset.studioBrief).imageSettings.quality"), 'high');
            assert(await evaluate("[...document.querySelectorAll('.ecommerce-image-settings button')].some(el => el.textContent === 'high' && el.getAttribute('aria-pressed') === 'true')"), 'Quality visibly selected');
            await evaluate("[...document.querySelectorAll('.ecommerce-studio-nav button')].find(el => el.textContent === '画面方案').click()");
            await pause(100);
            assert.equal(await evaluate("JSON.parse(document.querySelector('[data-studio-brief]').dataset.studioBrief).imageSettings.size"), '1728x2304', 'Settings retained across sections');
            assert(await evaluate("(() => { const el=document.querySelector('.ecommerce-studio-node'); return el.scrollWidth <= el.clientWidth + 1; })()"), 'Shared settings do not overflow');
            assert.equal(await evaluate("Number(document.querySelector('[data-node-interactions]').dataset.nodeInteractions)"), 0, 'Settings do not start canvas dragging');
            if (theme === 'light' && scale === 1) { const shot = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync('/tmp/ecommerce-shared-settings.png', Buffer.from(shot.data, 'base64')); }
            console.log(JSON.stringify({theme, scale, parameters:'pass'}));
        }
    } else if (process.env.EXECUTION_CHECK) {
        for (const theme of ['light', 'dark']) for (const scale of [1, 0.65, 0.35]) {
            await send('Page.navigate', { url: `http://localhost:3000/test/fixtures/ecommerce-studio-layout.html?theme=${theme}&width=540&scale=${scale}&scenario=running` });
            let ready = false;
            for (let attempt = 0; attempt < 150; attempt++) { ready = await evaluate("!!document.querySelector('.ecommerce-studio-execution')"); if (ready) break; await pause(100); }
            assert(ready, 'Execution status is visible in actual CanvasNode');
            assert(await evaluate("document.querySelector('.ecommerce-studio-execution').textContent.includes('正在分析商品与规划画面')"));
            assert(await evaluate("!document.querySelector('[aria-label=生成中]')"), 'Generic badge no longer overlaps title');
            assert(await evaluate("(() => { const root = document.querySelector('.ecommerce-studio-node'); const status = root.querySelector('.ecommerce-studio-execution').getBoundingClientRect(); const box = root.getBoundingClientRect(); return status.top >= box.top && status.bottom < box.bottom && root.clientWidth >= root.scrollWidth; })()"), 'Execution status fits at every canvas scale');
            if (theme === 'light' && scale === 1) { const shot = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync('/tmp/ecommerce-execution-fixed.png', Buffer.from(shot.data, 'base64')); }
            await click('.ecommerce-studio-execution button');
            assert.equal(await evaluate("document.querySelector('[data-running]').dataset.running"), 'false', 'Stop dispatches from fixed header');
            await evaluate("[...document.querySelectorAll('.ecommerce-studio-nav button')].find(el => el.textContent === '图片结果').click()");
            await pause(150);
            assert.equal(await evaluate("document.querySelectorAll('.ecommerce-studio-candidate').length"), 2);
            await click('.ecommerce-studio-candidate .ant-checkbox-wrapper');
            assert.equal(await evaluate("document.querySelectorAll('.ecommerce-studio-candidate[data-selected=true]').length"), 1);
            await click('.ecommerce-studio-candidates .ecommerce-command');
            assert.deepEqual(await evaluate("JSON.parse(document.querySelector('[data-last-request]').dataset.lastRequest).resultIds"), ['red']);
            await evaluate("[...document.querySelectorAll('.ecommerce-studio-candidates button')].find(el => el.textContent.startsWith('全部添加到画布')).click()");
            await pause(100);
            assert.deepEqual(await evaluate("JSON.parse(document.querySelector('[data-last-request]').dataset.lastRequest).resultIds"), ['red', 'blue']);
            await click('.ecommerce-studio-candidates .ecommerce-studio-execution-heading .ant-checkbox-wrapper');
            await click('.ecommerce-studio-candidates details summary');
            await evaluate("[...document.querySelectorAll('.ecommerce-studio-candidates button')].find(el => el.textContent.startsWith('合成所选图片')).click()");
            await pause(100);
            assert.equal(await evaluate("JSON.parse(document.querySelector('[data-last-request]').dataset.lastRequest).action"), 'studio-compose');
            assert(await evaluate("(() => { const el = document.querySelector('.ecommerce-studio-node'); return el.scrollWidth <= el.clientWidth + 1; })()"), 'Candidates and composition have no horizontal overflow');
            const raster = await evaluate(`(async () => {
                const { rasterizeEcommerceLongImage } = await import('/src/lib/ecommerce/ecommerce-rasterize.ts');
                const urls = ['red', 'blue'].map(color => { const canvas = document.createElement('canvas'); canvas.width = 100; canvas.height = 100; const context = canvas.getContext('2d'); context.fillStyle = color; context.fillRect(0,0,100,100); return canvas.toDataURL(); });
                const output = await rasterizeEcommerceLongImage({ imageUrls: urls, width: 400, gap: 16 });
                const image = new Image(); image.src = output.dataUrl; await image.decode();
                const canvas = document.createElement('canvas'); canvas.width=400; canvas.height=816; const ctx=canvas.getContext('2d'); ctx.drawImage(image,0,0);
                return {width:output.width,height:output.height,top:[...ctx.getImageData(10,10,1,1).data],bottom:[...ctx.getImageData(10,810,1,1).data]};
            })()`);
            assert.deepEqual(raster, {width:400,height:816,top:[255,0,0,255],bottom:[0,0,255,255]}, 'Real Canvas compositor preserves order, gap and pixels');
            console.log(JSON.stringify({theme,scale,execution:'pass',selection:'pass',raster:'pass'}));
        }
    } else for (const mode of ["light", "dark"]) for (const width of [540, 800]) for (const scale of [1, 0.65, 0.35]) {
        await send("Page.navigate", { url: `http://localhost:3000/test/fixtures/ecommerce-studio-layout.html?theme=${mode}&width=${width}&scale=${scale}` });
        let ready = false;
        for (let attempt = 0; attempt < 150; attempt++) { ready = await evaluate("!!document.querySelector('.ecommerce-studio-node .ant-input')"); if (ready) break; await pause(100); }
        if (!ready) { console.error(await evaluate("JSON.stringify({url: location.href, html: document.documentElement.outerHTML.slice(0,2000)})")); console.error([...inflight.values()]); }
        assert(ready, "Actual studio component mounted");
        const metrics = await evaluate(`(() => {
            const node = document.querySelector('[data-node-id]');
            const content = document.querySelector('.ecommerce-studio-node');
            const input = content.querySelector('.ant-input');
            return { nodeWidth: node.getBoundingClientRect().width, contentWidth: content.getBoundingClientRect().width, inputWidth: input.getBoundingClientRect().width, clientWidth: content.clientWidth, scrollWidth: content.scrollWidth, clientHeight: content.clientHeight, scrollHeight: content.scrollHeight };
        })()`);
        console.log(JSON.stringify({ mode, width, scale, ...metrics }));
        if (process.env.LAYOUT_SCREENSHOT && mode === "light" && width === 540 && scale === 1) {
            const shot = await send("Page.captureScreenshot", { format: "png" });
            writeFileSync(process.env.LAYOUT_SCREENSHOT, Buffer.from(shot.data, "base64"));
        }
        assert(metrics.contentWidth >= metrics.nodeWidth * 0.95, "Studio must fill node width, not collapse in centered flex parent");
        assert(metrics.inputWidth > metrics.nodeWidth * 0.6, "Product name input remains usable");
        assert(metrics.scrollWidth <= metrics.clientWidth + 1, "No horizontal scrollbar");
        {
            await click('.ecommerce-studio-essentials input[role=combobox]');
            const popupMetrics = await evaluate(`(() => {
                const trigger = document.querySelector('.ecommerce-studio-essentials .ant-select').getBoundingClientRect();
                const popup = document.querySelector('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').getBoundingClientRect();
                const input = document.querySelector('.ecommerce-studio-essentials input[role=combobox]');
                const option = document.querySelector('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option');
                const inputScale = input.getBoundingClientRect().height / input.offsetHeight;
                const optionScale = option.getBoundingClientRect().height / option.offsetHeight;
                return { trigger: { x: trigger.x, y: trigger.y, width: trigger.width, bottom: trigger.bottom }, popup: { x: popup.x, y: popup.y, width: popup.width }, inputScale, optionScale };
            })()`);
            console.log(JSON.stringify({ popupMetrics }));
            assert(Math.abs(popupMetrics.popup.x - popupMetrics.trigger.x) < 2, 'Menu left edge aligns with the scaled input');
            assert(Math.abs(popupMetrics.popup.y - popupMetrics.trigger.bottom) < 16, 'Menu opens next to input without a scaled positioning gap');
            assert(Math.abs(popupMetrics.inputScale - popupMetrics.optionScale) < 0.02, 'Menu text and option rows follow the input canvas scale');
            assert(Math.abs(popupMetrics.popup.width - popupMetrics.trigger.width) < 2, 'Menu width matches the scaled input');
            const options = await evaluate("[...document.querySelectorAll('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option')].map(el => el.textContent)");
            console.log(JSON.stringify({ options }));
            assert(options.length > 1, 'Clicking the existing platform must offer alternative platforms without clearing it first');
            await fill('.ecommerce-studio-essentials input[role=combobox]', 'Shopee');
            assert(await evaluate("!!document.querySelector('.ant-select-dropdown:not(.ant-select-dropdown-hidden) [title=Shopee]')"), 'Search finds additional platform presets');
            await click('.ant-select-dropdown:not(.ant-select-dropdown-hidden) [title=Shopee]');
            await click('.ecommerce-studio-essentials input[aria-label=生图台计划张数]');
            assert(await evaluate(`(() => { const el = document.querySelector('.ecommerce-studio-essentials input[role=combobox]'); const s = getComputedStyle(el); return el.value === 'Shopee' && s.color !== 'transparent' && !s.color.endsWith(', 0)') && s.visibility === 'visible' && Number(s.opacity) > 0; })()`), 'Selected platform text must be visibly painted after blur');
            assert.equal(await evaluate("Number(document.querySelector('[data-node-interactions]').dataset.nodeInteractions)"), 0, 'Choosing a portal option must not start node dragging');
            await fill('.ecommerce-studio-essentials input[role=combobox]', 'Lazada');
            for (const key of ['ArrowDown', 'Enter']) {
                await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: key === 'Enter' ? 13 : 40 });
                await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: key === 'Enter' ? 13 : 40 });
            }
            await pause(150);
            assert.equal(await evaluate("document.querySelector('.ecommerce-studio-essentials input[role=combobox]').value"), 'Lazada', 'Keyboard selection persists');
            await click('.ecommerce-studio-essentials label:first-child .ant-select-suffix');
            assert.equal(await evaluate("document.querySelector('.ecommerce-studio-essentials input').getAttribute('aria-expanded')"), 'true', 'Arrow opens menu');
            await evaluate("document.querySelector('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .rc-virtual-list-holder').scrollTop = 0");
            await pause(100);
            assert(await evaluate("!!document.querySelector('.ant-select-dropdown:not(.ant-select-dropdown-hidden) [title=京东]')"), 'Arrow reopens all choices after a selection');
            await click('.ant-select-dropdown:not(.ant-select-dropdown-hidden) [title=京东]');
            assert.equal(await evaluate("document.querySelector('.ecommerce-studio-essentials input[role=combobox]').value"), '京东', 'Selected platform persists');
            await click('.ecommerce-studio-essentials label:first-child .ant-select-suffix');
            await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 1300, y: 900, deltaX: 0, deltaY: 120, modifiers: 2 });
            await pause(400);
            await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 1300, y: 900, deltaX: 20, deltaY: 10 });
            await pause(400);
            console.log(await evaluate(`(() => { const a = document.querySelector('.ecommerce-studio-essentials .ant-select').getBoundingClientRect(); const b = document.querySelector('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').getBoundingClientRect(); return JSON.stringify({ liveTrigger: a.toJSON(), livePopup: b.toJSON() }); })()`));
            assert(await evaluate(`(() => {
                const trigger = document.querySelector('.ecommerce-studio-essentials .ant-select').getBoundingClientRect();
                const popup = document.querySelector('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').getBoundingClientRect();
                return Math.abs(trigger.x - popup.x) < 2 && Math.abs(trigger.bottom - popup.y) < 16 && Math.abs(trigger.width - popup.width) < 2;
            })()`), 'Open menu follows live zoom and pan');
            await evaluate("document.querySelector('.ecommerce-studio-body').scrollTop = 30");
            await pause(200);
            assert(await evaluate(`(() => {
                const trigger = document.querySelector('.ecommerce-studio-essentials .ant-select').getBoundingClientRect();
                const popup = document.querySelector('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').getBoundingClientRect();
                return Math.abs(trigger.x - popup.x) < 2 && Math.abs(trigger.bottom - popup.y) < 16;
            })()`), 'Open menu follows node content scrolling');
            await click('.ant-select-dropdown:not(.ant-select-dropdown-hidden) [title=淘宝]');
            assert.equal(await evaluate("document.querySelector('.ecommerce-studio-essentials input[role=combobox]').value"), '淘宝', 'Option remains clickable after zoom, pan and scrolling');
            await click('.ecommerce-studio-essentials label:first-child .ant-select-suffix');
            await click('.ant-select-dropdown:not(.ant-select-dropdown-hidden) button[aria-label=自定义平台]');
            assert(await evaluate("document.activeElement === document.querySelector('.ecommerce-studio-essentials input[role=combobox]')"), 'Custom platform action focuses the editable field');
            await send('Input.insertText', { text: '品牌自营商城' });
            await click('.ecommerce-studio-essentials input[aria-label=生图台计划张数]');
            assert.equal(await evaluate("document.querySelector('.ecommerce-studio-essentials input[role=combobox]').value"), '品牌自营商城', 'Custom platform persists after blur');
            assert(await evaluate("getComputedStyle(document.querySelector('.ecommerce-studio-essentials input[role=combobox]')).color !== 'rgba(0, 0, 0, 0)'"), 'Custom platform text is visibly painted');
            await click('.ecommerce-studio-essentials input[role=combobox]');
            assert(await evaluate("!!document.querySelector('.ant-select-dropdown:not(.ant-select-dropdown-hidden) [title=京东]')"), 'Custom value does not hide presets on reopening');
            await click('.ecommerce-studio-essentials label:nth-child(2) input[role=combobox]');
            await click('.ant-select-dropdown:not(.ant-select-dropdown-hidden) [title="4:5"]');
            assert.equal(await evaluate("document.querySelector('.ecommerce-studio-essentials label:nth-child(2) input').value"), '4:5', 'Portrait ratio can be selected');
            assert(await evaluate("getComputedStyle(document.querySelector('.ecommerce-studio-essentials label:nth-child(2) input')).color !== 'rgba(0, 0, 0, 0)'"), 'Selected ratio text is visibly painted');
            await click('.ecommerce-studio-essentials label:nth-child(2) .ant-select-suffix');
            await click('.ant-select-dropdown:not(.ant-select-dropdown-hidden) button[aria-label=自定义图片画幅]');
            await send('Input.insertText', { text: '7:5' });
            await fill('.ecommerce-studio-essentials input[aria-label=生图台计划张数]', '9');
            assert.equal(await evaluate("Number(document.querySelector('[data-node-interactions]').dataset.nodeInteractions)"), 0, 'Editing controls never starts node dragging');
            await click('.ecommerce-studio-header');
            assert.equal(await evaluate("Number(document.querySelector('[data-node-interactions]').dataset.nodeInteractions)"), 1, 'Node header still starts ordinary node interaction');
            assert.equal(await evaluate("document.querySelector('.ecommerce-studio-essentials label:nth-child(2) input').value"), '7:5', 'Custom ratio persists');
            assert.equal(await evaluate("document.querySelector('.ecommerce-studio-essentials input[aria-label=生图台计划张数]').value"), '9', 'Count can be edited');
            assert(await evaluate("document.querySelector('.ecommerce-studio-footer').textContent.includes('规划并生成图片 · 9 张')"), 'Generation action uses edited count');
            if (process.env.CHOICE_VISUAL && mode === 'light' && width === 540 && scale === 1) {
                const shot = await send('Page.captureScreenshot', { format: 'png' });
                writeFileSync(process.env.CHOICE_VISUAL, Buffer.from(shot.data, 'base64'));
            }
            if (process.env.CHOICE_CHECK === 'only') continue;
        }
        for (const section of ["画面方案", "图片结果", "电商工具", "商品信息"]) {
            await evaluate(`Array.from(document.querySelectorAll('.ecommerce-studio-nav button')).find(button => button.textContent === ${JSON.stringify(section)}).click()`);
            await pause(80);
            const overflow = await evaluate("(() => { const el = document.querySelector('.ecommerce-studio-node'); return el.scrollWidth - el.clientWidth; })()");
            assert(overflow <= 1, `${section}: no horizontal overflow`);
        }
        await evaluate("document.querySelectorAll('.ecommerce-studio-node details').forEach(el => { el.open = true; })");
        await pause(100);
        assert(await evaluate("(() => { const el = document.querySelector('.ecommerce-studio-node'); return el.scrollWidth <= el.clientWidth + 1; })()"), "Expanded settings do not overflow");
        const scrolled = await evaluate("(() => { const el = document.querySelector('.ecommerce-studio-body'); el.scrollTop = 200; return el.scrollTop; })()");
        assert(scrolled > 0, "Long brief scrolls inside node");
        assert(await evaluate("(() => { const root = document.querySelector('.ecommerce-studio-node').getBoundingClientRect(); const footer = document.querySelector('.ecommerce-studio-footer').getBoundingClientRect(); const nav = document.querySelector('.ecommerce-studio-nav').getBoundingClientRect(); return nav.top >= root.top && footer.bottom <= root.bottom + 1; })()"), "Navigation and current actions stay visible while content scrolls");
        await evaluate("Array.from(document.querySelectorAll('.ecommerce-studio-nav button')).find(button => button.textContent === '电商工具').click()");
        await pause(100);
        const commands = ["AI 规划方案", "反推套图与视觉锁", "生成多姿态参考", "从商品图提取花型", "根据事实与图片生成 Listing", "生成 300DPI 规格包", "验缝 → 规格包 → Listing", "导出 PNG 图层、PSD 与 ZIP"];
        const tools = ["智能规划", "套图工坊", "模特选角", "花型工坊", "Listing 文案", "印刷规格包", "成包流水线", "分层交付"];
        for (let index = 0; index < commands.length; index++) {
            const point = await evaluate(`(() => { const button = [...document.querySelectorAll('.ecommerce-studio-tools button')].find(el => el.querySelector('strong').textContent === ${JSON.stringify(tools[index])}); button.scrollIntoView({block: 'center'}); const r = button.getBoundingClientRect(); return {x: r.x + r.width / 2, y: r.y + r.height / 2}; })()`);
            await send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...point });
            await send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...point });
            await pause(450);
            assert(await evaluate(`(() => { const panel = document.querySelector('.ant-drawer-open'); return !!panel && [...panel.querySelectorAll('button')].some(button => button.textContent === ${JSON.stringify(commands[index])}); })()`), `Tool ${index + 1}: visible drawer contains correct command`);
            await evaluate("document.querySelector('.ant-drawer-open .ant-drawer-close').click()");
            await pause(450);
        }
    }
    console.log(process.env.PARAMETER_CHECK ? 'PASS: real CanvasNode shared size and quality selection, retention and drag isolation across 6 theme/scale combinations' : process.env.EXECUTION_CHECK ? 'PASS: real CanvasNode execution status, stop, subset/all selection and actual long-image raster across 6 theme/scale combinations' : process.env.CHOICE_CHECK === 'only' ? 'PASS: real CanvasNode platform selection, custom platform/ratio, reopening, count editing across themes and scales' : 'PASS: real CanvasNode choices, layout, tool opens, matching commands, close/reopen, themes and scales');
} finally {
    ws?.close();
    chrome.kill();
    await new Promise((resolve) => chrome.exitCode === null ? chrome.once("exit", resolve) : resolve());
    rmSync(profile, { recursive: true, force: true });
}
