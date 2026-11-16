import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { cardPose, duration, layoutCards, packetPose } from "@/components/image-pack/motion-plan";
import { cardGeometry, packet, packetFrontGeometry } from "@/components/image-pack/motion-geometry";

const geometry = cardGeometry();
geometry.edge.computeBoundingBox();
const cardBounds = geometry.edge.boundingBox!.clone();
cardBounds.max.z = 0.007;

function bounds(layout: ReturnType<typeof layoutCards>, index: number, time: number) {
    const pose = cardPose(layout, index, time);
    const object = new THREE.Object3D();
    object.position.set(...pose.position);
    object.rotation.set(...pose.rotation);
    object.updateMatrixWorld();
    return cardBounds.clone().applyMatrix4(object.matrixWorld);
}

describe("图片开包逐帧边界", () => {
    test("1–8 张图片在桌面和窄屏的整个动画中都不裁切", () => {
        for (const [width, height] of [
            [280, 460],
            [320, 460],
            [350, 460],
            [584, 460],
            [704, 369],
            [952, 320],
            [1169, 360],
            [1800, 620],
        ]) {
            for (let count = 1; count <= 8; count++) {
                const layout = layoutCards(width, height, count);
                for (let frame = 0; frame <= 120; frame++) {
                    for (let index = 0; index < count; index++) {
                        const box = bounds(layout, index, frame / 30);
                        expect(box.min.x).toBeGreaterThan(-layout.worldWidth / 2 + 0.12);
                        expect(box.max.x).toBeLessThan(layout.worldWidth / 2 - 0.12);
                        expect(box.min.y).toBeGreaterThan(layout.centerY - layout.worldHeight / 2 + 0.12);
                        expect(box.max.y).toBeLessThan(layout.centerY + layout.worldHeight / 2 - 0.12);
                    }
                }
            }
        }
    });

    test("交错展开不穿模，结束后卡片稳定落到网格", () => {
        for (const [width, height] of [
            [320, 460],
            [704, 369],
            [1169, 360],
        ]) {
            for (let count = 2; count <= 8; count++) {
                const layout = layoutCards(width, height, count);
                for (let frame = 0; frame <= 120; frame++) {
                    const boxes = Array.from({ length: count }, (_, index) => bounds(layout, index, frame / 30));
                    for (let index = 0; index < count; index++) {
                        for (let next = index + 1; next < count; next++) expect(boxes[index].intersectsBox(boxes[next])).toBe(false);
                    }
                }
                expect(cardPose(layout, count - 1, duration).position).toEqual(layout.positions[count - 1]);
            }
        }
    });

    test("卡片从封口退出，离开包装前不穿过正面和侧壁", () => {
        const front = packetFrontGeometry();
        front.computeBoundingBox();
        expect(front.boundingBox!.min.z).toBeGreaterThanOrEqual(packet.frontZ - 1e-6);
        for (let count = 1; count <= 8; count++) {
            const layout = layoutCards(704, 369, count);
            for (let frame = 0; frame <= 38; frame++) {
                const time = frame / 30;
                const pose = packetPose(layout, time);
                for (let index = 0; index < count; index++) {
                    const box = bounds(layout, index, time);
                    if (pose.opacity === 0 || box.min.y > pose.y + packet.height / 2) continue;
                    expect(box.max.z).toBeLessThan(packet.frontZ);
                    expect(box.min.z).toBeGreaterThan(packet.backZ);
                    expect(box.min.x).toBeGreaterThan(-packet.width / 2 + 0.03);
                    expect(box.max.x).toBeLessThan(packet.width / 2 - 0.03);
                }
            }
            expect(bounds(layout, 0, 0.85).min.y).toBeGreaterThan(packetPose(layout, 0.85).y + packet.height / 2);
        }
        front.dispose();
    });

    test("动作不瞬移，也不突然缩放", () => {
        const layout = layoutCards(704, 369, 8);
        for (let index = 0; index < 8; index++) {
            for (let frame = 1; frame <= 6500; frame++) {
                const before = cardPose(layout, index, (frame - 1) / 2400);
                const after = cardPose(layout, index, frame / 2400);
                expect(Math.hypot(...after.position.map((value, axis) => value - before.position[axis]))).toBeLessThan(0.015);
                expect(after.scale).toBe(1);
            }
        }
    });
});
