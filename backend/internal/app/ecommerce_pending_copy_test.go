package app

import (
	"strings"
	"testing"
)

func TestEcommerceDirectorKeepsMissingFactsOutOfRenderedCopy(t *testing.T) {
	for name, prompt := range map[string]string{
		"default": defaultEcommerceDirectorPrompt("detail"),
		"custom":  composeEcommerceDirectorPrompt("detail", "管理员自定义导演方法"),
	} {
		t.Run(name, func(t *testing.T) {
			for _, want := range []string{
				"识别报告或商品事实的数据状态",
				"主标题、副标题、价格和行动引导等独立可见文案字段",
				"缺少事实依据时留空",
				"完整生图提示词不得包含“待补充”",
				"事实缺失，禁止展示相关宣称或数值",
			} {
				if !strings.Contains(prompt, want) {
					t.Errorf("director prompt missing %q", want)
				}
			}
			if strings.Contains(prompt, "没有明确数据时写“待补充”") {
				t.Error("director prompt still asks the model to render a missing-data placeholder")
			}
		})
	}
}

// brief T04：copy 是唯一可见营销文字来源，最后一段只写视觉；七项由前端共享编译器合成。
// 默认十屏主题可随商品变化，不能被固定顺序指令压死。
// 四视觉（detail/main/wear/seed）共用同一份运行时合同，必须逐条同步，不能只守 detail。
func TestEcommerceDirectorKeepsCopyOutOfTheFinalImagePrompt(t *testing.T) {
	prompts := map[string]string{}
	for _, flow := range []string{"detail", "main", "wear", "seed"} {
		prompts[flow+"/default"] = defaultEcommerceDirectorPrompt(flow)
		prompts[flow+"/custom"] = composeEcommerceDirectorPrompt(flow, "管理员自定义导演方法")
	}
	for name, prompt := range prompts {
		t.Run(name, func(t *testing.T) {
			for _, want := range []string{
				"最后一段完整生图提示词只写画面",
				"画面构成、产品摆放、视觉风格和负面提示词",
				"主标题、副标题和卖点模块完全由前端共享编译器按独立文案列生成、按版式 preset 排布",
				"不得在最后一段输出、复述或改写它们",
				"前端共享编译器",
				"九段竖线分隔的逐行结构",
				"槽位id | 这一屏的标题 | 这一屏要解决什么 | 主标题 | 副标题 | 价格 | 行动引导 | 版式 preset | 完整生图提示词",
				"与商品画面一起交给图片模型生成",
			} {
				if !strings.Contains(prompt, want) {
					t.Errorf("director prompt missing %q", want)
				}
			}
			for _, forbidden := range []string{
				"必须依次包含画面构成、产品摆放、主标题、副标题、卖点模块、视觉风格和负面提示词这七个完整字段",
				"主标题、副标题和卖点模块只能描述位置、字号层级与模块形态",
			} {
				if strings.Contains(prompt, forbidden) {
					t.Errorf("director prompt still demands copy inside the image prompt: %q", forbidden)
				}
			}
		})
	}
}

func TestEcommerceDirectorKeepsDetailThemesDynamic(t *testing.T) {
	for name, prompt := range map[string]string{
		"default": defaultEcommerceDirectorPrompt("detail"),
		"custom":  composeEcommerceDirectorPrompt("detail", "管理员自定义导演方法"),
	} {
		t.Run(name, func(t *testing.T) {
			for _, want := range []string{"10屏", "3:4", "每屏只讲一个核心主题", "根据商品"} {
				if !strings.Contains(prompt, want) {
					t.Errorf("director prompt missing %q", want)
				}
			}
			for _, forbidden := range []string{
				"顺序为品牌主视觉、核心卖点一、核心卖点二、核心卖点三、多场景展示、产品细节、参数可视化、适用人群、品质背书、购买理由总结",
			} {
				if strings.Contains(prompt, forbidden) {
					t.Errorf("director prompt still pins a fixed theme order: %q", forbidden)
				}
			}
		})
	}
}
