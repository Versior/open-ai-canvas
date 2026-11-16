import { useState } from "react";
import { Download, FileCheck2 } from "lucide-react";
import { zipSync } from "fflate";
import { packagingRoleNames, packagingRoles, type PackagingDocument, type PackagingLayout } from "@/lib/packaging/types";
import { packagingVisibleLayers, renderPackagingArtworkCanvas } from "@/lib/packaging/layers";
import { packagingArtworkPdf } from "@/lib/packaging/print-artwork";
import { downloadPackaging } from "@/lib/packaging/delivery";
import { captureUserSession, assertCurrentUserSession } from "@/lib/user-scope";
import { PackagingPreflightPanel } from "./packaging-preflight";
import { packagingPreflight } from "@/lib/packaging/preflight";
import { measurePackagingText } from "@/lib/packaging/typography";

type Props = { document: PackagingDocument; layout: PackagingLayout; images: Map<string, HTMLImageElement>; name: string; onError: (error: string) => void; onSelect: (id: string) => void; onPackage: () => void; onProof: () => void };

export function PackagingDelivery(props: Props) {
    const [exporting, setExporting] = useState(false);
    const [color, setColor] = useState<"rgb" | "cmyk">("rgb");
    const report = packagingPreflight(props.document, props.layout, props.images, measurePackagingText);
    const processes = packagingRoles.filter((role) => role !== "artwork" && packagingVisibleLayers(props.document, role).length);
    const exportPdf = async (plates: boolean) => {
        const session = captureUserSession();
        setExporting(true);
        try {
            await document.fonts.ready;
            if (packagingPreflight(props.document, props.layout, props.images, measurePackagingText).status === "blocked") throw new Error("请先解决交付检查中的阻断项");
            const resolution = Math.ceil((Math.max(props.layout.bounds.width, props.layout.bounds.height) * 300) / 25.4);
            const scale = resolution / Math.max(props.layout.bounds.width, props.layout.bounds.height);
            if (Math.round(props.layout.bounds.width * scale) * Math.round(props.layout.bounds.height * scale) > 40_000_000) throw new Error("300 DPI 画幅超过 4000 万像素，请拆分生产版面");
            const roles = plates ? processes : ["artwork" as const];
            const files: Record<string, Uint8Array> = {};
            for (const role of roles) {
                const canvas = renderPackagingArtworkCanvas(props.document, props.layout, props.images, resolution, role, true);
                const data = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
                const blob = await packagingArtworkPdf(`${props.name} · ${packagingRoleNames[role]}`, props.layout, data, canvas.width, canvas.height, role === "artwork" ? color : "gray");
                assertCurrentUserSession(session);
                if (!plates) {
                    downloadPackaging(blob, `${props.name}-${color}-彩稿`, "pdf");
                    return;
                }
                files[`process-${role}.pdf`] = new Uint8Array(await blob.arrayBuffer());
            }
            assertCurrentUserSession(session);
            downloadPackaging(new Blob([new Uint8Array(zipSync(files, { level: 6 }))], { type: "application/zip" }), `${props.name}-工艺分版`, "zip");
        } catch (error) {
            if (!session.signal.aborted) props.onError(error instanceof Error ? error.message : "印刷文件导出失败");
        } finally {
            setExporting(false);
        }
    };
    return (
        <section className="pkg-delivery">
            <div className="pkg-delivery-heading">
                <FileCheck2 size={28} />
                <div>
                    <h2>交付工作区</h2>
                    <p>核对图稿与工艺，生成真尺寸文件。</p>
                </div>
            </div>
            <div className="pkg-delivery-grid">
                <article>
                    <h3>印刷彩稿</h3>
                    <p>1:1 毫米 · 300 DPI · CutContour / Crease 专色叠印</p>
                    <label>
                        色彩模式
                        <select aria-label="印刷 PDF 色彩模式" value={color} onChange={(e) => setColor(e.target.value as "rgb" | "cmyk")}>
                            <option value="rgb">RGB · 评审彩稿</option>
                            <option value="cmyk">CMYK · 公式转换</option>
                        </select>
                    </label>
                    <button type="button" data-requires-login className="pkg-primary" disabled={exporting || report.status === "blocked"} onClick={() => void exportPdf(false)}>
                        <Download size={15} />
                        {exporting ? "正在生成文件…" : "下载彩稿 PDF"}
                    </button>
                    <p className="pkg-help">彩稿不混入工艺预览。文字、图形和图片按 300 DPI 合成；刀线为矢量。CMYK 未配置 ICC，不宣称 PDF/X。</p>
                </article>
                <article>
                    <h3>工艺分版</h3>
                    <div className="pkg-process-list">
                        {processes.length ? (
                            processes.map((role) => (
                                <span key={role}>
                                    {packagingRoleNames[role]}
                                    <small>{packagingVisibleLayers(props.document, role).length} 层</small>
                                </span>
                            ))
                        ) : (
                            <p>尚无工艺图层。可在设计工作区为元素指定工艺。</p>
                        )}
                    </div>
                    <button type="button" data-requires-login disabled={exporting || !processes.length || report.status === "blocked"} onClick={() => void exportPdf(true)}>
                        下载全部工艺 PDF
                    </button>
                    <p className="pkg-help">300 DPI 无损灰度，黑色为工艺覆盖区。各版使用相同画幅与坐标，裁切参考在独立刀版中。</p>
                </article>
                <article>
                    <h3>结构与完整方案</h3>
                    <div className="pkg-toolbar">
                        <button type="button" onClick={props.onProof}>
                            白样打印与用纸试算
                        </button>
                        <button type="button" data-requires-login disabled={exporting || report.status === "blocked"} onClick={props.onPackage}>
                            下载可重导入方案包
                        </button>
                    </div>
                    <p className="pkg-help">方案包包含原生图层、原始图片、材质设置、刀版 SVG / DXF、工艺 SVG 与检查报告。投产前核对出血、色彩、套准和工厂白样。</p>
                </article>
            </div>
            <PackagingPreflightPanel document={props.document} layout={props.layout} images={props.images} name={props.name} onSelect={props.onSelect} />
        </section>
    );
}
