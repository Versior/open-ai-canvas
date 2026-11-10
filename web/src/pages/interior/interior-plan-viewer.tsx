import { Button, Input, InputNumber, Select } from "antd";
import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { compileSceneSpec } from "@/lib/interior/scene-compile";
import { DESIGN_LAYERS, floorPlanElements, planViewBox, validateDesignPlan, type DesignLayer, type DesignPoint, type InteriorDesignPlan } from "@/lib/interior/design-plan";
import { snap, type SceneSpec } from "@/lib/interior/scene-spec";
import type { SceneEditTarget } from "@/lib/interior/scene-local-edit";
import { newInteriorId } from "./interior-models";

type Props = {
    spec: SceneSpec;
    design: InteriorDesignPlan;
    floor: number;
    onFloorChange: (floor: number) => void;
    disabled: boolean;
    onChange: (plan: InteriorDesignPlan) => void;
    onSelect: (target: SceneEditTarget) => void;
    onMove: (target: SceneEditTarget, point: DesignPoint) => Promise<void>;
    onError: (message: string) => void;
};

export function InteriorPlanViewer({ spec, design, floor, onFloorChange, disabled, onChange, onSelect, onMove, onError }: Props) {
    const [layer, setLayer] = useState<DesignLayer>("layout");
    const [tool, setTool] = useState<"select" | "point" | "line" | "outline">("select");
    const [label, setLabel] = useState("");
    const [height, setHeight] = useState(0);
    const [depth, setDepth] = useState(0.1);
    const [draft, setDraft] = useState<DesignPoint[]>([]);
    const [moving, setMoving] = useState<{ index: number; delta: DesignPoint } | null>(null);
    const svgRef = useRef<SVGSVGElement>(null);
    const drag = useRef<{ index: number; pointer: number; origin: DesignPoint; offset: DesignPoint } | null>(null);
    const model = useMemo(() => compileSceneSpec(spec), [spec]);
    const current = model.plans[Math.min(floor, model.plans.length - 1)];
    useEffect(() => {
        setDraft([]);
        setMoving(null);
        drag.current = null;
    }, [spec, floor]);
    const elements = useMemo(() => floorPlanElements(spec, current, layer, design), [spec, current, layer, design]);
    const pointAt = (event: { clientX: number; clientY: number }): DesignPoint | null => {
        const matrix = svgRef.current?.getScreenCTM();
        if (!matrix) return null;
        const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
        return [snap(point.x), snap(point.y)];
    };
    const commit = (points: DesignPoint[], closed = false) => {
        try {
            const next = { ...design, marks: [...design.marks, { id: newInteriorId(), floor: current.index, layer, label: label.trim() || DESIGN_LAYERS[layer].name, points, height, depth, closed }] };
            validateDesignPlan(next, spec);
            onChange(next);
            setDraft([]);
        } catch (error) {
            onError(error instanceof Error ? error.message : "图层保存失败");
        }
    };
    const finishDrag = async (event: PointerEvent) => {
        const state = drag.current;
        if (!state || state.pointer !== event.pointerId) return;
        const point = pointAt(event);
        drag.current = null;
        setMoving(null);
        if (!point) return;
        const pos: DesignPoint = [snap(point[0] + state.offset[0]), snap(point[1] + state.offset[1])];
        if (Math.hypot(pos[0] - state.origin[0], pos[1] - state.origin[1]) < 0.04) return;
        try {
            await onMove({ kind: "furniture", floor: current.index, index: state.index }, pos);
        } catch (error) {
            onError(error instanceof Error ? error.message : "家具移动未保存");
        }
    };
    const activeMarks = design.marks.filter((m) => m.floor === current.index && m.layer === layer);
    return (
        <div className="itd-plan-viewer">
            <div className="itd-plan-controls">
                <Select
                    aria-label="平面楼层"
                    value={current.index}
                    options={spec.floors.map((f, i) => ({ value: i, label: f.name }))}
                    onChange={(value) => {
                        onFloorChange(value);
                        setDraft([]);
                    }}
                />
                <Select
                    aria-label="设计图层"
                    value={layer}
                    options={Object.entries(DESIGN_LAYERS).map(([value, item]) => ({ value, label: item.name }))}
                    onChange={(value) => {
                        setLayer(value);
                        setTool("select");
                        setDraft([]);
                    }}
                />
                <Select
                    aria-label="平面工具"
                    value={tool}
                    disabled={disabled || layer === "layout"}
                    options={[
                        { value: "select", label: "选择 / 拖动" },
                        { value: "point", label: "添加点位" },
                        { value: "line", label: layer === "demolition" ? "拆改标记" : "绘制路线" },
                        ...(["ceiling", "custom", "flooring"].includes(layer) ? [{ value: "outline", label: "封闭轮廓 / 拉伸" }] : []),
                    ]}
                    onChange={(value) => {
                        setTool(value);
                        setDraft([]);
                    }}
                />
            </div>
            {tool !== "select" ? (
                <div className="itd-plan-controls">
                    <Input aria-label="点位或轮廓名称" placeholder="点位、回路或造型名称" value={label} maxLength={40} onChange={(event) => setLabel(event.target.value)} disabled={disabled} />
                    <InputNumber aria-label="离地高度 m" addonBefore="离地 m" min={0} max={spec.floors[current.index].height} step={0.05} value={height} onChange={(v) => setHeight(v ?? 0)} disabled={disabled} />
                    {tool === "outline" ? <InputNumber aria-label="拉伸厚度 m" addonBefore="厚度 m" min={0.01} max={spec.floors[current.index].height} step={0.05} value={depth} onChange={(v) => setDepth(v ?? 0.1)} disabled={disabled} /> : null}
                    {tool === "line" || tool === "outline" ? (
                        <>
                            <Button disabled={disabled || draft.length < (tool === "outline" ? 3 : 2)} onClick={() => commit(draft, tool === "outline")}>
                                完成{tool === "outline" ? "轮廓" : "路线"}
                            </Button>
                            <Button disabled={!draft.length} onClick={() => setDraft([])}>
                                取消绘制
                            </Button>
                        </>
                    ) : null}
                </div>
            ) : null}
            <svg
                ref={svgRef}
                viewBox={planViewBox(spec, current.index)}
                role="group"
                aria-label={`${current.name} · ${DESIGN_LAYERS[layer].name}平面图`}
                className="itd-plan-canvas"
                onPointerMove={(event) => {
                    const state = drag.current,
                        point = pointAt(event);
                    if (state && point && state.pointer === event.pointerId) setMoving({ index: state.index, delta: [point[0] + state.offset[0] - state.origin[0], point[1] + state.offset[1] - state.origin[1]] });
                }}
                onPointerUp={(event) => void finishDrag(event)}
                onPointerCancel={() => {
                    drag.current = null;
                    setMoving(null);
                }}
                onClick={(event) => {
                    if (disabled || tool === "select") return;
                    const point = pointAt(event);
                    if (!point) return;
                    if (tool === "point") commit([point]);
                    else setDraft((v) => [...v, point]);
                }}
            >
                {elements.map((e, index) =>
                    e.kind === "line" ? (
                        <line key={index} x1={e.a[0]} y1={e.a[1]} x2={e.b[0]} y2={e.b[1]} stroke={e.color} strokeWidth={e.width} pointerEvents="none" />
                    ) : e.kind === "text" ? (
                        <text key={index} x={e.at[0]} y={e.at[1]} fill={e.color} fontSize={e.size} textAnchor="middle" pointerEvents="none">
                            {e.text}
                        </text>
                    ) : (
                        <polygon
                            key={index}
                            points={e.points.map((p) => p.join(",")).join(" ")}
                            fill={e.fill}
                            stroke={e.color}
                            strokeWidth={e.width}
                            className={e.furniture !== undefined ? "itd-plan-furniture" : ""}
                            transform={moving && moving.index === e.furniture ? `translate(${moving.delta.join(" ")})` : undefined}
                            role={e.room ? "button" : undefined}
                            tabIndex={e.room && tool === "select" ? 0 : undefined}
                            aria-label={e.furniture !== undefined ? `选择家具 ${current.furniture.find((f) => f.index === e.furniture)?.type} · ${e.room}` : e.room ? `选择平面房间 ${e.room}` : undefined}
                            onKeyDown={(event) => {
                                if ((event.key === "Enter" || event.key === " ") && e.room && tool === "select" && !disabled) {
                                    event.preventDefault();
                                    onSelect(e.furniture !== undefined ? { kind: "furniture", floor: current.index, index: e.furniture } : { kind: "room", floor: current.index, room: e.room });
                                }
                            }}
                            onPointerDown={(event) => {
                                if (tool !== "select" || disabled) return;
                                if (e.furniture !== undefined) {
                                    const item = current.furniture.find((f) => f.index === e.furniture),
                                        point = pointAt(event);
                                    if (!item || !point) return;
                                    event.stopPropagation();
                                    svgRef.current?.setPointerCapture(event.pointerId);
                                    drag.current = { index: e.furniture, pointer: event.pointerId, origin: [item.x, item.z], offset: [item.x - point[0], item.z - point[1]] };
                                    onSelect({ kind: "furniture", floor: current.index, index: e.furniture });
                                } else if (e.room) onSelect({ kind: "room", floor: current.index, room: e.room });
                            }}
                        />
                    ),
                )}
                {draft.length ? (
                    <>
                        <polyline points={draft.map((p) => p.join(",")).join(" ")} fill="none" stroke={DESIGN_LAYERS[layer].color} strokeWidth={0.04} />
                        {draft.map((p, i) => (
                            <circle key={i} cx={p[0]} cy={p[1]} r={0.06} fill={DESIGN_LAYERS[layer].color} />
                        ))}
                    </>
                ) : null}
            </svg>
            <p className="itd-plan-note">
                {layer === "layout"
                    ? "点房间联动右侧调整；拖动已有家具，松开后校核并保存新版本。自动配置的家具可先通过对话写入方案。"
                    : tool === "outline"
                      ? "依次点击轮廓顶点，再完成轮廓；离地高度与厚度决定三维拉伸。"
                      : tool === "line"
                        ? "逐段点击路径，再完成路线；可用名称标明回路、立管、坡度和待核实项。"
                        : "选择工具后在平面添加标记；图层与原图结构分别保存。"}
            </p>
            {["power", "lighting", "network", "water", "drain", "demolition"].includes(layer) ? <p className="itd-plan-note">管线与拆改为方案辅助标记。电气负荷、强弱电间距、排水坡度、立管和承重属性须由现场资料与专业人员确认。</p> : null}
            {activeMarks.length ? (
                <div className="itd-plan-marks">
                    {activeMarks.map((mark) => (
                        <div key={mark.id}>
                            <span>
                                {mark.label} · {mark.closed ? "封闭造型" : mark.points.length === 1 ? "点位" : `${mark.points.length - 1} 段`} · 离地 {mark.height} m
                            </span>
                            <Button size="small" disabled={disabled} onClick={() => onChange({ ...design, marks: design.marks.filter((m) => m.id !== mark.id) })}>
                                移除标记
                            </Button>
                        </div>
                    ))}
                </div>
            ) : null}
        </div>
    );
}
