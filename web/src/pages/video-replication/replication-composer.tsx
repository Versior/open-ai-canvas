import { useQuery } from "@tanstack/react-query";
import { App, Button, Input } from "antd";
import { CircleAlert, CircleCheck, ClipboardPaste, FileVideo, Link2, ScanSearch, Upload, UploadCloud, X } from "lucide-react";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { Link } from "react-router";

import { ModelPicker } from "@/components/model-picker";
import { HoverBorderGradient } from "@/components/ui/aceternity/hover-border-gradient";
import { SegmentedControl } from "@/components/ui/base/segmented-control";
import { Switch } from "@/components/ui/base/switch";
import { formatDurationLimit, formatTeardownTime, orientationLabel, videoTeardownModelError, videoTeardownTextRequirements, type VideoTeardownOptions } from "@/lib/canvas/video-teardown";
import { getActiveUserScope } from "@/lib/user-scope";
import { BUILTIN_SOCIAL_VIDEO_PLATFORMS, listSocialVideoPlatforms, socialVideoLinkFromText, socialVideoPlatformNames, type SocialVideoPlatform } from "@/services/api/social-video";
import type { VideoReplicationConfig } from "@/services/api/video-replication";
import type { AiConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { ReplicationProgress } from "./replication-progress";
import type { ReplicationRun, ReplicationSource } from "./use-replication-runner";

type Props = {
    config: AiConfig;
    model: string;
    onModelChange: (model: string) => void;
    transcribe: boolean;
    /** 不能识别口播的原因；有值时开关保持关闭、不能切换。 */
    transcribeNote: string;
    onTranscribeChange: (value: boolean) => void;
    /** 后台设置的时长和镜头数上限；还没读到时不显示，也不在前端拦。 */
    limits: VideoReplicationConfig | undefined;
    /** 后台关了视频链接导入时只能上传文件。 */
    linkImportEnabled: boolean;
    busy: boolean;
    /** 还没建出拆解任务（导入、上传中）或在这一步失败的那次运行。 */
    run: ReplicationRun | null;
    onStart: (source: ReplicationSource, options: VideoTeardownOptions) => void;
};

type FileInfo = { durationMs: number; width: number; height: number };

/** 有现成图标的平台（Simple Icons，CC0，和电商页共用）；抖音、TikTok 是单色图标，深色主题下反白。 */
const PLATFORM_LOGOS = new Set(["douyin", "kuaishou", "tiktok", "xiaohongshu"]);
const MONOCHROME_LOGOS = new Set(["douyin", "tiktok"]);

/**
 * 支持的平台：能导入的排前面；后台还没给某个平台配解析接口时显示成灰色，说明可以先下载再上传。
 * 管理员多一个去配置解析接口的入口。
 */
function PlatformStrip({ platforms, loading }: { platforms: readonly SocialVideoPlatform[]; loading: boolean }) {
    const admin = useUserStore((state) => state.user?.role === "admin");
    const sorted = [...platforms].sort((left, right) => Number(right.available) - Number(left.available));
    const missing = sorted.filter((platform) => !platform.available);
    return (
        <div className="vr-platforms" aria-busy={loading || undefined}>
            <span className="vr-platforms-label" id="vr-platforms-label">
                支持平台
            </span>
            <ul className="vr-platform-list" aria-labelledby="vr-platforms-label">
                {loading
                    ? [0, 1, 2, 3].map((item) => <li key={item} className="vr-platform vr-skeleton" aria-hidden />)
                    : sorted.map((platform) => (
                          <li
                              key={platform.id}
                              className="vr-platform"
                              data-available={platform.available || undefined}
                              title={platform.available ? `可以粘贴${platform.name}的分享内容或链接` : `${platform.name}还没接入解析接口，暂时不能粘贴链接导入，可以先下载视频再上传`}
                          >
                              {PLATFORM_LOGOS.has(platform.id) ? (
                                  <img src={`/commerce/platforms/${platform.id}.svg`} alt="" width={14} height={14} data-monochrome={MONOCHROME_LOGOS.has(platform.id) || undefined} />
                              ) : (
                                  <span className="vr-platform-mark" aria-hidden>
                                      {platform.name.slice(0, 1)}
                                  </span>
                              )}
                              <span>{platform.name}</span>
                              {platform.available ? null : <span className="sr-only">（还没接入）</span>}
                          </li>
                      ))}
            </ul>
            {!loading && missing.length ? <span className="vr-platforms-hint">灰色的还没接入，可以下载后上传</span> : null}
            {admin ? (
                <Link to="/admin/video-replication?tab=parse" className="vr-platforms-admin">
                    配置解析接口
                </Link>
            ) : null}
        </div>
    );
}

/** 选中的本地视频做成 blob 地址给预览用，换文件或卸载时释放。 */
function useObjectUrl(file: File | null) {
    const [url, setUrl] = useState("");
    useEffect(() => {
        if (!file) {
            setUrl("");
            return;
        }
        const next = URL.createObjectURL(file);
        setUrl(next);
        return () => URL.revokeObjectURL(next);
    }, [file]);
    return url;
}

/**
 * 拆解入口：和创作页输入框同一套外观。粘贴平台分享内容，或点选 / 拖入本地视频（拖进来自动切到上传）；
 * 底栏选看图模型、是否识别口播，再开始拆解。
 */
export function ReplicationComposer({ config, model, onModelChange, transcribe, transcribeNote, onTranscribeChange, limits, linkImportEnabled, busy, run, onStart }: Props) {
    const { message } = App.useApp();
    const [pickedMode, setMode] = useState<"link" | "file">("link");
    const mode = linkImportEnabled ? pickedMode : "file";
    const [linkText, setLinkText] = useState("");
    const [file, setFile] = useState<File | null>(null);
    const [fileInfo, setFileInfo] = useState<FileInfo | null>(null);
    const [dragging, setDragging] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const previewUrl = useObjectUrl(file);
    // 读剪贴板要安全上下文（https 或本机）；局域网 http 访问时不显示这个按钮，直接手动粘贴。
    const canPaste = typeof window !== "undefined" && window.isSecureContext && typeof navigator.clipboard?.readText === "function";

    // 能识别哪些平台、哪些平台后台配了解析接口，以服务端为准；没取到时先按抖音 / TikTok 的内置规则识别。
    const platformsQuery = useQuery({ queryKey: ["social-video-platforms", getActiveUserScope()], queryFn: ({ signal }) => listSocialVideoPlatforms(signal), staleTime: 60_000 });
    const platforms = platformsQuery.data?.length ? platformsQuery.data : BUILTIN_SOCIAL_VIDEO_PLATFORMS;
    const platformNames = socialVideoPlatformNames(platforms);

    const modelError = videoTeardownModelError(config, model);
    const link = socialVideoLinkFromText(linkText, platforms);
    const linkValid = Boolean(link?.platform.available);
    const tooLong = Boolean(limits && fileInfo && fileInfo.durationMs > limits.maxDurationSeconds * 1000);
    const fileValid = Boolean(file && file.type.startsWith("video/") && !tooLong);
    const linkError = !linkText.trim() ? "" : !link ? `只支持${platformNames}的单视频链接或分享文字` : !link.platform.available ? `${link.platform.name}链接暂时无法导入：后台还没有可用的解析接口` : "";
    const fileError = file && !file.type.startsWith("video/") ? "请选择视频文件" : limits && tooLong ? `视频超过 ${formatDurationLimit(limits.maxDurationSeconds)}，请先剪短再拆解` : "";
    // 链接的问题显示在输入框里；这里只放文件和模型的问题。
    const footerError = (mode === "file" ? fileError : "") || modelError;
    const ready = (mode === "link" ? linkValid : fileValid) && !modelError && !busy;

    const start = () => {
        if (!ready) return;
        if (mode === "link") onStart({ kind: "link", text: linkText }, { model, transcribe });
        else if (file) onStart({ kind: "file", file }, { model, transcribe });
    };
    const pickFile = (next: File | null | undefined) => {
        if (!next) return;
        setFile(next);
        setFileInfo(null);
        setMode("file");
    };
    const removeFile = () => {
        setFile(null);
        setFileInfo(null);
    };
    const drop = (event: DragEvent) => {
        event.preventDefault();
        setDragging(false);
        const files = Array.from(event.dataTransfer.files);
        pickFile(files.find((item) => item.type.startsWith("video/")) || files[0]);
    };
    const paste = async () => {
        try {
            const text = await navigator.clipboard.readText();
            if (text.trim()) setLinkText(text);
            else message.info("剪贴板里没有文字");
        } catch {
            message.warning("没能读取剪贴板，请在输入框里直接粘贴");
        }
    };

    return (
        <div className="vr-composer-wrap">
            <HoverBorderGradient as="div" duration={2.2} containerClassName="vr-composer-shell" className="vr-composer-shell-inner">
                <div
                    className="vr-composer"
                    data-dragging={dragging || undefined}
                    onDragOver={(event) => {
                        if (!event.dataTransfer.types.includes("Files")) return;
                        event.preventDefault();
                        setDragging(true);
                    }}
                    onDragLeave={(event) => {
                        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
                    }}
                    onDrop={drop}
                >
                    <div className="vr-composer-head">
                        {linkImportEnabled ? (
                            <SegmentedControl
                                ariaLabel="视频来源"
                                size="sm"
                                value={mode}
                                onChange={setMode}
                                options={[
                                    { value: "link", label: "粘贴链接", icon: <Link2 className="size-3.5" aria-hidden /> },
                                    { value: "file", label: "上传视频", icon: <Upload className="size-3.5" aria-hidden /> },
                                ]}
                            />
                        ) : (
                            <span className="vr-composer-source">
                                <Upload className="size-3.5" aria-hidden />
                                上传视频
                            </span>
                        )}
                        {limits ? <span className="vr-composer-limit">{`最长 ${formatDurationLimit(limits.maxDurationSeconds)} · 最多 ${limits.maxShots} 个镜头`}</span> : null}
                    </div>
                    {mode === "link" ? <PlatformStrip platforms={platforms} loading={platformsQuery.isPending} /> : null}
                    {mode === "link" ? (
                        <div className="vr-link-field" data-hint={link && linkValid ? "ok" : linkError ? "error" : undefined}>
                            <Input.TextArea
                                variant="borderless"
                                className="vr-textarea"
                                value={linkText}
                                onChange={(event) => setLinkText(event.target.value)}
                                onKeyDown={(event) => {
                                    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                                        event.preventDefault();
                                        start();
                                    }
                                }}
                                autoSize={{ minRows: 2, maxRows: 5 }}
                                placeholder={`粘贴${platformNames}的分享内容，或直接粘贴视频链接`}
                                aria-label="视频链接或分享内容"
                            />
                            {link && linkValid ? (
                                <span className="vr-link-ok">
                                    <CircleCheck aria-hidden />
                                    {`识别到${link.platform.name}视频链接`}
                                </span>
                            ) : linkError ? (
                                // 链接问题和识别成功的提示放在同一处，输入框高度不跳。
                                <span className="vr-link-ok" data-tone="error" role="alert">
                                    <CircleAlert aria-hidden />
                                    {linkError}
                                </span>
                            ) : null}
                            {canPaste && !linkText ? (
                                <Button size="small" className="vr-paste" icon={<ClipboardPaste className="size-3.5" />} onClick={() => void paste()}>
                                    粘贴
                                </Button>
                            ) : null}
                        </div>
                    ) : file ? (
                        <div className="vr-file">
                            <span className="vr-file-preview">
                                {previewUrl ? (
                                    <video
                                        src={previewUrl}
                                        muted
                                        playsInline
                                        preload="metadata"
                                        aria-hidden
                                        onLoadedMetadata={(event) => {
                                            const video = event.currentTarget;
                                            if (Number.isFinite(video.duration)) setFileInfo({ durationMs: Math.round(video.duration * 1000), width: video.videoWidth, height: video.videoHeight });
                                        }}
                                    />
                                ) : (
                                    <FileVideo aria-hidden />
                                )}
                            </span>
                            <span className="vr-file-copy">
                                <span className="vr-file-name" title={file.name}>
                                    {file.name}
                                </span>
                                <span className="vr-file-meta">
                                    {[
                                        `${(file.size / 1024 / 1024).toFixed(1)} MB`,
                                        fileInfo ? formatTeardownTime(fileInfo.durationMs) : "",
                                        fileInfo?.width ? `${orientationLabel(fileInfo.width, fileInfo.height)} ${fileInfo.width}×${fileInfo.height}` : "",
                                    ]
                                        .filter(Boolean)
                                        .join(" · ")}
                                </span>
                            </span>
                            <span className="vr-file-actions">
                                <Button size="small" onClick={() => fileInputRef.current?.click()}>
                                    换一个
                                </Button>
                                <button type="button" className="vr-icon-button" aria-label="移除视频" title="移除视频" onClick={removeFile}>
                                    <X aria-hidden />
                                </button>
                            </span>
                        </div>
                    ) : (
                        <button type="button" className="vr-drop" onClick={() => fileInputRef.current?.click()}>
                            <span className="vr-drop-icon" aria-hidden>
                                <UploadCloud />
                            </span>
                            <span className="vr-drop-title">点击选择，或把视频拖到这里</span>
                            <span className="vr-drop-hint">MP4、MOV 等常见格式</span>
                        </button>
                    )}
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="video/*"
                        className="hidden"
                        aria-label="选择要拆解的视频"
                        onChange={(event) => {
                            pickFile(event.target.files?.[0]);
                            event.target.value = "";
                        }}
                    />
                    {footerError ? (
                        <p role="alert" className="vr-field-error">
                            {footerError}
                        </p>
                    ) : null}
                    <div className="vr-toolbar">
                        <div className="vr-toolbar-model">
                            <ModelPicker config={config} capability="text" value={model} onChange={onModelChange} requirements={videoTeardownTextRequirements(config, 1)} placeholder="选择能看图的文本模型" />
                        </div>
                        <label className="vr-chip" title={transcribeNote || undefined} data-disabled={transcribeNote ? true : undefined}>
                            <Switch size="sm" checked={transcribe} disabled={Boolean(transcribeNote)} onChange={onTranscribeChange} aria-label="识别口播" aria-describedby={transcribeNote ? "vr-transcribe-note" : undefined} />
                            <span>识别口播</span>
                        </label>
                        <span className="vr-toolbar-end">
                            <span className="vr-toolbar-hint">切镜免费，分析按模型计费</span>
                            <Button type="primary" icon={<ScanSearch className="size-4" />} disabled={!ready} onClick={start}>
                                {busy ? "正在拆解…" : "开始拆解"}
                            </Button>
                        </span>
                    </div>
                    {transcribeNote ? (
                        <p id="vr-transcribe-note" className="vr-composer-note">
                            {transcribeNote}
                        </p>
                    ) : null}
                </div>
            </HoverBorderGradient>
            {run ? <ReplicationProgress run={run} className="vr-composer-progress" /> : null}
        </div>
    );
}
