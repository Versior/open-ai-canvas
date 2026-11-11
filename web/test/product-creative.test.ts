import { expect, test } from "bun:test";
import {
    applyCreativePlan,
    buildCreativePlanPrompt,
    buildCreativeAnalysisPrompt,
    CREATIVE_SCENES,
    CREATIVE_TONES,
    topicTones,
    creativeFactsInput,
    creativePlanInput,
    creativeProductionError,
    parseCreativeAnalysis,
    parseCreativePlans,
    isCommercialCreativeScene,
} from "@/lib/remake/creative";
import { duplicateRemakeJob, normalizeRemakeJob, remakeJobError } from "@/lib/remake/job";
import { createRemakeEditTimeline } from "@/lib/remake/editor";
import { buildRemakeUnitPrompt } from "@/lib/remake/prompts";
import { applyRemakeCreativeSignature, planRemakeUnits } from "@/lib/remake/units";
import { remakeRenderSize, remakeTimeline } from "@/lib/remake/timeline";
import { setStudioPromptOverrides } from "@/lib/ecommerce-studio/prompt-overrides";
import { studioPromptGroups } from "@/lib/ecommerce-studio/prompt-registry";
import { creativeFixture, creativePlanResponse } from "./fixtures/product-creative";

function planned() {
    const job = creativeFixture();
    const plans = parseCreativePlans(JSON.stringify(creativePlanResponse()), job, "plan_test", 2);
    job.creative!.plans = plans;
    return applyCreativePlan(job, plans[0]);
}
test("六个方向和热点随作品保存，切换选题使旧策划失效", () => {
    const job = creativeFixture();
    job.creative!.brief = { ...job.creative!.brief, scene: "documentary", tone: "documentary", topic: { source: "baidu", title: "工艺记录", url: "https://www.baidu.com/s?wd=test", fetchedAt: "2026-11-10T00:00:00Z" } };
    job.people = "model";
    job.models = [{ id: "person", resourceId: "person_image", name: "主角", role: "figure" }];
    const response = creativePlanResponse();
    const six = Array.from({ length: 6 }, (_, index) => ({ ...structuredClone(response.plans[0]), title: `方向${index + 1}` }));
    job.creative!.plans = parseCreativePlans(JSON.stringify({ plans: six }), job, "six", 6);
    const chosen = applyCreativePlan(job, job.creative!.plans[0]);
    expect(normalizeRemakeJob(JSON.parse(JSON.stringify(chosen)))?.creative?.plans).toHaveLength(6);
    expect(buildCreativePlanPrompt(chosen, 6)).toContain("工艺记录");
    expect(buildCreativePlanPrompt(chosen, 6)).toContain("不默认促购");
    expect(buildCreativeAnalysisPrompt(chosen)).toContain("主体参考图");
    expect(isCommercialCreativeScene("documentary")).toBe(false);
    expect(isCommercialCreativeScene("selling")).toBe(true);
    const old = creativePlanInput(chosen);
    chosen.creative!.brief.topic!.title = "自然观察";
    expect(creativePlanInput(chosen)).not.toBe(old);
    chosen.creative!.brief.topic!.url = "https://example.com/trend";
    expect(normalizeRemakeJob(chosen)).toBeUndefined();
    for (const tone of topicTones("美食水果")) expect(CREATIVE_TONES[tone]).toBeDefined();
});
test("业务热点来源进入作品并在刷新后恢复", () => {
    for (const source of ["douhot", "qianchuan", "oceanengine"] as const) {
        const job = creativeFixture();
        job.creative!.brief.topic = { source, title: "示例使用教程", url: "https://www.douyin.com/video/123", fetchedAt: "2026-11-10T00:00:00Z" };
        expect(normalizeRemakeJob(JSON.parse(JSON.stringify(job)))?.creative?.brief.topic?.source).toBe(source);
    }
});
test("无原视频的新作品完整保存、确认、选用与恢复", () => {
    const job = planned();
    expect(job.source).toBeUndefined();
    expect(normalizeRemakeJob(JSON.parse(JSON.stringify(job)))?.creative?.plans).toHaveLength(2);
    expect(remakeJobError(job)).toBe("");
    job.product.images[0].resourceId = "changed_image";
    expect(remakeJobError(job)).toContain("重新确认");
    job.creative!.confirmedInput = creativeFactsInput(job);
    expect(remakeJobError(job)).toContain("重新策划");
});
test("已保存的错误口播配置仍可查看，新策划与生成继续强校验", () => {
    const job = planned();
    job.creative!.brief.scene = "selling";
    for (const plan of job.creative!.plans) plan.input = creativePlanInput(job);
    const restored = normalizeRemakeJob(JSON.parse(JSON.stringify(job)));
    expect(restored?.creative?.plans).toHaveLength(2);
    expect(creativeProductionError(restored!)).toContain("人物");
    job.people = "model";
    job.models = [{ id: "person", resourceId: "person_image", name: "人物", role: "face" }];
    job.audio = "rewrite";
    for (const plan of job.creative!.plans) plan.input = creativePlanInput(job);
    expect(creativeProductionError(job)).toContain("说话镜头");
    expect(() => parseCreativePlans(JSON.stringify(creativePlanResponse()), job, "new_selling", 2)).toThrow();
    const response = creativePlanResponse();
    for (const plan of response.plans) {
        plan.shots[0].speaker = true;
        plan.shots[0].dialogue = "看看这只杯子";
    }
    expect(parseCreativePlans(JSON.stringify(response), job, "new_selling", 2)).toHaveLength(2);
});
test("全部内容类型与后台覆盖进入整片及镜头提示词", () => {
    const job = planned();
    for (const scene of CREATIVE_SCENES) {
        job.creative!.brief.scene = scene.id;
        expect(buildCreativePlanPrompt(job, 2)).toContain(scene.name);
        const unit = planRemakeUnits(job.shots, { maxMs: 4000, sourceDurationMs: 8000 })[0];
        expect(buildRemakeUnitPrompt(job, unit, [job.shots[0]], 4)).toContain(scene.name);
    }
    setStudioPromptOverrides({ "video.scene.selling": "测试后台策划规则" });
    job.creative!.brief.scene = "selling";
    expect(buildCreativePlanPrompt(job, 2)).toContain("测试后台策划规则");
    expect(studioPromptGroups().find((group) => group.id === "video.scene")?.entries).toHaveLength(CREATIVE_SCENES.length);
    setStudioPromptOverrides({});
});
test("拒绝超长台词、乱序镜头、假证明与不完整导演动作", () => {
    for (const mutate of [
        (raw: ReturnType<typeof creativePlanResponse>) => {
            raw.plans[0].shots[0].endMs = 3500;
        },
        (raw: ReturnType<typeof creativePlanResponse>) => {
            raw.plans[0].shots[0].dialogue = "不是静音";
        },
        (raw: ReturnType<typeof creativePlanResponse>) => {
            raw.plans[0].shots[0].director.evidence = "保温24小时";
        },
        (raw: ReturnType<typeof creativePlanResponse>) => {
            raw.plans[0].shots[0].director.start = "";
        },
    ]) {
        const raw = creativePlanResponse();
        mutate(raw);
        expect(() => parseCreativePlans(JSON.stringify(raw), creativeFixture(), "plan_test", 2)).toThrow();
    }
    const voiced = creativeFixture();
    voiced.audio = "voice";
    const raw = creativePlanResponse();
    raw.plans[0].shots[0].dialogue = "字".repeat(17);
    expect(() => parseCreativePlans(JSON.stringify(raw), voiced, "plan_test", 2)).toThrow();
});
test("分析区分观察与待补资料，损坏数据拒绝恢复", () => {
    expect(parseCreativeAnalysis('{"observation":"蓝色杯身","missing":["请补充尺寸"]}', "input").missing).toEqual(["请补充尺寸"]);
    expect(() => parseCreativeAnalysis('{"observation":true}', "input")).toThrow();
    const job = planned();
    job.creative!.plans[0].shots[0].endMs = 3500;
    expect(normalizeRemakeJob(job)).toBeUndefined();
    const bad = planned();
    bad.units = [{ ...planRemakeUnits(bad.shots, { maxMs: 4000, sourceDurationMs: 8000 })[0], input: { model: "v", ratio: "9:16", resolution: "720p", seconds: 4, audio: "mute", prompt: "", imageResourceIds: ["product_image"] } }];
    expect(normalizeRemakeJob(bad)).toBeUndefined();
});
test("新创作剪辑不能用不存在的原片占位，成功候选可生成真实时间线", () => {
    const job = planned();
    job.units = planRemakeUnits(job.shots, { maxMs: 4000, sourceDurationMs: 8000 });
    expect(() => createRemakeEditTimeline(job)).toThrow("先生成镜头");
    job.units = job.units.map((unit, index) => ({ ...unit, status: "succeeded", takes: [{ taskId: `task_${index}`, resourceId: `video_${index}`, createdAt: "", width: 720, height: 1280, durationMs: 4000 }] }));
    expect(
        remakeTimeline(job, remakeRenderSize(job))
            .clips.filter((clip) => clip.kind === "video")
            .map((clip) => clip.directMedia?.id),
    ).toEqual(["video_0", "video_1"]);
    expect(createRemakeEditTimeline(job).durationMs).toBe(8000);
});
test("输入变化阻止执行旧方案，台词逐镜可改但须在预算内", () => {
    const job = planned();
    job.shots[0].dialogue = "字".repeat(17);
    job.audio = "voice";
    job.voice.model = "audio-model";
    expect(remakeJobError(job)).toContain("重新策划");
    job.creative!.plans[0].input = creativePlanInput(job);
    job.voice.model = "voice-model";
    expect(remakeJobError(job)).toContain("台词超过");
    job.shots[0].treatment = "keep";
    expect(remakeJobError(job)).toContain("不能引用原片");
});
test("换商品清除旧脚本，冻结请求未确认时禁止覆盖或重做", () => {
    const job = planned();
    expect(duplicateRemakeJob(job, "copy_test", { title: "新商品", product: { name: "另一个杯子", sellingPoints: "", images: [] } }).shots).toEqual([]);
    const signed = applyRemakeCreativeSignature(job, planRemakeUnits(job.shots, { maxMs: 4000, sourceDurationMs: 8000 }));
    signed[0].input = { model: job.model, ratio: "9:16", resolution: "720p", seconds: 4, audio: "mute", prompt: "冻结输入", imageResourceIds: ["product_image"] };
    signed[0].status = "failed";
    job.note = "改变要求";
    expect(() => applyRemakeCreativeSignature(job, signed)).toThrow("尚未确认结束");
});
test("损坏任务状态、冻结策略及当前镜头不能被默认值修成可执行作品", () => {
    for (const mutate of [
        (job: ReturnType<typeof planned>) => {
            job.shots[0].startMs = 1;
        },
        (job: ReturnType<typeof planned>) => {
            job.shots[0].treatment = "keep";
        },
        (job: ReturnType<typeof planned>) => {
            job.creative!.activePlanId = "missing_plan";
        },
        (job: ReturnType<typeof planned>) => {
            const snapshot = JSON.parse(job.creative!.plans[0].input);
            snapshot[1].scene = "invented";
            job.creative!.plans[0].input = JSON.stringify(snapshot);
        },
        (job: ReturnType<typeof planned>) => {
            const snapshot = JSON.parse(job.creative!.plans[0].input);
            snapshot[2].style = "studio";
            job.creative!.plans[0].input = JSON.stringify(snapshot);
        },
    ]) {
        const job = planned();
        mutate(job);
        expect(normalizeRemakeJob(job)).toBeUndefined();
    }
    const original = planned();
    original.creative!.run = { id: "creative_run", kind: "plan", input: creativePlanInput(original), prompt: "策划", model: "text", imageResourceIds: ["product_image"], count: 2, status: "running", settled: false };
    for (const patch of [{ settled: "true" }, { taskId: 12 }, { imageResourceIds: ["invalid/image"] }, { status: "succeeded", settled: true }]) {
        const job = structuredClone(original);
        Object.assign(job.creative!.run!, patch);
        expect(normalizeRemakeJob(job)).toBeUndefined();
    }
    const skipped = planned();
    skipped.shots[0].treatment = "skip";
    expect(normalizeRemakeJob(skipped)?.shots[0].treatment).toBe("skip");
});
