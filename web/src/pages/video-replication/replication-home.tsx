import { ArrowRight, Clapperboard, LoaderCircle, ScanEye, Scissors } from "lucide-react";
import type { ComponentProps } from "react";

import type { VideoReplicationRecord } from "@/services/api/video-replication";
import { ReplicationComposer } from "./replication-composer";
import { ReplicationRecent } from "./replication-recent";
import { REPLICATION_STAGE_LABELS, type ReplicationRun } from "./use-replication-runner";

const FLOW = [
    { icon: Scissors, title: "拆镜头", text: "自动切镜、截关键帧" },
    { icon: ScanEye, title: "逐镜分析", text: "画面、口播、运镜、商品" },
    { icon: Clapperboard, title: "去画布复刻", text: "换商品重拍、合成成片" },
];

type Props = {
    composer: ComponentProps<typeof ReplicationComposer>;
    records: VideoReplicationRecord[] | undefined;
    loading: boolean;
    error: string;
    /** 已经建好拆解任务、正在后台跑的那一次。 */
    activeRun: ReplicationRun | null;
    onOpen: (id: string) => void;
};

/** 视频复刻首页：一行标题和流程、拆解入口（含支持的平台）、最近拆解。宽屏下一屏放得下，不用滚动。 */
export function ReplicationHome({ composer, records, loading, error, activeRun, onOpen }: Props) {
    const activeId = activeRun?.id || "";
    return (
        <div className="vr-home">
            <header className="vr-home-head">
                <div className="vr-home-heading">
                    <h1 className="vr-home-title">视频复刻</h1>
                    <p className="vr-home-sub">把爆款视频拆成可复刻的分镜，再去画布换成你的商品重拍。拆解用来学结构和节奏，复刻请用你有权使用的素材和形象。</p>
                </div>
                <ol className="vr-flow" aria-label="复刻流程">
                    {FLOW.map(({ icon: Icon, title, text }, index) => (
                        <li key={title} className="vr-flow-step">
                            <span className="vr-flow-icon" aria-hidden>
                                <Icon />
                            </span>
                            <span className="min-w-0">
                                <span className="vr-flow-title">{`${index + 1}. ${title}`}</span>
                                <span className="vr-flow-text">{text}</span>
                            </span>
                        </li>
                    ))}
                </ol>
            </header>
            <ReplicationComposer {...composer} />
            {activeRun && activeId ? (
                <button type="button" className="vr-run-banner" onClick={() => onOpen(activeId)}>
                    <LoaderCircle className="vr-spin" aria-hidden />
                    <span className="vr-run-banner-text">
                        <strong>{REPLICATION_STAGE_LABELS[activeRun.stage]}</strong>
                        {[activeRun.detail, activeRun.percent !== undefined ? `${activeRun.percent}%` : ""].filter(Boolean).join(" · ")}
                    </span>
                    <span className="vr-run-banner-link">
                        查看进度
                        <ArrowRight aria-hidden />
                    </span>
                </button>
            ) : null}
            <ReplicationRecent records={records} loading={loading} error={error} runningId={activeId} onOpen={onOpen} />
        </div>
    );
}
