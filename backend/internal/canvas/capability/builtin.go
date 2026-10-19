package capability

import "yingce/backend/internal/canvas/contract"

const (
	maxAgentNodeTitleRunes   = 240
	maxAgentNodeContentRunes = 16000
	// 坐标绝对值上限：与 app 侧整理工具收敛几何值的范围一致。
	maxAgentNodeCoordLimit = 1e6
)

func BuiltinRegistry() *Registry {
	registry, err := NewRegistry([]Descriptor{
		{
			Type: "text", Version: "1", Label: "文本", DefaultWidth: 340, DefaultHeight: 240,
			Purpose:     "承载普通说明、创意草稿和单段提示词。",
			GoodFor:     []string{"单个创意", "一次性提示词", "临时备注", "快速试验"},
			NotIdealFor: []string{"多镜头脚本", "需要逐镜修改的内容", "需要镜头级资产关系的内容"},
			Tradeoffs:   []string{"创建和编辑最轻量", "没有镜头级字段和逐镜维护能力"},
			InputKind:   "text", Connection: ConnectionPolicy{CanSource: true}, CanUpdate: true,
			SummaryFields: []string{"content"}, DetailFields: []string{"content"},
			PatchFields: editableNodeFields("metadata.content", "正文", "节点正文"),
			CreateMetadata: func(content string) map[string]any {
				return map[string]any{"content": content, "status": "idle", "fontSize": float64(14)}
			},
		},
		{
			Type: "markdown", Version: "1", Label: "Markdown", DefaultWidth: 420, DefaultHeight: 320,
			Purpose:     "承载面向人阅读的方案、脚本草稿和格式化文档。",
			GoodFor:     []string{"创意方案", "脚本草稿", "交付文档", "需要排版的长文本"},
			NotIdealFor: []string{"需要逐镜生成或审核的多镜头内容", "需要绑定媒体资产的结构化流程"},
			Tradeoffs:   []string{"适合阅读和导出", "结构化程度低，不能替代可维护的分镜表"},
			InputKind:   "text", Connection: ConnectionPolicy{CanSource: true}, CanUpdate: true,
			SummaryFields: []string{"content"}, DetailFields: []string{"content"},
			PatchFields: editableNodeFields("metadata.content", "Markdown 正文", "Markdown 正文"),
		},
		{
			Type: "file", Version: "1", Label: "文本文件", DefaultWidth: 420, DefaultHeight: 320,
			Purpose:     "承载上传到画布的 TXT、Markdown 或其它文件资源；正文通过 canvas_read_text 在当前用户权限内读取。",
			GoodFor:     []string{"读取上传小说或剧本原文", "保留原始文件作为改编来源"},
			NotIdealFor: []string{"图片、视频或音频参考", "需要逐镜维护的结构化分镜"},
			Tradeoffs:   []string{"文件正文按需读取并分页返回", "二进制文件不会被当作文本解析"},
			InputKind:   "text", Connection: ConnectionPolicy{CanSource: true},
			SummaryFields: []string{"mimeType"}, DetailFields: []string{"mimeType"},
		},
		generatedMediaDescriptor("image", "2", "图片", 720, 405, "image", ConnectionPolicy{
			CanSource: true, CanTarget: true, CanReference: true, AcceptedInputKinds: []string{"text", "image", "character"},
		}),
		generatedMediaDescriptor("video", "2", "视频", 720, 405, "video", ConnectionPolicy{
			CanSource: true, CanTarget: true, CanReference: true, AcceptedInputKinds: []string{"text", "image", "video", "audio", "character"},
		}),
		generatedMediaDescriptor("audio", "2", "音频", 340, 120, "audio", ConnectionPolicy{
			CanSource: true, CanTarget: true, CanReference: true, MaxInputCount: 1, AcceptedInputKinds: []string{"text", "character"},
		}),
		characterDescriptor(),
		{
			Type: "frame", Version: "1", Label: "背板", DefaultWidth: 760, DefaultHeight: 520,
			Purpose:       "在画布上建立可移动、可折叠的视觉分区，用来归组相关节点；背板本身不承载创作正文或生成结果。",
			GoodFor:       []string{"按场景或镜头组归拢脚本、参考图和生成结果", "按前期策划、制作、交付等阶段划分工作区", "为大型画布建立清晰分区，便于移动或折叠整组内容"},
			NotIdealFor:   []string{"承载结构化镜头数据（应使用分镜脚本节点）", "存放需要 Agent 单独读写的正文（应使用文本或 Markdown 节点）", "替代具体业务节点或媒体生成节点"},
			Tradeoffs:     []string{"改善空间组织但不增加内容结构或生成能力"},
			SummaryFields: []string{"label"}, DetailFields: []string{"label"},
			CreateMetadata: func(string) map[string]any {
				return map[string]any{"frame": map[string]any{"collapsed": false, "expandedWidth": float64(760), "expandedHeight": float64(520)}}
			},
		},
		{
			Type: "batch-table", Version: "1", Label: "批量创作表", DefaultWidth: 1280, DefaultHeight: 560,
			Purpose:     "面向电商批量换装、创意生图和电商创作的结构化任务表；每行绑定最多六组画布图片、可用 @参考图1 等位置引用编写独立提示词，也可设置全局提示词覆盖各行，并追踪生成结果。电商创作把同一件商品的多视角实拍连到同一行，用提示词锁定商品外观后批量产出主图、场景图等物料。",
			GoodFor:     []string{"商品与模特批量换装", "同一商品多场景创意图", "电商主图与场景图批量产出", "多组参考图组合生成", "批量结果追踪与失败重试"},
			NotIdealFor: []string{"通用数据库或库存管理", "单张图片快速试验", "多镜头叙事连续性"},
			Tradeoffs:   []string{"参考图必须先作为图片节点进入画布", "批量提交会产生多项生成任务，执行前必须确认模型、数量和费用"},
			Actions:     []string{"read_rows", "append_row", "update_row", "remove_row", "set_operation", "set_concurrency", "add_reference_column", "remove_reference_column", "set_global_prompt", "preview_batch_generation"},
			InputKind:   "text",
			Connection:  ConnectionPolicy{CanSource: true, CanTarget: true, AcceptedInputKinds: []string{"image"}},
			CanUpdate:   true, SummaryFields: []string{"batchTable"}, DetailFields: []string{"batchTable"}, ProjectionKind: "batch_table", ProjectionField: "batchTable",
			PatchFields: func() map[string]PatchField {
				fields := map[string]PatchField{
					"title": {Path: "title", Kind: patchKindString, Label: "节点名称", Order: 10, Description: "批量创作表标题", MaxRunes: maxAgentNodeTitleRunes},
				}
				for key, field := range positionPatchFields() {
					fields[key] = field
				}
				return fields
			}(),
			CreateMetadata: func(string) map[string]any {
				return map[string]any{
					"status": "idle",
					"batchTable": map[string]any{
						"operation": "try_on", "concurrency": float64(10),
						"referenceColumns": []any{
							map[string]any{"id": "reference-1", "label": "参考图 1"},
							map[string]any{"id": "reference-2", "label": "参考图 2"},
							map[string]any{"id": "reference-3", "label": "参考图 3"},
						},
						"rows": []any{},
					},
				}
			},
		},
		{
			Type: "product", Version: "1", Label: "商品", DefaultWidth: 460, DefaultHeight: 660,
			Purpose:     "一件商品的持久身份：品类、外观、标识、禁止项，以及按正面/侧面/背面/细节/包装绑定的多视角实拍。这些字段逐字进提示词的锁定块，是商品一致性的唯一依据。",
			GoodFor:     []string{"锁定商品外观，让多次生成保持一致", "作为一组商品物料的共同上游"},
			NotIdealFor: []string{"承载图片本身（商品实拍是连入的图片节点）", "描述拍摄方式（那是拍法节点的职责）"},
			Tradeoffs:   []string{"外观必须来自用户确认的事实；把模型从图片猜出的结论直接写入，比留空更危险"},
			Actions:     []string{"read_profile", "update_profile", "bind_view", "use_as_product_reference"},
			InputKind:   "text",
			Connection:  ConnectionPolicy{CanSource: true, CanTarget: true, AcceptedInputKinds: []string{"image"}},
			CanUpdate:   true,
			SummaryFields: []string{"productProfile"}, DetailFields: []string{"productProfile"}, ProjectionKind: "ecommerce", ProjectionField: "productProfile",
			PatchFields: func() map[string]PatchField {
				fields := titleAndPositionPatchFields()
				for key, field := range map[string]PatchField{
					"category":   {Path: "metadata.productProfile.category", Kind: patchKindString, Label: "品类", Order: 20, MaxRunes: 200, Description: "商品品类，例如「保温杯」"},
					"appearance": {Path: "metadata.productProfile.appearance", Kind: patchKindString, Label: "外观", Order: 21, MaxRunes: 2000, Description: "颜色、材质、图案、结构，一项一行；必须是用户确认的事实"},
					"marks":      {Path: "metadata.productProfile.marks", Kind: patchKindString, Label: "标识", Order: 22, MaxRunes: 1000, Description: "Logo 与包装文字，含位置；逐字保留"},
					"forbidden":  {Path: "metadata.productProfile.forbidden", Kind: patchKindString, Label: "禁止", Order: 23, MaxRunes: 1000, Description: "明确不能出现的变化"},
					"front":  {Path: "metadata.productProfile.views.front", Kind: patchKindString, Label: "正面图", Order: 30, MaxRunes: 80, Description: "画布图片节点ID；空字符串取消绑定。正面必给"},
					"side":   {Path: "metadata.productProfile.views.side", Kind: patchKindString, Label: "侧面图", Order: 31, MaxRunes: 80, Description: "画布图片节点ID"},
					"back":   {Path: "metadata.productProfile.views.back", Kind: patchKindString, Label: "背面图", Order: 32, MaxRunes: 80, Description: "画布图片节点ID"},
					"detail": {Path: "metadata.productProfile.views.detail", Kind: patchKindString, Label: "细节图", Order: 33, MaxRunes: 80, Description: "画布图片节点ID"},
					"packaging": {Path: "metadata.productProfile.views.packaging", Kind: patchKindString, Label: "包装图", Order: 34, MaxRunes: 80, Description: "画布图片节点ID"},
				} {
					fields[key] = field
				}
				return fields
			}(),
			CreateMetadata: func(string) map[string]any {
				return map[string]any{"status": "idle", "productProfile": map[string]any{"name": "商品", "category": "", "appearance": "", "marks": "", "forbidden": "", "views": map[string]any{}}}
			},
		},
		{
			Type: "shot-recipe", Version: "2", Label: "拍摄清单", DefaultWidth: 420, DefaultHeight: 580,
			Purpose:     "一组图的拍摄清单：整组统一要求写一遍，每张一行（用途、构图、光线、色彩、镜头、背景、文案位、排除项）。只描述「怎么拍」，一个字都不描述商品长什么样。",
			GoodFor:     []string{"一次上新的一整套图共用一个清单，而不是一张图一个节点", "把成套拍摄方案复用到多个商品", "把成品图的拍法沉淀成可复用对象"},
			NotIdealFor: []string{"描述商品外观（应写入商品节点）", "承载品牌视觉规范（那是品牌风格节点）", "只出一张图时不需要清单——一行即可，清单会自动展开这一行"},
			Tradeoffs:   []string{"清单多行时，产物图必须认领其中一行（ecommerceShotId）；没认领的图只拿到整组统一要求，不会猜是哪一行", "与商品档案混在一段提示词里，模型改构图时会顺手改商品，所以两者刻意分开"},
			Actions:     []string{"read_shot_set", "update_shot_set", "use_as_shot_direction"},
			InputKind:   "text",
			Connection:  ConnectionPolicy{CanSource: true, CanTarget: true, AcceptedInputKinds: []string{"image", "text"}},
			CanUpdate:   true,
			SummaryFields: []string{"shotSet"}, DetailFields: []string{"shotSet"}, ProjectionKind: "ecommerce", ProjectionField: "shotSet",
			PatchFields: func() map[string]PatchField {
				fields := titleAndPositionPatchFields()
				fields["global"] = PatchField{Path: "metadata.shotSet.global", Kind: patchKindString, Label: "整组统一", Order: 19, MaxRunes: 800, Description: "整组图共用的要求，只写一遍，并进每一张的提示词"}
				return fields
			}(),
			CreateMetadata: func(string) map[string]any {
				return map[string]any{"status": "idle", "shotSet": map[string]any{"name": "拍摄清单", "global": "", "shots": []any{}}}
			},
		},
		{
			Type: "selling-point", Version: "1", Label: "卖点", DefaultWidth: 400, DefaultHeight: 440,
			Purpose:     "一条条可验证的商品主张，每条带依据。没有依据的卖点会被模型展开成具体数据、功效或认证，那是编造。",
			GoodFor:     []string{"为卖点图、详情页、促销海报提供有依据的信息", "把商品主张与依据分开管理，便于核对"},
			NotIdealFor: []string{"描述商品外观（应写入商品节点）", "承载绝对化用语（会被合规检查拦下）"},
			Tradeoffs:   []string{"写依据要多花时间，但能避免生成出无法核实的宣传语"},
			Actions:     []string{"read_selling_points", "use_as_copy_source"},
			InputKind:   "text",
			Connection:  ConnectionPolicy{CanSource: true, CanTarget: true, AcceptedInputKinds: []string{"image", "text"}},
			CanUpdate:   true,
			SummaryFields: []string{"sellingPoints"}, DetailFields: []string{"sellingPoints"}, ProjectionKind: "ecommerce", ProjectionField: "sellingPoints",
			PatchFields: titleAndPositionPatchFields(),
			CreateMetadata: func(string) map[string]any {
				return map[string]any{"status": "idle", "sellingPoints": []any{}}
			},
		},
		{
			Type: "ecommerce-copy", Version: "1", Label: "文案", DefaultWidth: 380, DefaultHeight: 400,
			Purpose:     "图上要出现的文字：标题、副文案、行动引导、价格。生成时只让画面留出对应位置，不生成任何文字，文字由排版层加。",
			GoodFor:     []string{"给主图、海报、卖点图提供文案内容", "改一个字不重新生成图片"},
			NotIdealFor: []string{"承载商品外观或拍摄方式", "代替排版节点控制文字位置与样式"},
			Tradeoffs:   []string{"价格必须真实；模型不会替你编价格，留空比编造安全"},
			Actions:     []string{"read_copy", "update_copy", "use_as_copy_source"},
			InputKind:   "text",
			Connection:  ConnectionPolicy{CanSource: true, CanTarget: true},
			CanUpdate:   true,
			SummaryFields: []string{"ecommerceCopy"}, DetailFields: []string{"ecommerceCopy"}, ProjectionKind: "ecommerce", ProjectionField: "ecommerceCopy",
			PatchFields: func() map[string]PatchField {
				fields := titleAndPositionPatchFields()
				for key, field := range map[string]PatchField{
					"headline": {Path: "metadata.ecommerceCopy.headline", Kind: patchKindString, Label: "标题", Order: 20, MaxRunes: 300, Description: "主视觉上最大的那行"},
					"subhead":  {Path: "metadata.ecommerceCopy.subhead", Kind: patchKindString, Label: "副文案", Order: 21, MaxRunes: 500, Description: "补充说明"},
					"cta":      {Path: "metadata.ecommerceCopy.cta", Kind: patchKindString, Label: "行动引导", Order: 22, MaxRunes: 100, Description: "按钮或角标上的字"},
					"price":    {Path: "metadata.ecommerceCopy.price", Kind: patchKindString, Label: "价格", Order: 23, MaxRunes: 100, Description: "必须是有依据的真实价格；没有依据就留空"},
				} {
					fields[key] = field
				}
				return fields
			}(),
			CreateMetadata: func(string) map[string]any {
				return map[string]any{"status": "idle", "ecommerceCopy": map[string]any{"headline": "", "subhead": "", "cta": "", "price": ""}}
			},
		},
		{
			Type: "ecommerce-style", Version: "1", Label: "品牌风格", DefaultWidth: 400, DefaultHeight: 460,
			Purpose:     "跨整组图统一的视觉规范：品牌色板、色调、气质、字体气质。拍法决定怎么拍，风格决定看起来像谁。",
			GoodFor:     []string{"整组物料保持统一视觉", "把品牌规范沉淀成可复用对象"},
			NotIdealFor: []string{"描述单张图的拍摄方式（那是拍法节点）", "承载商品外观"},
			Tradeoffs:   []string{"色板以十六进制逐字进提示词、可核对，但模型对具体色值的还原精度有限"},
			Actions:     []string{"read_style", "update_style", "use_as_style_reference"},
			InputKind:   "text",
			Connection:  ConnectionPolicy{CanSource: true, CanTarget: true, AcceptedInputKinds: []string{"image", "text"}},
			CanUpdate:   true,
			SummaryFields: []string{"ecommerceStyle"}, DetailFields: []string{"ecommerceStyle"}, ProjectionKind: "ecommerce", ProjectionField: "ecommerceStyle",
			PatchFields: func() map[string]PatchField {
				fields := titleAndPositionPatchFields()
				for key, field := range map[string]PatchField{
					"tone":       {Path: "metadata.ecommerceStyle.tone", Kind: patchKindString, Label: "色调", Order: 20, MaxRunes: 300, Description: "冷暖、饱和、明度倾向"},
					"mood":       {Path: "metadata.ecommerceStyle.mood", Kind: patchKindString, Label: "气质", Order: 21, MaxRunes: 300, Description: "气质描述"},
					"typography": {Path: "metadata.ecommerceStyle.typography", Kind: patchKindString, Label: "字体气质", Order: 22, MaxRunes: 300, Description: "决定文案位的排布观感"},
				} {
					fields[key] = field
				}
				return fields
			}(),
			CreateMetadata: func(string) map[string]any {
				return map[string]any{"status": "idle", "ecommerceStyle": map[string]any{"name": "品牌风格", "palette": []any{}, "tone": "", "mood": "", "typography": ""}}
			},
		},
		{
			Type: "ecommerce-layout", Version: "1", Label: "排版", DefaultWidth: 560, DefaultHeight: 620,
			Purpose:     "把文案叠在成品图上并导出多个尺寸。文字不烧进像素：编辑期间是叠加层，改一个字立即生效，只有导出时才合成一次。",
			GoodFor:     []string{"给生成图加上标题、副文案、价格与行动引导", "一次编辑导出 1:1 / 4:5 / 3:4 / 9:16 等多个尺寸"},
			NotIdealFor: []string{"生成图片本身（应连入上游成品图）", "承载文案内容（那是文案节点）"},
			Tradeoffs:   []string{"导出会生成新的图片节点并占用存储；版式位置由锚点决定，不能自由拖拽到任意坐标"},
			Actions:     []string{"read_layout", "update_layout", "set_aspect_ratio", "export_layout"},
			InputKind:   "image",
			Connection:  ConnectionPolicy{CanSource: true, CanTarget: true, AcceptedInputKinds: []string{"image", "text"}},
			CanUpdate:   true,
			SummaryFields: []string{"ecommerceLayout", "ecommerceAspectRatio"}, DetailFields: []string{"ecommerceLayout", "ecommerceAspectRatio"}, ProjectionKind: "ecommerce", ProjectionField: "ecommerceLayout",
			PatchFields: func() map[string]PatchField {
				fields := titleAndPositionPatchFields()
				fields["aspectRatio"] = PatchField{Path: "metadata.ecommerceAspectRatio", Kind: patchKindString, Label: "画幅", Order: 20, MaxRunes: 10, Description: "导出画幅：1:1、4:5、3:4、9:16、16:9、2:3"}
				return fields
			}(),
			CreateMetadata: func(string) map[string]any {
				return map[string]any{"status": "idle", "ecommerceAspectRatio": "1:1", "ecommerceLayout": map[string]any{"name": "排版", "blocks": []any{}}}
			},
		},
		{
			Type: "ecommerce-infographic", Version: "1", Label: "信息图", DefaultWidth: 560, DefaultHeight: 660,
			Purpose:     "卖点标注、尺寸、材质、规格表。这一层完全不经过模型：底图由生成链路出（画面里明确不要任何文字），标注、引线、规格表在浏览器里按真实字体合成——数字写错一位是虚假宣传，字糊成一团是废图。",
			GoodFor:     []string{"需要真实文字的图：卖点标注、尺寸标注、参数表、规格对比", "亚马逊图位 2–7 的卖点信息图（通用生图工具不做这一类）"},
			NotIdealFor: []string{"主图与场景图（文字交给排版节点留位即可）", "种草图（种草图要的是不像广告，标注会毁掉真实感）"},
			Tradeoffs:   []string{"标注最多 5 条，超过就没人看；规格表里的数字必须来自实测或官方参数，模型不会替你核对", "底图里若自己画了文字，合成时会和标注打架，所以底图必须零文字"},
			Actions:     []string{"read_infographic", "update_infographic", "export_infographic"},
			InputKind:   "image",
			Connection:  ConnectionPolicy{CanSource: true, CanTarget: true, AcceptedInputKinds: []string{"image", "text"}},
			CanUpdate:   true,
			SummaryFields: []string{"ecommerceInfographic", "ecommerceAspectRatio"}, DetailFields: []string{"ecommerceInfographic", "ecommerceAspectRatio"}, ProjectionKind: "ecommerce", ProjectionField: "ecommerceInfographic",
			PatchFields: func() map[string]PatchField {
				fields := titleAndPositionPatchFields()
				fields["headline"] = PatchField{Path: "metadata.ecommerceInfographic.headline", Kind: patchKindString, Label: "标题", Order: 20, MaxRunes: 200, Description: "写结论，不写品类名"}
				fields["subhead"] = PatchField{Path: "metadata.ecommerceInfographic.subhead", Kind: patchKindString, Label: "副标题", Order: 21, MaxRunes: 200, Description: "一行补充，例如规格与材质"}
				fields["footer"] = PatchField{Path: "metadata.ecommerceInfographic.footer", Kind: patchKindString, Label: "信任条", Order: 22, MaxRunes: 300, Description: "依据、认证、售后；必须真实可核实"}
				fields["archetype"] = PatchField{Path: "metadata.ecommerceInfographic.archetype", Kind: patchKindString, Label: "骨架", Order: 23, MaxRunes: 20, Description: "feature 卖点标注 / dimensions 尺寸 / material 材质 / comparison 对比 / whatsinbox 包装 / specs 参数表"}
				fields["aspectRatio"] = PatchField{Path: "metadata.ecommerceAspectRatio", Kind: patchKindString, Label: "画幅", Order: 24, MaxRunes: 10, Description: "导出画幅：1:1、4:5、3:4、9:16、16:9、2:3"}
				return fields
			}(),
			CreateMetadata: func(string) map[string]any {
				return map[string]any{"status": "idle", "ecommerceAspectRatio": "1:1", "ecommerceInfographic": map[string]any{"name": "信息图", "archetype": "feature", "headline": "", "subhead": "", "callouts": []any{}, "table": nil, "footer": ""}}
			},
		},
		{
			Type: "ecommerce-replica", Version: "1", Label: "爆款复刻", DefaultWidth: 460, DefaultHeight: 560,
			Purpose:     "照着别人的图做自己的图。双输入：参考图给结构（构图、布光、配色、版式），商品图给主体。复刻的是爆款公式，不是画面。",
			GoodFor:     []string{"照着爆款的构图与布光做自己的商品图", "跨品类借用成功的视觉结构"},
			NotIdealFor: []string{"拆解别人的页面结构（那是竞品拆解节点）", "直接搬画面内容——抄画面是侵权，平台有图像指纹稽查"},
			Tradeoffs:   []string{"复刻强度越高越像，但太像会被判搬运；不可复刻清单是常量，不可清空"},
			Actions:     []string{"read_replica", "update_replica", "set_fidelity"},
			InputKind:   "text",
			Connection:  ConnectionPolicy{CanSource: true, CanTarget: true, AcceptedInputKinds: []string{"image", "text"}},
			CanUpdate:   true,
			SummaryFields: []string{"ecommerceReplica"}, DetailFields: []string{"ecommerceReplica"}, ProjectionKind: "ecommerce", ProjectionField: "ecommerceReplica",
			PatchFields: func() map[string]PatchField {
				fields := titleAndPositionPatchFields()
				fields["fidelity"] = PatchField{Path: "metadata.ecommerceReplica.fidelity", Kind: patchKindString, Label: "复刻强度", Order: 20, MaxRunes: 10, Description: "high 贴近 / medium 借鉴 / low 取意"}
				fields["notes"] = PatchField{Path: "metadata.ecommerceReplica.notes", Kind: patchKindString, Label: "结构笔记", Order: 21, MaxRunes: 1200, Description: "从参考图里读出来的结构：主体位置、留白、光向、色系"}
				fields["extraExclude"] = PatchField{Path: "metadata.ecommerceReplica.extraExclude", Kind: patchKindString, Label: "额外不复刻项", Order: 22, MaxRunes: 500, Description: "追加在硬边界之后的不复刻内容"}
				return fields
			}(),
			CreateMetadata: func(string) map[string]any {
				return map[string]any{"status": "idle", "ecommerceReplica": map[string]any{"name": "爆款复刻", "fidelity": "medium", "aspects": []any{"composition", "lighting", "palette"}, "notes": "", "extraExclude": ""}}
			},
		},
		{
			Type: "ecommerce-teardown", Version: "1", Label: "竞品拆解", DefaultWidth: 560, DefaultHeight: 620,
			Purpose:     "把别人的详情页拆成一张可执行的大纲。拆的是结构（页面顺序、卖点排序、证据类型、信任模块），不是画面——头部工具全都只做风格复刻，没有结构拆解。",
			GoodFor:     []string{"找出竞品页面的说服顺序，据此排自己的详情页", "标记哪些地方要跟着做、哪些要反着来（差异化位置）"},
			NotIdealFor: []string{"复刻画面（那是爆款复刻节点）", "直接抄竞品文案——拆解只描述它讲了什么、按什么顺序讲"},
			Tradeoffs:   []string{"标为「反着来」的行不会进提示词，它标记的是要和竞品拉开距离的地方"},
			Actions:     []string{"read_teardown", "update_teardown", "analyze_competitor"},
			InputKind:   "text",
			Connection:  ConnectionPolicy{CanSource: true, CanTarget: true, AcceptedInputKinds: []string{"image", "text"}},
			CanUpdate:   true,
			SummaryFields: []string{"ecommerceTeardown"}, DetailFields: []string{"ecommerceTeardown"}, ProjectionKind: "ecommerce", ProjectionField: "ecommerceTeardown",
			PatchFields: titleAndPositionPatchFields(),
			CreateMetadata: func(string) map[string]any {
				return map[string]any{"status": "idle", "ecommerceTeardown": map[string]any{"name": "竞品拆解", "dimensions": []any{"structure", "sellingOrder", "evidence", "trust", "layout", "palette"}, "findings": []any{}, "outline": []any{}}}
			},
		},
		{
			Type: "ecommerce-delivery", Version: "1", Label: "交付", DefaultWidth: 620, DefaultHeight: 640,
			Purpose:     "出图之后到上架之前的那一段：汇总这一套图、逐张按平台校验、按规范命名、导出可核对的清单。不替代上传，但把「能不能上架」在导出前说清楚。",
			GoodFor:     []string{"一次核对整套图在各平台的合规性", "按「商品-用途-版本-变动」生成交付文件名", "导出可直接核对的交付清单 CSV"},
			NotIdealFor: []string{"生成图片（它只汇总上游）", "替代平台后台的上传流程"},
			Tradeoffs:   []string{"版本号只增不减，不提供「回到上一版」——回退由保留旧文件实现", "白底、主体占比、文字占比需要图像检测结果才判得出来，没检测时跳过而不猜测"},
			Actions:     []string{"read_delivery", "update_delivery", "export_manifest"},
			InputKind:   "text",
			Connection:  ConnectionPolicy{CanSource: true, CanTarget: true, AcceptedInputKinds: []string{"image", "text"}},
			CanUpdate:   true,
			SummaryFields: []string{"ecommerceDelivery"}, DetailFields: []string{"ecommerceDelivery"}, ProjectionKind: "ecommerce", ProjectionField: "ecommerceDelivery",
			PatchFields: func() map[string]PatchField {
				fields := titleAndPositionPatchFields()
				fields["code"] = PatchField{Path: "metadata.ecommerceDelivery.code", Kind: patchKindString, Label: "商品编码", Order: 20, MaxRunes: 60, Description: "进文件名，例如 A001"}
				fields["version"] = PatchField{Path: "metadata.ecommerceDelivery.version", Kind: patchKindString, Label: "版本", Order: 21, MaxRunes: 10, Description: "只增不减；禁用「最终版」"}
				return fields
			}(),
			CreateMetadata: func(string) map[string]any {
				return map[string]any{"status": "idle", "ecommerceDelivery": map[string]any{"name": "交付", "code": "", "version": 1, "targets": []any{map[string]any{"id": "target-default", "platformId": "taobao", "role": "main"}}}}
			},
		},
		{
			Type: "ecommerce-video", Version: "1", Label: "电商视频", DefaultWidth: 640, DefaultHeight: 660,
			Purpose:     "把一套图编排成片：主图视频、轮播视频、卖点视频、种草短视频。电商视频的素材是现成的（一套图已经出好了），所以这里不做从零生成，只做编排与守规格。",
			GoodFor:     []string{"淘宝主图视频（3:4 或 1:1，15 秒）", "抖音商品视频与轮播视频（9:16）", "亚马逊品牌备案后的视频位"},
			NotIdealFor: []string{"从零生成视频画面（那是视频节点）", "把抖音的 9:16 直接搬去淘宝——淘宝不收 9:16，上传后商详不展示"},
			Tradeoffs:   []string{"平台规格是硬的：比例、时长、清晰度、首帧限制，生成前就卡", "总时长超上限时按比例压缩而不是砍镜头——砍掉会让「一套图」不完整"},
			Actions:     []string{"read_video", "update_video", "arrange_shots", "set_video_platform"},
			InputKind:   "video",
			Connection:  ConnectionPolicy{CanSource: true, CanTarget: true, AcceptedInputKinds: []string{"image", "text"}},
			CanUpdate:   true,
			SummaryFields: []string{"ecommerceVideo"}, DetailFields: []string{"ecommerceVideo"}, ProjectionKind: "ecommerce", ProjectionField: "ecommerceVideo",
			PatchFields: func() map[string]PatchField {
				fields := titleAndPositionPatchFields()
				fields["kind"] = PatchField{Path: "metadata.ecommerceVideo.kind", Kind: patchKindString, Label: "片子类型", Order: 20, MaxRunes: 20, Description: "main 主图视频 / carousel 轮播 / selling 卖点 / demo 使用演示 / seed 种草短视频"}
				fields["platform"] = PatchField{Path: "metadata.ecommerceVideo.platform", Kind: patchKindString, Label: "投放平台", Order: 21, MaxRunes: 20, Description: "taobao / jd / douyin / amazon；决定比例与时长上限"}
				fields["music"] = PatchField{Path: "metadata.ecommerceVideo.music", Kind: patchKindString, Label: "配乐风格", Order: 22, MaxRunes: 100, Description: "留空表示不加"}
				return fields
			}(),
			CreateMetadata: func(string) map[string]any {
				return map[string]any{"status": "idle", "ecommerceVideo": map[string]any{"name": "电商视频", "kind": "main", "platform": "taobao", "shots": []any{}, "music": "", "burnCaptions": true}}
			},
		},
		{
			Type: "ecommerce-aplus", Version: "1", Label: "A+ 内容", DefaultWidth: 600, DefaultHeight: 660,
			Purpose:     "亚马逊详情页的模块化版式。A+ 不是一张长图，是一组带硬性尺寸的槽位：图放错尺寸会被审核拒，文字超字数会被截断。所以这个节点先给规格，再让人写内容。",
			GoodFor:     []string{"亚马逊品牌备案后的 A+ 内容（官方数据：基础 A+ 提升销售最多 8%，优质 A+ 最多 20%）", "需要精确到像素的模块版式：品牌头图 1940×600、四图一文 220×220、对比表 150×300"},
			NotIdealFor: []string{"国内平台详情页（那是详情页九屏 + 排版）", "把 A+ 当一张长图做——八个模块各自独立出图，拼版由亚马逊完成"},
			Tradeoffs:   []string{"字数上限是硬的，超了会被平台截断，所以提交前就校验", "对比表只对比自家系列，点名竞品在多数平台算不正当竞争", "文字走亚马逊自己的叠加层，不要烧进图里——画进去会和叠加层打架"},
			Actions:     []string{"read_aplus", "update_aplus", "add_aplus_module"},
			InputKind:   "image",
			Connection:  ConnectionPolicy{CanSource: true, CanTarget: true, AcceptedInputKinds: []string{"image", "text"}},
			CanUpdate:   true,
			SummaryFields: []string{"ecommerceAplus"}, DetailFields: []string{"ecommerceAplus"}, ProjectionKind: "ecommerce", ProjectionField: "ecommerceAplus",
			PatchFields: func() map[string]PatchField {
				fields := titleAndPositionPatchFields()
				fields["name"] = PatchField{Path: "metadata.ecommerceAplus.name", Kind: patchKindString, Label: "A+ 名称", Order: 20, MaxRunes: 80, Description: "只用于展示与节点标题"}
				return fields
			}(),
			CreateMetadata: func(string) map[string]any {
				return map[string]any{"status": "idle", "ecommerceAplus": map[string]any{"name": "A+ 内容", "blocks": []any{}}}
			},
		},
		{
			Type: "ecommerce-revision", Version: "1", Label: "改稿", DefaultWidth: 460, DefaultHeight: 620,
			Purpose:     "一张图的版本链。这一层不生成任何东西，只解决「改稿没有版本记录」——运营说回到上一版时，设计师不用凭记忆重做。",
			GoodFor:     []string{"记录每一版改了什么、从哪一版改的、哪一版在采用", "把「回到上一版」变成切换当前版本，而不是重做"},
			NotIdealFor: []string{"生成图片（它只记录版本）", "替代画布的撤销重做——撤销是操作级的，这里是交付级的"},
			Tradeoffs:   []string{"改动说明是必填项：没有说明的版本链等于没有版本链，两周后连自己都记不得 v3 和 v4 差在哪", "版本号只增不减、作废不复用；「回到上一版」不改版本号，只把旧版标成当前"},
			Actions:     []string{"read_revisions", "update_revisions", "switch_current_revision"},
			InputKind:   "text",
			Connection:  ConnectionPolicy{CanSource: true, CanTarget: true, AcceptedInputKinds: []string{"image", "text"}},
			CanUpdate:   true,
			SummaryFields: []string{"ecommerceRevisions"}, DetailFields: []string{"ecommerceRevisions"}, ProjectionKind: "ecommerce", ProjectionField: "ecommerceRevisions",
			PatchFields: titleAndPositionPatchFields(),
			CreateMetadata: func(string) map[string]any {
				return map[string]any{"status": "idle", "ecommerceRevisions": []any{}}
			},
		},
		{
			Type: "script", Version: "1", Label: "分镜脚本", DefaultWidth: 920, DefaultHeight: 360,
			Purpose:       "维护结构化的多镜头脚本，支持镜头级审查、修改和媒体关联。",
			GoodFor:       []string{"多镜头规划", "镜头连续性", "逐镜审查和微调", "逐镜生成图片或视频", "需要他人接手维护的内容"},
			NotIdealFor:   []string{"只有一个画面的快速试验", "一次性临时提示词", "仅需要阅读排版的普通文档"},
			Tradeoffs:     []string{"前期录入成本高于文本节点", "但能保留镜头级结构、资产关系和后续维护能力"},
			Actions:       []string{"read_rows", "append_row", "update_row", "remove_row", "generate_storyboard", "connect_assets", "update_node"},
			InputKind:     "text",
			Connection:    ConnectionPolicy{CanSource: true, CanTarget: true, AcceptedInputKinds: []string{"audio", "character", "image", "text", "video"}},
			CanUpdate:     true,
			SummaryFields: []string{"storyboard"}, DetailFields: []string{"storyboard"}, ProjectionKind: "storyboard", ProjectionField: "storyboard",
			PatchFields: titleAndPositionPatchFields(),
			CreateMetadata: func(string) map[string]any {
				return map[string]any{"status": "idle", "workflowKind": "script", "storyboard": map[string]any{"rows": []any{}, "visibleColumns": []any{"shotNumber", "durationSeconds", "videoMotionPrompt", "dialogue", "assets"}, "referenceNodeIds": []any{}}}
			},
		},
	})
	if err != nil {
		panic(err)
	}
	return registry
}

