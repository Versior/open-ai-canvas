import { useMemo, useState } from "react";
import { Download, Printer } from "lucide-react";
import { downloadPackaging, packagingPath } from "@/lib/packaging/delivery";
import { estimatePackagingSheet, planPackagingPrint, sheetPlacement, type PrintOptions, type SheetOptions } from "@/lib/packaging/production";
import { packagingProofPdf } from "@/lib/packaging/print";
import type { PackagingLayout } from "@/lib/packaging/types";

export function PackagingProduction({ layout, name, onError }: { layout: PackagingLayout; name: string; onError: (message: string) => void }) {
    const [tab, setTab] = useState<"print" | "sheet">("print");
    const [print, setPrint] = useState<PrintOptions>({ paper: "A4", margin: 12, overlap: 5 });
    const [sheet, setSheet] = useState<SheetOptions>({ width: 700, height: 1000, margin: 10, gripper: 10, gap: 3, rotation: "auto", quantity: 1000, spoilage: 3, pricePerSheet: 0 });
    const [price, setPrice] = useState("");
    const [exporting, setExporting] = useState(false);
    const result = useMemo(() => {
        try {
            if (tab === "print") return { print: planPackagingPrint(layout.bounds, print), error: "" };
            return { sheet: estimatePackagingSheet(layout, sheet), error: "" };
        } catch (error) {
            return { error: error instanceof Error ? error.message : "试算参数无效" };
        }
    }, [layout, print, sheet, tab]);
    const field = (key: "width" | "height" | "margin" | "gripper" | "gap" | "quantity" | "spoilage", label: string, min: number, max: number) => (
        <label>
            {label}
            <input aria-label={label} type="number" min={min} max={max} step={key === "quantity" ? 1 : 0.1} value={sheet[key]} onChange={(e) => setSheet((value) => ({ ...value, [key]: Number(e.target.value) }))} />
        </label>
    );
    const exportPdf = async () => {
        setExporting(true);
        try {
            downloadPackaging(await packagingProofPdf(name, layout, print), `${name}-白样-${print.paper}`, "pdf");
        } catch (error) {
            onError(error instanceof Error ? error.message : "白样导出失败");
        } finally {
            setExporting(false);
        }
    };
    return (
        <div className="pkg-workbench pkg-production">
            <div className="pkg-toolbar">
                <button type="button" aria-pressed={tab === "print"} onClick={() => setTab("print")}>
                    白样打印
                </button>
                <button type="button" aria-pressed={tab === "sheet"} onClick={() => setTab("sheet")}>
                    纸张用量
                </button>
            </div>
            {result.error ? (
                <p role="alert" className="pkg-error">
                    {result.error}
                </p>
            ) : null}
            {tab === "print" ? (
                <>
                    <div className="pkg-fields">
                        <label>
                            打印纸张
                            <select aria-label="打印纸张" value={print.paper} onChange={(e) => setPrint((v) => ({ ...v, paper: e.target.value as PrintOptions["paper"] }))}>
                                <option>A4</option>
                                <option>A3</option>
                            </select>
                        </label>
                        <label>
                            打印边距 mm
                            <input aria-label="打印边距" type="number" min={10} max={30} value={print.margin} onChange={(e) => setPrint((v) => ({ ...v, margin: Number(e.target.value) }))} />
                        </label>
                        <label>
                            拼接重叠 mm
                            <input aria-label="拼接重叠" type="number" min={2} max={15} value={print.overlap} onChange={(e) => setPrint((v) => ({ ...v, overlap: Number(e.target.value) }))} />
                        </label>
                    </div>
                    {result.print ? (
                        <>
                            <p className="pkg-production-summary">
                                {print.paper} · {result.print.orientation === "portrait" ? "竖版" : "横版"} · {result.print.rows} 行 × {result.print.columns} 列 · 共 {result.print.tiles.length} 页
                            </p>
                            <svg className="pkg-production-preview" role="img" aria-label="白样分页预览" viewBox={`${layout.bounds.x - 10} ${layout.bounds.y - 10} ${layout.bounds.width + 20} ${layout.bounds.height + 20}`}>
                                <path className="pkg-production-outline" d={layout.cuts.map((p) => packagingPath(p)).join(" ")} />
                                {result.print.tiles.map((tile) => (
                                    <g key={`${tile.row}-${tile.column}`}>
                                        <rect className="pkg-production-tile" x={tile.x} y={tile.y} width={tile.width} height={tile.height} />
                                        <text x={tile.x + 4} y={tile.y + 10} fontSize={7}>
                                            R{tile.row + 1} C{tile.column + 1}
                                        </text>
                                    </g>
                                ))}
                            </svg>
                            <button type="button" data-requires-login className="pkg-primary" disabled={exporting} onClick={() => void exportPdf()}>
                                <Printer size={16} />
                                {exporting ? "正在生成 PDF…" : "下载 1:1 白样 PDF"}
                            </button>
                        </>
                    ) : null}
                    <p className="pkg-help">打印选择“实际大小 / 100%”，关闭自动缩放。先量 PDF 中的 50 mm 校准尺，再沿灰色拼接线裁边并对齐十字标记。红线切割，蓝虚线折叠。白样只输出结构线，不含图稿和工艺掩膜。</p>
                </>
            ) : (
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
                                <option value="auto">比较 0° / 90°</option>
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
                    {result.sheet ? (
                        <>
                            <table className="pkg-production-table">
                                <thead>
                                    <tr>
                                        <th>方向</th>
                                        <th>行 × 列</th>
                                        <th>每张份数</th>
                                        <th>净结构利用率</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {result.sheet.alternatives.map((value) => (
                                        <tr key={value.rotation} className={value.rotation === result.sheet!.selected.rotation ? "is-selected" : ""}>
                                            <td>
                                                {value.rotation}°{value.rotation === result.sheet!.selected.rotation ? " · 当前" : ""}
                                            </td>
                                            <td>
                                                {value.rows} × {value.columns}
                                            </td>
                                            <td>{value.count}</td>
                                            <td>{(value.netUtilization * 100).toFixed(1)}%</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            {result.sheet.selected.count ? (
                                <>
                                    <div className="pkg-production-metrics">
                                        <span>
                                            基础纸张<strong>{result.sheet.baseSheets} 张</strong>
                                        </span>
                                        <span>
                                            备用纸张<strong>{result.sheet.extraSheets} 张</strong>
                                        </span>
                                        <span>
                                            合计用纸<strong>{result.sheet.sheets} 张</strong>
                                        </span>
                                        <span>
                                            基础多出<strong>{result.sheet.excess} 份</strong>
                                        </span>
                                    </div>
                                    <svg className="pkg-production-preview" role="img" aria-label="纸张网格拼版预览" viewBox={`0 0 ${sheet.width} ${sheet.height}`}>
                                        <defs>
                                            <path id="pkg-sheet-outline" className="pkg-production-outline" d={layout.cuts.map((p) => packagingPath(p)).join(" ")} />
                                        </defs>
                                        <rect className="pkg-production-tile" x={sheet.margin} y={sheet.margin + sheet.gripper} width={result.sheet.usableWidth} height={result.sheet.usableHeight} />
                                        {Array.from({ length: Math.min(120, result.sheet.selected.count) }, (_, index) => (
                                            <use key={index} href="#pkg-sheet-outline" className="pkg-production-outline" transform={sheetPlacement(layout, result.sheet!.selected, sheet, index)} />
                                        ))}
                                    </svg>
                                    {result.sheet.selected.count > 120 ? <p className="pkg-help">预览显示前 120 份，统计包含全部 {result.sheet.selected.count} 份。</p> : null}
                                    <p className="pkg-production-summary">{price === "" ? "填写纸价后计算纸材成本" : `纸材成本 ¥${result.sheet.paperCost.toFixed(2)} · 每需求份 ¥${result.sheet.unitPaperCost.toFixed(4)}`}</p>
                                    <button
                                        type="button"
                                        data-requires-login
                                        onClick={() =>
                                            downloadPackaging(
                                                new Blob(
                                                    [
                                                        JSON.stringify(
                                                            {
                                                                name,
                                                                method: "whole-layout-rectangular-grid",
                                                                boundsIncludingBleedMm: layout.bounds,
                                                                netAreaMm2: layout.areaMm2,
                                                                options: { ...sheet, pricePerSheet: price === "" ? null : sheet.pricePerSheet },
                                                                result: { ...result.sheet, paperCost: price === "" ? null : result.sheet!.paperCost, unitPaperCost: price === "" ? null : result.sheet!.unitPaperCost },
                                                                scope: "纸材用量试算，不含印刷、制版、工艺、税费与运输",
                                                            },
                                                            null,
                                                            2,
                                                        ),
                                                    ],
                                                    { type: "application/json" },
                                                ),
                                                `${name}-用纸试算`,
                                                "json",
                                            )
                                        }
                                    >
                                        <Download size={15} />
                                        导出试算单
                                    </button>
                                </>
                            ) : (
                                <p role="status">当前方向放不下一套刀版，请增大纸张、调整方向或减少留白。</p>
                            )}
                        </>
                    ) : null}
                    <p className="pkg-help">按含出血的整套刀版外框做网格排列。净结构利用率按实际面板面积计算；备用纸张为基础纸张的百分比。边距与咬口须按设备调整。丝向限制请用固定方向。该试算不包含异形嵌套、共刀、分部件排料和印刷工艺报价。</p>
                </>
            )}
        </div>
    );
}
