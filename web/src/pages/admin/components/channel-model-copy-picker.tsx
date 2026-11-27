import { useEffect, useState } from "react";
import { Alert, Button, Form, Select, type FormInstance } from "antd";
import { ArrowRight, Copy } from "lucide-react";
import type { ModelChannel } from "@/stores/use-config-store";
import { listAdminChannelModels, type ChannelModel } from "@/services/api/wallet";
import type { ModelProtocolDefinition } from "@/lib/model-protocols";
import { priceCurrencyUnit } from "@/services/api/user-groups";
import { formatModelPrice } from "./channel-model-pricing";
import { useAdminContext } from "../admin-context";
import { copyChannelModelPrices, modelCopyPriceCount, modelCopySourceInfo, type ChannelModelFormValues } from "./channel-model-editor-form";
import "./channel-model-assist.css";

function ModelCopyPreview({ source, targetKey, upstream, protocols, importing }: { source: ChannelModel; targetKey: string; upstream: string; protocols: ModelProtocolDefinition[]; importing: boolean }) {
    const { family, protocol, issue } = modelCopySourceInfo(source, protocols);
    const version = protocol?.version;
    const image = source.capabilityConfig?.image;
    const tiers = source.priceTiers || [];
    const defaultTier = tiers.find((t) => !Object.keys(t.selector || {}).length && (!t.resolution || t.resolution === "*"));
    const defaultPrice = tiers.length ? defaultTier : source;
    const count = modelCopyPriceCount(source);
    const currency = priceCurrencyUnit(source.priceCurrency);
    return (
        <section className="admin-model-copy-preview" aria-label="复制预览">
            {!importing && (
                <div className="admin-model-copy-route" aria-live="polite">
                    <div>
                        <small>读取配置</small>
                        <strong>{source.modelKey}</strong>
                    </div>
                    <ArrowRight size={17} aria-hidden />
                    <div>
                        <small>写入配置</small>
                        <strong>{targetKey || "待填写目标标识"}</strong>
                    </div>
                </div>
            )}
            <dl className="admin-model-copy-facts">
                <div>
                    <dt>调用协议</dt>
                    <dd>{family?.label || source.protocol || "未配置"}</dd>
                    <small>{source.protocolRelease ? (version ? `固定发行版 v${version}` : "绑定发行版不可用") : version ? `未固定 · 跟随当前 v${version}` : "未指定发行版"}</small>
                </div>
                <div>
                    <dt>模型能力</dt>
                    <dd>{{ image: "图片生成", video: "视频生成", text: "文本生成", audio: "音频生成", "": "未配置" }[source.capability]}</dd>
                    <small>{source.capability === "image" && image ? `最多输出 ${image.maxOutputs} 张 · 参考图 ${image.references.maxImages} 张` : "参数、输入限制与素材传输"}</small>
                </div>
                <div>
                    <dt>价格与成本</dt>
                    <dd>{count ? `${count} 个价格档 · ${currency}` : "未配置价格"}</dd>
                    {count > 0 && <small>{defaultPrice?.priceConfigured && defaultPrice.billingMode === "fixed_request" ? `默认售价 ${formatModelPrice(defaultPrice.unitPriceMicrocredits)} ${currency} / 次` : "含规格条件及计费规则"}</small>}
                    {defaultTier?.billingMode === "fixed_request" && defaultTier.costPricing?.configured && <small>成本 {formatModelPrice(defaultTier.costPricing.unitPriceMicrocredits)} 积分 / 次</small>}
                </div>
            </dl>
            {(!importing || upstream !== targetKey) && (
                <p>
                    目标默认请求上游：<b>{upstream || "待填写"}</b>。不复制来源的上游 ID 或展示资料。
                </p>
            )}
            {issue && <Alert type="warning" title={issue} />}
        </section>
    );
}

type PriceCopyAction = { mode: "prices"; form: FormInstance<ChannelModelFormValues>; onApply: (next: ChannelModelFormValues) => void };

function PriceCopyFooter({ action, source, protocols, disabled }: { action: PriceCopyAction; source?: ChannelModel; protocols: ModelProtocolDefinition[]; disabled: boolean }) {
    Form.useWatch([], { form: action.form, preserve: true });
    const current: ChannelModelFormValues = action.form.getFieldsValue(true);
    let next: ChannelModelFormValues | undefined;
    let issue = "";
    if (source) {
        try {
            next = copyChannelModelPrices(current, source, protocols);
        } catch (error) {
            issue = error instanceof Error ? error.message : "无法复制价格";
        }
    }
    return (
        <footer className="admin-model-assist-footer">
            {next && (
                <p className="admin-model-assist-note" role="status" aria-label="价格复制预览">
                    {next.priceTiers.length} 个价格档 · {current.priceCurrency !== next.priceCurrency && `${priceCurrencyUnit(current.priceCurrency)} → `}
                    {priceCurrencyUnit(next.priceCurrency)}
                    {next.capability === "video" && ` · 参考视频${next.referenceVideoBilling ? "单独计费" : "不计费"}`}
                </p>
            )}
            {issue && <Alert type="warning" title={issue} />}
            <Button icon={<Copy size={14} aria-hidden />} disabled={disabled || !next} onClick={() => next && action.onApply(next)}>
                复制价格到表单
            </Button>
        </footer>
    );
}

