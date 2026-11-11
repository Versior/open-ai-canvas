import { expect, test } from "bun:test";
import { applyReferenceReplicationPlan, buildReferenceReplicationPrompt, parseReferenceReplicationPlan, referenceAnalysisFrames, referenceReplicationError, setReferenceReplicationMode } from "@/lib/remake/reference-replication";
import { normalizeRemakeJob, remakeJobError } from "@/lib/remake/job";
import { buildRemakeUnitPrompt, remakeReferenceImages } from "@/lib/remake/prompts";
import { remakeContinuityInput, remakeContinuityMaterials } from "@/lib/remake/continuity";
import { remakeUnitsFor } from "@/pages/video-replication/remake/remake-runner";
import { remakeTimeline } from "@/lib/remake/timeline";
import { remakeComparison } from "@/lib/remake/comparison";
import { defaultConfig } from "@/stores/use-config-store";
import { referenceFixture, referencePlanOutput } from "./fixtures/reference-replication-data";

const meta = { id: "reference-plan", model: "vision-model", createdAt: "2026-01-01T00:00:00.000Z" };
function planned(style = false) {
    const job = referenceFixture(style ? "style" : "structure");
    job.replication!.plan = parseReferenceReplicationPlan(JSON.stringify(referencePlanOutput(style)), job, meta);
    return applyReferenceReplicationPlan(job);
}

test("结构复刻锁定叙事镜头顺序和区间，动作适配新商品", () => {
    const job = planned();
    expect(referenceReplicationError(job)).toBe("");
    expect(job.shots.map(({ index, startMs, endMs }) => [index, startMs, endMs])).toEqual([
        [1, 0, 4000],
        [2, 4000, 8000],
    ]);
    expect(job.shots[1].director?.action).toContain("木制扶手");
    const wrong = referencePlanOutput();
    wrong.shots[0].endMs = 3000;
    expect(() => parseReferenceReplicationPlan(JSON.stringify(wrong), referenceFixture(), meta)).toThrow("参考方案不完整");
    const reversed = referencePlanOutput();
    reversed.shots.reverse();
    expect(() => parseReferenceReplicationPlan(JSON.stringify(reversed), referenceFixture(), meta)).toThrow();
});

test("风格复刻重新组织分镜，拒绝漏段、重叠和错误总时长", () => {
    const job = planned(true);
    expect(job.shots).toHaveLength(3);
    expect(job.replication!.sourceShots).toHaveLength(2);
    expect(referenceReplicationError(job)).toBe("");
    for (const change of [(raw: ReturnType<typeof referencePlanOutput>) => raw.shots[1].startMs++, (raw: ReturnType<typeof referencePlanOutput>) => raw.shots[2].endMs--]) {
        const raw = referencePlanOutput(true);
        change(raw);
        expect(() => parseReferenceReplicationPlan(JSON.stringify(raw), referenceFixture("style"), meta)).toThrow();
    }
    expect(() => remakeComparison(job, "render")).toThrow("独立时间线");
    expect(() => remakeTimeline(job, { width: 720, height: 1280 }, true)).toThrow("先生成目标镜头");
});

test("分析对照关键帧与目标实拍，风格不能捏造声音或目标性能", () => {
    const job = referenceFixture();
    const prompt = buildReferenceReplicationPrompt(job, 2, 1);
    expect(prompt).toContain("附件图3至图3是目标主体实拍");
    expect(prompt).toContain("没有附音频");
    expect(prompt).toContain("图片不能证明性能");
    expect(referenceAnalysisFrames(job, 2).map((shot) => shot.index)).toEqual([1, 2]);
    const raw = referencePlanOutput();
    raw.shots[1].director.evidence = "经检测最舒适";
    expect(() => parseReferenceReplicationPlan(JSON.stringify(raw), job, meta)).toThrow();
    raw.shots[1].director.evidence = "木制扶手";
    raw.style.palette = "";
    expect(() => parseReferenceReplicationPlan(JSON.stringify(raw), job, meta)).toThrow();
});

