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
    expect(buildDetailPlanPrompt(product, roles)).toContain("按主线和证据编排整页");
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

test("实际用法只换角度、配色拆开再汇总时提示撞题，不把同一部位的动作和外形一概合并", () => {
    const screen = { role: "detail-scene" as const, purpose: "", visual: "", elements: "" };
    const matches = studioDetailRepeats([
        { ...screen, purchaseQuestion: "吹发时风口朝哪里、另一只手怎么配合？", displayContent: "吹风机对着发丝，另一只手将头发拨开。", visualFocus: "风口与发丝的相对方向。" },
        { ...screen, purchaseQuestion: "吹侧后方头发时手腕怎么转、手柄和风筒怎么摆？", displayContent: "转向侧后方，出风口对着头发。", visualFocus: "手腕角度和近直角的握持关系。" },
        { ...screen, purchaseQuestion: "戴耳机接电话时按哪个位置？", displayContent: "握住耳机，指尖点按控件接听电话。" },
        { ...screen, purchaseQuestion: "手柄下段的深绿色分色块在哪里？", displayContent: "交代深薄荷绿和浅色的分色交界。", visualFocus: "分色交界。" },
        { ...screen, purchaseQuestion: "浅薄荷绿、深薄荷绿和白色/浅灰分别出现在哪三个部位？", displayContent: "同画面展示风筒和手柄分色交界。", visualFocus: "三处配色分区。" },
        { ...screen, purchaseQuestion: "握住时开关怎么拨？", displayContent: "拇指沿手柄拨动开关。", visualFocus: "手指的移动方向。" },
    ]);
    expect(matches.filter(({ field }) => field === "purpose").map(({ index, previousIndex }) => [index, previousIndex])).toEqual([
        [1, 0],
        [4, 3],
    ]);
});

test("实际吹风机十屏回归：只换握持位置、色块环境或台架不算新的展示", () => {
    const screen = { role: "detail-closeup" as const, purpose: "", visual: "", elements: "" };
    const matches = studioDetailRepeats([
        { ...screen, role: "detail-hero", purchaseQuestion: "从正面如何认出整机？", displayContent: "正面展示浅薄荷绿整机、圆形出风口和手柄。" },
        {
            ...screen,
            purchaseQuestion: "握住手柄下段时，深绿分色和浅绿上段的分界在哪里？",
            displayContent: "手握住手柄下段，深绿色块从手指边缘露出。",
            visualBeat: "握持位置下移到手柄下段，分色交界成为主体。",
            visualFocus: "深绿下段与浅绿上段的分界及手掌位置",
            evidenceRefs: ["fact:colors", "fact:switch", "fact:handle"],
        },
        {
            ...screen,
            role: "detail-model",
            purchaseQuestion: "握住手柄时，整机和手掌大概是什么比例，手掌落在手柄哪一段？",
            displayContent: "一只手握住手柄中段，风筒横在手掌上方，滑动开关在拇指附近保持不动。",
            visualBeat: "手掌包住手柄中段，整机与手同框，开关保持静止。",
            visualFocus: "手掌包住细长手柄的长度关系",
            evidenceRefs: ["fact:handle", "fact:switch"],
        },
        {
            ...screen,
            role: "detail-steps",
            purchaseQuestion: "滑动开关在什么位置，拇指往哪个方向拨？",
            displayContent: "拇指沿手柄正面拨动滑块。",
            visualBeat: "拇指在滑块上移动，手握住手柄。",
            visualFocus: "拇指的移动方向",
            evidenceRefs: ["fact:switch"],
        },
        {
            ...screen,
            role: "detail-scene",
            purchaseQuestion: "把吹风机放在浴室置物架上时，风口朝向和电源线垂落是什么样？",
            displayContent: "侧放在置物架，风口朝外，电源线从手柄底端垂到架沿。",
            visualFocus: "置物架边缘垂落的电源线与朝外的风口",
            evidenceRefs: ["fact:outlet", "fact:handle"],
        },
        {
            ...screen,
            role: "detail-scene",
            purchaseQuestion: "浅薄荷绿机身、白色风口和深绿手柄下段放在浴室里是什么效果？",
            displayContent: "在镜前举起整机，浅薄荷绿机身、白色风口环圈和手柄下段深绿分色同时可见。",
            visualFocus: "浅薄荷绿与深绿手柄下段在浴室光线中的颜色关系",
            evidenceRefs: ["fact:colors", "fact:outlet"],
        },
        { ...screen, role: "detail-closing", purchaseQuestion: "用完平放在台面时，风口和电源线怎么摆？", displayContent: "风筒贴着台面，出风口朝外，电源线从手柄底端垂到台沿。", visualFocus: "平放后的风口朝向与电源线垂落位置" },
        { ...screen, role: "detail-size", purchaseQuestion: "宽度够不够放入 25 cm 的抽屉？", displayContent: "并列展示机身宽度和抽屉内宽。", visualFocus: "机身宽度和抽屉内宽的关系" },
    ]);
    expect(matches).toContainEqual(expect.objectContaining({ index: 2, previousIndex: 1, field: "visualBeat" }));
    expect(matches).toContainEqual(expect.objectContaining({ index: 5, previousIndex: 1, field: "purpose" }));
    expect(matches).toContainEqual(expect.objectContaining({ index: 6, previousIndex: 4, field: "purpose" }));
    expect(matches.some(({ index }) => index === 3 || index === 7)).toBe(false);
});

