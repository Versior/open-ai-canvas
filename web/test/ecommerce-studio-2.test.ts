import { describe, expect, test } from "bun:test";

import {
    ECOMMERCE_REVISION_KINDS,
    createEcommerceRevision,
    ecommerceCurrentRevision,
    ecommerceForkRevision,
    ecommerceNextRevisionVersion,
    ecommerceRevisionBlocked,
    ecommerceRevisionChain,
    ecommerceRevisionHasBranches,
    ecommerceRevisionIssues,
    ecommerceRevisionNeedsRegion,
    ecommerceRevisionPrompt,
    ecommerceRevisionShippingVersion,
    ecommerceSwitchCurrentRevision,
} from "@/lib/ecommerce/ecommerce-revision";
import {
    applyEcommerceVariants,
    createEcommerceVariantAxis,
    createEcommerceVariantSet,
    ecommerceVariantCombinationCount,
    ecommerceVariantIssues,
    ecommerceVariantPlaceholders,
    ecommerceVariantPlanSummary,
    ecommerceVariantRows,
} from "@/lib/ecommerce/ecommerce-variants";
import {
    ECOMMERCE_VIDEO_SPECS,
    createEcommerceVideo,
    createEcommerceVideoShot,
    ecommerceVideoBlocked,
    ecommerceVideoFirstFrameRule,
    ecommerceVideoIssues,
    ecommerceVideoPrompt,
    ecommerceVideoReady,
    ecommerceVideoSeconds,
    ecommerceVideoShotsFromImages,
    ecommerceVideoSpec,
} from "@/lib/ecommerce/ecommerce-video";
import {
    ECOMMERCE_SIZE_CHART_TEMPLATES,
    createEcommerceSizeChart,
    ecommerceSizeChartBlocked,
    ecommerceSizeChartCellKey,
    ecommerceSizeChartHowToMeasure,
    ecommerceSizeChartIssues,
    ecommerceSizeChartTable,
} from "@/lib/ecommerce/ecommerce-size-chart";
import {
    ECOMMERCE_APLUS_MODULES,
    createEcommerceAplus,
    createEcommerceAplusBlock,
    ecommerceAplusBlock,
    ecommerceAplusBlocked,
    ecommerceAplusExportSize,
    ecommerceAplusIssues,
    ecommerceAplusModule,
} from "@/lib/ecommerce/ecommerce-aplus";
import {
    ECOMMERCE_SLICE_SPECS,
    createEcommerceSliceProtectedRange,
    ecommerceSliceBlocked,
    ecommerceSliceFileName,
    ecommerceSliceIssues,
    ecommerceSlicePlan,
    ecommerceSliceSpec,
} from "@/lib/ecommerce/ecommerce-slice";

function revision(version: number, change: string, overrides: Partial<Parameters<typeof createEcommerceRevision>[0]> = {}) {
    return createEcommerceRevision({ version, kind: "local", change, basedOn: null, imageNodeId: `img-${version}`, ...overrides });
}

