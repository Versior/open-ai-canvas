import { afterAll, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import type { CanvasProject } from "../../src/stores/canvas/use-canvas-store";
import type { ViewportTransform } from "../../src/types/canvas";

const dom = new Window({ url: "http://localhost/" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({ window: dom, document: dom.document, navigator: dom.navigator, HTMLElement: dom.HTMLElement, Element: dom.Element, Node: dom.Node, IS_REACT_ACT_ENVIRONMENT: true })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const noop = () => {};
const message = { warning: noop, error: noop, success: noop };
mock.module("antd", () => ({ App: { useApp: () => ({ message }) } }));
mock.module("react-router", () => ({ useNavigate: () => noop }));
const { canvasAppearanceForTheme } = await import("../../src/lib/canvas/canvas-appearance");
const { ecommerceCanvasPreset } = await import("../../src/lib/ecommerce/ecommerce-canvas-preset");
const appearance = canvasAppearanceForTheme("dark");
const product = ecommerceCanvasPreset().nodes[0];
const project: CanvasProject = { id: "product-project", title: "商品", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", nodes: [product], connections: [], chatSessions: [], activeChatId: null, kind: "ecommerce", appearance, backgroundMode: "dots", showImageInfo: false, viewport: { x: 0, y: 0, k: 1 }, previsScenes: [] };
const store = { hydrated: true, projects: [project], openProject: () => project, updateProject: noop, renameProject: noop };
const canvasStore = Object.assign((selector: (state: typeof store) => unknown) => selector(store), { getState: () => store });
mock.module("@/stores/canvas/use-canvas-store", () => ({ useCanvasStore: canvasStore, flushCanvasStorePersistence: async () => {} }));
mock.module("@/stores/use-user-store", () => ({ useUserStore: (selector: (state: unknown) => unknown) => selector({ hydrated: true }) }));
mock.module("@/stores/canvas/use-canvas-theme-store", () => ({ useCanvasThemeStore: { getState: () => ({ theme: "dark", setTheme: noop }) } }));
mock.module("@/services/api/skills", () => ({ listAddedSkills: async () => ({ skills: [] }) }));
mock.module("@/services/canvas-edit-leases", () => ({ canvasEditLeases: { tick: async () => {}, statusToken: noop, status: noop } }));
mock.module("@/services/canvas-sync-polling", () => ({ startCanvasSyncPolling: () => noop }));
mock.module("@/services/canvas-realtime", () => ({ subscribeCanvasRealtime: () => noop }));
mock.module("@/lib/canvas/canvas-project-generation", () => ({ resetInterruptedGeneration: (nodes: unknown) => nodes, hydrateAssistantImages: async (sessions: unknown) => sessions }));
mock.module("@/lib/canvas/canvas-drawing-storage", () => ({ removeCanvasDrawing: noop }));
mock.module("@/services/api/user-data", () => ({ getCanvasSyncStatus: noop }));
let restore: (value: CanvasProject) => void;
let finish: (value: CanvasProject) => void;
mock.module("@/services/user-data-sync", () => ({
    createCanvasProjectWithRemoteSync: noop, deleteCanvasProjectsWithRemoteSync: noop, saveRemoteUserDataNow: noop, prepareCanvasForCloudAction: noop, refreshCanvasAfterAgent: noop, subscribeAgentCanvasRefresh: () => noop,
    loadCanvasProjectForEditing: (_: string, options: { onLoad: typeof restore }) => {
        restore = options.onLoad;
        return new Promise<CanvasProject>((resolve) => { finish = resolve; });
    },
}));
const { act, useRef, useState } = await import("react");
const { createRoot } = await import("react-dom/client");
const { useCanvasProjectLifecycle } = await import("../../src/pages/canvas/use-canvas-project-lifecycle");

afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, value] of originals) {
        if (value) Object.defineProperty(globalThis, key, value);
        else Reflect.deleteProperty(globalThis, key);
    }
});

async function mount(cached: CanvasProject) {
    store.projects = [cached];
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    let move: (viewport: ViewportTransform) => void;
    let current: ViewportTransform;
    function Editor() {
        const [viewport, setViewport] = useState({ x: 0, y: 0, k: 1 });
        const [projectLoaded, setProjectLoaded] = useState(false);
        const nodesRef = useRef(cached.nodes);
        const connectionsRef = useRef(cached.connections);
        const chatSessionsRef = useRef(cached.chatSessions);
        const activeChatIdRef = useRef(cached.activeChatId);
        const viewportRef = useRef(viewport);
        const historyPausedRef = useRef(true);
        move = (next) => { viewportRef.current = next; setViewport(next); };
        current = viewport;
        useCanvasProjectLifecycle({ projectId: cached.id, projectLoaded, nodes: cached.nodes, connections: cached.connections, chatSessions: cached.chatSessions, activeChatId: cached.activeChatId, canvasAppearance: appearance, backgroundMode: cached.backgroundMode, showImageInfo: false, viewport, nodesRef, connectionsRef, chatSessionsRef, activeChatIdRef, viewportRef, historyPausedRef, setNodes: noop, setConnections: noop, setChatSessions: noop, setActiveChatId: noop, setCanvasAppearance: noop, setBackgroundMode: noop, setShowImageInfo: noop, setViewport, setProjectLoaded, resetHistory: noop, cleanupAssetImages: noop, cleanupCanvasFiles: noop });
        return null;
    }
    await act(async () => root.render(<Editor />));
    return { viewport: () => current!, move: async (next: ViewportTransform) => { await act(async () => move!(next)); }, cloud: async (next: CanvasProject) => { await act(async () => { restore(next); finish(next); }); }, dispose: async () => { await act(async () => root.unmount()); host.remove(); } };
}

test("cloud content does not move the centered product back into the corner", async () => {
    const editor = await mount(project);
    try {
        await editor.move({ x: 600, y: 360, k: 1 });
        await editor.cloud({ ...project, updatedAt: "2026-01-02T00:00:00Z" });
        const viewport = editor.viewport();
        expect((product.position.x + product.width / 2) * viewport.k + viewport.x).toBe(600);
        expect((product.position.y + product.height / 2) * viewport.k + viewport.y).toBe(360);
    } finally { await editor.dispose(); }
});

test("cloud restoration preserves a user pan and zoom made while loading", async () => {
    const editor = await mount(project);
    try {
        const changed = { x: 410, y: 275, k: 0.65 };
        await editor.move(changed);
        await editor.cloud(project);
        expect(editor.viewport()).toEqual(changed);
    } finally { await editor.dispose(); }
});

test("opening a saved canvas restores its existing viewport", async () => {
    const saved = { ...project, viewport: { x: 250, y: 190, k: 0.8 } };
    const editor = await mount(saved);
    try {
        expect(editor.viewport()).toEqual(saved.viewport);
        await editor.cloud(saved);
        expect(editor.viewport()).toEqual(saved.viewport);
    } finally { await editor.dispose(); }
});