test("十屏实测：把配色和刚讲过的握持重新拼成一题，不算新答案", () => {
    const screen = { role: "detail-closeup" as const, purpose: "", visual: "", elements: "" };
    const grip = {
        ...screen,
        role: "detail-model" as const,
        purchaseQuestion: "握住细长手柄时，拇指能不能直接够到开关，开关怎么拨？",
        displayContent: "手掌握住手柄上段，拇指落在手柄正面偏上的滑动开关上；开关沿手柄纵向上下拨动。",
        visualFocus: "拇指与滑动开关的接触位置",
        evidenceRefs: ["fact:handle", "fact:switch"],
    };
    const colors = {
        ...screen,
        purchaseQuestion: "实物颜色是不是浅薄荷绿，手柄下段是不是更深？",
        displayContent: "机身主色为浅薄荷绿，手柄下段为较深薄荷绿并与上段横向分色，出风口环圈与格栅为白色／浅灰；三种颜色在同一机身上分区清楚。",
        visualFocus: "机身、手柄下段、风口环圈三处颜色的分界",
        evidenceRefs: ["fact:palette", "fact:handle-colors", "fact:ring"],
    };
    const remix = {
        ...screen,
        purchaseQuestion: "手柄下段的深色块在握持时落在手的什么位置？",
        displayContent: "手柄下段为较深薄荷绿，与上段横向分色；握住手柄上段时，深色段位于手掌下方，拇指仍在开关处。",
        visualFocus: "手柄下段分色边界与手掌的相对位置",
        evidenceRefs: ["fact:handle-colors", "fact:switch"],
    };
    const differentUse = {
        ...screen,
        purchaseQuestion: "手指怎么沿深色分界找到底部可拆卡扣？",
        displayContent: "按下深色区与浅色区交界旁的卡扣，展示两段如何拆开。",
        visualFocus: "指尖实际按下卡扣的位置",
        evidenceRefs: ["fact:latch", "fact:handle-colors"],
    };
    expect(studioDetailRepeats([grip, colors, remix, differentUse])).toEqual([expect.objectContaining({ index: 2, previousIndex: 1, field: "purpose" })]);
});

test("实际成片回归：把已经说清的状态换道具或把同一证据继续放大，不算新内容", () => {
    const screen = { role: "detail-closeup" as const, purpose: "", visual: "", elements: "" };
    const repeats = studioDetailRepeats([
        {
            ...screen,
            role: "detail-hero",
            purchaseQuestion: "这是什么商品，整只长什么样、是不是切好的？",
            displayContent: "手托小鱿鱼，头、外套膜、鳍连成一体且整只未切开。",
            visualFocus: "整只的头、外套膜与三角鳍。",
            evidenceRefs: ["fact:whole", "fact:spots", "fact:fins"],
        },
        {
            ...screen,
            role: "detail-scene",
            purchaseQuestion: "到手是整只未切开的吗，处理要从哪里开始？",
            displayContent: "放在备料容器中，整只未被切开，头、身体与鳍连为一体。",
            visualFocus: "备料状态下仍完整相连的整只形态。",
            evidenceRefs: ["fact:whole", "fact:spots"],
        },
        { ...screen, purchaseQuestion: "出风口在哪一端，正面格栅是什么结构？", displayContent: "前端有多层同心圆格栅，中心是圆形轴心。", visualFocus: "圆形出风口的多层同心圆格栅与中心轴心", evidenceRefs: ["fact:grille", "fact:shell"] },
        { ...screen, purchaseQuestion: "出风口中心是空洞还是轴心？", displayContent: "多层同心圆格栅向中心收拢，中心为圆形轴心。", visualFocus: "格栅中心的圆形轴心", evidenceRefs: ["fact:grille"] },
        { ...screen, purchaseQuestion: "使用时怎样让出风口朝向发束？", displayContent: "人握住手柄让风口朝向发束。", visualFocus: "风口与发束的方向关系", evidenceRefs: ["fact:grille"] },
    ]);
    expect(repeats).toContainEqual(expect.objectContaining({ index: 1, previousIndex: 0, field: "purpose" }));
    expect(repeats).toContainEqual(expect.objectContaining({ index: 3, previousIndex: 2, field: "purpose" }));
    expect(repeats.some(({ index }) => index === 4)).toBe(false);
});

