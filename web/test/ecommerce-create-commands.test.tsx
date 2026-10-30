import { expect, test } from "bun:test";
import React, { act } from "react";
import { reconciler } from "@react-three/fiber";
import { useCanvasCreateCommands } from "../src/components/canvas/use-canvas-create-commands";
import { SIMPLE_ECOMMERCE_CREATE_IDS } from "../src/components/canvas/canvas-toolbar";
import { type AddNodeMenuContext, type ToolbarHandlers } from "../src/lib/canvas/tool-registry";
import { CanvasNodeType } from "../src/types/canvas";

test("live command hook preserves ecommerce groups, filtering and create actions", async () => {
    const originalAct = Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT");
    Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
    let kind: AddNodeMenuContext["canvasKind"] = "ecommerce";
    let commands: ReturnType<typeof useCanvasCreateCommands> = [];
    const created: string[] = [];
    const handlers = {
        onAddExtensionNode: (type: string) => created.push(type),
        onAddText: () => created.push(CanvasNodeType.Text),
        onAddImage: () => created.push(CanvasNodeType.Image),
    } as ToolbarHandlers;
    function Probe() {
        commands = useCanvasCreateCommands({ canvasKind: kind, isProjectLinked: false, handlers });
        return null;
    }
    const fail = (error: unknown) => {
        throw error;
    };
    const root = reconciler.createContainer({} as never, 1, null, false, null, "", fail, fail, fail, null);
    try {
        await act(async () => reconciler.updateContainer(<Probe />, root, null, null));
        expect([...new Set(commands.filter((command) => command.group).map((command) => command.group))]).toEqual(["商品信息", "画面制作", "参考分析", "修改交付"]);
        expect(commands.some((command) => command.id === CanvasNodeType.Script)).toBe(false);
        commands.find((command) => command.id === CanvasNodeType.Product)!.onClick();
        expect(created).toEqual([CanvasNodeType.Product]);
        kind = "freeform";
        await act(async () => reconciler.updateContainer(<Probe />, root, null, null));
        expect(commands.some((command) => command.id === CanvasNodeType.Product)).toBe(false);
        expect(commands.some((command) => command.id === CanvasNodeType.Script)).toBe(true);
    } finally {
        await act(async () => reconciler.updateContainer(null, root, null, null));
        if (originalAct) Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", originalAct);
        else Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
    }
});

test("simple 模式白名单点击一次只触发一次创建，且只放出商品、Image、Text、上传与素材", async () => {
    const originalAct = Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT");
    Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
    let commands: ReturnType<typeof useCanvasCreateCommands> = [];
    const created: string[] = [];
    const handlers = {
        onAddExtensionNode: (type: string) => created.push(type),
        onAddText: () => created.push(CanvasNodeType.Text),
        onAddImage: () => created.push(CanvasNodeType.Image),
    } as ToolbarHandlers;
    function Probe() {
        commands = useCanvasCreateCommands({ canvasKind: "ecommerce", isProjectLinked: false, handlers });
        return null;
    }
    const fail = (error: unknown) => {
        throw error;
    };
    const root = reconciler.createContainer({} as never, 1, null, false, null, "", fail, fail, fail, null);
    try {
        await act(async () => reconciler.updateContainer(<Probe />, root, null, null));
        const whitelisted = commands.filter((command) => SIMPLE_ECOMMERCE_CREATE_IDS.has(command.id));
        expect(whitelisted.map((command) => command.id).sort()).toEqual([CanvasNodeType.Image, CanvasNodeType.Product, CanvasNodeType.Text, "assets", "upload"].sort());
        // 真的点一次：handler 只能被调一次，不能因为两个入口共用命令而重复创建
        whitelisted.find((command) => command.id === CanvasNodeType.Text)!.onClick();
        expect(created).toEqual([CanvasNodeType.Text]);
        created.length = 0;
        whitelisted.find((command) => command.id === CanvasNodeType.Image)!.onClick();
        expect(created).toEqual([CanvasNodeType.Image]);
        created.length = 0;
        whitelisted.find((command) => command.id === CanvasNodeType.Product)!.onClick();
        expect(created).toEqual([CanvasNodeType.Product]);
    } finally {
        await act(async () => reconciler.updateContainer(null, root, null, null));
        if (originalAct) Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", originalAct);
        else Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
    }
});
