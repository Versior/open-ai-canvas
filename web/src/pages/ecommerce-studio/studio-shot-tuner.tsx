import { App, Button, Input } from "antd";
import { Copy, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { studioPlatformForbidsText } from "@/lib/ecommerce-studio/brief";
import { STUDIO_TWEAKS, studioShotSpec } from "@/lib/ecommerce-studio/shot-specs";
import type { StudioProduct, StudioShot } from "@/lib/ecommerce-studio/types";
import { useEffectiveConfig } from "@/stores/use-config-store";
import { compileStudioShot, locateStudioShot, type StudioShotRef } from "./use-studio-runner";

export type StudioShotPatch = Pick<StudioShot, "tweaks" | "headline" | "subline" | "lines">;

const LAYER_SOURCE_HINT = "每层标出来源；超出模型字数上限时，先裁掉质感、品类、风格这些修饰层。";

function sameList(a: string[], b: string[]) {
    return a.length === b.length && a.every((item, index) => item === b[index]);
}

/**
 * 调整这一张：微调标签只改这张图的构图与光线，文案改动只影响这张；改完按调整再出一张，之前的结果都保留。
 * 下方的提示词按提交时的同一套规则现场编译，看到的就是这次会发出去的内容。
 */
export function StudioShotTuner({
    product,
    shotRef,
    shot,
    imageModel,
    blocked,
    active,
    onRun,
}: {
    product: StudioProduct;
    shotRef: StudioShotRef;
    shot: StudioShot;
    imageModel: string;
    blocked: string;
    active: boolean;
    onRun: (patch: StudioShotPatch) => void;
}) {
    const { message } = App.useApp();
    const config = useEffectiveConfig();
    const [tweaks, setTweaks] = useState(shot.tweaks);
    const [headline, setHeadline] = useState(shot.headline);
    const [subline, setSubline] = useState(shot.subline);
    const [lines, setLines] = useState(shot.lines.join("\n"));
    const [promptOpen, setPromptOpen] = useState(false);
    const spec = studioShotSpec(shot.role, product.dossier?.family || "generic");
    const copyAllowed = spec.copySlot !== "none" && product.brief.language !== "none" && !studioPlatformForbidsText(product, shot.role);

    const patch = useMemo<StudioShotPatch>(
        () => ({
            tweaks,
            headline: headline.trim(),
            subline: subline.trim(),
            lines: lines
                .split("\n")
                .map((line) => line.trim())
                .filter(Boolean)
                .slice(0, 6),
        }),
        [headline, lines, subline, tweaks],
    );
    const changed = !sameList(patch.tweaks, shot.tweaks) || patch.headline !== shot.headline || patch.subline !== shot.subline || !sameList(patch.lines, shot.lines);

    const preview = useMemo(() => {
        if (!promptOpen) return undefined;
        if (!imageModel) return { error: "先在左侧选择图片模型" };
        const located = locateStudioShot(product, shotRef, shot.id);
        if (!located) return { error: "这张图已不在记录里" };
        try {
            return { compiled: compileStudioShot(product, { ...located, shot: { ...located.shot, ...patch } }, imageModel, config).compiled };
        } catch (error) {
            return { error: error instanceof Error ? error.message : "提示词编译失败" };
        }
    }, [config, imageModel, patch, product, promptOpen, shot.id, shotRef]);

    const toggle = (id: string) => setTweaks((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));

    const copyPrompt = async (prompt: string) => {
        try {
            await navigator.clipboard.writeText(prompt);
            message.success("提示词已复制");
        } catch {
            message.error("复制失败，请手动选中复制");
        }
    };

    const notices = preview?.compiled ? [preview.compiled.textModeNotice, preview.compiled.referenceNotice, preview.compiled.trimmed.length ? `超出字数上限，已裁掉 ${preview.compiled.trimmed.length} 层修饰` : ""].filter(Boolean) : [];

    return (
        <section className="es-tuner" aria-label="调整这一张">
            <span className="es-tuner-title">调整这一张</span>
            <div className="es-chips" role="group" aria-label="微调">
                {STUDIO_TWEAKS.map((tweak) => (
                    <button key={tweak.id} type="button" className="es-chip" aria-pressed={tweaks.includes(tweak.id)} title={tweak.instruction} onClick={() => toggle(tweak.id)}>
                        {tweak.label}
                    </button>
                ))}
            </div>
            {copyAllowed ? (
                <div className="es-tuner-copy">
                    <label className="es-tuner-field">
                        <span>图上主标题</span>
                        <Input placeholder="留空则不写" value={headline} maxLength={30} onChange={(event) => setHeadline(event.target.value)} />
                    </label>
                    {spec.copySlot === "headline-subline" ? (
                        <label className="es-tuner-field">
                            <span>副标题</span>
                            <Input placeholder="留空则不写" value={subline} maxLength={40} onChange={(event) => setSubline(event.target.value)} />
                        </label>
                    ) : null}
                    {spec.copySlot === "points" ? (
                        <label className="es-tuner-field">
                            <span>要点（每行一条，最多 6 条）</span>
                            <Input.TextArea value={lines} autoSize={{ minRows: 2, maxRows: 6 }} maxLength={300} onChange={(event) => setLines(event.target.value)} />
                        </label>
                    ) : null}
                </div>
            ) : null}
            <Button type="primary" icon={<RefreshCw size={14} />} disabled={Boolean(blocked) || active} title={blocked || undefined} onClick={() => onRun(patch)}>
                {active ? "正在出新的一张…" : changed ? "按调整再出一张" : "再出一张"}
            </Button>
            <details className="es-prompt" onToggle={(event) => setPromptOpen(event.currentTarget.open)}>
                <summary>查看这张的提示词</summary>
                {preview?.error ? (
                    <p className="es-prompt-note" role="alert">
                        {preview.error}
                    </p>
                ) : null}
                {preview?.compiled ? (
                    <div className="es-prompt-body">
                        <p className="es-prompt-note">
                            {preview.compiled.adapter.label} · {preview.compiled.prompt.length} 字 · {LAYER_SOURCE_HINT}
                        </p>
                        {notices.map((notice) => (
                            <p key={notice} className="es-prompt-note" data-tone="warning">
                                {notice}
                            </p>
                        ))}
                        {preview.compiled.layers.map((layer) => (
                            <div key={layer.id} className="es-prompt-layer">
                                <strong>{layer.title}</strong>
                                <span>{layer.source}</span>
                                <p>{layer.text}</p>
                            </div>
                        ))}
                        <Button size="small" icon={<Copy size={13} />} onClick={() => void copyPrompt(preview.compiled.prompt)}>
                            复制提示词
                        </Button>
                    </div>
                ) : null}
            </details>
        </section>
    );
}
