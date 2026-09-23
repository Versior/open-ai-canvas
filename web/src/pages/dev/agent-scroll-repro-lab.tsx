import { useEffect, useState } from "react";
import { CanvasCloudAgentPanel } from "@/components/canvas/canvas-cloud-agent-panel";
import type { CloudAgentChatMessage } from "@/components/canvas/canvas-cloud-agent-chat-ui";
import { saveCloudAgentConversations } from "@/services/cloud-agent-conversations";

const canvasId = "agent-scroll-regression-fixture";

// DEV-only: real panel, real persisted conversation, deterministic long choices.
// No model tasks are submitted automatically; backend availability is not mocked.
export default function AgentScrollReproLab() {
    const [ready, setReady] = useState(false);
    const [error, setError] = useState("");
    const [open, setOpen] = useState(true);
    useEffect(() => {
        let active = true;
        const now = new Date().toISOString();
        const messages: CloudAgentChatMessage[] = [
            { id: "request", role: "user", text: "请给我六个详细方案，便于逐项比较。" },
            ...Array.from({ length: 8 }, (_, i): CloudAgentChatMessage => ({ id: `history-${i}`, role: "assistant", text: `前文 ${i + 1}：这是用于验证历史消息滚动的测试内容。` })),
            { id: "question", role: "assistant", text: "请选择接下来执行的方案。", question: {
                question: "六种长方案都应完整可达，输入框不应被挤出面板。",
                options: Array.from({ length: 6 }, (_, i) => ({ label: `方案 ${i + 1}`, detail: "先整理商品参考与画面构图，再逐项检查角色外观、镜头衔接和字幕，确认后进入下一阶段。".repeat(8) })),
                allowFreeform: true,
            } },
        ];
        void saveCloudAgentConversations(canvasId, "scroll-test", [{ id: "scroll-test", title: "长选项滚动回归", messages, run: null, permissionMode: "read_only", createdAt: now, updatedAt: now }])
            .then(() => { if (active) setReady(true); })
            .catch((cause) => { if (active) setError(String(cause)); });
        return () => { active = false; };
    }, []);
    return <main className="min-h-screen p-6">
        <h1>Agent 长选项滚动回归</h1>
        <p>仅开发环境。请缩小助手窗口，用滚轮、滚动条和键盘检查六个选项及历史记录。</p>
        {error ? <p role="alert">{error}</p> : null}
        {ready ? <CanvasCloudAgentPanel canvasId={canvasId} nodeCount={0} references={[]} open={open} onOpen={() => setOpen(true)} onCollapse={() => setOpen(false)} /> : null}
    </main>;
}
