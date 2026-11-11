package app

import (
	"context"
	"testing"

	"yingce/backend/internal/model"
)

func TestVideoTrendAccountConfigurationRequiresAdmin(t *testing.T) {
	svc, _, _, _ := newAdminStorageDeleteTestService(t)
	user := &model.User{ID: "viewer", Role: model.UserRoleUser}
	if _, err := svc.VideoCreationTrendConnection(user, "qianchuan"); err == nil {
		t.Fatal("ordinary user can read platform account configuration")
	}
	if _, err := svc.ConnectVideoCreationTrends(context.Background(), user, "qianchuan", VideoTrendConnectionRequest{AdvertiserID: "123", AccessToken: "EXAMPLE_ACCESS"}); err == nil {
		t.Fatal("ordinary user can change platform account")
	}
	if _, err := svc.StartVideoTrendAuthorization(user, "qianchuan"); err == nil {
		t.Fatal("ordinary user can start site account authorization")
	}
}
