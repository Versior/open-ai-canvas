package app

import (
	"encoding/json"
	"strings"

	"yingce/backend/internal/model"
	"yingce/backend/internal/modelpreset"
)

// Only new models pass through this path. Explicit request fields always win.
func (s *Service) autoConfigureNewChannelModel(channel *model.ModelChannel, req ChannelModelRequest, existing []model.ChannelModel) ChannelModelRequest {
	id := firstNonEmpty(req.ProviderModelKey, req.ModelKey)
	explicitConfig := req.CapabilityConfig != nil
	best, count := 0, 0
	var template *model.ChannelModel
	for index := range existing {
		item := &existing[index]
		if req.Capability != "" && req.Capability != item.Capability {
			continue
		}
		if _, _, _, _, err := s.normalizeChannelModelContract(channel, ChannelModelRequest{ModelKey: id, Capability: item.Capability, Protocol: string(item.Protocol)}); err != nil {
			continue
		}
		score := max(modelpreset.MatchScore(id, firstNonEmpty(item.ProviderModelKey, item.ModelKey), true), modelpreset.MatchScore(id, item.ModelKey, true))
		if score == 0 || score < best {
			continue
		}
		if score > best {
			best, count, template = score, 1, item
		} else {
			count++
		}
	}
	if count == 1 {
		if req.Capability == "" {
			req.Capability = template.Capability
		}
		compatible := req.Protocol == "" || req.Protocol == string(template.Protocol)
		if req.Protocol == "" {
			req.Protocol = string(template.Protocol)
		}
		if compatible {
			if req.CapabilityConfig == nil && best >= 2 {
				config, err := DecodeModelCapabilityConfig(template.CapabilityConfigJSON)
				if err == nil {
					req.CapabilityConfig = config
				}
			}
			if req.PriceTiers == nil && req.BillingMode == "" && !req.PriceConfigured && req.UnitPriceMicrocredits == 0 && req.InputTokenPriceMicrocredits == 0 && req.OutputTokenPriceMicrocredits == 0 && req.CachedTokenPriceMicrocredits == 0 {
				for _, tier := range template.PriceTiers {
					if !tier.PriceConfigured {
						continue
					}
					enabled := tier.Enabled
					req.PriceTiers = append(req.PriceTiers, ChannelModelPriceTierRequest{Selector: tier.Selector, Resolution: tier.Resolution, VideoSeconds: tier.VideoSeconds, ProviderModelKey: id, BillingMode: tier.BillingMode, UnitPriceMicrocredits: tier.UnitPriceMicrocredits, InputTokenPriceMicrocredits: tier.InputTokenPriceMicrocredits, OutputTokenPriceMicrocredits: tier.OutputTokenPriceMicrocredits, CachedTokenPriceMicrocredits: tier.CachedTokenPriceMicrocredits, CostPricing: tier.CostPricing, PriceConfigured: true, Enabled: &enabled})
				}
			}
		}
		if req.Icon == "" {
			req.Icon = template.Icon
		}
		if req.DisplayName == "" && template.DisplayName != "未分类" {
			req.DisplayName = template.DisplayName
		}
	}
	category, icon := modelpreset.Identity(id)
	if req.DisplayName == "" {
		req.DisplayName = category
	}
	if req.Icon == "" {
		req.Icon = icon
	}
	if count == 1 && req.CapabilityConfig == nil && req.Capability != "audio" {
		req.CapabilityConfig = DefaultModelCapabilityConfigForModel(req.Protocol, id)
	}
	preset, matched := modelpreset.Find(id)
	if matched && req.Capability == "" {
		req.Capability = "text"
	}
	if req.Protocol == "" && req.Capability == "text" {
		req.Protocol = string(model.ChannelInterfaceChatCompletion)
		if channel.APIFormat == "gemini" {
			req.Protocol = "gemini-generate-content"
		}
	}
	// Catalog limits take precedence over a sibling's limits, but never over explicit input.
	if matched && req.Capability == "text" && !explicitConfig {
		if req.CapabilityConfig == nil {
			req.CapabilityConfig = DefaultModelCapabilityConfigForModel(req.Protocol, id)
		}
		if req.CapabilityConfig.Text != nil {
			req.CapabilityConfig.Text.ContextWindowTokens = preset.Context
			req.CapabilityConfig.Text.MaxOutputTokens = preset.Output
			req.CapabilityConfig.Text.References.MaxImages = 0
			if preset.Vision {
				req.CapabilityConfig.Text.References.MaxImages = min(100, max(1, preset.MaxImages))
			}
		}
	}
	return req
}

func (s *Service) prepareDiscoveredChannelModel(channel *model.ModelChannel, item *model.ChannelModel, existing []model.ChannelModel) error {
	req := s.autoConfigureNewChannelModel(channel, ChannelModelRequest{ModelKey: item.ModelKey, ProviderModelKey: item.ProviderModelKey}, existing)
	if strings.TrimSpace(req.Capability) == "" {
		return nil
	}
	_, _, capability, protocol, err := s.normalizeChannelModelContract(channel, req)
	if err != nil {
		return err
	}
	config, err := NormalizeModelCapabilityConfigForModel(capability, string(protocol), item.ProviderModelKey, req.CapabilityConfig, s.protocolRegistry())
	if err != nil {
		return err
	}
	req.CapabilityConfig = config
	tiers, err := s.normalizeChannelModelPriceTiers(req, capability, protocol, item.ProviderModelKey)
	if err != nil {
		return err
	}
	encoded, err := json.Marshal(config)
	if err != nil {
		return err
	}
	if err := validateChannelModelTierCapabilities(tiers, string(encoded), capability, string(protocol)); err != nil {
		return err
	}
	item.Capability, item.Protocol, item.Icon = capability, protocol, req.Icon
	if req.DisplayName != "" {
		item.DisplayName = req.DisplayName
	}
	item.CapabilityConfigJSON, item.CapabilityVersion = string(encoded), 1
	item.PriceTiers = tiers
	s.applyChannelModelPriceTierSummary(item, tiers)
	return nil
}
