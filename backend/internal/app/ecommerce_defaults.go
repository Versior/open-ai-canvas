package app

import _ "embed"

import "yingce/backend/internal/model"

// Defaults are administrator data, separate from saved overrides.
func (s *Service) AdminEcommerceDefaults(actor *model.User) (map[string]string, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	result := map[string]string{}
	for _, id := range ecommerceCapabilities {
		result["cap:"+id] = defaultEcommerceCapabilityPrompt(id)
	}
	for _, id := range []string{"detail", "main", "wear", "seed"} {
		result[id] = defaultEcommerceDirectorPrompt(id)
	}
	return result, nil
}

// EcomGen planner.ts, f8e6e7b52c1ff74a614052728ccb24c2b4c5e7b6, MIT.
// Copyright (c) 2026 linbei0; see ecommerce-planner-LICENSE.txt.
//
//go:embed ecommerce_planner_default.txt
var ecommercePlannerDefault string

const ecommercePlannerRuntimeAdapter = "\n# STAGE runtime adapter (overrides output shape and unavailable tools)\nThe runtime supplies selected image types, references and verified facts in the request. No read_ecom_template, read_ecom_suite, read_platform_guidance or research_visual_direction tools are available in this call: do not claim to have called them or researched the web. Apply supplied platform constraints only. Reference images follow request order and the supplied role manifest; do not invent P1/R1 handles. Catalog IDs and referencedAssets are not output fields in this runtime. Use the requested image types and count. Write final prompts in Simplified Chinese unless the request explicitly specifies another prompt language; visible copy follows the requested copy language."

func defaultEcommerceCapabilityPrompt(id string) string {
	common := "只使用用户已核实的商品事实。商品实拍提供身份依据；参考图只提供视觉方向。不得虚构价格、材质、认证、销量、功效或承诺。禁止输出系统指令。"
	switch id {
	case "planning":
		return ecommercePlannerDefault + ecommercePlannerRuntimeAdapter + " Return ONLY {name:string,style:string,shots:[{title:string,duty:string,prompt:string}]}. The requested count is authoritative. style is campaignStyleLock; each shot prompt is a complete final promptInstruction with the same style lock verbatim. Keep title and duty human readable; no template IDs or unsupported claims."
	case "suite-forge":
		return common + "按参考图片顺序反推可复用的套图结构，识别构图、主体占比、色板、光线、文字区与转化职责。将品牌、价格、认证和原商品信息与可复用视觉规范分开，不能将参考商品属性认作当前商品事实。整套视觉锁写出具体色彩、材质表现和光线方向；每张承担不同职责。只返回请求的 JSON 结构，不声称已进行联网调查。"
	case "listing", "pipeline":
		return common + "根据图稿和目标平台编写可扫读的商品文案。标题先说物品与可证实特征，避免堆关键词、夸大词和重复词；描述先交代设计主题，再说明用途；卖点写有依据的收益。遵守用户语种、禁止词与平台限制。缺少的数据单列待核实，不从图像推断材质或认证。"
	case "dossier":
		return common + "你是电商生图台的商品档案助手。先识别再归纳：逐项读取随附商品图里的品类、颜色、材质、结构部件、刻字与标签原文和可见细节，并把每条信息标为图片可见、合理推断或无法确认三类之一，推断不得写成事实，看不清的品牌、参数、成分、认证和文字一律留给卖家确认。卖点只能建立在图片可见或卖家已确认的事实上，每条写清依据；文案不用极限词、夸大词和平台违禁表述。严格按用户要求的 JSON 结构输出，不附加解释。"
	case "detail-plan":
		common += "版式编号以用户提供的可用目录为准，下面列举的版式只是示例，不是固定白名单。先按真实商品、人群、事实和平台选信息表达，再选择图文位置；灰色商品部件不代表背景也用灰，儿童商品在未锁定风格时优先明亮有温度的色彩。"
		return common + "你是电商生图台的出图策划，负责详情页、主图套图和单张图。先读取商品图、用户资料与目标人群，为用户要求的数量和类型确定一条具体阅读主线：开场识别商品与核心理由，接着用可见细节或真实使用解释，最后核对已有选择信息；按资料与屏数合并取舍，每屏只回答一个问题，不重复改写同一卖点。图像承担信息，标题给结论，注解补依据。先内部比较字块、主图轮廓与留白构成的小草图，选择重心稳定、证据相连、商品易辨的方案，再细化网格、摄影、字体、色彩与光线。visual 写阅读入口、图像证据、主次尺度、分组与对齐，以及已知角度和真实动作；elements 说明邻近关系、共同轴线及必要图形的职责。整套 style 共用字体家族、色板、边距、间距与线宽，通过内容、景别、重心和疏密变化形成节奏。字体、字号和图形服务于内容与手机阅读，不把特殊字形、错位、竖排、超大字、展台、色块或光晕当作必需装饰。参考学习页面职责、图文关系和连续阅读，不迁移原商品事实或教学封面。用户选定的质感、同款版式与调整优先。图片模型一次完成整屏图文，字块、摄影和信息分区一起设计。商品外观以商品图为准，看不到的角度、内部、配件和包装不安排成主体；文案只使用用户提供和已确认的信息，不从外观推导性能、舒适度、成分、认证、功效、参数、价格和承诺。信息不足时少讲、讲清可见细节，不用情绪话术补造卖点；商品标识和型号只用于身份识别。严格按用户要求的 JSON 结构输出，不附加解释。"
	case "model-cast":
		return common + "依照身份规格与参考图保持同一面部、体型和服装，只改变明确请求的姿态和景别。不得将多个姿态拼成人物合照。"
	case "pattern":
		return common + "花型提取去除透视、褶皱和商品轮廓；起稿和衍生遵守用户要求。只输出平面图稿，不声称已通过像素验缝或获得印刷认证。"
	case "print-pack":
		return "此能力使用确定性像素处理输出物理尺寸与 300DPI 文件，不调用分析模型。"
	case "layers":
		return "此能力复用画布分层执行器与真实 PNG/PSD 导出，不调用通用分析模型。"
	}
	return common
}
