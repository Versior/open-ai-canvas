import { describe, expect, test } from "bun:test";

import { applyFrameDrop, buildCanvasFrameDropIndex, canFolderContain, canLinkedFolderArchive, findFrameDropTarget, findFrameDropTargetFromIndex, isCanvasFolderNode } from "@/lib/canvas/canvas-frame";
import { resolveCanvasFolderTheme, resolveCanvasFolderThemeCover } from "@/lib/canvas/canvas-folder-theme";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

function folder(id: string, linked = false): CanvasNodeData {
    return {
        id,
        type: CanvasNodeType.Frame,
        title: linked ? "素材目录" : "我的文件",
        position: { x: 100, y: 100 },
        width: 360,
        height: 280,
        metadata: {
            frame: { collapsed: true, expandedWidth: 760, expandedHeight: 520 },
            folder: {
                style: "glass",
                createdAt: "2026-08-20T00:00:00.000Z",
                ...(linked ? { assetFolderId: "asset-folder", projectId: "project" } : {}),
            },
        },
    };
}

function image(id: string, content = "resource:image"): CanvasNodeData {
    return {
        id,
        type: CanvasNodeType.Image,
        title: id,
        position: { x: 150, y: 150 },
        width: 180,
        height: 120,
        metadata: { content },
    };
}

describe("canvas folders", () => {
    test("文件夹样式与主题皮肤独立解析", () => {
        expect(resolveCanvasFolderTheme("ember")).toBe("ember");
        expect(resolveCanvasFolderTheme("unknown")).toBe("aurora");
        expect(resolveCanvasFolderThemeCover("obsidian")).toContain("folder-theme-obsidian.png");
        expect(resolveCanvasFolderThemeCover("pearl", "resource:custom-cover")).toBe("resource:custom-cover");
    });

    test("识别文件夹并允许非容器节点进入本地文件夹", () => {
        const target = folder("folder");
        expect(isCanvasFolderNode(target)).toBe(true);
        expect(canFolderContain(image("image"))).toBe(true);
        expect(canFolderContain(folder("nested"))).toBe(false);
    });

    test("折叠文件夹仍可成为拖放目标并保存展开布局", () => {
        const target = folder("folder");
        const dragged = image("image");
        const nodes = [target, dragged];

        expect(findFrameDropTarget(nodes, new Set([dragged.id]))).toBe(target.id);
        const next = applyFrameDrop(nodes, new Set([dragged.id]), target.id);
        const nextFolder = next.find((node) => node.id === target.id)!;
        const nextImage = next.find((node) => node.id === dragged.id)!;

        expect(nextImage.parentId).toBe(target.id);
        expect(nextFolder.metadata?.frame?.collapsed).toBe(true);
        expect(nextFolder.metadata?.frame?.expandedWidth).toBeGreaterThan(dragged.width);
        expect(nextFolder.metadata?.frame?.expandedHeight).toBeGreaterThan(dragged.height);
    });

    test("空间索引画框落点与常规落点一致", () => {
        const target = folder("folder");
        const dragged = image("image");
        const nodes = [target, dragged];
        const index = buildCanvasFrameDropIndex(nodes);

        expect(findFrameDropTargetFromIndex(index, [dragged], new Set([dragged.id]), { x: 0, y: 0 })).toBe(findFrameDropTarget(nodes, new Set([dragged.id])));
        expect(findFrameDropTargetFromIndex(index, [dragged], new Set([dragged.id]), { x: 400, y: 400 })).toBeNull();
    });

    test("整组必须全部进入同一个目标；没有候选框时不扫描另外 999 个节点", () => {
        const broad = folder("back");
        const narrow = { ...folder("front"), width: 160 };
        const first = image("first");
        const second = { ...image("second"), position: { x: 260, y: 150 } };
        const dragged = new Set([first.id, second.id]);
        const frames = buildCanvasFrameDropIndex([broad, narrow]);
        expect(findFrameDropTargetFromIndex(frames, [first], new Set([first.id]), { x: 0, y: 0 })).toBe("front");
        expect(findFrameDropTargetFromIndex(frames, [first, second], dragged, { x: 0, y: 0 })).toBe("back");
        let positionReads = 0;
        const rest = Array.from({ length: 999 }, (_, index) => ({
            ...image(String(index)),
            get position() {
                positionReads++;
                return second.position;
            },
        }));
        expect(findFrameDropTargetFromIndex(frames, [first, ...rest], new Set([first.id, ...rest.map((node) => node.id)]), { x: 1200, y: 400 })).toBeNull();
        expect(positionReads).toBe(0);
    });

    test("素材库链接文件夹只接收可归档的真实内容节点", () => {
        const target = folder("linked", true);
        const ready = image("ready");
        const empty = image("empty", "");
        const existing = { ...image("existing", ""), metadata: { content: "", assetId: "asset-existing" } };
        const config: CanvasNodeData = { id: "config", type: CanvasNodeType.Config, title: "配置", position: { x: 150, y: 150 }, width: 180, height: 120 };

        expect(canLinkedFolderArchive(ready)).toBe(true);
        expect(canLinkedFolderArchive(empty)).toBe(false);
        expect(canLinkedFolderArchive(existing)).toBe(true);
        expect(canLinkedFolderArchive(config)).toBe(false);
        expect(findFrameDropTarget([target, ready], new Set([ready.id]))).toBe(target.id);
        expect(findFrameDropTarget([target, empty], new Set([empty.id]))).toBeNull();
    });

    test("拖出本地文件夹会解除父子关系", () => {
        const child = { ...image("image"), parentId: "folder" };
        const next = applyFrameDrop([folder("folder"), child], new Set([child.id]), null);
        expect(next.find((node) => node.id === child.id)?.parentId).toBeUndefined();
    });
});