// characterDescriptor 是角色卡能力：画布上是 text + metadata.workflowKind=character 的节点，
// 设定、三视图与声音都来自账号内的角色资产而非节点正文。它可以被发现、精读、连线和引用，
// 但不能用 add_node 凭空创建：必须经 canvas_create_character 用真实图片/音频建角色资产，名称和设定只随角色资产更新。
func characterDescriptor() Descriptor {
	return Descriptor{
		Type: "character", Version: "1", Label: "角色卡", DefaultWidth: 264, DefaultHeight: 352,
		Purpose:     "引用账号角色库中的角色资产，统一提供角色设定、三视图/形象图和绑定声音，用来保持人物在多次生成中的一致性。",
		GoodFor:     []string{"图片或视频生成时锁定人物外观", "多镜头保持同一角色一致", "角色配音时使用绑定声音", "只取角色文字设定作为提示词来源"},
		NotIdealFor: []string{"临时一次性的人物描述（直接写进提示词或文本节点）", "用 add_node 新建（应使用 canvas_create_character 打包形象图片与声音）", "承载普通正文（节点正文不是角色设定）"},
		Tradeoffs:   []string{"设定与媒体随角色资产版本变化，提交时会校验版本", "未绑定形象或声音时对应引用不可用，需先读取 character.imageReference/audioReference"},
		Actions:     []string{"read_character", "use_as_reference", "use_as_text_source"},
		InputKind:   "character",
		Connection:  ConnectionPolicy{CanSource: true, CanReference: true},
		CanUpdate:   true,
		PatchFields: positionPatchFields(),
		Variant:     &NodeVariant{BaseType: "text", WorkflowKind: "character"},
	}
}

