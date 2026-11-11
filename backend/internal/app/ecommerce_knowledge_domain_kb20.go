package app

import (
	"encoding/json"
	"fmt"
	"sort"

	"yingce/backend/internal/ecommerceagent"
	"yingce/backend/internal/model"
)

// KB20：电商设计策划知识库。内容来自对站酷高赞电商全案（Babycare 保温杯与洗护、官栈花胶、BAIMISS 紫草喷雾、
// 九阳与美的家电、劲仔与太太乐食品、UGREEN 数码等）、Apple 中国官网产品页，以及 Behance 公开项目
// （穴位磁疗贴、BIOS LINE 蜂胶咽喉喷雾、MITOVIGOR 保健品、振德口罩、婴儿手口湿巾、棉熙洗脸巾详情与主图、
// 长发小寨洗发水全案、CHEF 灶具、日本站标签机主图、丸美 KV 摄影、按摩仪模特摄影）的实际查看与拆解：
// 先策划再出图，按品类找打法，整套一个色彩世界，看不见的作用画出来，按材质布光，字成为设计的一部分，文案对人说话。
// 生图台出图策划按商品类型、名称和材质挑相关的几条，整段写进策划的系统提示词；也和其他内置知识一样进知识库，管理员可以停用或改写。
const (
	ecommerceKB20Domain  = "KB20"
	ecommerceKB20Version = "kb20-v8-20261111"
)

// kb20DesignSpec 是一条设计策划知识；keywords 用来按商品类型、名称和材质挑选，为空的是每次都带的通用方法。
type kb20DesignSpec struct {
	id, kind, title, guidance string
	keywords                  []string
	// families 是商品档案的品类大类：关键词都对不上时，按大类给一条品类打法。
	families []string
}

const (
	kb20MethodID      = "kb20-visual-planning-method"
	kb20LayoutID      = "kb20-type-and-layout"
	kb20CopyID        = "kb20-premium-copywriting"
	kb20ColorID       = "kb20-product-audience-color"
	kb20CompositionID = "kb20-composition-catalog"
	kb20GenericID     = "kb20-category-generic"
	kb20CategoryKind  = "detail_page_pattern"
	kb20PhotoKind     = "photography"
	// 主图套图和各类单张图的打法：按策划范围和选中的单张类型挑。不用 creation_type_rule，
	// 那一类在知识库相关度排序里有额外加分，会挤进电商 Agent 的检索结果。
	kb20ScopeKind = "detail_page_pattern"
	kb20MainID    = "kb20-scope-main"
)

// kb20SingleTypeIDs：单张类型对应的打法条目。
var kb20SingleTypeIDs = map[string]string{
	"poster": "kb20-single-hero", "campaign": "kb20-single-hero", "main": "kb20-single-hero",
	"seeding": "kb20-single-lifestyle", "ugc": "kb20-single-lifestyle", "scene": "kb20-single-lifestyle", "collocation": "kb20-single-lifestyle",
	"white": "kb20-single-white", "flatlay": "kb20-single-white", "angles": "kb20-single-white",
	"selling": "kb20-single-info", "compare": "kb20-single-info", "steps": "kb20-single-info", "size": "kb20-single-info", "spec": "kb20-single-info", "package": "kb20-single-info", "closeup": "kb20-single-info",
	"model": "kb20-single-model",
}

// 与前端方向方案、逐屏策划、图像编译和成品检查共用构成方法；数据库升级仍保留管理员修改。
func kb20PosterDesignMethod() string {
	catalog, err := ecommerceagent.ReadStudioDesignCatalog()
	if err != nil || catalog.PosterDesign.Principles == "" || catalog.PosterDesign.Hero == "" {
		panic(fmt.Sprintf("invalid embedded studio poster design method: %v", err))
	}
	return catalog.PosterDesign.Principles + "\n" + catalog.PosterDesign.Hero
}

