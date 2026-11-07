import { useEffect, useRef, useState } from "react";
import { useAgentPetChatter } from "@/hooks/use-agent-pet-chatter";
import { agentAvatarClipForState, agentAvatarStateForRunStatus, DEFAULT_CANVAS_APPEARANCE, isAgentAvatarBundleManifest, type AgentAvatarBundleManifest } from "@/lib/canvas/agent-appearance";
import { agentAvatarBundleFileURL } from "@/services/api/appearance";
import { agentPetSpritesheetURL, type AgentPet } from "@/services/api/agent-pets";
import { useAppearanceStore } from "@/stores/use-appearance-store";
import { AgentAvatarVideo } from "./agent-avatar-video";
import { AgentPetSprite, useAgentPetSheetMetrics } from "./agent-pet-sprite";

/** 输入框上方露头；悬停或主动点击时在独立区域展开全身，不覆盖正文与输入。 */
export function AgentWindowPerch({ pet, status, reducedMotion }: { pet: AgentPet | null; status: string; reducedMotion: boolean }) {
    const appearance = useAppearanceStore((store) => store.appearance.canvas) || DEFAULT_CANVAS_APPEARANCE;
    const revision = useAppearanceStore((store) => store.appearance.revision);
    const [manifest, setManifest] = useState<AgentAvatarBundleManifest | null>(null);
    const [failed, setFailed] = useState(false);
    const [hovered, setHovered] = useState(false);
    const [speaking, setSpeaking] = useState(false);
    const [focused, setFocused] = useState(false);
    const expanded = hovered || focused || speaking;
    const actionTimer = useRef(0);
    const state = agentAvatarStateForRunStatus(status);
    const chatter = useAgentPetChatter({ pet, state, approvalPending: state === "waiting_approval", active: Boolean(pet), hovered });
    const spriteUrl = pet ? agentPetSpritesheetURL(pet) : "";
    const { headTop } = useAgentPetSheetMetrics(spriteUrl, pet?.spriteVersion || 1);
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
        setSpeaking(false);
        window.clearTimeout(actionTimer.current);
    }, [pet?.id, manifestUrl, status]);
    useEffect(() => () => window.clearTimeout(actionTimer.current), []);
    const speak = () => {
        setSpeaking(true);
        chatter.speak();
        window.clearTimeout(actionTimer.current);
        actionTimer.current = window.setTimeout(() => setSpeaking(false), 3500);
    };
    const clip = manifest ? (speaking && manifest.clips.talk ? "talk" : expanded && state === "idle" && manifest.clips.wave ? "wave" : agentAvatarClipForState(appearance, state, manifest)) : "";
    const file = manifest?.clips[clip];
    const media = file ? (appearance.avatarBundleResourceId ? agentAvatarBundleFileURL(appearance.avatarBundleResourceId, file, false, revision) : `/doll/${encodeURIComponent(file)}`) : "";
    if ((!pet && !media) || failed) return null;
    const message = chatter.message?.text || (expanded ? "我在这里。点我，聊一句。" : "");
    return (
        <div className="agent-window-perch" data-expanded={expanded} data-action={speaking ? "talk" : expanded ? "wave" : "rest"} data-canvas-no-zoom onPointerDown={(event) => event.stopPropagation()}>
            {message ? (
                <button
                    type="button"
                    className="agent-perch-bubble"
                    aria-label="收起角色台词"
                    title={message}
                    onClick={() => {
                        chatter.dismiss();
                        setSpeaking(false);
                    }}
                >
                    {message}
                </button>
            ) : null}
            <button
                className="agent-perch-character"
                type="button"
                aria-label={`${pet?.name || appearance.agentName} · 说句话`}
                aria-expanded={expanded}
                title="悬停看全身，点击听一句"
                onPointerEnter={() => setHovered(true)}
                onPointerLeave={() => setHovered(false)}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                onClick={speak}
                onKeyDown={(event) => {
                    if (event.key === "Escape") {
                        setSpeaking(false);
                        setFocused(false);
                        setHovered(false);
                        chatter.dismiss();
                        event.currentTarget.blur();
                    }
                }}
            >
                <span className="agent-perch-media" style={{ top: expanded ? 0 : pet ? -headTop * 112 : -12 }}>
                    {pet ? (
                        <AgentPetSprite
                            src={spriteUrl}
                            version={pet.spriteVersion}
                            state={state}
                            stateRows={pet.stateRows}
                            width={104}
                            height={112}
                            row={expanded && state === "idle" ? "waving" : undefined}
                            reducedMotion={reducedMotion}
                            pixelated={pet.pixelated}
                            hovered={hovered}
                            onError={() => setFailed(true)}
                        />
                    ) : (
                        <AgentAvatarVideo src={media} reducedMotion={reducedMotion} loop={!speaking} onError={() => setFailed(true)} />
                    )}
                </span>
            </button>
        </div>
    );
}