// generatedMediaDescriptor 根据节点类型、显示尺寸、生成模式和连接规则创建媒体能力描述。
// 返回读写字段及创建默认值；首尾帧只对视频开放，避免其他节点接受无效视频参数。
func generatedMediaDescriptor(nodeType, version, label string, width, height float64, generationMode string, connection ConnectionPolicy) Descriptor {
	semantics := generatedMediaSemantics(nodeType)
	fields := editableNodeFields("metadata.generationSpec.prompt", "提示词", "生成合同中的当前提示词；这是 Agent 唯一读写的媒体提示词")
	readFields := []string{"prompt", "assetTags", "referenceNodeIds"}
	if generationMode == "video" {
		for i, frame := range []struct{ key, label string }{
			{"videoStartFrameNodeId", "首帧"}, {"videoEndFrameNodeId", "尾帧"},
		} {
			fields[frame.key] = PatchField{Path: "metadata." + frame.key, Kind: patchKindString, Label: frame.label, Order: 40 + i, MaxRunes: 80, Description: "已连接图片ID；空字符串取消"}
			readFields = append(readFields, frame.key)
		}
	}
	return Descriptor{
		Type: nodeType, Version: version, Label: label, DefaultWidth: width, DefaultHeight: height,
		Purpose: semantics.Purpose, GoodFor: semantics.GoodFor, NotIdealFor: semantics.NotIdealFor,
		Tradeoffs: semantics.Tradeoffs, Actions: semantics.Actions,
		InputKind: nodeType, GenerationMode: generationMode, Connection: connection, CanUpdate: true,
		SummaryFields:  readFields,
		DetailFields:   readFields,
		PatchFields:    fields,
		CreateMetadata: func(prompt string) map[string]any { return generatedMetadata(generationMode, prompt) },
	}
}

