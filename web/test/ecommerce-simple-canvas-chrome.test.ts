import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

describe("快捷电商任务工作室", () => {
    test("添加菜单在商品之外只补 Image 与 Text，专业电商节点留给专业模式", () => {
        const toolbar = source("components/canvas/canvas-toolbar.tsx");
        const ids = toolbar.slice(toolbar.indexOf("const SIMPLE_ECOMMERCE_CREATE_IDS"), toolbar.indexOf("export function CanvasToolbar"));
        // 商品与上传/素材是上一版就有的，这一轮只补 Image 与 Text
        for (const id of ["Product", "Image", "Text"]) expect(ids).toContain(`CanvasNodeType.${id}`);
        for (const id of ["upload", "assets"]) expect(ids).toContain(`"${id}"`);
        // 专业电商链路（卖点、文案、风格、版式、信息图、交付）不进快捷模式
        for (const id of ["SellingPoint", "Copy", "Style", "Layout", "Infographic", "Delivery", "ShotRecipe", "Replica", "Teardown", "Revision", "EcommerceVideo", "Aplus"]) {
            expect(ids).not.toContain(`CanvasNodeType.${id}`);
        }
        for (const id of ["Script", "Video", "BatchTable", "MediaConversion"]) expect(ids).not.toContain(`CanvasNodeType.${id}`);
        expect(toolbar).toContain('useCanvasCreateCommands(isSimpleEcommerce ? { ...ctx, workspaceMode: "professional" } : ctx, runAddAction)');
    });

    test("项目页关闭框选、多选工具栏和连接菜单，但保留专业模式开关", () => {
        const project = source("pages/canvas/project.tsx");
        expect(project).toContain('const showProfessionalControls = canvasKind !== "ecommerce" || workspaceMode === "professional";');
        expect(project).toContain('boxSelectEnabled={showProfessionalControls && canvasTool === "box-select"}');
        expect(project).toContain("connectionInteractionEnabled={showProfessionalControls}");
        expect(project).toMatch(/\{showProfessionalControls && pendingConnectionCreate \? \(/);
        expect(project).toMatch(/\{showProfessionalControls && selectedNodeBounds && !selectionBox && !isCanvasNodeMoving \? \(/);
        expect(project).toContain("showProfessionalControls={showProfessionalControls}");
        expect(project).toContain("onWorkspaceModeChange={changeWorkspaceMode}");
    });

    test("世界层在快捷模式移除连线命中层、连接轨和批量连接入口", () => {
        const world = source("pages/canvas/canvas-project-world-layers.tsx");
        const node = source("components/canvas/canvas-node.tsx");
        expect(world).toContain("connectionInteractionEnabled: boolean;");
        expect(world).toMatch(/\{props\.connectionInteractionEnabled \? \(\s*<svg/);
        expect(world).toContain("connectionInteractionEnabled={props.connectionInteractionEnabled}");
        expect(world).toMatch(/props\.connectionInteractionEnabled && props\.batchSourceNodeIds\.length > 0/);
        expect(node).toContain("connectionInteractionEnabled?: boolean;");
        expect(node).toContain("connectionInteractionEnabled = true");
        expect(node).toContain("const showConnectionRails = connectionInteractionEnabled && !isConnecting");
    });

    test("快捷工具栏保留核心入口，缩放区仍隐藏专业画布控件", () => {
        const toolbar = source("components/canvas/canvas-toolbar.tsx");
        const zoom = source("components/canvas/canvas-zoom-controls.tsx");
        const topBar = source("pages/canvas/canvas-project-top-bar.tsx");
        for (const id of ["tool-undo", "tool-redo", "tool-add", "tool-assets"]) expect(toolbar).toContain(`"${id}"`);
        expect(toolbar).toContain("SIMPLE_ECOMMERCE_TOOL_IDS");
        expect(toolbar).toContain("SIMPLE_ECOMMERCE_CREATE_IDS");
        expect(toolbar).toContain('canvasKind === "ecommerce" && onOpenEcommerceWorkbench');
        expect(toolbar).not.toContain('canvasKind === "ecommerce" && workspaceMode !== "simple" && onOpenEcommerceWorkbench');
        expect(zoom).toContain("showProfessionalControls?: boolean;");
        expect(zoom).toContain("...(showProfessionalControls");
        expect(topBar).toContain('const showProfessionalControls = !ecommerce || workspaceMode !== "simple";');
        expect(topBar).toContain("onOpenModelLibrary ?");
        expect(topBar).toContain("showProfessionalControls && shortcutsOpen");
    });
});
