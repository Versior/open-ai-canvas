import { afterAll, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";

const dom = new Window({ url: "http://localhost/ecommerce" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({ window: dom, document: dom.document, navigator: dom.navigator, HTMLElement: dom.HTMLElement, Element: dom.Element, Node: dom.Node, IS_REACT_ACT_ENVIRONMENT: true })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const destinations: string[] = [];
const warnings: string[] = [];
const navigate = (to: string) => { destinations.push(to); };
const message = { warning: (text: string) => { warnings.push(text); } };
mock.module("antd", () => ({ App: { useApp: () => ({ message }) }, Button: (props: object) => React.createElement("button", props) }));
mock.module("react-router", () => ({ useNavigate: () => navigate, Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a> }));
let enabled = true;
const store = Object.assign((select: (value: { hydrated: boolean }) => unknown) => select({ hydrated: true }), { getState: () => ({ projects: [{ title: "电商创作" }] }) });
mock.module("@/stores/canvas/use-canvas-store", () => ({ useCanvasStore: store }));
mock.module("@/stores/use-ecommerce-settings", () => ({ useEcommerceSettings: { getState: () => ({ load: async () => ({ enabled }) }) } }));
let calls: { title: string; preset: { kind: string; nodes: unknown[] } }[] = [];
let finish: (result: { id: string; syncError?: Error }) => void;
mock.module("@/services/user-data-sync", () => ({ createCanvasProjectWithRemoteSync: (title: string, _: unknown, preset: { kind: string; nodes: unknown[] }) => {
    calls.push({ title, preset });
    return new Promise(resolve => { finish = resolve; });
} }));
const React = await import("react");
const { act, StrictMode } = React;
const { createRoot } = await import("react-dom/client");
const { default: EcommerceEntry } = await import("../../src/pages/canvas/ecommerce-entry");

afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, value] of originals) {
        if (value) Object.defineProperty(globalThis, key, value);
        else Reflect.deleteProperty(globalThis, key);
    }
});

async function mount() {
    calls = []; destinations.length = 0; warnings.length = 0; enabled = true;
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host);
    return { host, start: async () => { await act(async () => root.render(<StrictMode><EcommerceEntry /></StrictMode>)); }, dispose: async () => { await act(async () => root.unmount()); host.remove(); } };
}

test("StrictMode creates one product canvas and navigates once", async () => {
    const view = await mount();
    try {
        await view.start();
        expect(calls).toHaveLength(1);
        expect(calls[0].preset.kind).toBe("ecommerce");
        expect(calls[0].preset.nodes).toHaveLength(1);
        await act(async () => finish({ id: "new-canvas", syncError: new Error("offline") }));
        expect(destinations).toEqual(["/canvas/new-canvas"]);
        expect(warnings).toHaveLength(1);
    } finally { await view.dispose(); }
});

test("disabled feature blocks creation and retry rereads configuration", async () => {
    const view = await mount(); enabled = false;
    try {
        await view.start();
        expect(calls).toHaveLength(0);
        expect(view.host.textContent).toContain("管理员已停用");
        enabled = true;
        await act(async () => view.host.querySelector("button")!.click());
        expect(calls).toHaveLength(1);
        await act(async () => finish({ id: "retry-canvas" }));
        expect(destinations).toEqual(["/canvas/retry-canvas"]);
    } finally { await view.dispose(); }
});

test("leaving during creation does not redirect the next page", async () => {
    const view = await mount();
    await view.start(); await view.dispose();
    await act(async () => finish({ id: "late-canvas" }));
    expect(destinations).toHaveLength(0);
});
