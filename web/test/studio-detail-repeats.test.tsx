import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { studioClaimSources } from "@/lib/ecommerce-studio/claim-evidence";
import { patchStudioDetailPlanScreen, studioDetailPlanRoles } from "@/lib/ecommerce-studio/detail-plan";
import { buildDetailPlanPrompt, parseDetailPlan } from "@/lib/ecommerce-studio/detail-plan-tasks";
import { studioDetailRepeats } from "@/lib/ecommerce-studio/detail-repeats";
import { createStudioProduct } from "@/lib/ecommerce-studio/product";
import { moveStudioSetEntry, studioSetEntries, toggleStudioSetEntry } from "@/lib/ecommerce-studio/runs";
import { StudioShotList } from "@/pages/ecommerce-studio/studio-shot-list";

const arrowEvidence = ["fact:numpad", "fact:arrows", "fact:row"];
const keyboardScreens = [
    {
        role: "detail-hero",
        purchaseQuestion: "这把键盘整体是什么布局？紧凑机身里是否还看得到功能行、方向键和右上角旋钮？",
        displayContent: "整把键盘正面完整入画；顶部功能行、字母数字区、右下独立方向键和银色旋钮同时可见。",
        visualBeat: "白壳、灰绿键帽、三枚橙键与右上旋钮在整机正面同框。",
        evidence: [...arrowEvidence, "fact:orange", "fact:knob"],
    },
    {
        role: "detail-closeup",
        purchaseQuestion: "去掉数字区后，独立方向键还在不在？",
        displayContent: "右下方向键组成为画面主体，方向键右侧没有数字小键盘。",
        visualBeat: "一只手的手指落在右下四个方向键上，画面围绕这组独立按键与右侧空位。",
        visualFocus: "四个箭头键是否独立成组，以及方向键右侧是否没有数字区。",
        evidence: arrowEvidence,
    },
    { role: "detail-closeup", purchaseQuestion: "右上角圆形旋钮是什么位置，手指怎么转动？", displayContent: "拇指和食指捏住圆形旋钮边缘转动，银色旋钮在键帽区之外。", visualBeat: "两根手指夹住银色圆旋钮，键帽退到背景。", evidence: ["fact:knob"] },
    {
        role: "detail-closeup",
        purchaseQuestion: "顶部功能键是否按 Esc、F1–F12 连续保留？",
        displayContent: "顶部功能行从左端橙色 Esc 起，F1–F12 连续排布。",
        visualBeat: "一根手指悬在功能键上方，橙色 Esc 与连续功能键排成一条线。",
        evidence: ["fact:function", "fact:orange", "fact:arrows"],
    },
    {
        role: "detail-model",
        purchaseQuestion: "主键区是否保留常见字母数字和 Tab、Caps、Shift、Ctrl、Alt、Enter 等控制键，能按普通键盘姿势打字？",
        displayContent: "双手落在主键区：左手覆盖字母左半，右手在字母右半与 Enter、Shift 附近。",
        visualBeat: "两只手在主键区打字，橙色空格与 Enter 位于指下，主键区字符铺满画面。",
        evidence: ["fact:arrows", "fact:row", "fact:orange", "fact:housing"],
    },
    {
        role: "detail-closeup",
        purchaseQuestion: "方形圆角键帽和浅色字符，近距离看是否容易辨认？",
        displayContent: "键帽的圆角轮廓、浅色字符与灰绿色表面的对比成为主体。",
        visualBeat: "灰绿键帽的圆角边与浅色字符占满画面。",
        evidence: ["fact:keycap", "fact:orange", "fact:row"],
    },
    {
        role: "detail-selling",
        purchaseQuestion: "橙色键只出现在哪里？快速找 Esc、Enter 和空格时能否靠颜色区分？",
        displayContent: "橙色只落在 Esc、Enter 和空格三处，一只手正按橙色 Enter。",
        visualBeat: "手指按下橙色 Enter，空格与 Esc 的橙色位置同时可辨。",
        evidence: ["fact:orange", "fact:keycap", "fact:row", "fact:arrows"],
    },
    {
        role: "detail-scene",
        purchaseQuestion: "放在桌面上时，右侧没有数字区，鼠标能不能靠近方向键一侧？",
        displayContent: "鼠标放在键盘右侧并靠近独立方向键，呈现鼠标在桌面的相对位置。",
        visualBeat: "俯看桌面：键盘在左，鼠标贴近其右前方，鼠标垫从方向键一侧延伸出去。",
        evidence: ["fact:numpad", "fact:arrows", "fact:housing"],
    },
    {
        role: "detail-collocation",
        purchaseQuestion: "白色外壳、灰绿键帽和橙色点缀，配浅木或中性色桌面是否协调？",
        displayContent: "整把键盘放在浅木桌面、灰色鼠标垫和白色杯子之间，展示与桌面环境的搭配。",
        visualBeat: "生活化桌面是主场景，橙色三键与浅木桌面形成冷暖对比。",
        evidence: ["fact:housing", "fact:orange", "fact:keycap"],
    },
    {
        role: "detail-closing",
        purchaseQuestion: "如果经常输入数字，这套无独立数字区的布局到底适不适合我？",
        displayContent: "同一把键盘上，一只手在顶部数字行输入，另一只手指向右下独立方向键；右侧没有独立数字小键盘。",
        visualBeat: "一只手停在顶部数字行，另一只手落在右下方向键，右侧空位同时入画，形成有数字行、无数字区的对比。",
        visualFocus: "顶部数字行与右下独立方向键同时存在，而右侧没有数字小键盘。",
        evidence: arrowEvidence,
    },
];

