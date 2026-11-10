import { InputNumber } from "antd";
import { useMemo } from "react";
import { designQuantities, type InteriorDesignPlan, type DesignPrice } from "@/lib/interior/design-plan";
import type { SceneSpec } from "@/lib/interior/scene-spec";

export function InteriorDesignBudget({ spec, design, disabled, onChange }: { spec: SceneSpec; design: InteriorDesignPlan; disabled: boolean; onChange: (plan: InteriorDesignPlan) => void }) {
    const rows = useMemo(() => designQuantities(spec, design), [spec, design]);
    const unknown = rows.filter((r) => r.total === null).length;
    const known = rows.reduce((s, r) => s + (r.total ?? 0), 0);
    const patch = (key: string, change: Partial<DesignPrice>) => onChange({ ...design, prices: { ...design.prices, [key]: { ...(design.prices[key] || { material: null, labor: null, waste: 0 }), ...change } } });
    return (
        <details className="itd-scene-delivery">
            <summary>
                整套方案算量与预算 · {rows.length} 项 · {unknown ? `${unknown} 项待报价` : `合计 ${known.toFixed(2)} 元`}
            </summary>
            <div className="itd-scene-delivery-body">
                <p>工程量来自同一份模型：地面扣墙体、柱子和楼梯洞，墙面扣门窗，顶面按投影计算；家具按实际摆放数量，管线按人工绘制长度。未填写单价的项目保留待报价。</p>
                <label>
                    总预算（元）
                    <InputNumber aria-label="整套方案总预算" min={0} max={100000000} value={design.budget} placeholder="未设定" disabled={disabled} onChange={(budget) => onChange({ ...design, budget })} />
                </label>
                <div className="itd-budget-scroll">
                    <table>
                        <thead>
                            <tr>
                                <th>项目</th>
                                <th>工程量</th>
                                <th>损耗 %</th>
                                <th>材料单价</th>
                                <th>人工单价</th>
                                <th>金额</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((r) => (
                                <tr key={r.key}>
                                    <td>{r.name}</td>
                                    <td>
                                        {r.quantity} {r.unit}
                                    </td>
                                    <td>
                                        <InputNumber aria-label={`${r.name}损耗`} min={0} max={50} value={design.prices[r.key]?.waste ?? 0} disabled={disabled} onChange={(waste) => patch(r.key, { waste: waste ?? 0 })} />
                                    </td>
                                    <td>
                                        <InputNumber aria-label={`${r.name}材料单价`} min={0} max={100000000} value={r.material} placeholder="待报价" disabled={disabled} onChange={(material) => patch(r.key, { material })} />
                                    </td>
                                    <td>
                                        <InputNumber aria-label={`${r.name}人工单价`} min={0} max={100000000} value={r.labor} placeholder="待报价" disabled={disabled} onChange={(labor) => patch(r.key, { labor })} />
                                    </td>
                                    <td>{r.total === null ? "待报价" : `${r.total.toFixed(2)} 元`}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <strong>
                    {unknown ? "已报价小计" : "合计"}：{known.toFixed(2)} 元{unknown ? ` · 尚有 ${unknown} 项未报价` : ""}
                </strong>
                {design.budget !== null ? <p>{unknown ? "报价未齐，暂不能判断是否超预算。" : known > design.budget ? `超过预算 ${(known - design.budget).toFixed(2)} 元` : `预算余量 ${(design.budget - known).toFixed(2)} 元`}</p> : null}
            </div>
        </details>
    );
}
