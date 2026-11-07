import { describe, expect, test } from "bun:test";
import { studioDesignZone, reviewStudioCopy } from "@/lib/ecommerce-studio/art-direction";
import { planStudioTypeset } from "@/lib/ecommerce-studio/typeset";
import { DEFAULT_RENOVATION, planStoneLayout, readRenovation } from "@/lib/interior/renovation";
import { mergeInteriorDocuments, normalizeInteriorDocument } from "@/pages/interior/interior-models";
import { DEFAULT_REPLICA_CAMPAIGN, DEFAULT_REPLICA_DIRECTION, compileReplicaDirection, readReplicaDirection, replicaDirectorReview } from "@/lib/canvas/replica-director";
import { applyReplicaScript, parseReplicaScripts, type ReplicaShotPlan, type VideoReplicaPlan } from "@/lib/canvas/video-replica-plan";

describe("电商排版与文案质量", () => {
    test("放不下时阻止导出，不输出越界的文字", () => {
        expect(() =>
            planStudioTypeset({
                canvas: { width: 1000, height: 1000 },
                zone: { x: 0.1, y: 0.1, width: 0.2, height: 0.1, align: "left", vAlign: "top" },
                content: { headline: "超长标题".repeat(30), subline: "", lines: [] },
                measure: (text, size) => text.length * size,
            }),
        ).toThrow("超出排版区域");
    });
    test("栏目、标题与说明有独立层级且在同一留白区", () => {
        const zone = studioDesignZone({ layout: "poster" }, { x: 0, y: 0, width: 1, height: 1, align: "left", vAlign: "top" });
        const ops = planStudioTypeset({ canvas: { width: 1000, height: 1000 }, zone, content: { eyebrow: "01 / MATERIAL", headline: "316 不锈钢", subline: "材质来自卖家确认", lines: [] }, measure: (text, size) => text.length * size * 0.55 });
        expect(ops[0].size).toBeLessThan(ops[1].size);
        expect(ops.every((op) => op.y >= 60 && op.y + op.size <= 380)).toBe(true);
    });
    test("普通口号、重复文案和超密信息分别指出原因", () => {
        const codes = reviewStudioCopy({ headline: "品质之选", subline: "品质之选", lines: ["1", "2", "3", "4"] }).map((issue) => issue.code);
        expect(codes).toEqual(["generic", "repeat", "density"]);
    });
});

describe("装修与石材排板", () => {
    test("扣除拼缝，切边尺寸守住设计区域", () => {
        const spec = { ...DEFAULT_RENOVATION, widthMm: 3600, heightMm: 2600, slabWidthMm: 1800, slabHeightMm: 2600, seamMm: 2 };
        const layout = planStoneLayout(spec);
        expect(layout.pieces).toHaveLength(2);
        expect(layout.pieces[1]).toMatchObject({ x: 1802, width: 1798, flipX: true });
        expect(layout.netArea).toBeCloseTo(9.3548, 4);
        expect(layout.total).toBeNull();
        expect(layout.pieces.every((p) => p.x + p.width <= 3600 && p.y + p.height <= 2600)).toBe(true);
        for (const edge of [101, 120]) {
            const narrow = planStoneLayout({ ...DEFAULT_RENOVATION, widthMm: edge, heightMm: edge, slabWidthMm: 100, slabHeightMm: 100, seamMm: 20 });
            expect(narrow.pieces).toHaveLength(1);
            expect(narrow.pieces.every((p) => p.width > 0 && p.height > 0)).toBe(true);
            expect(narrow.netArea).toBeCloseTo(0.01);
        }
    });
    test("错缝产生半幅起始块；四向对纹只改变方向", () => {
        const spec = { ...DEFAULT_RENOVATION, widthMm: 2500, heightMm: 2100, slabWidthMm: 1000, slabHeightMm: 1000, seamMm: 2 };
        const staggered = planStoneLayout({ ...spec, pattern: "staggered" });
        expect(staggered.pieces.find((p) => p.id === "R2-C1")?.width).toBe(500);
        const fourway = planStoneLayout({ ...spec, pattern: "fourway" });
        expect(fourway.pieces.find((p) => p.id === "R2-C2")).toMatchObject({ flipX: true, flipY: true });
    });
    test("预算只用用户单价，没有报价不生成假金额", () => {
        const layout = planStoneLayout({ ...DEFAULT_RENOVATION, widthMm: 1000, heightMm: 1000, slabWidthMm: 1000, slabHeightMm: 1000, wastePercent: 10, materialPrice: 100, laborPrice: 50, budget: 150 });
        expect(layout.total).toBeCloseTo(160);
        expect(layout.warnings.some((w) => w.includes("超预算"))).toBe(true);
        expect(() => planStoneLayout({ ...DEFAULT_RENOVATION, widthMm: NaN })).toThrow();
        expect(() => planStoneLayout({ ...DEFAULT_RENOVATION, widthMm: 30000, heightMm: 30000, slabWidthMm: 100, slabHeightMm: 100 })).toThrow("600");
    });
    test("材料方案读回与三方保存不会丢掉另一窗口的独立修改", () => {
        const base = { version: 1 as const, rounds: [], professional: DEFAULT_RENOVATION };
        const server = { ...base, professional: { ...DEFAULT_RENOVATION, budget: 12000 } };
        const local = { ...base, professional: { ...DEFAULT_RENOVATION, materialPrice: 600 } };
        expect(mergeInteriorDocuments(server, local, new Set(), base).professional).toMatchObject({ budget: 12000, materialPrice: 600 });
        expect(normalizeInteriorDocument(server).professional).toEqual(server.professional);
        expect(readRenovation({ ...DEFAULT_RENOVATION, texture: { resourceId: "data:secret" } })).toBeUndefined();
        expect(readRenovation({ ...DEFAULT_RENOVATION, material: "toString" })).toBeUndefined();
    });
});

