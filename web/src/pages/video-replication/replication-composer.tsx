import { App, Button, Input } from "antd";
import { CircleCheck, ClipboardPaste, FileVideo, Link2, ScanSearch, Upload, UploadCloud, X } from "lucide-react";
import { useEffect, useRef, useState, type DragEvent } from "react";

import { ModelPicker } from "@/components/model-picker";
import { HoverBorderGradient } from "@/components/ui/aceternity/hover-border-gradient";
import { SegmentedControl } from "@/components/ui/base/segmented-control";
import { Switch } from "@/components/ui/base/switch";
import { formatTeardownTime, orientationLabel, videoTeardownModelError, videoTeardownTextRequirements, type VideoTeardownOptions } from "@/lib/canvas/video-teardown";
import { socialVideoURLFromText } from "@/services/api/social-video";
import type { AiConfig } from "@/stores/use-config-store";
import { ReplicationProgress } from "./replication-progress";
import type { ReplicationRun, ReplicationSource } from "./use-replication-runner";

type Props = {
    config: AiConfig;
    model: string;
    onModelChange: (model: string) => void;
    transcribe: boolean;
    onTranscribeChange: (value: boolean) => void;
    busy: boolean;
    /** 还没建出拆解任务（导入、上传中）或在这一步失败的那次运行。 */
    run: ReplicationRun | null;
    onStart: (source: ReplicationSource, options: VideoTeardownOptions) => void;
};

type FileInfo = { durationMs: number; width: number; height: number };

const MAX_DURATION_MS = 180_000;

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
export function ReplicationComposer({ config, model, onModelChange, transcribe, onTranscribeChange, busy, run, onStart }: Props) {
    const { message } = App.useApp();
    const [mode, setMode] = useState<"link" | "file">("link");
    const [linkText, setLinkText] = useState("");
    const [file, setFile] = useState<File | null>(null);
    const [fileInfo, setFileInfo] = useState<FileInfo | null>(null);
    const [dragging, setDragging] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const previewUrl = useObjectUrl(file);
    // 读剪贴板要安全上下文（https 或本机）；局域网 http 访问时不显示这个按钮，直接手动粘贴。
    const canPaste = typeof window !== "undefined" && window.isSecureContext && typeof navigator.clipboard?.readText === "function";

    const modelError = videoTeardownModelError(config, model);
    const linkUrl = socialVideoURLFromText(linkText);
    const linkValid = Boolean(linkUrl);
    const fileValid = Boolean(file && file.type.startsWith("video/") && (!fileInfo || fileInfo.durationMs <= MAX_DURATION_MS));
    const sourceError =
        mode === "link"
            ? linkText.trim() && !linkValid
                ? "只支持抖音和 TikTok 的单视频链接或分享文字"
                : ""
            : file && !file.type.startsWith("video/")
              ? "请选择视频文件"
              : fileInfo && fileInfo.durationMs > MAX_DURATION_MS
                ? "视频超过 3 分钟，请先剪短再拆解"
                : "";
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
                        <span className="vr-composer-limit">最长 3 分钟 · 最多 60 个镜头</span>
                    </div>
                    {mode === "link" ? (
                        <div className="vr-link-field">
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
                                autoSize={{ minRows: 3, maxRows: 6 }}
                                placeholder="粘贴抖音或 TikTok 的分享内容，或直接粘贴视频链接"
                                aria-label="视频链接或分享内容"
                            />
                            {linkUrl ? (
                                <span className="vr-link-ok">
                                    <CircleCheck aria-hidden />
                                    {`识别到${new URL(linkUrl).hostname.includes("douyin") ? "抖音" : " TikTok "}视频链接`}
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
                    {sourceError || modelError ? (
                        <p role="alert" className="vr-field-error">
                            {sourceError || modelError}
                        </p>
                    ) : null}
                    <div className="vr-toolbar">
                        <div className="vr-toolbar-model">
                            <ModelPicker config={config} capability="text" value={model} onChange={onModelChange} requirements={videoTeardownTextRequirements(config, 1)} placeholder="选择能看图的文本模型" />
                        </div>
                        <label className="vr-chip">
                            <Switch size="sm" checked={transcribe} onChange={onTranscribeChange} aria-label="识别口播" />
                            <span>识别口播</span>
                        </label>
                        <span className="vr-toolbar-end">
                            <span className="vr-toolbar-hint">切镜免费，分析按模型计费</span>
                            <Button type="primary" icon={<ScanSearch className="size-4" />} disabled={!ready} onClick={start}>
                                {busy ? "正在拆解…" : "开始拆解"}
                            </Button>
                        </span>
                    </div>
                </div>
            </HoverBorderGradient>
            {run ? <ReplicationProgress run={run} className="vr-composer-progress" /> : null}
        </div>
    );
}
