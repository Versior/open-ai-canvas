import { useEffect, useRef, useState } from "react";
import { canonicalize } from "json-canonicalize";
import { Alert, App, AutoComplete, Button, Form, Input, Segmented, Switch, Tabs } from "antd";
import { useAdminContext } from "../admin-context";
import { ModelDisplayNameInput } from "./model-display-name-input";
import { AdminModal } from "@/pages/admin/ui/overlays";
import { FlaskConical, Plus } from "lucide-react";
import { ModelIconPicker } from "@/components/model-logo";
import { ModelIcon } from "@/components/model-picker";
import { ModelProtocolBrowser } from "@/components/model-protocol-browser";
import { MediaTransportFields } from "./media-transport-fields";
import { ModelCapabilityEditor } from "@/components/model-capability-editor";
import { defaultModelCapabilityConfig, normalizeModelCapabilityConfig, type ModelCapabilityConfig } from "@/lib/model-capabilities";
import type { ModelProtocolDefinition } from "@/lib/model-protocols";
import { createAdminChannelModel, fetchAdminChannelModelMetadata, getAdminChannelProtocolSuggestion, testAdminChannelModel, updateAdminChannelModel, type ChannelModel, type ChannelProtocolSuggestion } from "@/services/api/wallet";
import type { ModelChannel } from "@/stores/use-config-store";
import { priceCurrencyOptions } from "@/services/api/user-groups";
import { defaultPriceTier, normalizeUpstreamModelKey, priceTierPayloadFromForm } from "./channel-model-price-tier-form";
import { PriceTierFields } from "./channel-model-price-tier-fields";
import { TokenPriceRulesSection } from "./channel-model-token-rules";
import { ChannelModelTagsEditor } from "./channel-model-tags-editor";
import { ChannelModelPresetPicker } from "./channel-model-preset-picker";
import { applyModelMetadataPreset, loadModelMetadataPresets, modelFamilyIdentity } from "@/lib/model-metadata-presets";
import { autoConfigureChannelModel, copyChannelModelConfiguration, copyChannelModelPrices } from "./channel-model-editor-form";
import { CapabilityTemplatePanel, PricingTemplatePanel } from "./channel-model-template-panels";
import { priceSelectorIssues } from "./channel-model-templates";
import { ChannelModelCopyPicker } from "./channel-model-copy-picker";
import { identifyChannelModelConfiguration } from "./channel-model-identification";
import type { ChannelModelCatalogItem } from "@/lib/channel-model-catalog";
import {
    changeChannelModelCapability,
    changeChannelModelProtocol,
    editorSectionForField,
    initialChannelModelValues,
    replaceChannelModelFormValues,
    updateChannelModelUpstreamCapabilities,
    validateChannelModelPrices,
    validateChannelModelProtocol,
    type ChannelModelFormValues as FormValues,
    type EditorSection,
} from "./channel-model-editor-form";

const noExistingModels: ChannelModel[] = [];

