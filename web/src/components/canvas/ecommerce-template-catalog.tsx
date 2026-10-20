import { Button, Input } from "antd";
import { useEffect, useState } from "react";
import { getEcommerceCatalog, getEcommerceCatalogTemplate, type EcommerceCatalogEntry, type EcommerceSuiteTemplate } from "@/services/api/ecommerce";
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

export function EcommerceTemplateCatalog({ disabled, onApply, applyLabel = "使用此套图" }: { disabled?: boolean; onApply: (template: EcommerceSuiteTemplate) => void; applyLabel?: string }) {
    const [query, setQuery] = useState("");
    const [page, setPage] = useState(1);
    const [items, setItems] = useState<EcommerceCatalogEntry[]>([]);
    const [total, setTotal] = useState(0);
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
        setItems([]);
        setTotal(0);
        setSelectedId("");
        setSelected(undefined);
        setDetailError("");
        const timer = setTimeout(() => {
            void getEcommerceCatalog(query, page, controller.signal)
                .then((result) => {
                    if (!controller.signal.aborted) {
                        setItems(result.items);
                        setTotal(result.total);
                    }
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
    }, [query, page, listRetry]);
    useEffect(() => {
        if (!selectedId) {
            setDetailLoading(false);
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
    return (
        <div className="ecommerce-template-catalog" data-canvas-no-zoom data-canvas-wheel-scroll>
            <Input
                aria-label="搜索内置套图库"
                placeholder="搜索商品、品类或套图名称"
                value={query}
                onChange={(event) => {
                    setQuery(event.target.value);
                    setPage(1);
                }}
                allowClear
            />
            {listError ? (
                <p role="alert">
                    {listError}
                    <Button size="small" onClick={() => setListRetry((value) => value + 1)}>
                        重新读取套图库
                    </Button>
                </p>
            ) : null}
            {detailError ? (
                <p role="alert">
                    {detailError}
                    <Button size="small" onClick={() => setDetailRetry((value) => value + 1)}>
                        重新读取模板详情
                    </Button>
                </p>
            ) : null}
            <div className="ecommerce-catalog-list" aria-busy={loading}>
                {loading ? (
                    <p role="status">正在读取套图库…</p>
                ) : items.length ? (
                    items.map((item) => (
                        <button key={item.id} type="button" aria-pressed={selectedId === item.id} onClick={() => setSelectedId(item.id)}>
                            <strong>{item.name}</strong>
                            <span>
                                {item.category} · {item.count} 张
                            </span>
                        </button>
                    ))
                ) : !listError ? (
                    <p>没有匹配的套图，试试商品类目或更短的名称。</p>
                ) : null}
            </div>
            <div className="ecommerce-catalog-pagination">
                <span>共 {total} 套</span>
                <Button size="small" disabled={loading || page === 1} onClick={() => setPage((value) => value - 1)}>
                    上一页
                </Button>
                <span>{page}</span>
                <Button size="small" disabled={loading || page * 20 >= total} onClick={() => setPage((value) => value + 1)}>
                    下一页
                </Button>
            </div>
            {detailLoading ? (
                <p role="status">正在读取模板内容…</p>
            ) : selected ? (
                <section className="ecommerce-catalog-preview">
                    <header>
                        <strong>{selected.name}</strong>
                        <Button disabled={disabled} onClick={() => onApply(structuredClone(selected))}>
                            {applyLabel}
                        </Button>
                    </header>
                    <p>模板提供视觉方向。商品属性、价格与功效须按当前商品事实重新规划。</p>
                    <details>
                        <summary>整套视觉规范</summary>
                        <p>{selected.style}</p>
                    </details>
                    {selected.shots.map((shot, index) => (
                        <details key={index}>
                            <summary>
                                {index + 1}. {shot.title}
                            </summary>
                            <p>{shot.duty}</p>
                        </details>
                    ))}
                </section>
            ) : null}
        </div>
    );
}
