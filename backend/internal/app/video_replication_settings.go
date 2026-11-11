package app

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"yingce/backend/internal/model"
)

// 视频复刻的后台设置存在 system_settings 的 video_replication_settings：拆解的时长上限、镜头数上限、
// 是否识别口播、用哪个转写模型。功能本身和链接导入的开关在功能开放配置里（videoReplicationEnabled / socialVideoImportEnabled）。
const (
	videoReplicationSettingsKey        = "video_replication_settings"
	videoReplicationMinDurationSeconds = 10
)

// VideoReplicationSettings 是视频复刻的后台设置；拆解任务创建和执行时都按它校验。
type VideoReplicationSettings struct {
	MaxDurationSeconds int  `json:"maxDurationSeconds"`
	MaxShots           int  `json:"maxShots"`
	TranscribeEnabled  bool `json:"transcribeEnabled"`
	// TranscriptionChannelModelID 是后台选的转写模型：系统渠道里 OpenAI Audio 协议的音频模型，
	// 调 /audio/transcriptions，费用由平台承担。空表示用服务器自建的 whisper.cpp 服务。
	TranscriptionChannelModelID string `json:"transcriptionChannelModelId"`
}

// VideoReplicationSettingsPatch 是后台修改设置的请求，没传的字段保持原值；转写模型传空字符串表示不用模型渠道。
type VideoReplicationSettingsPatch struct {
	MaxDurationSeconds          *int    `json:"maxDurationSeconds"`
	MaxShots                    *int    `json:"maxShots"`
	TranscribeEnabled           *bool   `json:"transcribeEnabled"`
	TranscriptionChannelModelID *string `json:"transcriptionChannelModelId"`
}

// VideoReplicationTranscription 说明拆解时能不能识别口播；不能时 Note 写原因，口播改让模型从画面字幕读。
// Engine 是实际会用的转写方式：channel（后台选的转写模型）或 whisper（服务器自建服务），都没有时为空。
type VideoReplicationTranscription struct {
	Enabled           bool   `json:"enabled"`
	FeatureEnabled    bool   `json:"featureEnabled"`
	ServiceConfigured bool   `json:"serviceConfigured"`
	Available         bool   `json:"available"`
	Engine            string `json:"engine,omitempty"`
	Model             string `json:"model,omitempty"`
	ModelIssue        string `json:"modelIssue,omitempty"`
	Note              string `json:"note,omitempty"`
}

