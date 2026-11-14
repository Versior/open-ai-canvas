import { Box3 } from "three";
import type { PackagingScene } from "./scene";

export const packagingAnimationDuration = 8;

export function packagingAnimationPose(seconds: number) {
    return { fold: Math.min(1, Math.max(0, seconds / 4)), open: Math.min(1, Math.max(0, (seconds - 4) / 4)) };
}

export function packagingMotionBounds(scene: PackagingScene, fold: number, open: number) {
    const bounds = new Box3();
    for (let frame = 0; frame <= 40; frame++) {
        const pose = packagingAnimationPose((frame / 40) * packagingAnimationDuration);
        scene.apply(pose.fold, pose.open);
        bounds.union(new Box3().setFromObject(scene.root));
    }
    scene.apply(fold, open);
    return bounds;
}
