import { Button, Input, Spin } from "antd";
import { ChevronDown, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { ECOMMERCE_CATALOG_PAGE_SIZE, getEcommerceCatalog, getEcommerceCatalogTemplate, type EcommerceCatalogCategory, type EcommerceCatalogEntry, type EcommerceSuiteTemplate } from "@/services/api/ecommerce-canvas";
import "./ecommerce-template-catalog.css";

export function EcommerceTemplateCatalogDetails({ title = "浏览项目内置套图库", ...props }: { title?: string; disabled?: boolean; onApply: (template: EcommerceSuiteTemplate) => void; applyLabel?: string }) {
    const [open, setOpen] = useState(false);
    return (
        <details onToggle={(event) => setOpen(event.currentTarget.open)}>
            <summary>{title}</summary>
            {open ? <EcommerceTemplateCatalog {...props} /> : null}
        </details>
    );
}

type ShotView = { title: string; intent: string; ratio?: string; noText: boolean; fields: { label: string; value: string }[] };

const FIELD_PATTERN = /^([^：:]{1,8})[：:]\s*(.*)$/;
const NONE_VALUE = /^(none|无|不需要|不放|n\/a)$/i;

/** 预览用的镜头拆解：首行是这张图要做什么，「画幅」做成标签；空值和末尾的英文参考提示词不展示（生图台出图时同样去掉）。 */
function shotView(title: string, duty: string): ShotView {
    const view: ShotView = { title, intent: "", noText: false, fields: [] };
    for (const raw of duty.split(/\n+/)) {
        const line = raw.trim();
        if (!line) continue;
        if (/^画面参考/.test(line)) break;
        if (!view.intent) {
            view.intent = line;
            continue;
        }
        const field = line.match(FIELD_PATTERN);
        if (!field) {
            view.fields.push({ label: "", value: line });
            continue;
        }
        const label = field[1];
        const value = field[2].trim();
        if (label === "画幅") {
            if (/^\d{1,2}:\d{1,2}$/.test(value)) view.ratio = value;
            continue;
        }
        if (!value || NONE_VALUE.test(value)) {
            if (label === "文字位置") view.noText = true;
            continue;
        }
        view.fields.push({ label, value });
    }
    return view;
}

export type TemplatePreviewOptions = {
    applyLabel: string;
    onApply: () => void;
    disabled?: boolean;
    /** 头部标签，例如模板用途。 */
    tags?: string[];
    description?: string;
    /** 按钮旁的一句提醒；生图台弹窗标题已经说明时不传。 */
    note?: string;
};

/**
 * 模板内容预览：生图台选模板（后台精选、内置模板库）和后台模板库共用。
 * 用普通函数渲染而不是组件，操作按钮留在调用方的元素树里，调用方的测试能直接找到。
 */
export function renderTemplatePreview(template: EcommerceSuiteTemplate, options: TemplatePreviewOptions) {
    const shots = template.shots.map((shot) => shotView(shot.title, shot.duty));
    const ratios = [...new Set(shots.flatMap((shot) => (shot.ratio ? [shot.ratio] : [])))];
    const tags = [...(options.tags ?? []), `${shots.length} 张`, ...(ratios.length ? [ratios.length > 4 ? `${ratios.slice(0, 4).join(" · ")} …` : ratios.join(" · ")] : [])];
    return (
        <section className="etc-preview" aria-label="模板内容">
            <div className="etc-preview-scroll">
                <header className="etc-preview-head">
                    {template.category ? <span className="etc-preview-path">{template.category}</span> : null}
                    <h4>{template.name}</h4>
                    <div className="etc-tags">
                        {tags.map((tag) => (
                            <span key={tag}>{tag}</span>
                        ))}
                    </div>
                    {options.description ? <p className="etc-preview-desc">{options.description}</p> : null}
                </header>
                {template.style.trim() ? (
                    <details className="etc-style">
                        <summary>
                            整套视觉规范
                            <ChevronDown className="etc-chevron" size={14} aria-hidden="true" />
                        </summary>
                        <p>{template.style}</p>
                    </details>
                ) : null}
                <ol className="etc-shots" aria-label={`共 ${shots.length} 张`}>
                    {shots.map((shot, index) => {
                        const head = (
                            <>
                                <span className="etc-shot-index">{index + 1}</span>
                                <span className="etc-shot-text">
                                    <strong>{shot.title}</strong>
                                    {shot.intent && shot.intent !== shot.title ? <span>{shot.intent}</span> : null}
                                </span>
                                {shot.ratio || shot.noText ? (
                                    <span className="etc-shot-meta">
                                        {shot.ratio ? <em>{shot.ratio}</em> : null}
                                        {shot.noText ? <em>不放字</em> : null}
                                    </span>
                                ) : null}
                            </>
                        );
                        return (
                            <li key={index}>
                                {shot.fields.length ? (
                                    <details className="etc-shot">
                                        <summary>
                                            {head}
                                            <ChevronDown className="etc-chevron" size={14} aria-hidden="true" />
                                        </summary>
                                        <dl>
                                            {shot.fields.map((field, fieldIndex) => (
                                                <div key={fieldIndex}>
                                                    {field.label ? <dt>{field.label}</dt> : null}
                                                    <dd>{field.value}</dd>
                                                </div>
                                            ))}
                                        </dl>
                                    </details>
                                ) : (
                                    <div className="etc-shot">{head}</div>
                                )}
                            </li>
                        );
                    })}
                </ol>
            </div>
            <footer className="etc-preview-foot">
                {options.note ? <span className="etc-preview-note">{options.note}</span> : null}
                <Button type="primary" disabled={options.disabled} onClick={options.onApply}>
                    {options.applyLabel}
                </Button>
            </footer>
        </section>
    );
}

/** 类目路径「一级 / 二级 / 叶子」：按一级类目筛选时省掉重复的一级。 */
function entryPath(entry: EcommerceCatalogEntry, category: string) {
    const parts = entry.category.split(" / ");
    return category && parts[0] === category ? parts.slice(1).join(" / ") : entry.category;
}

/** 内置套图库：左侧一级类目，中间搜索和列表，右侧是选中模板的每张图安排。 */
export function EcommerceTemplateCatalog({ disabled, onApply, applyLabel = "使用此套图", initialQuery = "", note }: { disabled?: boolean; onApply: (template: EcommerceSuiteTemplate) => void; applyLabel?: string; initialQuery?: string; note?: string }) {
    const [query, setQuery] = useState(initialQuery);
    const [category, setCategory] = useState("");
    const [page, setPage] = useState(1);
    const [items, setItems] = useState<EcommerceCatalogEntry[]>([]);
    const [total, setTotal] = useState(0);
    const [categories, setCategories] = useState<EcommerceCatalogCategory[]>([]);
    const [selectedId, setSelectedId] = useState("");
    const [selected, setSelected] = useState<EcommerceSuiteTemplate>();
    const [loading, setLoading] = useState(true),
        [detailLoading, setDetailLoading] = useState(false);
    const [listError, setListError] = useState(""),
        [detailError, setDetailError] = useState("");
    const [listRetry, setListRetry] = useState(0),
        [detailRetry, setDetailRetry] = useState(0);
    useEffect(() => {
        const controller = new AbortController();
        setLoading(true);
        setListError("");
        const timer = setTimeout(() => {
            void getEcommerceCatalog({ q: query, category, page }, controller.signal)
                .then((result) => {
                    if (controller.signal.aborted) return;
                    setItems(result.items);
                    setTotal(result.total);
                    setCategories(result.categories ?? []);
                    // 搜索、换类目或翻页后默认看列表第一套，右侧不留空白。
                    setSelectedId((current) => (result.items.some((item) => item.id === current) ? current : (result.items[0]?.id ?? "")));
                })
                .catch((error) => {
                    if (!controller.signal.aborted) setListError(error instanceof Error ? error.message : "套图库读取失败");
                })
                .finally(() => {
                    if (!controller.signal.aborted) setLoading(false);
                });
        }, 250);
        return () => {
            clearTimeout(timer);
            controller.abort();
        };
    }, [query, category, page, listRetry]);
    useEffect(() => {
        if (!selectedId) {
            setDetailLoading(false);
            setSelected(undefined);
            return;
        }
        const controller = new AbortController();
        setDetailLoading(true);
        setSelected(undefined);
        setDetailError("");
        void getEcommerceCatalogTemplate(selectedId, controller.signal)
            .then((result) => {
                if (!controller.signal.aborted) setSelected(result.template);
            })
            .catch((error) => {
                if (!controller.signal.aborted) setDetailError(error instanceof Error ? error.message : "模板详情读取失败");
            })
            .finally(() => {
                if (!controller.signal.aborted) setDetailLoading(false);
            });
        return () => controller.abort();
    }, [selectedId, detailRetry]);
    const pages = Math.max(1, Math.ceil(total / ECOMMERCE_CATALOG_PAGE_SIZE));
    const allCount = categories.reduce((sum, item) => sum + item.count, 0);
    // 搜索后当前类目可能一套都不剩，仍留在类目栏里标 0，免得选中项凭空消失。
    const rail = category && !categories.some((item) => item.name === category) ? [...categories, { name: category, count: 0 }] : categories;
    const entry = items.find((item) => item.id === selectedId);
    const pickCategory = (name: string) => {
        setCategory(name);
        setPage(1);
    };
    const firstLoad = loading && !items.length && !listError;
    return (
        <div className="ecommerce-template-catalog" data-canvas-no-zoom data-canvas-wheel-scroll>
            <div className="etc-layout">
                <nav className="etc-rail" aria-label="按类目浏览">
                    <button type="button" aria-current={category ? undefined : "true"} aria-label={`全部类目，${allCount} 套`} onClick={() => pickCategory("")}>
                        <span>全部</span>
                        <em>{allCount}</em>
                    </button>
                    {rail.map((item) => (
                        <button key={item.name} type="button" aria-current={item.name === category ? "true" : undefined} aria-label={`${item.name}，${item.count} 套`} onClick={() => pickCategory(item.name)}>
                            <span>{item.name}</span>
                            <em>{item.count}</em>
                        </button>
                    ))}
                </nav>
                <div className="etc-list">
                    <Input
                        aria-label="搜索内置套图库"
                        placeholder="搜索商品、品类或套图名称"
                        prefix={<Search size={14} aria-hidden="true" />}
                        value={query}
                        onChange={(event) => {
                            setQuery(event.target.value);
                            setPage(1);
                        }}
                        allowClear
                    />
                    <div className="etc-list-head">
                        <strong>{category || "全部类目"}</strong>
                        <span>{firstLoad ? "读取中…" : `${total} 套`}</span>
                    </div>
                    <div className="etc-rows" aria-busy={loading}>
                        {listError ? (
                            <div className="etc-note" role="alert">
                                <span>{listError}</span>
                                <Button size="small" onClick={() => setListRetry((value) => value + 1)}>
                                    重新读取套图库
                                </Button>
                            </div>
                        ) : firstLoad ? (
                            <div className="etc-note" role="status">
                                <Spin size="small" /> 正在读取套图库…
                            </div>
                        ) : items.length ? (
                            items.map((item) => (
                                <button key={item.id} type="button" className="etc-row" aria-pressed={selectedId === item.id} onClick={() => setSelectedId(item.id)}>
                                    <span className="etc-row-head">
                                        <strong>{item.name}</strong>
                                        <em>{item.count} 张</em>
                                    </span>
                                    <span className="etc-row-path">{entryPath(item, category)}</span>
                                    {item.description ? <span className="etc-row-desc">{item.description}</span> : null}
                                </button>
                            ))
                        ) : (
                            <div className="etc-empty">
                                <strong>没有匹配的套图</strong>
                                <span>{category && allCount ? `「${category}」里没有，全部类目里有 ${allCount} 套。` : "试试商品类目或更短的名称。"}</span>
                                {category && allCount ? (
                                    <Button size="small" onClick={() => pickCategory("")}>
                                        看全部类目
                                    </Button>
                                ) : null}
                            </div>
                        )}
                    </div>
                    <div className="etc-pager">
                        <Button size="small" disabled={loading || page === 1} onClick={() => setPage((value) => value - 1)}>
                            上一页
                        </Button>
                        <span>
                            {page} / {pages}
                        </span>
                        <Button size="small" disabled={loading || page >= pages} onClick={() => setPage((value) => value + 1)}>
                            下一页
                        </Button>
                    </div>
                </div>
                {detailError ? (
                    <section className="etc-preview is-note" aria-label="模板内容">
                        <div className="etc-note" role="alert">
                            <span>{detailError}</span>
                            <Button size="small" onClick={() => setDetailRetry((value) => value + 1)}>
                                重新读取模板详情
                            </Button>
                        </div>
                    </section>
                ) : selected ? (
                    renderTemplatePreview(selected, { applyLabel, disabled, note, description: entry?.description, onApply: () => onApply(structuredClone(selected)) })
                ) : (
                    <section className="etc-preview is-note" aria-label="模板内容">
                        <div className="etc-note" role="status">
                            {detailLoading || firstLoad ? (
                                <>
                                    <Spin size="small" /> 正在读取模板内容…
                                </>
                            ) : items.length ? (
                                "选一套模板，这里显示每张图的安排。"
                            ) : (
                                "没有可预览的模板。"
                            )}
                        </div>
                    </section>
                )}
            </div>
        </div>
    );
}
