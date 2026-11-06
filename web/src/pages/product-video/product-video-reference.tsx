import { App, Button, Input, Progress, Slider } from "antd";
import { ClipboardPaste, Film, Link2, Scissors, Upload, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { PRODUCT_VIDEO_RANGE_MS, type ProductVideoReference } from "@/lib/product-video/job";
import { formatProductVideoSeconds } from "@/lib/product-video/media";
import { getResource, resourceFileUrl, uploadResourceFile } from "@/services/api/resources";
import { createSocialVideoImport, loadSocialVideoPlatforms, parseSocialVideoImportResult, socialVideoLinkFromText, validateSocialVideoResource, type SocialVideoPlatform } from "@/services/api/social-video";
import { waitForGenerationTask } from "@/services/api/task-center";
import { useUserStore } from "@/stores/use-user-store";

const IMPORT_TIMEOUT_MS = 10 * 60_000;

/** 上传前在浏览器里读出尺寸和时长。 */
function readVideoFileInfo(file: File): Promise<{ width: number; height: number; durationMs: number }> {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    return new Promise<{ width: number; height: number; durationMs: number }>((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error("读取视频信息超时，请确认文件可以播放")), 15_000);
        video.onloadedmetadata = () => {
            window.clearTimeout(timer);
            if (!video.videoWidth || !video.videoHeight || !Number.isFinite(video.duration)) reject(new Error("无法读取视频尺寸或时长"));
            else resolve({ width: video.videoWidth, height: video.videoHeight, durationMs: Math.round(video.duration * 1000) });
        };
        video.onerror = () => {
            window.clearTimeout(timer);
            reject(new Error("无法读取视频，请确认格式受浏览器支持"));
        };
        video.src = url;
    }).finally(() => URL.revokeObjectURL(url));
}

/** 新参考视频的默认选段：从头开始，最长 120 秒。 */
export function defaultProductVideoRange(durationMs: number) {
    return { startMs: 0, endMs: Math.min(durationMs, PRODUCT_VIDEO_RANGE_MS.max) };
}

type Busy = { label: string; percent?: number } | null;

/**
 * 参考视频：本机上传、拖入，或粘贴抖音 / TikTok 链接解析导入；载入后可以裁出其中一段（4–120 秒）。
 * 成片时长跟随选中的这一段。
 */
