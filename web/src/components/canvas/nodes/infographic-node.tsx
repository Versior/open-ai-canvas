import { ChevronDown, Download, LoaderCircle, Table2, Trash2 } from "lucide-react";
import { Fragment, useMemo, useState } from "react";

import { useCanvasNodeActions } from "@/components/canvas/canvas-node-action-context";
import { EcommerceNodeTitle } from "./canvas-ecommerce-node-title";
import { useUpstreamNodes } from "@/components/canvas/canvas-node-graph-context";
import { canvasThemes } from "@/lib/canvas-theme";
import {
    ECOMMERCE_INFOGRAPHIC_ARCHETYPES,
    createEcommerceInfographic,
    createEcommerceInfographicCallout,
    createEcommerceInfographicTable,
    ecommerceInfographicBodyFontSize,
    ecommerceInfographicCalloutCount,
    ecommerceInfographicBlocked,
    ecommerceInfographicIssues,
    ecommerceInfographicLayout,
    ecommerceInfographicPromptBlock,
    ecommerceInfographicReady,
    type EcommerceInfographic,
    type EcommerceInfographicArchetype,
    type EcommerceInfographicCallout,
} from "@/lib/ecommerce/ecommerce-infographic";
import { rasterizeEcommerceInfographic } from "@/lib/ecommerce/ecommerce-infographic-rasterize";
import {
    ECOMMERCE_SIZE_CHART_TEMPLATES,
    createEcommerceSizeChart,
    ecommerceSizeChartCellKey,
    ecommerceSizeChartHowToMeasure,
    ecommerceSizeChartIssues,
    ecommerceSizeChartTable,
    ecommerceSizeChartTemplate,
    type EcommerceSizeChart,
} from "@/lib/ecommerce/ecommerce-size-chart";
import { ecommerceExportSize, type EcommerceRasterSize } from "@/lib/ecommerce/ecommerce-rasterize";
import { ECOMMERCE_ASPECT_RATIOS } from "@/lib/ecommerce/ecommerce-recipes";
import type { CanvasTheme } from "@/lib/canvas-theme";
import { getNodeResourceKind } from "@/lib/canvas/node-registry";
import { imageToDataUrl } from "@/services/image-storage";
import type { CanvasNodeData } from "@/types/canvas";
import "./canvas-ecommerce-node-card.css";

type InfographicNodeContentProps = {
    node: CanvasNodeData;
    theme: CanvasTheme;
};

/** 预览宽度上限。 */
const PREVIEW_WIDTH = 300;
const MAX_CALLOUTS = 5;

/**
 * 信息图节点——唯一**必须**用真实文字的一类图。
 *
 * 主图、场景图、种草图都能让模型画，文字交给排版层留位就行。信息图不行：它的全部
 * 价值就在那些字上——参数、尺寸、材质、卖点。数字写错一位是虚假宣传，字糊成一团
 * 就是废图。所以这一层的文字全部**逐字进提示词**——标题、每条标注（带左/右方位）、
 * 规格表原文，一条硬规矩压着：不得改写、四舍五入、补充或增删行列。
 * 文字错不起时改走本地精确合成：底图由生成链路出（画面里明确不要任何文字），
 * 标注、引线、规格表全部在浏览器里按真实字体合成。
 *
 * 预览就是成品本身。左边画标注框与引线，右边画规格表——和导出用的是同一套几何
 * （ecommerceInfographicLayout），所以预览里读得清，导出就一样读得清。
 */
