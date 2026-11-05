import { Button, Input } from "antd";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { ECOMMERCE_ONE_CLICK_FLOWS } from "@/lib/ecommerce/ecommerce-oneclick";
import type { EcommerceFlowId, EcommerceSuiteTemplate } from "@/services/api/ecommerce-canvas";
import { AdminIconButton, AdminSelect, AdminSwitch } from "../ui/controls";

export const TEMPLATE_FLOW_OPTIONS = ECOMMERCE_ONE_CLICK_FLOWS.map((item) => ({ value: item.id, label: item.name.replace(/^一键/, "") }));
export const templateFlowLabel = (flow: EcommerceFlowId) => TEMPLATE_FLOW_OPTIONS.find((item) => item.value === flow)?.label ?? "套图";
const MAX_SHOTS = 30;

function Field({ label, hint, className, children }: { label: string; hint?: string; className?: string; children: ReactNode }) {
    return (
        <label className={className ? `ecm-field ${className}` : "ecm-field"}>
            <span>{label}</span>
            {children}
            {hint ? <small>{hint}</small> : null}
        </label>
    );
}

/** 后台精选里一套模板的编辑区：基本信息、整套视觉规范和按顺序排列的每张图。 */
export function EcommerceTemplateForm({ template, disabled, onChange, onRemove }: { template: EcommerceSuiteTemplate; disabled: boolean; onChange: (value: Partial<EcommerceSuiteTemplate>) => void; onRemove: () => void }) {
    const shots = template.shots;
    const patchShot = (index: number, value: Partial<EcommerceSuiteTemplate["shots"][number]>) => onChange({ shots: shots.map((shot, i) => (i === index ? { ...shot, ...value } : shot)) });
    const move = (index: number, offset: -1 | 1) => {
        const next = [...shots];
        const [shot] = next.splice(index, 1);
        next.splice(index + offset, 0, shot);
        onChange({ shots: next });
    };
    return (
        <section className="ecm-card ecm-form" aria-label="编辑套图模板">
            <header className="ecm-form-head">
                <div className="ecm-form-title">
                    <span>
                        {templateFlowLabel(template.flow)} · {shots.length} 张{template.category ? ` · ${template.category}` : ""}
                    </span>
                    <h3>{template.name.trim() || "未命名模板"}</h3>
                </div>
                <label className="ecm-form-switch">
                    <AdminSwitch aria-label="套图模板开放使用" disabled={disabled} checked={template.enabled} onChange={(enabled) => onChange({ enabled })} />
                    <span>{template.enabled ? "已启用" : "草稿"}</span>
                </label>
                <Button type="text" danger icon={<Trash2 className="size-3.5" />} disabled={disabled} onClick={onRemove}>
                    移除模板
                </Button>
            </header>
            <div className="ecm-form-body">
                <div className="ecm-form-grid">
                    <Field label="名称">
                        <Input aria-label="套图模板名称" disabled={disabled} value={template.name} maxLength={100} placeholder="必填" status={template.name.trim() ? undefined : "error"} onChange={(e) => onChange({ name: e.target.value })} />
                    </Field>
                    <Field label="类目">
                        <Input aria-label="套图模板类目" disabled={disabled} value={template.category} maxLength={200} placeholder="例如：家居日用 / 水杯" onChange={(e) => onChange({ category: e.target.value })} />
                    </Field>
                    <Field label="用途">
                        <AdminSelect<EcommerceFlowId> ariaLabel="套图模板用途" appearance="field" disabled={disabled} value={template.flow} options={TEMPLATE_FLOW_OPTIONS} onChange={(flow) => onChange({ flow })} />
                    </Field>
                    <Field label="来源备注">
                        <Input aria-label="模板来源" disabled={disabled} maxLength={500} value={template.source} onChange={(e) => onChange({ source: e.target.value })} />
                    </Field>
                </div>
                <Field label="整套视觉规范" hint="整套图共用的色调、光线和版式；每张图的职责写在下面。">
                    <Input.TextArea aria-label="模板视觉规范" disabled={disabled} autoSize={{ minRows: 3, maxRows: 10 }} maxLength={6000} value={template.style} onChange={(e) => onChange({ style: e.target.value })} />
                </Field>
                <div className="ecm-shots">
                    <div className="ecm-shots-head">
                        <strong>画面顺序</strong>
                        <span>
                            {shots.length} / {MAX_SHOTS} 张，生图台按这个顺序出图
                        </span>
                    </div>
                    <ol>
                        {shots.map((shot, index) => (
                            <li key={index} className="ecm-shot">
                                <span className="ecm-shot-index" aria-hidden>
                                    {index + 1}
                                </span>
                                <div className="ecm-shot-fields">
                                    <Input
                                        aria-label={`模板第 ${index + 1} 张标题`}
                                        disabled={disabled}
                                        maxLength={100}
                                        placeholder="这张图的标题（必填）"
                                        status={shot.title.trim() ? undefined : "error"}
                                        value={shot.title}
                                        onChange={(e) => patchShot(index, { title: e.target.value })}
                                    />
                                    <Input.TextArea
                                        aria-label={`模板第 ${index + 1} 张职责`}
                                        disabled={disabled}
                                        status={shot.duty.trim() ? undefined : "error"}
                                        autoSize={{ minRows: 2, maxRows: 10 }}
                                        maxLength={12000}
                                        placeholder="这张图要做什么，镜头、布光、文字位置等可以分行写"
                                        value={shot.duty}
                                        onChange={(e) => patchShot(index, { duty: e.target.value })}
                                    />
                                </div>
                                <div className="ecm-shot-actions">
                                    <AdminIconButton icon={ArrowUp} aria-label={`第 ${index + 1} 张上移`} title="上移" disabled={disabled || index === 0} onClick={() => move(index, -1)} />
                                    <AdminIconButton icon={ArrowDown} aria-label={`第 ${index + 1} 张下移`} title="下移" disabled={disabled || index === shots.length - 1} onClick={() => move(index, 1)} />
                                    <AdminIconButton icon={Trash2} aria-label={`移除第 ${index + 1} 张`} title="移除这张" disabled={disabled || shots.length <= 1} onClick={() => onChange({ shots: shots.filter((_, i) => i !== index) })} />
                                </div>
                            </li>
                        ))}
                    </ol>
                    <Button
                        className="ecm-shot-add"
                        type="dashed"
                        block
                        icon={<Plus className="size-4" />}
                        disabled={disabled || shots.length >= MAX_SHOTS}
                        onClick={() => onChange({ shots: [...shots, { title: `第 ${shots.length + 1} 张`, duty: "请填写画面职责" }] })}
                    >
                        添加一张
                    </Button>
                </div>
            </div>
        </section>
    );
}