test("判断本屏给出了什么答案而不只匹配问句关键词", () => {
    const screen = { role: "detail-scene" as const, purpose: "", visual: "", elements: "" };
    const repeats = studioDetailRepeats([
        { ...screen, role: "detail-hero", purchaseQuestion: "买家能否认出这是一整只小鱿鱼？", displayContent: "完整小鱿鱼被托在手里，头、外套膜、鳍连在一起。", evidenceRefs: ["fact:identity", "fact:whole", "fact:fins"] },
        { ...screen, purchaseQuestion: "这只是一整只还是已经切开分件？", displayContent: "小鱿鱼的头、外套膜和左右三角形鳍连为一体，整只未切开。", evidenceRefs: ["fact:identity", "fact:fins", "fact:whole"] },
        { ...screen, purchaseQuestion: "自己吹发时，风口和头发怎么对应？", displayContent: "握住手柄，将正面风口对着一束头发。" },
        { ...screen, purchaseQuestion: "边吹边分区时，两只手怎么分工？", displayContent: "持机手握住手柄，另一只手提起一束头发，风口对着发束。" },
        { ...screen, purchaseQuestion: "手柄上的开关往哪拨？", displayContent: "一只手持机，拇指向上拨滑块；另一只手托起发束。" },
    ]);
    expect(repeats.filter(({ field }) => field === "purpose").map(({ index, previousIndex }) => [index, previousIndex])).toEqual([
        [1, 0],
        [3, 2],
    ]);
});

test("真实策划回归：同一圆筒外形和已亮相的整只状态不拆屏，同一实拍不等于重复答案", () => {
    const screen = { role: "detail-closeup" as const, purpose: "", visual: "", elements: "" };
    const shell = ["fact:shell", "photo:side"];
    const repeats = studioDetailRepeats([
        { ...screen, purchaseQuestion: "风筒是圆筒形还是扁嘴或方盒状？", displayContent: "圆角圆筒形风筒，筒身轮廓圆润。", visualFocus: "风筒整体的圆筒轮廓", evidenceRefs: shell },
        { ...screen, purchaseQuestion: "风筒尾端是圆弧收口还是方角或开放端？", displayContent: "尾端以圆弧收口，轮廓与圆筒筒身连续。", visualFocus: "风筒尾端的圆弧轮廓", evidenceRefs: shell },
        { ...screen, role: "detail-scene", purchaseQuestion: "用的时候风口如何对准头发？", displayContent: "圆形格栅一端朝向发束。", evidenceRefs: ["photo:side"] },
        { ...screen, role: "detail-hero", purchaseQuestion: "这是什么商品，外观是否对版？", displayContent: "手托整只小鱿鱼，头、三角鳍与带斑点的身体可见。", evidenceRefs: ["fact:whole", "fact:fins", "fact:spots"] },
        { ...screen, role: "detail-closing", purchaseQuestion: "是整只未切开，还是切段？", displayContent: "头、外套膜、鳍连为一体，整只未切开。", evidenceRefs: ["fact:whole", "fact:fins", "fact:joint"] },
    ]);
    expect(repeats.filter(({ field }) => field === "purpose").map(({ index, previousIndex }) => [index, previousIndex])).toEqual([
        [1, 0],
        [4, 3],
    ]);
});