// AdminVideoReplicationSettingsView 是后台设置页要的全部内容：当前设置，以及口播识别现在能不能用。
type AdminVideoReplicationSettingsView struct {
	Settings      VideoReplicationSettings      `json:"settings"`
	Transcription VideoReplicationTranscription `json:"transcription"`
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

// UnmarshalJSON 以默认值为底解码：存量配置里缺的字段（包括以后新加的）取默认值，
// 读设置和按字段修改都走这里，不会把缺的字段当成零值写回去。
func (value *VideoReplicationSettings) UnmarshalJSON(data []byte) error {
	type plain VideoReplicationSettings
	decoded := plain(defaultVideoReplicationSettings())
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	*value = VideoReplicationSettings(decoded)
	return nil
}

// normalizeStoredVideoReplicationSettings 收拢存量配置：为 0 的数用默认值，超出范围的收回范围内，
// 不让一条旧配置挡住拆解，也不挡住只改别的字段的后台修改。
func normalizeStoredVideoReplicationSettings(value VideoReplicationSettings) VideoReplicationSettings {
	value.MaxDurationSeconds = clampInt(value.MaxDurationSeconds, videoReplicationMinDurationSeconds, socialVideoMaxDurationSeconds, socialVideoMaxDurationSeconds)
	value.MaxShots = clampInt(value.MaxShots, 1, videoTeardownMaxShotsLimit, videoTeardownMaxShotsLimit)
	value.TranscriptionChannelModelID = strings.TrimSpace(value.TranscriptionChannelModelID)
	return value
}

// videoReplicationSettings 读出设置：没有这一行时用默认值。读库失败直接报错，不用默认值顶替。
func (s *Service) videoReplicationSettings() (VideoReplicationSettings, error) {
	value := defaultVideoReplicationSettings()
	row, err := s.repo.SystemSettingOptional(videoReplicationSettingsKey)
	if err != nil {
		return VideoReplicationSettings{}, err
	}
	if row != nil && strings.TrimSpace(row.ValueJSON) != "" {
		if err := json.Unmarshal([]byte(row.ValueJSON), &value); err != nil {
			return VideoReplicationSettings{}, fmt.Errorf("读取视频创作设置失败: %w", err)
		}
	}
	return normalizeStoredVideoReplicationSettings(value), nil
}

// AdminVideoReplicationSettings 给后台设置页单独读取设置和口播识别状态，不跑概览里的统计查询；
// 功能开关关着时也能读，方便先调好限制再开放。
func (s *Service) AdminVideoReplicationSettings(actor *model.User) (*AdminVideoReplicationSettingsView, error) {
	if err := s.RequireAdmin(actor); err != nil {
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
	return &AdminVideoReplicationSettingsView{Settings: settings, Transcription: transcription}, nil
}

// UpdateVideoReplicationSettings 按请求里给出的字段修改设置，按读到的原文比较写回；有变化时记管理审计。
func (s *Service) UpdateVideoReplicationSettings(actor *model.User, patch VideoReplicationSettingsPatch) (VideoReplicationSettings, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return VideoReplicationSettings{}, err
	}
	// 新选的转写模型保存前就要能用；清空（空字符串）表示改回服务器自建的转写服务。
	if patch.TranscriptionChannelModelID != nil {
		id := strings.TrimSpace(*patch.TranscriptionChannelModelID)
		if id != "" {
			_, issue, err := s.videoReplicationTranscriptionModel(id)
			if err != nil {
				return VideoReplicationSettings{}, err
			}
			if issue != "" {
				return VideoReplicationSettings{}, BadAuthRequest(issue)
			}
		}
		patch.TranscriptionChannelModelID = &id
	}
	// before 取自比较交换成功的那一轮读到的值，并发修改时审计记的也是真实的修改前。
	var before VideoReplicationSettings
	saved, err := updateSettingJSON(s, videoReplicationSettingsKey, actor.ID, func(current *VideoReplicationSettings) error {
		if *current == (VideoReplicationSettings{}) {
			// 表里还没有这一行时 current 是零值；有这一行时按默认值为底解码，不会是零值。
			*current = defaultVideoReplicationSettings()
		}
		before = normalizeStoredVideoReplicationSettings(*current)
		next := before
		if patch.MaxDurationSeconds != nil {
			next.MaxDurationSeconds = *patch.MaxDurationSeconds
		}
		if patch.MaxShots != nil {
			next.MaxShots = *patch.MaxShots
		}
		if patch.TranscribeEnabled != nil {
			next.TranscribeEnabled = *patch.TranscribeEnabled
		}
		if patch.TranscriptionChannelModelID != nil {
			next.TranscriptionChannelModelID = *patch.TranscriptionChannelModelID
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
	if saved == before {
		return saved, nil
	}
	if err := s.appendAdminAudit(actor, "video_replication.settings.update", "system_setting", videoReplicationSettingsKey, "更新视频创作设置", map[string]any{"before": before, "after": saved}); err != nil {
		return VideoReplicationSettings{}, err
	}
	return saved, nil
}

func (s *Service) videoReplicationTranscription(settings VideoReplicationSettings) (VideoReplicationTranscription, error) {
	featureEnabled, err := s.FeatureEnabled(FeatureTimelineTranscription)
	if err != nil {
		return VideoReplicationTranscription{}, err
	}
	selected, issue, err := s.videoReplicationTranscriptionModel(settings.TranscriptionChannelModelID)
	if err != nil {
		return VideoReplicationTranscription{}, err
	}
	status := VideoReplicationTranscription{Enabled: settings.TranscribeEnabled, FeatureEnabled: featureEnabled, ModelIssue: issue}
	switch {
	case selected != nil:
		status.Engine, status.Model = "channel", selected.Label
	case strings.TrimSpace(os.Getenv(whisperLangEnv)) != "":
		status.Engine = "whisper"
	}
	status.ServiceConfigured = status.Engine != ""
	switch {
	case !status.Enabled:
		status.Note = "后台已关闭口播识别，口播从画面字幕识别"
	case !status.FeatureEnabled:
		status.Note = "字幕转写暂未开放，口播从画面字幕识别"
	case !status.ServiceConfigured && issue != "":
		status.Note = "后台选的转写模型不可用，口播从画面字幕识别"
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
