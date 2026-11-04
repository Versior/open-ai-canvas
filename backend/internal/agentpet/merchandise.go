package agentpet

import (
	"fmt"
	"time"
	"unicode/utf8"

	"yingce/backend/internal/kernel"
)

// 商店展示：分类、角标和限时促销。
const (
	MaxCategoryRunes   = 12
	MaxBadgeRunes      = 6
	MaxPromoLabelRunes = 8
	// MaxPromoDuration 是一次促销的最长时间，避免误填成永久特价。
	MaxPromoDuration = 366 * 24 * time.Hour
)

const (
	PromoNone      = "none"
	PromoScheduled = "scheduled"
	PromoActive    = "active"
	PromoEnded     = "ended"
)

// NormalizeLabel 清理分类、角标这类短文本：去掉控制字符、压缩空白，超过上限时报错而不是静默截断。
func NormalizeLabel(value string, maxRunes int, field string) (string, error) {
	cleaned := CleanText(value, maxRunes+1)
	if utf8.RuneCountInString(cleaned) > maxRunes {
		return "", kernel.BadAuthRequest(fmt.Sprintf("%s不超过 %d 个字", field, maxRunes))
	}
	return cleaned, nil
}

// Promotion 是积分购买形象的限时促销：开启后在开始到结束时间内按促销价出售，促销价为 0 表示限时免费领取。
// 开始时间为空表示立即开始，结束时间为空表示管理员手动结束前一直有效。
type Promotion struct {
	Enabled           bool
	Label             string
	PriceMicrocredits int64
	StartsAt          *time.Time
	EndsAt            *time.Time
}

// State 返回促销在 now 时的状态。
func (p Promotion) State(now time.Time) string {
	switch {
	case !p.Enabled:
		return PromoNone
	case p.StartsAt != nil && now.Before(*p.StartsAt):
		return PromoScheduled
	case p.EndsAt != nil && !now.Before(*p.EndsAt):
		return PromoEnded
	}
	return PromoActive
}

// NormalizePromotion 校验促销：只有积分购买的形象可以促销，促销价须低于原价，结束时间晚于开始时间和现在。
// 关闭促销时清空其余字段。
func NormalizePromotion(access Access, input Promotion, now time.Time) (Promotion, error) {
	if !input.Enabled {
		return Promotion{}, nil
	}
	if access.Mode != AccessPaid {
		return Promotion{}, kernel.BadAuthRequest("只有积分购买的形象可以设置促销")
	}
	if input.PriceMicrocredits < 0 || input.PriceMicrocredits >= access.PriceMicrocredits {
		return Promotion{}, kernel.BadAuthRequest("促销价须低于原价，填 0 表示限时免费")
	}
	label, err := NormalizeLabel(input.Label, MaxPromoLabelRunes, "活动名称")
	if err != nil {
		return Promotion{}, err
	}
	if label == "" {
		label = "限时特惠"
		if input.PriceMicrocredits == 0 {
			label = "限时免费"
		}
	}
	startsAt, endsAt := utcTime(input.StartsAt), utcTime(input.EndsAt)
	if endsAt != nil {
		if !endsAt.After(now) {
			return Promotion{}, kernel.BadAuthRequest("促销结束时间必须晚于现在")
		}
		if startsAt != nil && !endsAt.After(*startsAt) {
			return Promotion{}, kernel.BadAuthRequest("促销结束时间必须晚于开始时间")
		}
		from := now
		if startsAt != nil && startsAt.After(now) {
			from = *startsAt
		}
		if endsAt.Sub(from) > MaxPromoDuration {
			return Promotion{}, kernel.BadAuthRequest("一次促销最长一年")
		}
	}
	return Promotion{Enabled: true, Label: label, PriceMicrocredits: input.PriceMicrocredits, StartsAt: startsAt, EndsAt: endsAt}, nil
}

// EffectivePrice 返回积分购买形象此刻的售价，以及是否正在促销。非积分购买的形象返回 0。
func EffectivePrice(access Access, promo Promotion, now time.Time) (int64, bool) {
	if access.Mode != AccessPaid {
		return 0, false
	}
	if promo.State(now) == PromoActive && promo.PriceMicrocredits < access.PriceMicrocredits {
		return promo.PriceMicrocredits, true
	}
	return access.PriceMicrocredits, false
}

// DiscountPrice 按百分比（1–99，表示原价的百分之几；0 表示免费）计算促销价，四舍五入到 0.01 积分。
func DiscountPrice(base int64, percent int) (int64, error) {
	if percent < 0 || percent > 99 {
		return 0, kernel.BadAuthRequest("折扣须在 0–9.9 折之间，0 表示限时免费")
	}
	const cent = 10_000
	return (base*int64(percent)/100 + cent/2) / cent * cent, nil
}

func utcTime(value *time.Time) *time.Time {
	if value == nil || value.IsZero() {
		return nil
	}
	utc := value.UTC()
	return &utc
}