test("备料台仅重讲整只状态时换候补，实际备料动作不算重复", () => {
    const product = createStudioProduct("squid-prep");
    product.name = "小鱿鱼";
    product.brief = { ...product.brief, outputType: "detail-set", detailScreens: 3 };
    product.dossier = {
        name: product.name,
        category: "生鲜",
        family: "food",
        summary: "",
        invariants: [],
        questions: [],
        facts: [
            { id: "whole", label: "整体形态", value: "头、外套膜和鳍相连，整只未切开", group: "structure", evidence: "visible" },
            { id: "fins", label: "鳍", value: "左右三角形鳍各一", group: "structure", evidence: "visible" },
            { id: "spots", label: "斑点", value: "乳白半透明体表有黑褐色斑点", group: "appearance", evidence: "visible" },
        ],
    };
    const screens = [
        { role: "detail-hero", purchaseQuestion: "这只小鱿鱼是不是整只、头身鳍都连在一起？", displayContent: "展示整只小鱿鱼，头部、外套膜和左右三角形鳍连在一起，整只未切开。", evidence: ["E1", "E2"] },
        { role: "detail-closeup", purchaseQuestion: "斑点分布是什么样的？", displayContent: "近距离看半透明体表上的细小黑褐色斑点。", evidence: ["E3"] },
        { role: "detail-closing", purchaseQuestion: "整只小鱿鱼放到备料台上时，头、身、鳍是否还连在一起？", displayContent: "整只平放在干净备料板上，头部、外套膜和左右三角形鳍保持连接，身体没有被切成圈或段。", evidence: ["E1", "E2"] },
    ];
    const prep = { role: "detail-scene", purchaseQuestion: "准备备料时怎样把小鱿鱼从食材盘移到砧板？", displayContent: "一只手用食品夹从食材盘夹起小鱿鱼，向砧板移动，保留实际的整体形态。", evidence: ["E1"] };
    const parse = (alternatives: unknown[]) => parseDetailPlan(JSON.stringify({ screens, alternatives }), product, studioDetailPlanRoles(product), { id: "squid", model: "fixture", createdAt: "" });
    expect(parse([]).warnings).toContainEqual(expect.objectContaining({ index: 2, field: "purpose", message: expect.stringContaining("第 1 屏") }));
    const corrected = parse([prep]);
    expect(corrected.warnings).toEqual([]);
    expect(corrected.plan.screens.map(({ purchaseQuestion }) => purchaseQuestion)).toEqual([screens[0].purchaseQuestion, screens[1].purchaseQuestion, prep.purchaseQuestion]);
});

test("空握和只交代湿发时机让位给实际吹发，不挤掉独立的控件操作", () => {
    const screen = { role: "detail-scene" as const, purpose: "", visual: "", elements: "" };
    const matches = studioDetailRepeats([
        { ...screen, role: "detail-model", purchaseQuestion: "手柄是直的还是折的，竖握时风筒朝哪？", displayContent: "竖握手柄时风筒横向，圆形出风口朝前。" },
        { ...screen, role: "detail-steps", purchaseQuestion: "开关在手柄什么位置，怎么拨动？", displayContent: "拇指沿手柄上下拨动开关。", evidenceRefs: ["fact:switch"] },
        { ...screen, role: "detail-seeding", purchaseQuestion: "什么时候会用到这台吹风机？", displayContent: "洗发后头发处于湿发状态时，用这台吹风机对着湿发吹。" },
        { ...screen, purchaseQuestion: "风口怎么对准头发吹？", displayContent: "握持细长手柄，让圆形出风口朝前并对准湿发。" },
        { ...screen, purchaseQuestion: "清洁格栅时从哪里扫去灰尘？", displayContent: "用柔刷清理格栅表面的灰尘。", evidenceRefs: ["seller:1"] },
    ]);
    expect(matches.filter(({ field, index }) => field === "purpose" && index === 3).map(({ replaceIndex }) => replaceIndex)).toEqual([0, 2]);
    expect(matches.some(({ index }) => index === 1 || index === 4)).toBe(false);
});