export function ProductVideoReferencePanel({
    reference,
    startMs,
    endMs,
    disabled,
    onReference,
    onRange,
}: {
    reference?: ProductVideoReference;
    startMs: number;
    endMs: number;
    disabled?: boolean;
    onReference: (reference: ProductVideoReference | undefined) => void;
    onRange: (range: { startMs: number; endMs: number }) => void;
}) {
    const { message } = App.useApp();
    const linkImportEnabled = useUserStore((state) => state.features.socialVideoImportEnabled);
    const input = useRef<HTMLInputElement>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const controller = useRef<AbortController | null>(null);
    const [busy, setBusy] = useState<Busy>(null);
    const [dragging, setDragging] = useState(false);
    const [trimming, setTrimming] = useState(false);
    const [linkText, setLinkText] = useState("");
    const [platforms, setPlatforms] = useState<readonly SocialVideoPlatform[]>([]);
    const canPaste = typeof window !== "undefined" && window.isSecureContext && typeof navigator.clipboard?.readText === "function";

    useEffect(() => {
        if (!linkImportEnabled) return;
        let alive = true;
        void loadSocialVideoPlatforms().then((value) => alive && setPlatforms(value));
        return () => {
            alive = false;
        };
    }, [linkImportEnabled]);
    useEffect(() => () => controller.current?.abort(), []);

    const link = useMemo(() => (linkText.trim() && platforms.length ? socialVideoLinkFromText(linkText, platforms) : null), [linkText, platforms]);

    const begin = () => {
        controller.current?.abort();
        const next = new AbortController();
        controller.current = next;
        return next.signal;
    };

    const upload = async (file: File | undefined) => {
        if (!file) return;
        if (!file.type.startsWith("video/")) {
            message.warning("请选择视频文件（MP4 或 MOV）");
            return;
        }
        const signal = begin();
        try {
            setBusy({ label: "读取视频信息" });
            const info = await readVideoFileInfo(file);
            if (info.durationMs < PRODUCT_VIDEO_RANGE_MS.min) throw new Error("参考视频至少 4 秒");
            setBusy({ label: `上传 ${file.name}`, percent: 0 });
            const resource = await uploadResourceFile(file, "video", { ...info, fileName: file.name }, (uploaded, total) => setBusy({ label: `上传 ${file.name}`, percent: total ? Math.round((uploaded / total) * 100) : undefined }), { signal });
            onReference({ resourceId: resource.id, name: file.name, durationMs: info.durationMs, width: info.width, height: info.height });
            onRange(defaultProductVideoRange(info.durationMs));
        } catch (error) {
            if (!signal.aborted) message.error(error instanceof Error ? error.message : "上传失败");
        } finally {
            if (!signal.aborted) setBusy(null);
        }
    };

    const importLink = async () => {
        if (!link) {
            message.warning(platforms.length ? `请粘贴 ${platforms.map((item) => item.name).join("、")} 的分享链接` : "暂时读不到支持的平台，请稍后再试");
            return;
        }
        if (!link.platform.available) {
            message.warning(`${link.platform.name}链接导入暂不可用，可以先下载视频再上传`);
            return;
        }
        const signal = begin();
        try {
            setBusy({ label: "解析并下载视频" });
            const created = await createSocialVideoImport(link.url, undefined, signal);
            const task = await waitForGenerationTask(created.id, {
                initialTask: created,
                signal,
                timeoutMs: IMPORT_TIMEOUT_MS,
                onTaskUpdate: (item) => setBusy({ label: item.stage || "解析并下载视频", percent: typeof item.progress === "number" ? Math.round(item.progress) : undefined }),
            });
            const result = parseSocialVideoImportResult(task);
            const resource = validateSocialVideoResource(result, await getResource(result.resourceId));
            const durationMs = resource.durationMs || result.durationMs;
            if (!durationMs || durationMs < PRODUCT_VIDEO_RANGE_MS.min) throw new Error("参考视频至少 4 秒");
            onReference({ resourceId: resource.id, name: result.title.trim() || `${link.platform.name}视频`, durationMs, width: resource.width, height: resource.height, link: link.url });
            onRange(defaultProductVideoRange(durationMs));
            setLinkText("");
        } catch (error) {
            if (!signal.aborted) message.error(error instanceof Error ? error.message : "链接导入失败");
        } finally {
            if (!signal.aborted) setBusy(null);
        }
    };

    const paste = async () => {
        try {
            const text = await navigator.clipboard.readText();
            if (text.trim()) setLinkText(text.trim());
            else message.info("剪贴板里没有文字");
        } catch {
            message.warning("没能读取剪贴板，请在输入框里直接粘贴");
        }
    };

    const length = endMs - startMs;
    const lengthError = reference && (length < PRODUCT_VIDEO_RANGE_MS.min || length > PRODUCT_VIDEO_RANGE_MS.max);

    return (
        <section
            className="pv-section pv-reference"
            data-dragging={dragging || undefined}
            aria-label="参考视频"
            onDragOver={(event) => {
                if (disabled || busy || !event.dataTransfer.types.includes("Files")) return;
                event.preventDefault();
                setDragging(true);
            }}
            onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false);
            }}
            onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                if (!disabled && !busy) void upload(Array.from(event.dataTransfer.files).find((file) => file.type.startsWith("video/")));
            }}
        >
            <header className="pv-section-head">
                <h3>参考视频</h3>
                <span>镜头较多时部分镜头替换效果不佳，建议裁出单个场景 · 4–120 秒</span>
            </header>
            {reference ? (
                <div className="pv-reference-body">
                    <div className="pv-reference-player">
                        <video
                            ref={videoRef}
                            src={resourceFileUrl(reference.resourceId)}
                            controls
                            playsInline
                            preload="metadata"
                            aria-label="参考视频"
                            onTimeUpdate={(event) => {
                                // 裁剪时只在选段内循环播放，方便对着画面调整。
                                const video = event.currentTarget;
                                if (trimming && video.currentTime * 1000 >= endMs) video.currentTime = startMs / 1000;
                            }}
                        />
                    </div>
                    <div className="pv-reference-meta">
                        <strong title={reference.name}>{reference.name || "参考视频"}</strong>
                        <span>
                            全长 {formatProductVideoSeconds(reference.durationMs)}
                            {reference.width && reference.height ? ` · ${reference.width}×${reference.height}` : ""}
                        </span>
                        <span data-error={lengthError || undefined}>
                            已选 {formatProductVideoSeconds(Math.max(0, length))}
                            {startMs > 0 || endMs < reference.durationMs ? `（${formatProductVideoSeconds(startMs)} – ${formatProductVideoSeconds(endMs)}）` : ""}
                        </span>
                        <div className="pv-reference-actions">
                            <Button size="small" icon={<Scissors size={14} />} aria-pressed={trimming} disabled={disabled} onClick={() => setTrimming((value) => !value)}>
                                {trimming ? "完成裁剪" : "裁剪视频"}
                            </Button>
                            <Button size="small" icon={<X size={14} />} disabled={disabled} onClick={() => (onReference(undefined), setTrimming(false))}>
                                换一条
                            </Button>
                        </div>
                    </div>
                    {trimming ? (
                        <div className="pv-trim">
                            <Slider
                                range
                                min={0}
                                max={reference.durationMs}
                                step={100}
                                value={[startMs, endMs]}
                                tooltip={{ formatter: (value) => formatProductVideoSeconds(value || 0) }}
                                onChange={(value) => {
                                    let [start, end] = value as number[];
                                    const movedStart = start !== startMs;
                                    // 选段不超过 120 秒：拖动的一端超出时带着另一端走。
                                    if (end - start > PRODUCT_VIDEO_RANGE_MS.max) {
                                        if (movedStart) end = start + PRODUCT_VIDEO_RANGE_MS.max;
                                        else start = end - PRODUCT_VIDEO_RANGE_MS.max;
                                    }
                                    onRange({ startMs: Math.max(0, start), endMs: Math.min(reference.durationMs, end) });
                                    if (videoRef.current) videoRef.current.currentTime = (movedStart ? start : Math.max(0, end - 1000)) / 1000;
                                }}
                            />
                            <span>{lengthError ? "选段须在 4–120 秒之间" : "拖动两端选出要复刻的一段，成片时长跟随这一段"}</span>
                        </div>
                    ) : null}
                </div>
            ) : busy ? (
                <div className="pv-reference-busy" role="status">
                    <Film size={18} aria-hidden />
                    <span>{busy.label}</span>
                    {busy.percent !== undefined ? <Progress percent={busy.percent} size="small" showInfo={false} /> : null}
                    <Button size="small" onClick={() => (controller.current?.abort(), setBusy(null))}>
                        取消
                    </Button>
                </div>
            ) : (
                <div className="pv-reference-empty">
                    <button type="button" className="pv-reference-drop" disabled={disabled} onClick={() => input.current?.click()}>
                        <Upload size={18} aria-hidden />
                        <strong>上传或拖入参考视频</strong>
                        <span>MP4 / MOV，4–120 秒；更长的视频上传后裁出一段</span>
                    </button>
                    {linkImportEnabled ? (
                        <div className="pv-link">
                            <Input
                                prefix={<Link2 size={14} aria-hidden />}
                                placeholder="粘贴抖音、TikTok 分享链接"
                                value={linkText}
                                disabled={disabled}
                                aria-label="视频分享链接"
                                onChange={(event) => setLinkText(event.target.value)}
                                onPressEnter={() => void importLink()}
                                allowClear
                            />
                            {canPaste ? (
                                <Button icon={<ClipboardPaste size={14} />} disabled={disabled} onClick={() => void paste()}>
                                    一键粘贴
                                </Button>
                            ) : null}
                            <Button disabled={disabled || !linkText.trim()} onClick={() => void importLink()}>
                                解析视频
                            </Button>
                        </div>
                    ) : null}
                </div>
            )}
            <input
                ref={input}
                type="file"
                accept="video/mp4,video/quicktime,video/*"
                hidden
                onChange={(event) => {
                    void upload(event.target.files?.[0]);
                    event.target.value = "";
                }}
            />
        </section>
    );
}
