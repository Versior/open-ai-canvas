import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { AgentAvatarState } from "@/lib/canvas/agent-appearance";
import { agentPetBubbleDuration, agentPetGreeting, agentPetIdleLine, agentPetPersona, agentPetStateLine } from "@/lib/canvas/agent-pet-lines";
import { loadAgentPetReminderContext } from "@/services/agent-pet-reminders";
import type { AgentPet } from "@/services/api/agent-pets";
import { useAgentPetBubbleStore } from "@/stores/use-agent-pet-bubble-store";
import { useUserStore } from "@/stores/use-user-store";

export type AgentPetBubbleMessage = { id: string; text: string; sticky: boolean };

const GREETING_DELAY_MS = 2500;
const IDLE_MIN_MS = 4 * 60_000;
const IDLE_MAX_MS = 7 * 60_000;
const HOVER_COOLDOWN_MS = 15_000;
const LONG_SESSION_MINUTES = 60;

let messageSeq = 0;

/**
 * 决定头顶气泡说什么、什么时候说：
 * - 待审批时一直提示（不受闲聊开关影响），点击可收起；
 * - 打开页面后问候一次，之后每 4–7 分钟随机说一句（时间、灵感、未完成项目、贴心话、专属台词）；
 * - 运行开始、完成、失败等状态变化时说一句；悬停时偶尔说一句；
 * - 面板打开、形象收起或页面隐藏时不说话。
 */
export function useAgentPetChatter({ pet, state, approvalPending, active, hovered }: { pet: AgentPet | null; state: AgentAvatarState; approvalPending: boolean; active: boolean; hovered: boolean }) {
    const chatter = useAgentPetBubbleStore((store) => store.chatter);
    const userId = useUserStore((store) => store.user?.id || "");
    const shortDramaEnabled = useUserStore((store) => store.features.shortDramaEnabled);
    const petId = pet?.id ?? "";
    const petName = pet?.name ?? "";
    const petTone = pet?.tone ?? "";
    const petLines = pet?.lines.join("\n") ?? "";
    const persona = useMemo(() => (petId ? agentPetPersona({ name: petName, tone: petTone, lines: petLines ? petLines.split("\n") : [] }) : null), [petId, petName, petTone, petLines]);

    const [message, setMessage] = useState<AgentPetBubbleMessage | null>(null);
    const messageRef = useRef(message);
    useEffect(() => {
        messageRef.current = message;
    }, [message]);
    const hideTimer = useRef(0);
    const recent = useRef<string[]>([]);
    const startedAt = useRef(Date.now());
    const lastLongReminder = useRef(0);
    const lastHover = useRef(0);
    const greeted = useRef(false);

    const show = useCallback((text: string, sticky = false) => {
        window.clearTimeout(hideTimer.current);
        recent.current = [text, ...recent.current].slice(0, 8);
        messageSeq += 1;
        const id = `agent-pet-bubble-${messageSeq}`;
        setMessage({ id, text, sticky });
        if (!sticky) hideTimer.current = window.setTimeout(() => setMessage((current) => (current?.id === id ? null : current)), agentPetBubbleDuration(text));
    }, []);
    const dismiss = useCallback(() => {
        window.clearTimeout(hideTimer.current);
        setMessage(null);
    }, []);

    useEffect(() => () => window.clearTimeout(hideTimer.current), []);
    useEffect(() => {
        window.clearTimeout(hideTimer.current);
        setMessage(null);
    }, [persona]);

    // 待审批：常驻提示；审批结束后收起。
    useEffect(() => {
        if (!persona || !active) return;
        if (approvalPending) {
            const line = agentPetStateLine(persona, "waiting_approval");
            if (line) show(line.text, true);
        } else {
            setMessage((current) => (current?.sticky ? null : current));
        }
    }, [persona, active, approvalPending, show]);

    // 状态变化时说一句。
    const previousState = useRef(state);
    useEffect(() => {
        const previous = previousState.current;
        previousState.current = state;
        if (!persona || !active || !chatter || previous === state || approvalPending || state === "idle" || state === "waiting_approval") return;
        const line = agentPetStateLine(persona, state);
        if (line) show(line.text);
    }, [persona, active, chatter, approvalPending, state, show]);

    // 打开页面后问候一次。
    useEffect(() => {
        if (!persona || !active || !chatter || greeted.current) return;
        const timer = window.setTimeout(() => {
            greeted.current = true;
            if (!messageRef.current) show(agentPetGreeting(persona, new Date()).text);
        }, GREETING_DELAY_MS);
        return () => window.clearTimeout(timer);
    }, [persona, active, chatter, show]);

    // 空闲时隔一段时间说一句。
    useEffect(() => {
        if (!persona || !active || !chatter) return;
        let timer = 0;
        let cancelled = false;
        const schedule = () => {
            timer = window.setTimeout(() => void tick(), IDLE_MIN_MS + Math.random() * (IDLE_MAX_MS - IDLE_MIN_MS));
        };
        const tick = async () => {
            if (cancelled) return;
            if (document.hidden || messageRef.current) {
                schedule();
                return;
            }
            const context = userId ? await loadAgentPetReminderContext(userId, { shortDramaEnabled }).catch(() => ({})) : {};
            if (cancelled) return;
            const minutes = Math.floor((Date.now() - startedAt.current) / 60_000);
            const longDue = minutes >= LONG_SESSION_MINUTES && Date.now() - lastLongReminder.current >= LONG_SESSION_MINUTES * 60_000;
            if (longDue) lastLongReminder.current = Date.now();
            if (!messageRef.current) show(agentPetIdleLine(persona, { now: new Date(), context, longSessionMinutes: longDue ? minutes : undefined, recent: recent.current }).text);
            schedule();
        };
        schedule();
        return () => {
            cancelled = true;
            window.clearTimeout(timer);
        };
    }, [persona, active, chatter, userId, shortDramaEnabled, show]);

    // 悬停时偶尔说一句专属台词或贴心话。
    useEffect(() => {
        if (!hovered || !persona || !active || !chatter || messageRef.current || Date.now() - lastHover.current < HOVER_COOLDOWN_MS) return;
        lastHover.current = Date.now();
        show(agentPetIdleLine(persona, { now: new Date(), recent: recent.current, kinds: ["signature", "care"] }).text);
    }, [hovered, persona, active, chatter, show]);

    // 不可见时清掉普通消息；待审批提示在重新可见时由上面的副作用补回。
    useEffect(() => {
        if (active) return;
        window.clearTimeout(hideTimer.current);
        setMessage(null);
    }, [active]);

    return { message: active ? message : null, dismiss };
}
