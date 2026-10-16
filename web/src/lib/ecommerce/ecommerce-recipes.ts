/**
 * 电商创作的选择库：拍法、品牌风格、画幅。
 *
 * 这些都不是"配方清单"：拍法节点和风格节点都是普通节点，载入之后每个字段都能改，
 * 改完可以再存成自己的预设。这里只是让用户不用从空白开始。
 *
 * 拍法预设是**单张的模板**——它描述"这一张怎么拍"。一整套图的拍法由交付物结构
 * 组装成一张清单（见 ecommerce-deliverables.ts 与 createEcommerceShotSetFromSlots）。
 */
import { createEcommerceShot, createEcommerceShotSet, createEcommerceStyle, type EcommerceShot, type EcommerceShotSet, type EcommerceStyle } from "./ecommerce-contract";

export type EcommerceShotPreset = {
    id: string;
    /** 分组，用于在节点里分区展示 */
    group: string;
    name: string;
    /** 一句话说明这张图解决什么，给用户看 */
    hint: string;
    shot: Omit<EcommerceShot, "id" | "title">;
};

export const ECOMMERCE_SHOT_GROUPS = ["基础", "场景", "细节", "展示", "信息", "营销", "内容", "信息图", "海外"] as const;

export const ECOMMERCE_SHOT_PRESETS: EcommerceShotPreset[] = [
    // ── 基础 ──────────────────────────────────────────────
    {
        id: "studio-white", group: "基础", name: "白底棚拍", hint: "列表首图，背景干净、商品完整",
        shot: {
            purpose: "电商主图，用于商品列表首图",
            composition: "商品完整入画，居中或按三分构图，正面或微侧角度，四周留出约 15% 余量",
            lighting: "柔和均匀棚拍布光，主光位于右上方 45°，保留自然接触阴影",
            color: "中性白，低饱和，色温约 5500K",
            lens: "85mm 定焦，f/8，平视机位",
            background: "纯白无缝背景",
            copyZone: "顶部留出标题位，不生成任何文字",
            negative: "杂物、水印、多余文字、夸张反光、硬阴影",
        },
    },
    {
        id: "studio-grey", group: "基础", name: "灰底棚拍", hint: "比纯白更立体，适合浅色商品",
        shot: {
            purpose: "商品主图或详情页首屏",
            composition: "商品完整入画，居中，略低于平视角度以显体积",
            lighting: "棚拍柔光箱，主光 45° 侧上方，加一层补光压暗部",
            color: "中性浅灰背景，商品色彩还原优先",
            lens: "85mm，f/8",
            background: "浅灰到深灰的渐变无缝背景",
            copyZone: "底部留出文案位，不生成任何文字",
            negative: "纯白背景、过曝、商品与背景融为一体",
        },
    },
    {
        id: "flat-lay", group: "基础", name: "俯拍平铺", hint: "从上往下，适合小件与套装",
        shot: {
            purpose: "商品主图或详情页，用于小件、套装、多件组合",
            composition: "正俯拍，商品平铺于画面中央，可含配件但主次分明",
            lighting: "大面积顶光，阴影柔和不遮挡细节",
            color: "背景与商品形成明确对比",
            lens: "50mm，f/8，正俯 90°",
            background: "哑光台面，可为石材、木纹或纯色",
            copyZone: "一侧留出文案位，不生成任何文字",
            negative: "透视变形、俯拍角度不垂直、边缘裁切",
        },
    },

    // ── 场景 ──────────────────────────────────────────────
    {
        id: "lifestyle-home", group: "场景", name: "家居场景", hint: "客厅、卧室、桌面等居家环境",
        shot: {
            purpose: "商品场景图，用于详情页与种草",
            composition: "中景，商品位于视觉重心，家居元素围绕但不遮挡主体",
            lighting: "窗光为主，光线方向明确，保留真实明暗层次",
            color: "暖调，与环境协调",
            lens: "50mm，f/2.8，浅景深",
            background: "真实居家环境，可含家具与生活物品",
            copyZone: "下方或右侧留出文案位，不生成任何文字",
            negative: "影棚感、塑料感、过曝、虚假材质",
        },
    },
    {
        id: "lifestyle-kitchen", group: "场景", name: "厨房场景", hint: "台面、食材、烟火气",
        shot: {
            purpose: "食品、厨具、餐具类商品场景图",
            composition: "中近景，商品置于台面，可含食材或器具作为陪衬",
            lighting: "侧逆窗光，强调食物质感与器皿光泽",
            color: "暖白调，食欲感优先",
            lens: "50mm，f/2.8",
            background: "厨房台面与墙面，背景适度虚化",
            copyZone: "上部留出文案位，不生成任何文字",
            negative: "脏乱、生冷色调、与食物无关的杂物",
        },
    },
    {
        id: "lifestyle-cafe", group: "场景", name: "咖啡厅场景", hint: "木桌、暖光、都市感",
        shot: {
            purpose: "饮品、文具、配饰类商品场景图",
            composition: "中景，商品置于桌面，背景含咖啡厅环境",
            lighting: "暖色环境光与窗光混合，有明确方向",
            color: "暖棕调，低饱和",
            lens: "35mm，f/2，环境交代清楚",
            background: "木质桌面、绿植、暖色墙面",
            copyZone: "右侧留出文案位，不生成任何文字",
            negative: "冷白光、空旷背景、商业影棚感",
        },
    },
    {
        id: "lifestyle-outdoor", group: "场景", name: "户外场景", hint: "自然光、开阔、透气",
        shot: {
            purpose: "户外、运动、旅行类商品场景图",
            composition: "中景或远景，商品与环境尺度关系清楚",
            lighting: "自然日光，可用黄金时段侧逆光",
            color: "自然色，天空与植被色彩真实",
            lens: "35mm，f/4",
            background: "真实户外环境，可含天空、植被、地面材质",
            copyZone: "天空或空地留出文案位，不生成任何文字",
            negative: "虚假天空、过度 HDR、与品类不符的环境",
        },
    },
    {
        id: "lifestyle-office", group: "场景", name: "办公场景", hint: "桌面、屏幕、通勤感",
        shot: {
            purpose: "数码、文具、办公用品类商品场景图",
            composition: "中景，商品位于桌面视觉重心",
            lighting: "均匀室内光，避免屏幕反光",
            color: "中性偏冷，干净利落",
            lens: "50mm，f/4",
            background: "办公桌面、笔记本电脑、文具等",
            copyZone: "一侧留出文案位，不生成任何文字",
            negative: "杂乱线缆、过时设备、昏暗环境",
        },
    },
    {
        id: "lifestyle-holiday", group: "场景", name: "节日场景", hint: "节庆氛围与装饰",
        shot: {
            purpose: "节日促销期的场景图",
            composition: "中景，商品为主体，节庆装饰围绕",
            lighting: "暖色氛围光，可含灯串或烛光效果",
            color: "节庆色系，氛围浓于日常图",
            lens: "50mm，f/2.8",
            background: "节庆装饰背景，不抢主体",
            copyZone: "四周预留文案位，不生成任何文字",
            negative: "自造节日标识、自造品牌元素、装饰遮挡商品",
        },
    },

    // ── 细节 ──────────────────────────────────────────────
    {
        id: "macro-material", group: "细节", name: "材质特写", hint: "放大纹理与质感",
        shot: {
            purpose: "商品细节图，用于证明材质",
            composition: "近景或微距，聚焦材质表面，商品其余部分自然出画",
            lighting: "侧光或侧逆光，突出纹理起伏，避免正面平光",
            color: "还原真实材质色彩，不加重色彩倾向",
            lens: "100mm 微距，f/4，极浅景深",
            background: "商品自身的其他部分或极简背景",
            copyZone: "不预留文案位",
            negative: "放大参考图中不存在的细节、添加纹理、虚构结构",
        },
    },
    {
        id: "macro-craft", group: "细节", name: "工艺特写", hint: "缝线、接口、做工",
        shot: {
            purpose: "商品细节图，用于证明工艺水平",
            composition: "近景，聚焦接缝、接口、边角等工艺部位",
            lighting: "低角度侧光，让工艺结构产生明确阴影",
            color: "真实色彩，不美化",
            lens: "100mm 微距，f/5.6",
            background: "商品自身",
            copyZone: "不预留文案位",
            negative: "掩盖瑕疵、虚构工艺、添加不存在的装饰",
        },
    },
    {
        id: "macro-structure", group: "细节", name: "结构展示", hint: "拆解、剖面、可动部件",
        shot: {
            purpose: "商品细节图，用于说明结构与功能",
            composition: "中近景，展示可动部件、拆解状态或关键结构",
            lighting: "清晰的功能性布光，结构关系不含糊",
            color: "中性",
            lens: "50mm，f/8",
            background: "简洁背景，不干扰结构判读",
            copyZone: "一侧留出标注位，不生成任何文字与引线",
            negative: "虚构不存在的部件、改变结构数量、掩盖真实构造",
        },
    },

    // ── 展示 ──────────────────────────────────────────────
    {
        id: "model-wearing", group: "展示", name: "模特上身", hint: "人物穿着或佩戴",
        shot: {
            purpose: "模特展示图，用于服饰与配件",
            composition: "半身或全身，模特自然穿着或使用商品，商品是画面焦点",
            lighting: "柔和人像光，光线与模特肤色协调",
            color: "真实肤色，商品色彩优先准确",
            lens: "85mm，f/2，平视或略低机位",
            background: "简洁或场景化背景，不抢主体",
            copyZone: "不预留文案位",
            negative: "改变商品版型、虚构未展示的结构、改变颜色图案",
        },
    },
    {
        id: "model-holding", group: "展示", name: "手持展示", hint: "手部交互，真实尺度感",
        shot: {
            purpose: "商品展示图，用于建立真实尺度感",
            composition: "中近景，手自然持握或操作商品，商品完整可辨",
            lighting: "柔和自然光，手部阴影不遮挡商品关键部位",
            color: "真实肤色与商品色",
            lens: "50mm，f/2.8",
            background: "简洁或场景化背景",
            copyZone: "一侧留出文案位，不生成任何文字",
            negative: "手部畸变、多余手指、遮挡商品标识、改变商品比例",
        },
    },
    {
        id: "hanging", group: "展示", name: "悬挂展示", hint: "衣架、挂绳、垂坠感",
        shot: {
            purpose: "服饰、布艺类商品展示图",
            composition: "正面平视，商品自然垂挂，完整展现轮廓与垂坠",
            lighting: "正面柔光加侧光，突出面料垂坠与褶皱",
            color: "中性背景，商品色彩准确",
            lens: "50mm，f/5.6",
            background: "纯色墙面或浅色背景",
            copyZone: "一侧留出文案位，不生成任何文字",
            negative: "衣架变形、面料僵硬、虚构图案",
        },
    },

    // ── 信息 ──────────────────────────────────────────────
    {
        id: "selling-point", group: "信息", name: "卖点信息图", hint: "突出单一卖点，预留文案与图标位",
        shot: {
            purpose: "商品卖点图，用于详情页信息模块",
            composition: "商品占据主体，一侧或底部预留信息区，信息层级清晰",
            lighting: "干净明亮的均匀光，突出商品本体",
            color: "背景低对比，让商品与信息区都清晰可读",
            lens: "50mm，f/5.6，平视",
            background: "简洁纯色或渐变背景",
            copyZone: "一侧或底部留出标题、正文与图标位置，不生成任何文字与图标",
            negative: "自造文字、自造图标、自造认证标识、虚构参数",
        },
    },
    {
        id: "spec-compare", group: "信息", name: "参数对比", hint: "多规格并排，差异清楚",
        shot: {
            purpose: "多规格商品的对比图",
            composition: "多个规格并排，间距均匀，尺寸与位置可比",
            lighting: "完全一致的布光，避免规格之间出现观感差异",
            color: "统一背景色，只有商品本身有色彩差异",
            lens: "50mm，f/8，正视角",
            background: "纯色背景，可含刻度或分隔线（不含文字）",
            copyZone: "每个规格下方留出标注位，不生成任何文字与数字",
            negative: "规格之间布光不一致、比例失真、自造参数",
        },
    },
    {
        id: "size-guide", group: "信息", name: "尺寸示意", hint: "标出真实尺寸关系",
        shot: {
            purpose: "尺寸说明图",
            composition: "正视角，商品与常见参照物并排，尺度关系一目了然",
            lighting: "均匀无阴影的平光，避免透视误判尺寸",
            color: "中性背景",
            lens: "50mm，f/8，尽量长焦压缩透视",
            background: "纯色背景",
            copyZone: "四周留出尺寸标注位，不生成任何文字与数字",
            negative: "透视导致尺寸误判、自造尺寸数字、参照物与商品比例失真",
        },
    },

    // ── 营销 ──────────────────────────────────────────────
    {
        id: "promo-keyvisual", group: "营销", name: "促销主视觉", hint: "氛围强，预留价格与标题位",
        shot: {
            purpose: "促销海报主视觉",
            composition: "商品居中或偏侧占据主要画面，四周预留标题、价格与行动引导位置",
            lighting: "戏剧化布光，有明确主光与氛围光",
            color: "有明确的色彩倾向与氛围，饱和度可高于日常图",
            lens: "50mm，f/2.8，略低机位增强体量感",
            background: "有氛围与质感的背景，可含光效",
            copyZone: "四周预留标题、价格、行动引导位置，不生成任何文字与价格",
            negative: "自造价格、自造优惠信息、自造品牌口号、杂乱元素",
        },
    },
    {
        id: "new-arrival", group: "营销", name: "新品预告", hint: "克制、悬念、高级感",
        shot: {
            purpose: "新品发布的预告图",
            composition: "商品部分入画或置于暗部，留出悬念但主体可辨",
            lighting: "低调布光，主光窄且有方向，暗部保留层次",
            color: "深色为主，商品色彩是画面唯一亮点",
            lens: "85mm，f/2",
            background: "深色渐变或质感暗背景",
            copyZone: "大面积留白或暗区留给标题，不生成任何文字",
            negative: "过度曝光商品全貌、杂乱光斑、廉价感",
        },
    },
    {
        id: "live-room", group: "营销", name: "直播间场景", hint: "货架、灯光、带货氛围",
        shot: {
            purpose: "直播或短视频封面用的场景图",
            composition: "中景，商品居中清晰，背景有货架或展示墙",
            lighting: "明亮的环形光或柔光箱，商品无死角",
            color: "高亮明快，屏幕观感优先",
            lens: "35mm，f/2.8",
            background: "直播间背景，可含货架与其他商品（虚化）",
            copyZone: "上部与底部留出文案位，不生成任何文字与价格",
            negative: "自造价格与优惠、背景商品喧宾夺主、昏暗",
        },
    },

    // ── 内容 ──────────────────────────────────────────────
    {
        id: "ugc-lifestyle", group: "内容", name: "生活种草", hint: "第一人称，真实感优先",
        shot: {
            purpose: "种草图，用于社媒与内容平台",
            composition: "第一人称或朋友视角，构图随意不刻意，可有手部交互",
            lighting: "自然光，允许不完美的光线条件",
            color: "真实生活色调，允许环境色偏",
            lens: "手机广角等效 26mm，f/1.8",
            background: "真实生活场景，可有生活痕迹",
            copyZone: "不预留文案位",
            negative: "影棚感、过度精致、摆拍痕迹、虚假材质",
        },
    },
    {
        id: "unboxing", group: "内容", name: "开箱", hint: "包装、开盒、第一眼",
        shot: {
            purpose: "开箱内容图",
            composition: "中近景，包装与商品同时入画，展示开盒状态",
            lighting: "柔和顶光加补光，包装细节清晰",
            color: "真实色彩，包装印刷色准确",
            lens: "35mm，f/2.8",
            background: "桌面或地毯等真实开箱环境",
            copyZone: "不预留文案位",
            negative: "改变包装印刷、虚构包装内容物、伪造品牌标识",
        },
    },
    {
        id: "in-use", group: "内容", name: "使用过程", hint: "正在用，动作中",
        shot: {
            purpose: "使用场景图，用于说明商品怎么用",
            composition: "中景，捕捉正在使用商品的动作瞬间，商品与动作关系清楚",
            lighting: "自然光或环境光，允许动态模糊增加真实感",
            color: "真实环境色",
            lens: "35mm，f/2.8",
            background: "真实使用环境",
            copyZone: "不预留文案位",
            negative: "动作僵硬、商品被遮挡、虚构使用方式",
        },
    },
    {
        id: "plog-desk", group: "内容", name: "好物 Plog", hint: "桌面随手拍，像自己发的日常",
        shot: {
            purpose: "种草图，小红书/抖音图文用",
            composition: "略俯视的桌面视角，商品不在正中，旁边有生活物件（杯子、书、耳机），构图随意不刻意",
            lighting: "窗边自然光，允许一侧偏暗，不补光",
            color: "真实生活色调，允许轻微色偏与噪点",
            lens: "手机主摄等效 26mm，f/1.8，手持视角",
            background: "真实桌面，可有使用痕迹、线缆、便签",
            copyZone: "上方留出标题位，不生成任何文字",
            negative: "影棚感、过度精致、完美对称、商业布光、虚假材质",
        },
    },
    {
        id: "ootd", group: "内容", name: "穿搭 OOTD", hint: "全身镜前，日常穿搭记录",
        shot: {
            purpose: "服饰种草图，用于小红书/抖音",
            composition: "全身或七分身，对镜自拍视角，手机遮住部分面部，商品是画面主体",
            lighting: "室内顶光或窗光，有真实阴影",
            color: "真实环境色，不调成统一色调",
            lens: "手机广角等效 24mm，f/1.8",
            background: "真实居家环境，可有镜子边缘、衣柜、地板",
            copyZone: "一侧留出文字位，不生成任何文字",
            negative: "影棚布光、模特棚拍感、换脸痕迹、改变服装版型与图案",
        },
    },
    {
        id: "checkin", group: "内容", name: "外出打卡", hint: "在外随手拍，地点可辨识",
        shot: {
            purpose: "种草图，带场景地点感",
            composition: "手持或放在台面上，背景有可辨识的环境（咖啡馆、街景、户外），商品占画面三分之一左右",
            lighting: "自然光，逆光或侧逆光，允许过曝的高光",
            color: "环境色主导，商品色彩自然",
            lens: "手机主摄等效 26mm，f/1.8",
            background: "真实外景，适度虚化",
            copyZone: "下方留出文字位，不生成任何文字",
            negative: "棚拍感、背景假造、商品占比过大像广告、虚构地标",
        },
    },
    {
        id: "buyer-show", group: "内容", name: "买家秀", hint: "素人视角晒单，最不像广告",
        shot: {
            purpose: "买家秀/评价配图，用于详情页与评价区",
            composition: "手持或平放在生活台面上，商品完整可辨，画面朴素不做设计",
            lighting: "室内灯光，不追求均匀，允许色温偏黄",
            color: "不加滤镜的真实色彩",
            lens: "手机主摄等效 26mm，f/2.2",
            background: "真实家居环境，可有包装盒、快递袋、桌面杂物",
            copyZone: "不预留文案位",
            negative: "精修感、品牌露出过强、摆拍痕迹、完美构图、虚假使用场景",
        },
    },
    {
        id: "info-feature", group: "信息图", name: "卖点标注图", hint: "商品居中，引线指向各部位",
        shot: {
            purpose: "信息图，卖点标注。标注文字由模型按提示词逐字渲染",
            composition: "商品完整居中，四周留出约 25% 的空白用于放标注框，商品不要压边",
            lighting: "均匀柔和布光，商品各部位都清晰可辨——标注要指向的部位不能处在阴影里",
            color: "中性背景，商品色彩准确",
            lens: "85mm，f/8，平视",
            background: "纯色或极简背景，不与商品争视线",
            copyZone: "标注框排在商品两侧，引线从标注框指到商品对应部位，标注文字清晰可读、字号足够手机端辨认",
            negative: "自造参数、自造认证标识、水印、与给定文字不一致的错别字",
        },
    },
    {
        id: "info-dimension", group: "信息图", name: "尺寸标注图", hint: "正视角，比例不变形",
        shot: {
            purpose: "信息图，尺寸标注。尺寸数字必须与给定值完全一致",
            composition: "正视角完整入画，尽量长焦压缩透视——透视会让尺寸判断出错；商品居中，四周留出标注空间",
            lighting: "均匀无阴影的平光，避免明暗关系干扰对轮廓的判断",
            color: "中性背景，轮廓与背景对比清楚",
            lens: "85mm 以上，f/8，正视角，机位与商品中心等高",
            background: "纯色背景",
            copyZone: "尺寸线与数字标在商品对应边上，数字清晰可读",
            negative: "透视变形、广角近拍、与给定值不符的数字、自造刻度、参照物",
        },
    },
    {
        id: "info-material", group: "信息图", name: "材质分解图", hint: "侧光突出材质层次",
        shot: {
            purpose: "信息图，材质分解。每层的材质名由模型按提示词渲染",
            composition: "中近景，商品以能看出层次结构的角度呈现，可含可动部件或分层结构",
            lighting: "侧光或侧逆光，让不同材质产生可区分的反光差异",
            color: "还原真实材质色彩",
            lens: "100mm 微距或 50mm，f/5.6",
            background: "简洁背景",
            copyZone: "一侧留出分层标注位，每层一行材质名",
            negative: "虚构结构、添加不存在的材质层、自造材质名",
        },
    },
    {
        id: "info-specs", group: "信息图", name: "参数表图", hint: "商品在上，规格表在下",
        shot: {
            purpose: "信息图，参数表。表格里的数字必须与给定值完全一致，不得改写或四舍五入",
            composition: "商品位于画面上半部，下方约 40% 的区域放表格",
            lighting: "干净明亮的均匀光",
            color: "浅色背景，保证表格文字压上去仍可读",
            lens: "50mm，f/8，平视",
            background: "纯色或浅渐变背景",
            copyZone: "下半部画规格表，表头加底色，行列数与给定表格一致，不得增删行列",
            negative: "与给定值不符的数字、自造参数、多余行列、图标、复杂背景",
        },
    },
    {
        id: "overseas-lifestyle", group: "海外", name: "海外生活场景", hint: "西式家居与使用习惯",
        shot: {
            purpose: "海外 listing 场景图，用于 Amazon/Walmart 第 2–7 图位",
            composition: "中景，商品在使用环境中，人物可选且不露正脸，符合目标市场的居住与使用习惯",
            lighting: "自然窗光，明亮通透，欧美市场偏好高调明亮",
            color: "中性偏暖，色彩饱和度适中",
            lens: "50mm，f/2.8",
            background: "西式家居或办公环境，元素简洁",
            copyZone: "不预留文案位——海外附图若要加标注，走信息图节点",
            negative: "中式元素、影棚感、过暗、与目标市场不符的使用方式",
        },
    },
];

