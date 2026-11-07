import { Button, Input, InputNumber, Select } from "antd";
import { Save, SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import type { SceneEditTarget } from "@/lib/interior/scene-local-edit";
import { SCENE_MATERIALS } from "@/lib/interior/scene-3d";
import { FLOOR_FINISHES, FURNITURE_TYPES, type InteriorSceneData } from "@/lib/interior/scene-spec";

export function InteriorLocalControls({ scene, target, disabled, onApply }: { scene: InteriorSceneData; target: SceneEditTarget; disabled: boolean; onApply: (patch: Record<string, unknown>) => Promise<void> }) {
    const [values, setValues] = useState<Record<string, string | number | null>>({});
    const [error, setError] = useState("");
    const item = scene.version === 1 && target.kind === "object" ? scene.objects[target.index] : scene.version === 2 && target.kind === "furniture" ? scene.spec.floors[target.floor].furniture[target.index] : undefined;
    const legacy = scene.version === 1;
    const position = item && "position" in item ? item.position : item && "pos" in item ? item.pos : undefined;
    const size = item?.size;
    const patchValue = (key: string, value: string | number | null) => {
        setError("");
        setValues((current) => ({ ...current, [key]: value }));
    };
    const field = (key: string, label: string, current: number | undefined, min = -60, max = 60) => (
        <label className="itd-field" key={key}>
            <span className="itd-field-label">{label}</span>
            <InputNumber
                aria-label={label}
                value={Object.hasOwn(values, key) ? (values[key] as number | null) : current}
                min={min}
                max={max}
                step={key === "yaw" ? (legacy ? 15 : 90) : 0.05}
                disabled={disabled}
                onChange={(value) => patchValue(key, value)}
                placeholder="未指定"
            />
        </label>
    );
    const apply = async () => {
        try {
            if (Object.values(values).some((value) => value === null || value === "")) throw new Error("请补齐修改字段，或切换目标后重新填写");
            const patch: Record<string, unknown> = {};
            for (const key of ["color", "type", "floor", "material"]) if (values[key] !== undefined) patch[key] = values[key];
            if (["x", "y", "z"].some((key) => Object.hasOwn(values, key))) {
                const x = values.x ?? position?.[0],
                    z = values.z ?? position?.[legacy ? 2 : 1];
                if (x === undefined || z === undefined) throw new Error("此家具的位置由布局自动确定，手动移动时请同时填写 X 和 Z");
                patch[legacy ? "position" : "pos"] = legacy ? [x, values.y ?? position?.[1], z] : [x, z];
            }
            if (["width", "height", "depth"].some((key) => Object.hasOwn(values, key))) {
                const width = values.width ?? size?.[0],
                    depth = values.depth ?? size?.[legacy ? 2 : 1];
                if (width === undefined || depth === undefined || (legacy && values.height === undefined && size?.[1] === undefined)) throw new Error("请完整填写目标的宽、高、深尺寸");
                patch.size = legacy ? [width, values.height ?? size?.[1], depth] : [width, depth];
            }
            if (values.yaw !== undefined) {
                if (legacy) patch.rotation = [item && "rotation" in item ? item.rotation?.[0] || 0 : 0, values.yaw, item && "rotation" in item ? item.rotation?.[2] || 0 : 0];
                else {
                    patch.rotate = values.yaw;
                    patch.facing = undefined;
                }
            }
            await onApply(patch);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "局部调整失败");
        }
    };
    return (
        <section className="itd-local-controls" aria-label="手动局部调整">
            <h3>
                <SlidersHorizontal aria-hidden className="size-4" /> 手动调整 <small>不调用模型，保存为新版本</small>
            </h3>
            <div className="itd-local-fields">
                {target.kind === "room" ? (
                    <label className="itd-field">
                        <span className="itd-field-label">地面材料</span>
                        <Select
                            aria-label="地面材料"
                            value={values.floor ?? (scene.version === 2 && target.kind === "room" ? scene.spec.floors[target.floor].rooms.find((room) => room.name === target.room)?.floor : undefined)}
                            placeholder="选择地面材料"
                            disabled={disabled}
                            options={FLOOR_FINISHES.map((value) => ({ value, label: ({ wood: "木地板", tile: "瓷砖", marble: "大理石", stone: "石材", carpet: "地毯", concrete: "混凝土" } as Record<string, string>)[value] || value }))}
                            onChange={(value) => patchValue("floor", value)}
                        />
                    </label>
                ) : (
                    <>
                        {!legacy && item && "type" in item ? (
                            <label className="itd-field">
                                <span className="itd-field-label">家具类型</span>
                                <Select
                                    aria-label="家具类型"
                                    value={values.type ?? item.type}
                                    disabled={disabled}
                                    options={Object.entries(FURNITURE_TYPES).map(([value, info]) => ({ value, label: info.name }))}
                                    onChange={(value) => patchValue("type", value)}
                                />
                            </label>
                        ) : null}
                        {legacy ? (
                            <label className="itd-field">
                                <span className="itd-field-label">材质</span>
                                <Select
                                    aria-label="物体材质"
                                    value={values.material ?? (item && "material" in item ? item.material : undefined)}
                                    disabled={disabled}
                                    options={SCENE_MATERIALS.map((value) => ({
                                        value,
                                        label: {
                                            wall: "墙面",
                                            concrete: "混凝土",
                                            brick: "砖",
                                            stone: "石材",
                                            marble: "大理石",
                                            tile: "瓷砖",
                                            wood: "原木",
                                            "wood-dark": "深色木材",
                                            glass: "玻璃",
                                            metal: "金属",
                                            "metal-dark": "深色金属",
                                            roof: "屋面",
                                            fabric: "布料",
                                            leather: "皮革",
                                            grass: "草地",
                                            soil: "土壤",
                                            water: "水",
                                            plant: "植物",
                                            light: "发光",
                                            ceramic: "陶瓷",
                                        }[value],
                                    }))}
                                    onChange={(value) => patchValue("material", value)}
                                />
                            </label>
                        ) : null}
                        <label className="itd-field">
                            <span className="itd-field-label">颜色</span>
                            <Input aria-label="目标颜色" value={values.color ?? item?.color ?? ""} placeholder="#RRGGBB" maxLength={7} disabled={disabled} onChange={(event) => patchValue("color", event.target.value)} />
                        </label>
                        {!legacy || position ? (
                            <>
                                {field("x", "X 位置（米）", position?.[0])}
                                {field("z", "Z 位置（米）", position?.[legacy ? 2 : 1])}
                                {legacy ? field("y", "Y 高度（米）", position?.[1]) : null}
                            </>
                        ) : null}
                        {!legacy || size ? (
                            <>
                                {field("width", "宽度（米）", size?.[0], legacy ? 0.1 : 0.3, legacy ? 60 : 6)}
                                {field("depth", "深度（米）", size?.[legacy ? 2 : 1], legacy ? 0.1 : 0.3, legacy ? 60 : 6)}
                                {legacy ? field("height", "高度（米）", size?.[1], 0.1) : null}
                            </>
                        ) : null}
                        {field("yaw", "旋转（度）", item && "rotate" in item ? item.rotate : item && "rotation" in item ? item.rotation?.[1] : undefined, -360, 360)}
                    </>
                )}
            </div>
            {error ? (
                <p className="itd-inline-error" role="alert">
                    {error}
                </p>
            ) : null}
            <Button icon={<Save className="size-4" />} disabled={disabled || !Object.keys(values).length} onClick={() => void apply()}>
                应用并保存新版本
            </Button>
            {target.kind === "room" ? <p className="itd-muted-note">布局和自动配置的家具可通过上方对话调整。房间边界、墙体及其他房间会保留。</p> : null}
            {!legacy && target.kind === "furniture" ? <p className="itd-muted-note">位置按 5 厘米网格保存，旋转每次 90 度；靠墙家具会自动贴墙。请核对三维预览中的实际摆放。</p> : null}
        </section>
    );
}
