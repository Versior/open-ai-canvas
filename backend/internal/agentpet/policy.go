package agentpet

import (
	"regexp"
	"slices"
	"strings"

	"yingce/backend/internal/kernel"
)

const (
	AccessFree = "free"
	AccessVIP  = "vip"
	AccessPaid = "paid"
	// MaxPriceMicrocredits 是单个形象的价格上限（100 万积分）。
	MaxPriceMicrocredits int64 = 1_000_000 * 1_000_000
	maxGroupCodes              = 20
)

// Rows 是图集前 9 行的动作，下标即行号。
var Rows = []string{"idle", "running-right", "running-left", "waving", "jumping", "failed", "waiting", "running", "review"}

// States 是助手运行状态，状态映射只能覆盖这些键。
var States = []string{"idle", "queued", "running", "waiting_approval", "completed", "failed", "cancelled", "rejected"}

var groupCodePattern = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,39}$`)

// Access 是形象的开放方式。
// free：所有用户可用；vip：只有所选分组可用，不能购买；paid：用积分购买，所选分组免费使用。
type Access struct {
	Mode              string
	PriceMicrocredits int64
	GroupCodes        []string
}

func NormalizeAccess(mode string, price int64, groups []string) (Access, error) {
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

// Entitlement 是某个用户对形象的使用资格。
type Entitlement struct {
	Usable      bool
	MemberFree  bool
	Purchasable bool
}

// Entitle 按开放方式、用户分组和是否已购买计算资格；已购买的形象始终可用。
func Entitle(access Access, groupCode string, owned bool) Entitlement {
	member := slices.Contains(access.GroupCodes, groupCode)
	switch access.Mode {
	case AccessFree:
		return Entitlement{Usable: true}
	case AccessVIP:
		return Entitlement{Usable: owned || member}
	case AccessPaid:
		if owned {
			return Entitlement{Usable: true}
		}
		if member {
			return Entitlement{Usable: true, MemberFree: true}
		}
		return Entitlement{Purchasable: true}
	}
	return Entitlement{Usable: owned}
}
