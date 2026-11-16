import { useRef, useState } from "react";
import { Copy, Eye, EyeOff, ImagePlus, Lock, Unlock, Type, Shapes, Trash2, ArrowUp, ArrowDown } from "lucide-react";
import { nanoid } from "nanoid";
import { packagingRoleNames, packagingRoles, type PackagingArtwork, type PackagingDocument, type PackagingLayout } from "@/lib/packaging/types";
import { packagingPanelBounds, fitPackagingArtwork } from "@/lib/packaging/production";
import { packagingTextSize } from "@/lib/packaging/layers";
import { measurePackagingText, packagingTextLayout } from "@/lib/packaging/typography";
import { alignPackagingLayer, transferPackagingLayer } from "@/lib/packaging/design";

type Props = {
    document: PackagingDocument;
    layout: PackagingLayout;
    selected: string;
    selectedArtwork: string;
    busy: boolean;
    onSelect: (id: string) => void;
    onSelectArtwork: (id: string) => void;
    onDocument: (update: (document: PackagingDocument) => PackagingDocument, group?: string) => void;
    onUpload: (file: File, panelId: string, role: PackagingArtwork["role"]) => void;
};

export function PackagingDesignPanel(props: Props) {
    const file = useRef<HTMLInputElement>(null);
    const add = (kind: "text" | "shape") => {
        const panel = props.layout.panels.find((p) => p.id === props.selected) || props.layout.panels.find((p) => p.id.endsWith("-front")) || props.layout.panels[0];
        const b = packagingPanelBounds(panel.points);
        const id = nanoid();
        const width = b.width * 0.7,
            height = Math.min(kind === "text" ? 12 : 25, b.height * 0.3);
        const content: PackagingArtwork["content"] =
            kind === "text" ? { kind: "text", value: "品牌名称", font: "sans", weight: 400, align: "center", color: "#233b37", fontSize: height / 1.25, lineHeight: 1.25, wrap: true } : { kind: "shape", shape: "rectangle", color: "#52766d" };
        props.onDocument((d) => ({
            ...d,
            artworks: [
                ...d.artworks,
                { id, resourceId: "", name: kind === "text" ? "品牌名称" : "色块", panelId: panel.id, role: "artwork", x: b.x + (b.width - width) / 2, y: b.y + (b.height - height) / 2, width, height, opacity: 1, rotation: 0, content },
            ],
        }));
        props.onSelectArtwork(id);
    };
    return (
        <aside className="pkg-parameters pkg-design-sidebar">
            <section>
                <h3>
                    设计面板 <small>毫米排版</small>
                </h3>
                <label>
                    当前面
                    <select
                        aria-label="当前设计面"
                        value={props.selected}
                        onChange={(e) => {
                            props.onSelectArtwork("");
                            props.onSelect(e.target.value);
                        }}
                    >
                        <option value="">全部面板</option>
                        {props.layout.panels.map((p) => (
                            <option key={p.id} value={p.id}>
                                {p.name}
                            </option>
                        ))}
                    </select>
                </label>
                <p className="pkg-help">点击刀版中的面板或图层，右侧调整内容、工艺与位置。</p>
            </section>
            <section>
                <h3>添加设计元素</h3>
                <div className="pkg-toolbar">
                    <button type="button" data-requires-login disabled={props.busy || props.document.artworks.length >= 40} onClick={() => add("text")}>
                        <Type size={15} />
                        文字
                    </button>
                    <button type="button" data-requires-login disabled={props.busy || props.document.artworks.length >= 40} onClick={() => add("shape")}>
                        <Shapes size={15} />
                        图形
                    </button>
                    <button type="button" data-requires-login disabled={props.busy || props.document.artworks.length >= 40} onClick={() => file.current?.click()}>
                        <ImagePlus size={15} />
                        图片
                    </button>
                </div>
                <input
                    ref={file}
                    hidden
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/svg+xml"
                    onChange={(e) => {
                        if (e.target.files?.[0]) props.onUpload(e.target.files[0], props.selected, "artwork");
                        e.target.value = "";
                    }}
                />
            </section>
            <section>
                <h3>
                    图层 <small>{props.document.artworks.length} / 40</small>
                </h3>
                <div className="pkg-layer-list">
                    {props.document.artworks.toReversed().map((a) => (
                        <div className={`pkg-layer-row ${props.selectedArtwork === a.id ? "is-selected" : ""}`} key={a.id}>
                            <button type="button" className="pkg-layer-name" aria-pressed={props.selectedArtwork === a.id} onClick={() => props.onSelectArtwork(a.id)}>
                                {a.content?.kind === "text" ? <Type size={15} /> : a.content ? <Shapes size={15} /> : <ImagePlus size={15} />}
                                <span>
                                    <strong>{a.name}</strong>
                                    <small>{packagingRoleNames[a.role]}</small>
                                </span>
                            </button>
                            <button
                                type="button"
                                className="pkg-icon"
                                aria-label={`${a.visible === false ? "显示" : "隐藏"}${a.name}`}
                                onClick={() => props.onDocument((d) => ({ ...d, artworks: d.artworks.map((v) => (v.id === a.id ? { ...v, visible: a.visible === false } : v)) }))}
                            >
                                {a.visible === false ? <EyeOff size={14} /> : <Eye size={14} />}
                            </button>
                            <button
                                type="button"
                                className="pkg-icon"
                                aria-label={`${a.locked ? "解锁" : "锁定"}${a.name}`}
                                onClick={() => props.onDocument((d) => ({ ...d, artworks: d.artworks.map((v) => (v.id === a.id ? { ...v, locked: !a.locked } : v)) }))}
                            >
                                {a.locked ? <Lock size={14} /> : <Unlock size={14} />}
                            </button>
                        </div>
                    ))}
                </div>
            </section>
            <p className="pkg-help">文字和图形可直接指定工艺。图片工艺使用黑白掩膜：白色生效、黑色无作用。调整尺寸时保持同一面板中的相对排版。</p>
        </aside>
    );
}

