import { useRef, useState } from "react";
import { Download, ImagePlus, Minus, Plus } from "lucide-react";
import { packagingPath, packagingDxf, packagingSvg, downloadPackaging } from "@/lib/packaging/delivery";
import type { PackagingArtwork, PackagingDocument, PackagingLayout } from "@/lib/packaging/types";
import { resourceFileUrl } from "@/services/api/resources";

type Props = {
    document: PackagingDocument;
    layout: PackagingLayout;
    selected: string;
    onSelect: (id: string) => void;
    onArtwork: (id: string, change: Partial<PackagingArtwork>) => void;
    onUpload: (file: File) => void;
    name: string;
    resources: Map<string, Blob>;
    onError: (message: string) => void;
    readOnly?: boolean;
    resourceUrl?: (id: string) => string;
};

export function PackagingDieline(props: Props) {
    const [zoom, setZoom] = useState(1);
    const [layers, setLayers] = useState({ cut: true, crease: true, bleed: true, names: true });
    const file = useRef<HTMLInputElement>(null);
    const svg = useRef<SVGSVGElement>(null);
    const drag = useRef<{ id: string; x: number; y: number; originX: number; originY: number }>(null);
    const b = props.layout.bounds;
    const pad = 25;
    const pointer = (clientX: number, clientY: number) => {
        const point = new DOMPoint(clientX, clientY).matrixTransform(svg.current!.getScreenCTM()!.inverse());
        return point;
    };
    const exportSvg = async () => {
        const images = new Map<string, string>();
        for (const [id, blob] of props.resources)
            images.set(
                id,
                await new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(String(reader.result));
                    reader.onerror = () => reject(new Error("图稿编码失败"));
                    reader.readAsDataURL(blob);
                }),
            );
        if (props.document.artworks.some((a) => !images.has(a.resourceId))) throw new Error("图稿尚未加载，无法导出完整设计");
        downloadPackaging(new Blob([packagingSvg(props.document, props.layout, images)], { type: "image/svg+xml" }), props.name, "svg");
    };
    return (
        <section className="pkg-dieline">
            <header>
                <div>
                    <strong>包装刀版</strong>
                    <span>
                        {b.width.toFixed(1)} × {b.height.toFixed(1)} mm · {props.layout.parts.length} 部件
                    </span>
                </div>
                <div className="pkg-toolbar">
                    <button type="button" className="pkg-icon" title="缩小刀版" onClick={() => setZoom((v) => Math.max(0.5, v / 1.2))}>
                        <Minus size={15} />
                    </button>
                    <button type="button" className="pkg-icon" title="放大刀版" onClick={() => setZoom((v) => Math.min(4, v * 1.2))}>
                        <Plus size={15} />
                    </button>
                </div>
            </header>
            <div className="pkg-paper-scroll">
                <svg
                    ref={svg}
                    className="pkg-paper"
                    style={{ width: `${zoom * 100}%`, minWidth: `${zoom * 100}%` }}
                    viewBox={`${b.x - pad} ${b.y - pad} ${b.width + pad * 2} ${b.height + pad * 2}`}
                    role="img"
                    aria-label="包装刀版预览"
                    onPointerMove={(e) => {
                        if (!drag.current) return;
                        const p = pointer(e.clientX, e.clientY);
                        props.onArtwork(drag.current.id, { x: drag.current.originX + p.x - drag.current.x, y: drag.current.originY + p.y - drag.current.y });
                    }}
                    onPointerUp={(e) => {
                        if (drag.current) {
                            drag.current = null;
                            e.currentTarget.releasePointerCapture(e.pointerId);
                        }
                    }}
                    onPointerCancel={() => {
                        drag.current = null;
                    }}
                >
                    <defs>
                        <clipPath id="preview-structure">
                            <path d={props.layout.cuts.map((p) => packagingPath(p)).join(" ")} clipRule="evenodd" />
                        </clipPath>
                        {props.layout.panels.map((panel) => (
                            <clipPath key={panel.id} id={`preview-${panel.id}`}>
                                <path d={[panel.points, ...panel.holes].map((p) => packagingPath(p)).join(" ")} clipRule="evenodd" />
                            </clipPath>
                        ))}
                    </defs>
                    {props.layout.panels.map((panel) => (
                        <path
                            key={panel.id}
                            className={props.selected === panel.id ? "is-selected" : ""}
                            d={[panel.points, ...panel.holes].map((p) => packagingPath(p)).join(" ")}
                            fillRule="evenodd"
                            fill={props.selected === panel.id ? "#dbe6bd" : "#fbfaf7"}
                            stroke="#e2ded7"
                            strokeWidth={0.2}
                            onClick={() => props.onSelect(props.selected === panel.id ? "" : panel.id)}
                        >
                            <title>{panel.name}</title>
                        </path>
                    ))}
                    {props.document.artworks
                        .filter((a) => a.role === "artwork")
                        .map((art) => (
                            <g key={art.id} clipPath={`url(#preview-${art.panelId || "structure"})`}>
                                <image
                                    href={(props.resourceUrl || resourceFileUrl)(art.resourceId)}
                                    x={art.x}
                                    y={art.y}
                                    width={art.width}
                                    height={art.height}
                                    opacity={art.opacity}
                                    transform={`rotate(${art.rotation} ${art.x + art.width / 2} ${art.y + art.height / 2})`}
                                    className="pkg-art-image"
                                    onPointerDown={(e) => {
                                        if (props.readOnly) return;
                                        e.stopPropagation();
                                        const p = pointer(e.clientX, e.clientY);
                                        drag.current = { id: art.id, x: p.x, y: p.y, originX: art.x, originY: art.y };
                                        svg.current!.setPointerCapture(e.pointerId);
                                    }}
                                />
                            </g>
                        ))}
                    {layers.cut ? (
                        <g stroke="#ce4f60" strokeWidth={0.4} fill="none">
                            {props.layout.cuts.map((p, i) => (
                                <path key={i} d={packagingPath(p)} />
                            ))}
                        </g>
                    ) : null}
                    {layers.crease ? (
                        <g stroke="#4677c6" strokeWidth={0.35} strokeDasharray="2 1.3" fill="none">
                            {props.layout.creases.map((p, i) => (
                                <path key={i} d={packagingPath(p, false)} />
                            ))}
                        </g>
                    ) : null}
                    {layers.bleed ? (
                        <g stroke="#739c58" strokeWidth={0.25} fill="none">
                            {props.layout.bleed.map((p, i) => (
                                <path key={i} d={packagingPath(p)} />
                            ))}
                        </g>
                    ) : null}
                    {layers.names
                        ? props.layout.panels.map((panel) => (
                              <text
                                  key={panel.id}
                                  x={panel.points.reduce((s, p) => s + p[0], 0) / panel.points.length}
                                  y={panel.points.reduce((s, p) => s + p[1], 0) / panel.points.length}
                                  fontSize={Math.max(3, Math.min(5, props.document.parameters.length / 25))}
                                  textAnchor="middle"
                                  fill="#776e61"
                                  pointerEvents="none"
                              >
                                  {panel.name}
                              </text>
                          ))
                        : null}
                    {props.document.view.dimensions
                        ? props.layout.dimensions.map((v, i) => (
                              <g key={i} stroke="#79736a" strokeWidth={0.3}>
                                  <path d={packagingPath([v.a, v.b], false)} fill="none" />
                                  <text x={(v.a[0] + v.b[0]) / 2} y={(v.a[1] + v.b[1]) / 2 - 3} fontSize={4} fill="#555" stroke="none" textAnchor="middle">
                                      {v.label}
                                  </text>
                              </g>
                          ))
                        : null}
                </svg>
            </div>
            <div className="pkg-dieline-footer">
                <div className="pkg-layer-switches">
                    {(
                        [
                            ["cut", "切线"],
                            ["crease", "折线"],
                            ["bleed", "出血"],
                            ["names", "面名"],
                        ] as const
                    ).map(([key, label]) => (
                        <label key={key}>
                            <input type="checkbox" checked={layers[key]} onChange={(e) => setLayers((v) => ({ ...v, [key]: e.target.checked }))} />
                            {label}
                        </label>
                    ))}
                </div>
                <div className="pkg-toolbar">
                    {!props.readOnly ? (
                        <button type="button" onClick={() => file.current?.click()}>
                            <ImagePlus size={15} />
                            {props.selected ? "给当前面贴图" : "导入整版设计"}
                        </button>
                    ) : null}
                    <button
                        type="button"
                        onClick={() => {
                            void exportSvg().catch((e: Error) => props.onError(e.message));
                        }}
                    >
                        <Download size={15} />
                        SVG
                    </button>
                    <button type="button" onClick={() => downloadPackaging(new Blob([packagingDxf(props.layout)], { type: "application/dxf" }), props.name, "dxf")}>
                        DXF
                    </button>
                </div>
            </div>
            <input
                ref={file}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                hidden
                onChange={(e) => {
                    if (e.target.files?.[0]) props.onUpload(e.target.files[0]);
                    e.target.value = "";
                }}
            />
        </section>
    );
}