describe("revision chain", () => {
    test("the chain sorts by version, not by insertion order", () => {
        const chain = ecommerceRevisionChain([revision(3, "c"), revision(1, "a"), revision(2, "b")]);
        expect(chain.map((item) => item.version)).toEqual([1, 2, 3]);
    });

    test("the next version is max+1, so deleting a middle version cannot cause reuse", () => {
        // 取数组长度加一会在删掉中间版本后重复版本号；行业硬规矩是作废不复用
        expect(ecommerceNextRevisionVersion([revision(1, "a"), revision(2, "b"), revision(3, "c")])).toBe(4);
        expect(ecommerceNextRevisionVersion([revision(1, "a"), revision(3, "c")])).toBe(4);
        expect(ecommerceNextRevisionVersion([])).toBe(1);
    });

    test("going back to an earlier version switches the flag instead of deleting later ones", () => {
        const chain = [revision(1, "初版"), revision(2, "改背景"), revision(3, "改色")];
        const switched = ecommerceSwitchCurrentRevision(chain, chain[0].id);
        // 后面的版本要留着——运营可能改主意又要回来，而且它们记录了走过的弯路
        expect(switched).toHaveLength(3);
        expect(ecommerceCurrentRevision(switched)?.version).toBe(1);
        expect(switched.filter((item) => item.current)).toHaveLength(1);
    });

    test("forking records which version it came from and marks branches", () => {
        const chain = [revision(1, "初版")];
        const forked = ecommerceForkRevision(chain, chain[0].id, { kind: "color", change: "换成米白", imageNodeId: "img-x" });
        expect(forked).toHaveLength(2);
        expect(forked[1].version).toBe(2);
        expect(forked[1].basedOn).toBe(chain[0].id);
        expect(ecommerceCurrentRevision(forked)?.version).toBe(2);
        expect(ecommerceRevisionHasBranches(forked, chain[0].id)).toBe(true);
        expect(ecommerceRevisionHasBranches(forked, forked[1].id)).toBe(false);
    });

    test("a missing change note is blocked — the chain is worthless without it", () => {
        const issues = ecommerceRevisionIssues([revision(1, ""), revision(2, "有说明")]);
        expect(ecommerceRevisionBlocked(issues)).toBe(true);
        expect(issues[0].message).toContain("没有写改了什么");
    });

    test("duplicate versions and broken links are caught", () => {
        expect(ecommerceRevisionBlocked(ecommerceRevisionIssues([revision(1, "a"), revision(1, "b")]))).toBe(true);
        const orphan = revision(2, "b", { basedOn: "rev-missing" });
        expect(ecommerceRevisionBlocked(ecommerceRevisionIssues([revision(1, "a"), orphan]))).toBe(true);
    });

    test("too many full regenerations is warned — local edits should come first", () => {
        const chain = [revision(1, "初版", { kind: "first" }), revision(2, "重出", { kind: "regenerate" }), revision(3, "又重出", { kind: "regenerate" }), revision(4, "再重出", { kind: "regenerate" })];
        const issues = ecommerceRevisionIssues(chain);
        expect(issues.some((issue) => issue.message.includes("试试局部修改"))).toBe(true);
    });

    test("only region edits get the keep-everything-else instruction", () => {
        // 「西瓜对了背景又崩了」就是因为没说这句
        const local = ecommerceRevisionPrompt({ ...revision(2, "把杯盖 Logo 改小"), kind: "local" }, { x: 0.1, y: 0.2, width: 0.3, height: 0.3 });
        expect(local).toContain("其余部分必须逐像素保持原样");
        expect(local).toContain("不要重新生成整张图");
        expect(local).toContain("横向 10%–40%");

        const crop = ecommerceRevisionPrompt({ ...revision(2, "裁成 1:1"), kind: "crop" });
        expect(crop).toBe("裁成 1:1");
        expect(crop).not.toContain("保持原样");
    });

    test("region edits are exactly the kinds that need a selection", () => {
        expect(ecommerceRevisionNeedsRegion("local")).toBe(true);
        expect(ecommerceRevisionNeedsRegion("color")).toBe(true);
        expect(ecommerceRevisionNeedsRegion("background")).toBe(false);
        expect(ecommerceRevisionNeedsRegion("crop")).toBe(false);
    });

    test("shipping version falls back to 1 when nothing is current", () => {
        const chain = [revision(1, "a"), revision(2, "b")].map((item) => ({ ...item, current: false }));
        expect(ecommerceRevisionShippingVersion(chain)).toBe(1);
        expect(ecommerceRevisionShippingVersion(undefined)).toBe(1);
        expect(ecommerceRevisionShippingVersion([{ ...revision(3, "c"), current: true }])).toBe(3);
    });

    test("every kind is named and hinted", () => {
        expect(ECOMMERCE_REVISION_KINDS.length).toBeGreaterThanOrEqual(8);
        for (const kind of ECOMMERCE_REVISION_KINDS) {
            expect(kind.label.trim()).not.toBe("");
            expect(kind.hint.trim()).not.toBe("");
        }
    });
});

