import { afterAll, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";

const dom = new Window({ url: "http://localhost/welcome" });
let hidden = false;
let reduced = false;
const motionListeners = new Set<() => void>();
Object.defineProperty(dom.document, "hidden", { get: () => hidden });
const matchMedia = dom.matchMedia.bind(dom);
dom.matchMedia = ((query: string) =>
    query === "(prefers-reduced-motion: reduce)"
        ? {
              get matches() {
                  return reduced;
              },
              addEventListener: (_: string, listener: () => void) => motionListeners.add(listener),
              removeEventListener: (_: string, listener: () => void) => motionListeners.delete(listener),
          }
        : matchMedia(query)) as typeof dom.matchMedia;
const interval = dom.setInterval.bind(dom);
const clearInterval = dom.clearInterval.bind(dom);
const cycleTimers = new Map<number, () => void>();
let timerId = 10000;
dom.setInterval = ((callback: () => void, delay: number, ...args: unknown[]) => {
    if (delay !== 12_000) return interval(callback, delay, ...args);
    const id = timerId++;
    cycleTimers.set(id, callback);
    return id;
}) as typeof dom.setInterval;
dom.clearInterval = ((id: number) => {
    if (!cycleTimers.delete(id)) clearInterval(id);
}) as typeof dom.clearInterval;
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    Element: dom.Element,
    Node: dom.Node,
    SVGElement: dom.SVGElement,
    ShadowRoot: dom.ShadowRoot,
    Event: dom.Event,
    MutationObserver: dom.MutationObserver,
    ResizeObserver: dom.ResizeObserver,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
}))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
mock.module("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
mock.module("@/components/brand/brand-film", () => ({ BrandFilm: () => null }));
let sceneReady: () => void;
let sceneError: () => void;
mock.module("@/pages/welcome/story-reel", () => ({
    default: ({ look, progress, paused, onReady, onError }: { look: { id: string }; progress: { current: number }; paused: boolean; onReady: () => void; onError: () => void }) => {
        sceneReady = onReady;
        sceneError = onError;
        return <canvas className="welcome-webgl" data-look={look.id} data-progress={progress.current} data-paused={paused} />;
    },
}));
const { act, StrictMode } = await import("react");
const { createRoot } = await import("react-dom/client");
const { default: WelcomePage } = await import("@/pages/welcome");
afterAll(() => dom.happyDOM.abort());

test("欢迎页滚动切换章节，隐藏导航装饰，随机轮换并遵循动画偏好", async () => {
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;inset:0;overflow:hidden;height:100%";
    document.body.append(host);
    const root = createRoot(host);
    try {
        await act(async () =>
            root.render(
                <StrictMode>
                    <WelcomePage />
                </StrictMode>,
            ),
        );
        const page = host.querySelector<HTMLElement>(".welcome-page")!;
        const story = host.querySelector<HTMLElement>(".welcome-story")!;
        expect(host.querySelectorAll('.welcome-header a[href="/create"]').length, "顶部不重复展示开始创作入口").toBe(0);
        const heroActions = host.querySelectorAll<HTMLAnchorElement>(".welcome-hero-actions a");
        expect(heroActions.length, "首屏保留一个居中主入口").toBe(1);
        expect(heroActions[0].getAttribute("href")).toBe("/create");
        expect(heroActions[0].tabIndex).toBe(0);
        let calls = 0;
        page.scrollTo = (options: ScrollToOptions | number) => {
            calls++;
            page.scrollTop = typeof options === "number" ? options : options.top || 0;
            page.dispatchEvent(new Event("scroll"));
        };
        story.getBoundingClientRect = () => ({ top: -page.scrollTop, height: 5700 }) as DOMRect;
        Object.defineProperty(story, "offsetHeight", { value: 5700 });
        expect(cycleTimers.size, "品牌首幕不轮换演示素材").toBe(0);
        expect(host.querySelector(".welcome-webgl"), "静止首幕不初始化圆环").toBeNull();
        const scrollChapter = (index: number) => page.scrollTo({ top: (5700 - window.innerHeight) * (index / 6 + (index ? 0.04 : 0)) });
        await act(async () => page.scrollTo({ top: (5700 - window.innerHeight) / 10 }));
        expect(host.querySelector(".welcome-stage")!.classList.contains("chapter-0")).toBe(true);
        expect(host.querySelector(".welcome-webgl"), "接近下一幕时提前准备圆环").not.toBeNull();
        expect(host.querySelector(".welcome-webgl")!.getAttribute("data-paused")).toBe("true");
        await act(async () => scrollChapter(1));
        expect(calls).toBe(2);
        expect(host.querySelector(".welcome-stage")!.classList.contains("chapter-1")).toBe(true);
        expect(host.querySelector(".welcome-webgl")).not.toBeNull();
        expect(host.querySelector(".welcome-poster"), "圆环尚未就绪时也不闪现单张全屏素材").toBeNull();
        await act(async () => sceneReady());
        expect(host.querySelector(".welcome-reel")!.classList.contains("is-ready")).toBe(true);
        expect(host.querySelector(".welcome-look-picker")).toBeNull();
        expect(host.querySelector("#welcome-look-select")).toBeNull();
        expect(host.querySelector(".welcome-next")).toBeNull();
        expect(host.querySelector(".welcome-chapter-nav")).toBeNull();
        expect(host.querySelector(".welcome-look-credit")).toBeNull();
        expect(host.querySelector(".welcome-media-credit")).toBeNull();
        expect(host.querySelector(".welcome-hero-actions a")!.getAttribute("href")).toBe("/create");
        expect(cycleTimers.size).toBe(1);
        const lookId = () => host.querySelector(".welcome-webgl")!.getAttribute("data-look")!;
        const looks = new Set([lookId()]);
        for (let tick = 0; tick < 2; tick++) {
            const previous = lookId();
            await act(async () => [...cycleTimers.values()].forEach((callback) => callback()));
            expect(lookId()).not.toBe(previous);
            expect(host.querySelector(".welcome-poster")).toBeNull();
            expect(host.querySelector(".welcome-reel")!.classList.contains("is-ready")).toBe(false);
            await act(async () => sceneReady());
            looks.add(lookId());
        }
        expect(looks.size).toBe(3);
        await act(async () => {
            hidden = true;
            document.dispatchEvent(new Event("visibilitychange"));
        });
        expect(cycleTimers.size, "后台页面暂停轮换和演示动画").toBe(0);
        expect(host.querySelector(".welcome-webgl")!.getAttribute("data-paused")).toBe("true");
        await act(async () => {
            hidden = false;
            document.dispatchEvent(new Event("visibilitychange"));
        });
        expect(cycleTimers.size).toBe(1);
        await act(async () => {
            reduced = true;
            motionListeners.forEach((callback) => callback());
        });
        expect(cycleTimers.size, "减少动画偏好停止自动轮换").toBe(0);
        expect(host.querySelector(".welcome-webgl")).toBeNull();
        expect(host.querySelector(".welcome-poster img"), "减少动画保留静态降级").not.toBeNull();
        await act(async () => {
            reduced = false;
            motionListeners.forEach((callback) => callback());
        });
        expect(cycleTimers.size).toBe(1);
        await act(async () => page.scrollTo({ top: 5700 }));
        expect(cycleTimers.size, "离开演示区域后暂停轮换").toBe(0);
        for (const index of [4, 2, 5, 0]) {
            await act(async () => scrollChapter(index));
            expect(host.querySelector(".welcome-stage")!.classList.contains(`chapter-${index}`)).toBe(true);
            if (index > 0) expect(Math.floor(Number(host.querySelector(".welcome-webgl")!.getAttribute("data-progress")) * 6)).toBe(index);
        }
        expect(host.querySelector(".welcome-reel")!.classList.contains("is-ready"), "回首幕不丢弃已准备的圆环").toBe(true);
        await act(async () => scrollChapter(1));
        await act(async () => sceneError());
        expect(host.querySelector(".welcome-webgl")).toBeNull();
        expect(host.querySelector(".welcome-poster img"), "场景失败保留静态降级").not.toBeNull();
    } finally {
        await act(async () => root.unmount());
        expect(cycleTimers.size).toBe(0);
        host.remove();
    }
});
