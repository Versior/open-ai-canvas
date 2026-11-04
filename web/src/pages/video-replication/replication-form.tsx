import { Button, Input } from "antd";
import { FileVideo, ScanSearch } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";

import { ModelPicker } from "@/components/model-picker";
import { SegmentedControl } from "@/components/ui/base/segmented-control";
import { Switch } from "@/components/ui/base/switch";
import { videoTeardownModelError, videoTeardownTextRequirements, type VideoTeardownOptions } from "@/lib/canvas/video-teardown";
import { socialVideoURLFromText } from "@/services/api/social-video";
import type { AiConfig } from "@/stores/use-config-store";
import type { ReplicationSource } from "./use-replication-runner";

type Props = {
    config: AiConfig;
    model: string;
    onModelChange: (model: string) => void;
    transcribe: boolean;
    onTranscribeChange: (value: boolean) => void;
    busy: boolean;
    onStart: (source: ReplicationSource, options: VideoTeardownOptions) => void;
};

/** 新建拆解：粘贴平台链接或上传本地视频，选看图模型和是否识别口播。 */
export function ReplicationForm({ config, model, onModelChange, transcribe, onTranscribeChange, busy, onStart }: Props) {
    const [mode, setMode] = useState<"link" | "file">("link");
    const [linkText, setLinkText] = useState("");
    const [file, setFile] = useState<File | null>(null);
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

    return (
        <section className="flex flex-col gap-4 rounded-[var(--r-lg)] border border-border bg-card p-4" aria-label="新建拆解">
            <div>
                <h2 className="text-base font-semibold">新建拆解</h2>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">切镜头、截关键帧、识别口播，再用能看图的模型补全画面、运镜和制作方式。</p>
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
                        <Input.TextArea value={linkText} onChange={(event) => setLinkText(event.target.value)} autoSize={{ minRows: 3, maxRows: 5 }} placeholder="粘贴抖音或 TikTok 的分享内容或视频链接" aria-label="视频链接" />
                    ) : (
                        <div className="flex min-w-0 items-center gap-2">
                            <Button icon={<FileVideo className="size-4" />} onClick={() => fileInputRef.current?.click()}>
                                {file ? "换一个视频" : "选择视频文件"}
                            </Button>
                            {file ? <span className="min-w-0 truncate text-xs text-muted-foreground">{`${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} MB`}</span> : null}
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
                    )}
                </div>
            </Field>
            <Field label="分析模型">
                <ModelPicker config={config} capability="text" value={model} onChange={onModelChange} requirements={videoTeardownTextRequirements(config, 1)} fullWidth placeholder="选择能看图的文本模型" />
            </Field>
            <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-foreground/70">识别口播</span>
                <Switch checked={transcribe} onChange={onTranscribeChange} aria-label="识别口播" />
            </div>
            <p className="-mt-2 text-xs leading-5 text-muted-foreground">需要服务端配置转写服务；没配置时从画面字幕读口播。</p>
            {sourceError || modelError ? (
                <p role="alert" className="text-sm text-destructive">
                    {sourceError || modelError}
                </p>
            ) : null}
            <Button type="primary" size="large" block icon={<ScanSearch className="size-4" />} disabled={!ready} loading={busy} onClick={start}>
                {busy ? "正在拆解" : "开始拆解"}
            </Button>
            <ul className="list-disc space-y-1 pl-4 text-xs leading-5 text-muted-foreground">
                <li>视频最长 3 分钟，最多拆 60 个镜头。切镜和抽帧不收费，模型分析按所选模型计费。</li>
                <li>拆解用于学习结构和节奏。复刻请使用你有权使用的素材和形象，不要搬运原视频。</li>
            </ul>
        </section>
    );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="flex flex-col gap-1.5">
            <span className="text-sm text-foreground/70">{label}</span>
            {children}
        </div>
    );
}
