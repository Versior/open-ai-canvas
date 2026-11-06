import { ArrowRight, Clapperboard, ListChecks, LoaderCircle, ScanEye } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

import type { VideoReplicationRecord } from "@/services/api/video-replication";
import { ReplicationComposer } from "./replication-composer";
import { ReplicationRecent } from "./replication-recent";
import { REPLICATION_STAGE_LABELS, type ReplicationRun } from "./use-replication-runner";

// 和记录工作区顶部的三步一致。
const FLOW = [
    { icon: ScanEye, title: "放爆款", text: "切镜头，AI 看懂每镜的画面、口播和商品" },
    { icon: ListChecks, title: "换成我的", text: "选商品和模特，逐镜决定换元素还是重新拍" },
    { icon: Clapperboard, title: "出片对比", text: "和原片并排对照，哪镜不行重做哪镜" },
];

type Props = {
    composer: ComponentProps<typeof ReplicationComposer>;
    records: VideoReplicationRecord[] | undefined;
    loading: boolean;
    error: string;
    /** 已经建好拆解任务、正在后台跑的那一次。 */
    activeRun: ReplicationRun | null;
    onOpen: (id: string) => void;
    /** 顶部的「新建复刻 / 我的作品」页签。 */
    tabs: ReactNode;
    tab: "new" | "works";
    /** 「我的作品」页签的内容。 */
    works: ReactNode;
};

/** 视频复刻首页：一行标题和流程、拆解入口（含支持的平台）、最近拆解。宽屏下一屏放得下，不用滚动。 */
export function ReplicationHome({ composer, records, loading, error, activeRun, onOpen, tabs, tab, works }: Props) {
    const activeId = activeRun?.id || "";
    return (
        <div className="vr-home">
            <header className="vr-home-head">
                <div className="vr-home-heading">
                    <div className="vr-home-titlebar">
                        <h1 className="vr-home-title">视频复刻</h1>
                        {tabs}
                    </div>
                    <p className="vr-home-sub">放一条爆款视频，拆成分镜后逐镜换成你的商品、模特和口播，在这里直接出成片。复刻请用你有权使用的素材和形象。</p>
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
            {tab === "works" ? works : null}
            {tab === "new" ? <ReplicationComposer {...composer} /> : null}
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
            {tab === "new" ? <ReplicationRecent records={records} loading={loading} error={error} runningId={activeId} onOpen={onOpen} /> : null}
        </div>
    );
}
