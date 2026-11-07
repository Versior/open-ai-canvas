import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Attach the character to the input ledge without changing message or input layout. */
export function AgentWindowDock({ children }: { children: ReactNode }) {
    const anchorRef = useRef<HTMLDivElement>(null);
    const [dock, setDock] = useState<{ panel: HTMLElement; side: "left" | "right" | "inside"; bottom: number } | null>(null);
    useLayoutEffect(() => {
        const anchor = anchorRef.current;
        const panel = anchor?.closest<HTMLElement>(".canvas-agent-panel");
        if (!anchor || !panel) return;
        const measure = () => {
            const bounds = panel.getBoundingClientRect();
            const side = window.innerWidth - bounds.right >= 188 ? "right" : bounds.left >= 188 ? "left" : "inside";
            const bottom = Math.round(bounds.bottom - anchor.getBoundingClientRect().top);
            setDock((current) => (current?.panel === panel && current.side === side && current.bottom === bottom ? current : { panel, side, bottom }));
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(panel);
        if (anchor.parentElement) observer.observe(anchor.parentElement);
        const movement = new MutationObserver(measure);
        movement.observe(panel, { attributes: true, attributeFilter: ["style"] });
        window.addEventListener("resize", measure);
        return () => {
            observer.disconnect();
            movement.disconnect();
            window.removeEventListener("resize", measure);
        };
    }, []);
    return (
        <>
            <div ref={anchorRef} className="agent-perch-anchor" aria-hidden="true" />
            {dock
                ? createPortal(
                      <div className="agent-window-dock" data-side={dock.side} style={{ bottom: dock.bottom }}>
                          {children}
                      </div>,
                      dock.panel,
                  )
                : null}
        </>
    );
}
