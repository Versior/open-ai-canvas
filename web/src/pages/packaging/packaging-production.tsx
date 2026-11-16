import { useMemo, useState } from "react";
import { Printer } from "lucide-react";
import { downloadPackaging, packagingPath } from "@/lib/packaging/delivery";
import { planPackagingPrint, type PrintOptions } from "@/lib/packaging/production";
import { packagingProofPdf } from "@/lib/packaging/print";
import type { PackagingLayout } from "@/lib/packaging/types";
import { PackagingSheet } from "./packaging-sheet";

export function PackagingProduction({ layout, name, onError }: { layout: PackagingLayout; name: string; onError: (message: string) => void }) {
    const [tab, setTab] = useState<"print" | "sheet">("print");
    const [print, setPrint] = useState<PrintOptions>({ paper: "A4", margin: 12, overlap: 5 });
    const [exporting, setExporting] = useState(false);
    const result = useMemo(() => {
        try {
            return { print: planPackagingPrint(layout.bounds, print), error: "" };
        } catch (error) {
            return { error: error instanceof Error ? error.message : "试算参数无效" };
        }
    }, [layout, print]);
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
                    纸张用量与拼版
                </button>
            </div>
            {tab === "print" ? (
                <>
                    {result.error ? (
                        <p role="alert" className="pkg-error">
                            {result.error}
                        </p>
                    ) : null}
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
            ) : null}
            <PackagingSheet active={tab === "sheet"} layout={layout} name={name} onError={onError} />
        </div>
    );
}
