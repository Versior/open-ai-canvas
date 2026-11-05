import { Button, Input } from "antd";
import { Plus, Trash2 } from "lucide-react";
import { AdminStatusBadge, type AdminStatusTone } from "@/pages/admin/components/admin-ui";
import type { SocialVideoPlatform } from "@/services/api/social-video";
import type { SocialVideoParseHeader, SocialVideoParseStatus, SocialVideoParseTestResult } from "@/services/api/social-video-parse";

export const PARSE_STAGE_LABELS: Record<string, string> = {
    request: "请求接口",
    response: "接口返回",
    mapping: "解析字段",
    media: "检查视频地址",
    download: "下载视频",
    probe: "校验视频",
};

export const PARSE_KIND_LABELS: Record<string, string> = { import: "用户导入", test: "后台测试", health: "自动巡检" };

export const PARSE_STATUS_META: Record<SocialVideoParseStatus, { label: string; tone: AdminStatusTone }> = {
    active: { label: "正常", tone: "success" },
    auto_disabled: { label: "自动停用", tone: "warning" },
    disabled: { label: "已停用", tone: "neutral" },
};

export function platformName(platforms: readonly SocialVideoPlatform[], id: string) {
    return platforms.find((platform) => platform.id === id)?.name || id;
}

export function formatParseTime(value?: string) {
    if (!value) return "—";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function formatLatency(ms?: number) {
    if (!ms) return "—";
    return ms >= 1000 ? `${(ms / 1000).toFixed(1)} 秒` : `${ms} ms`;
}

/** 最近 10 次调用：左旧右新，绿成功、红失败、灰为还没调用。 */
export function ParseHealthTrack({ recent }: { recent: boolean[] }) {
    const slots = Array.from({ length: 10 }, (_, index) => recent[recent.length - 10 + index]);
    const success = recent.filter(Boolean).length;
    const label = recent.length ? `最近 ${recent.length} 次：${success} 次成功，${recent.length - success} 次失败` : "还没有调用记录";
    return (
        <span className="admin-video-parse-track" role="img" aria-label={label} title={label}>
            {slots.map((value, index) => (
                <span key={index} data-state={value === undefined ? "empty" : value ? "ok" : "fail"} />
            ))}
        </span>
    );
}

/** 请求头列表编辑：名称 + 值，值里可以用 {key} 引用密钥。 */
export function ParseHeadersEditor({
    value = [],
    onChange,
    namePlaceholder = "名称，如 Authorization",
    valuePlaceholder = "值，可用 {key}",
}: {
    value?: SocialVideoParseHeader[];
    onChange?: (value: SocialVideoParseHeader[]) => void;
    namePlaceholder?: string;
    valuePlaceholder?: string;
}) {
    const headers = Array.isArray(value) ? value : [];
    const update = (index: number, patch: Partial<SocialVideoParseHeader>) => onChange?.(headers.map((header, current) => (current === index ? { ...header, ...patch } : header)));
    return (
        <div className="admin-video-parse-headers">
            {headers.map((header, index) => (
                <div key={index} className="admin-video-parse-header-row">
                    <Input aria-label="请求头名称" placeholder={namePlaceholder} value={header.name} onChange={(event) => update(index, { name: event.target.value })} />
                    <Input aria-label="请求头的值" placeholder={valuePlaceholder} value={header.value} onChange={(event) => update(index, { value: event.target.value })} />
                    <Button type="text" aria-label="删除这个请求头" icon={<Trash2 className="size-3.5" />} onClick={() => onChange?.(headers.filter((_, current) => current !== index))} />
                </div>
            ))}
            <Button size="small" icon={<Plus className="size-3.5" />} disabled={headers.length >= 20} onClick={() => onChange?.([...headers, { name: "", value: "" }])}>
                添加请求头
            </Button>
        </div>
    );
}

/** 一次测试的结果：哪一步失败、取到的字段、视频地址检查，以及接口返回的开头，方便对照填字段路径。 */
export function ParseTestResultView({ result, platforms, onUseVideoPath }: { result: SocialVideoParseTestResult; platforms: readonly SocialVideoPlatform[]; onUseVideoPath?: (path: string) => void }) {
    const fields = result.result;
    return (
        <div className="admin-video-parse-result" data-ok={result.ok}>
            <div className="admin-video-parse-result-head">
                <AdminStatusBadge label={result.ok ? "可用" : `失败 · ${PARSE_STAGE_LABELS[result.stage || ""] || "未知步骤"}`} tone={result.ok ? "success" : "error"} />
                <span className="admin-video-parse-result-message">{result.message}</span>
                <span className="admin-video-parse-muted">{[platformName(platforms, result.platform), formatLatency(result.latencyMs), result.httpStatus ? `HTTP ${result.httpStatus}` : ""].filter(Boolean).join(" · ")}</span>
            </div>
            <p className="admin-video-parse-muted admin-video-parse-break">测试链接：{result.testUrl}</p>
            {fields ? (
                <dl className="admin-video-parse-fields">
                    <dt>视频地址</dt>
                    <dd className="admin-video-parse-break">
                        <a href={fields.videoUrl} target="_blank" rel="noreferrer noopener">
                            {fields.videoUrl}
                        </a>
                        {fields.videoUrlPath ? (
                            <span className="admin-video-parse-path">
                                来自 <code>{fields.videoUrlPath}</code>
                                {onUseVideoPath ? (
                                    <Button size="small" type="link" onClick={() => onUseVideoPath(fields.videoUrlPath)}>
                                        填入视频地址字段
                                    </Button>
                                ) : null}
                            </span>
                        ) : null}
                    </dd>
                    <dt>标题</dt>
                    <dd>{fields.title || "—"}</dd>
                    <dt>视频 ID</dt>
                    <dd>{fields.id || "—"}</dd>
                    <dt>时长</dt>
                    <dd>{fields.durationMs ? `${(fields.durationMs / 1000).toFixed(1)} 秒` : "—"}</dd>
                    <dt>封面</dt>
                    <dd className="admin-video-parse-break">{fields.cover || "—"}</dd>
                </dl>
            ) : null}
            {result.media ? <p className="admin-video-parse-muted">{`视频地址检查：HTTP ${result.media.status} · 识别为 ${result.media.mimeType || "未知类型"} · 读了开头 ${result.media.bytes} 字节`}</p> : null}
            {result.responsePreview ? (
                <details className="admin-video-parse-preview" open={!result.ok}>
                    <summary>接口返回（前 4 KiB）</summary>
                    <pre>{result.responsePreview}</pre>
                </details>
            ) : null}
        </div>
    );
}
