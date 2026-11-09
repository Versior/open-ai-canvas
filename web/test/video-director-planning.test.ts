import { expect, test } from "bun:test";
import { DEFAULT_REPLICA_CAMPAIGN, DEFAULT_REPLICA_DIRECTION, REPLICA_DIRECTOR_OPTIONS } from "@/lib/canvas/replica-director";
import { normalizeRemakeJob } from "@/lib/remake/job";
import { buildRemakeUnitPrompt } from "@/lib/remake/prompts";
import { applyRemakeDirectorPlan, buildRemakeDirectorPrompt, parseRemakeDirectorPlans, replicaProductFacts } from "@/lib/remake/director-plan";
import { directorJob, directorPlanOutput } from "./fixtures/video-director-data";
import { remakeJobError } from "@/lib/remake/job";
import { replicaScriptImageCount } from "@/pages/video-replication/replication-script";
import { defaultConfig } from "@/stores/use-config-store";

const job = normalizeRemakeJob({
    id: "synthetic-job",
    version: 2,
    source: { resourceId: "synthetic-source", durationMs: 6000 },
    product: { name: "儿童眼镜", sellingPoints: "柔软镜腿\n可调节鼻托" },
    campaign: DEFAULT_REPLICA_CAMPAIGN,
    shots: [{ index: 1, startMs: 0, endMs: 6000, treatment: "remake", director: { ...DEFAULT_REPLICA_DIRECTION, beat: "proof", action: "手指轻压镜腿，松开后镜腿复位", evidence: "柔软镜腿" } }],
})!;

test("director choices cover distinct publishing contexts and production methods", () => {
    expect(Object.keys(REPLICA_DIRECTOR_OPTIONS.platform).length).toBeGreaterThanOrEqual(8);
    expect(Object.keys(REPLICA_DIRECTOR_OPTIONS.style).length).toBeGreaterThanOrEqual(10);
});

test("proof and its source reach actual remake video generation", () => {
    const prompt = buildRemakeUnitPrompt(job, { treatment: "remake" } as Parameters<typeof buildRemakeUnitPrompt>[1], job.shots, 6);
    expect(prompt).toContain("证明依据：柔软镜腿");
});

test("planner attaches only the images explicitly supported by the selected model", () => {
    const textChannel = { id: "synthetic", name: "test", baseUrl: "https://example.invalid", apiKey: "", models: ["gpt-4o"] };
    expect(replicaScriptImageCount({ ...defaultConfig, channels: [textChannel] }, "synthetic::gpt-4o", 3)).toBe(0);
    const visionChannel = {
        ...textChannel,
        modelCosts: [{ model: "gpt-4o", capabilityConfig: { version: 1, text: { contextWindowTokens: 128000, maxOutputTokens: 12000, references: { promptMaxChars: 32000, maxImages: 1, maxImageBytes: 30000000, maxVideos: 0, maxVideoBytes: 0 } } } }],
    };
    expect(replicaScriptImageCount({ ...defaultConfig, channels: [visionChannel] }, "synthetic::gpt-4o", 3)).toBe(1);
    expect(buildRemakeDirectorPrompt(directorJob, 2, 1)).toContain("新商品实拍");
});

const parse = (output: unknown = directorPlanOutput, current = directorJob) => parseRemakeDirectorPlans(JSON.stringify({ plans: [output] }), current, { model: "synthetic-model", createdAt: "2026-11-09", idPrefix: "plan" });

test("a plan includes decisions, product evidence and shot actions, then survives storage and reaches generation", () => {
    const plans = parse();
    const source = { ...directorJob, directorPlans: plans };
    const selected = applyRemakeDirectorPlan(source, plans[0]);
    expect(selected.shots[0].director?.start).toBe("手持展开镜架");
    expect(selected.shots[1].director).toBeUndefined();
    expect(selected.shots[2]).toEqual(source.shots[2]);
    expect(selected.shots[3]).toEqual(source.shots[3]);
    const stored = normalizeRemakeJob(JSON.parse(JSON.stringify(selected)))!;
    expect(stored.directorPlans?.[0].strategy).toEqual(plans[0].strategy);
    expect(stored.activeDirectorPlanId).toBe(plans[0].id);
    expect(buildRemakeUnitPrompt(stored, { treatment: "remake" } as Parameters<typeof buildRemakeUnitPrompt>[1], [stored.shots[0]], 6)).toContain("不知道鼻托怎样调节");
    expect(buildRemakeUnitPrompt(stored, { treatment: "replace" } as Parameters<typeof buildRemakeUnitPrompt>[1], [stored.shots[1]], 6)).not.toContain("不知道鼻托怎样调节");
});

