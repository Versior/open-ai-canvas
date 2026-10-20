import { App, Button, Input } from "antd";
import { useState } from "react";
import { parseEcomgenTemplate } from "@/lib/ecommerce/ecomgen-template";
import { ECOMMERCE_ONE_CLICK_FLOWS } from "@/lib/ecommerce/ecommerce-oneclick";
import type { EcommerceFlowId, EcommerceSuiteTemplate } from "@/services/api/ecommerce";
import { Switch } from "../ui/controls";
import { EcommerceTemplateCatalogDetails } from "@/components/canvas/ecommerce-template-catalog";

export function EcommerceTemplateEditor({ templates, disabled, onChange }: { templates: EcommerceSuiteTemplate[]; disabled: boolean; onChange: (value: EcommerceSuiteTemplate[]) => void }) {
    const { message } = App.useApp();
    const [selectedId, setSelectedId] = useState("");
    const [query, setQuery] = useState("");
    const [importText, setImportText] = useState("");
    const [flow, setFlow] = useState<EcommerceFlowId>("detail");
    const selected = templates.find((item) => item.id === selectedId);
    const patch = (value: Partial<EcommerceSuiteTemplate>) => onChange(templates.map((item) => (item.id === selectedId ? { ...item, ...value } : item)));
    const add = (template: EcommerceSuiteTemplate) => {
        if (templates.length >= 200) {
            message.error("最多保存 200 套模板");
            return;
        }
        if (templates.some((item) => item.id === template.id)) {
            message.error("模板标识重复，请先修改或移除已有模板");
            return;
        }
        onChange([...templates, template]);
        setSelectedId(template.id);
    };
    return (
        <div className="admin-ecommerce-template-editor">
            <EcommerceTemplateCatalogDetails title="项目内置套图库 · EcomGen" disabled={disabled} applyLabel="载入为可编辑草稿" onApply={(template) => add({ ...template, flow, enabled: false })} />
            <div className="admin-ecommerce-template-actions">
                <Button
                    disabled={disabled || templates.length >= 200}
                    onClick={() => add({ id: crypto.randomUUID(), name: "新套图模板", flow, category: "", enabled: false, style: "", source: "自建", shots: [{ title: "商品展示", duty: "展示真实商品的完整外观与核心用途" }] })}
                >
                    新增模板
                </Button>
                <label>
                    导入用途
                    <select aria-label="导入模板用途" disabled={disabled} value={flow} onChange={(e) => setFlow(e.target.value as EcommerceFlowId)}>
                        {ECOMMERCE_ONE_CLICK_FLOWS.map((item) => (
                            <option key={item.id} value={item.id}>
                                {item.name.replace(/^一键/, "")}
                            </option>
                        ))}
                    </select>
                </label>
            </div>
            <details className="admin-ecommerce-template-import">
                <summary>导入 EcomGen 套图 JSON</summary>
                <p>支持 ecomgen.suite v1。导入后先检查画面方向与商品事实，启用并保存后发布。仅导入你有权使用的模板。</p>
                <Input.TextArea aria-label="EcomGen 模板 JSON" rows={5} disabled={disabled} maxLength={200000} value={importText} onChange={(e) => setImportText(e.target.value)} placeholder="粘贴单套 .suite.json 文件内容" />
                <Button
                    disabled={disabled || !importText.trim()}
                    onClick={() => {
                        try {
                            add(parseEcomgenTemplate(importText, flow));
                        } catch (error) {
                            message.error(error instanceof Error ? error.message : "模板导入失败");
                        }
                    }}
                >
                    解析为草稿
                </Button>
            </details>
            <div className="admin-ecommerce-template-workspace">
                <aside>
                    <Input aria-label="搜索套图模板" placeholder="搜索名称或类目" value={query} onChange={(e) => setQuery(e.target.value)} />
                    <div className="admin-ecommerce-template-list">
                        {templates
                            .filter((item) => `${item.name} ${item.category}`.toLowerCase().includes(query.toLowerCase()))
                            .map((item) => (
                                <button key={item.id} type="button" aria-pressed={selectedId === item.id} onClick={() => setSelectedId(item.id)}>
                                    <strong>{item.name}</strong>
                                    <span>
                                        {item.category || "未分类"} · {item.shots.length} 张 · {item.enabled ? "已启用" : "草稿"}
                                    </span>
                                </button>
                            ))}
                    </div>
                    {!templates.length ? <p>暂无模板。可自行创建，或导入 EcomGen 套图。</p> : null}
                </aside>
                {selected ? (
                    <fieldset disabled={disabled} className="admin-ecommerce-template-fields">
                        <div className="admin-ecommerce-model-fields">
                            <label>
                                名称
                                <Input aria-label="套图模板名称" value={selected.name} maxLength={100} onChange={(e) => patch({ name: e.target.value })} />
                            </label>
                            <label>
                                类目
                                <Input aria-label="套图模板类目" value={selected.category} maxLength={200} onChange={(e) => patch({ category: e.target.value })} />
                            </label>
                            <label>
                                开放使用
                                <Switch aria-label="套图模板开放使用" checked={selected.enabled} onChange={(enabled) => patch({ enabled })} />
                            </label>
                        </div>
                        <label>
                            用途
                            <select aria-label="套图模板用途" value={selected.flow} onChange={(e) => patch({ flow: e.target.value as EcommerceFlowId })}>
                                {ECOMMERCE_ONE_CLICK_FLOWS.map((item) => (
                                    <option key={item.id} value={item.id}>
                                        {item.name.replace(/^一键/, "")}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label>
                            整套视觉规范
                            <Input.TextArea aria-label="模板视觉规范" rows={4} maxLength={6000} value={selected.style} onChange={(e) => patch({ style: e.target.value })} />
                        </label>
                        <label>
                            来源备注
                            <Input aria-label="模板来源" maxLength={500} value={selected.source} onChange={(e) => patch({ source: e.target.value })} />
                        </label>
                        <div className="admin-ecommerce-template-shots">
                            {selected.shots.map((shot, index) => (
                                <div key={index}>
                                    <label>
                                        第 {index + 1} 张
                                        <Input aria-label={`模板第 ${index + 1} 张标题`} maxLength={100} value={shot.title} onChange={(e) => patch({ shots: selected.shots.map((item, i) => (i === index ? { ...item, title: e.target.value } : item)) })} />
                                    </label>
                                    <label>
                                        画面职责
                                        <Input.TextArea
                                            aria-label={`模板第 ${index + 1} 张职责`}
                                            rows={3}
                                            maxLength={12000}
                                            value={shot.duty}
                                            onChange={(e) => patch({ shots: selected.shots.map((item, i) => (i === index ? { ...item, duty: e.target.value } : item)) })}
                                        />
                                    </label>
                                    <Button disabled={selected.shots.length <= 1} onClick={() => patch({ shots: selected.shots.filter((_, i) => i !== index) })}>
                                        移除这张
                                    </Button>
                                </div>
                            ))}
                        </div>
                        <div className="admin-ecommerce-template-actions">
                            <Button disabled={selected.shots.length >= 30} onClick={() => patch({ shots: [...selected.shots, { title: `第 ${selected.shots.length + 1} 张`, duty: "请填写画面职责" }] })}>
                                添加一张
                            </Button>
                            <Button
                                danger
                                onClick={() => {
                                    onChange(templates.filter((item) => item.id !== selectedId));
                                    setSelectedId("");
                                }}
                            >
                                移除模板
                            </Button>
                        </div>
                    </fieldset>
                ) : (
                    <p>选择左侧模板进行编辑。</p>
                )}
            </div>
        </div>
    );
}
