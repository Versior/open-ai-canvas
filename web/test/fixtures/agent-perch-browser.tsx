import { createRoot } from "react-dom/client";
import { App } from "antd";
import { useState } from "react";
import { AgentChatComposer } from "@/components/canvas/canvas-cloud-agent-composer";
import { AgentWindowDock } from "@/components/canvas/agent-window-dock";
import { AgentWindowPerch } from "@/components/canvas/agent-window-perch";
import { canvasThemes } from "@/lib/canvas-theme";
import { useAgentPetPrefsStore } from "@/stores/use-agent-pet-prefs-store";
import { useAppearanceStore } from "@/stores/use-appearance-store";
import type { AgentPet } from "@/services/api/agent-pets";
import "@/styles/globals.css";
import "@/components/canvas/agent-skin-scene.css";

useAgentPetPrefsStore.setState({ chatter: false });
const pet = { id: "pingo", name: "Pingo", spriteVersion: 2, revision: "1", pixelated: false, stateRows: {}, lines: [] } as unknown as AgentPet;
const video = new URLSearchParams(location.search).get("video");
if (video) useAppearanceStore.setState((state) => ({ appearance: { ...state.appearance, canvas: { ...state.appearance.canvas!, avatarType: "bundle", avatarBundleResourceId: video === "wide" ? "synthetic-wide-avatar" : "" } } }));
function Harness() {
    const [prompt, setPrompt] = useState("");
    const [status, setStatus] = useState("idle");
    return (
        <App>
            <main className="canvas-agent-panel" data-skin="cloud" style={{ maxWidth: 640, margin: "160px auto 0", padding: 16 }}>
                <button id="work" onClick={() => setStatus("running")}>
                    开始工作
                </button>
                <div id="history" style={{ height: 220 }}>
                    已保存的对话
                </div>
                <AgentChatComposer
                    prompt={prompt}
                    onPromptChange={setPrompt}
                    onSubmit={() => {}}
                    placeholder="说说要做什么"
                    theme={canvasThemes.light}
                    character={
                        <AgentWindowDock>
                            <AgentWindowPerch pet={video ? null : pet} status={status} reducedMotion />
                        </AgentWindowDock>
                    }
                />
            </main>
        </App>
    );
}
createRoot(document.getElementById("root")!).render(<Harness />);
