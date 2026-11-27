import { expect, test } from "bun:test";
import { studioDetailPlanRoles } from "@/lib/ecommerce-studio/detail-plan";
import { parseDetailPlan } from "@/lib/ecommerce-studio/detail-plan-tasks";
import { studioImageInput, studioLocateRunShot } from "@/lib/ecommerce-studio/generation-input";
import { createStudioProduct } from "@/lib/ecommerce-studio/product";
import { createStudioRun } from "@/lib/ecommerce-studio/runs";
import { defaultConfig } from "@/stores/use-config-store";

const color = {
    role: "detail-selling",
    purchaseQuestion: "手柄下段的深色分色到底在握持区的什么位置？",
    displayContent: "手柄正面从开关到中段为浅薄荷绿，下段为较深薄荷绿分色块，分色边界横向环绕手柄；电源线从分色块底端引出。",
    visualFocus: "手柄上段浅色与下段深色的分色边界。",
    visualBeat: "分色边界横跨手柄一周，位置在下段而非开关处。",
    evidence: ["fact:band", "fact:color"],
};
const recap = {
    role: "detail-closeup",
    purchaseQuestion: "手柄正面的开关、浅色握持段、深色分色下段和底端出线如何排布？",
    displayContent: "手柄正面纵向全景，从上到下依次可见滑动开关、浅色握持段、深色分色下段，电源线从底端中央引出；开关区与分色区分离。",
    visualFocus: "手柄正面从上到下的功能与分色分区。",
    evidence: ["fact:control", "fact:band"],
};
const screens = [
    { role: "detail-hero", purchaseQuestion: "整件商品长什么样？", displayContent: "整件浅薄荷绿商品，手柄在下方。" },
    { role: "detail-steps", purchaseQuestion: "开关在哪？", displayContent: "拇指接触手柄上的滑钮。", evidence: ["fact:control"] },
    { role: "detail-closeup", purchaseQuestion: "电源线从哪里引出？", displayContent: "浅灰色电源线从手柄底部出来。" },
    color,
    recap,
];

function sample(name: string, cable: string) {
    const product = createStudioProduct(name);
    product.name = name;
    product.brief = { ...product.brief, productType: name, outputType: "detail-set", detailScreens: screens.length };
    product.photos = [{ id: "front", resourceId: "seller-photo", view: "front", truth: true, url: "", addedAt: "" }];
    product.dossier = {
        name,
        family: "electronics",
        category: name,
        summary: "",
        invariants: [cable],
        questions: ["整机尺寸、重量与电源线长度是多少？"],
        facts: [
            { id: "control", label: "手柄开关", value: "手柄正面有一枚滑钮", evidence: "visible", group: "structure" },
            { id: "band", label: "手柄下段配色", value: "手柄下端为较深薄荷绿，近似 #A9CDBA，与上段分色", evidence: "visible", group: "appearance" },
            { id: "color", label: "机身主色", value: "浅薄荷绿，近似 #CFE6DA", evidence: "visible", group: "appearance" },
        ],
    };
    return product;
}

function render(product: ReturnType<typeof sample>, rows: Record<string, unknown>[] = screens) {
    const result = parseDetailPlan(JSON.stringify({ screens: rows, alternatives: [] }), product, studioDetailPlanRoles(product), { id: "content", model: "planner", createdAt: "" }, { scope: "detail" });
    product.brief.detailPlan = result.plan;
    let serial = 0;
    const run = createStudioRun(product, () => String(++serial));
    const artwork = run.shots.map((_, index) => studioImageInput(product, studioLocateRunShot(run, index), "gpt-image-2", defaultConfig).compiled);
    return { ...result, artwork };
}

