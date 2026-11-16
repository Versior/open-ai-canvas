import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Play, Square } from "lucide-react";
import { downloadPackaging, packagingPath } from "@/lib/packaging/delivery";
import { estimatePackagingSheet, type SheetOptions } from "@/lib/packaging/production";
import { gridPackagingSheet, sheetTransform, type NestingResponse, type PackagingSheetPlan } from "@/lib/packaging/nesting";
import { packagingSheetDxf, packagingSheetPdf, packagingSheetSvg } from "@/lib/packaging/sheet-export";
import type { PackagingLayout } from "@/lib/packaging/types";

export function PackagingSheet({ active, layout, name, onError }: { active: boolean; layout: PackagingLayout; name: string; onError: (message: string) => void }) {
    const [sheet, setSheet] = useState<SheetOptions>({ width: 700, height: 1000, margin: 10, gripper: 10, gap: 3, rotation: "auto", quantity: 1000, spoilage: 3, pricePerSheet: 0 });
    const [price, setPrice] = useState("");
    const [mode, setMode] = useState<"grid" | "contour">("contour");
    const [budget, setBudget] = useState(5000);
    const [nested, setNested] = useState<PackagingSheetPlan>();
    const [running, setRunning] = useState(false);
    const [elapsed, setElapsed] = useState(0);
    const [status, setStatus] = useState("");
    const [bleed, setBleed] = useState(false);
    const [exporting, setExporting] = useState(false);
    const worker = useRef<Worker | null>(null);
    const result = useMemo(() => {
        try {
            const grid = estimatePackagingSheet(layout, sheet);
            return { grid, plan: gridPackagingSheet(layout, sheet, grid.selected), error: "" };
        } catch (error) {
            return { error: error instanceof Error ? error.message : "拼版参数无效" };
        }
    }, [layout, sheet]);
    useEffect(() => {
        setNested(undefined);
        setRunning(false);
        setStatus("");
        return () => {
            worker.current?.terminate();
            worker.current = null;
        };
    }, [layout, sheet.width, sheet.height, sheet.margin, sheet.gripper, sheet.gap, sheet.rotation]);
    useEffect(() => {
        if (!running) return;
        const start = performance.now();
        const timer = window.setInterval(() => setElapsed(performance.now() - start), 200);
        return () => window.clearInterval(timer);
    }, [running]);
    useEffect(() => {
        if (active || !worker.current) return;
        worker.current.terminate();
        worker.current = null;
        setRunning(false);
        setStatus("已切换到白样，保留当前最佳结果");
    }, [active]);
    const cancel = () => {
        worker.current?.terminate();
        worker.current = null;
        setRunning(false);
        setStatus("已取消搜索，保留当前最佳结果");
    };
    const start = () => {
        worker.current?.terminate();
        setNested(undefined);
        setElapsed(0);
        setStatus("");
        try {
            const process = new Worker(new URL("../../lib/packaging/nesting.worker.ts", import.meta.url), { type: "module" });
            worker.current = process;
            process.onmessage = (event: MessageEvent<NestingResponse>) => {
                if (worker.current !== process) return;
                if (event.data.type === "error") {
                    setStatus(event.data.message);
                    setRunning(false);
                    process.terminate();
                    worker.current = null;
                    return;
                }
                setNested(event.data.plan);
                if (event.data.type === "progress") return;
                setElapsed(event.data.plan.elapsedMs);
                setStatus(event.data.plan.stop === "budget" ? "时间预算已到，保留当前最佳结果" : event.data.plan.stop === "limit" ? "已达 500 套搜索上限，保留当前最佳结果" : "搜索完成，当前结果已复核轮廓碰撞");
                setRunning(false);
                process.terminate();
                worker.current = null;
            };
            process.onerror = () => {
                if (worker.current !== process) return;
                setStatus("排料 Worker 运行失败，请重新计算");
                setRunning(false);
                process.terminate();
                worker.current = null;
            };
            setRunning(true);
            process.postMessage({ layout, options: sheet, budgetMs: budget });
        } catch (error) {
            setStatus(error instanceof Error ? error.message : "无法启动排料 Worker");
        }
    };
    const plan = mode === "contour" && nested ? nested : result.plan;
    const count = plan?.placements.length ?? 0;
    const base = count ? Math.ceil(sheet.quantity / count) : 0;
    const extra = Math.ceil((base * sheet.spoilage) / 100);
    const field = (key: "width" | "height" | "margin" | "gripper" | "gap" | "quantity" | "spoilage", label: string, min: number, max: number) => (
        <label>
            {label}
            <input aria-label={label} type="number" min={min} max={max} step={key === "quantity" ? 1 : 0.1} value={sheet[key]} onChange={(e) => setSheet((value) => ({ ...value, [key]: Number(e.target.value) }))} />
        </label>
    );
    const exportSheet = async (format: "svg" | "dxf" | "pdf" | "json") => {
        if (!plan) return;
        setExporting(true);
        try {
            const blob =
                format === "pdf"
                    ? await packagingSheetPdf(name, layout, sheet, plan)
                    : format === "svg"
                      ? new Blob([packagingSheetSvg(name, layout, sheet, plan)], { type: "image/svg+xml" })
                      : format === "dxf"
                        ? new Blob([packagingSheetDxf(layout, sheet, plan)], { type: "application/dxf" })
                        : new Blob(
                              [
                                  JSON.stringify(
                                      {
                                          name,
                                          units: "mm",
                                          options: { ...sheet, pricePerSheet: price === "" ? null : sheet.pricePerSheet },
                                          plan,
                                          result: {
                                              count,
                                              baseSheets: base,
                                              extraSheets: extra,
                                              sheets: base + extra,
                                              excess: base * count - sheet.quantity,
                                              netUtilization: (count * layout.areaMm2) / (sheet.width * sheet.height),
                                              paperCost: price === "" ? null : (base + extra) * sheet.pricePerSheet,
                                          },
                                          scope: "完整一套结构拼版与纸材试算；不含彩稿、共刀、孔内嵌套、分部件拆排及印刷工艺报价。",
                                      },
                                      null,
                                      2,
                                  ),
                              ],
                              { type: "application/json" },
                          );
            downloadPackaging(blob, `${name}-整纸${count}套`, format);
        } catch (error) {
            onError(error instanceof Error ? error.message : "整纸导出失败");
        } finally {
            setExporting(false);
        }
    };
    if (!active) return null;
    return (
        <>
            <div className="pkg-toolbar">
                纸张预设
                {[
                    [700, 1000],
                    [787, 1092],
                    [889, 1194],
                ].map(([width, height]) => (
                    <button type="button" key={width} aria-pressed={sheet.width === width && sheet.height === height} onClick={() => setSheet((v) => ({ ...v, width, height }))}>
                        {width} × {height}
                    </button>
                ))}
            </div>
            <div className="pkg-fields">
                {field("width", "纸张宽 mm", 100, 4000)}
                {field("height", "纸张高 mm", 100, 4000)}
                {field("margin", "四边留白 mm", 0, 100)}
                {field("gripper", "上侧额外咬口 mm", 0, 100)}
                {field("gap", "出血间距 mm", 0, 50)}
                <label>
                    允许方向
                    <select aria-label="允许方向" value={sheet.rotation} onChange={(e) => setSheet((v) => ({ ...v, rotation: e.target.value as SheetOptions["rotation"] }))}>
                        <option value="auto">允许 0° / 90° 混排</option>
                        <option value="0">只用 0°</option>
                        <option value="90">只用 90°</option>
                    </select>
                </label>
                {field("quantity", "需求份数", 1, 10000000)}
                {field("spoilage", "备用纸张 %", 0, 50)}
                <label>
                    单张纸价 元
                    <input
                        aria-label="单张纸价"
                        type="number"
                        min={0}
                        step={0.01}
                        placeholder="填写实际采购价"
                        value={price}
                        onChange={(e) => {
                            setPrice(e.target.value);
                            setSheet((v) => ({ ...v, pricePerSheet: Number(e.target.value) }));
                        }}
                    />
                </label>
            </div>
            {result.error ? (
                <p role="alert" className="pkg-error">
                    {result.error}
                </p>
            ) : null}
            <div className="pkg-toolbar">
                <button type="button" aria-pressed={mode === "contour"} onClick={() => setMode("contour")}>
                    轮廓排料
                </button>
                <button
                    type="button"
                    aria-pressed={mode === "grid"}
                    onClick={() => {
                        if (running) cancel();
                        setMode("grid");
                    }}
                >
                    网格拼版
                </button>
                {mode === "contour" ? (
                    <>
                        <label className="pkg-sheet-budget">
                            搜索预算
                            <select aria-label="搜索预算" value={budget} disabled={running} onChange={(e) => setBudget(Number(e.target.value))}>
                                <option value={2000}>2 秒</option>
                                <option value={5000}>5 秒</option>
                                <option value={10000}>10 秒</option>
                            </select>
                        </label>
                        {running ? (
                            <button type="button" onClick={cancel}>
                                <Square size={14} />
                                取消搜索
                            </button>
                        ) : (
                            <button type="button" data-requires-login className="pkg-primary" disabled={Boolean(result.error)} onClick={start}>
                                <Play size={14} />
                                {nested ? "重新排料" : "开始排料"}
                            </button>
                        )}
                    </>
                ) : null}
                <button type="button" aria-pressed={bleed} onClick={() => setBleed((v) => !v)}>
                    显示出血
                </button>
            </div>
            {mode === "contour" ? (
                <div className="pkg-sheet-status" role="status" aria-live="polite">
                    {running ? (
                        <>
                            <progress aria-label="排料时间预算" max={budget} value={Math.min(elapsed, budget)} />
                            <span>
                                搜索中 · {(elapsed / 1000).toFixed(1)} 秒 · 当前最佳 {count} 套
                            </span>
                        </>
                    ) : (
                        <span>
                            {status || "尚未搜索，预览显示网格基础结果"}
                            {nested ? ` · ${(elapsed / 1000).toFixed(1)} 秒 · ${nested.trials} 轮` : ""}
                        </span>
                    )}
                </div>
            ) : null}
            {result.grid && plan ? (
                <>
                    <table className="pkg-production-table">
                        <thead>
                            <tr>
                                <th>排法</th>
                                <th>每张套数</th>
                                <th>净结构利用率</th>
                                <th>基础用纸</th>
                            </tr>
                        </thead>
                        <tbody>
                            {result.grid.alternatives.map((value) => (
                                <tr key={value.rotation} className={mode === "grid" && value.rotation === result.grid.selected.rotation ? "is-selected" : ""}>
                                    <td>
                                        网格 {value.rotation}°{sheet.rotation !== "auto" && String(value.rotation) !== sheet.rotation ? " · 禁用" : ""}
                                    </td>
                                    <td>{value.count}</td>
                                    <td>{(value.netUtilization * 100).toFixed(1)}%</td>
                                    <td>{value.count ? `${Math.ceil(sheet.quantity / value.count)} 张` : "放不下"}</td>
                                </tr>
                            ))}
                            {nested ? (
                                <tr className={mode === "contour" ? "is-selected" : ""}>
                                    <td>轮廓搜索</td>
                                    <td>
                                        {nested.placements.length}
                                        <small> +{nested.placements.length - nested.gridCount} 套</small>
                                    </td>
                                    <td>{(((nested.placements.length * layout.areaMm2) / (sheet.width * sheet.height)) * 100).toFixed(1)}%</td>
                                    <td>{nested.placements.length ? `${Math.ceil(sheet.quantity / nested.placements.length)} 张` : "放不下"}</td>
                                </tr>
                            ) : null}
                        </tbody>
                    </table>
                    {count ? (
                        <>
                            <div className="pkg-production-metrics">
                                <span>
                                    基础纸张<strong>{base} 张</strong>
                                </span>
                                <span>
                                    备用纸张<strong>{extra} 张</strong>
                                </span>
                                <span>
                                    合计用纸<strong>{base + extra} 张</strong>
                                </span>
                                <span>
                                    基础多出<strong>{base * count - sheet.quantity} 套</strong>
                                </span>
                            </div>
                            <p className="pkg-production-summary">
                                当前预览 · {plan.method === "grid" ? "网格拼版" : "轮廓搜索最佳结果"} · {count} 套 / 张
                            </p>
                            <svg className="pkg-production-preview pkg-sheet-preview" role="img" aria-label="整纸刀版拼版预览" viewBox={`0 0 ${sheet.width} ${sheet.height}`}>
                                <defs>
                                    <g id="pkg-sheet-lines">
                                        <path className="pkg-production-outline pkg-sheet-cut" d={layout.cuts.map((path) => packagingPath(path)).join(" ")} />
                                        <path className="pkg-sheet-crease" d={layout.creases.map((path) => packagingPath(path, false)).join(" ")} />
                                        {bleed ? <path className="pkg-sheet-bleed" d={layout.bleed.map((path) => packagingPath(path)).join(" ")} /> : null}
                                    </g>
                                </defs>
                                <rect className="pkg-sheet-paper" x={0} y={0} width={sheet.width} height={sheet.height} />
                                <rect className="pkg-production-tile" x={sheet.margin} y={sheet.margin + sheet.gripper} width={result.grid.usableWidth} height={result.grid.usableHeight} />
                                {plan.placements.slice(0, 200).map((placement, index) => (
                                    <use key={index} href="#pkg-sheet-lines" transform={sheetTransform(layout.bounds, placement)} />
                                ))}
                            </svg>
                            {count > 200 ? <p className="pkg-help">预览显示前 200 套。统计和导出包含全部 {count} 套。</p> : null}
                            <p className="pkg-production-summary">
                                {price === "" ? "填写纸价后计算纸材成本" : `纸材成本 ¥${((base + extra) * sheet.pricePerSheet).toFixed(2)} · 每需求套 ¥${(((base + extra) * sheet.pricePerSheet) / sheet.quantity).toFixed(4)}`}
                            </p>
                            <div className="pkg-toolbar">
                                {(["svg", "dxf", "pdf", "json"] as const).map((format) => (
                                    <button type="button" data-requires-login key={format} disabled={running || exporting} onClick={() => void exportSheet(format)}>
                                        <Download size={14} />
                                        {format === "json" ? "导出试算单" : `整纸 1:1 ${format.toUpperCase()}`}
                                    </button>
                                ))}
                            </div>
                        </>
                    ) : (
                        <p role="status">当前纸张放不下一套刀版，请增大纸张、调整方向或减少留白。</p>
                    )}
                </>
            ) : null}
            <p className="pkg-help">
                轮廓搜索沿整套出血外轮廓排料，计入留白、上侧咬口与出血间距；部件相对位置保持不变。结果至少保留网格基础方案，有限时间内搜索不保证最优。按丝向或图稿方向选择固定角度。整纸导出只含切线、折线、出血及纸张参考线；DXF 参考线位于 DIMENSION
                层。参考线不能用作切线。打印选实际大小 / 100%。
            </p>
            <p className="pkg-help">不包含共刀、孔内嵌套、分部件拆排和彩稿拼版。搜索在本机浏览器运行，不调用模型或服务器计算；更复杂的轮廓可能耗尽时间预算。投产前仍须由工厂确认设备边距、纸厚和白样。</p>
        </>
    );
}
