import { createRoot } from "react-dom/client";
import { App, ConfigProvider } from "antd";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { AgentPetBubble } from "@/components/canvas/agent-pet-bubble";
import { AgentPetSprite } from "@/components/canvas/agent-pet-sprite";
import { useActiveAgentPet } from "@/hooks/use-active-agent-pet";
import { CreationMessageView } from "@/pages/create/creation-workspace-messages";
import { getAuthSession } from "@/services/api/auth";
import { agentPetSpritesheetURL } from "@/services/api/agent-pets";
import { useUserStore } from "@/stores/use-user-store";
import { useAgentPetPrefsStore } from "@/stores/use-agent-pet-prefs-store";
import { AGENT_SKINS } from "@/lib/canvas/agent-skin";
import { applySkinTheme, DEFAULT_CLASSIC_SKIN } from "@/lib/skin-themes";
import "@/styles/globals.css";
import "@/components/canvas/canvas-cloud-agent.css";

const session = await getAuthSession();
useUserStore.setState({ user: session.user });
applySkinTheme(DEFAULT_CLASSIC_SKIN, "light");
function PetUI() {
    const { pet } = useActiveAgentPet();
    return (
        <>
            <div style={{ width: 500, margin: 40 }}>
                <CreationMessageView
                    item={{ id: "qa-message", role: "assistant", content: "静态头像与当前形象一致。", status: "done", createdAt: new Date().toISOString(), mode: "text" }}
                    shotNumber={0}
                    onRetryFailure={() => {}}
                    onRefreshResult={() => {}}
                    onRecoverMedia={() => {}}
                    onCreateVariant={() => {}}
                    onEditUserMessage={() => {}}
                    onContinueCanvas={() => {}}
                    openingCanvas={false}
                />
                {AGENT_SKINS.map((skin) => (
                    <button key={skin.id} onClick={() => useAgentPetPrefsStore.getState().setSkin(skin.id)}>
                        {skin.label}
                    </button>
                ))}
            </div>
            {pet ? (
                <div style={{ position: "fixed", left: 700, top: 400 }}>
                    <AgentPetSprite src={agentPetSpritesheetURL(pet)} version={pet.spriteVersion} state="idle" width={96} height={104} stateRows={pet.stateRows} label="待机形象" />
                </div>
            ) : null}
            <AgentPetBubble text="气泡文字需要清楚可读。" anchor={{ left: 700, top: 400, width: 96, height: 104, headTop: 0.12 }} viewport={{ width: 1440, height: 1000 }} onDismiss={() => {}} tone={pet?.tone} />
        </>
    );
}
createRoot(document.getElementById("root")!).render(
    <ConfigProvider>
        <QueryClientProvider client={new QueryClient()}>
            <App>
                <MemoryRouter>
                    <PetUI />
                </MemoryRouter>
            </App>
        </QueryClientProvider>
    </ConfigProvider>,
);
