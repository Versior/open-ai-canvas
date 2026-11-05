import { Alert, Button, Skeleton } from "antd";
import { useEffect, useMemo, useState } from "react";
import { AdminStatusBadge } from "@/pages/admin/components/admin-ui";
import { AdminDrawer } from "@/pages/admin/ui/overlays";
import { formatTeardownTime, orientationLabel, readVideoReplicationAnalysis, teardownTimeRange, videoTeardownShotTranscripts } from "@/lib/canvas/video-teardown";
import { adminResourceFileUrl } from "@/services/api/admin-storage";
import { parseVideoTeardownBundle } from "@/services/api/video-replication";
import { adminUserLabel, getAdminVideoReplication, type AdminVideoReplicationDetail } from "@/services/api/video-replication-admin";
import { formatParseTime } from "./parse-shared";
import { AdminResourceThumb, modelLabel, TEARDOWN_STATUS_META, TRANSCRIPT_LABELS } from "./replication-admin-shared";

const BOUNDARY_LABELS = { start: "开头", cut: "切点", split: "长镜头切开" } as const;

/** 一条拆解记录的详情：原视频、镜头事实、口播和保存过的分析。展示路径，结果读不出来时说明原因，不拿默认值补。 */
export function ReplicationRecordDrawer({ id, onClose }: { id: string; onClose: () => void }) {
    const [detail, setDetail] = useState<AdminVideoReplicationDetail | null>(null);
    const [error, setError] = useState("");
    const [retry, setRetry] = useState(0);
    useEffect(() => {
        setDetail(null);
        setError("");
        if (!id) return;
        const controller = new AbortController();
        void getAdminVideoReplication(id, controller.signal)
            .then((result) => {
                if (!controller.signal.aborted) setDetail(result);
            })
            .catch((cause) => {
                if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "读取拆解记录失败");
            });
        return () => controller.abort();
    }, [id, retry]);

    const parsed = useMemo(() => {
        if (!detail || detail.task.status !== "succeeded") return { bundle: null, error: "" };
        try {
            return { bundle: parseVideoTeardownBundle(detail.task), error: "" };
        } catch (cause) {
            return { bundle: null, error: cause instanceof Error ? cause.message : "拆解结果无效" };
        }
    }, [detail]);
    const bundle = parsed.bundle;
    const analysis = useMemo(() => (bundle && detail?.analysis ? readVideoReplicationAnalysis(detail.analysis, bundle.shots.length) : null), [bundle, detail?.analysis]);
    const transcripts = useMemo(() => (bundle ? videoTeardownShotTranscripts(bundle) : new Map<number, string>()), [bundle]);
    const rows = useMemo(() => new Map((analysis?.rows || []).map((row) => [row.shotNumber, row])), [analysis]);

    const task = detail?.task;
    const meta = task ? TEARDOWN_STATUS_META[task.status] : null;
    const facts: [string, string][] = task
        ? [
              ["用户", adminUserLabel(detail.user)],
              ["创建时间", formatParseTime(task.createdAt)],
              ["完成时间", task.completedAt ? formatParseTime(task.completedAt) : "—"],
              ...(bundle
                  ? ([
                        ["时长", formatTeardownTime(bundle.source.durationMs)],
                        ["画幅", `${orientationLabel(bundle.source.width, bundle.source.height)} ${bundle.source.width}×${bundle.source.height}`],
                        ["镜头", `${bundle.shots.length} 个，${bundle.grids.length} 张宫格`],
                        ["口播", `${TRANSCRIPT_LABELS[bundle.transcript.source]}${bundle.transcript.language ? `（${bundle.transcript.language}）` : ""}${bundle.source.hasAudio ? "" : "，视频没有音轨"}`],
                    ] as [string, string][])
                  : []),
              ["分析", analysis ? `${modelLabel(analysis.model) || "未记录模型"} · ${formatParseTime(detail.analyzedAt)}` : detail.analysis ? "保存的分析和镜头对不上，读不出来" : "还没有分析"],
              ["任务 ID", task.id],
          ]
        : [];

    return (
        <AdminDrawer title={analysis?.title || "拆解记录"} open={Boolean(id)} onClose={onClose} size="min(880px, 100vw)" rootClassName="admin-vr-drawer">
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
            ) : !task || !meta ? (
                <Skeleton active />
            ) : (
                <div className="admin-vr-detail">
                    <div className="admin-vr-detail-status">
                        <AdminStatusBadge label={task.status === "running" ? `${meta.label} ${task.progress ?? 0}%` : meta.label} tone={meta.tone} />
                        {task.stage ? <span className="admin-vr-muted">{task.stage}</span> : null}
                    </div>
                    {task.status === "failed" && task.error ? <Alert type="error" showIcon title="失败原因" description={task.error} /> : null}
                    {parsed.error ? <Alert type="warning" showIcon title="拆解结果读不出来" description={parsed.error} /> : null}
                    <dl className="admin-vr-facts">
                        {facts.map(([label, value]) => (
                            <div key={label}>
                                <dt>{label}</dt>
                                <dd className={label === "任务 ID" ? "admin-vr-mono" : undefined}>{value}</dd>
                            </div>
                        ))}
                    </dl>
                    {bundle?.warnings.length ? (
                        <ul className="admin-vr-warnings" aria-label="拆解提示">
                            {bundle.warnings.map((warning) => (
                                <li key={warning}>{warning}</li>
                            ))}
                        </ul>
                    ) : null}
                    {bundle ? <video className="admin-vr-video" src={adminResourceFileUrl(bundle.source.resourceId)} controls preload="metadata" playsInline aria-label="原视频" /> : null}
                    {analysis?.summary ? (
                        <section className="admin-vr-summary" aria-label="全片总结">
                            <h3>全片总结</h3>
                            <dl className="admin-vr-facts">
                                <div>
                                    <dt>题材</dt>
                                    <dd>{analysis.summary.genre || "—"}</dd>
                                </div>
                                <div>
                                    <dt>开头钩子</dt>
                                    <dd>{analysis.summary.hook || "—"}</dd>
                                </div>
                            </dl>
                            {analysis.summary.beats.length ? (
                                <ol className="admin-vr-beats">
                                    {analysis.summary.beats.map((beat, index) => (
                                        <li key={`${beat.name}-${index}`}>
                                            <strong>{beat.name}</strong>
                                            <span className="admin-vr-muted">{beat.shots.length ? `镜头 ${beat.shots.join("、")}` : ""}</span>
                                            <span>{beat.purpose}</span>
                                        </li>
                                    ))}
                                </ol>
                            ) : null}
                            {analysis.summary.whyItWorks.length ? (
                                <ul className="admin-vr-points">
                                    {analysis.summary.whyItWorks.map((item) => (
                                        <li key={item}>{item}</li>
                                    ))}
                                </ul>
                            ) : null}
                        </section>
                    ) : null}
                    {bundle ? (
                        <section aria-label="镜头">
                            <h3>{`镜头（${bundle.shots.length}）`}</h3>
                            <ol className="admin-vr-shots">
                                {bundle.shots.map((shot) => {
                                    const row = rows.get(shot.index);
                                    const dialogue = row?.dialogue || transcripts.get(shot.index) || "";
                                    return (
                                        <li key={shot.index} className="admin-vr-shot">
                                            <AdminResourceThumb id={shot.keyframeResourceId} label={`镜头 ${shot.index} 关键帧`} className="admin-vr-shot-frame" />
                                            <div className="admin-vr-shot-copy">
                                                <div className="admin-vr-shot-head">
                                                    <strong>{`#${shot.index}`}</strong>
                                                    <span className="admin-vr-mono">{teardownTimeRange(shot)}</span>
                                                    <span className="admin-vr-muted">{BOUNDARY_LABELS[shot.boundary]}</span>
                                                    {row ? <span className="admin-vr-muted">{[row.shotSize, row.camera, row.motion].filter(Boolean).join(" · ")}</span> : null}
                                                </div>
                                                {row?.plotDescription ? <p>{row.plotDescription}</p> : null}
                                                {dialogue ? <p className="admin-vr-dialogue">{`口播：${dialogue}`}</p> : null}
                                                {row?.onScreenText ? <p className="admin-vr-muted">{`画面文字：${row.onScreenText}`}</p> : null}
                                            </div>
                                        </li>
                                    );
                                })}
                            </ol>
                        </section>
                    ) : null}
                </div>
            )}
        </AdminDrawer>
    );
}