export function ecommerceShotPreset(id: string) {
    return ECOMMERCE_SHOT_PRESETS.find((preset) => preset.id === id);
}

/** 用拍法库里的某一项建一行拍摄清单。title 留空则用预设名。 */
export function createEcommerceShotFromPreset(id: string, title?: string, shotId?: string): EcommerceShot | undefined {
    const preset = ecommerceShotPreset(id);
    if (!preset) return undefined;
    return { ...createEcommerceShot(title || preset.name, shotId), ...preset.shot };
}

/**
 * 把交付物结构组装成一张拍摄清单。
 *
 * 清单的行号直接沿用交付物槽位 id——产物图片节点上的 ecommerceShotId 记的是同一个值，
 * 两边靠它对齐。用槽位 id 而不是序号，是为了用户删掉中间一行时其余的行不会错位。
 *
 * 槽位的 duty 覆盖预设的通用 purpose：交付物说的是「这一张在整套里的职责」
 * （搜索页只展示这一张，决定点击率），比预设的「电商主图」具体得多，也更该进提示词。
 */
export function createEcommerceShotSetFromSlots(name: string, slots: { id: string; title: string; duty?: string; presetId: string }[]): EcommerceShotSet {
    const set = createEcommerceShotSet(name);
    set.shots = slots
        .map((slot) => {
            const shot = createEcommerceShotFromPreset(slot.presetId, slot.title, slot.id);
            if (!shot) return undefined;
            return slot.duty?.trim() ? { ...shot, purpose: slot.duty.trim() } : shot;
        })
        .filter((shot): shot is EcommerceShot => Boolean(shot));
    return set;
}

