import { afterAll, afterEach, expect, test } from "bun:test";
import { Window } from "happy-dom";

const source = (path: string) => Bun.file(new URL(`../src/${path}`, import.meta.url)).text();

const dom = new Window({ url: "https://stage.example.com/" });
const globals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    location: dom.location,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    Element: dom.Element,
    Node: dom.Node,
    SVGElement: dom.SVGElement,
    Event: dom.Event,
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    globals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}

const { act, createElement } = await import("react");
const { createRoot } = await import("react-dom/client");
const { BrandLogo, BrandWordmark } = await import("@/components/brand/brand-logo");
const { DEFAULT_PUBLIC_APPEARANCE, useAppearanceStore } = await import("@/stores/use-appearance-store");
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot> | undefined;

async function render(element: React.ReactNode) {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root!.render(element));
}

afterEach(async () => {
    await act(async () => root?.unmount());
    root = undefined;
    host?.remove();
    useAppearanceStore.setState({ appearance: DEFAULT_PUBLIC_APPEARANCE });
});

afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, value] of globals) {
        if (value) Object.defineProperty(globalThis, key, value);
        else Reflect.deleteProperty(globalThis, key);
    }
});

test("built-in STAGE branding uses shared cue tokens in every application bundle", async () => {
    const [brand, globals, welcome, tokens] = await Promise.all([source("components/brand/brand-logo.tsx"), source("styles/globals.css"), source("pages/welcome/welcome.css"), source("styles/brand-tokens.css")]);

    expect(globals).toContain('@import "./brand-tokens.css"');
    expect(welcome).toContain('@import "../../styles/brand-tokens.css"');
    expect(tokens).toContain("--brand-cue: var(--palette-brand-cue)");
    expect(brand).toContain('backgroundColor: "var(--brand-cue)"');
    expect(brand).not.toContain("#ef4b2f");
});

test("built-in mark stays unframed while custom appearance branding is preserved", async () => {
    const [brand, sidebar, globals] = await Promise.all([source("components/brand/brand-logo.tsx"), source("components/layout/workspace-sidebar-nav.tsx"), source("styles/globals.css")]);

    expect(brand).toContain("if (!appearance.logoConfigured) return <BuiltinBrandMark");
    expect(brand).toContain('if (appearance.logoConfigured || appearance.brandName !== "STAGE")');
    expect(brand).toContain("<span className={className}>{appearance.brandName}</span>");
    expect(sidebar).toContain("内置 STAGE cue mark 保持独立、无框");
    expect(globals).toMatch(/\.app-workspace-brand-mark\.is-builtin\s*{[^}]*border-radius: 0;[^}]*background: transparent;/s);
});

test("brand components render the built-in identity and configured appearance branches", async () => {
    useAppearanceStore.setState({ appearance: DEFAULT_PUBLIC_APPEARANCE });
    await render(createElement("div", null, createElement(BrandLogo, { alt: "STAGE", fallback: createElement("i", null, "legacy fallback") }), createElement(BrandWordmark)));
    expect(host.innerHTML).toContain("url(/logo.svg)");
    expect(host.innerHTML).toContain("var(--brand-cue)");
    expect(host.innerHTML).not.toContain("legacy fallback");
    expect(host.querySelector('[aria-label="STAGE"]')).not.toBeNull();
    expect(host.innerHTML).toContain("url(/wordmark.svg)");

    await act(async () => root?.unmount());
    root = undefined;
    host.remove();

    const customAppearance = {
        ...DEFAULT_PUBLIC_APPEARANCE,
        brandName: "CUSTOM",
        logoConfigured: true,
        darkLogoConfigured: true,
        logoUrl: "/custom-light.svg",
        darkLogoUrl: "/custom-dark.svg",
    };
    useAppearanceStore.setState({ appearance: customAppearance });
    await render(createElement("div", null, createElement(BrandLogo, { className: "custom-logo", alt: "CUSTOM", theme: "light", fallback: null }), createElement(BrandWordmark, { className: "custom-wordmark" })));
    const image = host.querySelector("img");
    expect(image?.getAttribute("src")).toBe("/custom-light.svg");
    expect(image?.getAttribute("alt")).toBe("CUSTOM");
    expect(host.querySelector(".custom-wordmark")?.textContent).toBe("CUSTOM");

    await act(async () => image!.dispatchEvent(new Event("error")));
    expect(host.querySelector("img")).toBeNull();
    expect(host.querySelector(".custom-logo")?.getAttribute("aria-hidden")).toBe("true");
});
