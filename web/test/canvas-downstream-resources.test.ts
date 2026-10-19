import { describe, expect, test } from "bun:test";

import * as references from "../src/lib/canvas/canvas-resource-references";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "../src/types/canvas";

function resourceNodes(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const getDownstream = (references as unknown as Record<string, unknown>).getContextDownstreamResourceNodes;
    expect(typeof getDownstream).toBe("function");
    return (getDownstream as (id: string, items: CanvasNodeData[], edges: CanvasConnection[]) => CanvasNodeData[])(nodeId, nodes, connections);
}

function node(id: string, type: CanvasNodeType, content?: string): CanvasNodeData {
    return { id, type, title: id, position: { x: 0, y: 0 }, width: 320, height: 240, metadata: content ? { content } : {} };
}

describe("canvas downstream resource context", () => {
    test("returns direct downstream resources in connection order", () => {
        const nodes = [
            node("origin", CanvasNodeType.Text, "prompt"),
            node("first", CanvasNodeType.Image, "first image"),
            node("second", CanvasNodeType.Image, "second image"),
            node("upstream", CanvasNodeType.Image, "reference"),
            node("indirect", CanvasNodeType.Image, "indirect image"),
        ];
        const connections = [
            { id: "up", fromNodeId: "upstream", toNodeId: "origin" },
            { id: "second", fromNodeId: "origin", toNodeId: "second" },
            { id: "first", fromNodeId: "origin", toNodeId: "first" },
            { id: "indirect", fromNodeId: "first", toNodeId: "indirect" },
        ];
        expect(resourceNodes("origin", nodes, connections).map((item) => item.id)).toEqual(["second", "first"]);
    });

    test("ignores missing nodes and downstream nodes without resource content", () => {
        const nodes = [node("origin", CanvasNodeType.Text, "prompt"), node("empty", CanvasNodeType.Image)];
        const connections = [
            { id: "empty", fromNodeId: "origin", toNodeId: "empty" },
            { id: "missing", fromNodeId: "origin", toNodeId: "missing" },
        ];
        expect(resourceNodes("origin", nodes, connections)).toEqual([]);
    });

    test("returns an empty list when there are no outgoing connections", () => {
        expect(resourceNodes("origin", [node("origin", CanvasNodeType.Text, "prompt")], [])).toEqual([]);
    });
});