test("incomplete strategies, duplicate shots, invented proof and truncated actions are rejected", () => {
    expect(() => parse({ ...directorPlanOutput, strategy: undefined })).toThrow("导演策划不完整");
    expect(() => parse({ ...directorPlanOutput, strategy: { ...directorPlanOutput.strategy, missing: ["字".repeat(201)] } })).toThrow("导演策划不完整");
    expect(() => parse({ ...directorPlanOutput, lines: [directorPlanOutput.lines[0], directorPlanOutput.lines[0], directorPlanOutput.lines[2]] })).toThrow();
    const change = (patch: Record<string, unknown>) => ({ ...directorPlanOutput, lines: [{ ...directorPlanOutput.lines[0], director: { ...directorPlanOutput.lines[0].director, ...patch } }, ...directorPlanOutput.lines.slice(1)] });
    expect(() => parse(change({ evidence: "防蓝光99%" }))).toThrow();
    expect(() => parse(change({ start: "" }))).toThrow();
    expect(() => parse(change({ action: "字".repeat(301) }))).toThrow();
    expect(() => parse(change({ lighting: "字".repeat(201) }))).toThrow();
    expect(() => parse({ ...directorPlanOutput, lines: [directorPlanOutput.lines[0], { ...directorPlanOutput.lines[1], director: directorPlanOutput.lines[0].director }, directorPlanOutput.lines[2]] })).toThrow();
    expect(() => parse({ ...directorPlanOutput, lines: [{ ...directorPlanOutput.lines[0], dialogue: "字".repeat(25) }, ...directorPlanOutput.lines.slice(1)] })).toThrow();
    expect(() => parse(directorPlanOutput, { ...directorJob, campaign: { ...directorJob.campaign!, style: "studio" } })).toThrow();
});

test("strategy is tied to product and campaign, while source shot treatment remains fixed", () => {
    const plan = parse()[0];
    const selected = applyRemakeDirectorPlan({ ...directorJob, directorPlans: [plan] }, plan);
    const changed = { ...selected, product: { ...selected.product, name: "保温杯", sellingPoints: "12 小时保温" } };
    expect(() => applyRemakeDirectorPlan(changed, plan)).toThrow("重新策划");
    expect(remakeJobError(changed)).toContain("重新策划");
    expect(normalizeRemakeJob(changed)?.directorPlans?.[0].strategy).toEqual(plan.strategy);
    expect(() => applyRemakeDirectorPlan({ ...selected, sourceSummary: { ...selected.sourceSummary, hook: "新的原片解读" } }, plan)).toThrow("重新策划");
    expect(replicaProductFacts("12 小时保温\n1. 单手开盖\n- 双层杯壁")).toEqual(["12 小时保温", "单手开盖", "双层杯壁"]);
});

test("director prompt varies by audience and platform and explicitly protects replacement shots", () => {
    const child = buildRemakeDirectorPrompt(directorJob);
    const amazon = buildRemakeDirectorPrompt({ ...directorJob, product: { ...directorJob.product, name: "折叠支架", sellingPoints: "可折叠\n铝合金" }, campaign: { ...directorJob.campaign!, platform: "amazon", audience: "需要便携支架的办公用户" } });
    expect(child).toContain("为孩子挑眼镜的家长");
    expect(child).toContain("strategy");
    expect(child).toContain("不默认灰调");
    expect(child).toContain("replace 镜头保留原动作");
    expect(child).toContain("本请求不包含图片");
    expect(amazon).toContain("结构、操作、尺寸关系");
    expect(amazon).not.toEqual(child);
});