test("两种新模式按单镜生成，不提交原片视频或原人物关键帧", () => {
    for (const style of [false, true]) {
        const job = planned(style);
        const units = remakeUnitsFor(job, defaultConfig);
        expect(units).toHaveLength(job.shots.length);
        expect(units.every((unit) => unit.treatment === "remake" && !unit.clipResourceId)).toBe(true);
        const prompt = buildRemakeUnitPrompt(job, units[0], [job.shots[0]], 4);
        expect(prompt).not.toContain("@视频");
        expect(prompt).toContain("全片风格合同");
        expect(remakeReferenceImages(job).images.map((image) => image.resourceId)).toEqual(["target-product"]);
        expect(remakeContinuityMaterials(job).images.map((image) => image.resourceId)).toEqual(["target-product"]);
        expect(() => buildRemakeUnitPrompt(job, { ...units[0], treatment: "replace" }, job.shots, 4)).toThrow("不向视频模型提交");
    }
});

test("修改主体、风格和语言使方案失效，旧方案仍可保存回查", () => {
    const job = planned();
    const before = remakeContinuityInput(job);
    job.product.name = "另一把椅子";
    expect(referenceReplicationError(job)).toContain("资料");
    expect(() => applyReferenceReplicationPlan(job)).toThrow("资料");
    const restored = normalizeRemakeJob(JSON.parse(JSON.stringify(job)));
    expect(restored?.replication?.plan?.title).toBe(job.replication!.plan!.title);
    expect(referenceReplicationError(restored!)).toContain("资料");
    const styled = planned(true);
    styled.replication!.plan!.style.lighting = "明亮顶光";
    expect(remakeContinuityInput(styled)).not.toBe(before);
});

test("未应用方案、非法做法和原声口型不能开始生成", () => {
    expect(remakeJobError(referenceFixture())).toContain("规划并应用");
    const job = planned();
    job.shots[0].treatment = "replace";
    expect(referenceReplicationError(job)).toContain("重新生成");
    job.shots[0].treatment = "remake";
    job.audio = "original";
    expect(remakeJobError(job)).toContain("原声口型");
});

test("方案往返保存保留原镜头与新镜头，损坏合同拒绝加载", () => {
    const job = planned(true);
    const restored = normalizeRemakeJob(JSON.parse(JSON.stringify(job)))!;
    expect(restored.replication?.plan?.shots).toHaveLength(3);
    expect(restored.replication?.sourceShots).toHaveLength(2);
    expect(referenceReplicationError(restored)).toBe("");
    const raw = JSON.parse(JSON.stringify(job));
    raw.replication.plan.shots[0].director.action = "";
    expect(normalizeRemakeJob(raw)).toBeUndefined();
    for (const change of [
        (value: typeof raw) => (value.replication.sourceShots[0].risks = null),
        (value: typeof raw) => (value.replication.sourceShots[1].index = 1),
        (value: typeof raw) => (value.replication.plan.input = JSON.stringify({ mode: "style", sourceShots: [{}] })),
    ]) {
        const broken = JSON.parse(JSON.stringify(job));
        change(broken);
        expect(normalizeRemakeJob(broken)).toBeUndefined();
    }
});

test("模式切换恢复原片拆解，不能覆盖尚未结束的任务", () => {
    const job = planned(true);
    const back = setReferenceReplicationMode(job, "elements");
    expect(back.replication).toBeUndefined();
    expect(back.shots).toHaveLength(2);
    expect(job.shots).toHaveLength(3);
    job.units = [{ key: "task", treatment: "remake", shotIndexes: [1], startMs: 0, endMs: 4000, clipStartMs: 0, clipEndMs: 4000, status: "running", attempt: 1, taskId: "pending-task", chosen: 0, takes: [] }];
    expect(() => setReferenceReplicationMode(job, "structure")).toThrow("先恢复");
});
