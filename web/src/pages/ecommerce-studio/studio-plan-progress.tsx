import { useEffect, useState } from "react";
import type { StudioClaimSource } from "@/lib/ecommerce-studio/claim-evidence";
import { studioPlanEvidenceMatch } from "@/lib/ecommerce-studio/detail-plan-tasks";
import { getActiveUserScope } from "@/lib/user-scope";
import { studioPlanProgressKey, useStudioPlanProgress } from "./use-studio-plan-progress";
import "./studio-plan-progress.css";

export function StudioPlanProgressPanel({ productId, inputSignature, claimSources }: { productId: string; inputSignature: string; claimSources: StudioClaimSource[] }) {
    const userScope = getActiveUserScope();
    const progress = useStudioPlanProgress((state) => state.items[studioPlanProgressKey(userScope, productId)]);
    const [now, setNow] = useState(Date.now());
    const active = progress && progress.phase !== "failed" && progress.phase !== "completed";
    useEffect(() => {
        if (!active) return;
        setNow(Date.now());
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, [active]);
    if (!progress || progress.phase === "completed") return null;
    if (progress.phase === "failed" && !progress.screens.length && !progress.summary.trim() && !progress.concept.trim()) return null;
    const detail = progress.scope === "detail";
    const screens = detail ? progress.screens.filter(({ index }) => index < progress.totalScreens) : progress.screens;
    const elapsed = Math.max(0, Math.floor((now - progress.startedAt) / 1000));
    const title =
        progress.phase === "preparing"
            ? "整理商品与参考图"
            : progress.phase === "queued"
              ? "页面设计任务已排队"
              : progress.phase === "validating"
                ? detail
                    ? "整理逐屏策划"
                    : "整理页面设计草稿"
                : progress.phase === "failed"
                  ? "页面设计未完成"
                  : screens.length >= progress.totalScreens
                    ? detail
                        ? "正在完成整套策划"
                        : "正在完善整组设计"
                    : progress.characters
                      ? `正在策划第 ${Math.min(progress.totalScreens, screens.length + 1)} ${progress.unit}`
                      : detail
                        ? "正在分析商品"
                        : "模型正在分析商品与构思";
    const inputChanged = inputSignature !== progress.inputSignature;
    const concept = progress.concept.trim();
    const summary = progress.summary.trim();
    return (
        <section className="es-plan-progress" aria-label="实时页面设计进度">
            <header className="es-plan-progress-head">
                <strong aria-live="polite">{title}</strong>
                <span>
                    {screens.length} / {progress.totalScreens} {progress.unit} · {elapsed < 60 ? `${elapsed} 秒` : `${Math.floor(elapsed / 60)} 分 ${elapsed % 60} 秒`}
                </span>
            </header>
            <div className="es-plan-progress-track" role="progressbar" aria-label={detail ? "逐屏策划进度" : "逐张草稿进度"} aria-valuemin={0} aria-valuemax={progress.totalScreens} aria-valuenow={Math.min(progress.totalScreens, screens.length)}>
                {Array.from({ length: progress.totalScreens }, (_, index) => (
                    <span
                        key={index}
                        data-state={screens.some((screen) => screen.index === index) ? "ready" : progress.characters > 0 && index === screens.length && progress.phase === "writing" ? "writing" : "pending"}
                        title={`第 ${index + 1} ${progress.unit}`}
                    />
                ))}
            </div>
            {concept || summary ? (
                <div className="es-plan-progress-direction">
                    {concept ? <h3>{concept}</h3> : null}
                    {summary && summary !== concept ? <p>{summary}</p> : null}
                </div>
            ) : null}
            {inputChanged ? <p className="es-plan-progress-note">商品资料已修改，这份草稿不会套用到当前设置。</p> : null}
            {screens.length ? (
                <ol className="es-plan-draft-list">
                    {screens.map((screen) => {
                        const title = screen.title || screen.purpose || `第 ${screen.index + 1} ${progress.unit}`;
                        const lead = screen.visualBeat || screen.visual;
                        const more = screen.visualBeat && screen.visual !== lead ? screen.visual : undefined;
                        const focus = detail && (screen.elements === screen.visual || screen.elements === lead) ? undefined : screen.elements;
                        const evidence = detail ? !inputChanged && [...new Set(screen.evidence?.map((reference) => studioPlanEvidenceMatch(claimSources, reference, { numbered: true })?.text).filter(Boolean))].join("、") : screen.evidence?.join("、");
                        return (
                            <li key={screen.index} value={screen.index + 1}>
                                <div className="es-plan-draft-number" aria-hidden="true">
                                    {String(screen.index + 1).padStart(2, "0")}
                                </div>
                                <div>
                                    <strong>{title}</strong>
                                    {!detail && screen.purpose && screen.purpose !== title ? <p>{screen.purpose}</p> : null}
                                    {lead && lead !== title && lead !== screen.purpose ? <p>{lead}</p> : null}
                                    {more || focus || evidence ? (
                                        <details>
                                            <summary>{more ? "展示内容" : focus ? (evidence ? "重点与依据" : "视觉重点") : "依据"}</summary>
                                            {more ? <p>{more}</p> : null}
                                            {focus ? <p>{focus}</p> : null}
                                            {evidence ? <p>{evidence}</p> : null}
                                        </details>
                                    ) : null}
                                </div>
                            </li>
                        );
                    })}
                </ol>
            ) : null}
        </section>
    );
}