describe("SKU variants", () => {
    const set = createEcommerceVariantSet();
    set.axes = [
        createEcommerceVariantAxis("颜色", ["黑", "白"]),
        createEcommerceVariantAxis("容量", ["350ml", "500ml"]),
    ];

    test("combinations are the cartesian product of the usable axes", () => {
        expect(ecommerceVariantCombinationCount(set)).toBe(4);
        const rows = ecommerceVariantRows(set);
        expect(rows).toHaveLength(4);
        expect(rows.map((row) => row.label)).toEqual(["黑 / 350ml", "黑 / 500ml", "白 / 350ml", "白 / 500ml"]);
    });

    test("an axis without values contributes nothing instead of zeroing the count", () => {
        const broken = { axes: [createEcommerceVariantAxis("颜色", ["黑"]), createEcommerceVariantAxis("材质", [])] };
        expect(ecommerceVariantCombinationCount(broken)).toBe(1);
        expect(ecommerceVariantCombinationCount({ axes: [] })).toBe(0);
    });

    test("placeholders are substituted and unknown ones are left visible", () => {
        const row = ecommerceVariantRows(set)[0];
        expect(applyEcommerceVariants("杯身是哑光{颜色}，容量 {容量}", row)).toBe("杯身是哑光黑，容量 350ml");
        // 认不出的占位符原样留着——多半是轴名打错了，留着比静默删掉好
        expect(applyEcommerceVariants("材质是{材质}", row)).toBe("材质是{材质}");
        expect(ecommerceVariantPlaceholders("a{颜色}b{材质}c")).toEqual(["颜色", "材质"]);
    });

    test("a placeholder with no matching axis is warned", () => {
        const issues = ecommerceVariantIssues(set, ["杯身是哑光{颜色}", "材质是{材质}"]);
        expect(issues[0].message).toContain("{材质}");
        expect(issues[0].message).toContain("不会被替换");
    });

    test("an axis that is never referenced is warned", () => {
        const issues = ecommerceVariantIssues(set, ["只有{颜色}"]);
        expect(issues.some((issue) => issue.message.includes("容量"))).toBe(true);
    });

    test("the plan summary multiplies rows by images so the cost is visible before generating", () => {
        expect(ecommerceVariantPlanSummary(set, 5)).toEqual({ rows: 4, images: 20 });
        expect(ecommerceVariantPlanSummary(createEcommerceVariantSet(), 5)).toEqual({ rows: 0, images: 0 });
    });

    test("runaway combination counts are truncated rather than rendered", () => {
        const wide = { axes: Array.from({ length: 5 }, (_, index) => createEcommerceVariantAxis(`轴${index}`, ["a", "b", "c", "d"])) };
        // 4^5 = 1024，截到上限；界面摆不下，人也没法逐行核对
        expect(ecommerceVariantRows(wide).length).toBeLessThanOrEqual(120);
    });
});