var kb20DesignSpecs = []kb20DesignSpec{
	{id: kb20ColorID, kind: "visual_style", title: "商品、人群与背景色分别判断",
		guidance: "先区分商品本色、背景主色、文字色和强调色。灰色镜腿、透明镜框、银色接口是商品事实，不是灰白背景的理由。儿童眼镜：家长看适用条件，孩子看真实使用情境；未锁定风格时优先天空蓝与暖黄、珊瑚与奶油、草绿与杏色等明亮有温度的候选，不默认冷灰、黑白实验舱，也不强制卡通。食品用真实食物色泽与清楚轮廓，数码用可见接口和受控反射，穿戴用实际人群与本色。先判断商品与背景的明度、色相对比，再按平台阅读情境分配标题和注解；商品本色不随全套调色改变。用户指定灰色、暗调、白底或参考同款优先。参考 WCAG 的可读性方法：小字和背景对比至少 4.5:1，大字至少 3:1；这是设计自查目标，不保证生图文字通过像素验证。来源：https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html 。"},
	{id: kb20CompositionID, kind: "layout_pattern", title: "从购买问题选择构图，而非固定轮换",
		guidance: "构图可用左文右图、左图右文、上文下图、上图下文、中轴、角落题签、对角动势、窄栏编辑、框景留白、双幅对照、三联摄影、一大两小拼版、中段横带、环绕留白、拱形框景、竖向题签、微距压边、纵向操作轨道。它们改变摄影窗口与文字位置，不只是换色。信息版式可用杂志编辑、微距质感、生活分镜、选购清单、操作步骤、平铺构成、色块构成、轮廓留白、佩戴画册、材料样本板和用户目录里的其他方式。儿童眼镜优先明亮色块、佩戴关系、可见镜框微距与选购条件；数码优先接口标注、操作与参数；食品优先质地和餐桌。不按屏序轮转，不凑固定十屏，不用未经确认的成分、参数、内部机制填版式。目录图保持比例与尺度统一，内容图依购买问题变化。Shopify 目录比例方法来源：https://help.shopify.com/en/manual/products/product-media/product-media-types 。其余构图组合为本站原创设计候选，不冒充平台硬规则。"},
	{id: kb20MethodID, kind: "detail_page_pattern", title: "视觉策划：内容、证据与阅读路径",
		guidance: "① 内容职责：先从用户资料确定本品的一条核心信息、目标读者和已有证据。未做市场调查时不声称同类商品都用某套路，也不凭想象定位竞争优势。② 图像承担信息：商品轮廓解释外观，手部操作解释动作，局部解释细节，场景解释使用关系；性能、机理与内部结构需要对应资料，不能因看不见而补画。③ 小草图比较：在内部比较2–3份仅含主图轮廓、字块和留白的构图，选择商品易辨、证据相连、重心稳定的一份，再细化摄影与字体。④ 阅读路径：明确读者先看什么、接着看哪幅证据、最后读哪条说明；按邻近分组，以主图轮廓、摄影边界或文字轴线建立网格，空白也参与组织。⑤ 视觉系统与节奏：整套共用字体、色板、边距、线宽和光影，通过开场定调、证据展开、使用关系和选择信息推进内容，按资料与页数取舍；变化来自景别、尺度、重心和疏密。参考先区分教学封面与商品成品，只迁移图文关系，不迁移案例的文案、参数、认证或功效。方法依据：BCcampus《Graphic Design and Print Production Fundamentals》3.3 Compositional Principles、3.4 Organizational Principles；Smashing Magazine《Typographic Hierarchies》。"},
	{id: kb20LayoutID, kind: "layout_pattern", title: "版式与字体：让字成为设计的一部分",
		guidance: "网格由内容产生，文字与摄影共同构图。" + kb20PosterDesignMethod() + "由图片模型整体生成图文，不拆成无字底图后程序叠字；不添加未给定的英文、页码和屏号，不用描边、渐变或发光替代排版。方法依据：https://www.smashingmagazine.com/2022/10/typographic-hierarchies/ ；https://opentextbc.ca/graphicdesign/chapter/3-3-organizational-principles/ 。"},
	{id: kb20CopyID, kind: "copywriting_pattern", title: "商品文案：购买问题、具体事实与语言节奏",
		guidance: "先回答买家这屏最关心的一个问题，再决定句式。headline 给明确结论，subline 说明已确认的理由，lines 展开参数或证据。短句、动词、对仗是表达工具，不能代替商品事实。已确认的配色、结构、容量和尺寸可以直接成为主题：例如「清透前框 柔灰收边」讲外观，「500ml 随身容量」讲容量，下一层再写具体部位或规格；不能从透明框推导视力改善，从小包装推导足够一天，从拧盖推导防漏。功效、耐用、舒适、认证、排名、销量、对比结果必须有对应的卖家依据，未知就省略。参数屏可以罗列已确认规格，用「项目｜数值与条件」逐行排；外观屏可以描述可见细节，不为了所谓高级感把它们改成空洞情绪口号。主标题以手机可读、信息准确为准，不硬卡字数；一组标题不能反复换词表达同一句话。拒绝「品质之选」「匠心」「臻品」「甄选」「高端大气」「更亮眼」「更出众」「陪你每一天」等缺乏区分度的口号。写完自查：买家知道了哪一条具体信息？每个数值与利益是否有依据？这句话是否只是适用于任何商品的套话？不满足就重写。"},
	{id: "kb20-category-skincare", kind: kb20CategoryKind, title: "品类打法 · 护肤美妆",
		keywords: []string{"护肤", "美妆", "面霜", "精华", "乳液", "爽肤水", "化妆水", "面膜", "洁面", "洗面奶", "防晒", "口红", "粉底", "眼霜", "身体乳", "精油", "喷雾"}, families: []string{"beauty"},
		guidance: "买家要三件事：看得见的质地、说得清的成分、摸得到的肤感。必有：① 质地屏——膏体、凝胶或液体的微距（挤出的一段、拉丝、涂开的一道、托在指尖），侧逆光打出透明和光泽，往往是整套最出彩的一屏；② 成分屏——把成分做成实物或视觉隐喻（原料植物实拍、水滴和分子结构、透明容器里的分层液体），不画参数表；③ 肤感屏——手背、指尖或侧脸局部，皮肤保留真实纹理；④ 信任屏——检测、备案、专利只写已确认的。视觉：从包装或成分里取一个主色撑整屏（BAIMISS 紫草喷雾用紫色紫草花和苔藓托着瓶身），产品放在有质感的自然物或台面上（苔藓、石头、水面、玻璃块），水波、水滴、光斑做元素。避免：每屏都摆同一张产品照，整套蓝白波浪模板。"},
	{id: "kb20-category-medical", kind: kb20CategoryKind, title: "品类打法 · 医用护理与医疗器械",
		keywords: []string{"医用", "医疗器械", "敷料", "创面", "伤口", "消毒", "理疗", "护理凝胶", "药膏", "械字号", "冷敷", "退热", "磁疗", "穴位", "膏药", "敷贴", "口罩", "咽喉", "鼻炎", "雾化", "血压", "助听", "艾灸"},
		guidance: "可信优先，但可信不等于蓝白模板。拆过的高质量医用详情页（穴位磁疗贴、蜂胶咽喉喷雾、振德口罩）共同的做法：① 色彩世界从作用推出来：助眠用午夜蓝加月光和暖金色光，咽喉清润用天空蓝、白云加蜂蜜黄，创面修护用干净的水蓝或薄荷加大量白，热敷用深色底配暖橙光；人物和场景照片统一调色到这个世界里。② 叙事顺序（按依据挑，不必全有）：首屏（商品立在展台上，一句利益加 3–4 个图标徽章）→ 痛点共鸣（问句标题，人物不适的神情配几个气泡标签，或 2×3 困扰场景宫格）→ 机理示意（皮肤或黏膜分层剖面、透明人体或器官发光、箭头和光点表示作用方向，3D 渲染质感，不是平面卡通）→ 成分或结构（原料悬浮在透明气泡里；贴剂、敷料按层爆炸展开并逐层标注）→ 质地或贴合（凝胶在指尖铺开的透明薄层，贴在皮肤上的局部）→ 证据（只在有已确认的备案、检测或认证时：证书或报告摆在展台上，文件上的字不可辨认）→ 使用后的状态（安心入睡、轻松说话的情绪大片）→ 用法（3–4 步线稿或手部特写）→ 产品信息表。③ 专业感来自真实的器物和光：无菌台面、玻璃器皿、柔和的冷光和光点，而不是满屏的波浪曲线；人物只露手或局部时皮肤真实干净。合规：不写治疗、治愈、根除、最，适用范围照包装原文，不暗示疗效，不编临床数据和认证。避免：每屏都是盒子加软管摆拍，每屏同一条蓝色波浪。"},
	{id: "kb20-category-supplement", kind: kb20CategoryKind, title: "品类打法 · 保健品与营养补充",
		keywords: []string{"保健品", "保健食品", "营养", "维生素", "胶囊", "片剂", "益生菌", "鱼油", "蛋白粉", "叶黄素", "钙片", "软糖", "膳食", "胶原蛋白肽"},
		guidance: "拆过的保健品和成分型详情页（MITOVIGOR、蜂胶喷雾的成分屏）：① 成分是主角：每个核心成分一屏或一格，原料实物微距放在圆形镜头、透明气泡或玻璃器皿里（葡萄、橄榄、蜂巢、谷物、试管里的油），配成分名和一句作用；成分多时用一个大号数字领起（「7 大核心成分」），再按 1、2、3 逐个讲。② 剂量和纯度做成大号数字徽章，只写已确认的数值。③ 整套一个饱和的色彩世界（橙红、金黄、深绿），光斑和光晕营造能量感，商品瓶身在光里。④ 信任：原料产地、检测和工艺，只写已确认的。⑤ 收尾放适用人群表（孕期、哺乳期、儿童是否适用，照包装写）和常见问答。合规：保健食品不写治疗和预防疾病，不写药效。"},
	{id: "kb20-category-kids", kind: kb20CategoryKind, title: "品类打法 · 儿童与母婴",
		keywords: []string{"儿童", "宝宝", "婴儿", "婴幼儿", "母婴", "孩子", "童装", "童鞋", "玩具", "奶瓶", "学生", "孕妇", "孕产"}, families: []string{"baby-toys"},
		guidance: "买的是家长，用的是孩子。家长关心安全、舒适、耐用，以及孩子爱不爱用（Babycare 保温杯全案：首要需求是保温，潜在需求是让宝宝爱上喝水）。画面：孩子真实的快乐瞬间（奔跑、仰头笑、专注看书、和小伙伴分享），自然光和户外（草地、树荫、公园、洒满阳光的窗边）比棚拍更有说服力；产品出现在孩子的世界里（书包侧袋、小手里、餐椅上）；材质安全用质感微距讲；耐用用动作讲（弯折、掉落、拉扯），只演示商品图里看得到的结构。色彩柔和但不发灰，可以有一个明亮主色（奶黄、草绿、天蓝）做整屏色块。文案对家长说：讲孩子的状态和家长的放心，不罗列参数。"},
	{id: "kb20-category-eyewear", kind: kb20CategoryKind, title: "品类打法 · 眼镜",
		keywords: []string{"眼镜", "镜框", "镜架", "墨镜", "太阳镜", "护目镜", "泳镜"},
		guidance: "卖的是戴上的样子和看出去的世界。① 佩戴屏是核心：人物半身或特写（儿童款用孩子），镜框和脸型的关系清楚，表情自然；② 透明镜框用背光和轮廓光打出通透，放在有颜色的背景、玻璃或水面上，让透明部分透出背景色；③ 细节屏讲铰链、鼻托、镜腿弯钩这类结构，用微距和引线；④ 视野屏最有记忆点：透过镜片看到清楚的书页或风景，镜片外虚化；⑤ 不把镜片印字和型号当卖点，不连续几屏都是眼镜平放。"},
	{id: "kb20-category-3c", kind: kb20CategoryKind, title: "品类打法 · 3C 数码",
		keywords: []string{"耳机", "手机", "数码", "充电", "数据线", "音箱", "键盘", "鼠标", "电脑", "平板", "手表", "相机", "移动电源", "智能"}, families: []string{"electronics"},
		guidance: "像发布会。① 深色或纯黑背景配精确的轮廓光，产品悬浮、放大成画面主角（Apple AirPods 页面：纯黑底，单只耳机放大占满画面，透视剖面露出芯片）；② 技术用爆炸图、剖面、X 光透视和光线轨迹讲（站酷高赞的耳机、筋膜枪、跑步机详情都这样做）；③ 参数只放最关键的一两个，做成超大号数字；④ 使用场景用人物剪影或局部，冷色环境光；⑤ 一屏一件事，文字极少。"},
	{id: "kb20-category-appliance", kind: kb20CategoryKind, title: "品类打法 · 家电",
		keywords: []string{"家电", "电器", "吸尘器", "破壁机", "豆浆机", "电饭煲", "冲牙器", "吹风机", "净化器", "风扇", "台灯", "夜灯", "加湿器", "咖啡机", "空气炸锅", "扫地"},
		guidance: "① 放进好看的家：现代厨房、客厅一角、浴室台面，用暖光营造生活品质（九阳、苏泊尔、美的的高赞详情都这样）；② 让看不见的性能被看见：风、水流、蒸汽、光用特效画出来（气流线、水花、光束）；③ 结构用剖面或爆炸图；④ 主视觉常用几何展台或拱形背景框（半圆、拱门、台阶），主色取自产品配色；⑤ 至少一屏人在用，动作真实。"},
	{id: "kb20-category-food", kind: kb20CategoryKind, title: "品类打法 · 食品饮品",
		keywords: []string{"食品", "零食", "饮料", "咖啡", "茶", "酒", "坚果", "糕点", "肉", "粮油", "调味", "花胶", "滋补", "速食", "牛奶", "果汁"}, families: []string{"food"},
		guidance: "让人想吃。① 食欲特写：切面、拉丝、滴落、热气、碎屑飞溅（劲仔用酱汁旋风裹住小鱼，坚果用爆开的碎壳和金色光环），像高速摄影抓住的瞬间；② 原料溯源：原料实物和产地场景（田野、海、茶园），不编产地；③ 色彩敢饱和：暖橙、正红、明黄做整屏色块（官栈花胶用橙红整屏托住礼盒），节日和送礼感强；④ 吃法场景：餐桌、手拿、分享；⑤ 包装大方出现，但不是每屏都摆。"},
	{id: "kb20-category-apparel", kind: kb20CategoryKind, title: "品类打法 · 服饰鞋包",
		keywords: []string{"服装", "女装", "男装", "连衣裙", "t恤", "外套", "裤", "内衣", "袜", "鞋", "运动鞋", "背包", "双肩包", "手提包", "钱包", "箱包", "帽"}, families: []string{"apparel", "bags-shoes"},
		guidance: "① 人是主角：模特大片，姿态和场景讲穿着的生活方式（运动用动态抓拍，通勤用城市街景，度假用阳光和风）；② 面料用微距和手的触摸讲：纹理、弹性拉伸、垂坠；③ 搭配屏和多色屏；④ 版式像时尚杂志：大胆裁切，超大英文标题压在画面上，竖排文字；⑤ 避免模特表情僵硬、背景空洞、每屏同一个姿势。"},
	{id: "kb20-category-home", kind: kb20CategoryKind, title: "品类打法 · 家居日用与宠物",
		keywords: []string{"家居", "收纳", "厨具", "杯", "碗", "锅", "毛巾", "床品", "香薰", "清洁", "洗衣", "纸巾", "宠物", "猫", "狗", "保温"}, families: []string{"home"},
		guidance: "家居先解释商品与空间、使用者的关系。① 用实际用途对应的餐桌、厨房、玄关或休息空间建立情境，道具少而真，不抢商品。② 外观页用完整形态与局部说明配色、轮廓和可见连接，材料成分与性能需要卖家资料。③ 使用页用真实动作或接触关系解释用途；前后对照仅在有依据时使用。④ 色彩按商品、品牌与人群选择，以明暗和留白分配主次，不强制暖色或每组插强对比色块。⑤ 全景、完整商品、可见局部和选择信息随内容交替，保持字块、摄影边界和标签的对齐与邻近；原料只画已确认的原料，宠物用品按真实用途演示。"},
	{id: kb20MainID, kind: kb20ScopeKind, title: "主图套图打法",
		guidance: "主图先让手机列表里的买家认出商品。① 首图轮廓完整，背景干净；平台要求白底时只放商品。允许文字时最多一句核心利益，字大、对比强，不加促销贴纸和价格。② 第 2–5 张各讲一个购买理由：人在用、质地微距、尺寸或对比、关键卖点；只用已有证据。③ 五张共用字体家族、色板和边距，相邻张换图文重心、机位和裁切，不固定同一个标题条或展台。④ 道具与视觉主题有关，不把全部元素重复贴在每张图上；满版生活摄影、克制的细节页和信息页交替。⑤ 讲功能用手在用的特写，必要时用细引线或局部放大镜头。⑥ 关键数字可放大，但只写已确认的数值。"},
	{id: "kb20-single-hero", kind: kb20ScopeKind, title: "单张图打法 · 海报与主视觉",
		guidance: kb20PosterDesignMethod() + "活动元素只取用户给定主题，不自动补英文、徽章、促销或承诺。"},
	{id: "kb20-single-lifestyle", kind: kb20ScopeKind, title: "单张图打法 · 种草、随手拍与场景",
		guidance: "像真实的人在真实的一天里用它。① 种草图：小红书封面的感觉，第一人称或朋友视角，桌面、窗边、包里、手里，自然光，构图略随意但讲究（留白、对角线），道具讲生活方式（书、咖啡、花、耳机），可以有一句像笔记标题的大字。② 随手拍：手机直出质感，带一点不完美（轻微偏移、自然光斑），不像广告，不加文字。③ 场景图：一个具体的时刻（清晨通勤、睡前、周末野餐、孩子放学），人或手和商品有互动，环境和目标人群匹配。④ 情绪比摆放重要，但商品要清楚可辨。"},
	{id: "kb20-single-white", kind: kb20ScopeKind, title: "单张图打法 · 白底、平铺与多角度",
		guidance: "① 白底图：纯白背景，商品占画面 80%–85%，边缘干净锐利，保留一道极轻的接触阴影，颜色和商品图一致；透明或白色的商品用深色细轮廓或背光把边缘勾清楚，不要和白底融在一起。② 平铺图：正俯拍，物件按网格或对角线排，间距一致，底面用有质感的布、木或纸。③ 多角度：同一光线和比例下并排正面、侧面、背面，只用商品图里有的角度。"},
	{id: "kb20-single-info", kind: kb20ScopeKind, title: "单张图打法 · 卖点、对比、步骤与参数",
		guidance: "信息图要像设计过的画面，不是 PPT。① 卖点图：一张大图加不超过三个图标标签，或者用细引线指向具体部位，图标线宽和风格统一。② 对比图：同一机位、同一光线，左右或上下两栏，差别一眼看出，不贬低其他品牌。③ 步骤图：三四格，每格一个动作的手部特写，编号清楚。④ 尺寸和参数图：商品正视图配细尺寸线和少量大号数字，只写已确认的参数。⑤ 细节特写：微距加侧光，质感和工艺看得清。⑥ 小部件用圆形放大镜头讲：一两个圆圈把按键、接口或质地放大在旁边，圆圈有细描边和轻投影。⑦ 作用原理用机理示意：剖面分层、箭头和光点讲清作用过程，3D 渲染质感。整张保留一个主色和足够留白，不堆满文字。"},
	{id: "kb20-single-model", kind: kb20ScopeKind, title: "单张图打法 · 模特图",
		guidance: "① 模特和目标人群一致，表情和姿态自然、有动作（走、转身、抬手、笑），不要僵直站桩。② 场景讲生活方式（街头、海边、咖啡馆、居家），自然光或大柔光，皮肤保留真实纹理。③ 商品在画面里清楚，穿戴方式正确。④ 构图像时尚杂志：大胆裁切，留出标题位。⑤ 造型和布景跟商品配色：服装、道具和背景取商品的颜色或它的互补色（按摩仪的模特穿浅蓝吊带配米白长裤，和米色机身、浅蓝布景成一套）。⑥ 动作就是用商品的动作（靠着、提着、闭眼放松、单手握住），表情跟着商品带来的感受走。⑦ 一组模特图用同一个模特、同一套布景，换姿势和机位。"},
	{id: kb20GenericID, kind: kb20CategoryKind, title: "品类打法 · 通用",
		guidance: "用途未知时先展示可见轮廓和局部，不编使用动作、买家动机或功能。用途已确认时以整件识别、真实使用、可见细节和选择信息推进；只有依据充足时使用机理或对照。整套统一色板、字体家族和边距，按各屏内容改变景别、尺度、留白和图文重心，不固定摄影数量比例，也不强制人物、场景或色块。"},
	{id: "kb20-light-transparent", kind: kb20PhotoKind, title: "布光 · 透明材质",
		keywords: []string{"透明", "亚克力", "玻璃", "镜片", "水晶", "半透明", "通透"},
		guidance: "透明材质：背光或侧逆光为主，让透明部分发亮；用深色卡纸在边缘勾出黑色轮廓线，透明体的形状才清楚；放在有颜色的背景或彩色反光板前，透明部分透出颜色；避免正面平光，否则透明会发灰发脏。"},
	{id: "kb20-light-gloss", kind: kb20PhotoKind, title: "布光 · 亮面塑料、软管与瓶身",
		keywords: []string{"软管", "瓶", "塑料", "亮面", "光面", "包装盒", "罐"},
		guidance: "亮面瓶身和软管：一盏大面积长条柔光沿瓶身方向打出一条干净的长高光，另一侧用黑旗压暗，体积就出来了；标签面迎着光，字清楚；底部要有真实的接触阴影或淡淡倒影；不要平光把瓶身拍成一张贴图。"},
	{id: "kb20-light-texture", kind: kb20PhotoKind, title: "布光 · 凝胶、乳霜和液体质地",
		keywords: []string{"凝胶", "啫喱", "乳液", "精华", "膏", "霜", "液", "精油", "食用油", "植物油", "酱", "蜂蜜"},
		guidance: "质地微距：挤出的一段、拉丝、在玻璃或指尖上铺开的一道；侧逆光让透明质地发光，看得见光泽和细小气泡；背景用主色的深色或浅色纯色，景深极浅，焦点落在质地最亮的边缘。"},
	{id: "kb20-light-metal", kind: kb20PhotoKind, title: "布光 · 金属",
		keywords: []string{"金属", "不锈钢", "铝", "铜", "镀", "钛", "合金"},
		guidance: "金属：大面积柔光加黑白旗板控制反射的形状，做出平滑的渐变高光；轮廓光勾边；避开小光源造成的杂乱亮点，金属表面要像镜子一样干净。"},
	{id: "kb20-light-fabric", kind: kb20PhotoKind, title: "布光 · 面料",
		keywords: []string{"棉", "面料", "针织", "毛", "绒", "皮革", "布", "丝", "麻"},
		guidance: "面料：侧光掠过表面打出纹理和起伏；微距配合手的触摸、拉伸或揉捏；避免正面平光把质感抹平。"},
	{id: "kb20-light-food", kind: kb20PhotoKind, title: "布光 · 食物",
		keywords: []string{"食品", "零食", "肉", "糕点", "饮料", "咖啡", "茶", "汤", "面"},
		guidance: "食物：侧逆光打出热气、油光和酥脆的边缘，45 度或俯拍；抓动态瞬间（掰开、拉丝、倒入、溅起）；暖色光，背景压暗突出食物。"},
	{id: "kb20-light-skin", kind: kb20PhotoKind, title: "布光 · 人物与皮肤",
		keywords: []string{"儿童", "宝宝", "模特", "佩戴", "上身", "皮肤"},
		guidance: "人物：大窗光或大柔光箱做主光，皮肤保留真实纹理，不磨成塑料；眼睛里有眼神光；儿童用户外自然光和抓拍，表情真实；手部干净，动作是真实的使用方式。"},
}