test("分色实测：本屏只提交一次实物答案，不把同义焦点、动态和估算色号做成多处标注", () => {
    const { artwork } = render(sample("吹风机", "电源线从手柄底端居中引出，浅灰色"));
    const visual = artwork[3].layers.find(({ id }) => id === "visual")!.text;
    expect(visual).toContain(color.displayContent);
    expect(visual).not.toContain(color.visualFocus);
    expect(visual).not.toContain(color.visualBeat);
    expect(visual).not.toMatch(/#(?:CFE6DA|A9CDBA)|本屏商品依据/);
    expect(artwork[3].layers.find(({ id }) => id === "copy")!.text).toContain("简体中文");
    expect(artwork[3].copySnapshot?.headline).toBe("");
});

test("实拍只露一小截线，不能用买家环境测量假装有新商品资料；没有新证据仍保留屏数和提醒", () => {
    for (const name of ["吹风机", "手持挂烫机"]) {
        const { plan, warnings, artwork } = render(sample(name, "电源线从手柄底端居中引出，浅灰色"));
        expect(plan.screens).toHaveLength(screens.length);
        expect(plan.screens.at(-1)?.purchaseQuestion).toBe(recap.purchaseQuestion);
        expect(warnings.some(({ index, field }) => index === screens.length - 1 && field === "purpose")).toBe(true);
        const final = artwork.at(-1)!;
        expect(final.prompt).toContain(plan.screens.at(-1)!.displayContent!);
        expect(final.prompt).not.toMatch(/供电点|量取预留处|\d+\s*(?:米|厘米|cm)\b|三脚插头|线长足够/);
        expect(final.layoutGuide).toBeUndefined();
    }
});

test("已讲过的空间关系、未证实或另售的线都不是新证据；卖家指定的收尾仍原样保留", () => {
    for (const observation of ["没有电源线", "实拍无法确认电源线从哪里引出", "电源线需另购", "旁边放着一根充电线", "台面边的一根电源线从手柄底端后方经过", "电源线从未拍清的手柄边缘露出"]) {
        const { plan, warnings } = render(sample("手持器具", observation));
        expect(plan.screens.at(-1)?.purchaseQuestion).toBe(recap.purchaseQuestion);
        expect(warnings).toContainEqual(expect.objectContaining({ index: screens.length - 1, field: "purpose" }));
    }
    const cordless = sample("手持器具", "电源线从手柄底端居中引出，浅灰色");
    cordless.sellerNotes = "使用方式：此款为无线充电式，使用时不接线";
    expect(render(cordless).plan.screens.at(-1)?.purchaseQuestion).not.toMatch(/供电位置|供电点/);
    const product = sample("有线手持器具", "电源线从手柄底端居中引出，浅灰色");
    const alreadyShown = screens.map((screen, index) => (index === 2 ? { ...screen, purchaseQuestion: "常用的地方离供电点有多远？", displayContent: "对照商品使用处与电源所在处的距离。" } : screen));
    expect(render(product, alreadyShown).plan.screens.at(-1)?.purchaseQuestion).toBe(recap.purchaseQuestion);
    product.brief.planNote = "按我选的部位做一张总览收尾";
    expect(render(product).plan.screens.at(-1)?.purchaseQuestion).toBe(recap.purchaseQuestion);
});

test("其他品类的卖家规格优先于泛用场景，也不把已被裁去的同义提法重新传给图模", () => {
    const product = sample("烘焙刀具", "烘焙刮板轮廓清晰");
    product.sellerNotes = "清洁方式：刮板可在洗碗机中清洗";
    const { plan, artwork } = render(product);
    expect(plan.screens.at(-1)?.evidenceRefs).toEqual(["seller:1"]);
    expect(artwork.at(-1)?.prompt).toContain("刮板可在洗碗机中清洗");
    expect(artwork.at(-1)?.prompt).not.toContain(recap.purchaseQuestion);
});

test("真实收纳两屏：换梳子和毛巾，没换商品摆位，保留前屏、给后屏一个新问题", () => {
    const product = sample("吹风机", "电源线从手柄底端居中引出，浅灰色");
    const rest = {
        role: "detail-scene",
        purchaseQuestion: "吹完临时放下时怎么摆。",
        displayContent: "吹风机平放在叠好的毛巾上，风筒横放，手柄朝外，电源线从底端垂到台面。",
        transitionOut: "放回台面后，它和梳子、镜子一起构成日常梳妆位置。",
        evidence: ["fact:band"],
    };
    const props = {
        role: "detail-collocation",
        purchaseQuestion: "和现有梳妆物件怎么放在一起。",
        displayContent: "洗漱台面上，吹风机与梳子、镜子、毛巾并排，风筒横向，手柄朝外，拿取方向清楚。",
        evidence: ["fact:color", "fact:band"],
    };
    product.brief.detailScreens = 6;
    product.dossier!.facts.push({ id: "end", label: "尾端", value: "底盖外沿有一道圆弧收口", group: "structure", evidence: "visible" });
    const closeup = {
        role: "detail-closeup",
        purchaseQuestion: "尾端是什么形态？",
        displayContent: "底盖外沿有一道圆弧收口，与正面格栅分处两端。",
        visualFocus: "底盖外沿的圆弧收口",
        detailSource: { photo: "photo:front", box: [64, 4, 80, 34] },
        evidence: ["fact:end"],
    };
    const shownControl = { ...screens[1], displayContent: "手柄正面有一枚滑钮；拇指接触滑钮。" };
    const { plan, artwork } = render(product, [screens[0], shownControl, color, rest, props, closeup]);
    expect(plan.screens).toHaveLength(product.brief.detailScreens);
    expect(plan.screens[3].purchaseQuestion).toBe(rest.purchaseQuestion);
    expect(plan.screens[3].transitionOut).toBeUndefined();
    expect(plan.screens[4].purchaseQuestion).toContain(closeup.visualFocus);
    expect(plan.screens[4].evidenceRefs).toContain("photo:front");
    expect(plan.screens[4].detailSource).toEqual({ ...closeup.detailSource, framing: "locate" });
    expect(plan.screens[4].evidenceRefs).toContain("fact:end");
    expect(plan.screens[5].detailSource).toEqual(closeup.detailSource);
    expect(artwork[4].prompt).toContain(plan.screens[4].displayContent!);
    expect(artwork[4].prompt).not.toContain(props.displayContent);
    expect(artwork[4].prompt).not.toMatch(/供电点|插座|量取预留处/);
    expect(artwork[4].prompt).toContain("与正面格栅分处两端");
    expect(artwork[4].prompt).toContain("图3是图1的实拍局部");
    expect(artwork[4].layers.find(({ id }) => id === "product-region")?.text).toContain("整件");
    expect(artwork[4].layoutGuide).toBeUndefined();
    const withoutPhoto = render(product, [screens[0], shownControl, color, rest, props, { ...closeup, detailSource: { photo: "photo:unknown", box: [64, 4, 80, 34] } }]);
    expect(withoutPhoto.plan.screens[4].purchaseQuestion).not.toContain(closeup.visualFocus);
    expect(withoutPhoto.artwork[4].prompt).not.toMatch(/供电点|量取预留处/);
});

test("新增真实动作与确认的型号、尺寸不能因共用部件名称被删掉", () => {
    const product = sample("茶具", "透明盖与杯口相接");
    product.sellerNotes = "杯口内径：8 厘米";
    const beat = "一只手将杯盖提离杯口，再把盖沿搁到侧面的盖托。";
    const focus = "杯盖离开杯口时露出的内侧刻线。";
    const evidence = "杯口内径：8 厘米";
    const { artwork } = render(product, [screens[0], screens[1], screens[2], { role: "detail-scene", purchaseQuestion: "盖子怎样放？", displayContent: "盖子原本覆盖杯口。", visualFocus: focus, visualBeat: beat, evidence: ["seller:1"] }, screens[4]]);
    const visual = artwork[3].layers.find(({ id }) => id === "visual")!.text;
    for (const required of [beat, focus, evidence]) expect(visual).toContain(required);
});

test("非吹风机长页没有候补：能用新截面就替换；资料用完，保留重复提醒，不虚构量尺适配场景", () => {
    const product = sample("清洁器", "");
    product.dossier = {
        ...product.dossier!,
        family: "home",
        questions: ["机身尺寸是多少？"],
        facts: [{ id: "housing", group: "structure", label: "机身形状", value: "外壳呈方形，底边有波浪形凸纹", evidence: "visible" }],
    };
    product.brief.detailScreens = 5;
    const rows = [
        { role: "detail-hero", purchaseQuestion: "认出这台清洁器。", displayContent: "方形外壳配软管，整机可辨。", evidence: ["fact:housing"] },
        { role: "detail-scene", purchaseQuestion: "使用前需要预留哪段空间？", displayContent: "软管与实际使用位置之间的距离。" },
        { role: "detail-scene", purchaseQuestion: "平放时，软管从一侧往哪个方向走？", displayContent: "软管沿桌沿自然延伸。" },
        { role: "detail-scene", purchaseQuestion: "转身时，软管会从哪一侧经过？", displayContent: "软管从身体另一侧经过。" },
        { role: "detail-closeup", purchaseQuestion: "软管的连接点在哪里？", displayContent: "软管接在边缘的圆形环上。" },
    ];
    const { plan, warnings, artwork } = render(product, rows);
    expect(plan.screens[2].displayContent).toContain("底边有波浪形凸纹");
    expect(plan.screens[3].displayContent).toBe(rows[3].displayContent);
    expect(warnings.some(({ index, field }) => index === 3 && field === "purpose")).toBe(true);
    expect(plan.screens[4].purchaseQuestion).toBe(rows[4].purchaseQuestion);
    expect(plan.screens[0].purchaseQuestion).toBe(rows[0].purchaseQuestion);
    expect(artwork[2].prompt).toContain("底边有波浪形凸纹");
    expect(artwork[3].prompt).not.toMatch(/量取预留处|机身(?:宽|尺寸)[度为\s]*\d+/u);
});