test("格栅结构、所在位置和无遮挡的全貌不是三个答案；工作关系另算", () => {
    const screen = { role: "detail-closeup" as const, purpose: "", visual: "", elements: "" };
    const repeats = studioDetailRepeats([
        { ...screen, purchaseQuestion: "出风口内部是什么结构？", displayContent: "出风口内部为多层同心圆格栅，中心有圆形轴心；环圈与格栅为白色。", evidenceRefs: ["fact:grille", "fact:ring"] },
        { ...screen, purchaseQuestion: "出风口在机身的哪个方向？", displayContent: "出风口位于风筒前端，圆形格栅正面朝前；风筒横向，手柄向下。", evidenceRefs: ["photo:front", "fact:shell", "fact:grille"] },
        { ...screen, role: "detail-scene", purchaseQuestion: "吹头发时，风口和头发是什么关系？", displayContent: "手握手柄，圆形格栅一端朝向发束。", evidenceRefs: ["fact:grille"] },
        { ...screen, role: "detail-closing", purchaseQuestion: "正面能完整看到出风口格栅吗？", displayContent: "正面同心圆格栅完整可见，圆形环圈没有被遮挡。", evidenceRefs: ["point:grille", "fact:grille", "fact:ring"] },
        { ...screen, role: "detail-hero", purchaseQuestion: "这是不是头、身、鳍完整且未切开的整只小鱿鱼？", displayContent: "单只完整小鱿鱼，头、外套膜与左右三角形鳍连续在一起。", evidenceRefs: ["fact:whole", "fact:fins", "fact:eye"] },
        { ...screen, role: "detail-compare", purchaseQuestion: "并排时头、眼、鳍是否完整，能不能核对完整度？", displayContent: "个体头、外套膜与鳍均连续，未呈现切段状态。", evidenceRefs: ["fact:whole", "fact:fins", "fact:eye"] },
    ]);
    expect(repeats.filter(({ field }) => field === "purpose").map(({ index, previousIndex }) => [index, previousIndex])).toEqual([
        [1, 0],
        [3, 0],
        [5, 4],
    ]);
});

test("无字详情仍合并同一次使用动作，不靠相同标题或相同人体部位判重", () => {
    const screen = { role: "detail-scene" as const, purpose: "", visual: "", elements: "", noText: true as const };
    expect(
        studioDetailRepeats([
            { ...screen, purchaseQuestion: "吹侧边长发时，风口和发束怎么对位？", displayContent: "持机从脸侧顺着发丝往下带。", visualFocus: "脸侧的出风方向。" },
            { ...screen, purchaseQuestion: "后颈发根的吹法是什么？", displayContent: "把后面的头发拢起来，圆形出风口从颈侧靠近。", visualFocus: "头部低下，手臂抬起。" },
            { ...screen, purchaseQuestion: "出风口正面是怎样的结构？", displayContent: "环内显示多层同心圆格栅和圆轴。", visualFocus: "独立的格栅正面。" },
        ]),
    ).toContainEqual(expect.objectContaining({ index: 1, previousIndex: 0, field: "purpose" }));
});

test("控件的触达和拨动回答同一件事，另一个独立控件或真实用法不被合并", () => {
    const screen = { role: "detail-steps" as const, purpose: "", visual: "", elements: "" };
    const repeats = studioDetailRepeats([
        {
            ...screen,
            purchaseQuestion: "握住细长手柄时，滑动开关是否落在拇指能拨到的位置？",
            displayContent: "握住细长直筒手柄，拇指自然靠近手柄正面偏上的滑动开关。",
            evidenceRefs: ["fact:handle", "fact:switch"],
        },
        {
            ...screen,
            purchaseQuestion: "手柄正面的滑动开关怎么拨动？",
            displayContent: "拇指在手柄正面沿纵向行程上下拨动开关。",
            evidenceRefs: ["fact:switch"],
        },
        { ...screen, purchaseQuestion: "定时按钮在哪？", displayContent: "手指点按独立的定时按钮。", evidenceRefs: ["fact:timer"] },
        { ...screen, purchaseQuestion: "吹发时风口怎样对准发丝？", displayContent: "手握手柄，使风口朝向发丝。", evidenceRefs: ["fact:handle"] },
        { ...screen, purchaseQuestion: "键盘右侧的旋钮怎么用？", displayContent: "手指拧动音量旋钮。", evidenceRefs: ["fact:knob"] },
        { ...screen, purchaseQuestion: "单手能碰到音量旋钮吗？", displayContent: "手指搭在键盘右侧的音量旋钮上。", evidenceRefs: ["fact:knob"] },
    ]);
    expect(repeats.filter(({ field }) => field === "purpose").map(({ index, previousIndex }) => [index, previousIndex])).toEqual([
        [1, 0],
        [5, 4],
    ]);
});

