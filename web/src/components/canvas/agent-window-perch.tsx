import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useAgentPetChatter } from "@/hooks/use-agent-pet-chatter";
import { agentAvatarClipForState, agentAvatarStateForRunStatus, DEFAULT_CANVAS_APPEARANCE, isAgentAvatarBundleManifest, type AgentAvatarBundleManifest } from "@/lib/canvas/agent-appearance";
import { agentAvatarBundleFileURL } from "@/services/api/appearance";
import { agentPetSpritesheetURL, type AgentPet } from "@/services/api/agent-pets";
import { useAppearanceStore } from "@/stores/use-appearance-store";
import { AgentAvatarVideo } from "./agent-avatar-video";
import { AgentPetSprite, useAgentPetSheetMetrics } from "./agent-pet-sprite";

/** 窗沿形象空闲后缩回；首页复用同一形象和动作，保持全身展示。 */
export function AgentWindowPerch({ pet, status, reducedMotion, display = "perch" }: { pet: AgentPet | null; status: string; reducedMotion: boolean; display?: "perch" | "full" }) {
    const appearance = useAppearanceStore((store) => store.appearance.canvas) || DEFAULT_CANVAS_APPEARANCE;
    const revision = useAppearanceStore((store) => store.appearance.revision);
    const [manifest, setManifest] = useState<AgentAvatarBundleManifest | null>(null);
    const [failed, setFailed] = useState(false);
    const [videoBounds, setVideoBounds] = useState<{ top: number; aspect: number }>();
    const [hovered, setHovered] = useState(false);
    const [focused, setFocused] = useState(false);
    const [settled, setSettled] = useState(true);
    const [speaking, setSpeaking] = useState(false);
    const actionTimer = useRef(0);
    const state = agentAvatarStateForRunStatus(status);
    const chatter = useAgentPetChatter({ pet, state, approvalPending: state === "waiting_approval", active: Boolean(pet) && display === "perch", hovered });
    const spriteUrl = pet ? agentPetSpritesheetURL(pet) : "";
    const { headTop } = useAgentPetSheetMetrics(spriteUrl, pet?.spriteVersion ?? 2);
    const resting = state !== "running" && state !== "queued" && state !== "waiting_approval";
    const awake = !resting || hovered || focused || speaking || Boolean(chatter.message);
    const expanded = display === "full" || awake || !settled;
    useEffect(() => {
        if (awake || display === "full") {
            setSettled(false);
            return;
        }
        const timer = window.setTimeout(() => setSettled(true), 4000);
        return () => window.clearTimeout(timer);
    }, [awake, state, pet?.id, display]);
    const bundle = !pet && appearance.avatarType === "bundle";
    const manifestUrl = appearance.avatarBundleResourceId ? agentAvatarBundleFileURL(appearance.avatarBundleResourceId, "avatar.json", false, revision) : "/doll/avatar.json";
    useEffect(() => {
        setManifest(null);
        setVideoBounds(undefined);
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
    const clip = manifest ? (speaking && manifest.clips.talk ? "talk" : hovered && resting && manifest.clips.wave ? "wave" : agentAvatarClipForState(appearance, state, manifest)) : "";
    const file = manifest?.clips[clip];
    const media = file ? (appearance.avatarBundleResourceId ? agentAvatarBundleFileURL(appearance.avatarBundleResourceId, file, false, revision) : `/doll/${encodeURIComponent(file)}`) : "";
    if ((!pet && !media) || failed) return null;
    const message = display === "perch" ? chatter.message?.text || (speaking ? "我在这里。下一步一起完成。" : "") : "";
    const contentHeight = videoBounds ? Math.min(112, 104 / videoBounds.aspect) : 112;
    const mediaTop = pet ? headTop * 112 : videoBounds ? (112 - contentHeight) / 2 + videoBounds.top * contentHeight : 112 * 0.12;
    return (
        <div
            className="agent-window-perch"
            data-display={display}
            data-expanded={expanded}
            data-action={speaking ? "talk" : state}
            style={{ "--agent-perch-head-top": `${mediaTop}px` } as CSSProperties}
            data-canvas-no-zoom
            onPointerDown={(event) => event.stopPropagation()}
        >
            {message ? (
                <button
                    type="button"
                    className="agent-perch-bubble"
                    aria-label="收起角色台词"
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
                aria-label={`${pet?.name || appearance.agentName} · ${display === "full" ? "形象预览" : "说句话"}`}
                onPointerEnter={() => setHovered(true)}
                onPointerLeave={() => setHovered(false)}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                onClick={(event) => {
                    speak();
                    if (event.detail > 0) event.currentTarget.blur();
                }}
                onKeyDown={(event) => {
                    if (event.key === "Escape") {
                        setSpeaking(false);
                        setHovered(false);
                        setFocused(false);
                        chatter.dismiss();
                        event.currentTarget.blur();
                    }
                }}
            >
                <span className="agent-perch-media">
                    {pet ? (
                        <AgentPetSprite
                            src={spriteUrl}
                            version={pet.spriteVersion}
                            state={state}
                            stateRows={pet.stateRows}
                            width={104}
                            height={112}
                            row={speaking && resting ? "jumping" : undefined}
                            reducedMotion={reducedMotion}
                            pixelated={pet.pixelated}
                            hovered={hovered}
                            paused={!expanded}
                            onError={() => setFailed(true)}
                        />
                    ) : (
                        <AgentAvatarVideo src={media} reducedMotion={reducedMotion} paused={!expanded} loop={!speaking} onContentBounds={setVideoBounds} onError={() => setFailed(true)} />
                    )}
                </span>
            </button>
        </div>
    );
}
