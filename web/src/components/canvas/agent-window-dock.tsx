import type { ReactNode } from "react";

/** Attach the character to the input ledge without changing message or input layout. */
export function AgentWindowDock({ children }: { children: ReactNode }) {
    return <div className="agent-window-dock">{children}</div>;
}
