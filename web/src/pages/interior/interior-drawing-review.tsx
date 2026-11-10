import { Button, Checkbox, InputNumber, Select } from "antd";
import { useMemo, useState } from "react";
import type { SceneSpec } from "@/lib/interior/scene-spec";
import { compileSceneSpec } from "@/lib/interior/scene-compile";
import { planSvg } from "@/lib/interior/design-plan";

export function InteriorDrawingReview({ spec, referenceUrl, busy, onConfirm }: { spec: SceneSpec; referenceUrl?: string; busy: boolean; onConfirm: (heights: number[], furnishing: "preserve" | "auto") => Promise<void> }) {
    const [heights, setHeights] = useState(spec.floors.map((f) => f.height));
    const [furnishing, setFurnishing] = useState<"preserve" | "auto">("auto");
    const [checked, setChecked] = useState(false);
    const [floor, setFloor] = useState(0);
    const plans = useMemo(() => compileSceneSpec(spec).plans, [spec]);
    const svg = useMemo(() => planSvg(spec, plans[floor], "layout"), [spec, plans, floor]);
    return (
        <div className="itd-drawing-review">
            <header>
                <strong>先核对图纸，再布置装修</strong>
                <p>结构已读出。请检查原图中的总尺寸、房间、门窗、公共空间和层高；确认后才提交下一步模型任务。</p>
            </header>
            {spec.floors.length > 1 ? <Select aria-label="核对图纸楼层" value={floor} options={spec.floors.map((item, index) => ({ value: index, label: item.name }))} onChange={setFloor} /> : null}
            <div className="itd-drawing-review-images">
                {referenceUrl ? <img src={referenceUrl} alt="待核对的原始图纸" /> : null}
                <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`} alt={`${spec.floors[floor].name}读图结构平面预览`} />
            </div>
            <p>
                总开间 {spec.grid?.width ?? "未确认"} m · 总进深 {spec.grid?.depth ?? "未确认"} m · {spec.floors.length} 层 · {spec.floors.reduce((s, f) => s + f.rooms.filter((r) => !r.part).length, 0)} 个空间
            </p>
            <div className="itd-plan-controls">
                {spec.floors.map((floor, i) => (
                    <label key={i}>
                        {floor.name}层高 m{" "}
                        <InputNumber aria-label={`${floor.name}确认层高`} min={2} max={8} step={0.05} value={heights[i]} disabled={busy} onChange={(v) => setHeights((current) => current.map((h, index) => (index === i ? (v ?? h) : h)))} />
                    </label>
                ))}
                <Select
                    aria-label="图纸还原方式"
                    value={furnishing}
                    disabled={busy}
                    options={[
                        { value: "preserve", label: "保留原图布置，不自动补家具" },
                        { value: "auto", label: "保留结构，自动补家具与装修" },
                    ]}
                    onChange={setFurnishing}
                />
            </div>
            <p className="itd-plan-note">公共楼梯、电梯井、管井和露台以读出的空间清单保留。读图阶段未识别的家具无法保证一比一还原；选择保留布置时不会添加不存在的家具。</p>
            <Checkbox checked={checked} disabled={busy} onChange={(e) => setChecked(e.target.checked)}>
                已对照原图核对尺寸、门窗和空间；不确定项已知晓
            </Checkbox>
            <Button type="primary" disabled={!checked || busy} loading={busy} onClick={() => void onConfirm(heights, furnishing)}>
                确认结构并继续建模
            </Button>
        </div>
    );
}
