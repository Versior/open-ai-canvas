import { Pencil } from "lucide-react";
import { useState } from "react";

import { useCanvasNodeActions } from "@/components/canvas/canvas-node-action-context";
import { ecommerceNodeName, ecommerceNodeRenamePatch } from "@/lib/ecommerce/ecommerce-node-name";
import type { CanvasNodeData } from "@/types/canvas";

/**
 * 电商节点卡片里的标题行，带改名。
 *
 * 通用抬头（节点上方那个）也有铅笔入口，但它只在缩放大于阈值时才出现，
 * 而且和卡片里的大标题是两个地方。设计师盯着卡片看，改名入口就得在卡片上，
 * 而且要能单击直接改——双击或右键不能是唯一入口。
 */
export function EcommerceNodeTitle({ node, fallback, subtitle, disabled = false }: { node: CanvasNodeData; fallback: string; subtitle?: React.ReactNode; disabled?: boolean }) {
    const { updateNode } = useCanvasNodeActions();
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState("");
    const name = ecommerceNodeName(node) || fallback;
    const editable = Boolean(updateNode) && !disabled && !node.metadata?.locked;

    const commit = () => {
        const patch = ecommerceNodeRenamePatch(node, draft);
        if (patch.title || patch.metadata) updateNode?.(node.id, (current) => ({ ...current, ...patch, metadata: { ...current.metadata, ...patch.metadata } }));
        setEditing(false);
    };

    return (
        <div className="ecom-card-title-row">
            <div className="min-w-0">
                {editing ? (
                    <input
                        autoFocus
                        className="ecom-card-title ecom-card-title-input"
                        value={draft}
                        aria-label="节点名称"
                        onFocus={(event) => event.currentTarget.select()}
                        onChange={(event) => setDraft(event.target.value)}
                        onBlur={commit}
                        onKeyDown={(event) => {
                            if (event.key === "Enter") event.currentTarget.blur();
                            if (event.key === "Escape") setEditing(false);
                        }}
                        onPointerDown={(event) => event.stopPropagation()}
                    />
                ) : editable ? (
                    <button
                        type="button"
                        className="ecom-card-title group"
                        title={`${name} —— 点击改名`}
                        onClick={() => {
                            setDraft(name);
                            setEditing(true);
                        }}
                    >
                        <span className="min-w-0 truncate">{name}</span>
                        <Pencil className="ecom-card-title-pencil size-2.5" />
                    </button>
                ) : (
                    <h3 className="ecom-card-title" title={name}>{name}</h3>
                )}
                {subtitle ? <p className="ecom-card-subtitle">{subtitle}</p> : null}
            </div>
        </div>
    );
}
