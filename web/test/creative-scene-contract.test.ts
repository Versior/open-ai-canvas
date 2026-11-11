import { expect, test } from "bun:test";
import { createCreativeJob, creativeFactsInput, creativeReadyError } from "@/lib/remake/creative";

test("口播带货不能在没有人、没有声音时直接进入导演策划", () => {
    const job = createCreativeJob("scene_contract", { name: "眼镜", sellingPoints: "黑色镜框", images: [{ id: "p", resourceId: "product_image", name: "商品" }] });
    job.creative!.brief.scene = "selling";
    job.creative!.confirmedInput = creativeFactsInput(job);
    expect(creativeReadyError(job)).not.toBe("");
    job.people = "model";
    job.audio = "rewrite";
    job.models = [{ id: "pose", resourceId: "pose_image", name: "姿势", role: "pose" }];
    expect(creativeReadyError(job)).toContain("身份");
    job.models = [{ id: "face", resourceId: "face_image", name: "人物", role: "face" }];
    expect(creativeReadyError(job)).toBe("");
    job.audio = "mute";
    expect(creativeReadyError(job)).toContain("声音");
    job.audio = "rewrite";
    job.creative!.brief.seconds = 23;
    expect(creativeReadyError(job)).toBe("");
    job.creative!.brief.seconds = 3;
    expect(creativeReadyError(job)).toContain("片长");
});
