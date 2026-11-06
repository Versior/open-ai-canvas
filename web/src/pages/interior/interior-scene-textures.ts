import { CanvasTexture, RepeatWrapping, SRGBColorSpace, type Texture } from "three";
import type { SceneTexture } from "@/lib/interior/scene-3d";

/** 每种纹理铺一张图对应多少米（几何体的 UV 按米算）。grain 木纹、weave 布纹、marble 石纹用在家具和台面上。 */
export const TEXTURE_TILE: Record<SceneTexture, number> = { planks: 1.6, tiles: 1.2, roof: 2, grass: 4, paving: 1.8, brick: 1.2, stone: 2.4, grain: 0.9, weave: 0.35, marble: 1.6 };

const SIZE = 512;

/** 固定种子的伪随机数：每次打开纹理都一样。 */
function random(seed: number) {
    let value = seed;
    return () => {
        value = (value * 1664525 + 1013904223) % 4294967296;
        return value / 4294967296;
    };
}

function gray(level: number) {
    const value = Math.round(Math.min(255, Math.max(0, level)));
    return `rgb(${value},${value},${value})`;
}

/** 纹理都是接近白色的灰度图，和材质颜色相乘：颜色由方案决定，纹理只加木纹、砖缝这些细节。 */
function draw(kind: SceneTexture, context: CanvasRenderingContext2D) {
    const next = random(kind.length * 97 + 13);
    context.fillStyle = gray(236);
    context.fillRect(0, 0, SIZE, SIZE);
    if (kind === "planks") {
        const rows = 8;
        const height = SIZE / rows;
        for (let row = 0; row < rows; row += 1) {
            let x = -next() * SIZE * 0.5;
            while (x < SIZE) {
                const length = SIZE * (0.35 + next() * 0.45);
                context.fillStyle = gray(222 + next() * 30);
                context.fillRect(x, row * height, length, height);
                for (let line = 0; line < 5; line += 1) {
                    context.strokeStyle = gray(205 + next() * 20);
                    context.lineWidth = 1;
                    const y = row * height + next() * height;
                    context.beginPath();
                    context.moveTo(x, y);
                    context.bezierCurveTo(x + length * 0.3, y + (next() - 0.5) * 6, x + length * 0.7, y + (next() - 0.5) * 6, x + length, y);
                    context.stroke();
                }
                context.fillStyle = gray(170);
                context.fillRect(x, row * height, 2, height);
                x += length;
            }
            context.fillStyle = gray(165);
            context.fillRect(0, row * height, SIZE, 2);
        }
        return;
    }
    if (kind === "tiles" || kind === "paving") {
        const count = kind === "tiles" ? 2 : 3;
        const cell = SIZE / count;
        for (let row = 0; row < count * (kind === "paving" ? 2 : 1); row += 1) {
            const height = kind === "paving" ? cell / 2 : cell;
            const shift = kind === "paving" && row % 2 ? cell / 2 : 0;
            for (let column = -1; column <= count; column += 1) {
                context.fillStyle = gray(kind === "tiles" ? 236 + next() * 14 : 214 + next() * 30);
                context.fillRect(column * cell + shift, row * height, cell, height);
                context.strokeStyle = gray(kind === "tiles" ? 188 : 160);
                context.lineWidth = kind === "tiles" ? 3 : 4;
                context.strokeRect(column * cell + shift, row * height, cell, height);
            }
        }
        return;
    }
    if (kind === "roof") {
        const rows = 10;
        const height = SIZE / rows;
        for (let row = 0; row < rows; row += 1) {
            const gradient = context.createLinearGradient(0, row * height, 0, (row + 1) * height);
            gradient.addColorStop(0, gray(245));
            gradient.addColorStop(1, gray(190));
            context.fillStyle = gradient;
            context.fillRect(0, row * height, SIZE, height);
            const width = SIZE / 8;
            for (let column = 0; column <= 8; column += 1) {
                context.fillStyle = gray(175);
                context.fillRect(column * width + (row % 2 ? width / 2 : 0), row * height, 2, height);
            }
        }
        return;
    }
    if (kind === "grass") {
        for (let index = 0; index < 9000; index += 1) {
            context.fillStyle = gray(next() > 0.5 ? 250 : 200 + next() * 30);
            context.fillRect(next() * SIZE, next() * SIZE, 2 + next() * 3, 2 + next() * 4);
        }
        return;
    }
    if (kind === "brick") {
        const rows = 16;
        const height = SIZE / rows;
        const width = SIZE / 5;
        context.fillStyle = gray(250);
        context.fillRect(0, 0, SIZE, SIZE);
        for (let row = 0; row < rows; row += 1) {
            for (let column = -1; column <= 5; column += 1) {
                context.fillStyle = gray(200 + next() * 45);
                context.fillRect(column * width + (row % 2 ? width / 2 : 0) + 2, row * height + 2, width - 4, height - 4);
            }
        }
        return;
    }
    if (kind === "grain") {
        // 木纹：细密的顺纹线条，偶尔一个疤。
        for (let line = 0; line < 120; line += 1) {
            const y = next() * SIZE;
            context.strokeStyle = gray(212 + next() * 26);
            context.lineWidth = 0.6 + next() * 1.6;
            context.beginPath();
            context.moveTo(0, y);
            for (let x = 0; x <= SIZE; x += 32) context.lineTo(x, y + Math.sin((x / SIZE) * Math.PI * 2 * (1 + next())) * 3);
            context.stroke();
        }
        for (let knot = 0; knot < 3; knot += 1) {
            context.strokeStyle = gray(196);
            context.lineWidth = 1;
            const x = next() * SIZE;
            const y = next() * SIZE;
            for (let ring = 1; ring < 5; ring += 1) {
                context.beginPath();
                context.ellipse(x, y, ring * 5, ring * 2, 0, 0, Math.PI * 2);
                context.stroke();
            }
        }
        return;
    }
    if (kind === "weave") {
        // 布纹：经纬交错的细格，加一点随机明暗。
        for (let index = 0; index < SIZE; index += 4) {
            context.fillStyle = gray(228 + next() * 12);
            context.fillRect(0, index, SIZE, 2);
            context.fillStyle = gray(226 + next() * 12);
            context.fillRect(index, 0, 2, SIZE);
        }
        for (let index = 0; index < 2400; index += 1) {
            context.fillStyle = gray(next() > 0.5 ? 246 : 222);
            context.fillRect(next() * SIZE, next() * SIZE, 1, 1);
        }
        return;
    }
    if (kind === "marble") {
        // 石纹：几条弯曲的灰色纹路，粗细不一。
        for (let vein = 0; vein < 9; vein += 1) {
            context.strokeStyle = gray(190 + next() * 35);
            context.lineWidth = 0.8 + next() * 2.4;
            context.beginPath();
            let x = next() * SIZE;
            let y = 0;
            context.moveTo(x, y);
            while (y < SIZE) {
                x += (next() - 0.5) * 60;
                y += 20 + next() * 40;
                context.lineTo(x, y);
            }
            context.stroke();
        }
        return;
    }
    // stone：大小不一的石块。
    let y = 0;
    while (y < SIZE) {
        const height = SIZE * (0.12 + next() * 0.12);
        let x = -next() * 60;
        while (x < SIZE) {
            const width = SIZE * (0.15 + next() * 0.25);
            context.fillStyle = gray(200 + next() * 50);
            context.fillRect(x + 3, y + 3, width - 6, height - 6);
            x += width;
        }
        y += height;
    }
}

const cache = new Map<SceneTexture, Texture>();

/** 取一种纹理（整个页面共用一份）；按米铺开，几何体的 UV 也是按米算的。 */
export function sceneTexture(kind: SceneTexture) {
    let texture = cache.get(kind);
    if (!texture) {
        const canvas = document.createElement("canvas");
        canvas.width = SIZE;
        canvas.height = SIZE;
        const context = canvas.getContext("2d");
        if (context) draw(kind, context);
        texture = new CanvasTexture(canvas);
        texture.wrapS = RepeatWrapping;
        texture.wrapT = RepeatWrapping;
        texture.colorSpace = SRGBColorSpace;
        texture.anisotropy = 4;
        texture.repeat.set(1 / TEXTURE_TILE[kind], 1 / TEXTURE_TILE[kind]);
        cache.set(kind, texture);
    }
    return texture;
}
