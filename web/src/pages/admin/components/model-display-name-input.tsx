import { useMemo, useState } from "react";
import { AutoComplete, type AutoCompleteProps } from "antd";
import { useAdminContext } from "../admin-context";

/** 单模型与批量编辑共用系统渠道的一级目录名称。 */
export function ModelDisplayNameInput({ onSearch, onFocus, onOpenChange, placeholder = "选择分组或输入名称；留空使用完整型号", ...props }: Omit<AutoCompleteProps, "options" | "filterOption">) {
    const { references } = useAdminContext();
    const [search, setSearch] = useState("");
    const options = useMemo(
        () => [...new Set(references.channels.flatMap((item) => item.modelDisplayNames ?? []).filter((name) => name.trim() && name.trim() !== "未分类"))].sort((a, b) => a.localeCompare(b, "zh-CN")).map((value) => ({ value })),
        [references.channels],
    );
    return (
        <AutoComplete
            {...props}
            options={options}
            filterOption={(_, option) => Boolean(option?.value.toLowerCase().includes(search.trim().toLowerCase()))}
            onSearch={(value) => {
                setSearch(value);
                onSearch?.(value);
            }}
            onFocus={(event) => {
                setSearch("");
                onFocus?.(event);
            }}
            onOpenChange={(open) => {
                if (open) setSearch("");
                onOpenChange?.(open);
            }}
            placeholder={placeholder}
            allowClear
        />
    );
}