test("实测十屏：空握指向让位给真实吹发，品牌印字和收尾不重复已经讲清的答案", () => {
    const screen = { role: "detail-closeup" as const, purpose: "", visual: "", elements: "" };
    const matches = studioDetailRepeats([
        {
            ...screen,
            role: "detail-hero",
            purchaseQuestion: "这是什么吹风机，整体形态和颜色是不是我要找的款？",
            displayContent: "浅薄荷绿机身的手持吹风机：圆筒风筒横向位于上方，细长直筒手柄向下延伸，出风口为完整圆形，正面可见白色环圈与格栅，风筒侧面印有 POREE 博锐。",
            visualFocus: "整机正面全貌与风筒侧面的品牌印字",
            evidenceRefs: ["fact:color", "fact:body", "fact:handle", "fact:ring", "fact:brand"],
        },
        {
            ...screen,
            role: "detail-model",
            purchaseQuestion: "单手握持时，手柄怎么握、风筒和出风口朝哪个方向？",
            displayContent: "手掌包住细长直筒手柄，风筒横向位于拳头上方并向前伸出，手柄与风筒近直角相接，使出风口正面朝前。",
            visualFocus: "手与直筒手柄的贴合处，以及风筒向前伸出的方向",
            evidenceRefs: ["fact:body", "fact:handle"],
        },
        {
            ...screen,
            role: "detail-scene",
            purchaseQuestion: "吹头发时，风口应该怎么对着头发？",
            displayContent: "手握手柄举起机身，把出风口正面朝向洗发后的湿发，风口面与头发相对，沿头发方向移动。",
            visualFocus: "风口正面与头发之间的相对朝向",
        },
        {
            ...screen,
            purchaseQuestion: "手柄上下两段的颜色怎么分开？",
            displayContent: "浅薄荷绿机身接较深绿色手柄下段，有横向分界。",
            evidenceRefs: ["fact:color", "fact:handle-color"],
        },
        {
            ...screen,
            purchaseQuestion: "品牌标识印在哪一面、是哪几个字？",
            displayContent: "风筒侧面靠出风口一侧印有 POREE 博锐。",
            visualFocus: "印字内容与其在风筒侧面的位置",
            evidenceRefs: ["fact:brand"],
        },
        {
            ...screen,
            role: "detail-closing",
            purchaseQuestion: "页面展示的外观细节，收到的实物能对得上吗？",
            displayContent: "整机正面完整呈现：浅薄荷绿机身、手柄下段较深绿色分色、白色风口环圈和风筒侧面的 POREE 博锐印字，与前述各屏为同一台机。",
            visualFocus: "整机正面各部位配色的完整对照",
            evidenceRefs: ["fact:color", "fact:handle-color", "fact:ring", "fact:brand"],
        },
        {
            ...screen,
            role: "detail-closing",
            purchaseQuestion: "下单前怎样确认家里电源匹配？",
            displayContent: "对照机身铭牌上确认过的额定电压与使用地的供电规格。",
            visualFocus: "铭牌的额定电压标注",
            evidenceRefs: ["fact:voltage"],
        },
        {
            ...screen,
            purchaseQuestion: "手小能否单手够到滑动开关？",
            displayContent: "手握住手柄时拇指与滑动开关接触，展示的是握持位置和控制件的关系。",
            visualFocus: "拇指触达手柄开关",
            evidenceRefs: ["fact:switch", "fact:handle"],
        },
    ]);
    expect(matches).toContainEqual(expect.objectContaining({ index: 2, previousIndex: 1, replaceIndex: 1, field: "purpose" }));
    expect(matches).toContainEqual(expect.objectContaining({ index: 4, previousIndex: 0, field: "purpose" }));
    expect(matches).toContainEqual(expect.objectContaining({ index: 5, field: "purpose" }));
    expect(matches.some(({ index }) => index >= 6)).toBe(false);
});