export function ChannelModelEditor({
    channel,
    existingModels = noExistingModels,
    editing,
    draftValues,
    protocols,
    protocolLoading,
    protocolError,
    onRetryProtocols,
    onClose,
    onSaved,
}: {
    channel: ModelChannel;
    existingModels?: ChannelModel[];
    editing: ChannelModel | null;
    draftValues?: FormValues;
    protocols: ModelProtocolDefinition[];
    protocolLoading: boolean;
    protocolError: string;
    onRetryProtocols: () => void;
    onClose: () => void;
    onSaved: () => Promise<void>;
}) {
    const { message, modal } = App.useApp();
    const { references } = useAdminContext();
    const [form] = Form.useForm<FormValues>();
    const [initialValues] = useState(() => draftValues ?? initialChannelModelValues(editing, protocols));
    const [editVersion] = useState(() => (editing ? { expectedUpdatedAt: editing.updatedAt, expectedPriceVersion: editing.priceVersion } : {}));
    const previousUpstream = useRef(normalizeUpstreamModelKey(initialValues.providerModelKey || initialValues.modelKey));
    const [activeSection, setActiveSection] = useState<EditorSection>("identity");
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);
    const [configurationChange, setConfigurationChange] = useState<"capability" | "protocol" | "parameters" | null>(null);
    const busyRef = useRef(false);
    const dirtyRef = useRef(false);
    const explicitProtocol = useRef(false);
    const preserveTemplateCapability = useRef(false);
    const [protocolSuggestion, setProtocolSuggestion] = useState<ChannelProtocolSuggestion>();
    const [suggestionError, setSuggestionError] = useState("");
    const modelCapability = Form.useWatch("capability", form);
    const modelProtocol = Form.useWatch("protocol", form);
    const modelKey = Form.useWatch("modelKey", form) || "";
    const providerModelKey = Form.useWatch("providerModelKey", form) || "";
    const capabilityConfig = Form.useWatch("capabilityConfig", form);
    const modelEnabled = Form.useWatch("enabled", form) !== false;
    const referenceVideoBilling = Form.useWatch("referenceVideoBilling", form) === true;
    const priceTiers = Form.useWatch("priceTiers", form) || [];
    const hasDefaultPriceTier = priceTiers.some((tier) => tier.matchMode === "default");
    const tiersWithOwnUpstream = priceTiers.filter((tier) => tier.providerModelKey?.trim());
    const modelUpstream = normalizeUpstreamModelKey(providerModelKey || modelKey);
    const [identifying, setIdentifying] = useState(false);
    const [upstreamCatalog, setUpstreamCatalog] = useState<ChannelModelCatalogItem[]>([]);
    const [identificationStatus, setIdentificationStatus] = useState("");
    const [identificationError, setIdentificationError] = useState("");
    const busy = saving || testing || identifying;
    // 协议由网站建议或用户明确选择；本地型号匹配不能在保存时覆盖它。
    const protectedFields = useRef(new Set<string>(["protocol"]));
    const [autoSource, setAutoSource] = useState("");
    useEffect(() => {
        if (editing || draftValues || !modelUpstream || busy || protocolLoading || protocolError) return;
        let active = true;
        const timer = setTimeout(() => {
            void loadModelMetadataPresets()
                .then((presets) => {
                    if (!active) return;
                    if (preserveTemplateCapability.current) protectedFields.current.add("capabilityConfig");
                    const result = autoConfigureChannelModel(form.getFieldsValue(true), existingModels, protocols, presets, protectedFields.current);
                    replaceChannelModelFormValues(form, result.values);
                    setAutoSource(result.source || "未找到可靠匹配，请手动配置参数与价格。");
                })
                .catch(() => {
                    if (active) setAutoSource("模型参数读取失败，请在下方重试或手动配置。");
                });
        }, 350);
        return () => {
            active = false;
            clearTimeout(timer);
        };
    }, [modelUpstream, editing, draftValues, busy, protocolLoading, protocolError, protocols, existingModels, form]);
    const selectorIssues = modelCapability ? priceSelectorIssues({ capability: modelCapability, protocol: modelProtocol, capabilityConfig, priceTiers, protocols }) : [];

    useEffect(() => {
        // 复制草稿保留预填协议，但预填本身不构成新的明确选择事件。
        const copiedProtocol = draftValues?.protocol && draftValues.capability === modelCapability;
        if (editing?.protocol || copiedProtocol || explicitProtocol.current || !modelUpstream || !modelCapability || protocolLoading || protocolError) return;
        let cancelled = false;
        setProtocolSuggestion(undefined);
        setSuggestionError("");
        form.setFieldValue("protocol", undefined);
        void getAdminChannelProtocolSuggestion(channel.id, modelUpstream, modelCapability)
            .then((suggestion) => {
                if (cancelled || explicitProtocol.current) return;
                const definition = protocols.find((item) => item.value === suggestion.protocol && item.capability === modelCapability && item.enabled !== false);
                if (suggestion.protocol && !definition) {
                    setProtocolSuggestion({ ...suggestion, source: "invalid", reason: "建议的协议未安装、已停用或与当前能力不匹配，请手动选择" });
                    return;
                }
                setProtocolSuggestion(suggestion);
                if (definition && (suggestion.source === "selection" || suggestion.source === "history")) {
                    const current = form.getFieldsValue(true);
                    const next = changeChannelModelProtocol(current, definition.value, protocols);
                    form.setFieldValue("protocol", definition.value);
                    // 模板操作早于或晚于建议请求，都应保留用户明确设置的能力。
                    if (!preserveTemplateCapability.current) form.setFieldValue("capabilityConfig", next.capabilityConfig);
                    // 自动协议建议不能改写价格，也不构成新的明确协议选择。
                }
            })
            .catch((error) => {
                if (!cancelled) setSuggestionError(error instanceof Error ? error.message : "协议建议读取失败，可手动选择协议");
            });
        return () => {
            cancelled = true;
        };
    }, [channel.id, editing?.protocol, draftValues?.protocol, draftValues?.capability, form, modelUpstream, modelCapability, protocolLoading, protocolError, protocols]);

    const requestClose = () => {
        if (busyRef.current) return;
        if (!dirtyRef.current) {
            onClose();
            return;
        }
        modal.confirm({ title: "放弃未保存的修改？", content: "当前修改尚未保存，关闭后将丢弃。", okText: "放弃修改", cancelText: "继续编辑", onOk: onClose });
    };

    const handleFormValuesChange = (changed: Partial<FormValues>) => {
        dirtyRef.current = true;
        setIdentificationStatus("");
        setIdentificationError("");
        for (const key of Object.keys(changed)) protectedFields.current.add(key);
        if (changed.capability) {
            explicitProtocol.current = false;
            preserveTemplateCapability.current = false;
            setProtocolSuggestion(undefined);
            replaceChannelModelFormValues(form, changeChannelModelCapability(form.getFieldsValue(true), protocols));
            setConfigurationChange("capability");
        } else if (changed.protocol) {
            explicitProtocol.current = true;
            preserveTemplateCapability.current = false;
            setProtocolSuggestion(undefined);
            replaceChannelModelFormValues(form, changeChannelModelProtocol(form.getFieldsValue(true), changed.protocol, protocols));
            setConfigurationChange("protocol");
        } else if (changed.providerModelKey !== undefined || changed.modelKey !== undefined) {
            const values = form.getFieldsValue(true);
            const upstream = normalizeUpstreamModelKey(values.providerModelKey || values.modelKey);
            if (!values.channelLabel?.trim() || values.channelLabel.trim() === previousUpstream.current) {
                form.setFieldValue("channelLabel", upstream);
            }
            previousUpstream.current = upstream;
            const next = updateChannelModelUpstreamCapabilities(values, protocols);
            if (canonicalize(next.capabilityConfig) !== canonicalize(values.capabilityConfig)) {
                form.setFieldValue("capabilityConfig", next.capabilityConfig);
                setConfigurationChange((previous) => previous || "parameters");
            }
        }
    };

    const applyConfiguration = (next: FormValues) => {
        const previous = form.getFieldsValue(true);
        explicitProtocol.current = true;
        preserveTemplateCapability.current = true;
        setProtocolSuggestion(undefined);
        setSuggestionError("");
        replaceChannelModelFormValues(form, next);
        for (const key of Object.keys(next)) protectedFields.current.add(key);
        previousUpstream.current = normalizeUpstreamModelKey(next.providerModelKey || next.modelKey);
        dirtyRef.current = true;
        if (previous.capability !== next.capability) setConfigurationChange("capability");
        else if (previous.protocol !== next.protocol) setConfigurationChange("protocol");
        else if (canonicalize(previous.capabilityConfig) !== canonicalize(next.capabilityConfig)) setConfigurationChange("parameters");
    };

    const identifyModel = async (selectedId?: string, loadOnly = false) => {
        if (busyRef.current) return;
        const current = form.getFieldsValue(true);
        const values = selectedId ? { ...current, modelKey: current.modelKey.trim() || selectedId, providerModelKey: selectedId } : current;
        if (!loadOnly && !values.providerModelKey?.trim() && !values.modelKey.trim()) {
            setIdentificationError("请先填写模型标识，或选择预设，也可读取上游目录选择模型");
            return;
        }
        busyRef.current = true;
        setIdentifying(true);
        setIdentificationError("");
        setIdentificationStatus("");
        try {
            const [metadata, presets] = await Promise.allSettled([upstreamCatalog.length && !loadOnly ? Promise.resolve({ models: upstreamCatalog }) : fetchAdminChannelModelMetadata(channel.id), loadModelMetadataPresets()]);
            const catalog = metadata.status === "fulfilled" ? metadata.value.models : [];
            if (metadata.status === "fulfilled") setUpstreamCatalog(catalog);
            if (loadOnly) {
                if (metadata.status === "rejected") throw metadata.reason;
                setIdentificationStatus(catalog.length ? `已读取 ${catalog.length} 个上游模型，选择后自动填写配置。` : "上游目录未返回模型");
                return;
            }
            const result = identifyChannelModelConfiguration(values, existingModels, protocols, presets.status === "fulfilled" ? presets.value : [], catalog, channel.apiFormat);
            applyConfiguration(result.values);
            const warnings = [metadata.status === "rejected" ? "上游目录读取失败，使用已配置型号和本地资料" : "", presets.status === "rejected" ? "文本预设读取失败" : ""].filter(Boolean);
            setIdentificationStatus(`${result.source}。已填入，保存后生效；请核对参数。${warnings.length ? ` ${warnings.join("；")}。` : ""}`);
            if (metadata.status === "rejected" || presets.status === "rejected") setIdentificationError(warnings.join("；"));
        } catch (error) {
            setIdentificationError(error instanceof Error ? error.message : "模型参数识别失败，请重试");
        } finally {
            busyRef.current = false;
            setIdentifying(false);
        }
    };

    const validateEditor = async (names?: string[]): Promise<FormValues | undefined> => {
        busyRef.current = true;
        try {
            await form.validateFields(names);
            return form.getFieldsValue(true);
        } catch (error) {
            const fields = (error as { errorFields?: { name: (string | number)[] }[] }).errorFields;
            if (fields?.length) {
                setActiveSection(editorSectionForField(fields[0].name));
                requestAnimationFrame(() => form.scrollToField(fields[0].name, { block: "center", focus: true }));
                message.warning("请检查标记的配置项后重试");
            } else message.error(error instanceof Error ? error.message : "表单校验失败");
            return undefined;
        } finally {
            busyRef.current = false;
        }
    };

    const save = async () => {
        if (busyRef.current) return;
        if (!editing && !draftValues) {
            try {
                if (preserveTemplateCapability.current) protectedFields.current.add("capabilityConfig");
                const presets = await loadModelMetadataPresets();
                const result = autoConfigureChannelModel(form.getFieldsValue(true), existingModels, protocols, presets, protectedFields.current);
                replaceChannelModelFormValues(form, result.values);
                setAutoSource(result.source);
            } catch {
                message.warning("模型参数读取失败，将按当前手动配置保存");
            }
        }
        const values = await validateEditor();
        if (!values) return;
        const upstreamModel = values.providerModelKey?.trim() || values.modelKey.trim();
        const capabilityConfig =
            values.capability === "text" || values.capability === "image" || values.capability === "video" ? normalizeModelCapabilityConfig(values.capabilityConfig || defaultModelCapabilityConfig(values.protocol, upstreamModel)) : undefined;
        busyRef.current = true;
        setSaving(true);
        try {
            const payload = {
                ...editVersion,
                modelKey: values.modelKey.trim(),
                providerModelKey: upstreamModel,
                displayName: values.displayName?.trim() || "未分类",
                channelLabel: values.channelLabel?.trim() || upstreamModel,
                tags: (values.tags || []).map((tag) => ({ text: tag.text.trim(), color: tag.color })),
                description: values.description?.trim() || "",
                icon: values.icon?.trim() || "",
                capability: values.capability,
                protocol: values.protocol,
                protocolSelectionExplicit: explicitProtocol.current && (!editing || editing.protocol !== values.protocol),
                priceTiers: values.priceTiers.map((tier) => priceTierPayloadFromForm(values.capability, tier, upstreamModel, capabilityConfig)),
                priceCurrency: values.priceCurrency || "credits",
                referenceVideoBilling: values.capability === "video" && values.referenceVideoBilling === true,
                enabled: values.enabled !== false,
                capabilityConfig,
            };
            if (editing) await updateAdminChannelModel(channel.id, editing.id, payload);
            else await createAdminChannelModel(channel.id, payload);
            try {
                await onSaved();
            } catch {
                message.warning("模型已保存，但列表刷新失败，请手动刷新");
            }
            onClose();
            message.success(editing ? "模型配置已更新" : "模型已添加");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存模型失败");
        } finally {
            busyRef.current = false;
            setSaving(false);
        }
    };

    const testModel = async () => {
        if (busyRef.current) return;
        const values = await validateEditor(["modelKey", "providerModelKey", "capability", "protocol", "capabilityConfig"]);
        if (!values) return;
        const upstreamModel = values.providerModelKey?.trim() || values.modelKey.trim();
        const capabilityConfig =
            values.capability === "text" || values.capability === "image" || values.capability === "video" ? normalizeModelCapabilityConfig(values.capabilityConfig || defaultModelCapabilityConfig(values.protocol, upstreamModel)) : undefined;
        busyRef.current = true;
        setTesting(true);
        try {
            const result = await testAdminChannelModel(channel.id, {
                modelKey: values.modelKey.trim(),
                providerModelKey: upstreamModel,
                capability: values.capability,
                protocol: values.protocol,
                capabilityConfig,
            });
            message.success(`模型测试通过，耗时 ${(result.durationMs / 1000).toFixed(2)} 秒`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "模型测试失败");
        } finally {
            busyRef.current = false;
            setTesting(false);
        }
    };

    return (
        <AdminModal
            open
            title={
                <div className="admin-model-editor-title">
                    <span>{draftValues ? "复制模型" : editing ? "编辑模型" : "新增模型"}</span>
                    <p>
                        {channel.name} · {editing?.displayName || editing?.modelKey || draftValues?.displayName || "配置调用方式与用户积分价格"}
                    </p>
                </div>
            }
            width={1120}
            centered
            rootClassName="admin-modal-root admin-model-editor-modal"
            mask={{ closable: false }}
            keyboard={!busy}
            closable={!busy}
            onCancel={requestClose}
            flush
            styles={{ body: { minHeight: 0, flex: 1 }, header: { margin: 0 }, footer: { margin: 0 } }}
            footer={
                <div className="admin-model-editor-footer-actions">
                    <div className="admin-model-editor-footer-status">
                        <Switch
                            aria-label="启用模型"
                            checked={modelEnabled}
                            disabled={busy}
                            onChange={(checked) => {
                                dirtyRef.current = true;
                                form.setFieldValue("enabled", checked);
                            }}
                        />
                        <div>
                            <strong>{modelEnabled ? "模型启用" : "模型停用"}</strong>
                            <small>保存后生效</small>
                        </div>
                    </div>
                    <div className="admin-model-editor-footer-primary">
                        <Button
                            icon={<FlaskConical className="size-4" />}
                            loading={testing}
                            disabled={saving || identifying || protocolLoading || Boolean(protocolError)}
                            onClick={() => modal.confirm({ title: "测试模型连接？", content: "测试会向上游发送真实请求，可能产生供应商费用；不会保存当前修改。", okText: "开始测试", cancelText: "取消", onOk: testModel })}
                        >
                            测试模型
                        </Button>
                        <Button disabled={busy} onClick={requestClose}>
                            取消
                        </Button>
                        <Button type="primary" loading={saving} disabled={testing || identifying || protocolLoading || Boolean(protocolError) || selectorIssues.length > 0} onClick={() => void save()}>
                            {editing ? "保存修改" : "添加模型"}
                        </Button>
                    </div>
                </div>
            }
        >
            <Form className="admin-model-editor-form" form={form} initialValues={initialValues} layout="vertical" disabled={busy} inert={busy} onValuesChange={handleFormValuesChange}>
                <Form.Item name="capabilityConfig" noStyle>
                    <CapabilityConfigField />
                </Form.Item>
                <Form.Item name="enabled" noStyle>
                    <EnabledConfigField />
                </Form.Item>
                <Tabs
                    activeKey={activeSection}
                    onChange={(key) => setActiveSection(key as EditorSection)}
                    animated={false}
                    items={[
                        {
                            key: "identity",
                            label: "基本信息",
                            forceRender: true,
                            children: (
                                <div className="admin-model-editor-tab-content">
                                    {!editing && !draftValues && (
                                        <p className="text-xs text-foreground/60" role="status">
                                            {autoSource || "填写模型 ID 后自动补齐参数，并参考当前渠道同类模型的接口与价格。"}
                                        </p>
                                    )}
                                    <div className="admin-model-editor-assists">
                                        <ChannelModelPresetPicker
                                            modelId={providerModelKey || modelKey}
                                            capability={modelCapability || initialValues.capability}
                                            disabled={busy}
                                            identifying={identifying}
                                            status={identificationStatus}
                                            error={identificationError}
                                            upstreamModels={upstreamCatalog}
                                            onIdentify={(id) => void identifyModel(id)}
                                            onReadUpstream={() => void identifyModel(undefined, true)}
                                            onApply={(preset) => {
                                                const values = form.getFieldsValue(true);
                                                const next = applyModelMetadataPreset(
                                                    {
                                                        ...values,
                                                        modelKey: values.modelKey.trim() || preset.id,
                                                        providerModelKey: values.providerModelKey?.trim() || preset.id,
                                                        channelLabel: values.channelLabel?.trim() || values.providerModelKey?.trim() || preset.id,
                                                    },
                                                    preset,
                                                );
                                                if (!values.displayName?.trim() || values.displayName === "未分类") next.displayName = modelFamilyIdentity(preset.id)?.category || "未分类";
                                                applyConfiguration(next);
                                                setIdentificationStatus(`参数预设 ${preset.id} 已填入，保存后生效。`);
                                                setIdentificationError("");
                                                message.success("模型预设已填入，保存后生效");
                                            }}
                                        />
                                        <ChannelModelCopyPicker
                                            mode="configuration"
                                            channel={channel}
                                            models={existingModels}
                                            target={editing}
                                            capability={modelCapability || initialValues.capability}
                                            protocols={protocols}
                                            disabled={busy || protocolLoading || Boolean(protocolError)}
                                            onApply={(source, copySkuRoutes) => {
                                                try {
                                                    applyConfiguration(copyChannelModelConfiguration(form.getFieldsValue(true), source, protocols, copySkuRoutes));
                                                    setAutoSource(`完整配置来自 ${source.providerModelKey || source.modelKey}`);
                                                    setConfigurationChange(null);
                                                    message.success("完整模型配置已填入，保存后生效");
                                                } catch (error) {
                                                    message.warning(error instanceof Error ? error.message : "复制配置失败");
                                                }
                                            }}
                                        />
                                    </div>
                                    <section className="admin-model-editor-section">
                                        <SectionHeading title="模型身份" description="区分产品侧展示标识与上游实际调用 ID。" />
                                        <div className="admin-model-editor-section-content admin-model-identity-grid admin-model-identity-grid-with-icon">
                                            <Form.Item
                                                name="modelKey"
                                                label="产品模型标识"
                                                tooltip="不同渠道使用相同标识时，创作端归为同一个产品模型。不同版本（例如 Fast）应使用不同标识；请勿为分组随意修改已有标识。"
                                                rules={[{ required: true, whitespace: true, message: "请输入产品模型标识" }]}
                                            >
                                                <Input
                                                    prefix={
                                                        <span className="grid size-6 place-items-center">
                                                            <ModelIcon model={modelKey} />
                                                        </span>
                                                    }
                                                    placeholder="例如：seedance-2-5"
                                                />
                                            </Form.Item>
                                            <Form.Item name="providerModelKey" label="上游模型 ID" tooltip="实际发送给供应商；留空时使用产品模型标识。价格档可配置独立上游 ID，命中时优先于此处。">
                                                <Input placeholder="留空则使用产品模型标识" />
                                            </Form.Item>
                                            <Form.Item name="displayName" label="模型展示名（一级目录）" tooltip="跨所有系统渠道按此名称分组；新模型默认未分类。同名模型归入同一组，不改变调用 ID。">
                                                <ModelDisplayNameInput />
                                            </Form.Item>
                                            <Form.Item
                                                name="channelLabel"
                                                label="渠道展示名（二级目录）"
                                                tooltip="默认跟随上游模型 ID；手动名称最多 80 字。"
                                                rules={[
                                                    {
                                                        validator: async (_, value: string | undefined) => {
                                                            if (value?.trim() !== modelUpstream && Array.from(value?.trim() || "").length > 80) throw new Error("渠道展示名不能超过 80 字");
                                                        },
                                                    },
                                                ]}
                                            >
                                                <Input maxLength={80} placeholder={modelUpstream || "默认使用上游模型 ID"} />
                                            </Form.Item>
                                            <Form.Item name="icon" label="模型 Logo">
                                                <ModelIconPicker />
                                            </Form.Item>
                                        </div>
                                        {tiersWithOwnUpstream.length ? (
                                            <Alert
                                                type="info"
                                                showIcon
                                                title={`${tiersWithOwnUpstream.length} 个价格档配置了独立上游模型 ID`}
                                                description="命中的请求会优先使用价格档的上游 ID；修改上方上游模型 ID 时，只有与旧值相同的档位会自动跟随更新，其余保持不变。"
                                            />
                                        ) : null}
                                        <ChannelModelTagsEditor />
                                        <Form.Item name="description" label="模型描述" extra="在创作端二级渠道选项中常驻显示，可说明适用场景、渠道差异和注意事项。" rules={[{ max: 500, message: "模型描述不能超过 500 字" }]}>
                                            <Input.TextArea rows={3} maxLength={500} showCount placeholder="填写此渠道模型的使用说明" />
                                        </Form.Item>
                                    </section>
                                    <section className="admin-model-editor-section">
                                        <SectionHeading title="能力与协议" description="先选任务类型，再选择对应的调用协议；更换后请核对参数与价格。" />
                                        <div className="admin-model-editor-section-content admin-model-protocol-grid">
                                            <Form.Item name="capability" label="模型能力" rules={[{ required: true }]}>
                                                <Segmented
                                                    block
                                                    options={[
                                                        { label: "文本", value: "text" },
                                                        { label: "图片", value: "image" },
                                                        { label: "视频", value: "video" },
                                                        { label: "音频", value: "audio" },
                                                    ]}
                                                />
                                            </Form.Item>
                                            <Form.Item className="admin-model-protocol-field" name="protocol" label="调用协议" rules={[{ validator: async (_, value) => validateChannelModelProtocol(form.getFieldValue("capability"), value, protocols) }]}>
                                                <ModelProtocolBrowser disabled={busy} capability={modelCapability} protocols={protocols} loading={protocolLoading} error={protocolError} />
                                            </Form.Item>
                                            {protocolSuggestion && protocolSuggestion.source !== "none" ? (
                                                <Alert
                                                    type={protocolSuggestion.source === "invalid" || protocolSuggestion.source === "conflict" ? "warning" : "info"}
                                                    showIcon
                                                    title={
                                                        protocolSuggestion.source === "selection"
                                                            ? "已预选同网站上次明确保存的协议"
                                                            : protocolSuggestion.source === "history"
                                                              ? "已根据同网站一致的历史配置预选协议"
                                                              : protocolSuggestion.source === "conflict"
                                                                ? "同网站历史协议存在冲突，请手动选择"
                                                                : "协议建议已失效，请手动选择"
                                                    }
                                                    description={
                                                        <>
                                                            {protocolSuggestion.reason}
                                                            {protocolSuggestion.candidates?.length ? <p>候选协议：{protocolSuggestion.candidates.join("、")}</p> : null}
                                                            {protocolSuggestion.source === "selection" || protocolSuggestion.source === "history" ? <p>仅继承协议，参数按协议默认初始化，请核对当前 Key 的实际能力和价格。</p> : null}
                                                        </>
                                                    }
                                                />
                                            ) : null}
                                            {suggestionError ? <Alert type="warning" title="协议建议读取失败，可手动选择" description={suggestionError} /> : null}
                                            {protocolError && (
                                                <Alert
                                                    type="error"
                                                    showIcon
                                                    title="协议目录读取失败"
                                                    description={protocolError}
                                                    action={
                                                        <Button size="small" onClick={onRetryProtocols}>
                                                            重试
                                                        </Button>
                                                    }
                                                />
                                            )}
                                        </div>
                                    </section>
                                </div>
                            ),
                        },
                        {
                            key: "capabilities",
                            label: "能力与参数",
                            forceRender: true,
                            children: (
                                <div className="admin-model-editor-tab-content">
                                    <CapabilityTemplatePanel
                                        form={form}
                                        protocols={protocols}
                                        channelMediaTransport={channel.mediaTransport}
                                        disabled={busy}
                                        onApplied={() => {
                                            dirtyRef.current = true;
                                            preserveTemplateCapability.current = true;
                                        }}
                                    />
                                    {configurationChange && (
                                        <Alert
                                            type="warning"
                                            showIcon
                                            title={configurationChange === "capability" ? "模型能力已变更" : configurationChange === "protocol" ? "调用协议已变更" : modelCapability === "image" ? "图片参数已更新" : "模型参数已更新"}
                                            description={
                                                configurationChange === "parameters"
                                                    ? "模型参数已更新，请检查规格价格是否仍适用。金额与计费方式保持不变。"
                                                    : "引用与参数已恢复为新协议默认值，不兼容的规格条件已清除。金额与计费方式保持不变，请在保存前核对。"
                                            }
                                        />
                                    )}{" "}
                                    {modelCapability === "text" || modelCapability === "image" || modelCapability === "video" ? (
                                        <section className="admin-model-editor-section admin-model-editor-section-stacked admin-model-editor-references">
                                            <SectionHeading title="引用与限制" description="按媒体类型纵向配置数量、大小、时长及通用约束。" />
                                            <Form.Item name={["capabilityConfig", "mediaTransport"]} label="参考素材发送方式" extra="优先使用模型设置，其次渠道默认值，最后使用协议默认行为。">
                                                <MediaTransportFields channel={channel.mediaTransport || {}} />
                                            </Form.Item>
                                            <div className="admin-model-editor-section-content">
                                                <ModelCapabilityEditor
                                                    capability={modelCapability}
                                                    model={providerModelKey || modelKey}
                                                    protocol={form.getFieldValue("protocol")}
                                                    section="references"
                                                    imageParameters={protocols.find((item) => item.value === modelProtocol)?.imageParameters}
                                                    workflows={protocols.find((item) => item.value === modelProtocol)?.workflows}
                                                    value={capabilityConfig}
                                                    onChange={(next) => {
                                                        dirtyRef.current = true;
                                                        protectedFields.current.add("capabilityConfig");
                                                        form.setFieldValue("capabilityConfig", { ...next, mediaTransport: form.getFieldValue(["capabilityConfig", "mediaTransport"]) });
                                                    }}
                                                />
                                            </div>
                                        </section>
                                    ) : null}
                                    {modelCapability === "text" || modelCapability === "image" || modelCapability === "video" ? (
                                        <section className="admin-model-editor-section admin-model-editor-section-stacked admin-model-editor-parameters">
                                            <SectionHeading title="协议参数" description="配置可发送参数、支持值与默认值；仅影响当前模型。" />
                                            <div className="admin-model-editor-section-content">
                                                <ModelCapabilityEditor
                                                    capability={modelCapability}
                                                    model={providerModelKey || modelKey}
                                                    protocol={form.getFieldValue("protocol")}
                                                    section="protocol"
                                                    imageParameters={protocols.find((item) => item.value === modelProtocol)?.imageParameters}
                                                    workflows={protocols.find((item) => item.value === modelProtocol)?.workflows}
                                                    value={capabilityConfig}
                                                    onChange={(next) => {
                                                        dirtyRef.current = true;
                                                        protectedFields.current.add("capabilityConfig");
                                                        form.setFieldValue("capabilityConfig", { ...next, mediaTransport: form.getFieldValue(["capabilityConfig", "mediaTransport"]) });
                                                    }}
                                                />
                                            </div>
                                        </section>
                                    ) : null}
                                    {modelCapability === "audio" && <Alert type="info" title="音频模型无需额外配置引用与参数" description="调用协议和积分定价仍需在对应分组中配置。" />}
                                </div>
                            ),
                        },
                        {
                            key: "pricing",
                            label: "积分定价",
                            forceRender: true,
                            children: (
                                <div className="admin-model-editor-tab-content">
                                    <PricingTemplatePanel
                                        form={form}
                                        protocols={protocols}
                                        disabled={busy}
                                        onApplied={() => {
                                            dirtyRef.current = true;
                                        }}
                                    />
                                    {selectorIssues.length ? (
                                        <Alert
                                            type="warning"
                                            showIcon
                                            title="请调整不兼容或重复的价格条件"
                                            description={
                                                <ul>
                                                    {selectorIssues.map((issue) => (
                                                        <li key={issue}>{issue}</li>
                                                    ))}
                                                </ul>
                                            }
                                        />
                                    ) : null}
                                    {configurationChange && (
                                        <Alert
                                            type="warning"
                                            showIcon
                                            title="请核对定价"
                                            description={configurationChange === "parameters" ? "模型参数已更新，请检查规格价格是否仍适用。金额与计费方式保持不变。" : "能力或协议已变更。请重新检查规格条件、计费方式和金额；不会自动转换价格单位。"}
                                            action={
                                                <Button size="small" onClick={() => setConfigurationChange(null)}>
                                                    已核对
                                                </Button>
                                            }
                                        />
                                    )}{" "}
                                    <ChannelModelCopyPicker
                                        mode="prices"
                                        channel={channel}
                                        models={existingModels}
                                        target={editing}
                                        capability={modelCapability || initialValues.capability}
                                        protocols={protocols}
                                        disabled={busy}
                                        onApply={(source) => {
                                            try {
                                                const next = copyChannelModelPrices(form.getFieldsValue(true), source);
                                                form.setFieldValue("priceTiers", next.priceTiers);
                                                form.setFieldValue("priceCurrency", next.priceCurrency);
                                                protectedFields.current.add("priceTiers");
                                                protectedFields.current.add("priceCurrency");
                                                dirtyRef.current = true;
                                                message.success("价格已复制到表单，保存后生效");
                                            } catch (error) {
                                                message.warning(error instanceof Error ? error.message : "复制价格失败");
                                            }
                                        }}
                                    />
                                    <section className="admin-model-editor-section">
                                        <SectionHeading title="用户积分价格" description="默认只需填写一个统一价格；需要区分生成方式、质量或尺寸时，再添加规格价格。" />
                                        <div className="admin-model-editor-section-content">
                                            <Form.Item name="priceCurrency" label="计价货币" extra="积分：售价即扣除的积分。USD / CNY：售价按货币填写，扣费时按用户分组的「1 USD / 1 CNY = N 积分」换算；成本价仍以积分计。">
                                                <Segmented
                                                    options={priceCurrencyOptions}
                                                    onChange={() => {
                                                        dirtyRef.current = true;
                                                        protectedFields.current.add("priceCurrency");
                                                    }}
                                                />
                                            </Form.Item>
                                            {modelCapability === "video" ? (
                                                <Form.Item
                                                    name="referenceVideoBilling"
                                                    label="参考视频计费"
                                                    valuePropName="checked"
                                                    extra={
                                                        referenceVideoBilling
                                                            ? "已开启：挂参考视频的请求使用各价格档的「带参考视频」价格。按秒 =（生成秒数 + 参考视频秒数）× 带参考视频每秒价，参考视频时长由后端实测，测不出时拒绝提交；视频 Token 按含参考视频的用量 × 带参考视频 Token 价。不挂参考视频的请求仍用原价。"
                                                            : "已关闭：参考视频不计费。按秒只计生成秒数，视频 Token 只按生成时长计算用量。用户侧会显示「参考视频不计费」。"
                                                    }
                                                >
                                                    <Switch
                                                        aria-label="参考视频计费"
                                                        onChange={() => {
                                                            dirtyRef.current = true;
                                                        }}
                                                    />
                                                </Form.Item>
                                            ) : null}
                                            <Form.List
                                                name="priceTiers"
                                                rules={[
                                                    {
                                                        validator: async (_, value) => {
                                                            validateChannelModelPrices({
                                                                capability: form.getFieldValue("capability"),
                                                                protocol: form.getFieldValue("protocol"),
                                                                priceTiers: value,
                                                                capabilityConfig: form.getFieldValue("capabilityConfig"),
                                                                protocols,
                                                                referenceVideoBilling: form.getFieldValue("referenceVideoBilling"),
                                                            });
                                                        },
                                                    },
                                                ]}
                                            >
                                                {(fields, { add, remove }, { errors }) => (
                                                    <div className="admin-price-tier-list-shell">
                                                        <div className="admin-price-tier-list" aria-label="积分价格规则列表">
                                                            {fields.map((field, index) => (
                                                                <PriceTierFields
                                                                    key={field.key}
                                                                    index={field.name}
                                                                    ordinal={index + 1}
                                                                    form={form}
                                                                    capability={modelCapability}
                                                                    protocol={modelProtocol}
                                                                    capabilityConfig={capabilityConfig}
                                                                    modelUpstream={modelUpstream}
                                                                    onDirty={() => {
                                                                        dirtyRef.current = true;
                                                                        protectedFields.current.add("priceTiers");
                                                                    }}
                                                                    onRemove={() => {
                                                                        protectedFields.current.add("priceTiers");
                                                                        dirtyRef.current = true;
                                                                        remove(field.name);
                                                                    }}
                                                                />
                                                            ))}
                                                        </div>
                                                        <div className="admin-price-tier-list-footer">
                                                            <Button
                                                                className="admin-model-editor-add-tier"
                                                                type="dashed"
                                                                block
                                                                icon={<Plus className="size-4" />}
                                                                onClick={() => {
                                                                    protectedFields.current.add("priceTiers");
                                                                    dirtyRef.current = true;
                                                                    add(defaultPriceTier(hasDefaultPriceTier ? "advanced" : "default"));
                                                                }}
                                                            >
                                                                {hasDefaultPriceTier ? "新增规格价格" : "新增统一默认价格"}
                                                            </Button>
                                                            <Form.ErrorList errors={errors} />
                                                        </div>
                                                    </div>
                                                )}
                                            </Form.List>
                                        </div>
                                    </section>
                                    {modelCapability === "text" ? (
                                        <TokenPriceRulesSection
                                            form={form}
                                            onDirty={() => {
                                                dirtyRef.current = true;
                                            }}
                                        />
                                    ) : null}
                                </div>
                            ),
                        },
                    ]}
                />
            </Form>
        </AdminModal>
    );
}

function SectionHeading({ title, description }: { title: string; description: string }) {
    return (
        <header className="admin-model-editor-section-heading">
            <h2>{title}</h2>
            <p>{description}</p>
        </header>
    );
}
function CapabilityConfigField(_: { value?: ModelCapabilityConfig; onChange?: (value: ModelCapabilityConfig) => void }) {
    return null;
}
function EnabledConfigField(_: { value?: boolean; onChange?: (value: boolean) => void }) {
    return null;
}