func kb20DesignPlanningKnowledge() []model.EcommerceKnowledgeEntry {
	entries := make([]model.EcommerceKnowledgeEntry, 0, len(kb20DesignSpecs))
	for _, spec := range kb20DesignSpecs {
		content, _ := json.Marshal(map[string]string{"guidance": spec.guidance, "domain": ecommerceKB20Domain, "application": "生图台出图策划：视觉策划、品类打法、布光、版式与文案"})
		tags, _ := json.Marshal(spec.keywords)
		entries = append(entries, model.EcommerceKnowledgeEntry{
			ID: spec.id, SourceID: ecommerceBuiltinSourceID(ecommerceKB20Domain), KnowledgeDomain: ecommerceKB20Domain, KnowledgeType: spec.kind,
			Title: spec.title, ContentJSON: string(content), Category: "general", TagsJSON: string(tags), PlatformsJSON: "[]", LanguagesJSON: "[]",
			SourceURL: "builtin://meiyeai/kb20-design-planning", Version: ecommerceKB20Version, TrustLevel: "first_party", ReviewStatus: "approved", License: "MeiYeAI KB20 Original",
		})
	}
	return append(entries, kb20StudioCatalogKnowledge()...)
}

// The same IDs and methods drive the knowledge library, planner and studio UI.
// Sorting keeps bootstrap hashes and selection order stable across builds.
func kb20StudioCatalogKnowledge() []model.EcommerceKnowledgeEntry {
	catalog, err := ecommerceagent.ReadStudioDesignCatalog()
	if err != nil {
		panic(fmt.Sprintf("invalid embedded studio design catalog: %v", err))
	}
	entries := []model.EcommerceKnowledgeEntry{}
	add := func(id, kind, title, guidance string, platforms []string) {
		content, _ := json.Marshal(map[string]string{"guidance": guidance, "domain": ecommerceKB20Domain, "provenance": catalog.Provenance, "application": "生图台策划与出图，共享设计目录"})
		platformJSON, _ := json.Marshal(platforms)
		entries = append(entries, model.EcommerceKnowledgeEntry{
			ID: "kb20-studio-" + id, SourceID: ecommerceBuiltinSourceID(ecommerceKB20Domain), KnowledgeDomain: ecommerceKB20Domain, KnowledgeType: kind,
			Title: title, ContentJSON: string(content), Category: "general", PlatformsJSON: string(platformJSON), LanguagesJSON: "[]", TagsJSON: "[]",
			SourceURL: "builtin://meiyeai/studio-design-catalog/" + id, Version: ecommerceKB20Version, TrustLevel: "first_party", ReviewStatus: "approved", License: "MeiYeAI KB20 Original",
		})
	}
	for id, layout := range catalog.Layouts {
		add("layout-"+id, "layout_pattern", "信息版式 · "+layout.Label, "适用："+layout.Use+"。执行："+layout.Render+"。文案："+layout.Lines+"。编号："+id+"；仅依据已确认信息使用。", []string{})
	}
	for id, composition := range catalog.Compositions {
		add("composition-"+id, "layout_pattern", "图文构图 · "+composition.Label, composition.Render+"。主标题与注解区域："+string(composition.Zone)+"。编号："+id+"；信息元素标签贴对应部位，不覆盖商品。", []string{})
	}
	for id, guidance := range catalog.Platforms {
		add("platform-"+id, "platform_rule", "平台设计方法 · "+id, guidance+" 这是平台阅读情境的设计方法，数值、白底和禁字要求仍以平台规格与商家后台为准。", []string{id})
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].ID < entries[j].ID })
	return entries
}