test("吹风机实测：控件与出线的拼盘、单讲印字的末屏不占独立名额", () => {
    const base = { role: "detail-closeup" as const, purpose: "", visual: "", elements: "" };
    const matches = studioDetailRepeats([
        { ...base, role: "detail-hero", purchaseQuestion: "这台吹风机整体是什么外观？", displayContent: "浅薄荷绿机身、圆筒风筒、细长手柄和圆形格栅。" },
        { ...base, role: "detail-steps", purchaseQuestion: "开关在手柄的什么位置，往哪个方向拨？", displayContent: "手柄正面偏上有一枚滑动开关，行程沿手柄上下方向；拇指位可拨动。", evidenceRefs: ["fact:switch"] },
        {
            ...base,
            role: "detail-model",
            purchaseQuestion: "握住手柄时，手和开关、电源线是什么关系？",
            displayContent: "手握住细长直筒手柄，拇指靠近正面滑动开关，电源线从手柄底端居中向下引出，不经过手柄正面。",
            evidenceRefs: ["fact:handle", "fact:switch"],
        },
        { ...base, purchaseQuestion: "电源线从手柄的哪个位置引出？", displayContent: "电源线从手柄底端居中引出，线身为浅灰色。", visualFocus: "手柄底端的电源线出口。" },
        { ...base, role: "detail-closing", purchaseQuestion: "机身品牌标识在哪里，字样是什么？", displayContent: "风筒侧面印有 POREE 博锐。", evidenceRefs: ["fact:brand"] },
        { ...base, role: "detail-closing", purchaseQuestion: "怎么用铭牌标识区分两个型号？", displayContent: "两款机身铭牌上的型号不同，可据此选款。", evidenceRefs: ["fact:model-a", "fact:model-b"] },
    ]);
    expect(matches.filter(({ field }) => field === "purpose").map(({ index, previousIndex }) => [index, previousIndex])).toEqual([
        [2, 1],
        [4, 0],
    ]);
});

test("小鱿鱼实测：首尾同一整只托举判为重复，真实备料与局部结构不误判", () => {
    const base = { role: "detail-closeup" as const, purpose: "", visual: "", elements: "" };
    const matches = studioDetailRepeats([
        {
            ...base,
            role: "detail-hero",
            purchaseQuestion: "这是不是一只头足类小鱿鱼，身体是不是乳白半透明并带有黑褐斑点？",
            displayContent: "整只小鱿鱼的外形，乳白半透明的身体局部泛粉橙，表面密布分布不均的细小黑褐斑点；头部位于身体一端，整体被手托住展示。",
            visualFocus: "整只小鱿鱼的乳白半透明身体及黑褐斑点的分布。",
            visualBeat: "小鱿鱼被手托起，头部朝上、身体自然并排延展，黑褐斑点覆盖在身体表面。",
            evidenceRefs: ["fact:whole", "fact:spots", "fact:body"],
        },
        { ...base, purchaseQuestion: "两侧眼睛与末端的鳍怎么区分？", displayContent: "头部两侧的眼睛与身体另一端的三角形鳍。", visualFocus: "两侧蓝绿色眼睛和左右成对的鳍。", evidenceRefs: ["fact:eyes", "fact:fins"] },
        {
            ...base,
            role: "detail-closing",
            purchaseQuestion: "整只是不是头、外套膜和鳍连为一体、没有切开？",
            displayContent: "手托整只展示连续轮廓，头、外套膜和鳍相接处保持连接；身体表面的半透明与斑点连续覆盖到与头部、鳍相接的范围，没有分段切口。",
            visualFocus: "头、外套膜、鳍连成一体的连续轮廓和未切开的状态。",
            visualBeat: "从头部到身体末端保持完整外形，左右鳍仍在身体一端，没有出现分段断口。",
            evidenceRefs: ["fact:whole", "fact:fins", "fact:spots", "fact:body"],
        },
        { ...base, role: "detail-scene", purchaseQuestion: "做备料时怎么把整只和其他食材分开放？", displayContent: "手托着鱿鱼移入单独的备料碗，其他食材放在碗外。", visualFocus: "鱿鱼落入备料碗的动作与食材的位置关系。", evidenceRefs: ["fact:whole"] },
    ]);
    expect(matches).toContainEqual(expect.objectContaining({ index: 2, previousIndex: 0, field: "visualBeat" }));
    expect(matches.some(({ index }) => index === 1 || index === 3)).toBe(false);
});

