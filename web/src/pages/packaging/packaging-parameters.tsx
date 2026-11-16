import { useState } from "react";
import type { PackagingCatalog, PackagingDocument, PackagingLayout, PackagingParameters } from "@/lib/packaging/types";

type Props = {
    catalog: PackagingCatalog;
    document: PackagingDocument;
    layout?: PackagingLayout;
    onDocument: (update: (document: PackagingDocument) => PackagingDocument, group?: string) => void;
    onTemplate: (id: string) => void;
    onDesign: () => void;
    busy: boolean;
};

export function PackagingParametersPanel(props: Props) {
    const [query, setQuery] = useState("");
    const field = (key: keyof PackagingParameters, label: string, min: number, max: number, step = 0.1) => (
        <label key={key}>
            {label}
            <input
                aria-label={label}
                type="number"
                min={min}
                max={max}
                step={step}
                value={props.document.parameters[key]}
                onChange={(e) => props.onDocument((d) => ({ ...d, parameters: { ...d.parameters, [key]: Number(e.target.value) } }), `parameter-${key}`)}
            />
        </label>
    );
    return (
        <aside className="pkg-parameters">
            <section>
                <h3>结构与盒型</h3>
                <input aria-label="搜索包装盒型" placeholder="搜索盒型" value={query} onChange={(e) => setQuery(e.target.value)} />
                <div className="pkg-template-grid">
                    {props.catalog.templates
                        .filter((t) => `${t.name} ${t.description}`.includes(query))
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
                        aria-label="包装纸材"
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
                    {field("glue", "粘口 / 封边", 2, 80)}
                    {field("tab", "插舌长度", 2, 100)}
                    {field("gap", "套合间隙", 0.1, 10)}
                    {field("bleed", "出血", 0, 20)}
                </div>
                <p className="pkg-help">纸厚进入几何，盒盖与内盒按间隙套合。同一盒型改尺寸时，图层保持面板中的相对位置。</p>
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
                <p className="pkg-help">开窗宽高同时设为 0 可关闭。软袋鼓胀为曲面预览。</p>
            </details>
            <section>
                <h3>
                    设计图层 <small>{props.document.artworks.length} 层</small>
                </h3>
                <button type="button" onClick={props.onDesign}>
                    编辑文字、图形与工艺 →
                </button>
            </section>
            <details>
                <summary>方案备注</summary>
                <textarea aria-label="包装方案备注" rows={4} maxLength={4000} value={props.document.notes} placeholder="材料批次、印刷要求或白样核对记录" onChange={(e) => props.onDocument((d) => ({ ...d, notes: e.target.value }), "notes")} />
            </details>
        </aside>
    );
}
