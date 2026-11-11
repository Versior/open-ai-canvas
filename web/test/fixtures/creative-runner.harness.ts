import { expect, test } from "bun:test";
import { executeCreativeRun, creativeRunDependencies } from "@/pages/video-replication/remake/creative-runner";
import { createModelChannel, defaultConfig, encodeChannelModel } from "@/stores/use-config-store";
import { defaultModelCapabilityConfig } from "@/lib/model-capabilities";
import { useUserStore } from "@/stores/use-user-store";
import { setActiveUserScope } from "@/lib/user-scope";
import { creativeFixture, creativePlanResponse } from "./product-creative";
import type { RemakeJob } from "@/lib/remake/job";
import type { GenerationTask } from "@/services/api/task-center";
setActiveUserScope("creative-unit-test");
useUserStore.setState((state) => ({ features: { ...state.features, customChannelsEnabled: true } }));
const channel = createModelChannel({ id: "test-text", name: "测试", interfaceType: "openai", baseUrl: "/api", apiKey: "", models: ["gpt-4o"] });
const capabilityConfig = defaultModelCapabilityConfig("openai", "gpt-4o");
capabilityConfig.text!.references.maxImages = 4;
channel.modelCosts = [{ model: "gpt-4o", capabilityConfig }];
const model = encodeChannelModel(channel.id, "gpt-4o");
const config = { ...defaultConfig, channels: [channel], textModel: model };
const done = { id: "task_test", status: "succeeded", resultJson: JSON.stringify({ text: JSON.stringify(creativePlanResponse()) }) } as GenerationTask;
function fixture() {
    let job = creativeFixture();
    const calls: string[] = [],
        inputs: Parameters<typeof creativeRunDependencies.submit>[0][] = [];
    const deps = {
        ...creativeRunDependencies,
        read: () => job,
        save: async (_id: string, update: (value: RemakeJob) => RemakeJob) => {
            calls.push("save");
            job = { ...update(job), revision: job.revision + 1 };
        },
        query: async () => {
            calls.push("query");
            return done;
        },
        wait: async () => done,
        submit: async (input: Parameters<typeof creativeRunDependencies.submit>[0]) => {
            calls.push("submit");
            inputs.push(input);
            return done;
        },
    };
    return { deps, calls, inputs, job: () => job };
}
test("首次策划包含人物和场景参考，模型容量不足时不提交", async () => {
    const f = fixture();
    await f.deps.save("creative_test", (job) => ({ ...job, people: "model", models: [{ id: "person", resourceId: "person_image", name: "人物", role: "figure" }], backgrounds: [{ id: "scene", resourceId: "scene_image", name: "场景" }] }));
    await executeCreativeRun("creative_test", config, new AbortController().signal, { kind: "plan", model, count: 2 }, f.deps);
    expect(f.inputs[0].referenceImages?.map((image) => image.id)).toEqual(["product_image", "person_image", "scene_image"]);
    const blocked = fixture();
    await blocked.deps.save("creative_test", (job) => ({ ...job, backgrounds: Array.from({ length: 4 }, (_, index) => ({ id: `s${index}`, resourceId: `scene_${index}`, name: "场景" })) }));
    await expect(executeCreativeRun("creative_test", config, new AbortController().signal, { kind: "plan", model, count: 2 }, blocked.deps)).rejects.toThrow("无法接收全部");
    expect(blocked.inputs).toHaveLength(0);
});
test("提交前服务端确认，响应丢失恢复沿用操作编号、提示词和参考图", async () => {
    const f = fixture();
    let fail = true;
    const submit = f.deps.submit;
    f.deps.submit = async (input) => {
        const task = await submit(input);
        if (fail) {
            fail = false;
            throw new Error("响应丢失");
        }
        return task;
    };
    await expect(executeCreativeRun("creative_test", config, new AbortController().signal, { kind: "plan", model, count: 2 }, f.deps)).rejects.toThrow("响应丢失");
    expect(f.calls.indexOf("save")).toBeLessThan(f.calls.indexOf("submit"));
    expect(f.job().creative!.run!.settled).toBe(false);
    await executeCreativeRun("creative_test", config, new AbortController().signal, undefined, f.deps);
    expect(f.inputs[1].clientOperationId).toBe(f.inputs[0].clientOperationId);
    expect(f.inputs[1].prompt).toBe(f.inputs[0].prompt);
    expect(f.inputs[1].referenceImages).toEqual(f.inputs[0].referenceImages);
    expect(f.job().creative!.plans).toHaveLength(2);
    expect(f.job().creative!.run!.status).toBe("succeeded");
});
test("已有任务先查询，保存失败不能先消费模型", async () => {
    const f = fixture();
    f.deps.save = async () => {
        throw new Error("保存失败");
    };
    await expect(executeCreativeRun("creative_test", config, new AbortController().signal, { kind: "plan", model, count: 2 }, f.deps)).rejects.toThrow("保存失败");
    expect(f.inputs).toHaveLength(0);
    const g = fixture();
    let stopped = true;
    g.deps.wait = async () => {
        if (stopped) {
            stopped = false;
            throw new Error("等待中断");
        }
        return done;
    };
    await expect(executeCreativeRun("creative_test", config, new AbortController().signal, { kind: "plan", model, count: 2 }, g.deps)).rejects.toThrow();
    await executeCreativeRun("creative_test", config, new AbortController().signal, undefined, g.deps);
    expect(g.inputs).toHaveLength(1);
    expect(g.calls).toContain("query");
});
test("旧请求不能覆盖改变后的商品和其他窗口的新任务", async () => {
    const f = fixture();
    f.deps.wait = async () => {
        await f.deps.save("creative_test", (job) => ({ ...job, note: "新要求" }));
        return done;
    };
    await expect(executeCreativeRun("creative_test", config, new AbortController().signal, { kind: "plan", model, count: 2 }, f.deps)).rejects.toThrow("旧任务结果未应用");
    expect(f.job().creative!.plans).toHaveLength(0);
    expect(f.job().note).toBe("新要求");
});
test("结果保存发生CAS重放时再次拒绝已改变的输入", async () => {
    const f = fixture();
    const save = f.deps.save;
    f.deps.save = async (id, update) => {
        const preview = update(f.job());
        if (preview.creative?.run?.status === "succeeded") await save(id, (job) => ({ ...job, note: "另一窗口刚保存的新要求" }));
        await save(id, update);
    };
    await expect(executeCreativeRun("creative_test", config, new AbortController().signal, { kind: "plan", model, count: 2 }, f.deps)).rejects.toThrow("旧任务结果未应用");
    expect(f.job().creative!.plans).toHaveLength(0);
    expect(f.job().note).toBe("另一窗口刚保存的新要求");
});
