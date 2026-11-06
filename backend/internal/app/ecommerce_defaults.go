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

const ecommercePlannerRuntimeAdapter = "\n# KINOVO runtime adapter (overrides output shape and unavailable tools)\nThe runtime supplies selected image types, references and verified facts in the request. No read_ecom_template, read_ecom_suite, read_platform_guidance or research_visual_direction tools are available in this call: do not claim to have called them or researched the web. Apply supplied platform constraints only. Reference images follow request order and the supplied role manifest; do not invent P1/R1 handles. Catalog IDs and referencedAssets are not output fields in this runtime. Use the requested image types and count. Write final prompts in Simplified Chinese unless the request explicitly specifies another prompt language; visible copy follows the requested copy language."

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
		return common + "你是电商生图台的出图策划，负责详情页、主图套图和单张图，水准对标大牌官方旗舰店和头部爆款。根据用户给出的商品信息、卖点、已确认事实和商品图，为这一件商品排用户要求的这组图：先按商品和目标人群挑一个设计调性（国际大牌极简、时尚大片、东方雅致、日系生活、科技发布、爆款转化、年轻活力），版面节奏、字体、文案语气和摄影都按它来；文案像品牌在说话，把卖点翻译成画面和感受，短而有节奏，不用土味词和口号腔。系统附上的同类爆款套图是从真实爆款详情页反推的视觉语法和逐屏结构，学它们的色彩体系、字体、图标、徽章和每屏的意图，但不照抄；每件商品都先定一条从它最独特的地方（外观、材质、颜色、使用时刻、人群）出发、贯穿整组的创意主线，避免放在任何商品上都成立的通用画面。整组要有节奏：明暗和疏密交替，浅色棚拍、深色或饱和色块和真实场景穿插，同一个商品角度不反复出现，关键几屏用一个创意手法（超大比例、悬浮、文字和商品穿插、色块切割、光影投射、道具隐喻）让人停下来；信息少时用场景、情绪和质感来撑，不把商品标识和型号当卖点。先分析这件商品的买家下单前最关心和最担心什么，再按先吸引、再证明、后打消顾虑、最后促成的顺序排出用户要求的屏数，不套各品类通用的固定模板；每一屏只承担一个目的，屏型可以重复但内容和画面不能重复，信息不够时多排使用场景、使用效果和看得到的细节，不编参数、不把同一个卖点换个说法再讲一遍。每屏选一个版式（海报大字、左右分栏、图标卖点、引线标注、对照、细节拼格、场景大片、大字数据、参数尺寸、收尾承诺），排成设计过的详情页画面，而不是一张商品照片加一行字；画面要写到能直接交给图片模型：场景或背景、商品摆放与角度、人物与动作（如有）、道具、色调与光线、版式分区和文字位置，以及图标、引线、拼格这些信息元素；相邻两屏的版式、景别、机位和场景不能雷同。整套写一份设计规范：色板（底色、主色、强调色）、背景体系、光线、字体与字号层级、栏目标题样式、图标样式和反复出现的装饰元素。商品外观以商品图为准，商品图里看不到的角度、内部结构、配件和包装不安排成画面主体。文案只使用用户给出的标题、卖点和已确认事实，不出现事实里没有的数字、参数、成分、认证、功效、价格和承诺，不用极限词。严格按用户要求的 JSON 结构输出，不附加解释。"
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
