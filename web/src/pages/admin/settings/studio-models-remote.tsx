import { App, Button, Input, Progress } from "antd";
import { CloudDownload, Square } from "lucide-react";
import { useState } from "react";
import { AppModal } from "@/components/ui/product/app-modal/app-modal";
import { cancelStudioModelRemoteImport, startStudioModelRemoteImport, type StudioModelRemoteImport } from "@/services/api/studio-models";
import { AdminCallout, AdminCheckbox, AdminSegmented } from "../ui/controls";

type Mode = "source" | "url";

const STATUS_TEXT: Record<StudioModelRemoteImport["status"], string> = { idle: "", running: "正在拉取", done: "拉取完成", failed: "拉取失败", cancelled: "已停止" };

function Counts({ state }: { state: StudioModelRemoteImport }) {
    const { report } = state;
    return (
        <p className="studio-remote-counts">
            已处理 {report.done.toLocaleString()} / {report.total.toLocaleString()} · 新增 {report.imported.toLocaleString()} · 跳过已有 {report.skipped.toLocaleString()} · 失败 {report.failed.toLocaleString()}
        </p>
    );
}

function Failures({ state }: { state: StudioModelRemoteImport }) {
    if (!state.report.failures.length) return null;
    return (
        <details className="studio-remote-failures">
            <summary>
                失败的 {state.report.failed} 条（列出前 {state.report.failures.length} 条）
            </summary>
            <ul>
                {state.report.failures.map((item, index) => (
                    <li key={`${item.name}-${index}`}>
                        <strong>{item.name}</strong>
                        <span>{item.error}</span>
                    </li>
                ))}
            </ul>
        </details>
    );
}

/**
 * 远程拉取模特库：选内置来源或给一份清单地址，服务端在后台下载并逐条导入，已有的跳过。
 * 拉取进行中关掉弹窗不影响，页面会继续显示进度。
 */
export function StudioModelRemoteImportModal({ state, onClose, onChange }: { state: StudioModelRemoteImport; onClose: () => void; onChange: (state: StudioModelRemoteImport) => void }) {
    const { message, modal } = App.useApp();
    const [mode, setMode] = useState<Mode>("source");
    const [sourceId, setSourceId] = useState(state.sources[0]?.id || "");
    const [manifestUrl, setManifestUrl] = useState("");
    const [consent, setConsent] = useState(false);
    const [busy, setBusy] = useState(false);
    const running = state.status === "running";
    const source = state.sources.find((item) => item.id === sourceId);
    const percent = state.report.total ? Math.floor((state.report.done / state.report.total) * 100) : 0;

    const start = async () => {
        if (mode === "url" && !/^https?:\/\//i.test(manifestUrl.trim())) return void message.warning("清单地址要以 http:// 或 https:// 开头");
        setBusy(true);
        try {
            onChange(await startStudioModelRemoteImport(mode === "source" ? { source: sourceId, faceConsentAttested: consent } : { manifestUrl: manifestUrl.trim(), faceConsentAttested: consent }));
        } catch (error) {
            message.error(error instanceof Error ? error.message : "没能开始拉取");
        } finally {
            setBusy(false);
        }
    };

    const stop = () =>
        modal.confirm({
            title: "停止这次拉取？",
            content: "已经导入的保留，下次拉取会跳过它们。",
            okText: "停止",
            okButtonProps: { danger: true },
            cancelText: "继续拉取",
            onOk: async () => {
                try {
                    onChange(await cancelStudioModelRemoteImport());
                } catch (error) {
                    message.error(error instanceof Error ? error.message : "停止失败");
                }
            },
        });

    return (
        <AppModal open title="远程拉取模特库" width={600} footer={null} onCancel={onClose}>
            <div className="studio-remote">
                {state.status !== "idle" ? (
                    <section className="studio-remote-state" data-status={state.status} aria-live="polite">
                        <div className="studio-remote-state-head">
                            <strong>{STATUS_TEXT[state.status]}</strong>
                            <span title={state.source}>{state.source}</span>
                        </div>
                        {state.report.total ? (
                            <Progress percent={percent} size="small" status={state.status === "failed" ? "exception" : running ? "active" : "normal"} showInfo={false} />
                        ) : running ? (
                            <p className="studio-remote-counts">正在读取清单…</p>
                        ) : null}
                        {state.report.total ? <Counts state={state} /> : null}
                        {state.error ? <AdminCallout tone="error">{state.error}</AdminCallout> : null}
                        <Failures state={state} />
                    </section>
                ) : null}
                {running ? (
                    <footer className="studio-remote-foot">
                        <span>在服务端后台进行，关掉这个窗口也会继续。</span>
                        <Button icon={<Square className="size-3.5" />} onClick={stop}>
                            停止拉取
                        </Button>
                        <Button onClick={onClose}>后台继续</Button>
                    </footer>
                ) : (
                    <>
                        <AdminSegmented<Mode>
                            ariaLabel="拉取来源"
                            value={mode}
                            onChange={setMode}
                            options={[
                                { value: "source", label: "内置来源" },
                                { value: "url", label: "清单地址" },
                            ]}
                        />
                        {mode === "source" ? (
                            state.sources.length ? (
                                <div className="studio-remote-sources" role="radiogroup" aria-label="内置来源">
                                    {state.sources.map((item) => (
                                        <button key={item.id} type="button" role="radio" aria-checked={item.id === sourceId} className="studio-remote-source" onClick={() => setSourceId(item.id)}>
                                            <strong>{item.name}</strong>
                                            <span>{item.description}</span>
                                        </button>
                                    ))}
                                </div>
                            ) : (
                                <p className="studio-remote-hint">没有内置来源。</p>
                            )
                        ) : (
                            <label className="studio-model-field">
                                <span>清单地址（JSON）</span>
                                <Input value={manifestUrl} maxLength={2048} placeholder="https://example.com/studio-models/manifest.json" onChange={(event) => setManifestUrl(event.target.value)} />
                                <small className="studio-remote-hint">
                                    清单是 {"{ source, items: [...] }"}，每条写 kind（face / figure / pose / style）、name、category、gender、tags、prompt、url、enabled、sortOrder，图片 url 要能直接下载。服务端不访问内网地址。
                                </small>
                            </label>
                        )}
                        {mode === "source" && source?.notice ? (
                            <AdminCallout tone="warning" title="版权">
                                {source.notice}
                            </AdminCallout>
                        ) : null}
                        <AdminCheckbox checked={consent} onChange={(event) => setConsent(event.target.checked)}>
                            已取得其中人像的肖像使用授权：模特人脸和全身模特带授权导入并上架（不勾时这两类先不上架）
                        </AdminCheckbox>
                        <footer className="studio-remote-foot">
                            <span>已有的按「类型 + 分类 + 名称」跳过，可以重复拉取。</span>
                            <Button onClick={onClose}>取消</Button>
                            <Button type="primary" icon={<CloudDownload className="size-4" />} loading={busy} disabled={mode === "source" ? !sourceId : !manifestUrl.trim()} onClick={() => void start()}>
                                {state.status === "idle" ? "开始拉取" : "再拉一次"}
                            </Button>
                        </footer>
                    </>
                )}
            </div>
        </AppModal>
    );
}
