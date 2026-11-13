import { Archive } from "lucide-react";
import type { CanvasTheme } from "@/lib/canvas-theme";
import { retiredEcommerceNodeName } from "@/lib/canvas/canvas-retired-nodes";
import type { CanvasNodeData } from "@/types/canvas";

/**
 * 旧版电商画布节点的统一占位：十四种电商节点和旧电商创作表都走这里。
 *
 * 只读展示标题和原节点类型；节点 metadata 不读、不改，存量数据原样保留。
 */
export function RetiredEcommerceNodeContent({ node, theme }: { node: CanvasNodeData; theme: CanvasTheme }) {
    const typeName = retiredEcommerceNodeName(node);
    return (
        <div data-retired-node={node.type} className="canvas-node-state flex size-full flex-col items-center justify-center gap-2 rounded-[var(--node-radius)] px-4 text-center" style={{ background: theme.node.fill, color: theme.node.muted }}>
            <Archive className="size-5 opacity-60" aria-hidden="true" />
            <strong className="max-w-full truncate text-sm font-medium" style={{ color: theme.node.text }} title={node.title || typeName}>
                {node.title || typeName}
            </strong>
            <span className="max-w-full truncate" style={{ fontSize: "var(--fs-label)" }}>
                原节点类型：{typeName}
            </span>
            <span style={{ fontSize: "var(--fs-label)", color: theme.node.faint }}>该节点类型已下线，数据已保留</span>
        </div>
    );
}
