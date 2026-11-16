import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { Download, ImagePlus, Minus, Plus, Scan } from "lucide-react";
import { packagingPath, packagingDxf, packagingSvg, downloadPackaging } from "@/lib/packaging/delivery";
import type { PackagingArtwork, PackagingDocument, PackagingLayout } from "@/lib/packaging/types";
import { resourceFileUrl } from "@/services/api/resources";
import { artworkBounds, artworkEditorBounds, artworkHandles, movePackagingArtwork, resizePackagingArtwork, rotatePackagingArtwork, type ArtworkHandle } from "@/lib/packaging/artwork";
import { packagingPanelBounds } from "@/lib/packaging/production";
import { packagingLayerMarkup, packagingResourceIds } from "@/lib/packaging/layers";
import { packagingSafeArea } from "@/lib/packaging/design";
import { packagingPreflight } from "@/lib/packaging/preflight";
import { measurePackagingText } from "@/lib/packaging/typography";
import { captureUserSession, assertCurrentUserSession } from "@/lib/user-scope";

type Props = {
    document: PackagingDocument;
    layout: PackagingLayout;
    selected: string;
    onSelect: (id: string) => void;
    onArtwork: (id: string, change: Partial<PackagingArtwork>) => void;
    selectedArtwork?: string;
    onSelectArtwork?: (id: string) => void;
    onInteractionStart?: () => void;
    onInteractionCancel?: () => void;
    onInteractionEnd?: () => void;
    onUpload: (file: File) => void;
    name: string;
    resources: Map<string, Blob>;
    onError: (message: string) => void;
    readOnly?: boolean;
    resourceUrl?: (id: string) => string;
};