type CopyPickerProps = {
    channel: ModelChannel;
    models: ChannelModel[];
    target: ChannelModel | null;
    targetKey?: string;
    upstream?: string;
    capability?: string;
    protocols: ModelProtocolDefinition[];
    disabled: boolean;
    onCancel?: () => void;
} & (PriceCopyAction | { mode: "configuration" | "import"; onApply: (source: ChannelModel) => void });

export function ChannelModelCopyPicker(props: CopyPickerProps) {
    const { mode, channel, models, target, targetKey = target?.modelKey || "", upstream = target?.providerModelKey || targetKey, capability, protocols, disabled, onCancel } = props;
    const { references } = useAdminContext();
    const full = mode !== "prices";
    const importing = mode === "import";
    const prefix = full ? "配置" : "价格";
    const title = full ? "从已有模型复制配置" : "从现有模型复制价格";
    const [sourceChannel, setSourceChannel] = useState(channel.id);
    const [sources, setSources] = useState(models);
    const [sourceId, setSourceId] = useState<string>();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [attempt, setAttempt] = useState(0);
    useEffect(() => {
        let active = true;
        setSources([]);
        setSourceId(undefined);
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
    const candidates = sources.filter((item) => item.channelId === sourceChannel && item.id !== target?.id && (full || item.capability === capability));
    const source = candidates.find((item) => item.id === sourceId);
    const copyBlocked = full && source && Boolean(modelCopySourceInfo(source, protocols).issue);
    return (
        <section className={importing ? "admin-model-import" : "admin-model-assist-card"} aria-label={title}>
            {!importing && (
                <header className="admin-model-assist-heading">
                    <Copy size={16} aria-hidden />
                    <div>
                        <h2>{title}</h2>
                        <p>{full ? "只复制调用协议、模型能力、价格与成本。型号和展示资料不变。" : "选择来源渠道与模型，复制整套售价、成本和规格条件。"}</p>
                    </div>
                </header>
            )}
            <div className="admin-model-assist-content">
                <div className={importing ? "admin-model-import-source" : "admin-model-price-source-fields"}>
                    {!importing && (
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
                    )}
                    <div>
                        <span className="admin-model-assist-label">来源模型</span>
                        <Select
                            className="admin-model-assist-select"
                            aria-label={`${prefix}来源模型`}
                            showSearch={{ optionFilterProp: "label" }}
                            allowClear
                            placeholder={full ? "选择提供配置的已有模型" : "选择相同能力的现有模型"}
                            notFoundContent="此渠道暂无可复用模型"
                            value={sourceId}
                            loading={loading}
                            disabled={disabled || loading}
                            options={candidates.map((item) => {
                                const label = item.channelLabel || item.providerModelKey || item.modelKey;
                                const count = modelCopyPriceCount(item);
                                return { value: item.id, label: importing ? item.modelKey : `${label}${label === item.modelKey ? "" : `（${item.modelKey}）`} · ${item.protocol || "未配置协议"} · ${count ? `${count} 个价格档` : "未配置价格"}` };
                            })}
                            onChange={setSourceId}
                        />
                    </div>
                    {importing && (
                        <>
                            <ArrowRight size={16} aria-hidden className="admin-model-import-arrow" />
                            <div className="admin-model-transfer-target">
                                <span className="admin-model-assist-label">目标模型 · {channel.name}</span>
                                <strong>{targetKey}</strong>
                            </div>
                        </>
                    )}
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
                {source && full ? <ModelCopyPreview source={source} targetKey={targetKey} upstream={upstream} protocols={protocols} importing={importing} /> : null}
                {props.mode === "prices" ? (
                    <PriceCopyFooter action={props} source={source} protocols={protocols} disabled={disabled || loading} />
                ) : (
                    <footer className="admin-model-assist-footer">
                        <p className="admin-model-assist-note">{importing ? "型号与启停不变，保存后生效。" : "只填写草稿，保存后生效。"}</p>
                        {onCancel && <Button onClick={onCancel}>取消</Button>}
                        <Button
                            type={importing ? "primary" : "default"}
                            icon={<Copy size={14} aria-hidden />}
                            disabled={disabled || loading || !source || copyBlocked}
                            onClick={() => {
                                if (source) props.onApply(source);
                            }}
                        >
                            {importing ? "填入目标模型" : "复制完整配置到表单"}
                        </Button>
                    </footer>
                )}
            </div>
        </section>
    );
}
