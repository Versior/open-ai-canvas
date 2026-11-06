package model

// 时间线后台任务类型。与通用生成任务共用同一队列与 Claim 循环
// （ClaimNextTask 不按类型过滤），worker 在 processClaimedTask 顶部
// 按 Type 分叉到独立执行器，不走计费与模型渠道路由。
const (
	TaskTypeTimelineTranscription = "timeline_transcription"
	TaskTypeTimelineRender        = "timeline_render"
	TaskTypeSocialVideoImport     = "social_video_import"
	// 视频复刻的拆解准备：本地切镜、抽关键帧、拼宫格、可选转写。不以 video_ 开头，
	// 否则会按视频生成的超时处理。
	TaskTypeReplicationTeardown = "replication_teardown"
	// 商品视频（元素替换）的参考视频切段：本地按镜头切点把参考视频切成一次生成能覆盖的片段。
	TaskTypeProductVideoSplit = "product_video_split"
)
