import { Button, Input } from "antd";
import { Check, Pencil, X } from "lucide-react";
import { nanoid } from "nanoid";
import { useEffect, useRef, useState } from "react";
import { answerStudioQuestion, confirmStudioFact, dismissStudioQuestion, patchStudioFactValue, removeStudioFact, removeStudioInvariant } from "@/lib/ecommerce-studio/dossier-review";
import { STUDIO_EVIDENCE_LABEL, STUDIO_FACT_GROUP_LABEL, STUDIO_FAMILY_LABEL, studioFactUsable, type StudioDossier, type StudioFact, type StudioFactGroup, type StudioProduct } from "@/lib/ecommerce-studio/types";

type Edit = (updater: (product: StudioProduct) => StudioProduct, options?: { immediate?: boolean }) => void;

const GROUP_ORDER: StudioFactGroup[] = ["identity", "appearance", "material", "structure", "text", "spec", "package", "usage"];

/** 事实的值：铅笔入口单击编辑，回车或失焦提交，Esc 放弃。 */
function FactValue({ fact, onCommit }: { fact: StudioFact; onCommit: (value: string) => void }) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(fact.value);
    const input = useRef<HTMLInputElement>(null);
    const cancelled = useRef(false);
    useEffect(() => {
        if (editing) input.current?.select();
    }, [editing]);
    if (editing) {
        return (
            <input
                ref={input}
                className="es-fact-input"
                value={draft}
                maxLength={240}
                aria-label={`修改${fact.label}`}
                onChange={(event) => setDraft(event.target.value)}
                onBlur={() => {
                    setEditing(false);
                    if (!cancelled.current && draft.trim() !== fact.value) onCommit(draft);
                }}
                onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                    if (event.key === "Escape") {
                        cancelled.current = true;
                        event.currentTarget.blur();
                    }
                }}
            />
        );
    }
    return (
        <button
            type="button"
            className="es-fact-value"
            aria-label={`修改${fact.label}：${fact.value}`}
            onClick={() => {
                cancelled.current = false;
                setDraft(fact.value);
                setEditing(true);
            }}
        >
            <span>{fact.value}</span>
            <Pencil size={11} aria-hidden />
        </button>
    );
}

function QuestionRow({ question, onAnswer, onDismiss }: { question: string; onAnswer: (answer: string) => void; onDismiss: () => void }) {
    const [answer, setAnswer] = useState("");
    const submit = () => {
        if (answer.trim()) onAnswer(answer);
    };
    return (
        <li className="es-question">
            <span className="es-question-text">{question}</span>
            <span className="es-question-answer">
                <Input size="small" placeholder="写下答案，回车记下" value={answer} maxLength={240} aria-label={`回答：${question}`} onChange={(event) => setAnswer(event.target.value)} onPressEnter={submit} />
                <Button size="small" disabled={!answer.trim()} onClick={submit}>
                    记下
                </Button>
                <button type="button" className="es-link" onClick={onDismiss}>
                    忽略
                </button>
            </span>
        </li>
    );
}

/**
 * 识别出的商品档案：卖家在这里核对。只有「图片可见」和「已确认」的信息进入出图提示词，
 * 所以确认推断、改掉错的、回答识别时的问题，都会直接改变出图依据。
 */
export function StudioDossierCard({ dossier, edit }: { dossier: StudioDossier; edit: Edit }) {
    const usable = dossier.facts.filter(studioFactUsable).length;
    const unsure = dossier.facts.length - usable;
    const [open, setOpen] = useState(() => unsure > 0 || dossier.questions.length > 0);
    const change = (updater: (value: StudioDossier) => StudioDossier) => edit((current) => (current.dossier ? { ...current, dossier: updater(current.dossier) } : current));
    const groups = GROUP_ORDER.map((group) => ({ group, facts: dossier.facts.filter((fact) => fact.group === group) })).filter((item) => item.facts.length);
    const meta = [dossier.category || dossier.name, STUDIO_FAMILY_LABEL[dossier.family], `${usable} 条用于出图`, unsure ? `${unsure} 条待确认` : "", dossier.questions.length ? `${dossier.questions.length} 个问题` : ""].filter(Boolean).join(" · ");
    return (
        <details className="es-dossier" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
            <summary>
                <span className="es-dossier-title">商品档案</span>
                <span className="es-dossier-meta">{meta}</span>
            </summary>
            <div className="es-dossier-body">
                <p className="es-dossier-note">只有「图片可见」和「已确认」的信息会写进出图提示词。推断的核对后点「确认」；写错的点一下直接改，改过的记为已确认。</p>
                {dossier.questions.length ? (
                    <div className="es-dossier-block">
                        <span className="es-fact-group-label">识别时没能确认</span>
                        <ul className="es-questions">
                            {dossier.questions.map((question) => (
                                <QuestionRow
                                    key={question}
                                    question={question}
                                    onAnswer={(answer) => change((value) => answerStudioQuestion(value, question, answer, nanoid(10)))}
                                    onDismiss={() => change((value) => dismissStudioQuestion(value, question))}
                                />
                            ))}
                        </ul>
                    </div>
                ) : null}
                {groups.map(({ group, facts }) => (
                    <div key={group} className="es-dossier-block">
                        <span className="es-fact-group-label">{STUDIO_FACT_GROUP_LABEL[group]}</span>
                        <ul className="es-facts">
                            {facts.map((fact) => {
                                const ok = studioFactUsable(fact);
                                return (
                                    <li key={fact.id} className="es-fact" data-usable={ok || undefined}>
                                        <span className="es-fact-label" title={fact.source ? `${fact.label} · 依据：${fact.source}` : fact.label}>
                                            {fact.label}
                                        </span>
                                        <FactValue fact={fact} onCommit={(value) => change((current) => patchStudioFactValue(current, fact.id, value))} />
                                        <span className="es-fact-badge" data-evidence={fact.evidence}>
                                            {STUDIO_EVIDENCE_LABEL[fact.evidence]}
                                        </span>
                                        {!ok ? (
                                            <Button size="small" icon={<Check size={12} />} onClick={() => change((current) => confirmStudioFact(current, fact.id))}>
                                                确认
                                            </Button>
                                        ) : null}
                                        <button type="button" className="es-icon-btn" aria-label={`删除：${fact.label}`} onClick={() => change((current) => removeStudioFact(current, fact.id))}>
                                            <X size={13} />
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    </div>
                ))}
                {dossier.invariants.length ? (
                    <div className="es-dossier-block">
                        <span className="es-fact-group-label">出图时不能改动</span>
                        <div className="es-invariants">
                            {dossier.invariants.map((item) => (
                                <span key={item} className="es-invariant">
                                    {item}
                                    <button type="button" aria-label={`移除：${item}`} onClick={() => change((current) => removeStudioInvariant(current, item))}>
                                        <X size={11} />
                                    </button>
                                </span>
                            ))}
                        </div>
                    </div>
                ) : null}
            </div>
        </details>
    );
}