/** 按分组归拢，供节点分区展示。 */
export function ecommerceShotPresetsByGroup() {
    return ECOMMERCE_SHOT_GROUPS
        .map((group) => ({ group, presets: ECOMMERCE_SHOT_PRESETS.filter((preset) => preset.group === group) }))
        .filter((entry) => entry.presets.length);
}

// ── 品牌风格 ────────────────────────────────────────────────

export type EcommerceStylePreset = {
    id: string;
    hint: string;
    style: Omit<EcommerceStyle, "name"> & { name: string };
};

export const ECOMMERCE_STYLE_PRESETS: EcommerceStylePreset[] = [
    {
        id: "minimal-white", hint: "干净、克制、大留白",
        style: { name: "极简白", palette: ["#FFFFFF", "#F5F5F3", "#1A1A1A"], tone: "中性白，低饱和，色温 5500K", mood: "干净、克制、留白充足", typography: "无衬线，字重对比强，行距宽松" },
    },
    {
        id: "premium-dark", hint: "深色、金属、高对比",
        style: { name: "轻奢深色", palette: ["#0E0E10", "#1C1C1F", "#C9A227", "#E8E6E1"], tone: "低调深色，高对比，金色点缀", mood: "克制的高级感，暗部保留层次", typography: "细衬线标题配无衬线正文" },
    },
    {
        id: "natural-organic", hint: "大地色、柔和、自然",
        style: { name: "自然有机", palette: ["#E8E2D5", "#A8B5A0", "#6B5B4A", "#F7F4EE"], tone: "暖调大地色，低饱和，柔和过渡", mood: "温和、真实、无攻击性", typography: "圆润无衬线，字重轻" },
    },
    {
        id: "vivid-retail", hint: "高饱和、明快、促转化",
        style: { name: "活力快消", palette: ["#FF4D2E", "#FFC93C", "#FFFFFF", "#1A1A1A"], tone: "高饱和暖色，明度高", mood: "热烈、直接、有推动力", typography: "粗黑无衬线，字重极强" },
    },
    {
        id: "vintage-film", hint: "暖调、颗粒、复古",
        style: { name: "复古胶片", palette: ["#D9C7A7", "#8C5A3C", "#3B3228", "#F0E9DC"], tone: "暖黄调，低对比，轻微颗粒", mood: "怀旧、手工感、有时间痕迹", typography: "复古衬线，字距略松" },
    },
    {
        id: "tech-cool", hint: "冷蓝、锐利、精密",
        style: { name: "科技冷感", palette: ["#0A1628", "#1E3A5F", "#4FA3D1", "#E6EDF3"], tone: "冷蓝调，高对比，锐利边缘", mood: "精密、冷静、有未来感", typography: "等宽或几何无衬线" },
    },
];

