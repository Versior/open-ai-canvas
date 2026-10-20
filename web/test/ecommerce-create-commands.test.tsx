import { expect, test } from "bun:test";
import React, { act } from "react";
import { reconciler } from "@react-three/fiber";
import { useCanvasCreateCommands } from "../src/components/canvas/use-canvas-create-commands";
import { type AddNodeMenuContext, type ToolbarHandlers } from "../src/lib/canvas/tool-registry";
import { CanvasNodeType } from "../src/types/canvas";

test("live command hook preserves ecommerce groups, filtering and create actions", async () => {
    const originalAct = Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT");
    Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
    let kind: AddNodeMenuContext["canvasKind"] = "ecommerce";
    let commands: ReturnType<typeof useCanvasCreateCommands> = [];
    const created: string[] = [];
    const handlers = { onAddExtensionNode: (type: string) => created.push(type) } as ToolbarHandlers;
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