describe("ecommerce video", () => {
    test("the four platforms carry their own hard specs", () => {
        expect(ECOMMERCE_VIDEO_SPECS.map((spec) => spec.id)).toEqual(["taobao", "jd", "douyin", "amazon"]);
        for (const spec of ECOMMERCE_VIDEO_SPECS) {
            expect(spec.allowedRatios.length).toBeGreaterThan(0);
            expect(spec.maxSeconds).toBeGreaterThan(spec.minSeconds);
            expect(spec.firstFrameRule.trim()).not.toBe("");
            expect(spec.note.trim()).not.toBe("");
        }
    });

    test("taobao does not accept 9:16 — that has to be caught before upload", () => {
        expect(ecommerceVideoSpec("taobao")!.allowedRatios).not.toContain("9:16");
        const video = { ...createEcommerceVideo("种草"), kind: "seed" as const, platform: "taobao" as const, shots: [createEcommerceVideoShot("img-1")] };
        const issues = ecommerceVideoIssues(video);
        expect(ecommerceVideoBlocked(issues)).toBe(true);
        expect(issues.some((issue) => issue.message.includes("淘宝不收 9:16"))).toBe(true);
        expect(ecommerceVideoSpec("taobao")!.note).toContain("9:16 上传后商详不展示");
    });

    test("total duration is checked against the platform window", () => {
        const shots = Array.from({ length: 8 }, (_, index) => ({ ...createEcommerceVideoShot(`img-${index}`), seconds: 10 }));
        const video = { ...createEcommerceVideo(), platform: "taobao" as const, shots };
        expect(ecommerceVideoSeconds(video)).toBe(80);
        expect(ecommerceVideoBlocked(ecommerceVideoIssues(video))).toBe(true);
        expect(ecommerceVideoIssues(video).some((issue) => issue.message.includes("超过"))).toBe(true);
    });

    test("spreading shots from a set compresses durations instead of dropping shots", () => {
        // 砍掉后面的镜头会让「一套图」不完整，所以按比例压时长
        const shots = ecommerceVideoShotsFromImages(Array.from({ length: 12 }, (_, index) => `img-${index}`), { platform: "taobao" });
        expect(shots).toHaveLength(12);
        expect(ecommerceVideoSeconds({ ...createEcommerceVideo(), shots })).toBeLessThanOrEqual(60);
        // 正常长度的一套不压缩
        expect(ecommerceVideoShotsFromImages(["a", "b"], { platform: "taobao" }).map((shot) => shot.seconds)).toEqual([3, 3]);
    });

    test("a slide deck of stills is warned, not blocked", () => {
        const shots = [1, 2, 3].map((index) => ({ ...createEcommerceVideoShot(`img-${index}`), motion: "still" as const, caption: `第${index}句` }));
        const issues = ecommerceVideoIssues({ ...createEcommerceVideo(), shots });
        expect(ecommerceVideoBlocked(issues)).toBe(false);
        expect(issues.some((issue) => issue.message.includes("幻灯片不是视频"))).toBe(true);
    });

    test("captions longer than one shot can read are warned", () => {
        const shot = { ...createEcommerceVideoShot("img-1"), caption: "这句话太长了，一个镜头根本读不完就会被切走" };
        expect(ecommerceVideoIssues({ ...createEcommerceVideo(), shots: [shot] }).some((issue) => issue.message.includes("16 字"))).toBe(true);
    });

    test("an empty video is blocked with a next step, not a bare error", () => {
        const issues = ecommerceVideoIssues(createEcommerceVideo());
        expect(ecommerceVideoBlocked(issues)).toBe(true);
        expect(issues[0].message).toContain("连入图片或从一套图铺出镜头表");
        expect(ecommerceVideoReady(createEcommerceVideo())).toBe(false);
    });

    test("the prompt pins每镜 duration and forbids the model from adding text", () => {
        const shots = [
            { ...createEcommerceVideoShot("img-1"), seconds: 3, motion: "push" as const, caption: "保温 12 小时" },
            { ...createEcommerceVideoShot("img-2"), seconds: 4, motion: "still" as const, transition: "fade" as const },
        ];
        const prompt = ecommerceVideoPrompt({ ...createEcommerceVideo("主图视频"), platform: "taobao", shots, music: "轻快电子" });
        expect(prompt).toContain("【电商视频】主图视频");
        expect(prompt).toContain("第 1 镜：3 秒；运镜：推近；字幕内容：「保温 12 小时」（由后期添加，不要画进画面）");
        expect(prompt).toContain("第 2 镜：4 秒；运镜：静止；转场：叠化");
        expect(prompt).toContain("不要自行增加镜头");
        expect(prompt).toContain("配乐风格：轻快电子");
        expect(prompt).toContain("不要出现任何文字、水印、二维码与第三方标识");
    });

    test("the first-frame rule is surfaced on the node, not buried in a doc", () => {
        expect(ecommerceVideoFirstFrameRule({ ...createEcommerceVideo(), platform: "taobao" })).toContain("禁止全屏黑白");
        expect(ecommerceVideoFirstFrameRule({ ...createEcommerceVideo(), platform: "douyin" })).toContain("禁止二维码");
        expect(ecommerceVideoFirstFrameRule(undefined)).toBe("");
    });
});

