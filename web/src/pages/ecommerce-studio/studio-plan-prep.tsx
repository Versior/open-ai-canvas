import { Button, Input } from "antd";
import { MessageCircleQuestion, Telescope } from "lucide-react";
import { STUDIO_DESIGN_TONES } from "@/lib/ecommerce-studio/detail-plan";
import { pickStudioDirection, setStudioAskNote, studioAnsweredAsks, studioPickedDirection, toggleStudioAskOption } from "@/lib/ecommerce-studio/plan-prep";
import type { StudioPlanPrep, StudioProduct } from "@/lib/ecommerce-studio/types";

type Edit = (updater: (product: StudioProduct) => StudioProduct, options?: { immediate?: boolean }) => void;

/** 下一步该做什么：先补充信息，再选视角，最后策划；用来决定哪个按钮是主按钮。 */
export type StudioPrepStep = "ask" | "directions" | "plan";

export function studioPrepStep(prep: StudioPlanPrep | undefined): StudioPrepStep {
    if (!prep?.asks.length) return "ask";
    if (!prep.directions.length) return "directions";
    return "plan";
}

/**
 * 策划前的两步：AI 问几个只有卖家知道的问题（点选答案，可以补一句），再给几个不同视角的方向挑一个。
 * 都可以跳过；答过的和挑中的方向会带进每一次策划。
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
        <div className="es-prep">
            <section className="es-prep-block" aria-label="补充信息">
                <header className="es-prep-head">
                    <strong>补充信息</strong>
                    <span className="es-prep-hint">{asks.length ? `已答 ${answered}/${asks.length} · 点选答案，也可以补一句` : "商品图看不出来的：真正的卖点、给谁用、在哪用、想要的感觉"}</span>
                    {asks.length ? (
                        <button type="button" className="es-link" disabled={disabled || asking} onClick={onAsk}>
                            {asking ? "生成问题中…" : "换一批问题"}
                        </button>
                    ) : (
                        <Button size="small" type={step === "ask" ? "primary" : "default"} icon={<MessageCircleQuestion size={14} />} loading={asking} disabled={disabled} onClick={onAsk}>
                            AI 问我几个问题
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
                                    placeholder="补一句（可选）"
                                    aria-label={`补充：${ask.question}`}
                                    onChange={(event) => change((value) => setStudioAskNote(value, ask.id, event.target.value), false)}
                                />
                            </li>
                        ))}
                    </ul>
                ) : null}
            </section>
            <section className="es-prep-block" aria-label="选视角">
                <header className="es-prep-head">
                    <strong>选视角</strong>
                    <span className="es-prep-hint">{directions.length ? (picked ? `按「${picked.angle}」策划，再点一次取消` : "挑一个方向；不挑就由 AI 自己定") : "AI 给几个不同的方向：讲给谁听、什么色彩、什么调性"}</span>
                    {directions.length ? (
                        <button type="button" className="es-link" disabled={disabled || directing} onClick={onDirections}>
                            {directing ? "生成中…" : "换一批"}
                        </button>
                    ) : (
                        <Button size="small" type={step === "directions" ? "primary" : "default"} icon={<Telescope size={14} />} loading={directing} disabled={disabled} onClick={onDirections}>
                            给我 3 个视角
                        </Button>
                    )}
                </header>
                {directions.length ? (
                    <div className="es-directions" role="group" aria-label="视角方案">
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
                                {direction.headline ? <span className="es-direction-headline">「{direction.headline}」</span> : null}
                                {direction.why ? <span className="es-direction-why">{direction.why}</span> : null}
                            </button>
                        ))}
                    </div>
                ) : null}
            </section>
        </div>
    );
}
