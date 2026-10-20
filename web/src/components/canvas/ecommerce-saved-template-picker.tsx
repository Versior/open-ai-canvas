import { Button, Select } from "antd";
import { useEffect, useState } from "react";
import { useEcommerceTemplateLibrary } from "@/stores/use-ecommerce-template-library";
import { useEcommerceSettings } from "@/stores/use-ecommerce-settings";
import type { EcommerceSuiteTemplate } from "@/services/api/ecommerce";

export function EcommerceSavedTemplatePicker({ disabled, onApply }: { disabled?: boolean; onApply: (template: EcommerceSuiteTemplate) => void }) {
    const templates = useEcommerceTemplateLibrary((state) => state.templates);
    const scope = useEcommerceTemplateLibrary((state) => state.scope);
    const published = useEcommerceSettings((state) => state.setting.templates);
    const [error, setError] = useState("");
    const [retry, setRetry] = useState(0);
    useEffect(() => {
        let active = true;
        setError("");
        void Promise.all([useEcommerceTemplateLibrary.getState().hydrate(), useEcommerceSettings.getState().load()]).catch((error) => {
            if (active) setError(error instanceof Error ? error.message : "模板读取失败");
        });
        return () => {
            active = false;
        };
    }, [scope, retry]);
    const groups = [
        { label: "后台发布", options: published.filter((template) => template.enabled).map((template) => ({ value: "public:" + template.id, label: template.name, template })) },
        { label: "我的模板 · 当前浏览器", options: templates.filter((template) => template.enabled).map((template) => ({ value: "private:" + template.id, label: template.name, template })) },
    ];
    return (
        <div className="ecommerce-saved-template-picker">
            <label>
                已保存的模板
                <Select
                    aria-label="选择已保存的电商模板"
                    style={{ width: "100%" }}
                    disabled={disabled}
                    value={null}
                    placeholder="选择后台模板或我的模板"
                    showSearch
                    optionFilterProp="label"
                    options={groups}
                    onChange={(value) => {
                        const selected = groups.flatMap((group) => group.options).find((item) => item.value === value);
                        if (selected && !disabled) onApply(structuredClone(selected.template));
                    }}
                />
            </label>
            {error ? (
                <p role="alert">
                    {error}
                    <Button size="small" onClick={() => setRetry((value) => value + 1)}>
                        重新读取已保存模板
                    </Button>
                </p>
            ) : null}
        </div>
    );
}
