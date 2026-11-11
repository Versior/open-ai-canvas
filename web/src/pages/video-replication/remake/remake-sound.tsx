import { App, Button, Checkbox, Select, Slider, Spin } from "antd";
import { Images, Music2, Upload, X } from "lucide-react";
import { lazy, Suspense, useMemo, useRef, useState } from "react";
import { ModelPicker } from "@/components/model-picker";
import { audioVoiceOptionsForConfig, normalizeAudioVoiceForConfig } from "@/lib/audio-generation";
import { formatProductVideoSeconds } from "@/lib/product-video/media";
import { REMAKE_LANGUAGES, type RemakeJob } from "@/lib/remake/job";
import { getResource, resourceFileUrl, uploadResourceFile } from "@/services/api/resources";
import { getActiveUserScope } from "@/lib/user-scope";
import type { AiConfig } from "@/stores/use-config-store";
import type { RemakeEdit } from "./remake-recipe";

const WorkbenchAssetPicker = lazy(() => import("@/pages/workbench/workbench-asset-picker").then((module) => ({ default: module.WorkbenchAssetPicker })));

const SPEEDS = ["0.9", "1", "1.1", "1.2", "1.3"];

/** 新口播的语言；改写口播、配音和字幕都按它。 */
export function RemakeLanguageField({ job, edit, disabled }: { job: RemakeJob; edit: RemakeEdit; disabled?: boolean }) {
    return (
        <label className="rw-field-row">
            <span>口播语言</span>
            <Select
                size="small"
                value={job.language}
                disabled={disabled}
                popupMatchSelectWidth={false}
                options={REMAKE_LANGUAGES.map((item) => ({ value: item.value, label: item.label }))}
                onChange={(language) => edit((value) => ({ ...value, language }))}
                aria-label="口播语言"
            />
        </label>
    );
}

/** AI 配音：配音模型、音色和语速。音色列表跟着模型的协议走（OpenAI / 豆包）。 */
export function RemakeVoiceFields({ job, config, edit, disabled }: { job: RemakeJob; config: AiConfig; edit: RemakeEdit; disabled?: boolean }) {
    const probe = useMemo(() => ({ ...config, model: job.voice.model, audioModel: job.voice.model }), [config, job.voice.model]);
    const voices = useMemo(() => (job.voice.model ? audioVoiceOptionsForConfig(probe) : []), [job.voice.model, probe]);
    const voice = job.voice.model ? normalizeAudioVoiceForConfig(probe, job.voice.voice) : "";
    return (
        <div className="rw-fields">
            <ModelPicker
                config={config}
                capability="audio"
                value={job.voice.model}
                modelDisabledReason={() => (disabled ? "正在处理" : "")}
                onChange={(model) => edit((value) => ({ ...value, voice: { ...value.voice, model, voice: "" } }))}
                fullWidth
                showSelectedPrice={false}
                showOptionPrices
                placeholder="选择配音模型"
            />
            <div className="rw-field-pair">
                <Select
                    value={voice || undefined}
                    placeholder="音色"
                    disabled={disabled || !voices.length}
                    showSearch
                    optionFilterProp="label"
                    options={voices.map((item) => ({ value: item.value, label: item.label }))}
                    onChange={(next) => edit((value) => ({ ...value, voice: { ...value.voice, voice: next } }))}
                    aria-label="音色"
                />
                <Select
                    value={job.voice.speed || "1"}
                    disabled={disabled}
                    options={SPEEDS.map((speed) => ({ value: speed, label: `${speed} 倍速` }))}
                    onChange={(speed) => edit((value) => ({ ...value, voice: { ...value.voice, speed } }))}
                    aria-label="语速"
                />
            </div>
        </div>
    );
}

async function audioDuration(file: File) {
    return new Promise<number | undefined>((resolve) => {
        const url = URL.createObjectURL(file);
        const audio = new Audio();
        audio.preload = "metadata";
        audio.onloadedmetadata = () => {
            resolve(Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : undefined);
            URL.revokeObjectURL(url);
        };
        audio.onerror = () => {
            resolve(undefined);
            URL.revokeObjectURL(url);
        };
        audio.src = url;
    });
}

export function RemakeVoiceReference({ job, edit, disabled, onBusyChange }: { job: RemakeJob; edit: RemakeEdit; disabled?: boolean; onBusyChange: (busy: boolean) => void }) {
    const { message } = App.useApp();
    const input = useRef<HTMLInputElement>(null);
    const [busy, setBusy] = useState(false);
    const upload = async (file?: File) => {
        if (!file) return;
        const scope = getActiveUserScope();
        setBusy(true);
        onBusyChange(true);
        try {
            if (!file.type.startsWith("audio/")) throw new Error("请选择音频文件");
            const durationMs = await audioDuration(file);
            if (!durationMs || durationMs < 2000 || durationMs > 15000) throw new Error("请上传 2–15 秒的单人说话干声，避免音乐和多人混音");
            const resource = await uploadResourceFile(file, "audio", { fileName: file.name, durationMs });
            if (getActiveUserScope() !== scope) return;
            edit((value) => ({ ...value, voiceReference: { resourceId: resource.id, name: file.name, durationMs: resource.durationMs || durationMs } }));
        } catch (error) {
            message.error(error instanceof Error ? error.message : "音色参考上传失败");
        } finally {
            setBusy(false);
            onBusyChange(false);
        }
    };
    return (
        <div className="rw-fields">
            <div className="rw-field-row">
                <span>全片音色参考</span>
                <Button size="small" loading={busy} disabled={disabled || busy} onClick={() => input.current?.click()}>
                    {job.voiceReference ? "更换干声" : "上传说话干声"}
                </Button>
            </div>
            {job.voiceReference ? (
                <>
                    <audio controls preload="metadata" src={resourceFileUrl(job.voiceReference.resourceId)} aria-label="全片音色参考" />
                    <Button size="small" type="text" disabled={disabled || busy} onClick={() => edit((value) => ({ ...value, voiceReference: undefined }))}>
                        去掉音色参考
                    </Button>
                </>
            ) : null}
            <p className="rw-hint">2–15 秒，同一位说话人、不带背景音乐。各段参考同一音色，具体台词仍按镜头填写；需要视频模型支持参考音频。</p>
            <input
                ref={input}
                type="file"
                accept="audio/*"
                hidden
                onChange={(event) => {
                    void upload(event.target.files?.[0]);
                    event.target.value = "";
                }}
            />
        </div>
    );
}