type generatedMediaCapabilitySemantics struct {
	Purpose     string
	GoodFor     []string
	NotIdealFor []string
	Tradeoffs   []string
	Actions     []string
}

func generatedMediaSemantics(nodeType string) generatedMediaCapabilitySemantics {
	switch nodeType {
	case "image":
		return generatedMediaCapabilitySemantics{
			Purpose:     "生成或承载一个静态画面，并作为后续图片或视频生成的真实参考素材。",
			GoodFor:     []string{"单张图片生成", "有参考图的图片生成", "分镜首帧和关键帧", "需要复用的视觉素材"},
			NotIdealFor: []string{"承载多镜头脚本结构", "表达镜头运动或时间变化", "代替分镜表维护镜头连续性"},
			Tradeoffs:   []string{"一个节点对应一个静态媒体目标", "参考图数量和生成方式必须再由模型目录能力匹配"},
			Actions:     []string{"generate_media", "update_prompt", "use_as_reference"},
		}
	case "video":
		return generatedMediaCapabilitySemantics{
			Purpose:     "生成或承载一个连续视频片段；可按实际参考素材执行文生视频、图生视频或多图生视频。",
			GoodFor:     []string{"单镜头文生视频", "单图生视频", "多图参考视频", "已有视频或音频参与的视频生成"},
			NotIdealFor: []string{"承载整部多镜头脚本", "用一个节点代替逐镜审查和维护", "未查询模型能力就假定支持任意参考数量"},
			Tradeoffs:   []string{"一个节点通常对应一个可独立生成和审核的视频片段", "参考类型、数量、时长、画幅、音频和价格受当前模型目录约束"},
			Actions:     []string{"generate_media", "update_prompt", "use_as_reference"},
		}
	case "audio":
		return generatedMediaCapabilitySemantics{
			Purpose:     "生成或承载一个音频素材，用于配音、音乐、音效或视频参考输入。",
			GoodFor:     []string{"文本转语音", "配音", "音乐或音效素材", "为视频提供音频参考"},
			NotIdealFor: []string{"承载分镜结构", "表达画面构图或镜头运动", "代替视频节点"},
			Tradeoffs:   []string{"一个节点对应一个音频目标且最多接收一个文本输入", "音频类型、时长和价格仍以模型目录及任务准入为准"},
			Actions:     []string{"generate_media", "update_prompt", "use_as_reference"},
		}
	default:
		return generatedMediaCapabilitySemantics{}
	}
}

