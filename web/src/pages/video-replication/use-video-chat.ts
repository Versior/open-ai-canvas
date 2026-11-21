import { useEffect, useRef, useState } from "react";
import { buildGenerationConfig } from "@/lib/canvas/canvas-project-generation";
import { createClientId } from "@/lib/client-id";
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
    const say = (role: VideoChatTurn["role"], text: string) => {
        void setTurns((items) => [...items, { role, text }]);
    };
    const send = async (text: string, regenerate = false) => {
        if (controller.current || !history.ready) return false;
        const last = turns.at(-1);
        const sameMessage = last?.role === "user" && last.text === text;
        if (sameMessage && !last.operation && !regenerate) {
            setError("这条旧消息没有任务操作号，无法核对上次是否已受理。请先查看任务中心，确需新任务时点「重新生成」");
            return false;
        }
        const previous = sameMessage && !regenerate ? last.operation : undefined;
        const selectedModel = previous?.model || model;
        const problem = scope === "guest" ? "请先登录，再和视频导演聊聊" : !selectedModel ? "请选择视频导演模型" : replicaScriptModelError(config, selectedModel);
        if (problem) {
            setError(problem);
            return false;
        }
        const current = new AbortController();
        controller.current = current;
        const before = sameMessage ? turns.slice(0, -1) : turns;
        const message = { role: "user" as const, text };
        const operation = previous ?? { id: createClientId(), model: selectedModel, prompt: buildVideoChatPrompt(context, [...before, message]) };
        setBusy(true);
        setError("");
        try {
            const stored = await setTurns(() => [...before, { ...message, operation }]);
            if (current.signal.aborted || getActiveUserScope() !== scope) return false;
            if (!stored) throw new Error("未能保存本次导演消息，尚未提交任务，请重试保存");
            const result = await videoChatDependencies.run({
                mode: "text",
                prompt: operation.prompt,
                config: { ...buildGenerationConfig(config, undefined, "text", videoTeardownTextRequirements(config, 0)), model: operation.model },
                clientOperationId: operation.id,
                expectedUserScope: scope,
                signal: current.signal,
                streamText: false,
                metadata: { source: "video-creation-chat", stage: "conversation" },
            });
            if (current.signal.aborted || getActiveUserScope() !== scope) return false;
            const reply = parseVideoChatReply(result.text || "");
            onResult(reply);
            void setTurns((items) => [...items.map((turn) => (turn.operation?.id === operation.id ? { role: turn.role, text: turn.text } : turn)), { role: "assistant", text: reply.reply }]);
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
