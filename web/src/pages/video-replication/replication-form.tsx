import { Button, Input } from "antd";
import { FileVideo, ScanSearch, UploadCloud } from "lucide-react";
import { useRef, useState, type DragEvent, type ReactNode } from "react";

import { ModelPicker } from "@/components/model-picker";
import { SegmentedControl } from "@/components/ui/base/segmented-control";
import { Switch } from "@/components/ui/base/switch";
import { videoTeardownModelError, videoTeardownTextRequirements, type VideoTeardownOptions } from "@/lib/canvas/video-teardown";
import { cn } from "@/lib/utils";
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

const FLOW = ["获取视频", "切镜头、截关键帧", "看图模型逐镜分析", "分镜表和拆解报告"];

/** 新建拆解：粘贴平台链接，或点选 / 拖入本地视频；选看图模型和是否识别口播。 */
export function ReplicationForm({ config, model, onModelChange, transcribe, onTranscribeChange, busy, run, onStart }: Props) {
    const [mode, setMode] = useState<"link" | "file">("link");
    const [linkText, setLinkText] = useState("");
    const [file, setFile] = useState<File | null>(null);
    const [dragging, setDragging] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const modelError = videoTeardownModelError(config, model);
    const linkValid = Boolean(socialVideoURLFromText(linkText));
    const fileValid = Boolean(file && file.type.startsWith("video/"));
    const sourceError = mode === "link" ? (linkText.trim() && !linkValid ? "只支持抖音和 TikTok 的单视频链接或分享文字" : "") : file && !fileValid ? "请选择视频文件" : "";
    const ready = (mode === "link" ? linkValid : fileValid) && !modelError && !busy;

    const start = () => {
        if (!ready) return;
        if (mode === "link") onStart({ kind: "link", text: linkText }, { model, transcribe });
        else if (file) onStart({ kind: "file", file }, { model, transcribe });
    };
    const dropFile = (event: DragEvent) => {
        event.preventDefault();
        setDragging(false);
        const dropped = Array.from(event.dataTransfer.files).find((item) => item.type.startsWith("video/")) || event.dataTransfer.files[0];
        if (dropped) setFile(dropped);
    };

    return (
        <section className="flex w-full max-w-3xl flex-col gap-5 rounded-[var(--r-lg)] border border-border bg-card p-5 sm:p-6" aria-label="新建拆解">
            <div className="flex flex-col gap-3">
                <h2 className="text-lg font-semibold">拆解一条视频</h2>
                <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    {FLOW.map((step, index) => (
                        <li key={step} className="flex items-center gap-2">
                            <span className="grid size-5 place-items-center rounded-full bg-muted text-[11px] tabular-nums text-foreground/70">{index + 1}</span>
                            <span>{step}</span>
                            {index < FLOW.length - 1 ? (
                                <span aria-hidden className="text-border">
                                    —
                                </span>
                            ) : null}
                        </li>
                    ))}
                </ol>
            </div>
            <Field label="视频">
                <div className="flex flex-col gap-2">
                    <SegmentedControl
                        ariaLabel="视频来源"
                        value={mode}
                        onChange={setMode}
                        options={[
                            { value: "link", label: "粘贴链接" },
                            { value: "file", label: "上传视频" },
                        ]}
                    />
                    {mode === "link" ? (
                        <Input.TextArea value={linkText} onChange={(event) => setLinkText(event.target.value)} autoSize={{ minRows: 3, maxRows: 6 }} placeholder="粘贴抖音或 TikTok 的分享内容或视频链接" aria-label="视频链接" />
                    ) : (
                        <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            onDragOver={(event) => {
                                event.preventDefault();
                                setDragging(true);
                            }}
                            onDragLeave={() => setDragging(false)}
                            onDrop={dropFile}
                            className={cn(
                                "flex min-h-32 flex-col items-center justify-center gap-2 rounded-[var(--r-md)] border border-dashed px-4 py-6 text-center transition-colors focus-visible:outline-2 focus-visible:outline-offset-2",
                                dragging ? "border-primary bg-primary/5" : "border-border hover:bg-surface-hover",
                            )}
                        >
                            {file ? <FileVideo className="size-6 text-foreground/70" aria-hidden /> : <UploadCloud className="size-6 text-muted-foreground" aria-hidden />}
                            <span className="max-w-full truncate text-sm font-medium">{file ? file.name : "点击选择，或把视频拖到这里"}</span>
                            <span className="text-xs text-muted-foreground">{file ? `${(file.size / 1024 / 1024).toFixed(1)} MB · 点击换一个` : "MP4、MOV 等常见格式，最长 3 分钟"}</span>
                        </button>
                    )}
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="video/*"
                        className="hidden"
                        aria-label="选择要拆解的视频"
                        onChange={(event) => {
                            setFile(event.target.files?.[0] || null);
                            event.target.value = "";
                        }}
                    />
                </div>
            </Field>
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                <Field label="分析模型">
                    <ModelPicker config={config} capability="text" value={model} onChange={onModelChange} requirements={videoTeardownTextRequirements(config, 1)} fullWidth placeholder="选择能看图的文本模型" />
                </Field>
                <div className="flex h-10 items-center gap-3">
                    <Switch checked={transcribe} onChange={onTranscribeChange} aria-label="识别口播" />
                    <span className="text-sm text-foreground/80">识别口播</span>
                </div>
            </div>
            {sourceError || modelError ? (
                <p role="alert" className="-mt-2 text-sm text-destructive">
                    {sourceError || modelError}
                </p>
            ) : null}
            {run ? <ReplicationProgress run={run} /> : null}
            <Button type="primary" size="large" block icon={<ScanSearch className="size-4" />} disabled={!ready} onClick={start}>
                {busy ? "正在拆解…" : "开始拆解"}
            </Button>
            <p className="text-xs leading-5 text-muted-foreground">
                视频最长 3 分钟、最多拆 60 个镜头；切镜和抽帧不收费，模型分析按所选模型计费。识别口播需要服务端配置转写服务，没配置时从画面字幕读。拆解用于学习结构和节奏，复刻请使用你有权使用的素材和形象。
            </p>
        </section>
    );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="flex min-w-0 flex-col gap-1.5">
            <span className="text-sm text-foreground/70">{label}</span>
            {children}
        </div>
    );
}
