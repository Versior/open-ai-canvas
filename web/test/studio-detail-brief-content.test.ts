import { expect, test } from "bun:test";
import { commerceImageBriefContent } from "@/lib/ecommerce/image-brief-content";

const legacyCopyInstruction = "短文案信息点围绕圆筒机身和圆形出风口的比例关系展开。";

test("ordinary detail briefs drop legacy copy directives without dropping product description or print", () => {
    const appearance = "出风口圆形开口占据机身前端。";
    const productPrint = "机身保留原有品牌印字。";

    for (const direction of [legacyCopyInstruction, "短文案信息点：围绕圆形出风口展开。", "图内文字：短文案信息点: 围绕出风口。", "短标题：百变风力。", "版式安排：顶部主标题。"])
        expect(commerceImageBriefContent(`${appearance}${direction}${productPrint}`, true)).toBe(`${appearance}\n${productPrint}`);
});

test("ordinary detail briefs preserve copy wording quoted as product print", () => {
    const description = "包装保留原有标题「短文案信息点围绕产品本身」。";

    expect(commerceImageBriefContent(description, true)).toBe(description);
});

test("ordinary detail briefs keep actual packaging print but not the earclip photo-only clauses", () => {
    const appearance = "打开的盒盖内侧印着型号「Clip Air」。";
    const photoOnly = "画面只呈现商品本体，不添加品牌、型号或参数文字。";

    expect(commerceImageBriefContent(appearance + photoOnly, true)).toBe(appearance);
});

test("ordinary detail briefs leave copy to the image model instead of quoting the historical draft", () => {
    const appearance = "沿镜腿内侧呈现实物的「… DESIGN IN JAPAN」印字。";
    const drafts = ["短文案只写「镜腿内侧可见… DESIGN IN JAPAN 字样，前段字符不可辨」。", "短文案只点明「黑色亮面方形全框眼镜」与可见装饰。", "画面明确标注「搭配示意，不作尺寸依据」。", "不添加图内文字。", "不添加任何图内文案。"];
    for (const draft of drafts) {
        expect(commerceImageBriefContent(appearance + draft, true)).toBe(appearance);
        expect(commerceImageBriefContent(appearance + draft)).toBe(appearance + draft);
    }
    expect(commerceImageBriefContent("包装保留原文「搭配示意，不作尺寸依据」。", true)).toBe("包装保留原文「搭配示意，不作尺寸依据」。");
});

test("ordinary detail filtering leaves the default brief path unchanged", () => {
    expect(commerceImageBriefContent(legacyCopyInstruction)).toBe(legacyCopyInstruction);
});
