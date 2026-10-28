import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { CanvasNodeType } from "../src/types/canvas";
import { resolveAddNodeMenuCommands } from "../src/lib/canvas/tool-registry";
import { addNodeMenuCommands } from "../src/lib/canvas/tool-registry/definitions/add-node-menu-tools";

const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

describe("快捷电商任务工作室", () => {
    test("添加菜单精确保留商品、上传和素材库", () => {
        const builtinIds = new Set(addNodeMenuCommands.map((command) => command.id));
        const commands = resolveAddNodeMenuCommands({ canvasKind: "ecommerce", workspaceMode: "simple", isProjectLinked: false, enabledPluginIds: new Set(), handlers: {} } as never).filter((command) => builtinIds.has(command.id));
        expect(commands.map((command) => command.id).sort()).toEqual([CanvasNodeType.Product, "assets", "upload"].sort());
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

    test("快捷工具栏只留任务入口，缩放区隐藏专业画布控件", () => {
        const toolbar = source("components/canvas/canvas-toolbar.tsx");
        const zoom = source("components/canvas/canvas-zoom-controls.tsx");
        const topBar = source("pages/canvas/canvas-project-top-bar.tsx");
        for (const id of ["tool-undo", "tool-redo", "tool-add", "tool-assets"]) expect(toolbar).toContain(`"${id}"`);
        expect(toolbar).toContain("SIMPLE_ECOMMERCE_TOOL_IDS");
        expect(toolbar).toContain("SIMPLE_ECOMMERCE_CREATE_IDS");
        expect(zoom).toContain("showProfessionalControls?: boolean;");
        expect(zoom).toContain("...(showProfessionalControls");
        expect(topBar).toContain('const showProfessionalControls = !ecommerce || workspaceMode !== "simple";');
        expect(topBar).toContain("showProfessionalControls && onOpenModelLibrary");
        expect(topBar).toContain("showProfessionalControls && shortcutsOpen");
    });
});