export function InfographicNodeContent({ node, theme }: InfographicNodeContentProps) {
    const { updateMetadata, exportEcommerceLayout, generateEcommerceNode } = useCanvasNodeActions();
    const upstream = useUpstreamNodes(node.id);
    const [editing, setEditing] = useState(false);
    const [exporting, setExporting] = useState<string | null>(null);
    const [activeCalloutId, setActiveCalloutId] = useState<string | null>(null);
    const [generating, setGenerating] = useState(false);

    const info: EcommerceInfographic = node.metadata?.ecommerceInfographic || createEcommerceInfographic(node.title || "未命名信息图");
    const ratio = node.metadata?.ecommerceAspectRatio || "1:1";
    const editable = Boolean(updateMetadata);
    const sourceImage = upstream.find((item) => getNodeResourceKind(item) === "image" && (item.metadata?.content || item.metadata?.storageKey));

    /**
     * 尺码表挂在信息图节点上，不另起一个节点。
     *
     * 它本来就是这个节点的第七种骨架（sizechart），而且渲染完全复用规格表——
     * 另起一个节点意味着「尺码表要自己一套合成」，那是重复造。
     *
     * 编辑尺码表时同步回 `info.table` 与 `info.footer`：预览、提示词块、
     * 本地合成三条路都读这两个字段，所以只维护一份数据，不会出现
     * 「编辑器里改了、导出还是旧的」这类偏差。
     */
    const sizeChart: EcommerceSizeChart = node.metadata?.ecommerceSizeChart || createEcommerceSizeChart("top");
    const sizeTemplate = ecommerceSizeChartTemplate(sizeChart.category);
    const sizeChartIssues = ecommerceSizeChartIssues(sizeChart);

    const commitSizeChart = (next: EcommerceSizeChart) => {
        const table = ecommerceSizeChartTable(next);
        const howToMeasure = ecommerceSizeChartHowToMeasure(next);
        updateMetadata?.(node.id, {
            ecommerceSizeChart: next,
            ecommerceInfographic: {
                ...info,
                archetype: "sizechart",
                // 表格标题留空时不覆盖用户自己写的标题
                table: { id: table.id, title: info.table?.title?.trim() || table.title, columns: table.columns, rows: table.rows },
                footer: howToMeasure || info.footer,
            },
        });
    };

    const previewSize = useMemo<EcommerceRasterSize>(() => {
        const full = ecommerceExportSize(ratio, 1600);
        const scale = PREVIEW_WIDTH / full.width;
        return { width: PREVIEW_WIDTH, height: Math.round(full.height * scale) };
    }, [ratio]);

    const layout = useMemo(() => ecommerceInfographicLayout(info, previewSize), [info, previewSize]);
    // 正在编辑的那条标注——点画面就是把它的引线指过去
    const activeCallout = info.callouts.find((callout) => callout.id === activeCalloutId) || info.callouts[0];
    const issues = ecommerceInfographicIssues(info, previewSize.width);
    const calloutCount = ecommerceInfographicCalloutCount(info);
    const longSide = Math.max(previewSize.width, previewSize.height);
    const bodyPx = ecommerceInfographicBodyFontSize(longSide);
    const hasTable = Boolean(info.table?.rows.some((row) => row.some((cell) => cell.trim())));

    const patch = (next: Partial<EcommerceInfographic>) => updateMetadata?.(node.id, { ecommerceInfographic: { ...info, ...next } });
    const commitCallouts = (next: EcommerceInfographicCallout[]) => patch({ callouts: next });
    const patchCallout = (id: string, next: Partial<EcommerceInfographicCallout>) => commitCallouts(info.callouts.map((callout) => (callout.id === id ? { ...callout, ...next } : callout)));

    const exportAt = async (targetRatio: string) => {
        if (!exportEcommerceLayout) return;
        setExporting(targetRatio);
        try {
            const imageUrl = sourceImage ? await imageToDataUrl({ url: sourceImage.metadata?.content, storageKey: sourceImage.metadata?.storageKey, name: sourceImage.title }) : "";
            const dataUrl = await rasterizeEcommerceInfographic({ imageUrl, info, size: ecommerceExportSize(targetRatio, 2000) });
            await exportEcommerceLayout(node, dataUrl, `${node.title || "信息图"} · ${targetRatio}`);
        } finally {
            setExporting(null);
        }
    };

    return (
        <div className="ecom-card" style={{ color: theme.node.text }}>
            <header className="ecom-card-header">
                <div className="ecom-card-kicker">
                    <span className="ecom-card-mark"><Table2 className="size-3.5" /></span>
                    <span>电商 / 信息图</span>
                </div>
                <span className={issues.some((issue) => issue.level === "block") ? "ecom-card-status ecom-card-status-warn" : "ecom-card-status"}>
                    {calloutCount}/{MAX_CALLOUTS} 标注
                </span>
            </header>

            <EcommerceNodeTitle
                node={node}
                fallback="未命名信息图"
                subtitle={info.headline.trim() || "标题写结论，不写品类名"}
            />

            <div className="ecom-card-stage" style={{ padding: 8 }}>
                <div
                    className="ecom-info-canvas"
                    style={{ width: "100%", maxWidth: previewSize.width, aspectRatio: `${previewSize.width} / ${previewSize.height}`, borderColor: theme.node.stroke }}
                    data-placing={editing && editable ? "true" : "false"}
                    title={editing && editable ? "点画面上的位置，把当前标注的引线指过去" : undefined}
                    onClick={(event) => {
                        // 直接在画面上点，比在编辑面板里敲 X/Y 百分比直观得多——
                        // 用户想的是「引线指到这个角」，不是「X 等于 82」
                        if (!editing || !editable || !activeCallout) return;
                        const rect = event.currentTarget.getBoundingClientRect();
                        const x = Math.round(((event.clientX - rect.left) / rect.width) * 100);
                        const y = Math.round(((event.clientY - rect.top) / rect.height) * 100);
                        patchCallout(activeCallout.id, { targetX: Math.max(0, Math.min(100, x)), targetY: Math.max(0, Math.min(100, y)) });
                    }}
                >
                    {sourceImage?.metadata?.content
                        ? <img src={sourceImage.metadata.content} alt="" className="absolute inset-0 size-full object-cover" draggable={false} />
                        : <span className="absolute inset-0 grid place-items-center px-4 text-center text-[10px] leading-relaxed" style={{ color: "#9A9A9A" }}>还没有底图——连一张商品图，画面里不要有文字</span>}

                    {info.headline.trim() ? (
                        <span className="ecom-info-headline" style={{ top: `${(layout.headline.top / previewSize.height) * 100}%`, fontSize: `${bodyPx * 1.9}px` }}>{info.headline.trim()}</span>
                    ) : null}
                    {layout.subhead && info.subhead.trim() ? (
                        <span className="ecom-info-subhead" style={{ top: `${(layout.subhead.top / previewSize.height) * 100}%`, fontSize: `${bodyPx * 1.05}px` }}>{info.subhead.trim()}</span>
                    ) : null}

                    {/* 引线先画，压在标注框下面——线头露在字上是不可读的常见来源 */}
                    {layout.callouts.map(({ callout, leader }) => (
                        <span key={`line-${callout.id}`} className="ecom-info-leader" style={leaderStyle(leader, previewSize)} />
                    ))}
                    {layout.callouts.map(({ callout, leader }) => (
                        <span key={`dot-${callout.id}`} className="ecom-info-dot" style={{ left: `${(leader.toX / previewSize.width) * 100}%`, top: `${(leader.toY / previewSize.height) * 100}%`, width: bodyPx * 0.28, height: bodyPx * 0.28 }} />
                    ))}
                    {layout.callouts.map(({ callout, box }) => (
                        <span
                            key={`box-${callout.id}`}
                            className="ecom-info-callout"
                            style={{ left: `${(box.left / previewSize.width) * 100}%`, top: `${(box.top / previewSize.height) * 100}%`, width: `${(box.width / previewSize.width) * 100}%`, height: `${(box.height / previewSize.height) * 100}%` }}
                        >
                            <span className="ecom-info-callout-label" style={{ fontSize: `${bodyPx * 1.1}px` }}>{callout.label.trim()}</span>
                            {callout.detail.trim() ? <span className="ecom-info-callout-detail" style={{ fontSize: `${bodyPx}px` }}>{callout.detail.trim()}</span> : null}
                        </span>
                    ))}

                    {layout.table && info.table ? (
                        <span
                            className="ecom-info-table"
                            style={{ left: `${(layout.table.left / previewSize.width) * 100}%`, top: `${(layout.table.top / previewSize.height) * 100}%`, width: `${(layout.table.width / previewSize.width) * 100}%`, height: `${(layout.table.height / previewSize.height) * 100}%`, fontSize: `${bodyPx}px` }}
                        >
                            <span className="ecom-info-table-head">
                                {info.table.columns.map((column, index) => <span key={index} style={{ flex: 1 }}>{column}</span>)}
                            </span>
                            {info.table.rows.filter((row) => row.some((cell) => cell.trim())).map((row, rowIndex) => (
                                <span key={rowIndex} className="ecom-info-table-row">
                                    {info.table!.columns.map((_, columnIndex) => <span key={columnIndex} style={{ flex: 1 }}>{row[columnIndex] || ""}</span>)}
                                </span>
                            ))}
                        </span>
                    ) : null}

                    {layout.footer && info.footer.trim() ? (
                        <span className="ecom-info-footer" style={{ top: `${(layout.footer.top / previewSize.height) * 100}%`, fontSize: `${bodyPx * 0.95}px` }}>{info.footer.trim()}</span>
                    ) : null}
                </div>
            </div>

            {/* 生成信息图常驻可见：标注与表格逐字进提示词，交给模型画。
                项目里所有产出都是提示词走 API，信息图也不例外。 */}
            <div className="ecom-action-row">
                <button
                    type="button"
                    className="ecom-action ecom-action-primary"
                    disabled={!generateEcommerceNode || !ecommerceInfographicReady(info) || ecommerceInfographicBlocked(issues) || generating}
                    title={ecommerceInfographicBlocked(issues) ? "先解决上面的拦截项" : "把标题、标注、规格表编译成提示词，交给图片模型出图"}
                    onClick={async () => {
                        setGenerating(true);
                        try {
                            await generateEcommerceNode?.(node, "image", ecommerceInfographicPromptBlock(info));
                        } finally {
                            setGenerating(false);
                        }
                    }}
                >
                    {generating ? <LoaderCircle className="size-3 animate-spin" /> : <Table2 className="size-3" />}
                    {generating ? "提交中…" : "生成信息图"}
                </button>
            </div>

            {editing && editable ? (
                <div className="ecom-card-editor">
                    <div className="ecom-chip-row">
                        {ECOMMERCE_INFOGRAPHIC_ARCHETYPES.map((archetype) => (
                            <button key={archetype.id} type="button" className="ecom-chip" aria-pressed={info.archetype === archetype.id} title={archetype.hint} onClick={() => patch({ archetype: archetype.id as EcommerceInfographicArchetype })}>
                                {archetype.name}
                            </button>
                        ))}
                    </div>

                    <label className="ecom-field">
                        <span className="ecom-field-label">标题 · 写结论</span>
                        <input className="ecom-field-input" value={info.headline} placeholder="保温 12 小时，一次装够一天的水" onChange={(event) => patch({ headline: event.target.value })} />
                    </label>
                    <label className="ecom-field">
                        <span className="ecom-field-label">副标题</span>
                        <input className="ecom-field-input" value={info.subhead} placeholder="304 不锈钢 · 500ml" onChange={(event) => patch({ subhead: event.target.value })} />
                    </label>

                    <div className="ecom-field">
                        <span className="ecom-field-label">标注（最多 {MAX_CALLOUTS} 条，超出的挪到下一张）</span>
                        {info.callouts.map((callout) => (
                            <div
                                key={callout.id}
                                className="ecom-info-callout-editor"
                                data-active={activeCallout?.id === callout.id ? "true" : "false"}
                                onFocusCapture={() => setActiveCalloutId(callout.id)}
                                onMouseEnter={() => setActiveCalloutId(callout.id)}
                            >
                                <input className="ecom-field-input" value={callout.label} placeholder="标注主文字，一句话" onChange={(event) => patchCallout(callout.id, { label: event.target.value })} />
                                <input className="ecom-field-input" value={callout.detail} placeholder="补充说明，一行" onChange={(event) => patchCallout(callout.id, { detail: event.target.value })} />
                                <div className="ecom-chip-row">
                                    <button type="button" className="ecom-chip" aria-pressed={callout.side === "left"} onClick={() => patchCallout(callout.id, { side: "left" })}>左侧</button>
                                    <button type="button" className="ecom-chip" aria-pressed={callout.side === "right"} onClick={() => patchCallout(callout.id, { side: "right" })}>右侧</button>
                                    <span className="ecom-chip" title="点画面上商品的具体位置，引线就指过去">指向 {callout.targetX},{callout.targetY}</span>
                                    <button type="button" className="ecom-chip" aria-label="删除这条标注" onClick={() => commitCallouts(info.callouts.filter((item) => item.id !== callout.id))}>
                                        <Trash2 className="size-3" />
                                    </button>
                                </div>
                            </div>
                        ))}
                        <button type="button" className="ecom-action" disabled={calloutCount >= MAX_CALLOUTS} onClick={() => commitCallouts([...info.callouts, createEcommerceInfographicCallout()])}>
                            + 加一条标注
                        </button>
                    </div>

                    <div className="ecom-field">
                        <span className="ecom-field-label">规格表</span>
                        {info.archetype === "sizechart" ? (
                            /* 尺码表不是「一张两列的表」——它是 5 个量体项 × N 个尺码的网格，
                               通用两列编辑器填不了。而且列名要带单位（不带单位的尺码表是
                               最常见的返工原因：买家分不清 38 是厘米还是码数）。 */
                            <div className="ecom-field">
                                <div className="ecom-chip-row">
                                    {ECOMMERCE_SIZE_CHART_TEMPLATES.map((template) => (
                                        <button
                                            key={template.id}
                                            type="button"
                                            className="ecom-chip"
                                            aria-pressed={sizeChart.category === template.id}
                                            title={template.hint}
                                            onClick={() => commitSizeChart(createEcommerceSizeChart(template.id))}
                                        >
                                            {template.name}
                                        </button>
                                    ))}
                                </div>
                                <div className="ecom-chip-row">
                                    <span className="ecom-field-label">尺码</span>
                                    <input
                                        className="ecom-field-input"
                                        style={{ width: 150 }}
                                        value={sizeChart.sizes.join(" / ")}
                                        placeholder="S / M / L / XL"
                                        aria-label="尺码行"
                                        onChange={(event) => commitSizeChart({ ...sizeChart, sizes: event.target.value.split("/").map((value) => value.trim()) })}
                                    />
                                </div>
                                <div className="ecom-size-grid">
                                    <span className="ecom-size-cell ecom-size-cell-head">{sizeTemplate?.sizeColumn || "尺码"}</span>
                                    {sizeTemplate?.fields.map((field) => (
                                        <span key={field.label} className="ecom-size-cell ecom-size-cell-head" title={field.how}>
                                            {field.label}
                                            <span className="ecom-size-cell-unit">{field.unit}</span>
                                        </span>
                                    ))}
                                    {sizeChart.sizes.filter((size) => size.trim()).map((size) => (
                                        <Fragment key={size}>
                                            <span className="ecom-size-cell ecom-size-cell-size">{size}</span>
                                            {sizeTemplate?.fields.map((field) => (
                                                <input
                                                    key={`${size}|${field.label}`}
                                                    className="ecom-size-cell ecom-size-cell-input"
                                                    value={sizeChart.cells[ecommerceSizeChartCellKey(size, field.label)] || ""}
                                                    placeholder="—"
                                                    aria-label={`${size} ${field.label}`}
                                                    title={`${field.label}：${field.how}`}
                                                    onChange={(event) => commitSizeChart({
                                                        ...sizeChart,
                                                        cells: { ...sizeChart.cells, [ecommerceSizeChartCellKey(size, field.label)]: event.target.value },
                                                    })}
                                                />
                                            ))}
                                        </Fragment>
                                    ))}
                                </div>
                                <label className="ecom-chip-row" style={{ alignItems: "center" }}>
                                    <input type="checkbox" checked={sizeChart.showHowToMeasure} onChange={(event) => commitSizeChart({ ...sizeChart, showHowToMeasure: event.target.checked })} />
                                    <span className="ecom-field-label">附量体位置说明</span>
                                </label>
                                <span className="ecom-card-subtitle" style={{ whiteSpace: "normal" }}>
                                    量体说明会进底部信任条——买家不知道自己该量哪里，是尺码表失效的真正原因。
                                </span>
                                {sizeChartIssues.length ? (
                                    <span className="ecom-card-subtitle ecom-card-status-warn" style={{ whiteSpace: "normal" }}>{sizeChartIssues[0].message}</span>
                                ) : null}
                            </div>
                        ) : info.table ? (
                            <>
                                <input className="ecom-field-input" value={info.table.title} placeholder="表标题（可留空）" onChange={(event) => patch({ table: { ...info.table!, title: event.target.value } })} />
                                <div className="ecom-chip-row">
                                    <input className="ecom-field-input" style={{ width: 90 }} value={info.table.columns[0] || ""} placeholder="列 1" onChange={(event) => patch({ table: { ...info.table!, columns: [event.target.value, info.table!.columns[1] || ""] } })} />
                                    <input className="ecom-field-input" style={{ width: 90 }} value={info.table.columns[1] || ""} placeholder="列 2" onChange={(event) => patch({ table: { ...info.table!, columns: [info.table!.columns[0] || "", event.target.value] } })} />
                                </div>
                                {info.table.rows.map((row, rowIndex) => (
                                    <div key={rowIndex} className="ecom-chip-row">
                                        <input className="ecom-field-input" style={{ width: 90 }} value={row[0] || ""} onChange={(event) => patch({ table: { ...info.table!, rows: info.table!.rows.map((item, i) => (i === rowIndex ? [event.target.value, item[1] || ""] : item)) } })} />
                                        <input className="ecom-field-input" style={{ width: 90 }} value={row[1] || ""} onChange={(event) => patch({ table: { ...info.table!, rows: info.table!.rows.map((item, i) => (i === rowIndex ? [item[0] || "", event.target.value] : item)) } })} />
                                        <button type="button" className="ecom-chip" aria-label={`删除第 ${rowIndex + 1} 行`} onClick={() => patch({ table: { ...info.table!, rows: info.table!.rows.filter((_, i) => i !== rowIndex) } })}>
                                            <Trash2 className="size-3" />
                                        </button>
                                    </div>
                                ))}
                                <div className="ecom-chip-row">
                                    <button type="button" className="ecom-chip" onClick={() => patch({ table: { ...info.table!, rows: [...info.table!.rows, ["", ""]] } })}>+ 加一行</button>
                                    <button type="button" className="ecom-chip" onClick={() => patch({ table: null })}>删掉表格</button>
                                </div>
                            </>
                        ) : (
                            <button type="button" className="ecom-action" onClick={() => patch({ table: createEcommerceInfographicTable() })}>+ 加规格表</button>
                        )}
                    </div>

                    <label className="ecom-field">
                        <span className="ecom-field-label">底部信任条（依据 / 认证 / 售后）</span>
                        <input className="ecom-field-input" value={info.footer} placeholder="数据来自第三方检测报告，检测编号 XXXX" onChange={(event) => patch({ footer: event.target.value })} />
                    </label>

                    <div className="ecom-field">
                        <span className="ecom-field-label">画幅</span>
                        <div className="ecom-chip-row">
                            {ECOMMERCE_ASPECT_RATIOS.map((item) => (
                                <button key={item.id} type="button" className="ecom-chip tabular-nums" aria-pressed={ratio === item.id} title={item.hint} onClick={() => updateMetadata?.(node.id, { ecommerceAspectRatio: item.id })}>
                                    {item.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="ecom-field">
                        <span className="ecom-field-label">本地精确合成 · 文字必须逐字准确时用</span>
                        <div className="ecom-chip-row">
                            {ECOMMERCE_ASPECT_RATIOS.map((item) => (
                                <button key={item.id} type="button" className="ecom-chip tabular-nums" disabled={!exportEcommerceLayout || Boolean(exporting)} onClick={() => void exportAt(item.id)}>
                                    <Download className="inline size-3" /> {exporting === item.id ? "合成中…" : item.label}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            ) : null}

            <div className="ecom-info-issues">
                {issues.length ? issues.slice(0, 2).map((issue, index) => (
                    <span key={index} className="ecom-card-subtitle" style={{ whiteSpace: "normal", color: issue.level === "block" ? "#d97706" : undefined }}>{issue.message}</span>
                )) : (
                    <span className="ecom-card-subtitle">{hasTable ? "规格表数字要逐项核对" : "标注文字逐字进提示词，错不起时走本地合成"}</span>
                )}
            </div>

            <footer className="ecom-card-footer">
                <span>{sourceImage ? (calloutCount ? <>标注 <b>{calloutCount}</b> 条</> : "还没有标注") : "底图未连"}</span>
                {editable ? (
                    <button type="button" className="ecom-card-footer-action ecom-action" onClick={() => setEditing((value) => !value)} aria-expanded={editing}>
                        {editing ? "收起" : "编辑"}
                        <ChevronDown className="size-3" style={{ transform: editing ? "rotate(180deg)" : undefined, transition: "transform 140ms cubic-bezier(.16,1,.3,1)" }} />
                    </button>
                ) : null}
            </footer>
        </div>
    );
}

/** 引线用一条按角度旋转的细线表达——绝对定位的两个端点，长度与角度由几何算出。 */
function leaderStyle(leader: { fromX: number; fromY: number; toX: number; toY: number }, size: EcommerceRasterSize) {
    const dx = leader.toX - leader.fromX;
    const dy = leader.toY - leader.fromY;
    const length = Math.hypot(dx, dy);
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    return {
        left: `${(leader.fromX / size.width) * 100}%`,
        top: `${(leader.fromY / size.height) * 100}%`,
        width: length,
        transform: `rotate(${angle}deg)`,
    } as const;
}
