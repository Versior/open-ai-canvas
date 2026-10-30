import { describe, expect, test } from "bun:test";

import { buildEcommerceProfileDraftPrompt, parseEcommerceProfileDraft } from "@/lib/ecommerce/ecommerce-draft";

describe("structured ecommerce product recognition report", () => {
    test("prompt requests the complete evidence-based report instead of a shallow product summary", () => {
        const prompt = buildEcommerceProfileDraftPrompt();

        for (const heading of ["# 产品信息智能提取报告", "一、品牌信息识别", "二、产品类型判断", "三、核心参数识别", "四、核心卖点提取", "五、适用人群与购买动机", "六、详情页结构建议"]) {
            expect(prompt).toContain(heading);
        }
        for (const field of ["英文品牌名", "中文品牌名", "LOGO文字", "品牌风格", "产品类目", "产品名称", "产品型号", "外观特点", "主要功能", "参数", "来源/备注", "功能卖点", "体验卖点", "设计卖点", "场景卖点", "人群卖点", "主要目标用户", "使用痛点", "购买理由", "画面建议", "文案方向"]) {
            expect(prompt).toContain(field);
        }
        expect(prompt).toContain("未识别，不要编造");
        expect(prompt).toContain("待补充");
        expect(prompt).toContain("不要照搬参考图");
        expect(prompt).toContain("根据商品证据动态建议");
    });

    test("parser turns markdown report tables into structured profile fields", () => {
        const parsed = parseEcommerceProfileDraft(`# 产品信息智能提取报告

一、品牌信息识别
| 项目 | 识别结果 | 备注 |
| --- | --- | --- |
| 英文品牌名 | NEBULA | 杯身正面可见 |
| 中文品牌名 | 星云 | 包装正面可见 |
| LOGO文字 | NEBULA | 必须逐字保留 |
| 品牌风格 | 深蓝银色；几何无衬线；金属质感 | 从包装观察 |

二、产品类型判断
| 项目 | 识别结果 | 备注 |
| --- | --- | --- |
| 产品类目 | 随行杯 | 外形可见 |
| 产品名称 | 星云随行杯 | 包装可见 |
| 产品型号 | NX-500 | 杯底铭牌可见 |
| 外观特点 | 深蓝色圆柱杯身；银色杯盖；侧面硅胶提环 | 多角度图片可见 |
| 主要功能 | 盛装饮品；便携提拿 | 仅基于可见结构 |
| 其他标识 | 杯底镭雕 NX-500 | 细节图可见 |
| 禁止项 | 不得改变杯盖、提环与 Logo 位置 | 商品一致性要求 |

三、核心参数识别
| 参数 | 数值 | 来源/备注 |
| --- | --- | --- |
| 容量 | 500 mL | 包装正面可见 |
| 功率 | 未识别，不要编造 | 图片中未出现 |

四、核心卖点提取
| 卖点类型 | 卖点内容 | 可视化表达建议 |
| --- | --- | --- |
| 功能卖点 | 500 mL 容量 | 包装参数与杯体同屏 |
| 体验卖点 | 提环方便携带 | 通勤手提场景 |
| 设计卖点 | 深蓝银双色 | 材质细节特写 |
| 场景卖点 | 适合通勤饮水 | 办公桌与通勤包场景 |
| 人群卖点 | 面向通勤用户 | 展示轻装出行 |
| 卖点与依据 | 便于携带：杯盖侧面有可见提环 | 可见结构 |

五、适用人群与购买动机
| 项目 | 识别结果 | 备注 |
| --- | --- | --- |
| 主要目标用户 | 通勤用户 | 使用场景推断，待核对 |
| 使用痛点 | 普通水杯不便手提 | 待用户核对 |
| 购买理由 | 500 mL 容量与提环结构 | 参数和结构可见 |

六、详情页结构建议
| 屏数 | 主题 | 画面建议 | 文案方向 |
| --- | --- | --- | --- |
| 第1屏 | 品牌主视觉 | 深蓝背景，商品居中，突出原始 Logo | 品牌与产品名 |
| 第2屏 | 便携结构 | 提环细节近景 | 通勤提拿 |

不确定项 | 目标用户与痛点属于建议，认证和功效待补充`);

        expect(parsed).toMatchObject({
            englishBrandName: "NEBULA",
            chineseBrandName: "星云",
            logoText: "NEBULA",
            brandStyle: "深蓝银色；几何无衬线；金属质感",
            category: "随行杯",
            name: "星云随行杯",
            productModel: "NX-500",
            appearance: "深蓝色圆柱杯身；银色杯盖；侧面硅胶提环",
            functions: "盛装饮品；便携提拿",
            marks: "杯底镭雕 NX-500",
            forbidden: "不得改变杯盖、提环与 Logo 位置",
            audience: "通勤用户",
            painPoints: "普通水杯不便手提",
            purchaseReasons: "500 mL 容量与提环结构",
            facts: "便于携带：杯盖侧面有可见提环",
            unsure: "目标用户与痛点属于建议，认证和功效待补充",
        });
        expect(parsed.parameters).toEqual([
            { name: "容量", value: "500 mL", source: "包装正面可见" },
            { name: "功率", value: "未识别，不要编造", source: "图片中未出现" },
        ]);
        expect(parsed.sellingPoints).toEqual([
            { type: "功能卖点", content: "500 mL 容量", visualization: "包装参数与杯体同屏" },
            { type: "体验卖点", content: "提环方便携带", visualization: "通勤手提场景" },
            { type: "设计卖点", content: "深蓝银双色", visualization: "材质细节特写" },
            { type: "场景卖点", content: "适合通勤饮水", visualization: "办公桌与通勤包场景" },
            { type: "人群卖点", content: "面向通勤用户", visualization: "展示轻装出行" },
        ]);
        expect(parsed.detailPageSuggestions).toEqual([
            { screen: "第1屏", theme: "品牌主视觉", visual: "深蓝背景，商品居中，突出原始 Logo", copy: "品牌与产品名" },
            { screen: "第2屏", theme: "便携结构", visual: "提环细节近景", copy: "通勤提拿" },
        ]);
    });

    test("legacy pipe drafts still parse and unknown scalar values never become facts", () => {
        const parsed = parseEcommerceProfileDraft("category | 保温杯\nappearance | 哑光黑\n英文品牌名 | 未识别，不要编造\nunsure | 英文品牌名待补充");

        expect(parsed.category).toBe("保温杯");
        expect(parsed.appearance).toBe("哑光黑");
        expect(parsed).not.toHaveProperty("englishBrandName");
        expect(parsed.unsure).toBe("英文品牌名待补充");
    });
});
