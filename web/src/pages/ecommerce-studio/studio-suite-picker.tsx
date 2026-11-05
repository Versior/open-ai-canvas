import { Button, Spin } from "antd";
import { useCallback, useEffect, useState } from "react";
import { EcommerceTemplateCatalog, renderTemplatePreview } from "@/components/canvas/ecommerce-template-catalog";
import { SegmentedControl } from "@/components/ui/base/segmented-control";
import { AppModal } from "@/components/ui/product/app-modal/app-modal";
import { studioSuiteFromTemplate } from "@/lib/ecommerce-studio/suites";
import type { StudioSuite } from "@/lib/ecommerce-studio/types";
import type { EcommerceSuiteTemplate } from "@/services/api/ecommerce-canvas";
import { getStudioSuiteTemplates } from "@/services/api/ecommerce-studio";

type Tab = "admin" | "library";

const FLOW_LABEL: Record<string, string> = { main: "主图", detail: "详情页", wear: "穿搭", seed: "种草" };

/** 后台精选：管理员在「后台 → 电商生图台 → 套图模板」里启用的模板。列表和预览与内置模板库同一套样式。 */
function AdminTemplates({ open, onPick, onLoaded }: { open: boolean; onPick: (suite: StudioSuite) => void; onLoaded: (count: number) => void }) {
    const [templates, setTemplates] = useState<EcommerceSuiteTemplate[]>();
    const [error, setError] = useState("");
    const [retry, setRetry] = useState(0);
    const [selectedId, setSelectedId] = useState("");
    useEffect(() => {
        if (!open) return;
        const controller = new AbortController();
        setError("");
        setTemplates(undefined);
        void getStudioSuiteTemplates(controller.signal)
            .then((list) => {
                if (controller.signal.aborted) return;
                setTemplates(list);
                setSelectedId((current) => (list.some((item) => item.id === current) ? current : list[0]?.id || ""));
                onLoaded(list.length);
            })
            .catch((failure) => {
                if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "后台模板读取失败");
            });
        return () => controller.abort();
    }, [open, retry, onLoaded]);

    if (error) {
        return (
            <div className="es-suite-note" role="alert">
                {error}
                <Button size="small" onClick={() => setRetry((value) => value + 1)}>
                    重试
                </Button>
            </div>
        );
    }
    if (!templates) {
        return (
            <div className="es-suite-note" role="status">
                <Spin size="small" /> 正在读取后台模板…
            </div>
        );
    }
    if (!templates.length) {
        return (
            <div className="es-empty">
                <strong>后台还没有启用的模板</strong>
                <span>管理员可以在「后台 → 电商生图台 → 套图模板」里启用，也可以先从内置模板库选一套。</span>
            </div>
        );
    }
    const selected = templates.find((item) => item.id === selectedId) || templates[0];
    return (
        <div className="ecommerce-template-catalog is-curated">
            <div className="etc-layout">
                <div className="etc-list">
                    <div className="etc-list-head">
                        <strong>后台精选</strong>
                        <span>{templates.length} 套</span>
                    </div>
                    <div className="etc-rows" aria-label="后台精选模板">
                        {templates.map((item) => (
                            <button key={item.id} type="button" className="etc-row" aria-pressed={item.id === selected.id} onClick={() => setSelectedId(item.id)}>
                                <span className="etc-row-head">
                                    <strong>{item.name}</strong>
                                    <em>{item.shots.length} 张</em>
                                </span>
                                <span className="etc-row-path">{[FLOW_LABEL[item.flow] || "套图", item.category].filter(Boolean).join(" · ")}</span>
                            </button>
                        ))}
                    </div>
                </div>
                {renderTemplatePreview(selected, { applyLabel: "使用这套", tags: [FLOW_LABEL[selected.flow] || "套图"], onApply: () => onPick(studioSuiteFromTemplate(selected, "admin")) })}
            </div>
        </div>
    );
}

/** 选套图模板：后台精选和内置 EcomGen 模板库。选中后转成快照交给表单，模板之后再改也不影响已选的这一套。 */
export function StudioSuitePicker({ open, query, onClose, onPick }: { open: boolean; query: string; onClose: () => void; onPick: (suite: StudioSuite) => void }) {
    const [tab, setTab] = useState<Tab>("admin");
    const [emptyAdmin, setEmptyAdmin] = useState(false);
    // 后台一个模板都没启用时直接切到内置模板库，免得用户对着空列表。
    const onLoaded = useCallback((count: number) => {
        setEmptyAdmin(!count);
        if (!count) setTab("library");
    }, []);
    return (
        <AppModal open={open} onCancel={onClose} footer={null} width={1080} centered flush rootClassName="es-portal" title={null}>
            <div className="es-suite-picker is-templates">
                <header className="es-suite-picker-head">
                    <div>
                        <h3>选择套图模板</h3>
                        <span>模板定每张图的顺序和职责；商品外观、卖点和参数仍以你的商品为准。</span>
                    </div>
                    <SegmentedControl<Tab>
                        ariaLabel="模板来源"
                        value={tab}
                        onChange={setTab}
                        options={[
                            { value: "admin", label: emptyAdmin ? "后台精选（空）" : "后台精选" },
                            { value: "library", label: "内置模板库" },
                        ]}
                    />
                </header>
                <div className="es-suite-picker-body">
                    {tab === "admin" ? (
                        <AdminTemplates open={open} onPick={onPick} onLoaded={onLoaded} />
                    ) : (
                        <EcommerceTemplateCatalog initialQuery={query} applyLabel="使用这套" onApply={(template) => onPick(studioSuiteFromTemplate(template, "library"))} />
                    )}
                </div>
            </div>
        </AppModal>
    );
}
