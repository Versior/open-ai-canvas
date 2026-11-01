package agentpet

import (
	"fmt"
	"regexp"
	"slices"
	"strings"
	"unicode/utf8"

	"yingce/backend/internal/kernel"
)

const (
	AccessFree  = "free"
	AccessVIP   = "vip"
	AccessPaid  = "paid"
	AccessSpend = "spend"
	// MaxPriceMicrocredits 是单个形象的价格和累计消费门槛上限（100 万积分）。
	MaxPriceMicrocredits int64 = 1_000_000 * 1_000_000
	maxGroupCodes              = 20
)

// Rows 是图集前 9 行的动作，下标即行号。
var Rows = []string{"idle", "running-right", "running-left", "waving", "jumping", "failed", "waiting", "running", "review"}

// States 是助手运行状态，状态映射只能覆盖这些键。
var States = []string{"idle", "queued", "running", "waiting_approval", "completed", "failed", "cancelled", "rejected"}

// Tones 是头顶气泡的说话风格，前端按风格选择语气；上传形象没有专属风格时用 gentle。
var Tones = []string{"gentle", "kitty", "puppy", "robot", "mystic", "sunny"}

const (
	maxLines     = 4
	maxLineRunes = 40
)

// NormalizeVoice 校验上传形象的说话风格和专属台词。风格为空表示通用（前端按温柔语气说话）；
// 台词去掉空行，最多 4 句、每句不超过 40 个字。
func NormalizeVoice(tone string, lines []string) (string, []string, error) {
	tone = strings.TrimSpace(tone)
	if tone != "" && !slices.Contains(Tones, tone) {
		return "", nil, kernel.BadAuthRequest("请选择有效的说话风格")
	}
	result := make([]string, 0, len(lines))
	for _, line := range lines {
		line = CleanText(line, maxLineRunes+1)
		if line == "" {
			continue
		}
		if utf8.RuneCountInString(line) > maxLineRunes {
			return "", nil, kernel.BadAuthRequest(fmt.Sprintf("每句台词不超过 %d 个字", maxLineRunes))
		}
		result = append(result, line)
	}
	if len(result) > maxLines {
		return "", nil, kernel.BadAuthRequest(fmt.Sprintf("专属台词最多 %d 句", maxLines))
	}
	return tone, result, nil
}

var groupCodePattern = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,39}$`)

// Access 是形象的开放方式。
// free：所有用户可用；vip：只有所选分组可用，不能购买；paid：用积分购买，所选分组免费使用；
// spend：累计消费达到门槛即可领取，所选分组免费使用。
type Access struct {
	Mode               string
	PriceMicrocredits  int64
	UnlockMicrocredits int64
	GroupCodes         []string
}

func NormalizeAccess(mode string, price int64, unlock int64, groups []string) (Access, error) {
	codes, err := normalizeGroupCodes(groups)
	if err != nil {
		return Access{}, err
	}
	switch strings.TrimSpace(mode) {
	case AccessFree:
		return Access{Mode: AccessFree, GroupCodes: []string{}}, nil
	case AccessVIP:
		if len(codes) == 0 {
			return Access{}, kernel.BadAuthRequest("VIP 专享形象至少要选择一个用户分组")
		}
		return Access{Mode: AccessVIP, GroupCodes: codes}, nil
	case AccessPaid:
		if price <= 0 || price > MaxPriceMicrocredits {
			return Access{}, kernel.BadAuthRequest("付费形象的价格须大于 0 且不超过 100 万积分")
		}
		return Access{Mode: AccessPaid, PriceMicrocredits: price, GroupCodes: codes}, nil
	case AccessSpend:
		if unlock <= 0 || unlock > MaxPriceMicrocredits {
			return Access{}, kernel.BadAuthRequest("累计消费门槛须大于 0 且不超过 100 万积分")
		}
		return Access{Mode: AccessSpend, UnlockMicrocredits: unlock, GroupCodes: codes}, nil
	}
	return Access{}, kernel.BadAuthRequest("请选择有效的开放方式")
}

func normalizeGroupCodes(groups []string) ([]string, error) {
	codes := make([]string, 0, len(groups))
	for _, group := range groups {
		code := strings.ToLower(strings.TrimSpace(group))
		if !groupCodePattern.MatchString(code) {
			return nil, kernel.BadAuthRequest("用户分组编码无效")
		}
		if !slices.Contains(codes, code) {
			codes = append(codes, code)
		}
	}
	if len(codes) > maxGroupCodes {
		return nil, kernel.BadAuthRequest("最多选择 20 个用户分组")
	}
	slices.Sort(codes)
	return codes, nil
}

// NormalizeStateRows 校验“助手状态 → 图集动作”的覆盖项，未覆盖的状态使用前端默认映射。
func NormalizeStateRows(rows map[string]string) (map[string]string, error) {
	result := make(map[string]string, len(rows))
	for state, row := range rows {
		if !slices.Contains(States, state) || !slices.Contains(Rows, row) {
			return nil, kernel.BadAuthRequest("状态映射包含无效的状态或动作")
		}
		result[state] = row
	}
	return result, nil
}

// Entitlement 是某个用户对形象的使用资格。Claimable 表示累计消费已达标、尚未领取。
type Entitlement struct {
	Usable      bool
	MemberFree  bool
	Purchasable bool
	Claimable   bool
}

// Entitle 按开放方式、用户分组、是否已拥有和累计消费计算资格；已拥有的形象始终可用。
func Entitle(access Access, groupCode string, owned bool, consumedMicrocredits int64) Entitlement {
	member := slices.Contains(access.GroupCodes, groupCode)
	switch access.Mode {
	case AccessFree:
		return Entitlement{Usable: true}
	case AccessVIP:
		return Entitlement{Usable: owned || member}
	case AccessPaid, AccessSpend:
		if owned {
			return Entitlement{Usable: true}
		}
		if member {
			return Entitlement{Usable: true, MemberFree: true}
		}
		if access.Mode == AccessPaid {
			return Entitlement{Purchasable: true}
		}
		if consumedMicrocredits >= access.UnlockMicrocredits {
			return Entitlement{Usable: true, Claimable: true}
		}
		return Entitlement{}
	}
	return Entitlement{Usable: owned}
}
