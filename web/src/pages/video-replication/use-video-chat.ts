import { useEffect, useRef, useState } from "react";
import { buildGenerationConfig } from "@/lib/canvas/canvas-project-generation";
import { videoTeardownTextRequirements } from "@/lib/canvas/video-teardown";
import { buildVideoChatPrompt, parseVideoChatReply, type VideoChatContext, type VideoChatTurn } from "@/lib/remake/video-chat";
import { getActiveUserScope } from "@/lib/user-scope";
import { runBackendGenerationTask } from "@/services/api/generation-task";
import type { AiConfig } from "@/stores/use-config-store";
import { replicaScriptModelError } from "./replication-script";
import type { useVideoChatHistory } from "./use-video-chat-history";

export const videoChatDependencies = { run: runBackendGenerationTask };

export function useVideoChat(config: AiConfig, model: string, context: VideoChatContext, onResult: (value: ReturnType<typeof parseVideoChatReply>) => void, history: ReturnType<typeof useVideoChatHistory>) {
    const { turns, setTurns } = history;
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const controller = useRef<AbortController | null>(null);
    const scope = getActiveUserScope();
    useEffect(() => () => controller.current?.abort(), [scope]);
    const say = (role: VideoChatTurn["role"], text: string) => setTurns((items) => [...items, { role, text }]);
    const send = async (text: string) => {
        if (controller.current || !history.ready) return false;
        const problem = scope === "guest" ? "请先登录，再和视频导演聊聊" : !model ? "请选择视频导演模型" : replicaScriptModelError(config, model);
        if (problem) {
            setError(problem);
            return false;
        }
        const current = new AbortController();
        controller.current = current;
        const last = turns.at(-1);
        const next = last?.role === "user" && last.text === text ? turns : [...turns, { role: "user" as const, text }];
        setTurns(() => next);
        setBusy(true);
        setError("");
        try {
            const result = await videoChatDependencies.run({
                mode: "text",
                prompt: buildVideoChatPrompt(context, next),
                config: { ...buildGenerationConfig(config, undefined, "text", videoTeardownTextRequirements(config, 0)), model },
                expectedUserScope: scope,
                signal: current.signal,
                streamText: false,
                metadata: { source: "video-creation-chat", stage: "conversation" },
            });
            if (current.signal.aborted || getActiveUserScope() !== scope) return false;
            const reply = parseVideoChatReply(result.text || "");
            onResult(reply);
            say("assistant", reply.reply);
            return true;
        } catch (cause) {
            if (!current.signal.aborted && getActiveUserScope() === scope) setError(cause instanceof Error ? cause.message : "导演暂时没有回复，请重新发送");
            return false;
        } finally {
            if (controller.current === current) controller.current = null;
            if (!current.signal.aborted && getActiveUserScope() === scope) setBusy(false);
        }
    };
    return {
        turns,
        busy,
        error,
        say,
        send,
        open: (id: string) => {
            controller.current?.abort();
            controller.current = null;
            setBusy(false);
            setError("");
            history.open(id);
        },
        reset: () => {
            controller.current?.abort();
            controller.current = null;
            setBusy(false);
            setError("");
            history.reset();
        },
    };
}
