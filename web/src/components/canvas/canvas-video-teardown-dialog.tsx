import { Button, Input } from "antd";
import { FileVideo } from "lucide-react";
import { useMemo, useRef, useState, type ReactNode } from "react";

import { ModelPicker } from "@/components/model-picker";
import { SegmentedControl } from "@/components/ui/base/segmented-control";
import { Switch } from "@/components/ui/base/switch";
import { AppModal } from "@/components/ui/product/app-modal";
import { videoTeardownModelError, videoTeardownTextRequirements, type VideoTeardownOptions } from "@/lib/canvas/video-teardown";
import { resourceIdFromStorageKey } from "@/services/api/resources";
import { socialVideoURLFromText } from "@/services/api/social-video";
import { selectableModelsByCapability, type AiConfig } from "@/stores/use-config-store";
import type { CanvasNodeData } from "@/types/canvas";

/** 拆解哪段视频：画布上已有的视频节点、平台分享链接，或本地视频文件。 */
export type VideoTeardownSource = { kind: "node"; node: CanvasNodeData } | { kind: "link"; text: string } | { kind: "file"; file: File };

type Props = {
    open: boolean;
    /** 从视频节点打开时传入；为空时让用户粘贴链接或上传视频。 */
    node: CanvasNodeData | null;
    config: AiConfig;
    /** 已有拆解在跑时不能再开始。 */
    busy: boolean;
    onClose: () => void;
    onStart: (source: VideoTeardownSource, options: VideoTeardownOptions) => void;
};

const MAX_DURATION_MS = 180_000;

export function CanvasVideoTeardownDialog(props: Props) {
    // 每次打开按来源重新挂载，不沿用上一次的输入。
    return props.open ? <TeardownEditor key={props.node?.id || "source"} {...props} /> : null;
}

function nodeSourceError(node: CanvasNodeData) {
    if (!resourceIdFromStorageKey(node.metadata?.storageKey)) return "视频还没有保存到服务器，等上传完成后再拆解";
    if ((node.metadata?.durationMs || 0) > MAX_DURATION_MS) return "视频超过 3 分钟，请先截取片段再拆解";
    return "";
}

function TeardownEditor({ node, config, busy, onClose, onStart }: Props) {
    const models = useMemo(() => selectableModelsByCapability(config, "text"), [config]);
    const defaultModel = useMemo(() => [config.textModel, ...models].find((model) => model && !videoTeardownModelError(config, model)) || "", [config, models]);
    const [model, setModel] = useState(defaultModel);
    const [transcribe, setTranscribe] = useState(true);
    const [mode, setMode] = useState<"link" | "file">("link");
    const [linkText, setLinkText] = useState("");
    const [file, setFile] = useState<File | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const modelError = videoTeardownModelError(config, model);
    const linkValid = Boolean(socialVideoURLFromText(linkText));
    const fileValid = Boolean(file && file.type.startsWith("video/"));
    const sourceError = node ? nodeSourceError(node) : mode === "link" ? (linkText.trim() && !linkValid ? "只支持抖音和 TikTok 的单视频链接或分享文字" : "") : file && !fileValid ? "请选择视频文件" : "";
    const sourceReady = node ? !sourceError : mode === "link" ? linkValid : fileValid;
    const ready = sourceReady && !modelError && !busy;
    const seconds = node?.metadata?.durationMs ? Math.round(node.metadata.durationMs / 100) / 10 : 0;

    const start = () => {
        if (!ready) return;
        const options = { model, transcribe };
        if (node) onStart({ kind: "node", node }, options);
        else if (mode === "link") onStart({ kind: "link", text: linkText }, options);
        else if (file) onStart({ kind: "file", file }, options);
    };

    return (
        <AppModal open centered title="拆解复刻" width={560} onCancel={onClose} okText="开始拆解" okButtonProps={{ disabled: !ready }} onOk={start}>
            <p className="mb-4 text-sm text-muted-foreground">先切镜头、截关键帧、识别口播，再用能看图的模型补全画面、运镜和制作方式，生成拆解分镜表和拆解报告。</p>
            <div className="flex flex-col gap-4">
                <OptionRow label="视频">
                    {node ? (
                        <div className="flex flex-wrap gap-2 text-xs">
                            <InfoChip>{node.title || "视频"}</InfoChip>
                            {seconds ? <InfoChip>{seconds} 秒</InfoChip> : null}
                            {node.metadata?.naturalWidth && node.metadata?.naturalHeight ? <InfoChip>{`${node.metadata.naturalWidth} × ${node.metadata.naturalHeight}`}</InfoChip> : null}
                        </div>
                    ) : (
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
                                <Input.TextArea value={linkText} onChange={(event) => setLinkText(event.target.value)} autoSize={{ minRows: 2, maxRows: 4 }} placeholder="粘贴抖音或 TikTok 的分享内容或视频链接" aria-label="视频链接" />
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
                    )}
                </OptionRow>
                <OptionRow label="分析模型">
                    <ModelPicker config={config} capability="text" value={model} onChange={setModel} requirements={videoTeardownTextRequirements(config, 1)} fullWidth placeholder="选择能看图的文本模型" />
                </OptionRow>
                <OptionRow label="识别口播" align="center">
                    <div className="flex items-center gap-3">
                        <Switch checked={transcribe} onChange={setTranscribe} aria-label="识别口播" />
                        <span className="text-xs text-muted-foreground">需要服务端配置转写服务；没配置时从画面字幕读口播</span>
                    </div>
                </OptionRow>
            </div>
            {sourceError || modelError ? (
                <p role="alert" className="mt-4 text-sm text-destructive">
                    {sourceError || modelError}
                </p>
            ) : null}
            {busy ? <p className="mt-4 text-sm text-muted-foreground">正在拆解另一段视频，完成后再开始。</p> : null}
            <ul className="mt-5 list-disc space-y-1 pl-4 text-xs text-muted-foreground">
                <li>视频最长 3 分钟，最多拆 60 个镜头。切镜和抽帧不收费，模型分析按所选模型计费。</li>
                <li>拆解用于学习结构和节奏。复刻请使用你有权使用的素材和形象，不要搬运原视频。</li>
            </ul>
        </AppModal>
    );
}

/** 标签默认对齐输入框第一行；单行控件（开关）用 center 与标签居中对齐。 */
function OptionRow({ label, align = "start", children }: { label: string; align?: "start" | "center"; children: ReactNode }) {
    return (
        <div className={`grid grid-cols-[72px_minmax(0,1fr)] gap-3 ${align === "center" ? "items-center" : "items-start"}`}>
            <span className={`whitespace-nowrap text-sm text-foreground/70 ${align === "center" ? "" : "pt-1.5"}`}>{label}</span>
            <div className="min-w-0">{children}</div>
        </div>
    );
}

function InfoChip({ children }: { children: ReactNode }) {
    return <span className="max-w-full truncate rounded-full bg-surface-tertiary px-2 py-1 text-foreground/70">{children}</span>;
}
