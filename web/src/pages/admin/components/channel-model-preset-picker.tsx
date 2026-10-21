import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Select } from "antd";
import { ModelLogo } from "@/components/model-logo";
import { Check, SlidersHorizontal } from "lucide-react";
import { consolidateModelPresets, matchingModelPresets, presetApplicationError, presetKey, presetModelIcon, type ModelMetadataCatalog, type ModelMetadataPreset } from "@/lib/model-metadata-presets";
import "./channel-model-assist.css";

export function ChannelModelPresetPicker({ modelId, capability, disabled, onApply }: { modelId: string; capability: string; disabled: boolean; onApply: (preset: ModelMetadataPreset) => void }) {
    const [catalog, setCatalog] = useState<ModelMetadataCatalog>();
    const [error, setError] = useState("");
    const [attempt, setAttempt] = useState(0);
    const [selectedKey, setSelectedKey] = useState<string>();
    const [applied, setApplied] = useState(false);
    useEffect(() => {
        let active = true;
        setError("");
        void import("@/lib/data/model-metadata-presets.json").then((data) => { if (active) setCatalog(data.default); }).catch(() => { if (active) setError("模型预设加载失败，请重试。"); });
        return () => { active = false; };
    }, [attempt]);
    useEffect(() => { setSelectedKey(undefined); setApplied(false); }, [modelId, capability]);
    const models = useMemo(() => consolidateModelPresets(catalog?.models || []), [catalog]);
    const matches = useMemo(() => matchingModelPresets(models, modelId), [models, modelId]);
    const key = selectedKey ?? (matches.length === 1 ? presetKey(matches[0]) : undefined);
    const selected = models.find((preset) => presetKey(preset) === key);
    const applicationError = selected ? presetApplicationError(selected, capability) : "";
    const options = useMemo(() => {
        const exact = new Set(matches.map(presetKey));
        return [...models].sort((a, b) => Number(exact.has(presetKey(b))) - Number(exact.has(presetKey(a)))).map((preset) => ({ value: presetKey(preset), label: `${preset.name} · ${preset.id}` }));
    }, [models, matches]);
    return <section className="admin-model-assist-card" aria-label="模型资料预设">
        <header className="admin-model-assist-heading">
            <SlidersHorizontal size={16} aria-hidden />
            <div><h2>模型参数预设</h2><p>选择模型，填入能力与参数，保存后生效。</p></div>
        </header>
        <div className="admin-model-assist-content">
        {error ? <Alert type="error" title={error} action={<Button size="small" onClick={() => setAttempt((value) => value + 1)}>重试</Button>} /> : <Select
            className="admin-model-assist-select" aria-label="选择模型资料预设" showSearch={{ optionFilterProp: "label" }} allowClear
            placeholder={catalog ? "搜索模型名称或 ID" : "正在加载模型预设…"} loading={!catalog} disabled={disabled || !catalog}
            value={key} options={options} onChange={(value) => { setSelectedKey(value || ""); setApplied(false); }}
        />}
        {catalog && !selected ? <p className="admin-model-assist-note">未找到对应模型，可搜索选择参数预设。</p> : null}
        {selected ? <>
            <div className="admin-model-preset-summary">
                <div className="admin-model-preset-identity"><span className="admin-model-preset-logo"><ModelLogo icon={presetModelIcon(selected)} size={24} /></span><div><strong>{selected.name}</strong><span>模型能力 · 文本生成</span></div></div>
                <dl className="admin-model-preset-metrics">
                    <div><dt>上下文 Token</dt><dd>{selected.context.toLocaleString()}</dd></div>
                    <div><dt>最大输出 Token</dt><dd>{selected.output.toLocaleString()}</dd></div>
                </dl>
            </div>
            <dl className="admin-model-preset-capabilities">
                <div><dt>多模态输入</dt><dd>{selected.vision ? "文本、图片" : "仅声明文本"}</dd></div>
                <div><dt>图片识别</dt><dd>{selected.vision ? "支持" : "未声明支持"}</dd></div>
                <div><dt>推理能力</dt><dd>{selected.reasoning ? "支持" : "未声明支持"}</dd></div>
            </dl>
            {applicationError ? <Alert type="warning" title={applicationError} /> : null}
            <footer className="admin-model-assist-footer">
                <details className="admin-model-preset-help"><summary>应用范围</summary><p>{selected.vision ? "支持图片识别；图片数量最多应用 100 张，未声明时保留现值，未配置则先设 1 张。" : "应用后关闭图片引用。"} 单图大小和其他自定义限制保留。推理能力不自动切换思考开关。</p></details>
                {!applicationError ? <Button disabled={disabled} icon={applied ? <Check size={14} aria-hidden /> : undefined} onClick={() => { onApply(selected); setApplied(true); }}>{applied ? "已填入，可继续修改" : "应用预设到表单"}</Button> : null}
            </footer>
        </> : null}
        </div>
    </section>;
}
