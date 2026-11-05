package app

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime/multipart"
	"os"
	"path/filepath"
	"strings"

	"gorm.io/gorm"

	"yingce/backend/internal/model"
)

// 视频复刻的口播识别可以走后台选的转写模型：系统渠道里 OpenAI Audio 协议的音频模型，
// 调 OpenAI 兼容的 POST /audio/transcriptions（whisper-1 这类返回 verbose_json 分句时间的模型）。
// 出站经过渠道并发、熔断、SSRF 和调用日志，不建计费订单，费用由平台承担。

const videoTeardownTranscribeOperation = "video_teardown_transcribe"

type videoReplicationTranscriptionChoice struct {
	ChannelModelID string
	ChannelID      string
	ModelKey       string
	ProxyURL       string
	Label          string
}

// videoReplicationTranscriptionModel 查后台选的转写模型现在能不能用。没选时三个返回值都为空；
// 不能用时第二个返回值写原因（面向管理员）；只有读库出错才返回 error。
func (s *Service) videoReplicationTranscriptionModel(id string) (*videoReplicationTranscriptionChoice, string, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return nil, "", nil
	}
	item, err := s.repo.ChannelModel(id)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, "选的转写模型已删除", nil
	}
	if err != nil {
		return nil, "", err
	}
	if item.Capability != "audio" || item.Protocol != model.ChannelInterfaceOpenAIAudio {
		return nil, "转写模型要选 OpenAI Audio 协议的音频模型", nil
	}
	if !item.Enabled {
		return nil, "选的转写模型已停用", nil
	}
	channels, err := s.repo.SystemChannelsByIDs([]string{item.ChannelID}, true)
	if err != nil {
		return nil, "", err
	}
	if len(channels) != 1 {
		return nil, "转写模型所在的渠道已删除", nil
	}
	if !channels[0].Enabled {
		return nil, "转写模型所在的渠道已停用", nil
	}
	label := firstNonEmpty(strings.TrimSpace(item.DisplayName), item.ModelKey) + " · " + channels[0].Name
	return &videoReplicationTranscriptionChoice{ChannelModelID: item.ID, ChannelID: item.ChannelID, ModelKey: item.ModelKey, ProxyURL: channels[0].ProxyURL, Label: label}, "", nil
}

// transcribeWithChannelModel 把 16k 单声道 wav 发给转写模型，按分句时间返回口播。
// 模型只返回整段文字、没有分句时间时报错：口播要按时间分给镜头，整段文字分不了。
func (s *Service) transcribeWithChannelModel(ctx context.Context, task *model.Task, choice videoReplicationTranscriptionChoice, wavPath, language string) ([]timelineTranscriptionSegment, string, error) {
	config, err := s.resolveProviderConfig(providerConfig{ChannelID: choice.ChannelID, ChannelModelKey: choice.ModelKey, Model: choice.ModelKey})
	if err != nil {
		return nil, "", err
	}
	// OpenAI 的 language 只认 ISO-639-1，zh-CN 这类写法取主语言。
	language, _, _ = strings.Cut(strings.TrimSpace(language), "-")
	body, contentType, err := videoTeardownTranscriptionForm(wavPath, config.Model, language)
	if err != nil {
		return nil, "", err
	}
	ctx = context.WithValue(ctx, providerAnalyticsKey{}, providerAnalyticsContext{
		Service: s, UserID: task.UserID, TaskID: task.ID, TraceID: task.TraceID, RequestID: task.RequestID,
		ChannelID: choice.ChannelID, ProxyURL: choice.ProxyURL, Capability: "audio", Operation: videoTeardownTranscribeOperation, Model: choice.ModelKey,
	})
	var payload map[string]interface{}
	if err := postForm(ctx, config, "/audio/transcriptions", contentType, body, &payload); err != nil {
		return nil, "", err
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return nil, "", err
	}
	segments, detected, err := decodeWhisperVerboseJSON(raw)
	if err != nil {
		return nil, "", err
	}
	if len(segments) == 0 {
		if strings.TrimSpace(stringField(payload, "text")) != "" {
			return nil, "", errors.New("转写模型没有返回分句时间，请换支持 verbose_json 的模型，比如 whisper-1")
		}
		return nil, "", errors.New("没有识别出口播")
	}
	return segments, detected, nil
}

func videoTeardownTranscriptionForm(wavPath, modelName, language string) (*bytes.Buffer, string, error) {
	audio, err := os.Open(wavPath)
	if err != nil {
		return nil, "", errors.New("读取待转写音频失败")
	}
	defer audio.Close()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", filepath.Base(wavPath))
	if err != nil {
		return nil, "", err
	}
	if _, err := io.Copy(part, audio); err != nil {
		return nil, "", errors.New("读取待转写音频失败")
	}
	fields := [][2]string{{"model", modelName}, {"response_format", "verbose_json"}, {"timestamp_granularities[]", "segment"}}
	if language != "" && language != "auto" {
		fields = append(fields, [2]string{"language", language})
	}
	for _, field := range fields {
		if err := writer.WriteField(field[0], field[1]); err != nil {
			return nil, "", err
		}
	}
	if err := writer.Close(); err != nil {
		return nil, "", err
	}
	return &body, writer.FormDataContentType(), nil
}
