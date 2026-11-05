package app

import (
	"context"
	"log/slog"
	"time"
)

const (
	socialVideoParseMaintenanceInterval = time.Minute
	socialVideoParseMaintenanceLease    = 10 * time.Minute
	// 每轮巡检最多测几条接口，接口很多时分几轮测完，避免一轮跑太久。
	socialVideoParseHealthBatch = 10
)

// startSocialVideoParseMaintenance 每分钟巡检一次接口池：到点恢复自动停用的接口、按设置定期测试、同步订阅源。
// 多实例部署时用协调租约保证同一时间只有一个实例在巡检。
func (s *Service) startSocialVideoParseMaintenance() {
	s.runWorkerLoop(func(ctx context.Context) {
		timer := time.NewTimer(30 * time.Second)
		defer timer.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-timer.C:
			}
			s.runSocialVideoParseMaintenance(ctx)
			timer.Reset(socialVideoParseMaintenanceInterval)
		}
	})
}

func (s *Service) runSocialVideoParseMaintenance(ctx context.Context) {
	// 后台关了视频链接导入时整套巡检都停：不在后台继续调用第三方接口和订阅地址，后台手动测试照常可用。
	if enabled, err := s.FeatureEnabled(FeatureSocialVideoImport); err != nil || !enabled {
		return
	}
	if s.coordinator != nil {
		release, acquired, err := s.coordinator.Acquire(ctx, "social-video-parse:maintenance", 1, socialVideoParseMaintenanceLease)
		if err != nil || !acquired {
			return
		}
		defer release()
	}
	s.recoverSocialVideoParseAPIs(ctx)
	s.healthCheckSocialVideoParseAPIs(ctx)
	s.syncDueSocialVideoParseSources(ctx)
}

// recoverSocialVideoParseAPIs 对冷却期满的自动停用接口：有测试链接就测一次，通过即恢复；
// 没有测试链接就先放行，连续失败次数停在阈值减一，下一次真实调用再失败会立刻停用。
func (s *Service) recoverSocialVideoParseAPIs(ctx context.Context) {
	settings, err := s.socialVideoParseSettings()
	if err != nil || !settings.AutoRecover {
		return
	}
	apis, err := s.socialVideoParseAPIs()
	if err != nil {
		return
	}
	state, err := s.socialVideoParseState()
	if err != nil {
		return
	}
	cooldown := time.Duration(settings.RecoverAfterMinutes) * time.Minute
	now := time.Now().UTC()
	for _, api := range apis {
		current := state.APIs[api.ID]
		if ctx.Err() != nil || !api.Enabled || current == nil || !current.AutoDisabled || current.AutoDisabledAt == nil || now.Sub(*current.AutoDisabledAt) < cooldown {
			continue
		}
		platform, link := socialVideoParseSampleLink(api, settings, "")
		if link == "" {
			s.releaseSocialVideoParseAPI(api, max(settings.FailureThreshold-1, 0))
			continue
		}
		secret, err := s.decryptSettingSecret(api.Secret)
		if err != nil {
			continue
		}
		api.Secret = secret
		result, failure := s.runSocialVideoParseTest(ctx, api, platform, link)
		s.recordSocialVideoParseOutcome(api, platform, "health", time.Duration(result.LatencyMs)*time.Millisecond, failure, true)
	}
}

func (s *Service) releaseSocialVideoParseAPI(api socialVideoParseAPI, failures int) {
	now := time.Now().UTC()
	_, err := updateSettingJSON(s, socialVideoParseStateKey, "", func(state *socialVideoParseState) error {
		current := state.APIs[api.ID]
		if current == nil || !current.AutoDisabled {
			return nil
		}
		current.AutoDisabled, current.AutoDisabledAt, current.AutoDisabledReason, current.ConsecutiveFailures = false, nil, "", failures
		state.Logs = append([]SocialVideoParseLog{{At: now, APIID: api.ID, APIName: api.Name, Kind: "health", OK: true, Message: "冷却期满，没有测试链接，先放行试探"}}, state.Logs...)
		if len(state.Logs) > socialVideoParseMaxLogs {
			state.Logs = state.Logs[:socialVideoParseMaxLogs]
		}
		return nil
	})
	if err != nil {
		slog.Warn("放行视频解析接口失败", "api", api.ID, "error", err)
	}
}

// healthCheckSocialVideoParseAPIs 按设置的间隔测试开着的接口，结果一样计入连续失败和自动停用。
func (s *Service) healthCheckSocialVideoParseAPIs(ctx context.Context) {
	settings, err := s.socialVideoParseSettings()
	if err != nil || settings.HealthCheckMinutes <= 0 {
		return
	}
	apis, err := s.socialVideoParseAPIs()
	if err != nil {
		return
	}
	state, err := s.socialVideoParseState()
	if err != nil {
		return
	}
	interval := time.Duration(settings.HealthCheckMinutes) * time.Minute
	now := time.Now().UTC()
	checked := 0
	for _, api := range apis {
		current := state.APIs[api.ID]
		if ctx.Err() != nil || checked >= socialVideoParseHealthBatch {
			return
		}
		if !api.Enabled || current != nil && (current.AutoDisabled || current.LastCheckedAt != nil && now.Sub(*current.LastCheckedAt) < interval) {
			continue
		}
		platform, link := socialVideoParseSampleLink(api, settings, "")
		if link == "" {
			continue
		}
		secret, err := s.decryptSettingSecret(api.Secret)
		if err != nil {
			continue
		}
		api.Secret = secret
		checked++
		result, failure := s.runSocialVideoParseTest(ctx, api, platform, link)
		s.recordSocialVideoParseOutcome(api, platform, "health", time.Duration(result.LatencyMs)*time.Millisecond, failure, true)
	}
}

func (s *Service) syncDueSocialVideoParseSources(ctx context.Context) {
	sources, err := s.socialVideoParseSources()
	if err != nil {
		return
	}
	now := time.Now().UTC()
	for _, source := range sources {
		if ctx.Err() != nil {
			return
		}
		if !source.Enabled || source.LastSyncedAt != nil && now.Sub(*source.LastSyncedAt) < time.Duration(source.IntervalHours)*time.Hour {
			continue
		}
		if _, err := s.syncSocialVideoParseSource(ctx, "", source); err != nil {
			slog.Warn("同步视频解析接口订阅源失败", "source", source.ID, "error", err)
		}
	}
}