/** 字幕和背景音乐：烧录字幕开关、背景音乐（素材库或本机）和音量。 */
export function RemakeFinishCard({ job, edit, disabled }: { job: RemakeJob; edit: RemakeEdit; disabled?: boolean }) {
    const { message } = App.useApp();
    const input = useRef<HTMLInputElement>(null);
    const [picking, setPicking] = useState(false);
    const [uploading, setUploading] = useState(false);
    const hasLines = job.audio !== "mute";
    const upload = async (file: File | undefined) => {
        if (!file) return;
        if (!file.type.startsWith("audio/")) {
            message.warning("请选择音频文件（MP3、WAV 或 M4A）");
            return;
        }
        setUploading(true);
        try {
            const durationMs = await audioDuration(file);
            const resource = await uploadResourceFile(file, "audio", { fileName: file.name, ...(durationMs ? { durationMs } : {}) });
            edit((value) => ({ ...value, music: { resourceId: resource.id, name: file.name, durationMs: resource.durationMs || durationMs, volume: value.music?.volume ?? 0.25 } }));
        } catch (error) {
            message.error(`上传失败：${error instanceof Error ? error.message : "请重试"}`);
        } finally {
            setUploading(false);
        }
    };
    return (
        <section className="rw-card">
            <header className="rw-card-head">
                <h3>字幕和音乐</h3>
            </header>
            <Checkbox checked={job.subtitles.burn && hasLines} disabled={disabled || !hasLines} onChange={(event) => edit((value) => ({ ...value, subtitles: { burn: event.target.checked } }))}>
                把字幕烧进成片
            </Checkbox>
            <p className="rw-hint">{hasLines ? "白字黑描边，放在画面下方。不烧录时也可以导出 SRT，或在剪映草稿里改字幕。" : "不要人声时没有字幕。"}</p>
            <div className="rw-music">
                {job.music ? (
                    <div className="rw-music-item">
                        <Music2 size={16} aria-hidden />
                        <span title={job.music.name}>
                            <strong>{job.music.name || "背景音乐"}</strong>
                            <small>{job.music.durationMs ? `${formatProductVideoSeconds(job.music.durationMs)} · 比成片短时循环，结尾淡出` : "比成片短时循环，结尾淡出"}</small>
                        </span>
                        {disabled ? null : <Button size="small" type="text" icon={<X size={14} />} aria-label="去掉背景音乐" onClick={() => edit((value) => ({ ...value, music: undefined }))} />}
                    </div>
                ) : (
                    <div className="rw-music-add">
                        <Button size="small" icon={uploading ? <Spin size="small" /> : <Upload size={14} />} disabled={disabled || uploading} onClick={() => input.current?.click()}>
                            上传背景音乐
                        </Button>
                        <Button size="small" icon={<Images size={14} />} disabled={disabled || uploading} onClick={() => setPicking(true)}>
                            素材库
                        </Button>
                    </div>
                )}
                {job.music ? (
                    <label className="rw-field-row">
                        <span>音乐音量</span>
                        <Slider
                            min={5}
                            max={100}
                            step={5}
                            value={Math.round(job.music.volume * 100)}
                            disabled={disabled}
                            tooltip={{ formatter: (value) => `${value}%` }}
                            onChange={(volume) => edit((value) => (value.music ? { ...value, music: { ...value.music, volume: volume / 100 } } : value))}
                            aria-label="音乐音量"
                        />
                    </label>
                ) : null}
            </div>
            <input
                ref={input}
                type="file"
                accept="audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a,audio/aac"
                hidden
                onChange={(event) => {
                    void upload(event.target.files?.[0]);
                    event.target.value = "";
                }}
            />
            {picking ? (
                <Suspense fallback={null}>
                    <WorkbenchAssetPicker
                        open
                        accept={["audio"]}
                        maxCount={1}
                        slotName="背景音乐"
                        onClose={() => setPicking(false)}
                        onPick={(assets) => {
                            setPicking(false);
                            const asset = assets[0];
                            if (!asset) return;
                            void getResource(asset.resourceId)
                                .then((resource) => resource.durationMs)
                                .catch(() => undefined)
                                .then((durationMs) => edit((value) => ({ ...value, music: { resourceId: asset.resourceId, name: asset.name, ...(durationMs ? { durationMs } : {}), volume: value.music?.volume ?? 0.25 } })));
                        }}
                    />
                </Suspense>
            ) : null}
        </section>
    );
}
