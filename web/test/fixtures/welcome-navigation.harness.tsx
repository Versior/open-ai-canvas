import { afterAll, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";

const dom = new Window({ url: "http://localhost/welcome" });
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
mock.module("@/pages/welcome/story-reel", () => ({ default: ({ progress }: { progress: { current: number } }) => <canvas className="welcome-webgl" data-progress={progress.current} /> }));
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { default: WelcomePage } = await import("@/pages/welcome");
afterAll(() => dom.happyDOM.abort());

test("欢迎页在固定应用外壳里使用自己的滚动容器，箭头与章节导航均可切换", async () => {
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;inset:0;overflow:hidden;height:100%";
    document.body.append(host);
    const root = createRoot(host);
    try {
        await act(async () => root.render(<WelcomePage />));
        const page = host.querySelector<HTMLElement>(".welcome-page")!;
        const story = host.querySelector<HTMLElement>(".welcome-story")!;
        let calls = 0;
        page.scrollTo = (options: ScrollToOptions | number) => {
            calls++;
            page.scrollTop = typeof options === "number" ? options : options.top || 0;
            page.dispatchEvent(new Event("scroll"));
        };
        story.getBoundingClientRect = () => ({ top: -page.scrollTop, height: 5700 }) as DOMRect;
        Object.defineProperty(story, "offsetHeight", { value: 5700 });
        await act(async () => host.querySelector<HTMLButtonElement>(".welcome-next")!.click());
        expect(calls, "下一幕必须滚动欢迎页，不能滚动被锁住的 window").toBe(1);
        expect(host.querySelector(".welcome-stage")!.classList.contains("chapter-1")).toBe(true);
        expect(host.querySelector(".welcome-webgl")).not.toBeNull();
        for (const index of [4, 2, 5, 0]) {
            await act(async () => host.querySelectorAll<HTMLButtonElement>(".welcome-chapter-nav button")[index].click());
            expect(host.querySelector(".welcome-stage")!.classList.contains(`chapter-${index}`)).toBe(true);
            expect(host.querySelectorAll(".welcome-chapter-nav [aria-current='step']")).toHaveLength(1);
            if (index > 0) expect(Math.floor(Number(host.querySelector(".welcome-webgl")!.getAttribute("data-progress")) * 6)).toBe(index);
        }
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
});
