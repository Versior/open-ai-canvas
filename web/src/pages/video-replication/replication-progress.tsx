import { Progress } from "antd";
import { Check, LoaderCircle } from "lucide-react";

import { cn } from "@/lib/utils";
import { REPLICATION_STAGE_LABELS, type ReplicationRun, type ReplicationStage } from "./use-replication-runner";

const STEPS = ["获取视频", "切镜头、截关键帧", "模型分析", "保存结果"] as const;
const STEP_OF: Record<ReplicationStage, number> = { import: 0, upload: 0, teardown: 1, analyze: 2, save: 3 };

/** 一次拆解的步骤条：获取视频 → 切镜 → 模型分析 → 保存；失败时停在出错的那一步。 */
export function ReplicationProgress({ run, className }: { run: ReplicationRun; className?: string }) {
    const current = STEP_OF[run.stage];
    const failed = Boolean(run.error);
    return (
        <div role={failed ? "alert" : "status"} className={cn("flex flex-col gap-3 rounded-[var(--r-lg)] border border-border bg-card p-4", className)}>
            <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {STEPS.map((label, index) => {
                    const done = index < current;
                    const active = index === current;
                    return (
                        <li key={label} className={cn("flex items-center gap-2 text-xs", active ? "font-medium text-foreground" : done ? "text-foreground/70" : "text-muted-foreground")}>
                            <span
                                className={cn(
                                    "grid size-6 shrink-0 place-items-center rounded-full border text-[11px] tabular-nums",
                                    done && "border-transparent bg-primary text-primary-foreground",
                                    active && !failed && "border-primary text-primary",
                                    active && failed && "border-destructive text-destructive",
                                    !done && !active && "border-border",
                                )}
                                aria-hidden
                            >
                                {done ? <Check className="size-3.5" /> : active && !failed ? <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" /> : index + 1}
                            </span>
                            <span className="truncate">{index === 0 && active ? REPLICATION_STAGE_LABELS[run.stage] : label}</span>
                        </li>
                    );
                })}
            </ol>
            <p className={cn("text-sm", failed ? "text-destructive" : "text-muted-foreground")}>
                {failed ? `${REPLICATION_STAGE_LABELS[run.stage]}失败：${run.error}` : [run.resumed ? "已接着上次的进度继续" : "", run.detail].filter(Boolean).join(" · ") || "处理中"}
            </p>
            {!failed && run.percent !== undefined ? <Progress percent={run.percent} size="small" /> : null}
            {!failed ? <p className="text-xs text-muted-foreground">可以离开这个页面，拆解会在后台继续；刷新或关掉页面后再回来，也会接着分析。</p> : null}
        </div>
    );
}
