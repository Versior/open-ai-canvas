import { expect, test } from "bun:test";
import { studioDetailRepeats } from "@/lib/ecommerce-studio/detail-repeats";

type Screen = Parameters<typeof studioDetailRepeats>[0][number];

function screen(purchaseQuestion: string, displayContent: string, evidenceRefs: string[] = [], role: Screen["role"] = "detail-scene"): Screen {
    return { purchaseQuestion, displayContent, evidenceRefs, purpose: purchaseQuestion, visual: displayContent, elements: "", role };
}

const crowded = (screens: Screen[], involvingIndex?: number) =>
    studioDetailRepeats(screens, false, involvingIndex)
        .filter((item) => item.cluster)
        .map((item) => (item.replaceIndex ?? item.index) + 1);

test("十屏原始策划：同一动作和走向挤占整页，保留真正的使用情境、角度和连接证据", () => {
    const screens = [
        screen("能认出这个款式吗？", "整机包含细长手柄、电源线和圆形端面。", ["fact:shape"], "detail-hero"),
        screen("吹头发时它怎么拿，风口朝哪？", "手握住细长手柄，风筒横向位于手上方，圆形端面朝向头发方向。", ["fact:body", "fact:handle"]),
        screen("手应该握在手柄哪一段？", "手掌包住手柄下段较深绿色分色块。", ["fact:color", "fact:handle"], "detail-model"),
        screen("开关在哪、拇指怎么拨动？", "拇指在手柄正面的滑动开关上拨动。", ["fact:control"]),
        screen("风口端面是什么结构？", "正面可见同心圆格栅和中心轴心。", ["fact:grille"], "detail-closeup"),
        screen("有线吹风机放在使用处，需要预留怎样的供电路径？", "电源线从镜台上的商品向插座方向延伸。"),
        screen("平放在台面时，电源线从手柄底端往哪个方向走？", "电源线在桌面上往后方延伸。"),
        screen("手持吹发时，电源线会从哪一侧经过？", "手握手柄，电源线垂在手腕下方。"),
        screen("风筒和手柄是什么角度，手持时手腕怎么摆？", "风筒位于手柄上方，两者近似直角连接；手持时手柄向下。", ["fact:body", "fact:handle"], "detail-closeup"),
        screen("电源线具体从手柄底端的哪个位置出来？", "手柄底端居中引出浅灰色电源线。", [], "detail-closing"),
    ];
    expect(crowded(screens)).toEqual([3, 7, 8]);
    expect(crowded(screens, 6)).toEqual([7]);
    expect(crowded(screens, 8)).toEqual([]);
});

for (const part of ["软管", "背带"]) {
    test(`${part}：共用一张原照不妨碍新操作、独立证据，只有重复去向才建议替换`, () => {
        const photo = "photo:front";
        const decision = screen("使用前需要预留哪段空间？", `展示${part}与实际使用位置的距离。`, [photo]);
        const moving = screen(`转身时，${part}会从哪一侧经过？`, `${part}从身体另一侧经过。`, [photo]);
        const placed = screen(`平放时，${part}从一侧往哪个方向走？`, `${part}沿桌沿自然延伸。`, [photo]);
        const origin = screen(`${part}的连接点在哪里？`, `${part}接在边缘的圆形环上。`, [photo]);
        const change = screen(`${part}怎么拆卸并清洗？`, `先解开${part}的固定扣，再清洗。`, [photo], "detail-steps");
        expect(crowded([decision, placed, moving, origin, change])).toEqual([2, 3]);
        expect(crowded([decision, placed, { ...moving, evidenceRefs: [photo, "fact:separate-route-catch"] }, origin, change])).toEqual([2]);
        expect(crowded([decision, moving, origin, change])).toEqual([]);
        expect(crowded([decision, { ...placed, purchaseQuestion: `${part}沿哪一侧定位槽固定？` }, moving, origin, change])).toEqual([]);
    });
}

test("只共用原照片、没有来源佐证的不同拿法，不因出现手或同一部件而合并", () => {
    const screens = [screen("手应该握在把手哪一段？", "掌心落在把手防滑区。", ["photo:front"]), screen("怎样提起壶体？", "一只手握住把手，从桌面提离壶身。", ["photo:front"]), screen("如何倒进窄口容器？", "握持把手，使壶嘴与窄口相对。", ["photo:front"])];
    expect(crowded(screens)).toEqual([]);
});

test("两个静物陈列按实物姿态判重；跟同色、同品或位置有关的新决定不归并", () => {
    const first = screen("用完临时放下时怎么摆？", "水杯平放在布上，杯身横放，提带朝外。", ["fact:body"]);
    const props = screen("与午餐用品怎么放在一起？", "水杯与餐盒、餐巾并排，杯身横向，提带朝外。", ["fact:body", "fact:color"], "detail-collocation");
    expect(crowded([first, props])).toEqual([2]);
    for (const distinct of [
        { ...props, purchaseQuestion: "放进包内怎么扣紧固定带？", displayContent: `${props.displayContent}将杯子上的扣环扣在包带上。` },
        { ...props, purchaseQuestion: "包内需要预留多少宽度？" },
        { ...props, displayContent: "水杯立在台面上，杯身直立，提带朝内。" },
        { ...props, displayContent: "水杯与餐盒、餐巾并排，提带朝外。" },
    ])
        expect(crowded([first, distinct])).toEqual([]);
});
