import { ArrowRight, ArrowUpRight, Clapperboard, ListChecks, LoaderCircle, ScanEye, Shirt, WandSparkles, Speech, Layers, FolderOpen } from "lucide-react";
import { useState, type ComponentProps, type ReactNode } from "react";
import { FashionWorkbench } from "@/components/fashion/fashion-workbench";
import type { FashionTool } from "@/lib/fashion/workflow";

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
    onTool: (tool: "teardown" | "plan" | "works") => void;
};

/** 视频复刻首页：一行标题和流程、拆解入口（含支持的平台）、最近拆解。宽屏下一屏放得下，不用滚动。 */
export function ReplicationHome({ composer, records, loading, error, activeRun, onOpen, tabs, tab, works, onTool }: Props) {
    const [fashionTool, setFashionTool] = useState<FashionTool>();
    const activeId = activeRun?.id || "";
    return (
        <div className="vr-home">
            <header className="vr-home-head">
                <div className="vr-home-heading">
                    <div className="vr-home-titlebar">
                        <h1 className="vr-home-title">视频创作与复刻</h1>
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
            {tab === "new" ? (
                <div className="vr-tool-deck">
                    <div className="vr-tool-deck-heading">
                        <span>CREATOR TOOLKIT</span>
                        <strong>从拆解到重拍，每一步都有工具</strong>
                    </div>
                    <div className="vr-tool-cards" role="group" aria-label="视频创作工具">
                        {[
                            { id: "teardown" as const, icon: ScanEye, title: "镜头拆解", text: "画面 · 口播 · 商品 · 镜头时长" },
                            { id: "plan" as const, icon: Speech, title: "脚本与导演", text: "改写口播 · 景别运镜 · 叙事节奏" },
                            { id: "tryon" as const, icon: Shirt, title: "模特换装", text: "多模同款 · 一模多衣 · 姿势迁移" },
                            { id: "smart-face" as const, icon: WandSparkles, title: "人物与形象", text: "换脸换头 · 光线融合 · 展示视频" },
                            { id: "print" as const, icon: Layers, title: "印花素材", text: "提取平面图案 · 复用到商品图" },
                            { id: "works" as const, icon: FolderOpen, title: "成片与交付", text: "逐镜重做 · 字幕声音 · 剪映交付" },
                        ].map(({ id, icon: Icon, title, text }) => (
                            <button type="button" key={id} onClick={() => (id === "tryon" || id === "smart-face" || id === "print" ? setFashionTool(id) : onTool(id))}>
                                <Icon aria-hidden />
                                <strong>{title}</strong>
                                <span>{text}</span>
                                <ArrowUpRight aria-hidden />
                            </button>
                        ))}
                    </div>
                </div>
            ) : null}
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
            {fashionTool ? <FashionWorkbench initialTool={fashionTool} onClose={() => setFashionTool(undefined)} /> : null}
        </div>
    );
}