export function PackagingDieline(props: Props) {
    const [zoom, setZoom] = useState(1);
    const [layers, setLayers] = useState({ cut: true, crease: true, bleed: true, names: true, process: false, safe: false });
    const [focused, setFocused] = useState(false);
    const [snap, setSnap] = useState(true);
    const [guides, setGuides] = useState<{ axis: "x" | "y"; value: number }[]>([]);
    const file = useRef<HTMLInputElement>(null);
    const svg = useRef<SVGSVGElement>(null);
    const [size, setSize] = useState({ width: 500, height: 500 });
    useEffect(() => {
        const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
        observer.observe(svg.current!);
        return () => observer.disconnect();
    }, []);
    const drag = useRef<{ art: PackagingArtwork; start: [number, number]; bounds: PackagingLayout["bounds"]; action: "move" | "rotate" | ArtworkHandle }>(null);
    const selectedArt = props.document.artworks.find((a) => a.id === props.selectedArtwork);
    const focusedPanel = props.layout.panels.find((p) => p.id === (selectedArt?.panelId || props.selected));
    const naturalBounds = focused && focusedPanel ? packagingPanelBounds(focusedPanel.points) : focused && selectedArt ? artworkBounds(selectedArt) : artworkEditorBounds(props.layout, props.document.artworks);
    const b = drag.current?.bounds ?? naturalBounds;
    const safe = useMemo(() => packagingSafeArea(props.layout), [props.layout]);
    const unitsPerPixel = () => 1 / Math.hypot(svg.current!.getScreenCTM()!.a, svg.current!.getScreenCTM()!.b);
    const pad = focused ? 8 : 25;
    const handleSize = Math.max((b.width + pad * 2) / size.width, (b.height + pad * 2) / size.height) * 10;
    const pointer = (clientX: number, clientY: number) => {
        const point = new DOMPoint(clientX, clientY).matrixTransform(svg.current!.getScreenCTM()!.inverse());
        return point;
    };
    const start = (e: PointerEvent<SVGElement>, art: PackagingArtwork, action: "move" | "rotate" | ArtworkHandle) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        props.onSelectArtwork?.(art.id);
        if (props.readOnly || art.locked) return;
        const p = pointer(e.clientX, e.clientY);
        props.onInteractionStart?.();
        drag.current = { art, start: [p.x, p.y], bounds: naturalBounds, action };
        svg.current!.focus();
        svg.current!.setPointerCapture(e.pointerId);
    };
    const end = () => {
        if (!drag.current) return;
        drag.current = null;
        setGuides([]);
        props.onInteractionEnd?.();
    };
    const exportSvg = async () => {
        const session = captureUserSession();
        await document.fonts.ready;
        const errors = packagingPreflight(props.document, props.layout, new Map(), measurePackagingText).issues.filter((issue) => issue.severity === "error" && issue.code !== "resource_missing");
        if (errors.length) throw new Error(errors.map((issue) => issue.message).join("；"));
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
        if (packagingResourceIds(props.document).some((id) => !images.has(id))) throw new Error("图稿尚未加载，无法导出完整设计");
        assertCurrentUserSession(session);
        downloadPackaging(new Blob([packagingSvg(props.document, props.layout, images, true, measurePackagingText)], { type: "image/svg+xml" }), props.name, "svg");
    };
    return (
        <section className="pkg-dieline">
            <header>
                <div>
                    <strong>包装刀版</strong>
                    <span>
                        {props.layout.bounds.width.toFixed(1)} × {props.layout.bounds.height.toFixed(1)} mm · {props.layout.parts.length} 部件
                    </span>
                </div>
                <div className="pkg-toolbar">
                    <button
                        type="button"
                        aria-pressed={focused}
                        disabled={!focusedPanel && !selectedArt && !focused}
                        onClick={() => {
                            setFocused((value) => !value);
                            setZoom(1);
                        }}
                    >
                        {focused ? "完整刀版" : "放大当前面"}
                    </button>
                    <button
                        type="button"
                        className="pkg-icon"
                        title="适配完整图稿"
                        onClick={() => {
                            setFocused(false);
                            setZoom(1);
                        }}
                    >
                        <Scan size={15} />
                    </button>
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
                    style={{ width: `${zoom * 100}%`, minWidth: `${zoom * 100}%`, height: `${zoom * 100}%`, minHeight: `${zoom * 100}%` }}
                    viewBox={`${b.x - pad} ${b.y - pad} ${b.width + pad * 2} ${b.height + pad * 2}`}
                    role="img"
                    aria-label="包装刀版预览"
                    tabIndex={0}
                    onPointerDown={(e) => {
                        if (e.target === e.currentTarget) props.onSelectArtwork?.("");
                    }}
                    onKeyDown={(e) => {
                        if (props.readOnly) return;
                        if (e.key === "Escape") {
                            e.stopPropagation();
                            if (drag.current) props.onInteractionCancel?.();
                            end();
                            props.onSelectArtwork?.("");
                            return;
                        }
                        if (!selectedArt || selectedArt.locked || drag.current || e.metaKey || e.ctrlKey) return;
                        const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
                        if (!direction) return;
                        e.preventDefault();
                        const step = e.altKey ? 0.1 : e.shiftKey ? 10 : 1;
                        props.onArtwork(selectedArt.id, { x: selectedArt.x + direction[0] * step, y: selectedArt.y + direction[1] * step });
                    }}
                    onKeyUp={(e) => {
                        if (e.key.startsWith("Arrow")) props.onInteractionEnd?.();
                    }}
                    onPointerMove={(e) => {
                        if (!drag.current) return;
                        const p = pointer(e.clientX, e.clientY);
                        const { art, start, action } = drag.current;
                        if (action === "rotate") {
                            props.onArtwork(art.id, rotatePackagingArtwork(art, start, [p.x, p.y], e.shiftKey));
                            return;
                        }
                        if (action !== "move") {
                            props.onArtwork(art.id, resizePackagingArtwork(art, action, [p.x - start[0], p.y - start[1]], !e.altKey));
                            return;
                        }
                        const panel = props.layout.panels.find((v) => v.id === art.panelId);
                        const move = movePackagingArtwork(art, [p.x - start[0], p.y - start[1]], panel ? packagingPanelBounds(panel.points) : props.layout.bounds, unitsPerPixel() * 6, snap && !e.altKey);
                        setGuides(move.guides);
                        props.onArtwork(art.id, { x: move.x, y: move.y });
                    }}
                    onPointerUp={(e) => {
                        end();
                        if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
                    }}
                    onPointerCancel={() => {
                        props.onInteractionCancel?.();
                        end();
                    }}
                    onLostPointerCapture={end}
                >
                    <defs>
                        <clipPath id="preview-focus">
                            <rect x={b.x - pad} y={b.y - pad} width={b.width + pad * 2} height={b.height + pad * 2} />
                        </clipPath>
                        <clipPath id="preview-structure">
                            <path d={props.layout.cuts.map((p) => packagingPath(p)).join(" ")} clipRule="evenodd" />
                        </clipPath>
                        {props.layout.panels.map((panel) => (
                            <clipPath key={panel.id} id={`preview-${panel.id}`}>
                                <path d={[panel.points, ...panel.holes].map((p) => packagingPath(p)).join(" ")} clipRule="evenodd" />
                            </clipPath>
                        ))}
                    </defs>
                    <g clipPath={focused ? "url(#preview-focus)" : undefined}>
                        {props.layout.panels.map((panel) => (
                            <path
                                key={panel.id}
                                className={props.selected === panel.id ? "is-selected" : ""}
                                d={[panel.points, ...panel.holes].map((p) => packagingPath(p)).join(" ")}
                                fillRule="evenodd"
                                fill={props.selected === panel.id ? "#dbe6bd" : "#fbfaf7"}
                                stroke="#e2ded7"
                                strokeWidth={0.2}
                                onClick={() => {
                                    props.onSelectArtwork?.("");
                                    props.onSelect(props.selected === panel.id ? "" : panel.id);
                                }}
                            >
                                <title>{panel.name}</title>
                            </path>
                        ))}
                        {props.document.artworks
                            .filter((a) => a.visible !== false && (a.role === "artwork" || layers.process || a.id === props.selectedArtwork))
                            .map((art) => (
                                <g key={art.id} clipPath={`url(#preview-${art.panelId || "structure"})`}>
                                    <g
                                        opacity={art.opacity}
                                        transform={`rotate(${art.rotation} ${art.x + art.width / 2} ${art.y + art.height / 2})`}
                                        className={`pkg-art-image ${art.role !== "artwork" ? "is-mask" : ""}`}
                                        onClick={(e) => e.stopPropagation()}
                                        onPointerDown={(e) => start(e, art, "move")}
                                        dangerouslySetInnerHTML={{
                                            __html: packagingLayerMarkup(
                                                art,
                                                art.content ? "" : (props.resourceUrl || resourceFileUrl)(art.resourceId),
                                                art.role === "artwork" ? undefined : art.role === "foil" ? "#d9b465" : art.role === "silver" ? "#c6cbd6" : "#849f91",
                                            ),
                                        }}
                                    />
                                </g>
                            ))}
                        {layers.cut ? (
                            <g stroke="#ce4f60" strokeWidth={0.4} fill="none" pointerEvents="none">
                                {props.layout.cuts.map((p, i) => (
                                    <path key={i} d={packagingPath(p)} />
                                ))}
                            </g>
                        ) : null}
                        {layers.crease ? (
                            <g stroke="#4677c6" strokeWidth={0.35} strokeDasharray="2 1.3" fill="none" pointerEvents="none">
                                {props.layout.creases.map((p, i) => (
                                    <path key={i} d={packagingPath(p, false)} />
                                ))}
                            </g>
                        ) : null}
                        {layers.bleed ? (
                            <g stroke="#739c58" strokeWidth={0.25} fill="none" pointerEvents="none">
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
                        {layers.safe ? (
                            <g className="pkg-safe-outline" fill="none" strokeWidth={0.4} strokeDasharray="1.5 1" pointerEvents="none">
                                <path d={safe.map((points) => packagingPath(points)).join(" ")} />
                            </g>
                        ) : null}
                        {guides.map((guide) => (
                            <line
                                key={guide.axis}
                                className="pkg-art-guide"
                                pointerEvents="none"
                                x1={guide.axis === "x" ? guide.value : b.x}
                                x2={guide.axis === "x" ? guide.value : b.x + b.width}
                                y1={guide.axis === "y" ? guide.value : b.y}
                                y2={guide.axis === "y" ? guide.value : b.y + b.height}
                            />
                        ))}
                        {selectedArt && !selectedArt.locked && selectedArt.visible !== false && !props.readOnly ? (
                            <g className="pkg-art-transform" transform={`translate(${selectedArt.x + selectedArt.width / 2} ${selectedArt.y + selectedArt.height / 2}) rotate(${selectedArt.rotation})`}>
                                <rect x={-selectedArt.width / 2} y={-selectedArt.height / 2} width={selectedArt.width} height={selectedArt.height} fill="none" pointerEvents="none" />
                                <line x1={0} x2={0} y1={-selectedArt.height / 2} y2={-selectedArt.height / 2 - handleSize * 3} pointerEvents="none" />
                                {artworkHandles.map((handle) => (
                                    <rect
                                        key={handle.join()}
                                        aria-label={`缩放图稿 ${handle.join(",")}`}
                                        x={(handle[0] * selectedArt.width) / 2 - handleSize / 2}
                                        y={(handle[1] * selectedArt.height) / 2 - handleSize / 2}
                                        width={handleSize}
                                        height={handleSize}
                                        onPointerDown={(e) => start(e, selectedArt, handle)}
                                    />
                                ))}
                                <circle aria-label="旋转图稿" cx={0} cy={-selectedArt.height / 2 - handleSize * 3} r={handleSize * 0.65} onPointerDown={(e) => start(e, selectedArt, "rotate")} />
                            </g>
                        ) : null}
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
                    </g>
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
                            ["process", "工艺"],
                            ["safe", "安全区"],
                        ] as const
                    ).map(([key, label]) => (
                        <label key={key}>
                            <input type="checkbox" checked={layers[key]} onChange={(e) => setLayers((v) => ({ ...v, [key]: e.target.checked }))} />
                            {label}
                        </label>
                    ))}
                </div>
                {!props.readOnly ? (
                    <div className="pkg-art-help">
                        <label>
                            <input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} />
                            毫米／面板吸附
                        </label>
                        <span>{selectedArt ? `${selectedArt.name} · ${artworkBounds(selectedArt).width.toFixed(1)} × ${artworkBounds(selectedArt).height.toFixed(1)} mm` : "点击图稿选择"}</span>
                    </div>
                ) : null}
                {!props.readOnly ? <p className="pkg-help">角点等比，边点自由缩放；Alt 连续移动／自由缩放，Shift 旋转按 15°吸附。方向键 1 mm，Shift 10 mm，Alt 0.1 mm；Esc 取消当前拖动。</p> : null}
                <div className="pkg-toolbar">
                    {!props.readOnly ? (
                        <button type="button" onClick={() => file.current?.click()}>
                            <ImagePlus size={15} />
                            {props.selected ? "给当前面贴图" : "导入整版设计"}
                        </button>
                    ) : null}
                    <button
                        type="button"
                        data-requires-login
                        onClick={() => {
                            void exportSvg().catch((e: Error) => props.onError(e.message));
                        }}
                    >
                        <Download size={15} />
                        SVG
                    </button>
                    <button type="button" data-requires-login onClick={() => downloadPackaging(new Blob([packagingDxf(props.layout)], { type: "application/dxf" }), props.name, "dxf")}>
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
