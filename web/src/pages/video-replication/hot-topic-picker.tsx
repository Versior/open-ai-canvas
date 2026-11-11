import { useQuery } from "@tanstack/react-query";
import { ExternalLink, RefreshCw, X } from "lucide-react";
import { useEffect, useState } from "react";
import { CREATIVE_TONES, topicTones, type CreativeBrief, type CreativeTopic } from "@/lib/remake/creative";
import { VIDEO_TREND_SOURCES } from "@/lib/remake/trends";
import { getVideoTrends } from "@/services/api/video-trends";
import { useUserStore } from "@/stores/use-user-store";

export function HotTopicPicker({ topic, disabled = false, enabled = true, onChange, onTone }: { topic?: CreativeTopic; disabled?: boolean; enabled?: boolean; onChange: (topic?: CreativeTopic) => void; onTone: (tone: CreativeBrief["tone"]) => void }) {
    const [source, setSource] = useState<CreativeTopic["source"]>(topic?.source ?? "douhot");
    const [keyword, setKeyword] = useState("");
    const userId = useUserStore((store) => store.user?.id);
    useEffect(() => setKeyword(""), [userId]);
    const query = useQuery({
        queryKey: ["video-trends", userId, source],
        queryFn: ({ signal }) => getVideoTrends(source, signal),
        staleTime: 30_000,
        enabled: enabled && Boolean(userId),
        retry: false,
        refetchOnWindowFocus: true,
        refetchInterval: enabled && !disabled ? 60_000 : false,
    });
    const board = query.data;
    const filtered = board?.topics.filter((item) => item.title.includes(keyword.trim())) ?? [];
    const updated = board?.fetchedAt ? new Date(board.fetchedAt) : undefined;
    return (
        <div className="vc-topics">
            <div className="vc-topics-toolbar">
                <div className="vc-source-tabs" role="group" aria-label="热点来源">
                    {Object.entries(VIDEO_TREND_SOURCES).map(([id, value]) => (
                        <button
                            type="button"
                            key={id}
                            aria-pressed={source === id}
                            onClick={() => {
                                setSource(id as CreativeTopic["source"]);
                                setKeyword("");
                            }}
                        >
                            {value.name}
                        </button>
                    ))}
                </div>
                <div className="vc-topics-controls">
                    <input aria-label="筛选热点" placeholder="搜索选题" value={keyword} onChange={(event) => setKeyword(event.target.value)} />
                    <button type="button" aria-label="刷新热点" title="刷新选题" disabled={query.isFetching || !userId} onClick={() => void query.refetch()}>
                        <RefreshCw size={14} className={query.isFetching ? "vc-topic-refreshing" : undefined} />
                    </button>
                </div>
            </div>
            {updated ? (
                <div className="vc-topic-meta">
                    <span>{board?.description || "最新选题"}</span>
                    <span title={updated.toLocaleString("zh-CN", { hour12: false })}>
                        {updated.toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit" })} 更新{board?.status === "stale" ? " · 更新延迟" : ""}
                    </span>
                </div>
            ) : null}
            {query.error ? (
                <p className="vc-topic-notice" role="alert">
                    暂时无法更新选题{board?.topics.length ? "，保留上次的内容。" : "，稍后重试。"}
                </p>
            ) : null}
            {query.isFetching && !board ? (
                <p className="vc-topic-empty" role="status">
                    正在读取选题…
                </p>
            ) : filtered.length ? (
                <div className="vc-topic-list">
                    {filtered.map((item) => (
                        <div key={`${item.title}:${item.url}`}>
                            <span data-rank={item.rank}>{String(item.rank).padStart(2, "0")}</span>
                            <button
                                type="button"
                                disabled={disabled || !board?.fetchedAt}
                                aria-pressed={topic?.source === source && topic.title === item.title}
                                title={item.title}
                                onClick={() => {
                                    if (board?.fetchedAt) onChange({ source, title: item.title, url: item.url, fetchedAt: board.fetchedAt });
                                }}
                            >
                                {item.title}
                            </button>
                            <a href={item.url} target="_blank" rel="noreferrer" aria-label={`查看来源：${item.title}`} title="查看原内容">
                                <ExternalLink size={13} />
                            </a>
                        </div>
                    ))}
                </div>
            ) : !query.error ? (
                <p className="vc-topic-empty" role="status">
                    {keyword ? "没有匹配的选题" : "选题正在准备中"}
                </p>
            ) : null}
            {topic ? (
                <div className="vc-topic-selected" role="status" aria-live="polite">
                    <span>已选：{topic.title}</span>
                    <button type="button" disabled={disabled} aria-label="移除热点选题" onClick={() => onChange()}>
                        <X size={14} />
                    </button>
                    <div>
                        风格
                        {topicTones(topic.title).map((tone) => (
                            <button type="button" key={tone} disabled={disabled} onClick={() => onTone(tone)}>
                                {CREATIVE_TONES[tone].name}
                            </button>
                        ))}
                    </div>
                </div>
            ) : null}
        </div>
    );
}
