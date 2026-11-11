package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"yingce/backend/internal/model"
)

func TestAdminChannelModelMetadataReadOnlyAndPrivate(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	requests := 0
	testKey := "metadata-" + t.Name()
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		if r.URL.Path != "/v1/models" || r.Header.Get("Authorization") != "Bearer "+testKey {
			t.Error("metadata request did not use stored channel credentials and fixed models path")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"id":"video-test","model_type":"video","max_images":2,"default_parameters":{"duration_seconds":"12","resolution":"1080p"},"options":{"duration_seconds":[{"value":"5"},{"value":"12"}],"resolution":[{"value":"1080p"}]}}]}`))
	}))
	defer upstream.Close()
	svc, db := newChannelModelTestService(t)
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	channel := model.ModelChannel{ID: "metadata-channel", UserID: admin.ID, Scope: model.ChannelScopeSystem, BaseURL: upstream.URL + "/v1", APIKey: testKey, APIFormat: "openai", ModelsJSON: `[]`}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatal(err)
	}
	for _, actor := range []*model.User{nil, {ID: "regular", Role: model.UserRoleUser}} {
		if _, err := svc.AdminChannelModelMetadata(context.Background(), actor, channel.ID); err == nil {
			t.Fatal("metadata read must require an administrator")
		}
	}
	if requests != 0 {
		t.Fatal("unauthorized requests reached upstream")
	}
	items, err := svc.AdminChannelModelMetadata(context.Background(), admin, channel.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].ModelType != "video" || items[0].DefaultParameters.DurationSeconds != "12" || len(items[0].Options.DurationSeconds) != 2 || items[0].MaxImages == nil || *items[0].MaxImages != 2 {
		t.Fatal("upstream capability metadata was lost")
	}
	encoded, err := json.Marshal(items)
	if err != nil || strings.Contains(string(encoded), testKey) {
		t.Fatal("metadata response must not contain credentials")
	}
	var count int64
	if err := db.Model(&model.ChannelModel{}).Where("channel_id = ?", channel.ID).Count(&count).Error; err != nil || count != 0 {
		t.Fatal("metadata read unexpectedly imported models")
	}
	if err := db.Model(&model.ChannelCatalogSnapshot{}).Where("channel_id = ?", channel.ID).Count(&count).Error; err != nil || count != 0 {
		t.Fatal("metadata read unexpectedly changed the directory snapshot")
	}
	names, err := svc.PreviewAdminChannelModels(context.Background(), admin, channel.ID)
	if err != nil || len(names) != 1 || names[0] != items[0].ID {
		t.Fatal("existing directory preview changed")
	}
}

func TestAdminChannelModelMetadataReportsUpstreamFailure(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusBadGateway) }))
	defer upstream.Close()
	svc, db := newChannelModelTestService(t)
	channel := model.ModelChannel{ID: "failed-metadata", Scope: model.ChannelScopeSystem, BaseURL: upstream.URL + "/v1", APIKey: "metadata-" + t.Name(), APIFormat: "openai", ModelsJSON: `[]`}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatal(err)
	}
	items, err := svc.AdminChannelModelMetadata(context.Background(), &model.User{ID: "admin", Role: model.UserRoleAdmin}, channel.ID)
	if err == nil || items != nil {
		t.Fatal("upstream failure must not look like a successful empty catalog")
	}
}
