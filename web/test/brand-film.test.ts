import { afterAll, afterEach, expect, test } from "bun:test";
import { Window } from "happy-dom";

const dom = new Window({ url: "https://stage.example.com/" });
const globals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({ window: dom, document: dom.document, navigator: dom.navigator, HTMLElement: dom.HTMLElement, Element: dom.Element, Node: dom.Node, Event: dom.Event, IS_REACT_ACT_ENVIRONMENT: true })) {
    globals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}

const { act, createElement } = await import("react");
const { createRoot } = await import("react-dom/client");
const { createInstance } = await import("i18next");
const { I18nextProvider } = await import("react-i18next");
const language = createInstance();
await language.init({ lng: "en", resources: { en: { translation: { auth: { videoLoadFailed: "Video failed to load", playVideo: "Play video", brandFilm: "Brand film" }, common: { retry: "Retry" } } } } });
const { BrandFilm } = await import("@/components/brand/brand-film");
const { DEFAULT_PUBLIC_APPEARANCE, useAppearanceStore } = await import("@/stores/use-appearance-store");
let root: ReturnType<typeof createRoot> | undefined;
let host: HTMLDivElement | undefined;

afterEach(async () => {
    await act(async () => root?.unmount());
    host?.remove();
    root = undefined;
    useAppearanceStore.setState({ appearance: DEFAULT_PUBLIC_APPEARANCE });
});
afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, value] of globals) {
        if (value) Object.defineProperty(globalThis, key, value);
        else Reflect.deleteProperty(globalThis, key);
    }
});

test("an early media error survives mount effects and retry reloads the same source", async () => {
    // A fast 404 can set video.error before React's mount effect, without another error event.
    const prototype = dom.HTMLMediaElement.prototype;
    const originals = new Map(["error", "play", "pause", "load"].map((name) => [name, Object.getOwnPropertyDescriptor(prototype, name)]));
    let mediaFailed = true;
    let reloads = 0;
    Object.defineProperties(prototype, {
        error: { configurable: true, get: () => (mediaFailed ? { code: 4 } : null) },
        play: {
            configurable: true,
            value() {
                this.dispatchEvent(new dom.Event("play"));
                return Promise.resolve();
            },
        },
        pause: { configurable: true, value() {} },
        load: {
            configurable: true,
            value() {
                reloads++;
                mediaFailed = false;
            },
        },
    });
    try {
        useAppearanceStore.setState({ appearance: { ...DEFAULT_PUBLIC_APPEARANCE, authVideoUrl: "/brand-video.mp4", authVideoAutoplay: false } });
        host = document.createElement("div");
        document.body.append(host);
        root = createRoot(host);
        await act(async () => root!.render(createElement(I18nextProvider, { i18n: language }, createElement(BrandFilm))));
        expect(host.querySelector('[role="alert"]')).not.toBeNull();
        expect(host.querySelector("video")?.getAttribute("src")).toBe("/brand-video.mp4");
        await act(async () => host!.querySelector<HTMLButtonElement>("button")!.click());
        expect(reloads).toBe(1);
        expect(host.querySelector('[role="alert"]')).toBeNull();
        expect(host.querySelector("video")?.getAttribute("src")).toBe("/brand-video.mp4");
    } finally {
        for (const [name, descriptor] of originals) {
            if (descriptor) Object.defineProperty(prototype, name, descriptor);
            else Reflect.deleteProperty(prototype, name);
        }
    }
});
