package agentpet

import (
	"strings"
	"testing"
	"time"
)

func TestMerchandiseLabelsAndVoice(t *testing.T) {
	if label, err := NormalizeLabel("  猫咪\t精选 ", MaxCategoryRunes, "分类"); err != nil || label != "猫咪 精选" {
		t.Fatalf("label = %q, %v", label, err)
	}
	if _, err := NormalizeLabel(strings.Repeat("长", MaxBadgeRunes+1), MaxBadgeRunes, "角标"); err == nil {
		t.Fatal("over-long badge accepted")
	}
	if tone, lines, err := NormalizeVoice("kitty", []string{" 喵～ ", "", "  ", "今天也要加油"}); err != nil || tone != "kitty" || strings.Join(lines, "|") != "喵～|今天也要加油" {
		t.Fatalf("voice = %q %v %v", tone, lines, err)
	}
	if tone, lines, err := NormalizeVoice("", nil); err != nil || tone != "" || lines == nil || len(lines) != 0 {
		t.Fatalf("default voice = %q %v %v", tone, lines, err)
	}
	for name, input := range map[string]struct {
		tone  string
		lines []string
	}{
		"unknown tone":   {"dragon", nil},
		"too many lines": {"gentle", []string{"1", "2", "3", "4", "5"}},
		"line too long":  {"gentle", []string{strings.Repeat("话", 41)}},
	} {
		if _, _, err := NormalizeVoice(input.tone, input.lines); err == nil {
			t.Errorf("%s accepted", name)
		}
	}
}

func TestPromotionPolicy(t *testing.T) {
	now := time.Date(2026, 11, 1, 12, 0, 0, 0, time.UTC)
	at := func(hours int) *time.Time {
		value := now.Add(time.Duration(hours) * time.Hour)
		return &value
	}
	paid, _ := NormalizeAccess(AccessPaid, 10_000_000, 0, nil)
	free, _ := NormalizeAccess(AccessFree, 0, 0, nil)

	if promo, err := NormalizePromotion(free, Promotion{}, now); err != nil || promo.Enabled {
		t.Fatalf("disabled promotion = %+v, %v", promo, err)
	}
	for name, input := range map[string]struct {
		access Access
		promo  Promotion
	}{
		"not paid":          {free, Promotion{Enabled: true, PriceMicrocredits: 0}},
		"not cheaper":       {paid, Promotion{Enabled: true, PriceMicrocredits: 10_000_000}},
		"negative":          {paid, Promotion{Enabled: true, PriceMicrocredits: -1}},
		"already over":      {paid, Promotion{Enabled: true, PriceMicrocredits: 1, EndsAt: at(0)}},
		"ends before start": {paid, Promotion{Enabled: true, PriceMicrocredits: 1, StartsAt: at(5), EndsAt: at(4)}},
		"longer than year":  {paid, Promotion{Enabled: true, PriceMicrocredits: 1, EndsAt: at(24*367 + 1)}},
		"label too long":    {paid, Promotion{Enabled: true, PriceMicrocredits: 1, Label: "超级无敌限时大促销活动"}},
	} {
		if _, err := NormalizePromotion(input.access, input.promo, now); err == nil {
			t.Errorf("%s accepted", name)
		}
	}
	sale, err := NormalizePromotion(paid, Promotion{Enabled: true, PriceMicrocredits: 6_000_000, EndsAt: at(48)}, now)
	if err != nil || sale.Label != "限时特惠" || sale.StartsAt != nil || !sale.EndsAt.Equal(*at(48)) {
		t.Fatalf("sale = %+v, %v", sale, err)
	}
	gift, err := NormalizePromotion(paid, Promotion{Enabled: true, Label: "双十一", StartsAt: at(2)}, now)
	if err != nil || gift.Label != "双十一" || gift.PriceMicrocredits != 0 {
		t.Fatalf("gift = %+v, %v", gift, err)
	}
	if gift, _ := NormalizePromotion(paid, Promotion{Enabled: true}, now); gift.Label != "限时免费" {
		t.Fatalf("free promotion label = %q", gift.Label)
	}

	if state := sale.State(now); state != PromoActive {
		t.Fatalf("sale state = %s", state)
	}
	if state := sale.State(*at(48)); state != PromoEnded {
		t.Fatalf("sale state at end = %s", state)
	}
	if state := gift.State(now); state != PromoScheduled {
		t.Fatalf("gift state = %s", state)
	}
	if state := (Promotion{}).State(now); state != PromoNone {
		t.Fatalf("empty state = %s", state)
	}
	if price, promoted := EffectivePrice(paid, sale, now); price != 6_000_000 || !promoted {
		t.Fatalf("sale price = %d %v", price, promoted)
	}
	if price, promoted := EffectivePrice(paid, gift, now); price != 10_000_000 || promoted {
		t.Fatalf("scheduled price = %d %v", price, promoted)
	}
	if price, promoted := EffectivePrice(paid, gift, *at(3)); price != 0 || !promoted {
		t.Fatalf("free promotion price = %d %v", price, promoted)
	}
	if price, promoted := EffectivePrice(free, sale, now); price != 0 || promoted {
		t.Fatalf("free access price = %d %v", price, promoted)
	}

	for _, tc := range []struct {
		base    int64
		percent int
		want    int64
	}{
		{5_000_000, 80, 4_000_000},
		{12_500_000, 85, 10_630_000},
		{3_000_000, 0, 0},
		{10_000, 99, 10_000},
	} {
		if got, err := DiscountPrice(tc.base, tc.percent); err != nil || got != tc.want {
			t.Errorf("DiscountPrice(%d, %d) = %d, %v; want %d", tc.base, tc.percent, got, err, tc.want)
		}
	}
	if _, err := DiscountPrice(1_000_000, 100); err == nil {
		t.Fatal("100% discount accepted")
	}
}
