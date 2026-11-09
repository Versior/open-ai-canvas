import { useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Input, Progress } from "antd";
import { CloudDownload, Square } from "lucide-react";
import { useState } from "react";
import { AppModal } from "@/components/ui/product/app-modal/app-modal";
import { cancelAgentPetRemoteImport, getAgentPetRemoteImport, startAgentPetRemoteImport } from "@/services/api/agent-pets";
import { AdminCallout } from "../../ui/controls";

export function AgentPetRemoteDialog({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
    const { message } = App.useApp();
    const client = useQueryClient();
    const [url, setUrl] = useState<string>();
    const [busy, setBusy] = useState(false);
    const query = useQuery({ queryKey: ["admin", "agent-pet-remote"], queryFn: getAgentPetRemoteImport, refetchInterval: (query) => (query.state.data?.status === "running" ? 1500 : false) });
    const state = query.data;
    const running = state?.status === "running";
    const act = async (stop: boolean) => {
        setBusy(true);
        try {
            const next = stop ? await cancelAgentPetRemoteImport() : await startAgentPetRemoteImport(url ?? state?.manifestUrl ?? "");
            client.setQueryData(["admin", "agent-pet-remote"], next);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "形象同步失败");
        } finally {
            setBusy(false);
        }
    };
    return (
        <AppModal
            open
            title="从 GitHub 同步智能体形象"
            width={620}
            footer={null}
            onCancel={() => {
                onChanged();
                onClose();
            }}
        >
            <div className="space-y-4">
                <p>
                    默认连接{" "}
                    <a href="https://github.com/Versior/agent-pet-library" target="_blank" rel="noreferrer">
                        agent-pet-library
                    </a>
                    。清单地址会保存，重复同步按图集摘要跳过已有形象。新形象导入后可批量分类、上架。
                </p>
                <label className="block space-y-2">
                    <span>远端清单地址</span>
                    <Input value={url ?? state?.manifestUrl ?? ""} disabled={running || busy} onChange={(event) => setUrl(event.target.value)} />
                </label>
                {query.error ? <AdminCallout tone="error">{query.error instanceof Error ? query.error.message : "读取失败"}</AdminCallout> : null}
                {state && state.status !== "idle" ? (
                    <section aria-live="polite">
                        <strong>{{ running: "同步中", done: "同步完成", failed: "同步有失败", cancelled: "已停止" }[state.status]}</strong>
                        <Progress percent={state.report.total ? Math.floor((state.report.done / state.report.total) * 100) : 0} status={state.status === "failed" ? "exception" : running ? "active" : "normal"} />
                        <p>
                            已处理 {state.report.done} / {state.report.total} · 新增 {state.report.imported} · 跳过 {state.report.skipped} · 失败 {state.report.failed}
                        </p>
                        {state.error ? <AdminCallout tone="error">{state.error}</AdminCallout> : null}
                        {state.report.failures.length ? (
                            <details>
                                <summary>失败详情</summary>
                                <ul>
                                    {state.report.failures.map((item, index) => (
                                        <li key={index}>
                                            {item.name}：{item.error}
                                        </li>
                                    ))}
                                </ul>
                            </details>
                        ) : null}
                    </section>
                ) : null}
                <div className="flex justify-end gap-2">
                    <Button
                        onClick={() => {
                            onChanged();
                            onClose();
                        }}
                    >
                        {running ? "后台继续" : "关闭"}
                    </Button>
                    <Button type={running ? "default" : "primary"} icon={running ? <Square className="size-4" /> : <CloudDownload className="size-4" />} loading={busy} disabled={!state || Boolean(query.error)} onClick={() => void act(Boolean(running))}>
                        {running ? "停止同步" : "保存来源并同步"}
                    </Button>
                </div>
            </div>
        </AppModal>
    );
}
