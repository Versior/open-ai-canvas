import { useRef, useState } from "react";
import { Copy, ImagePlus, Trash2 } from "lucide-react";
import { nanoid } from "nanoid";
import type { PackagingArtwork, PackagingCatalog, PackagingDocument, PackagingLayout, PackagingParameters } from "@/lib/packaging/types";
import { fitPackagingArtwork, packagingPanelBounds } from "@/lib/packaging/production";

type Props = {
    catalog: PackagingCatalog;
    document: PackagingDocument;
    layout?: PackagingLayout;
    selected: string;
    onDocument: (update: (d: PackagingDocument) => PackagingDocument, group?: string) => void;
    onSelect: (id: string) => void;
    onTemplate: (id: string) => void;
    onUpload: (file: File, panelId: string, role: PackagingArtwork["role"]) => void;
    busy: boolean;
};

export function PackagingParametersPanel(props: Props) {
    const [query, setQuery] = useState("");
    const [category, setCategory] = useState("");
    const [role, setRole] = useState<PackagingArtwork["role"]>("artwork");
    const [aspectLocks, setAspectLocks] = useState<Record<string, boolean>>({});
    const file = useRef<HTMLInputElement>(null);
    const field = (key: keyof PackagingParameters, label: string, min: number, max: number, step = 0.1) => (
        <label key={key}>
            {label}
            <input type="number" min={min} max={max} step={step} value={props.document.parameters[key]} onChange={(e) => props.onDocument((d) => ({ ...d, parameters: { ...d.parameters, [key]: Number(e.target.value) } }), `parameter-${key}`)} />
        </label>
    );
    const changeArtwork = (id: string, change: Partial<PackagingArtwork>, group?: string) => props.onDocument((d) => ({ ...d, artworks: d.artworks.map((a) => (a.id === id ? { ...a, ...change } : a)) }), group);
    return (
        <aside className="pkg-parameters">
            <section>
                <h3>结构与盒型</h3>
                <input aria-label="搜索包装盒型" placeholder="搜索盒型" value={query} onChange={(e) => setQuery(e.target.value)} />
                <div className="pkg-categories">
                    {["", "折叠纸盒", "礼盒", "托盘展示", "软包装"].map((v) => (
                        <button type="button" key={v} aria-pressed={category === v} onClick={() => setCategory(v)}>
                            {v || "全部"}
                        </button>
                    ))}
                </div>
                <div className="pkg-template-grid">
                    {props.catalog.templates
                        .filter((t) => (!category || t.category === category) && `${t.name} ${t.description}`.includes(query))
                        .map((t) => (
                            <button type="button" key={t.id} aria-pressed={props.document.template.id === t.id} disabled={props.busy} title={t.description} onClick={() => props.onTemplate(t.id)}>
                                <span className={`pkg-template-glyph is-${t.structure}`} aria-hidden />
                                <span>{t.name}</span>
                            </button>
                        ))}
                </div>
            </section>
            <section>
                <h3>
                    尺寸与材料 <small>外尺寸 · mm</small>
                </h3>
                <label>
                    纸材
                    <select
                        value={props.document.material.id}
                        onChange={(e) => {
                            const material = props.catalog.materials.find((m) => m.id === e.target.value)!;
                            props.onDocument((d) => ({ ...d, material: structuredClone(material), parameters: { ...d.parameters, thickness: material.thickness } }));
                        }}
                    >
                        {props.catalog.materials.map((m) => (
                            <option key={m.id} value={m.id}>
                                {m.name}
                            </option>
                        ))}
                    </select>
                </label>
                <div className="pkg-fields">
                    {field("length", "外长", 10, 1000)}
                    {field("width", "外宽 / 袋厚", 10, 1000)}
                    {field("height", "外高", 10, 1000)}
                    {field("thickness", "材料厚度", 0.05, 10, 0.05)}
                </div>
                <div className="pkg-fields">
                    {field("glue", "粘口 / 封边", 2, 80)}
                    {field("tab", "插舌长度", 2, 100)}
                    {field("gap", "套合间隙", 0.1, 10)}
                    {field("bleed", "出血", 0, 20)}
                </div>
                <p className="pkg-help">纸厚进入几何，盒盖与内盒按间隙套合。</p>
            </section>
            <details>
                <summary>结构细节与开窗</summary>
                <div className="pkg-fields">
                    {field("frontHeight", "展示前沿高", 5, props.document.parameters.height)}
                    {field("windowWidth", "开窗宽", 0, props.document.parameters.length - 4)}
                    {field("windowHeight", "开窗高", 0, props.document.parameters.height - 4)}
                    {field("spoutRadius", "吸嘴半径", 0, 50)}
                    {field("inflation", "袋体鼓胀", 0, 1, 0.05)}
                </div>
                <p className="pkg-help">开窗宽高同时设为 0 可关闭；只作用于容得下开窗的正面。软袋鼓胀为曲面预览。</p>
            </details>
            <details open>
                <summary>
                    图稿与局部工艺 <span>{props.document.artworks.length}</span>
                </summary>
                <label>
                    目标面
                    <select value={props.selected} onChange={(e) => props.onSelect(e.target.value)}>
                        <option value="">整版图稿</option>
                        {props.layout?.panels.map((p) => (
                            <option key={p.id} value={p.id}>
                                {p.name} · {p.partId}
                            </option>
                        ))}
                    </select>
                </label>
                <div className="pkg-toolbar">
                    <select aria-label="图稿用途" value={role} onChange={(e) => setRole(e.target.value as PackagingArtwork["role"])}>
                        <option value="artwork">印刷稿</option>
                        <option value="foil">烫金掩膜</option>
                        <option value="uv">局部 UV</option>
                        <option value="emboss">压凸掩膜</option>
                    </select>
                    <button type="button" disabled={props.busy || props.document.artworks.length >= 40} onClick={() => file.current?.click()}>
                        <ImagePlus size={15} />
                        添加
                    </button>
                </div>
                <p className="pkg-help">局部工艺用黑白图：白色作用，黑色保留纸面。PNG、JPG、WebP 可直接上传；SVG 转为 PNG 贴图。</p>
                <input
                    hidden
                    ref={file}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/svg+xml"
                    onChange={(e) => {
                        if (e.target.files?.[0]) props.onUpload(e.target.files[0], props.selected, role);
                        e.target.value = "";
                    }}
                />
                {props.document.artworks.map((a) => (
                    <details key={a.id} className="pkg-artwork">
                        <summary>
                            {a.name}
                            <small>{{ artwork: "印刷", foil: "烫金", uv: "UV", emboss: "压凸" }[a.role]}</small>
                        </summary>
                        <label>
                            面板
                            <select value={a.panelId} onChange={(e) => changeArtwork(a.id, { panelId: e.target.value })}>
                                <option value="">整版</option>
                                {props.layout?.panels.map((p) => (
                                    <option key={p.id} value={p.id}>
                                        {p.name}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label className="pkg-aspect-lock">
                            <input type="checkbox" checked={aspectLocks[a.id] !== false} onChange={(e) => setAspectLocks((v) => ({ ...v, [a.id]: e.target.checked }))} />
                            保持当前宽高比例
                        </label>
                        <div className="pkg-fields">
                            {(
                                [
                                    ["x", "X"],
                                    ["y", "Y"],
                                    ["width", "宽"],
                                    ["height", "高"],
                                    ["rotation", "旋转 °"],
                                    ["opacity", "透明度"],
                                ] as const
                            ).map(([key, label]) => (
                                <label key={key}>
                                    {label}
                                    <input
                                        type="number"
                                        min={key === "width" || key === "height" ? 0.1 : key === "opacity" ? 0 : undefined}
                                        max={key === "opacity" ? 1 : undefined}
                                        step={key === "opacity" ? 0.05 : 0.1}
                                        value={a[key]}
                                        onChange={(e) => {
                                            const value = Number(e.target.value);
                                            const linked =
                                                aspectLocks[a.id] !== false && a.width > 0 && a.height > 0 && (key === "width" || key === "height")
                                                    ? key === "width"
                                                        ? { height: (a.height * value) / a.width }
                                                        : { width: (a.width * value) / a.height }
                                                    : {};
                                            changeArtwork(a.id, { [key]: value, ...linked }, `artwork-${a.id}-${key}`);
                                        }}
                                    />
                                </label>
                            ))}
                        </div>
                        <div className="pkg-toolbar">
                            {(
                                [
                                    ["contain", "等比放入"],
                                    ["cover", "等比铺满"],
                                    ["center", "居中"],
                                ] as const
                            ).map(([mode, label]) => (
                                <button
                                    type="button"
                                    key={mode}
                                    disabled={!props.layout || a.width <= 0 || a.height <= 0}
                                    onClick={() => {
                                        const panel = props.layout!.panels.find((p) => p.id === a.panelId);
                                        changeArtwork(a.id, fitPackagingArtwork(a, panel ? packagingPanelBounds(panel.points) : props.layout!.bounds, mode));
                                    }}
                                >
                                    {label}
                                </button>
                            ))}
                            <button type="button" onClick={() => changeArtwork(a.id, { rotation: (a.rotation + 90) % 360 })}>
                                转 90°
                            </button>
                            <button
                                type="button"
                                disabled={props.document.artworks.length >= 40 || props.busy}
                                onClick={() => props.onDocument((d) => ({ ...d, artworks: [...d.artworks, { ...a, id: nanoid(), name: `${[...a.name].slice(0, 197).join("")} 副本`, x: a.x + 3, y: a.y + 3 }] }))}
                            >
                                <Copy size={14} />
                                复制
                            </button>
                            <button type="button" onClick={() => props.onDocument((d) => ({ ...d, artworks: [...d.artworks.filter((v) => v.id !== a.id), a] }))}>
                                置顶
                            </button>
                            <button type="button" onClick={() => props.onDocument((d) => ({ ...d, artworks: [a, ...d.artworks.filter((v) => v.id !== a.id)] }))}>
                                置底
                            </button>
                            <button type="button" onClick={() => props.onDocument((d) => ({ ...d, artworks: d.artworks.filter((v) => v.id !== a.id) }))}>
                                <Trash2 size={14} />
                                移除
                            </button>
                        </div>
                    </details>
                ))}
            </details>
            <details>
                <summary>材质与灯光</summary>
                <div className="pkg-fields">
                    <label>
                        纸面颜色
                        <input type="color" value={props.document.material.color} onChange={(e) => props.onDocument((d) => ({ ...d, material: { ...d.material, color: e.target.value } }), "material-color")} />
                    </label>
                    <label>
                        内侧颜色
                        <input type="color" value={props.document.material.insideColor} onChange={(e) => props.onDocument((d) => ({ ...d, material: { ...d.material, insideColor: e.target.value } }), "material-inside-color")} />
                    </label>
                    <label>
                        表面
                        <select value={props.document.view.finish} onChange={(e) => props.onDocument((d) => ({ ...d, view: { ...d.view, finish: e.target.value as PackagingDocument["view"]["finish"] } }))}>
                            <option value="paper">原纸</option>
                            <option value="matte">哑光</option>
                            <option value="gloss">覆膜亮光</option>
                            <option value="foil">整面金属</option>
                            <option value="emboss">原纸＋局部压凸</option>
                        </select>
                    </label>
                    <label>
                        背景
                        <select value={props.document.view.background} onChange={(e) => props.onDocument((d) => ({ ...d, view: { ...d.view, background: e.target.value as PackagingDocument["view"]["background"] } }))}>
                            <option value="dark">深色</option>
                            <option value="light">浅色</option>
                            <option value="transparent">透明 PNG</option>
                        </select>
                    </label>
                    <label>
                        灯光
                        <input type="number" min={0.2} max={5} step={0.1} value={props.document.view.light} onChange={(e) => props.onDocument((d) => ({ ...d, view: { ...d.view, light: Number(e.target.value) } }), "view-light")} />
                    </label>
                </div>
                <label className="pkg-check">
                    <input type="checkbox" checked={props.document.view.shadows} onChange={(e) => props.onDocument((d) => ({ ...d, view: { ...d.view, shadows: e.target.checked } }))} />
                    显示接触阴影
                </label>
                <label className="pkg-check">
                    <input type="checkbox" checked={props.document.view.dimensions} onChange={(e) => props.onDocument((d) => ({ ...d, view: { ...d.view, dimensions: e.target.checked } }))} />
                    刀版尺寸标注
                </label>
            </details>
            <details>
                <summary>方案备注</summary>
                <textarea rows={4} maxLength={4000} value={props.document.notes} placeholder="材料批次、印刷要求或白样核对记录" onChange={(e) => props.onDocument((d) => ({ ...d, notes: e.target.value }), "notes")} />
            </details>
        </aside>
    );
}
