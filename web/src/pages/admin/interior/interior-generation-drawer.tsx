import { Alert, Button, Skeleton } from "antd";
import { useEffect, useRef, useState } from "react";
import { AdminStatusBadge } from "@/pages/admin/components/admin-ui";
import { AdminDrawer } from "@/pages/admin/ui/overlays";
import { getAdminInteriorGeneration, type AdminInteriorGenerationDetail } from "@/services/api/interior";
import { adminUserLabel } from "@/services/api/video-replication-admin";
import { formatInteriorTime, INTERIOR_SURFACE_LABELS, InteriorAdminThumb, interiorInProgress, interiorModelLabel, interiorStatusMeta } from "./interior-admin-shared";

const IN_PROGRESS_REFRESH_MS = 3000;

/** 一条出图记录：原图和效果图、参考图、出图设置、完整提示词。还在生成时定时刷新。 */
export function InteriorGenerationDrawer({ id, onClose }: { id: string; onClose: () => void }) {
    const [detail, setDetail] = useState<AdminInteriorGenerationDetail | null>(null);
    const [error, setError] = useState("");
    const [retry, setRetry] = useState(0);
    const shownIdRef = useRef("");
    useEffect(() => {
        // 换了记录才清空；同一条的重试和定时刷新保留已显示的内容。
        if (shownIdRef.current !== id) {
            shownIdRef.current = id;
            setDetail(null);
            setError("");
        }
        if (!id) return;
        const controller = new AbortController();
        void getAdminInteriorGeneration(id, controller.signal)
            .then((result) => {
                if (controller.signal.aborted) return;
                setDetail(result);
                setError("");
            })
            .catch((cause) => {
                if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "读取出图记录失败");
            });
        return () => controller.abort();
    }, [id, retry]);
    useEffect(() => {
        if (!id || !detail || !interiorInProgress(detail.status)) return;
        const timer = window.setTimeout(() => setRetry((value) => value + 1), IN_PROGRESS_REFRESH_MS);
        return () => window.clearTimeout(timer);
    }, [detail, id]);

    const meta = detail ? interiorStatusMeta(detail.status, detail.progress) : null;
    const params = detail ? Object.entries(detail.params) : [];
    const facts: [string, string][] = detail
        ? [
              ["用户", adminUserLabel(detail.user)],
              ["出图方式", [detail.modeName, detail.surface ? INTERIOR_SURFACE_LABELS[detail.surface] : ""].filter(Boolean).join(" · ") || "—"],
              ["空间", detail.roomName || "—"],
              ["风格", detail.styleName || "—"],
              ["模型", interiorModelLabel(detail.model) || "—"],
              ["项目", detail.projectName || (detail.projectId ? "项目已删除" : "—")],
              ["创建时间", formatInteriorTime(detail.createdAt)],
              ["完成时间", formatInteriorTime(detail.completedAt)],
              ["任务 ID", detail.id],
          ]
        : [];

    return (
        <AdminDrawer title={[detail?.roomName, detail?.styleName || detail?.modeName].filter(Boolean).join(" · ") || "出图记录"} open={Boolean(id)} onClose={onClose} size="min(880px, 100vw)">
            {error ? (
                <Alert
                    type="error"
                    showIcon
                    title="读取失败"
                    description={error}
                    action={
                        <Button size="small" onClick={() => setRetry((value) => value + 1)}>
                            重试
                        </Button>
                    }
                />
            ) : !detail || !meta ? (
                <Skeleton active />
            ) : (
                <div className="itd-admin-detail">
                    <div className="itd-admin-detail-status">
                        <AdminStatusBadge label={meta.label} tone={meta.tone} />
                        {detail.stage && interiorInProgress(detail.status) ? <span className="itd-admin-muted">{detail.stage}</span> : null}
                    </div>
                    {detail.status === "failed" && detail.error ? <Alert type="error" showIcon title="失败原因" description={detail.error} /> : null}
                    <div className="itd-admin-compare">
                        <figure>
                            <InteriorAdminThumb id={detail.sourceResourceId} label="原图" className="itd-admin-compare-image" />
                            <figcaption>原图</figcaption>
                        </figure>
                        {detail.outputResourceIds.length ? (
                            detail.outputResourceIds.map((resourceId, index) => (
                                <figure key={resourceId}>
                                    <InteriorAdminThumb id={resourceId} label={`效果图 ${index + 1}`} className="itd-admin-compare-image" />
                                    <figcaption>{detail.outputResourceIds.length > 1 ? `效果图 ${index + 1}` : "效果图"}</figcaption>
                                </figure>
                            ))
                        ) : (
                            <figure>
                                <span className="itd-admin-thumb is-empty itd-admin-compare-image">{interiorInProgress(detail.status) ? "还在生成" : "没有效果图"}</span>
                                <figcaption>效果图</figcaption>
                            </figure>
                        )}
                    </div>
                    {detail.referenceResourceIds.length ? (
                        <section aria-label="参考图">
                            <h3>参考图</h3>
                            <div className="itd-admin-refs">
                                {detail.referenceResourceIds.map((resourceId, index) => (
                                    <InteriorAdminThumb key={resourceId} id={resourceId} label={`参考图 ${index + 1}`} className="itd-admin-ref" />
                                ))}
                            </div>
                        </section>
                    ) : null}
                    <dl className="itd-admin-facts">
                        {facts.map(([label, value]) => (
                            <div key={label}>
                                <dt>{label}</dt>
                                <dd className={label === "任务 ID" ? "itd-admin-mono" : undefined}>{value}</dd>
                            </div>
                        ))}
                        {params.length ? (
                            <div>
                                <dt>参数</dt>
                                <dd>{params.map(([key, value]) => `${key}：${value}`).join("；")}</dd>
                            </div>
                        ) : null}
                    </dl>
                    <section aria-label="完整提示词">
                        <h3>完整提示词</h3>
                        <p className="itd-admin-muted">服务端按出图方式的模板、空间、风格和参数拼好后发给模型的原文。</p>
                        <pre className="itd-admin-prompt">{detail.prompt || "没有记录提示词"}</pre>
                    </section>
                </div>
            )}
        </AdminDrawer>
    );
}
