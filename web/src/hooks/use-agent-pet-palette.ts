import { useEffect, useState } from "react";
import { cachedAgentPetMetrics, detectAgentPetMetrics, agentPetSheetRows } from "@/lib/canvas/agent-pet";
import { agentPetSpritesheetURL, type AgentPet } from "@/services/api/agent-pets";

export function useAgentPetPalette(pet: AgentPet | null, enabled: boolean) {
    const src = pet && enabled ? agentPetSpritesheetURL(pet) : "";
    const [palette, setPalette] = useState<{ src: string; accent?: string }>();
    useEffect(() => {
        let alive = true;
        if (src && pet)
            void detectAgentPetMetrics(src, agentPetSheetRows(pet.spriteVersion))
                .then((metrics) => {
                    if (alive) setPalette({ src, accent: metrics.accent });
                })
                .catch(() => {
                    if (alive) setPalette({ src });
                });
        return () => {
            alive = false;
        };
    }, [src, pet?.spriteVersion]);
    return src ? (palette?.src === src ? palette.accent : cachedAgentPetMetrics(src)?.accent) : undefined;
}
