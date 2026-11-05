import { App, Button, Input } from "antd";
import { FileJson, Plus, Search } from "lucide-react";
import { useState } from "react";
import type { EcommerceFlowId, EcommerceSuiteTemplate } from "@/services/api/ecommerce-canvas";
import { EcommerceTemplateCatalog } from "@/components/canvas/ecommerce-template-catalog";
import { AdminEmpty, AdminStatusBadge } from "../components/admin-ui";
import { AdminSegmented, AdminSelect } from "../ui/controls";
import { EcommerceTemplateForm, TEMPLATE_FLOW_OPTIONS, templateFlowLabel } from "./ecommerce-template-form";
import { EcomgenImportModal } from "./ecommerce-template-import";

type TemplateView = "curated" | "library";
const MAX_TEMPLATES = 200;

/** 套图模板页签：内置模板库挑选，后台精选列表和编辑。 */
export function EcommerceTemplateEditor({ templates, disabled, onChange }: { templates: EcommerceSuiteTemplate[]; disabled: boolean; onChange: (value: EcommerceSuiteTemplate[]) => void }) {
    const { message, modal } = App.useApp();
    const [selectedId, setSelectedId] = useState("");
    const [query, setQuery] = useState("");
    const [libraryFlow, setLibraryFlow] = useState<EcommerceFlowId>("detail");
    const [importing, setImporting] = useState(false);
    // 还没有精选时先看内置模板库，免得打开就是一片空列表。
    const [view, setView] = useState<TemplateView>(() => (templates.length ? "curated" : "library"));
    // 选中的那套被移除或换了一版草稿时，落到列表第一套，编辑区不留空白。
    const selected = templates.find((item) => item.id === selectedId) ?? templates[0];
    const full = templates.length >= MAX_TEMPLATES;
    const add = (template: EcommerceSuiteTemplate) => {
        if (full) {
            message.error(`最多保存 ${MAX_TEMPLATES} 套模板`);
            return false;
        }
        if (templates.some((item) => item.id === template.id)) {
            message.error("这套模板已经在后台精选里");
            return false;
        }
        onChange([...templates, template]);
        setSelectedId(template.id);
        setView("curated");
        return true;
    };
    const patch = (value: Partial<EcommerceSuiteTemplate>) => onChange(templates.map((item) => (item.id === selected?.id ? { ...item, ...value } : item)));
    const remove = (template: EcommerceSuiteTemplate) =>
        modal.confirm({
            title: `移除「${template.name.trim() || "未命名模板"}」？`,
            content: "只从后台精选里移除，内置模板库不受影响；保存修改后生图台不再显示这套。",
            okText: "移除",
            okButtonProps: { danger: true },
            cancelText: "取消",
            onOk: () => onChange(templates.filter((item) => item.id !== template.id)),
        });
    const createBlank = () => add({ id: crypto.randomUUID(), name: "新套图模板", flow: "detail", category: "", enabled: false, style: "", source: "自建", shots: [{ title: "商品展示", duty: "展示真实商品的完整外观与核心用途" }] });
    const enabledCount = templates.filter((item) => item.enabled).length;
    const text = query.trim().toLowerCase();
    const visible = text ? templates.filter((item) => `${item.name} ${item.category}`.toLowerCase().includes(text)) : templates;
    return (
        <div className="ecm-templates">
            <div className="ecm-toolbar">
                <AdminSegmented<TemplateView>
                    ariaLabel="套图模板来源"
                    value={view}
                    onChange={setView}
                    options={[
                        { value: "curated", label: `后台精选 ${templates.length}` },
                        { value: "library", label: "内置模板库 1173" },
                    ]}
                />
                <p className="ecm-toolbar-note">
                    {view === "library" ? "内置模板生图台用户随时都能选；常用的加入后台精选后可以改写镜头和视觉规范，启用的精选排在生图台第一个页签。" : `已启用 ${enabledCount} 套，出现在生图台「模板套图」的后台精选里；草稿只在后台可见。`}
                </p>
                <div className="ecm-toolbar-actions">
                    {view === "library" ? (
                        <label className="ecm-inline-field">
                            <span>加入后用途</span>
                            <AdminSelect<EcommerceFlowId> ariaLabel="加入后用途" size="sm" disabled={disabled} value={libraryFlow} options={TEMPLATE_FLOW_OPTIONS} onChange={setLibraryFlow} />
                        </label>
                    ) : (
                        <>
                            <Button icon={<FileJson className="size-4" />} disabled={disabled || full} onClick={() => setImporting(true)}>
                                导入 JSON
                            </Button>
                            <Button icon={<Plus className="size-4" />} disabled={disabled || full} onClick={createBlank}>
                                新增模板
                            </Button>
                        </>
                    )}
                </div>
            </div>
            {view === "library" ? (
                <div className="ecm-card ecm-library">
                    <EcommerceTemplateCatalog
                        disabled={disabled}
                        note="模板提供视觉方向；商品属性、价格与功效由生图台按当前商品事实重写。"
                        applyLabel="加入后台精选"
                        onApply={(template) => {
                            if (add({ ...template, flow: libraryFlow, enabled: true })) message.success(`已加入后台精选：${template.name}，保存修改后生效`);
                        }}
                    />
                </div>
            ) : templates.length && selected ? (
                <div className="ecm-curated">
                    <aside className="ecm-card ecm-curated-list">
                        <Input aria-label="搜索套图模板" placeholder="搜索名称或类目" prefix={<Search className="size-3.5" aria-hidden />} allowClear value={query} onChange={(e) => setQuery(e.target.value)} />
                        <div className="ecm-curated-rows">
                            {visible.map((item) => (
                                <button key={item.id} type="button" className="ecm-template-row" aria-pressed={selected.id === item.id} onClick={() => setSelectedId(item.id)}>
                                    <span className="ecm-template-row-head">
                                        <strong>{item.name.trim() || "未命名模板"}</strong>
                                        <AdminStatusBadge label={item.enabled ? "已启用" : "草稿"} tone={item.enabled ? "success" : "neutral"} />
                                    </span>
                                    <span className="ecm-template-row-meta">{[templateFlowLabel(item.flow), `${item.shots.length} 张`, item.category || "未分类"].join(" · ")}</span>
                                </button>
                            ))}
                            {!visible.length ? <p className="ecm-hint">没有匹配的精选模板。</p> : null}
                        </div>
                    </aside>
                    <EcommerceTemplateForm key={selected.id} template={selected} disabled={disabled} onChange={patch} onRemove={() => remove(selected)} />
                </div>
            ) : (
                <div className="ecm-card">
                    <AdminEmpty
                        title="还没有后台精选"
                        description="去内置模板库挑几套加入，或者新增一套自建模板。启用并保存后，生图台「模板套图」的第一个页签就是这里的精选。"
                        action={
                            <div className="ecm-empty-actions">
                                <Button onClick={() => setView("library")}>浏览内置模板库</Button>
                                <Button icon={<Plus className="size-4" />} disabled={disabled} onClick={createBlank}>
                                    新增模板
                                </Button>
                            </div>
                        }
                    />
                </div>
            )}
            {importing ? (
                <EcomgenImportModal
                    disabled={disabled}
                    onCancel={() => setImporting(false)}
                    onImport={(template) => {
                        if (!add(template)) return;
                        setImporting(false);
                        message.success(`已解析为草稿：${template.name}，核对后启用并保存`);
                    }}
                />
            ) : null}
        </div>
    );
}
