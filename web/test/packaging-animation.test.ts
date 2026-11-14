import { describe, expect, test } from "bun:test";
import { Box3, PerspectiveCamera, Vector3 } from "three";
import { packagingAnimationDuration, packagingAnimationPose, packagingMotionBounds } from "../src/lib/packaging/animation";
import { buildPackagingScene, packagingCamera } from "../src/lib/packaging/scene";
import { compilePackaging } from "../src/lib/packaging/geometry";
import { newPackagingDocument, type PackagingStructure } from "../src/lib/packaging/types";

describe("真实折叠动画取景", () => {
    test("8 秒时间轴先折叠再开合，首尾明确", () => {
        expect(packagingAnimationDuration).toBe(8);
        expect(packagingAnimationPose(0)).toEqual({ fold: 0, open: 0 });
        expect(packagingAnimationPose(2)).toEqual({ fold: 0.5, open: 0 });
        expect(packagingAnimationPose(4)).toEqual({ fold: 1, open: 0 });
        expect(packagingAnimationPose(6)).toEqual({ fold: 1, open: 0.5 });
        expect(packagingAnimationPose(8)).toEqual({ fold: 1, open: 1 });
    });
    for (const structure of ["tuck", "reverse-tuck", "mailer", "tray", "display", "lid-base", "drawer", "book", "double-door", "pillow", "pouch", "spout-pouch"] as PackagingStructure[]) {
        test(`${structure} 全过程进入相机画幅，边界测量恢复当前姿态`, () => {
            const doc = newPackagingDocument(
                {
                    id: structure,
                    name: "动画验收",
                    category: "折叠纸盒",
                    structure,
                    description: "",
                    enabled: true,
                    defaults: { length: 120, width: 60, height: 180, thickness: 0.45, bleed: 3, glue: 12, tab: 15, gap: 1, frontHeight: 30, windowWidth: 0, windowHeight: 0, inflation: 0.6, spoutRadius: 8 },
                },
                { id: "card", name: "白卡", color: "#ffffff", insideColor: "#eeeeee", thickness: 0.45, roughness: 0.65, metalness: 0, enabled: true },
            );
            const scene = buildPackagingScene(doc, compilePackaging(doc));
            const initial = new Box3().setFromObject(scene.root);
            const bounds = packagingMotionBounds(scene, doc.view.fold, doc.view.open);
            expect(new Box3().setFromObject(scene.root).equals(initial)).toBe(true);
            for (const aspect of [1, 0.7]) {
                const framing = packagingCamera(scene.root, aspect, "iso", bounds);
                const camera = new PerspectiveCamera(40, aspect, 0.01, 10000);
                camera.position.copy(framing.position);
                camera.lookAt(framing.center);
                camera.updateMatrixWorld(true);
                for (const seconds of [0, 1, 2, 3, 4, 5, 6, 7, 8]) {
                    const pose = packagingAnimationPose(seconds);
                    scene.apply(pose.fold, pose.open);
                    const box = new Box3().setFromObject(scene.root);
                    for (const x of [box.min.x, box.max.x])
                        for (const y of [box.min.y, box.max.y])
                            for (const z of [box.min.z, box.max.z]) {
                                const point = new Vector3(x, y, z).project(camera);
                                expect(Math.abs(point.x)).toBeLessThanOrEqual(1);
                                expect(Math.abs(point.y)).toBeLessThanOrEqual(1);
                            }
                }
            }
            scene.dispose();
        });
    }
});
