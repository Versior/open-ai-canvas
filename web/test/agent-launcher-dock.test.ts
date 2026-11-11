import { expect, test } from "bun:test";
import { dockAgentLauncherPosition, restoreAgentLauncherPosition, moveAgentLauncher } from "../src/lib/canvas/agent-launcher-position";

const viewport = { width: 1440, height: 900 };
const size = { width: 100, height: 120 };
test("只在用户拖到左右窗边时藏起半身，默认位置不吸边", () => {
    expect(dockAgentLauncherPosition({ right: 20, bottom: 60 }, viewport, size)).toEqual({ right: 20, bottom: 60 });
    expect(dockAgentLauncherPosition({ right: 0, bottom: 60 }, viewport, size)).toEqual({ right: -45, bottom: 60, dock: "right" });
    expect(dockAgentLauncherPosition({ right: 1340, bottom: 60 }, viewport, size)).toEqual({ right: 1385, bottom: 60, dock: "left" });
});
test("吸边位置随窗口尺寸恢复，向内拖动可以离开窗边", () => {
    expect(restoreAgentLauncherPosition('{"right":1385,"bottom":60,"dock":"left"}', { width: 390, height: 844 }, size)).toEqual({ right: 335, bottom: 60, dock: "left" });
    const start = { right: -45, bottom: 60, dock: "right" as const };
    const moved = moveAgentLauncher({ start, x: 1400, y: 600, dragged: false }, 1250, 600, viewport, size, true);
    expect(moved.position).toEqual({ right: 105, bottom: 60 });
    expect(dockAgentLauncherPosition(moved.position, viewport, size).dock).toBeUndefined();
});
