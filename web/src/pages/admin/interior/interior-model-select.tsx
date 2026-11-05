import { Select } from "antd";
import { useMemo } from "react";
import type { InteriorModelRef } from "@/services/api/interior";
import { useEffectiveConfig } from "@/stores/use-config-store";
import { interiorImageModelOptions, sameInteriorModel } from "@/pages/interior/interior-models";

function staleValue(ref: InteriorModelRef) {
    return `stale:${ref.logicalModelId || ref.channelId || ""}:${ref.model}`;
}

/** 系统图片模型的选择框。已保存但目录里找不到的模型标成失效，保存前提醒管理员换掉。 */
function useModelOptions(saved: InteriorModelRef[]) {
    const config = useEffectiveConfig();
    return useMemo(() => {
        const options = interiorImageModelOptions(config).map((item) => ({ value: item.value, label: item.ref.label || item.ref.model, ref: item.ref }));
        for (const ref of saved) {
            if (!options.some((option) => sameInteriorModel(option.ref, ref))) options.push({ value: staleValue(ref), label: `${ref.label || ref.model}（已不在模型目录）`, ref });
        }
        return options;
    }, [config, saved]);
}

export function InteriorModelSelect({ value, onChange, placeholder = "不指定" }: { value?: InteriorModelRef; onChange: (value: InteriorModelRef | undefined) => void; placeholder?: string }) {
    const saved = useMemo(() => (value ? [value] : []), [value]);
    const options = useModelOptions(saved);
    const selected = value ? options.find((option) => sameInteriorModel(option.ref, value))?.value : undefined;
    return (
        <Select
            allowClear
            showSearch
            optionFilterProp="label"
            value={selected}
            placeholder={placeholder}
            options={options.map(({ value: optionValue, label }) => ({ value: optionValue, label }))}
            onChange={(next?: string) => onChange(next ? options.find((option) => option.value === next)?.ref : undefined)}
        />
    );
}

export function InteriorModelMultiSelect({ value, onChange }: { value: InteriorModelRef[]; onChange: (value: InteriorModelRef[]) => void }) {
    const options = useModelOptions(value);
    const selected = value.map((ref) => options.find((option) => sameInteriorModel(option.ref, ref))?.value).filter((item): item is string => Boolean(item));
    return (
        <Select
            mode="multiple"
            allowClear
            optionFilterProp="label"
            value={selected}
            placeholder="不限制（用户可选全部系统图片模型）"
            options={options.map(({ value: optionValue, label }) => ({ value: optionValue, label }))}
            onChange={(next: string[]) => onChange(next.map((item) => options.find((option) => option.value === item)?.ref).filter((ref): ref is InteriorModelRef => Boolean(ref)))}
        />
    );
}
