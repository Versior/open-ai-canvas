import { DEFAULT_REPLICA_CAMPAIGN, DEFAULT_REPLICA_DIRECTION } from "@/lib/canvas/replica-director";
import { normalizeRemakeJob } from "@/lib/remake/job";

export const directorJob = normalizeRemakeJob({
    id: "synthetic-job",
    version: 2,
    authorized: true,
    source: { resourceId: "synthetic-source", durationMs: 24000, width: 1080, height: 1920, hasAudio: true },
    product: { name: "儿童眼镜", sellingPoints: "柔软镜腿\n可调节鼻托", images: [{ id: "synthetic-product", resourceId: "synthetic-product", name: "test" }] },
    campaign: { ...DEFAULT_REPLICA_CAMPAIGN, audience: "为孩子挑眼镜的家长", focus: "如何调节鼻托" },
    model: "synthetic-video",
    audio: "rewrite",
    people: "none",
    shots: ["remake", "replace", "keep", "skip"].map((treatment, index) => ({
        index: index + 1,
        startMs: index * 6000,
        endMs: (index + 1) * 6000,
        treatment,
        plot: "手拿商品，展示可调整的部件",
        originalDialogue: "看清怎样操作",
        dialogue: "原来的新口播",
    })),
})!;

export const directorPlanOutput = {
    angle: "佩戴步骤",
    strategy: {
        audience: "为孩子挑眼镜的家长",
        insight: "不知道鼻托怎样调节",
        proposition: "可调节鼻托",
        hook: "手指展示调节前后的鼻托位置",
        method: "tutorial",
        narrative: "howto",
        rationale: "家长需要看清操作过程，沿用原片的三镜时长，重拍鼻托步骤而不照搬原产品功能",
        visual: "浅暖色生活环境与真实镜架颜色，柔和侧光便于看清鼻托",
        sound: "克制环境声与操作说明，口播服从所选音频设置",
        cta: "按实际尺寸选择，核对佩戴感受",
        missing: ["具体尺寸与适用年龄待补"],
    },
    lines: [1, 2, 3].map((shotNumber) => ({
        shotNumber,
        dialogue: "看看怎样调",
        onScreenText: "调节步骤",
        ...(shotNumber === 1
            ? {
                  director: {
                      ...DEFAULT_REPLICA_DIRECTION,
                      beat: "proof",
                      purpose: "看清镜腿与手部接触",
                      start: "手持展开镜架",
                      action: "手指轻压镜腿后松开",
                      end: "镜腿回到原位置",
                      lighting: "浅暖色侧光，商品颜色保持",
                      evidence: "柔软镜腿",
                      sound: "轻微接触声",
                  },
              }
            : {}),
    })),
};
