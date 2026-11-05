import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CanvasCreateCommand } from "../src/components/canvas/canvas-create-menu";

const component = readFileSync(new URL("../src/components/canvas/canvas-workspace-overlays.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/styles/globals.css", import.meta.url), "utf8");

test("connection menu omits the header and provides descriptions for every option", () => {
    expect(component).not.toContain("引用当前节点");
    expect(component).not.toContain(">创建下一步</span>");
    expect(component).not.toContain("ChevronRight");
    expect(component).not.toContain("absolute inset-x-8 top-0 h-px");
    const list = component.slice(component.indexOf("const CONNECTION_CREATE_OPTIONS"), component.indexOf("export function CanvasConnectionCreateMenu("));
    const options = list.match(/\{ type: CanvasNodeType\.\w+, title: "[^"]+", description: "[^"]+"/g) || [];
    expect(options).toHaveLength(9);
    expect(list).toContain('title: "批量创作表"');
    expect(list).toContain("type: CanvasNodeType.BatchTable");
    expect(component).toContain("onCreate(option.type)");
});

test("旧版电商节点不再出现在任何新建入口", () => {
    const commands = readFileSync(new URL("../src/lib/canvas/tool-registry/definitions/add-node-menu-tools.tsx", import.meta.url), "utf8");
    const context = readFileSync(new URL("../src/components/canvas/canvas-context-menu.tsx", import.meta.url), "utf8");
    const toolbar = readFileSync(new URL("../src/components/canvas/canvas-toolbar.tsx", import.meta.url), "utf8");
    for (const type of ["EcommerceStudio", "Product", "ShotRecipe", "SellingPoint", "Copy", "Style", "Layout", "Infographic", "Replica", "Teardown", "Delivery", "Revision", "EcommerceVideo", "Aplus"]) {
        expect(commands).not.toContain(`CanvasNodeType.${type}`);
        expect(component).not.toContain(`CanvasNodeType.${type}`);
    }
    for (const source of [component, commands, context, toolbar]) expect(source).not.toContain("canvasKind");
});
test("add-node submenu uses a four-column medium-size grid", () => {
    const menu = readFileSync(new URL("../src/components/canvas/canvas-create-menu.tsx", import.meta.url), "utf8");
    const context = readFileSync(new URL("../src/components/canvas/canvas-context-menu.tsx", import.meta.url), "utf8");
    const styles = readFileSync(new URL("../src/styles/globals.css", import.meta.url), "utf8");
    expect(menu).toContain('aria-label="创作节点" className="mt-1 grid grid-cols-4 gap-0.5"');
    expect(menu).toContain("size-9 shrink-0");
    expect(context).toContain("w-[360px]");
    expect(styles).toContain("--canvas-create-node-height: calc(var(--space-16) + var(--space-3))");
});

test("add-node submenu renders one node grid and keeps the workflow/resource footer", async () => {
    const [{ createElement }, { renderToStaticMarkup }, { CanvasCreateMenu }] = await Promise.all([import("react"), import("react-dom/server"), import("../src/components/canvas/canvas-create-menu")]);
    const onClick = () => {};
    const commands: CanvasCreateCommand[] = [
        { id: "text", label: "文本", icon: null, section: "node", onClick },
        { id: "upload", label: "上传", icon: null, section: "resource", onClick },
        { id: "image", label: "图片", icon: null, section: "node", badge: "Beta", onClick },
        { id: "workflow", label: "工作流", icon: null, section: "workflow", onClick },
    ];
    const markup = renderToStaticMarkup(createElement(CanvasCreateMenu, { commands }));
    expect([...markup.matchAll(/role="group" aria-label="([^"]+)"/g)].map((match) => match[1])).toEqual(["创作节点", "工作流与导入资源"]);
    expect(markup).toContain('title="图片（Beta）"');
    expect(markup).toContain("--create-track-hover:");
    expect(markup.indexOf('title="工作流"')).toBeLessThan(markup.indexOf('title="上传"'));
    expect(markup).not.toContain("<h3");
});
test("hover never changes row height; descriptions live in a fixed-height detail area", () => {
    const option = component.slice(component.indexOf("function ConnectionCreateOption("), component.indexOf("function clamp("));
    expect(option).not.toContain("motion.button");
    // 行高固定、行内不再渲染说明，悬停只换高亮。
    expect(option).toContain("flex h-10 w-full");
    expect(option).not.toContain("description}</span>");
    expect(css).not.toContain(".canvas-connection-create-description");
    const detailRule = css.match(/\.canvas-connection-create-detail \{([^}]+)\}/)?.[1] || "";
    expect(detailRule).toContain("height:");
    expect(detailRule).toContain("flex-shrink: 0");
    expect(css).toContain("-webkit-line-clamp: 2");
    expect(component).toContain('className="canvas-connection-create-detail" aria-hidden="true"');
    expect(component).toContain("previous?.x === event.clientX && previous.y === event.clientY");
    expect(component).not.toContain("SpotlightSurface");
    expect(css).toContain('.canvas-connection-create-detail[data-motion="reduced"]');
    expect(component).toContain("aria-disabled={Boolean(disabledReason)}");
    expect(component).toContain("if (!disabledReason) onClick()");
    expect(component).toContain('event.key === "Escape"');
});

test("连接创建菜单管理弹层焦点和 Escape", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/canvas-connection-create-menu-focus.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 15000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
}, 20000);
