package tool

// 电商生图台工具：只在 contextScope=["studio"] 的运行里出现，读写本轮绑定的那一个商品。
// 出图不由 Agent 提交：studio_request_generation 只把镜头交给页面，用户在生图台确认后才计费。
const (
	StudioGetState          = "studio_get_state"
	StudioInspectPhotos     = "studio_inspect_photos"
	StudioUpdateDossier     = "studio_update_dossier"
	StudioPlanShots         = "studio_plan_shots"
	StudioRequestGeneration = "studio_request_generation"
)

func studioPolicies() []Policy {
	return []Policy{
		{Name: StudioGetState, Kind: KindRead, RequiresStudio: true},
		{Name: StudioInspectPhotos, Kind: KindPrepare, Vision: true, RequiresStudio: true},
		{Name: StudioUpdateDossier, Kind: KindWrite, RequiresStudio: true},
		{Name: StudioPlanShots, Kind: KindWrite, RequiresStudio: true},
		{Name: StudioRequestGeneration, Kind: KindPrepare, RequiresStudio: true, RequiresWriteMode: true},
	}
}
