import { App, Button, Input } from "antd";
import { Copy, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { studioPromptOverridesRevision, subscribeStudioPromptOverrides } from "@/lib/ecommerce-studio/prompt-overrides";
import { studioPlatformForbidsText } from "@/lib/ecommerce-studio/brief";
import { reviewStudioCopy, studioFactCopyOptions } from "@/lib/ecommerce-studio/art-direction";
import { studioScreenCopyBudget, studioScreenCopyIssue } from "@/lib/ecommerce-studio/detail-plan";
import { STUDIO_TWEAKS, studioShotSpec } from "@/lib/ecommerce-studio/shot-specs";
import { STUDIO_SHOT_ADJUST_MAX, type StudioProduct, type StudioShot } from "@/lib/ecommerce-studio/types";
import { useEffectiveConfig } from "@/stores/use-config-store";
import { compileStudioShot, locateStudioShot, type StudioShotRef } from "./use-studio-runner";

export type StudioShotPatch = Pick<StudioShot, "tweaks" | "headline" | "subline" | "lines" | "adjust">;

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
    onApplyCopy,
    reviewRevision,
    revisionResourceId,
}: {
    product: StudioProduct;
    shotRef: StudioShotRef;
    shot: StudioShot;
    imageModel: string;
    blocked: string;
    active: boolean;
    onRun: (patch: StudioShotPatch) => void;
    onApplyCopy?: (patch: StudioShotPatch) => void;
    reviewRevision?: string;
    revisionResourceId?: string;
}) {
    const { message } = App.useApp();
    const config = useEffectiveConfig();
    const promptRevision = useSyncExternalStore(subscribeStudioPromptOverrides, studioPromptOverridesRevision);
    const [tweaks, setTweaks] = useState(shot.tweaks);
    const [headline, setHeadline] = useState(shot.headline);
    const [subline, setSubline] = useState(shot.subline);
    const [lines, setLines] = useState(shot.lines.join("\n"));
    const [adjust, setAdjust] = useState(shot.adjust || "");
    useEffect(() => {
        if (!reviewRevision) return;
        if (reviewRevision.length > STUDIO_SHOT_ADJUST_MAX) {
            message.error(`修正要求超过 ${STUDIO_SHOT_ADJUST_MAX} 字，请根据检查结果精简后填写`);
            return;
        }
        setAdjust(reviewRevision);
    }, [reviewRevision]);
    const [promptOpen, setPromptOpen] = useState(false);
    const spec = studioShotSpec(shot.role, product.dossier?.family || "generic");
    const copyAllowed = spec.copySlot !== "none" && product.brief.language !== "none" && !studioPlatformForbidsText(product, shot.role);
    // 详情页策划的屏文案不按角色的版位走，主标题、副标题和要点都可以改。
    const planned = Boolean(shot.visual?.trim());

    const patch = useMemo<StudioShotPatch>(
        () => ({
            tweaks,
            headline: headline.trim(),
            subline: subline.trim(),
            lines: lines
                .split("\n")
                .map((line) => line.trim())
                .filter(Boolean),
            adjust: adjust.trim().slice(0, STUDIO_SHOT_ADJUST_MAX),
        }),
        [adjust, headline, lines, subline, tweaks],
    );
    const changed = !sameList(patch.tweaks, shot.tweaks) || patch.headline !== shot.headline || patch.subline !== shot.subline || !sameList(patch.lines, shot.lines) || patch.adjust !== (shot.adjust || "");
    const copyBudget = studioScreenCopyBudget(shot.role);
    const copyIssue = copyAllowed ? studioScreenCopyIssue({ ...shot, ...patch }) : undefined;

    const preview = useMemo(() => {
        if (!promptOpen) return undefined;
        if (!imageModel) return { error: "先在左侧选择图片模型" };
        const located = locateStudioShot(product, shotRef, shot.id);
        if (!located) return { error: "这张图已不在记录里" };
        const latest = located.shot.attempts.at(-1);
        if (!changed && latest?.input && ["submitting", "queued", "running"].includes(latest.status)) return { compiled: latest.input.compiled };
        try {
            return { compiled: compileStudioShot(product, { ...located, shot: { ...located.shot, ...patch } }, imageModel, config, revisionResourceId && (changed || patch.adjust || patch.tweaks.length) ? revisionResourceId : undefined).compiled };
        } catch (error) {
            return { error: error instanceof Error ? error.message : "提示词编译失败" };
        }
    }, [config, imageModel, patch, product, promptOpen, shot.id, shotRef, revisionResourceId, changed, promptRevision]);

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
            <label className="es-tuner-field">
                <span>还想怎么改（只改这一张）</span>
                <Input.TextArea value={adjust} autoSize={{ minRows: 2, maxRows: 5 }} maxLength={STUDIO_SHOT_ADJUST_MAX} placeholder="例如：背景换成浅木纹桌面，商品往左放一点，标题改成深蓝色" onChange={(event) => setAdjust(event.target.value)} />
            </label>
            {copyAllowed ? (
                <div className="es-tuner-copy">
                    {reviewStudioCopy(patch).map((issue) => (
                        <p key={issue.code} className="es-prompt-note" data-tone="warning">
                            {issue.message}
                        </p>
                    ))}
                    <div className="es-chips" aria-label="用已确认卖点替换文案">
                        {studioFactCopyOptions(product).map((copy) => (
                            <button
                                key={copy.headline}
                                type="button"
                                className="es-chip"
                                onClick={() => {
                                    setHeadline(copy.headline);
                                    setSubline(copy.subline);
                                }}
                            >
                                {copy.headline}
                            </button>
                        ))}
                    </div>
                    <label className="es-tuner-field">
                        <span>图上主标题</span>
                        <Input placeholder="留空则不写" value={headline} maxLength={30} onChange={(event) => setHeadline(event.target.value)} />
                    </label>
                    {spec.copySlot === "headline-subline" || planned || onApplyCopy ? (
                        <label className="es-tuner-field">
                            <span>副标题</span>
                            <Input placeholder="留空则不写" value={subline} maxLength={40} onChange={(event) => setSubline(event.target.value)} />
                        </label>
                    ) : null}
                    {spec.copySlot === "points" || planned || onApplyCopy ? (
                        <label className="es-tuner-field">
                            <span>要点（每行一条，最多 {copyBudget.lines} 条）</span>
                            <Input.TextArea value={lines} autoSize={{ minRows: 2, maxRows: 6 }} maxLength={300} onChange={(event) => setLines(event.target.value)} />
                        </label>
                    ) : null}
                </div>
            ) : null}
            {copyIssue ? (
                <p className="es-prompt-note" role="alert">
                    {copyIssue}
                </p>
            ) : null}
            <Button type="primary" icon={<RefreshCw size={14} />} disabled={Boolean(blocked || copyIssue) || active} title={blocked || copyIssue || undefined} onClick={() => onRun(patch)}>
                {active ? "正在出新的一张…" : changed ? "按调整再出一张" : "再出一张"}
            </Button>
            {onApplyCopy && copyAllowed ? (
                <Button disabled={active || Boolean(copyIssue)} onClick={() => onApplyCopy(patch)}>
                    仅更新排字 · 不重新生图
                </Button>
            ) : null}
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