test("空握屏只提示一次，也不会盖住后两屏实际用法相同的问题", () => {
    const base = { role: "detail-scene" as const, purpose: "", visual: "", elements: "" };
    const matches = studioDetailRepeats([
        { ...base, purchaseQuestion: "握持时出风口朝哪？", displayContent: "握住手柄，风口朝前。" },
        { ...base, purchaseQuestion: "吹发时风口朝哪里，怎么对准发丝？", displayContent: "手持手柄，圆形出风口朝向一束发丝。" },
        { ...base, purchaseQuestion: "吹发时另一只手怎么配合，发丝怎么到风口前？", displayContent: "另一只手拨开发丝，风口朝向被拨开的发丝。" },
    ]);
    expect(matches.filter(({ field }) => field === "purpose").map(({ index, previousIndex, replaceIndex }) => [replaceIndex ?? index, replaceIndex === undefined ? previousIndex : index])).toEqual([
        [0, 1],
        [2, 1],
    ]);
});

test("新版实测：握柄接合不是吹发，台面朝向不是操作，末屏却只在凑已讲过的部位", () => {
    const base = { role: "detail-closeup" as const, purpose: "", visual: "", elements: "" };
    const screens = [
        { ...base, role: "detail-scene" as const, purchaseQuestion: "吹头发时，风筒哪一端、朝哪个方向对着头发？", displayContent: "吹风机被手持在湿发旁，圆形出风口朝向下方发束。", evidenceRefs: ["fact:grille", "fact:housing"] },
        {
            ...base,
            role: "detail-model" as const,
            purchaseQuestion: "手柄与风筒是斜插还是近似直角，握住手柄时风筒在哪个方向？",
            displayContent: "手握住细长直筒手柄中段，手柄从风筒下方近似直角连接。",
            visualFocus: "手握细长手柄时风筒在上方的直角连接关系。",
            evidenceRefs: ["fact:housing", "fact:handle"],
        },
        { ...base, role: "detail-steps" as const, purchaseQuestion: "开关在手柄正面哪个位置，拇指怎样拨动？", displayContent: "手柄正面偏上处的滑动开关特写，拇指沿手柄纵向拨动。", evidenceRefs: ["fact:handle", "point:control"] },
        { ...base, purchaseQuestion: "电源线从手柄底端哪里引出？", displayContent: "浅灰色电源线从底端中央向下引出。" },
        {
            ...base,
            role: "detail-scene" as const,
            purchaseQuestion: "用完随手放在台面时，出风口、开关和电源线分别朝哪里？",
            displayContent: "吹风机被放在台面，出风口朝外，手柄正面开关朝上，电源线从底端垂向台面一侧。",
            evidenceRefs: ["fact:handle", "fact:colors"],
        },
        { ...base, purchaseQuestion: "手柄下段的深色分色到底在握持区的什么位置？", displayContent: "下段为较深薄荷绿分色块，分色边界横向环绕手柄。", evidenceRefs: ["fact:colors", "fact:palette"] },
        {
            ...base,
            purchaseQuestion: "手柄正面的开关、浅色握持段、深色分色下段和底端出线如何排布？",
            displayContent: "从上到下依次可见滑动开关、浅色握持段、深色分色下段，电源线从底端中央引出。",
            evidenceRefs: ["fact:handle", "point:control", "fact:colors"],
        },
    ];
    expect(studioDetailRepeats(screens).map(({ index, field }) => [index, field])).toEqual([[6, "purpose"]]);
    expect(studioDetailRepeats([screens[2], screens[6]])).toEqual([]);
});

test("不靠品类或开关名判断：只汇总过往已讲完的部位，存在新实物依据时可以成屏", () => {
    const base = { role: "detail-closeup" as const, purpose: "", visual: "", elements: "" };
    const plans = [
        { ...base, purchaseQuestion: "茶托放在哪里？", displayContent: "托面上有一处凹槽，杯底可以放入。", evidenceRefs: ["fact:saucer"] },
        { ...base, purchaseQuestion: "杯盖离开杯口后怎么搁？", displayContent: "盖沿搁在侧方盖托上。", evidenceRefs: ["fact:lid"] },
    ];
    const recap = { ...base, purchaseQuestion: "托面、杯座和盖托如何排布？", displayContent: "整套器具中列出托面、杯座和盖托的位置。", evidenceRefs: ["fact:saucer", "fact:lid"] };
    expect(studioDetailRepeats([...plans, recap])).toEqual([expect.objectContaining({ index: 2, field: "purpose" })]);
    expect(studioDetailRepeats([...plans, { ...recap, displayContent: "底层新增露出用于收水的抽屉。", evidenceRefs: [...recap.evidenceRefs, "fact:drawer"] }])).toEqual([]);
});