describe("size chart", () => {
    test("every category brings its own measurement set", () => {
        expect(ECOMMERCE_SIZE_CHART_TEMPLATES.map((template) => template.id)).toEqual(["top", "pants", "dress", "shoes", "kids", "bag"]);
        for (const template of ECOMMERCE_SIZE_CHART_TEMPLATES) {
            expect(template.fields.length).toBeGreaterThanOrEqual(3);
            // 量体说明是尺码表失效的真正原因，每一项都要有
            for (const field of template.fields) expect(field.how.trim()).not.toBe("");
        }
    });

    test("the table carries units in the column names", () => {
        const chart = createEcommerceSizeChart("top");
        chart.cells[ecommerceSizeChartCellKey("M", "胸围")] = "104";
        const table = ecommerceSizeChartTable(chart);
        expect(table.columns[0]).toBe("尺码");
        // 不带单位的尺码表是最常见的返工原因，买家分不清 38 是厘米还是码数
        expect(table.columns).toContain("胸围(cm)");
        expect(table.columns).toContain("建议体重(kg)");
        expect(table.rows[1]).toEqual(["M", "104", "", "", "", ""]);
    });

    test("an empty chart is blocked and a half-filled one is warned", () => {
        expect(ecommerceSizeChartBlocked(ecommerceSizeChartIssues({ ...createEcommerceSizeChart(), sizes: [] }))).toBe(true);
        const chart = createEcommerceSizeChart("top");
        chart.cells[ecommerceSizeChartCellKey("S", "胸围")] = "96";
        const issues = ecommerceSizeChartIssues(chart);
        expect(issues.some((issue) => issue.message.includes("没填数值"))).toBe(true);
        expect(ecommerceSizeChartBlocked(issues)).toBe(false);
    });

    test("turning off the measurement guide is warned", () => {
        const chart = { ...createEcommerceSizeChart(), showHowToMeasure: false };
        expect(ecommerceSizeChartIssues(chart).some((issue) => issue.message.includes("量体说明"))).toBe(true);
        expect(ecommerceSizeChartHowToMeasure(chart)).toBe("");
    });

    test("the measurement guide spells out how to measure each item", () => {
        const guide = ecommerceSizeChartHowToMeasure(createEcommerceSizeChart("shoes"));
        expect(guide).toContain("脚长（脚跟到最长脚趾的直线距离）");
        expect(guide).toContain("允许 1–3cm 误差");
    });
});

describe("A+ content", () => {
    test("the module specs carry the platform's real numbers", () => {
        const overlay = ecommerceAplusModule("image-text-overlay")!;
        expect(overlay.imageMin).toEqual({ width: 970, height: 300 });
        expect(overlay.imageBest).toEqual({ width: 1940, height: 600 });
        expect(overlay.headlineMax).toBe(70);
        expect(overlay.bodyMax).toBe(300);
        const chart = ecommerceAplusModule("comparison-chart")!;
        expect(chart.chart).toEqual({ maxProducts: 6, maxRows: 10, cellMax: 250, imageMin: { width: 150, height: 300 } });
        for (const module of ECOMMERCE_APLUS_MODULES) expect(module.officialName.trim()).not.toBe("");
    });

    test("over-length text is blocked because the platform truncates it", () => {
        const aplus = createEcommerceAplus("A+");
        aplus.blocks = [{ ...createEcommerceAplusBlock("image-text-overlay"), headline: "字".repeat(80) }];
        const issues = ecommerceAplusIssues(aplus);
        expect(ecommerceAplusBlocked(issues)).toBe(true);
        expect(issues[0].message).toContain("超过上限 70 字");
    });

    test("a comparison chart over six products is blocked", () => {
        const aplus = createEcommerceAplus("A+");
        aplus.blocks = [{ ...createEcommerceAplusBlock("comparison-chart"), chartColumns: ["项目", "A", "B", "C", "D", "E", "F", "G"], chartRows: [["尺寸", "1", "2", "3", "4", "5", "6", "7"]] }];
        expect(ecommerceAplusIssues(aplus).some((issue) => issue.message.includes("超过上限 6 个"))).toBe(true);
    });

    test("naming a competitor in the comparison chart is blocked", () => {
        const aplus = createEcommerceAplus("A+");
        aplus.blocks = [{ ...createEcommerceAplusBlock("comparison-chart"), chartColumns: ["项目", "本品", "竞品A"], chartRows: [["容量", "500ml", "450ml"]] }];
        const issues = ecommerceAplusIssues(aplus);
        expect(ecommerceAplusBlocked(issues)).toBe(true);
        expect(issues.some((issue) => issue.message.includes("只对比自家系列"))).toBe(true);
    });

    test("reusing a module is warned, not blocked", () => {
        const aplus = createEcommerceAplus("A+");
        aplus.blocks = [{ ...createEcommerceAplusBlock("header-image-text"), headline: "a" }, { ...createEcommerceAplusBlock("header-image-text"), headline: "b" }];
        const issues = ecommerceAplusIssues(aplus);
        expect(ecommerceAplusBlocked(issues)).toBe(false);
        expect(issues.some((issue) => issue.message.includes("重复"))).toBe(true);
    });

    test("the prompt carries each module's own canvas size and forbids baked-in text", () => {
        const aplus = createEcommerceAplus("保温杯 A+");
        aplus.blocks = [{ ...createEcommerceAplusBlock("header-image-text"), headline: "保温 12 小时", body: "304 不锈钢内胆" }];
        const block = ecommerceAplusBlock(aplus);
        expect(block).toContain("【A+ 内容】保温杯 A+");
        expect(block).toContain("画面 1940×600");
        expect(block).toContain("标题：保温 12 小时");
        // 模型把字画进图，再叠一层字就是两套字打架
        expect(block).toContain("不要出现任何文字");
        expect(ecommerceAplusBlock(createEcommerceAplus("空"))).toBe("");
    });

    test("export size prefers the best resolution and falls back to the minimum", () => {
        expect(ecommerceAplusExportSize("image-text-overlay")).toEqual({ width: 1940, height: 600 });
        expect(ecommerceAplusExportSize("image-text-overlay", false)).toEqual({ width: 970, height: 300 });
        expect(ecommerceAplusExportSize("technical-specs")).toBeNull();
    });
});

