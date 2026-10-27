import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement, createRef, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { CanvasConnectionCreateMenu } from "../src/components/canvas/canvas-workspace-overlays";

const component = readFileSync(new URL("../src/components/canvas/canvas-workspace-overlays.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/styles/globals.css", import.meta.url), "utf8");

function renderConnectionMenu(canvasKind: "ecommerce" | "freeform", workspaceMode: "simple" | "professional") {
    const Menu = CanvasConnectionCreateMenu as unknown as ComponentType<Record<string, unknown>>;
    return renderToStaticMarkup(
        createElement(Menu, {
            pending: { connection: {}, position: { x: 40, y: 40 } },
            viewport: { x: 0, y: 0, k: 1 },
            viewportSize: { width: 1280, height: 800 },
            containerRef: createRef<HTMLDivElement>(),
            canCreateDrawing: true,
            canvasKind,
            workspaceMode,
            getDisabledReason: () => "",
            onCreate: () => {},
            onClose: () => {},
        }),
    );
}

test("connection menu omits the header and provides descriptions for every option", () => {
    expect(component).not.toContain("引用当前节点");
    expect(component).not.toContain(">创建下一步</span>");
    expect(component).not.toContain("ChevronRight");
    expect(component).not.toContain("absolute inset-x-8 top-0 h-px");
    const options = component.match(/<ConnectionCreateOption\b[\s\S]*?\n\s*\/>/g) || [];
    // 通用选项加上通过注册表渲染的电商选项。
    expect(options).toHaveLength(10);
    for (const option of options) expect(option).toMatch(/description=(?:"[^"]+"|\{`[^`]+`\})/);
    expect(component).toContain('title="批量创作表"');
    expect(component).toContain("onCreate(CanvasNodeType.BatchTable)");
    expect(component).toContain("onCreate(type)");
});

test("电商节点与影视节点互不进对方的画布", () => {
    // 两边不是同一个产品的子集，是两套工作流：自由画布上摆「商品」节点会让人
    // 以为要先填商品档案，电商画布上摆「分镜脚本」会让人以为要写剧本。
    // 判据只有一个来源——这张画布的 kind。
    const filmStart = component.indexOf("ecommerceCanvas ? null : (");
    const filmBlock = component.slice(filmStart, component.indexOf("</>", filmStart));
    expect(filmBlock).toContain('title="文本生成"');
    expect(filmBlock).toContain('title="分镜脚本"');
    // 影视块里不能出现任何电商节点
    expect(filmBlock).not.toContain("CanvasNodeType.Product");

    const ecommerceStart = component.indexOf("{ecommerceCanvas", component.indexOf("onCreate(CanvasNodeType.MediaConversion)"));
    const ecommerceBlock = component.slice(ecommerceStart, component.indexOf(": null}", ecommerceStart));
    expect(ecommerceBlock).toContain("CanvasNodeType.Product");
    for (const type of ["ShotRecipe", "SellingPoint", "Copy", "Style", "Layout", "Infographic", "Replica", "Teardown", "Delivery", "Revision", "EcommerceVideo", "Aplus"]) {
        expect(ecommerceBlock).toContain(`CanvasNodeType.${type}`);
    }
    // 电商块里不能出现影视节点
    expect(ecommerceBlock).not.toContain("CanvasNodeType.Script");

    // 缺省按自由画布处理：宁可少显示电商节点，也不该把它们漏进自由画布
    expect(component).toContain('canvasKind = "freeform"');
});

test("连接后菜单在快捷电商只保留商品入口，专业与自由画布不受误伤", () => {
    const simple = renderConnectionMenu("ecommerce", "simple");
    expect(simple).toContain('aria-label="商品"');
    expect(simple).not.toContain('aria-label="卖点"');
    expect(simple).not.toContain('aria-label="电商生图台"');
    expect(simple).not.toContain('aria-label="批量创作表"');
    expect(simple).not.toContain('aria-label="生成配置"');
    expect(simple).not.toContain('aria-label="音频参考"');

    const professional = renderConnectionMenu("ecommerce", "professional");
    expect(professional).toContain('aria-label="商品"');
    expect(professional).toContain('aria-label="卖点"');
    expect(professional).toContain('aria-label="电商生图台"');
    expect(professional).toContain('aria-label="批量创作表"');
    expect(professional).toContain('aria-label="生成配置"');
    expect(professional).not.toContain('aria-label="音频参考"');

    const freeform = renderConnectionMenu("freeform", "simple");
    expect(freeform).not.toContain('aria-label="商品"');
    expect(freeform).toContain('aria-label="批量创作表"');
    expect(freeform).toContain('aria-label="生成配置"');
    expect(freeform).not.toContain('aria-label="音频参考"');

    const freeformProfessional = renderConnectionMenu("freeform", "professional");
    expect(freeformProfessional).toContain('aria-label="音频参考"');
});

test("add-node menu 与右键菜单同样按画布种类和模式分流", () => {
    const commands = readFileSync(new URL("../src/lib/canvas/tool-registry/definitions/add-node-menu-tools.tsx", import.meta.url), "utf8");
    const context = readFileSync(new URL("../src/components/canvas/canvas-context-menu.tsx", import.meta.url), "utf8");
    const toolbar = readFileSync(new URL("../src/components/canvas/canvas-toolbar.tsx", import.meta.url), "utf8");
    expect(commands).toContain('const ecommerceOnly = (ctx: AddNodeMenuContext) => ctx.canvasKind === "ecommerce"');
    expect(commands).toContain('const professionalEcommerceOnly = (ctx: AddNodeMenuContext) => ecommerceOnly(ctx) && ctx.workspaceMode !== "simple"');
    expect(commands).toContain('const filmOnly = (ctx: AddNodeMenuContext) => ctx.canvasKind !== "ecommerce"');
    expect(commands).toContain("applicable: professionalEcommerceOnly, group");
    expect(context).toContain("canvasKind={canvasKind}");
    expect(context).toContain("canvasKind,");
    expect(toolbar).toContain('canvasKind === "ecommerce" && workspaceMode !== "simple" && onOpenEcommerceWorkbench');
    // 影视侧的反向门禁
    expect(commands).toMatch(/nodeCommand\(CanvasNodeType\.Script, \{[^}]*applicable: filmOnly/);
    expect(commands).toContain("filmOnly(ctx)");
});

test("add-node submenu uses a four-column medium-size grid", () => {
    const menu = readFileSync(new URL("../src/components/canvas/canvas-create-menu.tsx", import.meta.url), "utf8");
    const context = readFileSync(new URL("../src/components/canvas/canvas-context-menu.tsx", import.meta.url), "utf8");
    const styles = readFileSync(new URL("../src/styles/globals.css", import.meta.url), "utf8");
    expect(menu).toContain('variant === "node" ? "grid-cols-4"');
    expect(menu).toContain("size-6 shrink-0");
    expect(context).toContain("w-[360px]");
    expect(styles).toContain("--canvas-create-node-height: var(--space-16)");
});

test("only the active option expands; stationary pointer retargeting cannot switch rows", () => {
    const descriptionRule = css.match(/\.canvas-connection-create-description \{([^}]+)\}/)?.[1] || "";
    expect(descriptionRule).toContain("grid-template-rows: 0fr");
    expect(descriptionRule).not.toContain("min-height");
    const option = component.slice(component.indexOf("function ConnectionCreateOption("), component.indexOf("function clamp("));
    expect(option).not.toContain("motion.button");
    expect(css).toContain('.canvas-connection-create-option[data-expanded="true"]');
    expect(component).toContain("previous?.x === event.clientX && previous.y === event.clientY");
    expect(component).not.toContain("SpotlightSurface");
    expect(css).toContain('.canvas-connection-create-option[data-motion="reduced"]');
    expect(component).toContain("aria-disabled={Boolean(disabledReason)}");
    expect(component).toContain("if (!disabledReason) onClick()");
    expect(component).toContain('event.key === "Escape"');
});

test("连线菜单按分组呈现，不再是一条平铺长列", () => {
    expect(component).toContain('<ConnectionCreateGroupLabel label="通用" />');
    // 电商侧只剩商品节点，一组标题就够；原来的四组随十二个节点一起去掉了
    expect(component).not.toContain('<ConnectionCreateGroupLabel label="商品与约束" />');
    expect(component).not.toContain('<ConnectionCreateGroupLabel label="成片与交付" />');
});

test("连接创建菜单管理弹层焦点和 Escape", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/canvas-connection-create-menu-focus.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 15000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
}, 20000);
