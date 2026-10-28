import { afterAll, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import React from "react";

const dom = new Window({ url: "http://localhost/" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    HTMLAnchorElement: dom.HTMLAnchorElement,
    Element: dom.Element,
    Node: dom.Node,
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
window.requestAnimationFrame = (callback) => {
    callback(0);
    return 1;
};

const noop = () => {};
let query = "";
let navigations: string[] = [];
let creations: Array<{ title: string; initialContent?: { kind?: string; nodes?: unknown[] } }> = [];
const projects = [
    { id: "freeform-newer", title: "Freeform", kind: "freeform", createdAt: "2026-10-28T02:00:00.000Z", updatedAt: "2026-10-28T02:00:00.000Z", nodes: [], connections: [] },
    { id: "ecommerce-older", title: "Product", kind: "ecommerce", createdAt: "2026-10-28T01:00:00.000Z", updatedAt: "2026-10-28T01:00:00.000Z", nodes: [], connections: [] },
];

mock.module("react-router", () => ({
    useNavigate: () => (path: string) => navigations.push(path),
    useSearchParams: () => [new URLSearchParams(query)],
}));
mock.module("@tanstack/react-query", () => ({
    QueryClient: class {},
    useInfiniteQuery: () => ({ data: undefined, isSuccess: true, isError: false, hasNextPage: false }),
    useQuery: () => ({ data: { projects: [] }, isFetching: false }),
}));
const Stub = ({ children }: React.PropsWithChildren) => <>{children}</>;
mock.module("antd", () => ({ App: { useApp: () => ({ message: { warning: noop, error: noop, success: noop } }) }, Button: Stub, Dropdown: Stub, Input: Stub, Modal: Stub }));
mock.module("@/components/ui/base/select", () => ({ Select: Stub }));
mock.module("@/components/layout/workspace-page", () => ({ CollectionGrid: Stub, PageHeader: Stub, WorkspacePage: Stub }));
mock.module("@/components/layout/collection-toolbar", () => ({ CollectionToolbar: Stub }));
mock.module("@/components/layout/workspace-state", () => ({ WorkspaceErrorState: Stub, WorkspaceLoadingState: Stub, WorkspaceNoResultsState: Stub, WorkspaceState: Stub }));
mock.module("@/components/canvas/canvas-folder-card", () => ({ CanvasFolderCard: Stub }));
mock.module("@/components/canvas/canvas-history-drawer", () => ({ CanvasHistoryDrawer: Stub }));
mock.module("@/lib/zip", () => ({ readZip: noop }));
mock.module("@/services/file-storage", () => ({ setMediaBlob: noop }));
mock.module("@/services/image-storage", () => ({ setImageBlob: noop }));
mock.module("@/lib/canvas/canvas-export", () => ({ exportCanvasProjects: noop }));
mock.module("@/lib/canvas/canvas-drawing-storage", () => ({ saveCanvasDrawing: noop }));
mock.module("@/services/api/user-data", () => ({ listRemoteCanvasProjectsPage: noop }));
mock.module("@/services/api/resources", () => ({ resourceFileUrl: noop, resourceStorageKey: noop, uploadResourceFile: noop }));
mock.module("@/services/resource-blob-cache", () => ({ primeResourceBlobCache: noop }));
mock.module("@/stores/use-sync-progress-store", () => ({ useSyncProgressStore: { getState: () => ({ setProjectProgress: noop }) } }));
mock.module("@/services/project-asset-sync", () => ({ ensureCanvasNodeAsset: noop }));

const canvasStore = { hydrated: true, projects, importProject: noop, updateProject: noop };
mock.module("@/stores/canvas/use-canvas-store", () => ({
    flushCanvasStorePersistence: async () => {},
    useCanvasStore: (selector: (state: typeof canvasStore) => unknown) => selector(canvasStore),
}));
const canvasUiStore = { selectedProjectIds: [], deleteProjectIds: [], setDeleteProjectIds: noop };
mock.module("@/stores/canvas/use-canvas-ui-store", () => ({ useCanvasUiStore: (selector: (state: typeof canvasUiStore) => unknown) => selector(canvasUiStore) }));
mock.module("@/stores/use-user-store", () => ({ useUserStore: (selector: (state: { hydrated: boolean; user?: undefined }) => unknown) => selector({ hydrated: true }) }));
mock.module("@/stores/use-appearance-store", () => ({ useAppearanceStore: (selector: (state: { appearance: { brandName: string } }) => unknown) => selector({ appearance: { brandName: "Canvas" } }) }));
mock.module("@/stores/use-ecommerce-settings", () => ({ useEcommerceSettings: { getState: () => ({ load: async () => ({ enabled: true }) }) } }));
mock.module("@/services/user-data-sync", () => ({
    createCanvasProjectWithRemoteSync: async (title: string, _projectId?: string, initialContent?: { kind?: string; nodes?: unknown[] }) => {
        creations.push({ title, initialContent });
        return { id: `created-${creations.length}` };
    },
    hasRemoteUserDataSyncSession: () => false,
    loadCanvasProjectForEditing: noop,
    saveRemoteUserDataNow: async () => {},
    scheduleRemoteUserDataSync: noop,
}));
mock.module("@/services/api/projects", () => ({ listProjects: async () => ({ projects: [] }) }));
mock.module("@/lib/workspace-route-modules", () => ({ loadCanvasProjectPage: async () => ({}) }));

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { default: CanvasPage } = await import("../../src/pages/canvas/index");
const { default: EcommerceEntry } = await import("../../src/pages/canvas/ecommerce-entry");

afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, value] of originals) {
        if (value) Object.defineProperty(globalThis, key, value);
        else Reflect.deleteProperty(globalThis, key);
    }
});

async function renderEntry(kind: "freeform" | "ecommerce", mode: "new" | "recent") {
    query = `mode=${mode}`;
    navigations = [];
    creations = [];
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
        root.render(kind === "ecommerce" ? <EcommerceEntry /> : <CanvasPage />);
        await Promise.resolve();
    });
    await act(async () => root.unmount());
}

test("ecommerce mode=new creates the preset canvas", async () => {
    await renderEntry("ecommerce", "new");
    expect(creations).toHaveLength(1);
    expect(creations[0].initialContent?.kind).toBe("ecommerce");
    expect(creations[0].initialContent?.nodes?.length).toBeGreaterThan(0);
});

test("ecommerce mode=recent opens the recent ecommerce canvas only", async () => {
    await renderEntry("ecommerce", "recent");
    expect(creations).toHaveLength(0);
    expect(navigations).toEqual(["/canvas/ecommerce-older?mode=recent"]);
});

test("freeform mode=new keeps creating an empty freeform canvas", async () => {
    await renderEntry("freeform", "new");
    expect(creations).toHaveLength(1);
    expect(creations[0].initialContent).toBeUndefined();
});
