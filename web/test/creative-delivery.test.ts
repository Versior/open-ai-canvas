import { expect, test } from "bun:test";
import { deliveryCsv, deliveryFileStem, deliverySrt } from "@/lib/delivery-text";
import { replicationDeliveryFiles } from "@/lib/canvas/video-replication-delivery";
import { defaultReplicaPlan } from "@/lib/canvas/video-replica-plan";
import type { VideoTeardownAnalysis } from "@/lib/canvas/video-teardown";
import type { VideoTeardownBundle } from "@/services/api/video-replication";
import { interiorDeliveryFiles, interiorRoomSchedule, reviewInteriorScene } from "@/lib/interior/scene-delivery";
import { normalizeSceneSpec } from "@/lib/interior/scene-spec";
import { reviewStudioDelivery, studioEdgeAudit } from "@/lib/ecommerce-studio/delivery-review";
import { createStudioProduct, normalizeStudioProduct } from "@/lib/ecommerce-studio/product";
import { createStudioRun } from "@/lib/ecommerce-studio/runs";
import { createZip, readZip } from "@/lib/zip";

test("historical studio run keeps its typesetting style after the product style changes", () => {
    const product = createStudioProduct("product");
    product.style = "noir";
    const run = createStudioRun(product, () => "id");
    product.runs = [run];
    product.style = "pure";
    const restored = normalizeStudioProduct(JSON.parse(JSON.stringify(product)));
    expect(restored?.runs[0].styleId).toBe("noir");
    expect(restored?.style).toBe("pure");
});

test("CSV protects formula cells and preserves quoted multilingual content", () => {
    expect(deliveryCsv([["=1+1", " @SUM(A1)", '中文,"标题"', 123]])).toBe('\uFEFF"\'=1+1","\' @SUM(A1)","中文,""标题""","123"');
    expect(deliveryFileStem("../a/b\n")).not.toContain("/");
    expect(deliverySrt([{ text: "hello\n\nworld", startMs: 3600010, endMs: 3601000 }])).toContain("01:00:00,010 --> 01:00:01,000\nhello\nworld");
});

test("video package compresses skipped shots while retaining source timecodes", async () => {
    const bundle: VideoTeardownBundle = {
        version: 1,
        source: { resourceId: "source", width: 100, height: 100, hasAudio: false, durationMs: 6000 },
        shots: [1, 2, 3].map((index) => ({
            index,
            startMs: (index - 1) * 2000,
            endMs: index * 2000,
            keyframeTimeMs: (index - 1) * 2000,
            keyframeResourceId: `frame${index}`,
            keyframeWidth: 100,
            keyframeHeight: 100,
            boundary: index === 1 ? "start" : "cut",
        })),
        grids: [],
        transcript: { source: "none", segments: [] },
        warnings: [],
    };
    const analysis: VideoTeardownAnalysis = { title: "示例", rows: [], summary: null };
    const plan = defaultReplicaPlan(bundle, analysis);
    plan.shots[0].dialogue = "开头";
    plan.shots[1].treatment = "skip";
    plan.shots[2].dialogue = "结尾";
    const archive = await readZip(await createZip(replicationDeliveryFiles(bundle, analysis, plan)));
    const manifest = JSON.parse(await archive.get("分镜.json")!.text());
    expect(manifest.plannedDurationMs).toBe(4000);
    expect(manifest.shots[2]).toMatchObject({ sourceStartMs: 4000, startMs: 2000, endMs: 4000 });
    expect(manifest.shots[1].startMs).toBeNull();
    expect(await archive.get("方案口播.srt")!.text()).toContain("00:00:02,000 --> 00:00:04,000\n结尾");
});

test("interior package computes union area minus columns and escapes SVG labels", async () => {
    const spec = normalizeSceneSpec(
        {
            title: "方案",
            floors: [
                {
                    name: "一层",
                    rooms: [
                        { name: "客厅<测试>", type: "living", rect: [0, 0, 4, 3] },
                        { name: "客厅分部", part: "客厅<测试>", type: "living", rect: [3, 2, 5, 4] },
                    ],
                    pillars: [[0, 0, 1, 1]],
                    furniture: [{ type: "sofa", room: "客厅<测试>", at: "c", size: [6, 2] }],
                },
            ],
        },
        "home",
    );
    spec.floors[0].rooms = [
        { name: "客厅<测试>", type: "living", rect: [0, 0, 4, 3] },
        { name: "客厅分部", part: "客厅<测试>", type: "living", rect: [3, 2, 5, 4] },
    ];
    spec.floors[0].furniture[0].size = [6, 2];
    expect(interiorRoomSchedule(spec)[0].areaM2).toBe(14);
    expect(reviewInteriorScene(spec).some((issue) => issue.code === "furniture_size")).toBe(true);
    const files = await readZip(await createZip(interiorDeliveryFiles(spec)));
    expect([...files.keys()]).toContain("家具清单.csv");
    const svg = await files.get("平面图/1-一层.svg")!.text();
    expect(svg).toContain("客厅&lt;测试&gt;");
    expect(svg).not.toContain("客厅<测试>");
    expect(svg).toContain("不作为施工图");
});

test("studio review measures white edges without treating transparency as white", () => {
    const pixels = new Uint8ClampedArray(3 * 3 * 4).fill(255);
    expect(studioEdgeAudit(pixels, 3, 3).whiteEdgeRatio).toBe(1);
    pixels[3] = 0;
    expect(studioEdgeAudit(pixels, 3, 3).whiteEdgeRatio).toBe(7 / 8);
    pixels.fill(0);
    expect(studioEdgeAudit(pixels, 3, 3).cornerColor).toBe("#000000");
});

test("studio review includes missing shots, wrong dimensions and unsupported claims", () => {
    const product = createStudioProduct("review");
    product.platform = "taobao";
    product.brief.outputType = "main-set";
    const run = createStudioRun(
        product,
        (() => {
            let id = 0;
            return () => `s${id++}`;
        })(),
    );
    run.shots[0].headline = "全网第一";
    const report = reviewStudioDelivery(product, run.shots, new Map([[run.shots[0].id, { width: 400, height: 200, bytes: 100 }]]), new Set([run.shots[0].id]));
    expect(report.delivered).toBe(1);
    expect(report.issues.some((issue) => issue.message.includes("偏差"))).toBe(true);
    expect(report.issues.some((issue) => issue.message.includes("全网第一"))).toBe(true);
    expect(report.issues.filter((issue) => issue.message.includes("没有可交付")).length).toBe(run.shots.length - 1);
});
