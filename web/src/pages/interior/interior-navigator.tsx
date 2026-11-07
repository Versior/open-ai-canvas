import { Box, Image, Layers } from "lucide-react";
import type { InteriorCatalog, InteriorSurface } from "@/services/api/interior";

export type InteriorWorkspace = "images" | "scene" | "materials";

export function InteriorWorkspaceRail({ workspace, disabled, onChange }: { workspace: InteriorWorkspace; disabled: boolean; onChange: (workspace: InteriorWorkspace) => void }) {
    return (
        <nav className="itd-workspace-rail" aria-label="室内设计工作台">
            {[
                { id: "scene" as const, icon: Box, title: "3D 模型", label: "模型" },
                { id: "images" as const, icon: Image, title: "效果图", label: "效果" },
                { id: "materials" as const, icon: Layers, title: "装修 / 石材", label: "选材" },
            ].map(({ id, icon: Icon, title, label }) => (
                <button key={id} type="button" aria-label={title} title={title} aria-pressed={workspace === id} disabled={disabled} onClick={() => onChange(id)}>
                    <Icon size={18} aria-hidden />
                    <span>{label}</span>
                </button>
            ))}
        </nav>
    );
}

export function availableInteriorTasks(catalog: InteriorCatalog, surface: InteriorSurface) {
    return catalog.modes.filter((mode) => mode.enabled && (catalog.settings.allowSurfaceSwitch || mode.audience === "both" || mode.audience === surface));
}
