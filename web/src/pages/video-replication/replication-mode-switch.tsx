import { SegmentedControl } from "@/components/ui/base/segmented-control";

/** 视频复刻的两种做法：爆款复刻（拆解 → 方案 → 画布逐镜重做）和元素替换（把商品、模特、背景直接换进原视频）。 */
export type ReplicationMode = "remake" | "replace";

export function ReplicationModeSwitch({ value, onChange }: { value: ReplicationMode; onChange: (mode: ReplicationMode) => void }) {
    return (
        <SegmentedControl<ReplicationMode>
            ariaLabel="复刻方式"
            value={value}
            onChange={onChange}
            options={[
                { value: "remake", label: "爆款复刻", title: "拆出分镜、口播和节奏，按你的商品写方案，再去画布逐镜生成" },
                { value: "replace", label: "元素替换", title: "沿用原视频的动作和镜头，直接换上你的商品、模特和背景" },
            ]}
        />
    );
}