describe("detail page slicing", () => {
    test("each platform carries its own width and slice ceiling", () => {
        expect(ECOMMERCE_SLICE_SPECS.map((spec) => spec.id)).toEqual(["taobao", "jd", "pdd", "douyin"]);
        expect(ecommerceSliceSpec("taobao")!.maxSliceHeight).toBe(1100);
        expect(ecommerceSliceSpec("douyin")!.maxTotalHeight).toBe(16000);
    });

    test("a short image is one piece", () => {
        const plan = ecommerceSlicePlan({ totalHeight: 900, platform: "taobao" });
        expect(plan.pieces).toEqual([{ index: 1, top: 0, height: 900 }]);
        expect(plan.conflicts).toEqual([]);
    });

    test("a long image splits into even pieces under the ceiling", () => {
        const plan = ecommerceSlicePlan({ totalHeight: 4000, platform: "taobao" });
        expect(plan.pieces).toHaveLength(4);
        for (const piece of plan.pieces) expect(piece.height).toBeLessThanOrEqual(1100);
        // 首尾必须严丝合缝，不能漏掉或重叠
        expect(plan.pieces[0].top).toBe(0);
        const last = plan.pieces[plan.pieces.length - 1];
        expect(last.top + last.height).toBe(4000);
    });

    test("cuts move out of a protected block so nothing gets sliced through", () => {
        // 切点会落在 1000 附近，而 940–1180 是产品主体
        const plan = ecommerceSlicePlan({
            totalHeight: 4000,
            platform: "taobao",
            protected: [createEcommerceSliceProtectedRange(940, 240, "杯身主体")],
        });
        const firstCut = plan.pieces[0].top + plan.pieces[0].height;
        expect(firstCut).toBe(940);
        expect(plan.pieces[0].adjustedFrom).toBe(1000);
        expect(plan.conflicts).toEqual([]);
    });

    test("a cut that cannot move is reported instead of silently accepted", () => {
        // 保护块几乎占满整张图：往上挪会让首片过矮，往下推会让末片过矮
        const plan = ecommerceSlicePlan({
            totalHeight: 2200,
            platform: "taobao",
            protected: [createEcommerceSliceProtectedRange(50, 2100, "整屏产品图")],
        });
        expect(plan.conflicts).toHaveLength(1);
        expect(plan.conflicts[0].label).toBe("整屏产品图");
        const issues = ecommerceSliceIssues(plan, "taobao");
        expect(ecommerceSliceBlocked(issues)).toBe(true);
        expect(issues[0].message).toContain("切穿了上架后每张图都缺一块");
    });

    test("over the platform's total ceiling is blocked", () => {
        const plan = ecommerceSlicePlan({ totalHeight: 18000, platform: "douyin" });
        expect(plan.overTotalHeight).toBe(true);
        expect(ecommerceSliceBlocked(ecommerceSliceIssues(plan, "douyin"))).toBe(true);
    });

    test("slice filenames say which piece of how many", () => {
        expect(ecommerceSliceFileName({ code: "A001", index: 2, total: 9 })).toBe("A001_详情_02of09_v1.jpg");
        expect(ecommerceSliceFileName({ code: "", index: 1, total: 3, version: 2 })).toBe("ITEM_详情_01of03_v2.jpg");
    });
});