export function PackagingLayerInspector(props: Props) {
    const [ratio, setRatio] = useState(true);
    const [target, setTarget] = useState("");
    const a = props.document.artworks.find((v) => v.id === props.selectedArtwork);
    const change = (patch: Partial<PackagingArtwork>, group?: string) => props.onDocument((d) => ({ ...d, artworks: d.artworks.map((v) => (v.id === a!.id ? { ...v, ...patch } : v)) }), group);
    if (!a)
        return (
            <aside className="pkg-inspector">
                <Type size={24} />
                <h3>元素属性</h3>
                <p className="pkg-help">选中图层后，在这里编辑文字、颜色、位置和工艺。</p>
                <div className="pkg-inspector-hint">添加文字 → 选择工艺 → 查看 3D → 交付文件</div>
            </aside>
        );
    const text = a.content?.kind === "text" ? a.content : undefined;
    const shape = a.content?.kind === "shape" ? a.content : undefined;
    const typography = text ? packagingTextLayout(a, measurePackagingText(a)) : undefined;
    const sourcePanel = props.layout.panels.find((p) => p.id === a.panelId);
    const targetPanel = props.layout.panels.find((p) => p.id === target && p.id !== a.panelId);
    const bounds = sourcePanel ? packagingPanelBounds(sourcePanel.points) : props.layout.bounds;
    const move = (direction: number) =>
        props.onDocument((d) => {
            const layers = [...d.artworks],
                index = layers.findIndex((v) => v.id === a.id);
            const target = Math.max(0, Math.min(layers.length - 1, index + direction));
            layers.splice(index, 1);
            layers.splice(target, 0, a);
            return { ...d, artworks: layers };
        });
    return (
        <aside className="pkg-inspector">
            <h3>
                元素属性 <small>{a.content?.kind === "text" ? "文字" : a.content ? "图形" : "图片"}</small>
            </h3>
            <label>
                图层名称
                <input aria-label="图层名称" disabled={a.locked || props.busy} maxLength={200} value={a.name} onChange={(e) => change({ name: e.target.value }, `layer-${a.id}-name`)} />
            </label>
            <fieldset disabled={a.locked || props.busy}>
                {text ? (
                    <>
                        <label>
                            文字内容
                            <textarea
                                aria-label="包装文字内容"
                                rows={3}
                                maxLength={2000}
                                value={text.value}
                                onChange={(e) => {
                                    change({ content: { ...text, fontSize: packagingTextSize(a), value: e.target.value } }, `layer-${a.id}-text`);
                                }}
                            />
                        </label>
                        <div className="pkg-fields">
                            <label>
                                字体
                                <select aria-label="包装文字字体" value={text.font} onChange={(e) => change({ content: { ...text, font: e.target.value as "sans" | "serif" | "mono" } })}>
                                    <option value="sans">黑体 / Sans</option>
                                    <option value="serif">宋体 / Serif</option>
                                    <option value="mono">等宽 / Mono</option>
                                </select>
                            </label>
                            <label>
                                字号 mm
                                <input
                                    aria-label="包装文字字号"
                                    type="number"
                                    min={0.1}
                                    max={2000}
                                    required
                                    step="any"
                                    value={Number(packagingTextSize(a).toFixed(2))}
                                    onChange={(e) => {
                                        if (!e.currentTarget.validity.valid) return;
                                        change({ content: { ...text, fontSize: e.currentTarget.valueAsNumber } }, `layer-${a.id}-size`);
                                    }}
                                />
                            </label>
                        </div>
                        <div className="pkg-fields">
                            <label>
                                行距倍数
                                <input
                                    aria-label="包装文字行距"
                                    type="number"
                                    required
                                    min={1}
                                    max={3}
                                    step="any"
                                    value={text.lineHeight ?? 1.25}
                                    onChange={(e) => {
                                        if (!e.currentTarget.validity.valid) return;
                                        change({ content: { ...text, fontSize: packagingTextSize(a), lineHeight: e.currentTarget.valueAsNumber } }, `layer-${a.id}-leading`);
                                    }}
                                />
                            </label>
                            <label>
                                字距 mm
                                <input
                                    aria-label="包装文字字距"
                                    type="number"
                                    required
                                    min={0}
                                    max={20}
                                    step="any"
                                    value={Number((text.letterSpacing ?? 0).toFixed(3))}
                                    onChange={(e) => {
                                        if (!e.currentTarget.validity.valid) return;
                                        change({ content: { ...text, letterSpacing: e.currentTarget.valueAsNumber } }, `layer-${a.id}-tracking`);
                                    }}
                                />
                            </label>
                        </div>
                        <label className="pkg-check">
                            <input type="checkbox" aria-label="包装文字自动换行" checked={text.wrap === true} onChange={(e) => change({ content: { ...text, fontSize: packagingTextSize(a), wrap: e.target.checked } })} />
                            自动换行
                        </label>
                        <p className={typography!.width! > a.width + 0.01 || typography!.height > a.height + 0.01 ? "pkg-error" : "pkg-help"} role="status">
                            {typography!.lines.length} 行 · 需要 {typography!.width!.toFixed(1)} × {typography!.height.toFixed(1)} mm
                            {typography!.width! > a.width + 0.01 || typography!.height > a.height + 0.01 ? " · 文字溢出" : " · 文本框内完整"}
                        </p>
                        <div className="pkg-toolbar">
                            <button type="button" disabled={typography!.height > 8000} onClick={() => change({ height: Math.max(0.1, typography!.height), content: { ...text, fontSize: packagingTextSize(a) } })}>
                                按文字展开高度
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    let low = 0.1,
                                        high = packagingTextSize(a);
                                    for (let i = 0; i < 16; i++) {
                                        const fontSize = (low + high) / 2;
                                        const candidate = { ...a, content: { ...text, fontSize } };
                                        const measured = packagingTextLayout(candidate, measurePackagingText(candidate));
                                        if (measured.width! <= a.width + 0.001 && measured.height <= a.height + 0.001) low = fontSize;
                                        if (measured.width! > a.width + 0.001 || measured.height > a.height + 0.001) high = fontSize;
                                    }
                                    change({ content: { ...text, fontSize: low } });
                                }}
                            >
                                缩小字号适配
                            </button>
                        </div>
                        <div className="pkg-toolbar">
                            <button type="button" aria-pressed={text.weight === 700} onClick={() => change({ content: { ...text, weight: text.weight === 700 ? 400 : 700 } })}>
                                加粗
                            </button>
                            {(["left", "center", "right"] as const).map((align, i) => (
                                <button type="button" key={align} aria-pressed={text.align === align} onClick={() => change({ content: { ...text, align } })}>
                                    {["左对齐", "居中", "右对齐"][i]}
                                </button>
                            ))}
                        </div>
                    </>
                ) : null}
                {shape ? (
                    <label>
                        形状
                        <select aria-label="包装图形形状" value={shape.shape} onChange={(e) => change({ content: { ...shape, shape: e.target.value as "rectangle" | "ellipse" } })}>
                            <option value="rectangle">矩形</option>
                            <option value="ellipse">椭圆</option>
                        </select>
                    </label>
                ) : null}
                {a.content ? (
                    <label>
                        元素颜色
                        <input aria-label="包装元素颜色" type="color" value={a.content.color} onChange={(e) => change({ content: { ...a.content!, color: e.target.value } }, `layer-${a.id}-color`)} />
                    </label>
                ) : null}
                <label>
                    印刷与工艺
                    <select aria-label="包装图层工艺" value={a.role} onChange={(e) => change({ role: e.target.value as PackagingArtwork["role"] })}>
                        {packagingRoles.map((role) => (
                            <option key={role} value={role}>
                                {packagingRoleNames[role]}
                            </option>
                        ))}
                    </select>
                </label>
                <label>
                    绑定面板
                    <select
                        aria-label="图层绑定面板"
                        value={a.panelId}
                        onChange={(e) => {
                            const panel = props.layout.panels.find((p) => p.id === e.target.value);
                            change({ panelId: e.target.value, ...(panel ? fitPackagingArtwork(a, packagingPanelBounds(panel.points), "contain") : {}) });
                        }}
                    >
                        <option value="">整版</option>
                        {props.layout.panels.map((p) => (
                            <option key={p.id} value={p.id}>
                                {p.name}
                            </option>
                        ))}
                    </select>
                </label>
                <label className="pkg-check">
                    <input type="checkbox" checked={ratio} onChange={(e) => setRatio(e.target.checked)} />
                    保持宽高比例
                </label>
                <div className="pkg-fields">
                    {(["x", "y", "width", "height", "rotation", "opacity"] as const).map((key, i) => (
                        <label key={key}>
                            {["X mm", "Y mm", "宽 mm", "高 mm", "旋转 °", "不透明度"][i]}
                            <input
                                aria-label={`图层${["X", "Y", "宽", "高", "旋转", "透明度"][i]}`}
                                type="number"
                                required
                                step="any"
                                min={key === "opacity" ? 0 : key === "width" || key === "height" ? 0.1 : key === "rotation" ? -360 : -8000}
                                max={key === "opacity" ? 1 : key === "rotation" ? 360 : 8000}
                                value={Number(a[key].toFixed(3))}
                                onChange={(e) => {
                                    if (!e.currentTarget.validity.valid) return;
                                    const value = e.currentTarget.valueAsNumber;
                                    const patch: Partial<PackagingArtwork> = {
                                        [key]: value,
                                        ...(ratio && (key === "width" || key === "height") ? (key === "width" ? { height: (a.height * value) / a.width } : { width: (a.width * value) / a.height }) : {}),
                                    };
                                    if ((patch.width !== undefined && (patch.width < 0.1 || patch.width > 8000)) || (patch.height !== undefined && (patch.height < 0.1 || patch.height > 8000))) return;
                                    change(patch, `layer-${a.id}-${key}`);
                                }}
                            />
                        </label>
                    ))}
                </div>
                <h4>对齐当前面</h4>
                <div className="pkg-alignment-grid">
                    {([0, 0.5, 1] as const).flatMap((y, row) =>
                        ([0, 0.5, 1] as const).map((x, column) => (
                            <button
                                type="button"
                                key={`${x}-${y}`}
                                aria-label={`图层对齐${["上", "中", "下"][row]}${["左", "中", "右"][column]}`}
                                onClick={() => change(alignPackagingLayer(a, { x: bounds.x + 3, y: bounds.y + 3, width: Math.max(0, bounds.width - 6), height: Math.max(0, bounds.height - 6) }, x, y))}
                            >
                                {["↖", "↑", "↗", "←", "·", "→", "↙", "↓", "↘"][row * 3 + column]}
                            </button>
                        )),
                    )}
                </div>
                <p className="pkg-help">按旋转后的外框对齐，距面板外框留 3 mm。异形边与开窗继续核对安全区。</p>
                <div className="pkg-toolbar">
                    {(["contain", "cover", "center"] as const).map((mode, i) => (
                        <button
                            type="button"
                            key={mode}
                            onClick={() => {
                                const panel = props.layout.panels.find((p) => p.id === a.panelId);
                                change(fitPackagingArtwork(a, panel ? packagingPanelBounds(panel.points) : props.layout.bounds, mode));
                            }}
                        >
                            {["等比放入", "铺满面板", "面板居中"][i]}
                        </button>
                    ))}
                </div>
            </fieldset>
            {sourcePanel ? (
                <section className="pkg-copy-panel">
                    <h4>复制到其他面</h4>
                    <select aria-label="复制图层目标面" value={target} onChange={(e) => setTarget(e.target.value)}>
                        <option value="">选择目标面</option>
                        {props.layout.panels
                            .filter((p) => p.id !== a.panelId)
                            .map((p) => (
                                <option key={p.id} value={p.id}>
                                    {p.name} · {p.id}
                                </option>
                            ))}
                    </select>
                    <button
                        type="button"
                        disabled={props.busy || !targetPanel || props.document.artworks.length >= 40}
                        onClick={() => {
                            const id = nanoid();
                            props.onDocument((d) => ({ ...d, artworks: [...d.artworks, { ...transferPackagingLayer(a, sourcePanel, targetPanel!), id, name: [...`${a.name} · ${targetPanel!.name}`].slice(0, 200).join(""), locked: false }] }));
                            setTarget("");
                            props.onSelectArtwork(id);
                        }}
                    >
                        复制并保持相对排版
                    </button>
                    <p className="pkg-help">等比缩放到目标面，保持相对中心、字体与工艺。原图层保留。</p>
                </section>
            ) : null}
            {a.locked ? <p className="pkg-help">此图层已锁定，先在图层列表解锁。</p> : null}
            <div className="pkg-toolbar">
                <button
                    type="button"
                    disabled={props.busy || props.document.artworks.length >= 40}
                    onClick={() => {
                        const id = nanoid();
                        props.onDocument((d) => ({ ...d, artworks: [...d.artworks, { ...a, id, name: `${[...a.name].slice(0, 197).join("")} 副本`, locked: false, x: a.x + 3, y: a.y + 3 }] }));
                        props.onSelectArtwork(id);
                    }}
                >
                    <Copy size={14} />
                    复制
                </button>
                <button type="button" disabled={a.locked || props.busy} onClick={() => move(1)}>
                    <ArrowUp size={14} />
                    上移
                </button>
                <button type="button" disabled={a.locked || props.busy} onClick={() => move(-1)}>
                    <ArrowDown size={14} />
                    下移
                </button>
                <button type="button" disabled={a.locked || props.busy} onClick={() => props.onDocument((d) => ({ ...d, artworks: d.artworks.filter((v) => v.id !== a.id) }))}>
                    <Trash2 size={14} />
                    移除
                </button>
            </div>
            <p className="pkg-help">图片工艺按亮度生成掩膜；文字和图形按自身轮廓生成。工艺图层不进入四色彩稿，叠印效果请复制一层设置不同用途。</p>
        </aside>
    );
}
