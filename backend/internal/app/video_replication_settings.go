package app

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"yingce/backend/internal/model"
)

// 视频复刻的后台设置存在 system_settings 的 video_replication_settings：拆解的时长上限、镜头数上限、
// 是否识别口播。功能本身和链接导入的开关在功能开放配置里（videoReplicationEnabled / socialVideoImportEnabled）。
const (
	videoReplicationSettingsKey        = "video_replication_settings"
	videoReplicationMinDurationSeconds = 10
)

// VideoReplicationSettings 是视频复刻的后台设置；拆解任务创建和执行时都按它校验。
type VideoReplicationSettings struct {
	MaxDurationSeconds int  `json:"maxDurationSeconds"`
	MaxShots           int  `json:"maxShots"`
	TranscribeEnabled  bool `json:"transcribeEnabled"`
}

// VideoReplicationSettingsPatch 是后台修改设置的请求，没传的字段保持原值。
type VideoReplicationSettingsPatch struct {
	MaxDurationSeconds *int  `json:"maxDurationSeconds"`
	MaxShots           *int  `json:"maxShots"`
	TranscribeEnabled  *bool `json:"transcribeEnabled"`
}

// VideoReplicationTranscription 说明拆解时能不能识别口播；不能时 Note 写原因，口播改让模型从画面字幕读。
type VideoReplicationTranscription struct {
	Enabled           bool   `json:"enabled"`
	FeatureEnabled    bool   `json:"featureEnabled"`
	ServiceConfigured bool   `json:"serviceConfigured"`
	Available         bool   `json:"available"`
	Note              string `json:"note,omitempty"`
}

// VideoReplicationConfig 是视频复刻页面要用的限制：时长、镜头数上限，以及能不能识别口播。
type VideoReplicationConfig struct {
	MaxDurationSeconds  int    `json:"maxDurationSeconds"`
	MaxShots            int    `json:"maxShots"`
	TranscribeAvailable bool   `json:"transcribeAvailable"`
	TranscribeNote      string `json:"transcribeNote,omitempty"`
}

func defaultVideoReplicationSettings() VideoReplicationSettings {
	return VideoReplicationSettings{MaxDurationSeconds: socialVideoMaxDurationSeconds, MaxShots: videoTeardownMaxShotsLimit, TranscribeEnabled: true}
}

func validateVideoReplicationSettings(value VideoReplicationSettings) error {
	if value.MaxDurationSeconds < videoReplicationMinDurationSeconds || value.MaxDurationSeconds > socialVideoMaxDurationSeconds {
		return BadAuthRequest(fmt.Sprintf("视频时长上限必须在 %d 到 %d 秒之间", videoReplicationMinDurationSeconds, socialVideoMaxDurationSeconds))
	}
	if value.MaxShots < 1 || value.MaxShots > videoTeardownMaxShotsLimit {
		return BadAuthRequest(fmt.Sprintf("镜头数上限必须在 1 到 %d 之间", videoTeardownMaxShotsLimit))
	}
	return nil
}

// videoReplicationSettings 读出设置：没有这一行时用默认值，缺字段的配置以默认值为底；
// 存的数为 0 时用默认值、超出允许范围时收回范围内，不让拆解因为一条旧配置全部失败。读库失败直接报错，不用默认值顶替。
func (s *Service) videoReplicationSettings() (VideoReplicationSettings, error) {
	value := defaultVideoReplicationSettings()
	row, err := s.repo.SystemSettingOptional(videoReplicationSettingsKey)
	if err != nil {
		return VideoReplicationSettings{}, err
	}
	if row != nil && strings.TrimSpace(row.ValueJSON) != "" {
		if err := json.Unmarshal([]byte(row.ValueJSON), &value); err != nil {
			return VideoReplicationSettings{}, fmt.Errorf("读取视频复刻设置失败: %w", err)
		}
	}
	value.MaxDurationSeconds = clampInt(value.MaxDurationSeconds, videoReplicationMinDurationSeconds, socialVideoMaxDurationSeconds, socialVideoMaxDurationSeconds)
	value.MaxShots = clampInt(value.MaxShots, 1, videoTeardownMaxShotsLimit, videoTeardownMaxShotsLimit)
	return value, nil
}

