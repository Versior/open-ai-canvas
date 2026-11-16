import { useMemo } from "react";
import { Download } from "lucide-react";
import { downloadPackaging } from "@/lib/packaging/delivery";
import { packagingRoleNames } from "@/lib/packaging/types";
import { packagingPreflight, type PackagingImageSize } from "@/lib/packaging/preflight";
import type { PackagingDocument, PackagingLayout } from "@/lib/packaging/types";
import { measurePackagingText } from "@/lib/packaging/typography";

export function PackagingPreflightPanel({ document, layout, images, name, onSelect }: { document: PackagingDocument; layout: PackagingLayout; images: Map<string, PackagingImageSize>; name: string; onSelect?: (id: string) => void }) {
    const result = useMemo(() => {
        try {
            return { report: packagingPreflight(document, layout, images, measurePackagingText) };
        } catch (error) {
            return { error: error instanceof Error ? error.message : "方案参数无效" };
        }
    }, [document, layout, images, images.size]);
    if (!result.report)
        return (
            <p className="pkg-error" role="alert">
                {result.error}
            </p>
        );
    const report = result.report;
    return (
        <div className="pkg-workbench pkg-production">
            <p className="pkg-production-summary" role="status">
                {report.status === "blocked" ? "存在交付阻断项，请修正后导出" : report.status === "review" ? "设计可导出，以下项目需要复核" : "自动检查未发现图稿问题"}
            </p>
            <div className="pkg-production-metrics">
                <span>
                    结构面积<strong>{(report.areaMm2 / 1_000_000).toFixed(3)} m²</strong>
                </span>
                <span>
                    切线长度<strong>{(report.cutLengthMm / 1000).toFixed(3)} m</strong>
                </span>
                <span>
                    折线长度<strong>{(report.creaseLengthMm / 1000).toFixed(3)} m</strong>
                </span>
                <span>
                    图稿／工艺<strong>{report.artworks.length} 层</strong>
                </span>
            </div>
            {report.artworks.length ? (
                <table className="pkg-production-table">
                    <thead>
                        <tr>
                            <th>图稿</th>
                            <th>用途</th>
                            <th>有效 DPI</th>
                            <th>裁切内占比</th>
                        </tr>
                    </thead>
                    <tbody>
                        {report.artworks.map((art) => (
                            <tr key={art.id}>
                                <td>
                                    {onSelect ? (
                                        <button type="button" onClick={() => onSelect(art.id)}>
                                            {art.name}
                                        </button>
                                    ) : (
                                        art.name
                                    )}
                                </td>
                                <td>
                                    {packagingRoleNames[art.role]}
                                    {art.visible ? "" : " · 隐藏"}
                                </td>
                                <td>{art.kind !== "image" ? "原生图层" : art.dpi === null ? "未加载" : Math.round(art.dpi)}</td>
                                <td>{(art.visibleFraction * 100).toFixed(1)}%</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            ) : (
                <p>当前方案没有图稿或工艺掩膜，可作为结构白样。</p>
            )}
            {report.issues.length ? (
                <ul className="pkg-preflight-issues">
                    {report.issues.map((issue, index) => (
                        <li key={index} className={issue.severity === "error" ? "pkg-error" : ""}>
                            {issue.artworkId && onSelect ? (
                                <button type="button" onClick={() => onSelect(issue.artworkId!)}>
                                    {issue.message}
                                </button>
                            ) : (
                                issue.message
                            )}
                        </li>
                    ))}
                </ul>
            ) : null}
            <button type="button" data-requires-login onClick={() => downloadPackaging(new Blob([JSON.stringify({ name, ...report }, null, 2)], { type: "application/json" }), `${name}-交付检查`, "json")}>
                <Download size={15} />
                下载检查报告
            </button>
            <p className="pkg-help">图片按真实像素计算 DPI；文字测量换行后的尺寸并检查溢出，文本框核对 3 mm 安全区。裁切占比考虑旋转和开窗，不判断彩稿覆盖。方案包包含报告与独立工艺 SVG。</p>
            <p className="pkg-help">{report.scope}</p>
        </div>
    );
}
