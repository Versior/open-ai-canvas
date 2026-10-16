package app

import (
	"testing"

	"infinite-canvas/backend/internal/model"
)

// 业务分类必须与前端 web/src/lib/asset-category.ts 的 ASSET_CATEGORIES 一一对应：
// 前端多出一个取值而这里漏改，用户选完分类保存会直接被拒。
func TestValidAssetCategoryMatchesFrontendContract(t *testing.T) {
	allowed := []model.AssetCategory{
		model.AssetCategoryCharacter,
		model.AssetCategoryEnvironment,
		model.AssetCategoryProp,
		model.AssetCategoryMaterial,
		model.AssetCategoryProduct,
		model.AssetCategoryOther,
	}
	for _, category := range allowed {
		if !validAssetCategory(category) {
			t.Fatalf("category %q must be accepted", category)
		}
	}
	rejected := []model.AssetCategory{"", "unknown", "ecommerce", "goods", "wardrobe", "style"}
	for _, category := range rejected {
		if validAssetCategory(category) {
			t.Fatalf("category %q must be rejected", category)
		}
	}
}
