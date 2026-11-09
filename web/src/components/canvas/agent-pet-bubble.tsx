import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";

import { AGENT_PET_BUBBLE_BULGE, AGENT_PET_BUBBLE_MARGIN, agentPetBubbleTailPath, agentPetCloudPath, layoutAgentPetBubble, type AgentPetBubbleAnchor, type AgentPetBubbleViewport } from "@/lib/canvas/agent-pet-bubble-layout";
import { agentSkinAccent, resolveAgentSkin } from "@/lib/canvas/agent-skin";
import type { AgentPetTone } from "@/services/api/agent-pets";
import { useAgentPetPrefsStore } from "@/stores/use-agent-pet-prefs-store";

const MAX_BUBBLE_WIDTH = 216;

/**
 * 智能体头顶的云朵对话框。先在屏幕外量出文字换行后的尺寸，再按形象位置摆放；
 * 每条消息由调用方用 key 重新挂载，以便重新测量并播放弹出动画。点击收起。
 */
export function AgentPetBubble({ text, anchor, viewport, onDismiss, tone, accent }: { text: string; anchor: AgentPetBubbleAnchor; viewport: AgentPetBubbleViewport; onDismiss: () => void; tone?: AgentPetTone | ""; accent?: string }) {
    const preference = useAgentPetPrefsStore((state) => state.skin);
    const skin = resolveAgentSkin(preference, tone);
    const element = useRef<HTMLDivElement>(null);
    const maxWidth = Math.max(120, Math.min(MAX_BUBBLE_WIDTH, viewport.width - 2 * (AGENT_PET_BUBBLE_MARGIN + AGENT_PET_BUBBLE_BULGE)));
    const [size, setSize] = useState<{ width: number; height: number; key: string } | null>(null);
    const measureKey = `${maxWidth}:${skin}:${text}`;
    useLayoutEffect(() => {
        const node = element.current;
        if (!node) return;
        const rect = node.getBoundingClientRect();
        setSize({ width: Math.ceil(rect.width), height: Math.ceil(rect.height), key: measureKey });
    }, [measureKey]);

    const measured = size?.key === measureKey ? size : null;
    const layout = measured ? layoutAgentPetBubble(anchor, measured, viewport) : null;
    const style: CSSProperties = layout ? { left: layout.left, top: layout.top, maxWidth, transformOrigin: `${layout.tail.tipX}px ${layout.tail.tipY}px` } : { left: -10000, top: -10000, maxWidth, visibility: "hidden" };
    const cloud = measured
        ? skin === "cloud" || skin === "site"
            ? agentPetCloudPath(measured.width, measured.height)
            : `M 8 0 H ${measured.width - 8} Q ${measured.width} 0 ${measured.width} 8 V ${measured.height - 8} Q ${measured.width} ${measured.height} ${measured.width - 8} ${measured.height} H 8 Q 0 ${measured.height} 0 ${measured.height - 8} V 8 Q 0 0 8 0 Z`
        : "";
    const tail = layout ? agentPetBubbleTailPath(layout) : "";
    return (
        <div
            ref={element}
            className={layout ? "agent-pet-bubble is-shown" : "agent-pet-bubble"}
            style={{ ...style, "--agent-skin-accent": preference === "auto" && accent ? accent : agentSkinAccent(skin) || "var(--foreground)" } as CSSProperties}
            data-skin={skin}
            data-placement={layout?.placement}
            data-canvas-no-zoom
            role="status"
            aria-live="polite"
            title="点击收起"
            onClick={onDismiss}
            onPointerDown={(event) => event.stopPropagation()}
        >
            {measured && layout ? (
                <svg className="agent-pet-bubble-shape" width={measured.width} height={measured.height} viewBox={`0 0 ${measured.width} ${measured.height}`} aria-hidden="true" focusable="false">
                    {/* 先画加粗描边、再盖白色填充：云朵和尾巴连成一个轮廓，接缝处没有描边。 */}
                    <g className="agent-pet-bubble-outline">
                        <path d={cloud} />
                        <path d={tail} />
                    </g>
                    <g className="agent-pet-bubble-fill">
                        <path d={cloud} />
                        <path d={tail} />
                    </g>
                </svg>
            ) : null}
            <span className="agent-pet-bubble-text">{text}</span>
        </div>
    );
}
