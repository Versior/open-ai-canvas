package app

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/model"
)

func guestCatalogPrice(catalog *ModelCatalogResponse, channelID, modelKey string) (int64, bool) {
	for _, channel := range catalog.Channels {
		for _, item := range channel.Models {
			if channel.ID == channelID && item.ModelKey == modelKey && len(item.PriceTiers) > 0 {
				return item.PriceTiers[0].UnitPriceMicrocredits, true
			}
		}
	}
	return 0, false
}

// 游客目录与默认分组用户看到的一致，并在缓存期内复用同一份结果。
func TestGuestModelCatalogMatchesDefaultGroupAndIsCached(t *testing.T) {
	s, _, _, _ := creationTestService(t)
	guest, err := s.GuestModelCatalog()
	if err != nil {
		t.Fatal(err)
	}
	price, visible := guestCatalogPrice(guest, "channel", "text-test")
	if !visible || price != 100 || guest.Source != ModelCatalogSourceSystem {
		t.Fatalf("guest catalog price = %d visible=%v source=%s", price, visible, guest.Source)
	}
	user, err := s.repo.User("user")
	if err != nil {
		t.Fatal(err)
	}
	userCatalog, err := s.ModelCatalogForUser(user, nil)
	if err != nil {
		t.Fatal(err)
	}
	if userPrice, _ := guestCatalogPrice(userCatalog, "channel", "text-test"); userPrice != price {
		t.Fatalf("guest price %d differs from default group user price %d", price, userPrice)
	}
	again, err := s.GuestModelCatalog()
	if err != nil || again != guest {
		t.Fatalf("guest catalog should be served from cache within the TTL: %v", err)
	}
	encoded, _ := json.Marshal(guest)
	if strings.Contains(string(encoded), "受控测试") {
		t.Fatal("guest catalog leaked the internal channel name")
	}
}

// 游客按默认分组的渠道可见性过滤，不能像 systemGroupAccess 那样放开全部渠道。
func TestGuestModelCatalogRespectsDefaultGroupVisibility(t *testing.T) {
	s, _, _, _ := creationTestService(t)
	admin := &model.User{ID: "guest-admin", Role: model.UserRoleAdmin}
	if _, err := s.resolvedUserGroup(model.DefaultUserGroupCode); err != nil {
		t.Fatal(err)
	}
	group, err := s.repo.UserGroupByCode(model.DefaultUserGroupCode)
	if err != nil {
		t.Fatal(err)
	}
	restricted := UserGroupRequest{Name: group.Name, BadgeLabel: group.BadgeLabel, BadgeStyle: group.BadgeStyle, RatioBasisPoints: group.RatioBasisPoints, PointsPerUSD: group.PointsPerUSD, PointsPerCNY: group.PointsPerCNY, AllChannels: false, ChannelIDs: []string{}}
	if _, err := s.UpdateUserGroup(admin, group.ID, restricted); err != nil {
		t.Fatal(err)
	}
	guest, err := s.GuestModelCatalog()
	if err != nil {
		t.Fatal(err)
	}
	if _, visible := guestCatalogPrice(guest, "channel", "text-test"); visible {
		t.Fatal("channel hidden from the default group must stay hidden from guests")
	}
}

func TestGuestFeatureAvailabilityOmitsOperatorFields(t *testing.T) {
	s, _, _, _ := creationTestService(t)
	if err := s.repo.SaveSystemSetting(&model.SystemSetting{Key: "feature_availability", ValueJSON: `{"ecommerceStudioEnabled":true}`, UpdatedBy: "secret-admin"}); err != nil {
		t.Fatal(err)
	}
	value, err := s.GuestFeatureAvailability()
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(value)
	if !value.EcommerceStudioEnabled || !value.Configured || strings.Contains(string(encoded), "updatedBy") || strings.Contains(string(encoded), "updatedAt") || strings.Contains(string(encoded), "secret-admin") {
		t.Fatalf("guest features = %s", encoded)
	}
}

func TestGuestReadCacheExpiresAndBoundsKeys(t *testing.T) {
	cache := &guestReadCache{entries: map[string]guestReadCacheEntry{}}
	now := time.Now()
	cache.put("key", "value", now)
	if value, ok := cache.get("key", now.Add(guestReadCacheTTL-time.Second)); !ok || value != "value" {
		t.Fatal("entry should be served within the TTL")
	}
	if _, ok := cache.get("key", now.Add(guestReadCacheTTL)); ok {
		t.Fatal("entry should expire after the TTL")
	}
	for index := 0; index < guestReadCacheMaxKeys*2; index++ {
		cache.put(fmt.Sprintf("keyword-%d", index), index, now)
	}
	if len(cache.entries) > guestReadCacheMaxKeys {
		t.Fatalf("cache grew to %d keys", len(cache.entries))
	}
}
