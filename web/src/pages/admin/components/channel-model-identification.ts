import { canonicalize } from "json-canonicalize";
import { catalogCapabilityConfig, type ChannelModelCatalogItem } from "@/lib/channel-model-catalog";
import { defaultModelCapabilityConfig, pluginWorkflowCapabilityConfig } from "@/lib/model-capabilities";
import { applyModelMetadataPreset, matchingModelPresets, modelFamilyIdentity, modelMatchScore, presetApplicationError, type ModelMetadataPreset } from "@/lib/model-metadata-presets";
import type { ModelProtocolDefinition } from "@/lib/model-protocols";
import type { ChannelModel } from "@/services/api/wallet";
import { initialChannelModelValues, updateChannelModelUpstreamCapabilities, validateChannelModelProtocol, type ChannelModelFormValues } from "./channel-model-editor-form";

// Explicit identification only changes model metadata. Prices and activation remain under administrator control.
export function identifyChannelModelConfiguration(values: ChannelModelFormValues, models: ChannelModel[], protocols: ModelProtocolDefinition[], presets: ModelMetadataPreset[], catalog: ChannelModelCatalogItem[] = [], apiFormat = "openai") {
    const id = values.providerModelKey?.trim() || values.modelKey.trim();
    if (!id) throw new Error("请先填写模型标识，或从预设、上游目录选择模型");
    const available = protocols.filter((protocol) => protocol.enabled !== false);
    const metadata = catalog.find((item) => modelMatchScore(id, item.id) >= 3);
    const ranked = models
        .filter((model) => model.capability && available.some((protocol) => protocol.value === model.protocol && protocol.capability === model.capability))
        .map((model) => ({ model, score: modelMatchScore(id, model.providerModelKey || model.modelKey) }));
    const best = Math.max(0, ...ranked.map((item) => item.score));
    let candidates = ranked.filter((item) => best >= 2 && item.score === best);
    // Equal model aliases may share a contract, but conflicting contracts must be selected explicitly.
    const contractKeys = () => new Set(candidates.map(({ model }) => canonicalize({ capability: model.capability, protocol: model.protocol, config: model.capabilityConfig })));
    if (contractKeys().size > 1) {
        const selected = candidates.filter(({ model }) => model.capability === values.capability && model.protocol === values.protocol);
        if (selected.length) candidates = selected;
    }
    const contracts = contractKeys();
    const template = contracts.size === 1 ? candidates[0]?.model : undefined;
    const preset = matchingModelPresets(presets, id)[0];
    const workflowMatches = available.flatMap((protocol) => (protocol.workflows || []).filter((workflow) => workflow.providerId === protocol.value && modelMatchScore(id, workflow.id) >= 3).map((workflow) => ({ protocol, workflow })));
    const workflow = workflowMatches.find((item) => item.protocol.value === values.protocol) || (workflowMatches.length === 1 ? workflowMatches[0] : undefined);
    const capability = metadata?.modelType || template?.capability || workflow?.workflow.capability || (preset ? "text" : undefined);
    if (!capability) throw new Error(contracts.size > 1 ? "同型号存在不同配置，请选择来源模型复制，或明确调用协议" : "未找到可靠的模型能力资料，请读取上游目录或选择来源模型复制配置");
    const compatible = available.filter((protocol) => protocol.capability === capability);
    const preferred = template?.capability === capability ? template.protocol : workflow?.protocol.value;
    const current = compatible.find((protocol) => protocol.value === values.protocol);
    const nativeText = capability === "text" ? compatible.find((protocol) => (apiFormat === "gemini" ? /generateContent/i.test(protocol.create) : protocol.textWire === "chat-completion" || /\/chat\/completions/.test(protocol.create))) : undefined;
    const protocol = compatible.find((item) => item.value === preferred) || current || nativeText || (compatible.length === 1 ? compatible[0] : undefined);
    if (!protocol) throw new Error("模型能力已识别，但有多个可用调用协议，请先选择该渠道实际支持的协议");
    validateChannelModelProtocol(capability, protocol.value, protocols);
    const sameContract = values.capability === capability && values.protocol === protocol.value;
    let config = template?.protocol === protocol.value ? structuredClone(initialChannelModelValues(template, protocols).capabilityConfig) : sameContract ? structuredClone(values.capabilityConfig) : undefined;
    const sources: string[] = [];
    if (template?.protocol === protocol.value) sources.push(`已配置型号 ${template.providerModelKey || template.modelKey}`);
    const selectedWorkflow = workflowMatches.find((item) => item.protocol.value === protocol.value);
    if (selectedWorkflow) {
        config = pluginWorkflowCapabilityConfig(protocol.value, selectedWorkflow.workflow, config) || config;
        sources.push(`协议工作流 ${selectedWorkflow.workflow.label}`);
    }
    if (capability !== "audio") config ||= defaultModelCapabilityConfig(protocol.value, id);
    if (metadata && (capability === "image" || capability === "video")) {
        config = catalogCapabilityConfig(metadata, protocol.value, capability, config, !sameContract && !template);
        sources.push(`上游模型目录 ${metadata.id}`);
    }
    const identity = modelFamilyIdentity(id);
    let next: ChannelModelFormValues = {
        ...values,
        modelKey: values.modelKey.trim() || id.replace(/^models\//, ""),
        providerModelKey: values.providerModelKey?.trim() || metadata?.id || id,
        channelLabel: values.channelLabel?.trim() || id,
        displayName: values.displayName?.trim() && values.displayName !== "未分类" ? values.displayName : template?.displayName || identity?.category || "未分类",
        icon: values.icon?.trim() || template?.icon || identity?.icon || "",
        capability,
        protocol: protocol.value,
        capabilityConfig: capability === "audio" ? undefined : config,
    };
    if (preset && capability === "text") {
        const error = presetApplicationError(preset, capability);
        if (error) throw new Error(error);
        next = applyModelMetadataPreset(next, preset);
        sources.push(`参数预设 ${preset.id}`);
    }
    next = updateChannelModelUpstreamCapabilities(next, protocols);
    if (!sources.length) sources.push(`上游声明能力 ${metadata?.modelType || capability}；参数沿用所选协议`);
    return { values: next, source: sources.join("；") };
}
