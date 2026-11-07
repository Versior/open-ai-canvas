import { App, Button, Input, InputNumber, Select } from "antd";
import { useMemo, useState } from "react";
import { DEFAULT_RENOVATION, RENOVATION_OPTIONS, planStoneLayout, renovationProblem, stoneLayoutSvg, type RenovationSpec } from "@/lib/interior/renovation";
import { getResourceBlob, resourceFileUrl, resourceStorageKey } from "@/services/api/resources";
import { createZip } from "@/lib/zip";
import { getActiveUserScope } from "@/lib/user-scope";
import { downloadBrowserMedia } from "@/services/browser-download";
import { uploadInteriorImage } from "./interior-composer";

export function InteriorRenovation({ value, disabled, onChange, onCreate, onRender }: { value?: RenovationSpec; disabled: boolean; onChange: (value: RenovationSpec) => void; onCreate: () => void; onRender: (value: RenovationSpec) => void }) {
    const { message } = App.useApp();
    const [uploading, setUploading] = useState(false);
    const spec = value || DEFAULT_RENOVATION;
    const patch = (change: Partial<RenovationSpec>) => onChange({ ...spec, ...change });
    const layout = useMemo(() => {
        try {
            return { result: planStoneLayout(spec), error: "" };
        } catch (error) {
            return { error: error instanceof Error ? error.message : "排板失败" };
        }
    }, [spec]);
    const upload = async (file?: File) => {
        if (!file) return;
        if (!file.type.startsWith("image/") || file.size > 20 * 1024 * 1024) {
            message.error("请选择 20 MB 以内的石材实板照片");
            return;
        }
        setUploading(true);
        const scope = getActiveUserScope();
        try {
            const image = await uploadInteriorImage(file);
            if (getActiveUserScope() !== scope) return;
            patch({ texture: { resourceId: image.resourceId } });
        } catch (error) {
            message.error(error instanceof Error ? error.message : "石材照片上传失败");
        } finally {
            setUploading(false);
        }
    };
    const download = async () => {
        if (!layout.result) return;
        const data = { scheme: spec, ...layout.result };
        const header = "编号,横坐标mm,纵坐标mm,宽mm,高mm,左右镜像,上下镜像";
        const rows = layout.result.pieces.map((p) => [p.id, p.x, p.y, p.width, p.height, p.flipX, p.flipY].join(","));
        let url = "";
        try {
            const files: { name: string; data: BlobPart }[] = [
                { name: "排板.csv", data: `\ufeff${header}\n${rows.join("\n")}` },
                { name: "材料方案与预算.json", data: JSON.stringify(data, null, 2) },
                { name: "复核要求.txt", data: layout.result.warnings.join("\n") },
            ];
            let imageFile: string | undefined;
            if (spec.texture?.resourceId) {
                const image = await getResourceBlob(resourceStorageKey(spec.texture.resourceId));
                if (!image) throw new Error("石材照片读取失败，未完成交付");
                imageFile = `stone.${image.type.includes("jpeg") ? "jpg" : image.type.includes("webp") ? "webp" : "png"}`;
                files.push({ name: imageFile, data: image });
            }
            files.push({ name: "排板.svg", data: stoneLayoutSvg(spec, imageFile) });
            url = URL.createObjectURL(await createZip(files));
            await downloadBrowserMedia({ fileName: "材料排板与预算.zip", url });
        } catch (error) {
            message.error(error instanceof Error ? error.message : "下载失败");
        } finally {
            URL.revokeObjectURL(url);
        }
    };
    return (
        <div className="itd-renovation">
            <header>
                <h2>装修与石材工作台</h2>
                <p>把尺寸、选材、纹理方向和预算放在同一份方案里。排板按输入尺寸计算。</p>
            </header>
            {!value ? (
                <Button type="primary" onClick={onCreate} disabled={disabled}>
                    建立材料方案
                </Button>
            ) : null}
            <div className="itd-renovation-grid">
                <div className="itd-renovation-fields">
                    {(Object.keys(RENOVATION_OPTIONS) as (keyof typeof RENOVATION_OPTIONS)[]).map((key) => (
                        <label key={key} className="itd-field is-block">
                            <span>{{ scope: "设计范围", stage: "装修阶段", material: "材料", finish: "表面工艺", pattern: "铺装方式", lighting: "灯光" }[key]}</span>
                            <Select
                                aria-label={{ scope: "设计范围", stage: "装修阶段", material: "材料", finish: "表面工艺", pattern: "铺装方式", lighting: "灯光" }[key]}
                                value={spec[key]}
                                disabled={disabled || !value}
                                options={Object.entries(RENOVATION_OPTIONS[key]).map(([value, label]) => ({ value, label }))}
                                onChange={(selected) => patch({ [key]: selected })}
                            />
                        </label>
                    ))}
                    {(
                        [
                            { key: "widthMm", label: "设计区域宽 mm", min: 100, max: 30000 },
                            { key: "heightMm", label: "设计区域高 / 长 mm", min: 100, max: 30000 },
                            { key: "slabWidthMm", label: "板材宽 mm", min: 100, max: 30000 },
                            { key: "slabHeightMm", label: "板材高 / 长 mm", min: 100, max: 30000 },
                            { key: "seamMm", label: "拼缝 mm", min: 0, max: 20 },
                            { key: "wastePercent", label: "预留损耗 %", min: 0, max: 50 },
                            { key: "materialPrice", label: "材料单价 元/㎡（0 为待报价）", min: 0, max: 10000000 },
                            { key: "laborPrice", label: "铺装单价 元/㎡（0 为待报价）", min: 0, max: 10000000 },
                            { key: "budget", label: "区域预算 元（0 为未设定）", min: 0, max: 10000000 },
                        ] as const
                    ).map((field) => (
                        <label key={field.key} className="itd-field is-block">
                            <span>{field.label}</span>
                            <InputNumber aria-label={field.label} value={spec[field.key]} min={field.min} max={field.max} disabled={disabled || !value} onChange={(number) => patch({ [field.key]: number ?? 0 })} />
                        </label>
                    ))}
                    <label className="itd-field is-block itd-wide">
                        <span>保留与施工要求</span>
                        <Input.TextArea aria-label="保留与施工要求" maxLength={300} value={spec.preserve} disabled={disabled || !value} onChange={(event) => patch({ preserve: event.target.value })} />
                    </label>
                    <label className="itd-field is-block itd-wide">
                        <span>{uploading ? "上传中…" : "石材实板照片（用于预览与生成参考）"}</span>
                        <input
                            type="file"
                            accept="image/*"
                            aria-label="石材实板照片"
                            disabled={disabled || !value || uploading}
                            onChange={(event) => {
                                void upload(event.target.files?.[0]);
                                event.target.value = "";
                            }}
                        />
                    </label>
                    {spec.texture?.resourceId ? (
                        <Button onClick={() => patch({ texture: undefined })} disabled={disabled}>
                            移除实板照片
                        </Button>
                    ) : null}
                </div>
                <div className="itd-renovation-preview">
                    <svg viewBox={`0 0 ${spec.widthMm} ${spec.heightMm}`} role="img" aria-label="石材分块与对纹预览" className="itd-stone-preview">
                        {layout.result?.pieces.map((piece) => (
                            <g key={piece.id}>
                                {spec.texture?.resourceId ? (
                                    <svg x={piece.x} y={piece.y} width={piece.width} height={piece.height} viewBox={`0 0 ${piece.width} ${piece.height}`} overflow="hidden">
                                        <image
                                            href={resourceFileUrl(spec.texture.resourceId)}
                                            width={spec.slabWidthMm}
                                            height={spec.slabHeightMm}
                                            preserveAspectRatio="none"
                                            transform={`translate(${piece.flipX ? spec.slabWidthMm : 0},${piece.flipY ? spec.slabHeightMm : 0}) scale(${piece.flipX ? -1 : 1},${piece.flipY ? -1 : 1})`}
                                        />
                                    </svg>
                                ) : (
                                    <rect x={piece.x} y={piece.y} width={piece.width} height={piece.height} fill="var(--itd-muted)" />
                                )}
                                <rect x={piece.x} y={piece.y} width={piece.width} height={piece.height} fill="none" stroke="var(--itd-ink-3)" strokeWidth={Math.max(spec.widthMm / 800, 1)} />
                                <text x={piece.x + piece.width / 2} y={piece.y + piece.height / 2} textAnchor="middle" fontSize={Math.min(piece.width / 7, spec.widthMm / 42)} fill="var(--itd-ink)">
                                    {piece.id}
                                </text>
                            </g>
                        ))}
                    </svg>
                    {!spec.texture?.resourceId ? <p>上传已裁正、无透视的整块实板照片后查看纹理。当前仅显示分块，未模拟天然纹理。</p> : null}
                    {layout.error ? <p role="alert">{layout.error}</p> : null}
                    {layout.result ? (
                        <>
                            <div className="itd-material-summary">
                                <strong>
                                    {layout.result.pieces.length} 块 · 净铺装 {layout.result.netArea.toFixed(2)} ㎡
                                </strong>
                                <span>含预留损耗 {layout.result.purchaseArea.toFixed(2)} ㎡</span>
                                <span>
                                    材料：{layout.result.materialCost === null ? "待报价" : `${layout.result.materialCost.toFixed(2)} 元`} · 铺装：{layout.result.laborCost === null ? "待报价" : `${layout.result.laborCost.toFixed(2)} 元`}
                                </span>
                                <span>合计：{layout.result.total === null ? "需补齐单价" : `${layout.result.total.toFixed(2)} 元`}</span>
                            </div>
                            <ul>
                                {layout.result.warnings.map((warning) => (
                                    <li key={warning}>{warning}</li>
                                ))}
                            </ul>
                            <div className="itd-renovation-actions">
                                <Button onClick={() => void download()}>导出排板与预算</Button>
                                <Button type="primary" disabled={!value || disabled || uploading || Boolean(renovationProblem(spec))} onClick={() => onRender(spec)}>
                                    按材料方案出效果图
                                </Button>
                            </div>
                        </>
                    ) : null}
                </div>
            </div>
        </div>
    );
}
