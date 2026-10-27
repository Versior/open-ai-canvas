import { afterAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Window } from "happy-dom";
import type { CanvasWorkspaceMode } from "../src/types/canvas";

const source = (path: string) => readFileSync(resolve(import.meta.dir, "../src", path), "utf8").replace(/\r\n/g, "\n");

test("电商画布默认快捷创作，其他画布保持专业模式", async () => {
    const module = await import("../src/lib/canvas/canvas-kind");
    const defaultMode = (module as typeof module & { defaultCanvasWorkspaceMode?: (kind?: "freeform" | "ecommerce") => string }).defaultCanvasWorkspaceMode;

    expect(typeof defaultMode).toBe("function");
    if (!defaultMode) return;
    expect(defaultMode("ecommerce")).toBe("simple");
    expect(defaultMode("freeform")).toBe("professional");
    expect(defaultMode(undefined)).toBe("professional");
});

test("项目按画布和项目解析模式，并提供可逆的顶栏切换", () => {
    const project = source("pages/canvas/project.tsx");
    const topBarStart = project.indexOf("<CanvasTopBar");
    const topBar = project.slice(topBarStart, project.indexOf("/>", topBarStart) + 2);

    expect(project).toContain("defaultCanvasWorkspaceMode(canvasKind)");
    expect(project).toContain("workspaceModeOverride?.projectId === projectId");
    expect(topBar).toContain("workspaceMode={workspaceMode}");
    expect(topBar).toContain("onWorkspaceModeChange={changeWorkspaceMode}");
    expect(project).toContain('openEcommerceStudio: canvasKind === "ecommerce" && workspaceMode === "professional"');
    expect(project).toContain('openEcommerceWorkbench: canvasKind === "ecommerce" && workspaceMode === "professional"');
    expect(project).toMatch(/canvasKind === "ecommerce" && workspaceMode === "professional" \?\s*\(\s*<CanvasEcommerceWorkbench/);
    expect(project).toMatch(/useLayoutEffect\(\(\) => \{\s*setEcommerceWorkbenchOpen\(false\);\s*setEcommerceWorkbenchStudioId\(undefined\);\s*\}, \[projectId\]\);/);
});

test("顶栏的电商模式切换对键盘和读屏可发现", () => {
    const topBar = source("pages/canvas/canvas-project-top-bar.tsx");

    expect(topBar).toContain("workspaceMode?: CanvasWorkspaceMode");
    expect(topBar).toContain('aria-pressed={workspaceMode === "professional"}');
    expect(topBar).toContain('aria-label={workspaceMode === "simple" ? "快捷创作，切换到专业画布" : "专业画布，返回快捷创作"}');
    expect(topBar).toContain('{workspaceMode === "simple" ? "快捷创作" : "专业画布"}');
    expect(topBar).toContain('label={workspaceMode === "simple" ? "进入专业画布" : "返回快捷创作"}');
});
const dom = new Window({ url: "http://localhost/" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    localStorage: dom.localStorage,
    HTMLElement: dom.HTMLElement,
    Element: dom.Element,
    Node: dom.Node,
    SVGElement: dom.SVGElement,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}

const { act, createElement } = await import("react");
const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { MemoryRouter } = await import("react-router");
const { CanvasTopBar } = await import("../src/pages/canvas/canvas-project-top-bar");

afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, value] of originals) {
        if (value) Object.defineProperty(globalThis, key, value);
        else Reflect.deleteProperty(globalThis, key);
    }
});

test("真实顶栏展示当前电商模式并切换到另一模式", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const changes: CanvasWorkspaceMode[] = [];
    const noop = () => {};
    const render = async (workspaceMode: CanvasWorkspaceMode) => {
        await act(async () =>
            root.render(
                createElement(
                    QueryClientProvider,
                    { client: new QueryClient() },
                    createElement(
                        MemoryRouter,
                        null,
                        createElement(CanvasTopBar, {
                            ecommerce: true,
                            workspaceMode,
                            onWorkspaceModeChange: (mode) => changes.push(mode),
                            view: "canvas",
                            onViewChange: noop,
                            title: "电商画布",
                            titleDraft: "电商画布",
                            isTitleEditing: false,
                            onTitleDraftChange: noop,
                            onStartTitleEditing: noop,
                            onFinishTitleEditing: noop,
                            onCancelTitleEditing: noop,
                            canUndo: false,
                            canRedo: false,
                            onCreateProject: noop,
                            onDeleteProject: noop,
                            onSave: noop,
                            onImportImage: noop,
                            onImportLibTV: noop,
                            onImportTapNow: noop,
                            onUndo: noop,
                            onRedo: noop,
                            onShare: noop,
                            shortcutRequestNonce: 0,
                            onOpenSearch: noop,
                            onEnterFocusMode: noop,
                        }),
                    ),
                ),
            ),
        );
    };
    const modeButton = (label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;

    try {
        await render("simple");
        const simple = modeButton("快捷创作，切换到专业画布");
        expect(simple.textContent).toContain("快捷创作");
        expect(simple.getAttribute("aria-pressed")).toBe("false");
        await act(async () => simple.click());
        expect(changes).toEqual(["professional"]);

        await render("professional");
        const professional = modeButton("专业画布，返回快捷创作");
        expect(professional.textContent).toContain("专业画布");
        expect(professional.getAttribute("aria-pressed")).toBe("true");
        await act(async () => professional.click());
        expect(changes).toEqual(["professional", "simple"]);
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
});
