import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Select } from "antd";
import { ModelLogo } from "@/components/model-logo";
import { consolidateModelPresets, matchingModelPresets, presetApplicationError, presetKey, presetModelIcon, type ModelMetadataCatalog, type ModelMetadataPreset } from "@/lib/model-metadata-presets";

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
    return <section className="space-y-3 rounded-lg border border-border/60 bg-muted/10 p-4" aria-label="模型资料预设">
        <strong className="text-sm">模型参数预设</strong>
        <p className="text-xs text-foreground/60">按模型查看能力与参数，应用后可继续调整，保存后生效。</p>
        {error ? <Alert type="error" title={error} action={<Button size="small" onClick={() => setAttempt((value) => value + 1)}>重试</Button>} /> : <Select
            className="w-full" aria-label="选择模型资料预设" showSearch={{ optionFilterProp: "label" }} allowClear
            placeholder={catalog ? "搜索模型名称或 ID" : "正在加载模型预设…"} loading={!catalog} disabled={disabled || !catalog}
            value={key} options={options} onChange={(value) => { setSelectedKey(value || ""); setApplied(false); }}
        />}
        {catalog && !selected ? <p className="text-xs text-foreground/55">未找到对应模型，可搜索选择参数预设。</p> : null}
        {selected ? <>
            <div className="flex items-center gap-2 text-sm"><ModelLogo icon={presetModelIcon(selected)} /><span>{selected.name}</span></div>
            <dl className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-3">
                <div><dt className="text-foreground/55">模型能力</dt><dd>文本生成</dd></div>
                <div><dt className="text-foreground/55">上下文 Token</dt><dd>{selected.context.toLocaleString()}</dd></div>
                <div><dt className="text-foreground/55">最大输出 Token</dt><dd>{selected.output.toLocaleString()}</dd></div>
                <div><dt className="text-foreground/55">多模态输入</dt><dd>{selected.vision ? "支持（文本、图片）" : "仅声明文本"}</dd></div>
                <div><dt className="text-foreground/55">图片识别</dt><dd>{selected.vision ? "支持" : "未声明支持"}</dd></div>
                <div><dt className="text-foreground/55">推理能力</dt><dd>{selected.reasoning ? "支持" : "未声明支持"}</dd></div>
            </dl>
            <p className="text-xs text-foreground/55">{selected.vision ? "支持图片识别；图片数量最多应用 100 张，未声明时保留现值，未配置则先设 1 张。" : "应用后关闭图片引用。"} 单图大小和其他自定义限制保留。推理能力不自动切换思考开关。</p>
            {applicationError ? <Alert type="warning" title={applicationError} /> : <Button disabled={disabled} onClick={() => { onApply(selected); setApplied(true); }}>{applied ? "已填入，可继续修改" : "应用预设到表单"}</Button>}
        </> : null}
    </section>;
}
