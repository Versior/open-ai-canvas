import { REPLICATION_STAGE_LABELS, type ReplicationRun, type ReplicationStage } from "./use-replication-runner";

const STEPS = ["获取视频", "切镜头、截关键帧", "模型分析", "保存结果"] as const;
const STEP_OF: Record<ReplicationStage, number> = { import: 0, upload: 0, teardown: 1, analyze: 2, save: 3 };

/** 一次拆解的进度：四段进度条（获取视频 → 切镜 → 模型分析 → 保存），失败时停在出错的那一段。 */
export function ReplicationProgress({ run, className }: { run: ReplicationRun; className?: string }) {
    const current = STEP_OF[run.stage];
    const failed = Boolean(run.error);
    const detail = failed ? `${REPLICATION_STAGE_LABELS[run.stage]}失败：${run.error}` : [run.resumed ? "已接着上次的进度继续" : "", run.detail, run.percent !== undefined ? `${run.percent}%` : ""].filter(Boolean).join(" · ") || "处理中";
    return (
        <div role={failed ? "alert" : "status"} className={["vr-panel vr-progress", className].filter(Boolean).join(" ")}>
            <ol className="vr-steps">
                {STEPS.map((label, index) => {
                    const state = index < current ? "done" : index > current ? "pending" : failed ? "failed" : "active";
                    return (
                        <li key={label} className="vr-step" data-state={state}>
                            <span className="vr-step-bar" aria-hidden>
                                <span style={state === "active" && run.percent !== undefined ? { width: `${run.percent}%`, animation: "none" } : undefined} />
                            </span>
                            <span className="truncate">{index === 0 && index === current ? REPLICATION_STAGE_LABELS[run.stage] : label}</span>
                        </li>
                    );
                })}
            </ol>
            <p className="vr-progress-detail" data-tone={failed ? "error" : undefined}>
                {detail}
            </p>
            {!failed ? <p className="vr-footnote">可以离开这个页面，拆解会在后台继续；刷新或关掉页面后再回来，也会接着分析。</p> : null}
        </div>
    );
}
