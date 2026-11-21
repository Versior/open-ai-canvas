import { Button } from "antd";
import { X } from "lucide-react";
import { useState } from "react";
import type { CloudAgentConversation } from "@/services/cloud-agent-conversations";

export function AgentArchiveRecovery({ conversations, activeId, onCollapse }: { conversations: CloudAgentConversation[]; activeId: string | null; onCollapse: () => void }) {
    const [selectedId, setSelectedId] = useState(activeId);
    const selected = conversations.find((item) => item.id === selectedId) ?? conversations[0];
    const draft = selected?.draft || "";
    return (
        <section className="flex min-h-0 flex-1 flex-col gap-3 px-5 py-4" aria-label="旧对话只读恢复">
            <header className="flex items-center justify-between gap-2" data-agent-drag-handle>
                <h2 className="text-base font-semibold">旧对话 · 只读恢复</h2>
                <Button type="text" shape="circle" icon={<X className="size-4" />} aria-label="收起 Agent" onClick={onCollapse} />
            </header>
            <p role="status" className="text-sm">
                此浏览器无法使用 IndexedDB，不能保存或发送。旧记录没有删除，可以在这里选择对话并复制原文。
            </p>
            {selected ? (
                <>
                    <select className="w-full rounded border p-2" aria-label="选择要恢复的对话" value={selected.id} onChange={(event) => setSelectedId(event.target.value)}>
                        {conversations.map((item) => (
                            <option value={item.id} key={item.id}>
                                {item.title}
                            </option>
                        ))}
                    </select>
                    <textarea
                        readOnly
                        aria-label="可复制的历史原文"
                        className="thin-scrollbar min-h-24 w-full flex-1 resize-none rounded border p-2 text-sm"
                        value={[draft, selected.draftPrefill?.text !== draft ? selected.draftPrefill?.text : "", ...selected.messages.map((message) => message.text)].filter(Boolean).join("\n\n")}
                    />
                </>
            ) : (
                <p>当前账号没有可恢复的旧对话。</p>
            )}
        </section>
    );
}