func titleAndPositionPatchFields() map[string]PatchField {
	fields := map[string]PatchField{
		"title": {
			Path: "title", Kind: patchKindString, Label: "节点名称", Order: 10, Description: "节点标题", MaxRunes: maxAgentNodeTitleRunes,
		},
	}
	for key, field := range positionPatchFields() {
		fields[key] = field
	}
	return fields
}

func editableNodeFields(contentPath, contentLabel, contentDescription string) map[string]PatchField {
	fields := titleAndPositionPatchFields()
	fields["content"] = PatchField{
		Path: contentPath, Kind: patchKindString, Label: contentLabel, Order: 20, Description: contentDescription, MaxRunes: maxAgentNodeContentRunes,
	}
	return fields
}

// positionPatchFields 是坐标字段：模型可以直接指定节点位置（微调），批量整理走 canvas_arrange_nodes。
// 坐标上限与整理侧的收敛范围一致，避免写进离谱的几何值。
func positionPatchFields() map[string]PatchField {
	return map[string]PatchField{
		"x": {Path: "position.x", Kind: patchKindNumber, Label: "横坐标", Order: 30, Limit: maxAgentNodeCoordLimit, Description: "画布横坐标（像素）；与 y 一起移动节点，通常用 canvas_arrange_nodes 批量整理"},
		"y": {Path: "position.y", Kind: patchKindNumber, Label: "纵坐标", Order: 31, Limit: maxAgentNodeCoordLimit, Description: "画布纵坐标（像素）；与 x 一起移动节点，通常用 canvas_arrange_nodes 批量整理"},
	}
}

func generatedMetadata(mode, prompt string) map[string]any {
	spec := contract.GenerationSpec{
		Version:           contract.GenerationVersion,
		Mode:              mode,
		Prompt:            prompt,
		Options:           contract.Options{},
		ReferenceBindings: []contract.ReferenceBinding{},
		TextInputMode:     "append-sources",
	}
	metadata, err := spec.NodeMetadata()
	if err != nil {
		panic(err)
	}
	metadata["content"] = ""
	metadata["status"] = "idle"
	return metadata
}