function keyboard(sameLayout = false) {
    const product = createStudioProduct("qa-keyboard");
    product.name = "橙键机械键盘";
    product.brief = { ...product.brief, outputType: "detail-set", detailScreens: 10, sameLayout };
    product.dossier = {
        name: product.name,
        category: "键盘",
        family: "electronics",
        summary: "",
        invariants: [],
        questions: [],
        facts: [
            ["numpad", "数字区", "右侧没有数字小键盘"],
            ["arrows", "方向键", "右下保留独立方向键"],
            ["row", "主键区", "顶部保留数字行"],
            ["orange", "配色", "橙色 Esc、Enter 和空格"],
            ["knob", "旋钮", "右上圆形银色旋钮"],
            ["function", "功能键", "F1–F12 连续保留"],
            ["keycap", "键帽", "方形圆角键帽、浅色字符"],
            ["housing", "外壳", "白色外壳与灰绿色键帽"],
        ].map(([id, label, value]) => ({ id, label, value, group: "structure", evidence: "visible" })),
    };
    const roles = studioDetailPlanRoles(product);
    const result = parseDetailPlan(JSON.stringify({ screens: keyboardScreens }), product, roles, { id: "keyboard", model: "fixture", createdAt: "" });
    product.brief.detailPlan = result.plan;
    return { product, result, roles };
}

test("键盘原十屏：第十屏撞第二屏的内容、第五屏的画面；不是橙色相同就算撞题", () => {
    const { product, result, roles } = keyboard();
    expect(buildDetailPlanPrompt(product, roles)).toContain("按答案和主证据编排整页");
    expect(result.plan.screens).toHaveLength(10);
    expect(result.dropped).toBe(0);
    expect(result.warnings).toContainEqual(expect.objectContaining({ index: 9, field: "purpose", message: expect.stringContaining("第 2 屏") }));
    expect(result.warnings).toContainEqual(expect.objectContaining({ index: 9, field: "visualBeat", message: expect.stringContaining("第 5 屏") }));
    expect(result.warnings.some((issue) => issue.index === 8 && issue.field === "purpose")).toBe(false);
});

