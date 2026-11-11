import { createCreativeJob, creativeFactsInput } from "@/lib/remake/creative";
import { DEFAULT_REPLICA_DIRECTION } from "@/lib/canvas/replica-director";

export function creativeFixture() {
    const job = createCreativeJob("creative_test", { name: "测试杯", sellingPoints: "容量500ml\n蓝色杯身", images: [{ id: "photo", resourceId: "product_image", name: "测试商品" }] });
    job.model = "video-model";
    job.creative!.brief.seconds = 8;
    job.creative!.confirmedInput = creativeFactsInput(job);
    return job;
}
export function creativePlanResponse() {
    const strategy = {
        audience: "通勤人群",
        insight: "想看清用法",
        proposition: "清楚展示商品",
        hook: "拿起杯子",
        method: "demo",
        narrative: "howto",
        rationale: "商品操作清楚",
        visual: "蓝色杯身与自然光",
        sound: "轻微环境声",
        cta: "了解适用条件",
        missing: [],
    };
    const shots = [0, 1].map((index) => ({
        index: index + 1,
        startMs: index * 4000,
        endMs: (index + 1) * 4000,
        plot: index ? "手拿起杯子" : "杯子摆在桌上",
        dialogue: "",
        speaker: false,
        onScreenText: "",
        director: { ...DEFAULT_REPLICA_DIRECTION, purpose: "展示商品", action: "拿起杯子", start: "杯子静置", end: "杯子离开桌面", lighting: "窗边自然光" },
    }));
    return {
        plans: [
            { title: "操作说明", strategy, shots },
            { title: "生活场景", strategy: { ...strategy, hook: "桌上杯子", rationale: "从使用情境切入" }, shots },
        ],
    };
}