export function ecommerceStylePreset(id: string) {
    return ECOMMERCE_STYLE_PRESETS.find((preset) => preset.id === id);
}

export function createEcommerceStyleFromPreset(id: string): EcommerceStyle | undefined {
    const preset = ecommerceStylePreset(id);
    return preset ? { ...createEcommerceStyle(preset.style.name), ...preset.style } : undefined;
}

// ── 画幅 ────────────────────────────────────────────────────

export type EcommerceAspectRatio = { id: string; label: string; hint: string };

export const ECOMMERCE_ASPECT_RATIOS: EcommerceAspectRatio[] = [
    { id: "1:1", label: "1:1", hint: "列表主图，淘宝/亚马逊通用" },
    { id: "4:5", label: "4:5", hint: "小红书/Instagram 竖版" },
    { id: "3:4", label: "3:4", hint: "淘宝详情页与主图" },
    { id: "9:16", label: "9:16", hint: "抖音/视频号/快拍" },
    { id: "16:9", label: "16:9", hint: "横版海报与头图" },
    { id: "2:3", label: "2:3", hint: "服饰类竖版主图" },
];

// ── 字体风格 ────────────────────────────────────────────────

/**
 * 字体气质预设。
 *
 * 与「色彩美学」是两件事，所以要各有一个选择器：同一套色板配无衬线是干净，
 * 配粗黑是张扬。图上文字是买家最先读到的东西，字是什么脾气直接影响
 * 「这是什么档次的牌子」——这一条不能只交给模型随口定。
 *
 * 这里描述的是**气质**而不是具体字体文件：图片模型渲染不出指定的字体，
 * 但它能听「字重对比强、行距宽松」这种话，而那正是决定观感的部分。
 */
