import { Button, Input } from "antd";
import { MessageCircleQuestion, Telescope } from "lucide-react";
import { STUDIO_DESIGN_TONES } from "@/lib/ecommerce-studio/detail-plan";
import { pickStudioDirection, setStudioAskNote, studioAnsweredAsks, studioPickedDirection, toggleStudioAskOption } from "@/lib/ecommerce-studio/plan-prep";
import type { StudioPlanPrep, StudioProduct } from "@/lib/ecommerce-studio/types";

type Edit = (updater: (product: StudioProduct) => StudioProduct, options?: { immediate?: boolean }) => void;

/** 下一步该做什么：先补充信息，再选设计方向，最后完成页面设计；用来决定哪个按钮是主按钮。 */
export type StudioPrepStep = "ask" | "directions" | "plan";

export function studioPrepStep(prep: StudioPlanPrep | undefined): StudioPrepStep {
    if (!prep?.asks.length) return "ask";
    if (!prep.directions.length) return "directions";
    return "plan";
}

/**
 * 页面设计的可选上下文：补充问题与设计方向都可以跳过，不会阻塞页面设计或出图。
 * 已回答内容和选中的方向会作为可调整参考带进策划。
 */
export function StudioPlanPrepPanel({ product, edit, asking, directing, disabled, onAsk, onDirections }: { product: StudioProduct; edit: Edit; asking: boolean; directing: boolean; disabled: boolean; onAsk: () => void; onDirections: () => void }) {
    const prep = product.brief.prep;
    const asks = prep?.asks || [];
    const directions = prep?.directions || [];
    const answered = studioAnsweredAsks(prep).length;
    const picked = studioPickedDirection(prep);
    const step = studioPrepStep(prep);
    const change = (updater: (value: StudioPlanPrep) => StudioPlanPrep, immediate = true) => edit((current) => (current.brief.prep ? { ...current, brief: { ...current.brief, prep: updater(current.brief.prep) } } : current), { immediate });
    return (
        <details className="es-prep-optional">
            <summary>
                <strong>可选创意上下文</strong>
                <span>不填写也能直接完成页面设计</span>
                {picked ? <em>已选方向</em> : null}
            </summary>
            <div className="es-prep">
                <section className="es-prep-block" aria-label="补充信息">
                    <header className="es-prep-head">
                        <strong>可选补充</strong>
                        <span className="es-prep-note">跳过也能直接设计</span>
                        {asks.length ? (
                            <span className="es-prep-count">
                                {answered}/{asks.length}
                            </span>
                        ) : null}
                        {asks.length ? (
                            <button type="button" className="es-link" disabled={disabled || asking} onClick={onAsk}>
                                {asking ? "生成问题中…" : "换一批问题"}
                            </button>
                        ) : (
                            <Button size="small" type={step === "ask" ? "primary" : "default"} icon={<MessageCircleQuestion size={14} />} loading={asking} disabled={disabled} onClick={onAsk}>
                                生成补充问题
                            </Button>
                        )}
                    </header>
                    {asks.length ? (
                        <ul className="es-asks">
                            {asks.map((ask) => (
                                <li key={ask.id} className="es-ask">
                                    <span className="es-ask-question">
                                        {ask.question}
                                        {ask.multi ? <span className="es-ask-multi">可多选</span> : null}
                                    </span>
                                    <div className="es-chips" role="group" aria-label={ask.question}>
                                        {ask.options.map((option) => (
                                            <button key={option} type="button" className="es-chip" aria-pressed={ask.picked.includes(option)} onClick={() => change((value) => toggleStudioAskOption(value, ask.id, option))}>
                                                {option}
                                            </button>
                                        ))}
                                    </div>
                                    <Input
                                        size="small"
                                        variant="filled"
                                        value={ask.note}
                                        maxLength={80}
                                        placeholder="补充"
                                        aria-label={`补充：${ask.question}`}
                                        onChange={(event) => change((value) => setStudioAskNote(value, ask.id, event.target.value), false)}
                                    />
                                </li>
                            ))}
                        </ul>
                    ) : null}
                </section>
                <section className="es-prep-block" aria-label="选设计方向">
                    <header className="es-prep-head">
                        <strong>创意参考</strong>
                        <span className="es-prep-note">图片模型保留最终设计权</span>
                        {picked ? <span className="es-prep-count">已选</span> : null}
                        {directions.length ? (
                            <button type="button" className="es-link" disabled={disabled || directing} onClick={onDirections}>
                                {directing ? "生成中…" : "换一批"}
                            </button>
                        ) : (
                            <Button size="small" type={step === "directions" ? "primary" : "default"} icon={<Telescope size={14} />} loading={directing} disabled={disabled} onClick={onDirections}>
                                生成创意参考
                            </Button>
                        )}
                    </header>
                    {directions.length ? (
                        <div className="es-directions" role="group" aria-label="设计方向方案">
                            {directions.map((direction) => (
                                <button key={direction.id} type="button" className="es-direction" aria-pressed={picked?.id === direction.id} onClick={() => change((value) => pickStudioDirection(value, direction.id))}>
                                    {direction.palette.length ? (
                                        <span className="es-direction-palette" aria-hidden>
                                            {direction.palette.map((color) => (
                                                <i key={color.hex + color.name} style={{ background: color.hex }} title={`${color.name} ${color.hex}`} />
                                            ))}
                                        </span>
                                    ) : null}
                                    <span className="es-direction-head">
                                        <strong>{direction.angle}</strong>
                                        {direction.tone ? <span>{STUDIO_DESIGN_TONES[direction.tone].label}</span> : null}
                                    </span>
                                    <span className="es-direction-text">{direction.positioning}</span>
                                </button>
                            ))}
                        </div>
                    ) : null}
                </section>
            </div>
        </details>
    );
}