const shot: ReplicaShotPlan = {
    shotNumber: 1,
    treatment: "product",
    dialogue: "两字",
    onScreenText: "",
    imagePrompt: "杯身正面",
    videoPrompt: "开盖",
    director: { ...DEFAULT_REPLICA_DIRECTION, beat: "proof", action: "手从闭盖到按键，杯盖打开", evidence: "一只手开盖" },
};
const plan: VideoReplicaPlan = {
    version: 1,
    authorized: false,
    product: { name: "杯", look: "白色", audience: "", sellingPoints: "一只手开盖", images: [] },
    scripts: [],
    activeScriptId: "",
    shots: [shot],
    canvases: [],
    campaign: DEFAULT_REPLICA_CAMPAIGN,
};
describe("视频导演方案", () => {
    test("选择脚本同时替换旧商品画面，导演设置进入两种生成", () => {
        const scripts = parseReplicaScripts(JSON.stringify({ scripts: [{ angle: "单手操作", hook: "怎么开", lines: [{ ...shot, imagePrompt: "新杯", videoPrompt: "按键开盖" }] }] }), [1], {
            model: "text",
            createdAt: "now",
            idPrefix: "s",
            directed: true,
            facts: ["一只手开盖"],
            seconds: new Map([[1, 2]]),
        });
        const updated = applyReplicaScript(plan, scripts[0]);
        expect(updated.shots[0].imagePrompt).toBe("新杯");
        const prompts = compileReplicaDirection(updated.shots[0], plan.campaign);
        expect(prompts.imagePrompt).toContain("商品包装、颜色和尺寸一致");
        expect(prompts.videoPrompt).toContain("手从闭盖到按键");
    });
    test("拒绝缺导演、虚构证据与不足一秒镜头的超长口播", () => {
        const parse = (line: unknown) => parseReplicaScripts(JSON.stringify({ scripts: [{ lines: [line] }] }), [1], { model: "m", createdAt: "now", idPrefix: "s", directed: true, facts: ["一只手开盖"], seconds: new Map([[1, 0.5]]) });
        expect(() => parse({ ...shot, director: undefined })).toThrow();
        expect(() => parse({ ...shot, director: { ...shot.director, evidence: "保温24小时" } })).toThrow();
        expect(() => parse({ ...shot, dialogue: "五个字以上" })).toThrow();
        expect(readReplicaDirection({ ...DEFAULT_REPLICA_DIRECTION, camera: "teleport" })).toBeUndefined();
    });
    test("校核暴露缺少证明的镜头", () => {
        const findings = replicaDirectorReview({ ...plan, shots: [{ ...shot, director: { ...shot.director!, evidence: "" } }] }, new Map([[1, 2]]));
        expect(findings.some((finding) => finding.includes("缺少证明依据"))).toBe(true);
    });
});
