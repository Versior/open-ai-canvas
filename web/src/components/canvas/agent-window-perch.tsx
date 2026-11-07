import { useEffect, useRef, useState } from "react";
import { Hand, MessageCircle, Sparkles } from "lucide-react";
import { useAgentPetChatter } from "@/hooks/use-agent-pet-chatter";
import { agentAvatarClipForState, agentAvatarStateForRunStatus, DEFAULT_CANVAS_APPEARANCE, isAgentAvatarBundleManifest, type AgentAvatarBundleManifest } from "@/lib/canvas/agent-appearance";
import { agentAvatarBundleFileURL } from "@/services/api/appearance";
import { agentPetSpritesheetURL, type AgentPet, type AgentPetRow } from "@/services/api/agent-pets";
import { useAppearanceStore } from "@/stores/use-appearance-store";
import { AgentAvatarVideo } from "./agent-avatar-video";
import { AgentPetSprite } from "./agent-pet-sprite";

/** 图集用原生动作探出窗沿；视频包有 lie_down 时播放真正的趴姿。 */
export function AgentWindowPerch({ pet, status, reducedMotion }: { pet: AgentPet | null; status: string; reducedMotion: boolean }) {
    const appearance = useAppearanceStore((store) => store.appearance.canvas) || DEFAULT_CANVAS_APPEARANCE;
    const revision = useAppearanceStore((store) => store.appearance.revision);
    const [manifest, setManifest] = useState<AgentAvatarBundleManifest | null>(null);
    const [failed, setFailed] = useState(false);
    const [hovered, setHovered] = useState(false);
    const [action, setAction] = useState<"wave" | "jump" | "talk" | null>(null);
    const [dismissedState, setDismissedState] = useState("");
    const actionTimer = useRef(0);
    const state = agentAvatarStateForRunStatus(status);
    const chatter = useAgentPetChatter({ pet, state, approvalPending: state === "waiting_approval", active: Boolean(pet), hovered });
    const bundle = !pet && appearance.avatarType === "bundle";
    const manifestUrl = appearance.avatarBundleResourceId ? agentAvatarBundleFileURL(appearance.avatarBundleResourceId, "avatar.json", false, revision) : "/doll/avatar.json";
    useEffect(() => {
        setManifest(null);
        if (!bundle) return;
        const controller = new AbortController();
        void fetch(manifestUrl, { credentials: "include", signal: controller.signal })
            .then(async (response) => {
                if (!response.ok) throw new Error("形象动作读取失败");
                const value: unknown = await response.json();
                if (!isAgentAvatarBundleManifest(value)) throw new Error("形象动作格式错误");
                if (!controller.signal.aborted) setManifest(value);
            })
            .catch((error: unknown) => {
                if (!controller.signal.aborted) console.warn("窗沿形象无法加载", error);
            });
        return () => controller.abort();
    }, [bundle, manifestUrl]);
    useEffect(() => {
        setFailed(false);
        setAction(null);
        window.clearTimeout(actionTimer.current);
    }, [pet?.id, manifestUrl, status]);
    useEffect(() => () => window.clearTimeout(actionTimer.current), []);
    const play = (next: NonNullable<typeof action>) => {
        setAction(next);
        if (next === "talk") chatter.speak();
        window.clearTimeout(actionTimer.current);
        actionTimer.current = window.setTimeout(() => setAction(null), 3500);
    };
    const spriteAction: AgentPetRow | undefined = action === "wave" ? "waving" : action === "jump" ? "jumping" : undefined;
    const resting = state === "idle" || state === "cancelled" || state === "completed";
    const clip = manifest ? (action && manifest.clips[action] ? action : resting && manifest.clips.lie_down ? "lie_down" : agentAvatarClipForState(appearance, state, manifest)) : "";
    const file = manifest?.clips[clip];
    const media = file ? (appearance.avatarBundleResourceId ? agentAvatarBundleFileURL(appearance.avatarBundleResourceId, file, false, revision) : `/doll/${encodeURIComponent(file)}`) : "";
    if ((!pet && !media) || failed) return null;
    const message = chatter.message?.text || (action === "talk" ? "我在这里，继续把想法告诉我吧。" : state === "waiting_approval" ? "有一步需要你确认。" : state === "running" ? "正在处理，进度在对话里。" : "");
    return (
        <div className="agent-window-perch" data-action={action || "rest"} data-canvas-no-zoom onPointerDown={(event) => event.stopPropagation()} onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)}>
            <button className="agent-perch-character" type="button" aria-label={`${pet?.name || appearance.agentName} · 打招呼`} title="点我打招呼" onClick={() => play("wave")}>
                {pet ? (
                    <AgentPetSprite
                        src={agentPetSpritesheetURL(pet)}
                        version={pet.spriteVersion}
                        state={state}
                        stateRows={pet.stateRows}
                        width={72}
                        height={78}
                        row={spriteAction}
                        reducedMotion={reducedMotion}
                        pixelated={pet.pixelated}
                        hovered={hovered}
                        onError={() => setFailed(true)}
                    />
                ) : (
                    <AgentAvatarVideo src={media} reducedMotion={reducedMotion} loop={!action && clip !== "lie_down"} onError={() => setFailed(true)} />
                )}
            </button>
            <div className="agent-perch-actions" role="group" aria-label="角色互动">
                <button type="button" aria-label="打招呼" title="打招呼" onClick={() => play("wave")}>
                    <Hand size={13} aria-hidden />
                </button>
                <button type="button" aria-label="跳一下" title="跳一下" onClick={() => play("jump")}>
                    <Sparkles size={13} aria-hidden />
                </button>
                <button type="button" aria-label="说句话" title="说句话" onClick={() => play("talk")}>
                    <MessageCircle size={13} aria-hidden />
                </button>
            </div>
            {message && (action || chatter.message || dismissedState !== status) ? (
                <button
                    type="button"
                    className="agent-perch-bubble"
                    aria-label="收起角色气泡"
                    title={message}
                    onClick={() => {
                        chatter.dismiss();
                        setAction(null);
                        setDismissedState(status);
                    }}
                >
                    {message}
                </button>
            ) : null}
        </div>
    );
}