export type EcommerceTypographyPreset = { id: string; name: string; hint: string; typography: string };

export const ECOMMERCE_TYPOGRAPHY_PRESETS: EcommerceTypographyPreset[] = [
    { id: "modern-sans", name: "现代无衬线", hint: "干净、通用，多数品类都安全", typography: "无衬线，字重对比强，行距宽松，字面干净不带装饰" },
    { id: "elegant-serif", name: "优雅衬线", hint: "护肤、香氛、珠宝、茶", typography: "细衬线标题配无衬线正文，字距略开，行距从容" },
    { id: "bold-impact", name: "粗黑力量", hint: "3C、运动、工具、促销", typography: "极粗无衬线，标题占满一行，字距紧，几乎不留白" },
    { id: "rounded-friendly", name: "圆润亲和", hint: "母婴、宠物、食品", typography: "圆体无衬线，笔画圆头，字重中等，行距偏大" },
    { id: "handwritten-casual", name: "手写随性", hint: "种草、手作、文创", typography: "手写感，笔画不匀，轻微倾斜，像随手写上去的" },
    { id: "mono-geek", name: "等宽极客", hint: "数码、极客周边", typography: "等宽字体，字距统一，对齐严格，带轻微机械感" },
];

export function ecommerceTypographyPreset(id: string) {
    return ECOMMERCE_TYPOGRAPHY_PRESETS.find((preset) => preset.id === id);
}