test("只按当前勾选与排序显示重复，改写后更新，不因按参考图同款掩盖撞题", () => {
    const { product } = keyboard(true);
    const markup = () =>
        renderToStaticMarkup(
            <StudioShotList entries={studioSetEntries(product)} unit="屏" detail sameLayout={product.brief.sameLayout} plan={product.brief.detailPlan} claimSources={studioClaimSources(product)} onToggle={() => undefined} onMove={() => undefined} />,
        );
    expect(markup()).toContain("第 2 屏");
    expect(markup()).not.toContain("与第 5 屏");
    product.brief = moveStudioSetEntry(product, "p1", -1);
    expect(markup()).toContain("与第 1 屏");
    product.brief = toggleStudioSetEntry(product, "p1");
    expect(markup()).not.toContain("购买问题相近");
    product.brief = toggleStudioSetEntry(product, "p1");
    expect(markup()).toContain("购买问题相近");
    product.brief = patchStudioDetailPlanScreen(product.brief, 9, { purchaseQuestion: "硬壳的转角会露出哪些线条？", visual: "用左前角的壳体圆弧展示转角外观。", elements: "壳体左前角弯曲的轮廓。", visualBeat: "孤立的左前角壳体圆弧。" });
    expect(markup()).not.toContain("购买问题相近");
});

test("相同证据支持不同问题时，不把整机收尾或局部辨认判成撞题", () => {
    const screen = { role: "detail-closeup" as const, purpose: "", visual: "", elements: "", evidenceRefs: ["fact:a", "fact:b"] };
    expect(
        studioDetailRepeats([
            { ...screen, purchaseQuestion: "除了亮黑方框，这副镜架还有哪个值得细看的外观理由？", displayContent: "展示镜腿铰链处金属饰条的接缝、花纹和桩头小件。", visualFocus: "金属饰条与亮黑镜腿的接缝。" },
            { ...screen, role: "detail-closing", purchaseQuestion: "回到整副镜架，已确认的外观要点是否都还在？", displayContent: "亮黑前框、透明镜片、两侧桩头小件与镜腿铰链处金属饰条全部入画。", visualFocus: "完整商品轮廓。" },
        ]),
    ).toEqual([]);
    expect(
        studioDetailRepeats([
            { ...screen, purchaseQuestion: "头、身体和鳍是不是切段后拼在一起的？", displayContent: "头、外套膜和鳍连续连成一体；身体一端是头部，另一端连着一对鳍。", visualFocus: "头与外套膜的连接处。" },
            { ...screen, purchaseQuestion: "身体一端的两个三角形是什么，怎么区分头端和鳍端？", displayContent: "身体一端左右各有一片三角形鳍，鳍端与头端方向相反。", visualFocus: "身体一端左右两片三角形鳍。" },
        ]),
    ).toEqual([]);
});

test("相同握持动作只是用法的一部分时，不把不同的画面主线判成重复", () => {
    const screen = { role: "detail-closeup" as const, purpose: "", visual: "", elements: "", evidenceRefs: ["fact:handle"] };
    expect(
        studioDetailRepeats([
            { ...screen, purchaseQuestion: "手柄与机身怎么连接？", displayContent: "一只手握住竖向手柄，圆筒机身保持横向，手柄与机身连接处可见。", visualFocus: "手柄与机身的接合处。" },
            { ...screen, role: "detail-scene", purchaseQuestion: "吹头发时出风口朝哪？", displayContent: "一只手握住手柄举起吹风机，出风口朝向湿发，机身保持横向。", visualFocus: "出风口与湿发的相对位置。" },
        ]),
    ).toEqual([]);
    expect(
        studioDetailRepeats([
            { ...screen, purchaseQuestion: "整只拿起来时，头和鳍还是连着吗？", displayContent: "手指托住身体中段把整只拿起，头端和鳍端露在手指外。", visualBeat: "手指托住鱿鱼中段，头端和鳍端不被挡住。", visualFocus: "整只鱿鱼头、身体与鳍的连接。" },
            { ...screen, role: "detail-scene", purchaseQuestion: "整只怎么冲洗？", displayContent: "手指托住外套膜，水流冲过头端和鳍端，整只不拆开。", visualBeat: "水流冲过鱿鱼，手指托住外套膜。", visualFocus: "水流与接触面的关系。" },
        ]),
    ).toEqual([]);
});