// UpdateVideoReplicationSettings 按请求里给出的字段修改设置，按读到的原文比较写回，并记管理审计。
func (s *Service) UpdateVideoReplicationSettings(actor *model.User, patch VideoReplicationSettingsPatch) (VideoReplicationSettings, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return VideoReplicationSettings{}, err
	}
	before, err := s.videoReplicationSettings()
	if err != nil {
		return VideoReplicationSettings{}, err
	}
	saved, err := updateSettingJSON(s, videoReplicationSettingsKey, actor.ID, func(current *VideoReplicationSettings) error {
		next := *current
		if next.MaxShots == 0 {
			// 表里还没有这一行时 current 是零值，从默认值起步；写入总是带齐三个字段，存过的镜头数上限不会是 0。
			next = defaultVideoReplicationSettings()
		}
		if patch.MaxDurationSeconds != nil {
			next.MaxDurationSeconds = *patch.MaxDurationSeconds
		}
		if patch.MaxShots != nil {
			next.MaxShots = *patch.MaxShots
		}
		if patch.TranscribeEnabled != nil {
			next.TranscribeEnabled = *patch.TranscribeEnabled
		}
		if err := validateVideoReplicationSettings(next); err != nil {
			return err
		}
		*current = next
		return nil
	})
	if err != nil {
		return VideoReplicationSettings{}, err
	}
	if err := s.appendAdminAudit(actor, "video_replication.settings.update", "system_setting", videoReplicationSettingsKey, "更新视频复刻设置", map[string]any{"before": before, "after": saved}); err != nil {
		return VideoReplicationSettings{}, err
	}
	return saved, nil
}

func (s *Service) videoReplicationTranscription(settings VideoReplicationSettings) (VideoReplicationTranscription, error) {
	featureEnabled, err := s.FeatureEnabled(FeatureTimelineTranscription)
	if err != nil {
		return VideoReplicationTranscription{}, err
	}
	status := VideoReplicationTranscription{Enabled: settings.TranscribeEnabled, FeatureEnabled: featureEnabled, ServiceConfigured: strings.TrimSpace(os.Getenv(whisperLangEnv)) != ""}
	switch {
	case !status.Enabled:
		status.Note = "后台已关闭口播识别，口播从画面字幕识别"
	case !status.FeatureEnabled:
		status.Note = "字幕转写暂未开放，口播从画面字幕识别"
	case !status.ServiceConfigured:
		status.Note = "服务器没有配置转写服务，口播从画面字幕识别"
	default:
		status.Available = true
	}
	return status, nil
}

// VideoReplicationConfig 给视频复刻页面：功能关闭时和其他视频复刻接口一样返回 403。
func (s *Service) VideoReplicationConfig() (*VideoReplicationConfig, error) {
	if err := s.RequireFeature(FeatureVideoReplication); err != nil {
		return nil, err
	}
	settings, err := s.videoReplicationSettings()
	if err != nil {
		return nil, err
	}
	transcription, err := s.videoReplicationTranscription(settings)
	if err != nil {
		return nil, err
	}
	return &VideoReplicationConfig{MaxDurationSeconds: settings.MaxDurationSeconds, MaxShots: settings.MaxShots, TranscribeAvailable: transcription.Available, TranscribeNote: transcription.Note}, nil
}

// videoReplicationDurationLabel 把秒数写成「3 分钟」「45 秒」「1 分 30 秒」，用在超时长的提示里。
func videoReplicationDurationLabel(seconds int) string {
	switch {
	case seconds >= 60 && seconds%60 == 0:
		return fmt.Sprintf("%d 分钟", seconds/60)
	case seconds < 60:
		return fmt.Sprintf("%d 秒", seconds)
	default:
		return fmt.Sprintf("%d 分 %d 秒", seconds/60, seconds%60)
	}
}

func videoReplicationDurationError(seconds int) string {
	return "视频超过 " + videoReplicationDurationLabel(seconds) + "，请先截取片段再拆解"
}