export function ecommerceTypographyPresetFor(typography: string) {
    return ECOMMERCE_TYPOGRAPHY_PRESETS.find((preset) => preset.typography === typography);
}

// ── 图上文字的语言 ─────────────────────────────────────────

export type EcommerceLanguageId = "zh" | "en" | "bilingual";

export const ECOMMERCE_LANGUAGES: { id: EcommerceLanguageId; name: string; hint: string }[] = [
    { id: "zh", name: "中文", hint: "国内平台：淘宝、京东、拼多多、抖音、小红书" },
    { id: "en", name: "英文", hint: "海外平台：Amazon、Walmart、Etsy、TikTok Shop" },
    { id: "bilingual", name: "中英对照", hint: "国内主图带英文副标，或海外站的中文品牌露出" },
];

export function ecommerceLanguage(id: string | undefined) {
    return ECOMMERCE_LANGUAGES.find((item) => item.id === id);
}

/** 图上文字的语言，写成一句给模型的话。 */
export function ecommerceLanguageRule(id: string | undefined) {
    switch (id) {
        case "en":
            return "图上文字一律用英文；不出现中文，也不要用拼音代替品牌名之外的词。";
        case "bilingual":
            return "图上文字以中文为主，另配一行英文副标；英文不要逐字直译，用当地人真会那么说的说法。";
        case "zh":
            return "图上文字一律用中文；不出现英文单词（品牌名与型号除外）。";
        default:
            return "";
    }
}
