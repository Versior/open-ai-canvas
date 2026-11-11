import { useEffect, useState } from "react";
import { Alert, Button, Checkbox, Select } from "antd";
import { Copy } from "lucide-react";
import type { ModelChannel } from "@/stores/use-config-store";
import { listAdminChannelModels, type ChannelModel } from "@/services/api/wallet";
import type { ModelProtocolDefinition } from "@/lib/model-protocols";
import { useAdminContext } from "../admin-context";
import { normalizeUpstreamModelKey } from "./channel-model-price-tier-form";
import "./channel-model-assist.css";

export function ChannelModelCopyPicker({
    mode,
    channel,
    models,
    target,
    capability,
    protocols,
    disabled,
    onApply,
}: {
    mode: "configuration" | "prices";
    channel: ModelChannel;
    models: ChannelModel[];
    target: ChannelModel | null;
    capability: string;
    protocols: ModelProtocolDefinition[];
    disabled: boolean;
    onApply: (source: ChannelModel, copySkuRoutes: boolean) => void;
}) {
    const { references } = useAdminContext();
    const full = mode === "configuration";
    const prefix = full ? "配置" : "价格";
    const title = full ? "复用完整模型配置" : "从现有模型复制价格";
    const [sourceChannel, setSourceChannel] = useState(channel.id);
    const [sources, setSources] = useState(models);
    const [sourceId, setSourceId] = useState<string>();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [attempt, setAttempt] = useState(0);
    const [copySkuRoutes, setCopySkuRoutes] = useState(false);
    useEffect(() => {
        let active = true;
        setSources([]);
        setSourceId(undefined);
        setCopySkuRoutes(false);
        setError("");
        if (sourceChannel === channel.id) {
            setSources(models);
            setLoading(false);
            return;
        }
        setLoading(true);
        void listAdminChannelModels(sourceChannel)
            .then((result) => {
                if (active) setSources(result.models);
            })
            .catch((cause) => {
                if (active) setError(cause instanceof Error ? cause.message : "读取来源模型失败");
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => {
            active = false;
        };
    }, [sourceChannel, channel.id, models, attempt]);
    const source = sources.find((item) => item.id === sourceId);
    const protocol = protocols.find((item) => item.value === source?.protocol && item.capability === source?.capability && item.enabled !== false);
    const routeCount = source?.priceTiers.filter((tier) => tier.providerModelKey && normalizeUpstreamModelKey(tier.providerModelKey) !== normalizeUpstreamModelKey(source.providerModelKey || source.modelKey)).length || 0;
    return (
        <section className="admin-model-assist-card" aria-label={title}>
            <header className="admin-model-assist-heading">
                <Copy size={16} aria-hidden />
                <div>
                    <h2>{title}</h2>
                    <p>{full ? "选择来源，替换当前表单的能力、协议、全部参数、展示资料和定价。" : "选择来源渠道与模型，复制整套售价、成本和规格条件。"}</p>
                </div>
            </header>
            <div className="admin-model-assist-content">
                <div className="admin-model-price-source-fields">
                    <div>
                        <span className="admin-model-assist-label">来源渠道</span>
                        <Select
                            className="admin-model-assist-select"
                            aria-label={`${prefix}来源渠道`}
                            value={sourceChannel}
                            options={[{ value: channel.id, label: channel.name }, ...references.channels.filter((item) => item.id !== channel.id).map((item) => ({ value: item.id, label: item.name }))]}
                            disabled={disabled}
                            onChange={setSourceChannel}
                        />
                    </div>
                    <div>
                        <span className="admin-model-assist-label">来源模型</span>
                        <Select
                            className="admin-model-assist-select"
                            aria-label={`${prefix}来源模型`}
                            showSearch={{ optionFilterProp: "label" }}
                            allowClear
                            placeholder={full ? "搜索已配置模型" : "选择相同能力的现有模型"}
                            notFoundContent="此渠道暂无可复用模型"
                            value={sourceId}
                            loading={loading}
                            disabled={disabled || loading}
                            options={sources
                                .filter((item) => item.id !== target?.id && (full ? Boolean(item.capability && item.protocol) : item.capability === capability))
                                .map((item) => ({ value: item.id, label: `${item.channelLabel || item.providerModelKey || item.modelKey} · ${item.protocol || "未配置协议"} · ${item.priceTiers?.length || 1} 个价格档` }))}
                            onChange={(value) => {
                                setSourceId(value);
                                setCopySkuRoutes(false);
                            }}
                        />
                    </div>
                </div>
                {error ? (
                    <Alert
                        type="error"
                        title="读取来源模型失败"
                        description={error}
                        action={
                            <Button size="small" onClick={() => setAttempt((value) => value + 1)}>
                                重试
                            </Button>
                        }
                    />
                ) : null}
                {source && full ? (
                    <div className="admin-model-copy-preview" role="status">
                        <strong>{source.displayName || source.modelKey} → 当前模型</strong>
                        <p>
                            将替换：{{ text: "文本", image: "图片", video: "视频", audio: "音频", "": "未配置" }[source.capability]}能力 · {protocol?.label || source.protocol} · 引用限制与协议参数 · {source.priceTiers?.length || 1} 个价格档（含成本和
                            Token 规则）· {source.priceCurrency || "credits"} · 参考视频计费 · Logo、分组、标签与描述。
                        </p>
                        <p>目标模型标识、上游 ID、渠道展示名和启停状态保留。点击后仅填写表单，保存后生效。</p>
                        {routeCount ? (
                            <Checkbox checked={copySkuRoutes} disabled={disabled} onChange={(event) => setCopySkuRoutes(event.target.checked)}>
                                同时复用 {routeCount} 个独立上游 SKU（勾选后请求会调用来源 SKU，请确认目标渠道可用）
                            </Checkbox>
                        ) : null}
                        {!protocol ? <Alert type="warning" title="来源协议不可用，请先启用对应协议" /> : null}
                    </div>
                ) : null}
                <footer className="admin-model-assist-footer">
                    <p className="admin-model-assist-note">{full ? "默认让所有价格档调用目标模型。" : "替换当前价格表，保存后生效。"}</p>
                    <Button
                        icon={<Copy size={14} aria-hidden />}
                        disabled={disabled || loading || !source || (full && !protocol)}
                        onClick={() => {
                            if (source) onApply(source, copySkuRoutes);
                        }}
                    >
                        {full ? "复制完整配置到表单" : "复制价格到表单"}
                    </Button>
                </footer>
            </div>
        </section>
    );
}
