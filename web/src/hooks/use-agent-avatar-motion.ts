import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentAvatarBundleManifest, AgentAvatarState } from "@/lib/canvas/agent-appearance";

/** 动画包待机轮换与互动；任务动作优先，一次动作结束后回待机，隐藏时取消调度。 */
export function useAgentAvatarMotion({
    manifest,
    state,
    stateClip,
    idleClip,
    paused,
    reducedMotion,
    engaged,
}: {
    manifest: AgentAvatarBundleManifest | null;
    state: AgentAvatarState;
    stateClip: string;
    idleClip: string;
    paused: boolean;
    reducedMotion: boolean;
    engaged: boolean;
}) {
    const [hidden, setHidden] = useState(() => document.hidden);
    const [activity, setActivity] = useState<{ clip: string; id: number } | null>(null);
    const [settled, setSettled] = useState(false);
    const sequence = useRef(0);
    const cursor = useRef(0);
    const lastInteraction = useRef(0);
    const terminal = ["completed", "failed", "cancelled", "rejected"].includes(state);
    const resting = state === "idle" || (terminal && settled);
    const enabled = Boolean(manifest) && !paused && !reducedMotion && !hidden;
    const variant = useCallback(
        (names: string[]) => {
            const clips = Object.keys(manifest?.clips ?? {});
            return names.map((name) => clips.find((clip) => clip.toLowerCase().replace(/[^a-z0-9]/g, "") === name)).filter((clip): clip is string => Boolean(clip) && clip !== idleClip);
        },
        [manifest, idleClip],
    );
    useEffect(() => {
        const update = () => setHidden(document.hidden);
        document.addEventListener("visibilitychange", update);
        return () => document.removeEventListener("visibilitychange", update);
    }, []);
    useEffect(() => {
        setActivity(null);
        setSettled(false);
        cursor.current = 0;
        lastInteraction.current = 0;
    }, [state, manifest]);
    useEffect(() => {
        if (!enabled) setActivity(null);
    }, [enabled]);
    const interact = useCallback(() => {
        if (!enabled || !resting) return;
        const choices = variant(["wave", "talk", "think"]);
        if (!choices.length) return;
        lastInteraction.current = Date.now();
        setActivity({ clip: choices[sequence.current % choices.length], id: ++sequence.current });
    }, [enabled, resting, variant]);
    useEffect(() => {
        if (engaged && Date.now() - lastInteraction.current >= 10_000) interact();
    }, [engaged, interact]);
    useEffect(() => {
        if (!enabled || !resting || activity || engaged) return;
        const choices = variant(["think", "wave", "liedown", "talk", "sleep"]);
        if (!choices.length) return;
        const timer = window.setTimeout(
            () => {
                setActivity({ clip: choices[cursor.current++ % choices.length], id: ++sequence.current });
            },
            6000 + Math.random() * 3000,
        );
        return () => window.clearTimeout(timer);
    }, [enabled, resting, activity, engaged, variant]);
    const clip = enabled && resting && activity ? activity.clip : terminal && settled ? idleClip : stateClip;
    const onEnded = useCallback(() => {
        if (activity) {
            const action = activity.clip.toLowerCase().replace(/[^a-z0-9]/g, "");
            const next = variant(action === "liedown" ? ["sleeploop"] : action === "sleeploop" || action === "sleep" ? ["wakeup"] : []);
            setActivity(next.length ? { clip: next[0], id: ++sequence.current } : null);
        } else if (terminal) setSettled(true);
    }, [activity, terminal, variant]);
    return { clip, key: `${clip}:${activity?.id ?? 0}`, loop: !activity && !(terminal && !settled), onEnded, interact };
}
