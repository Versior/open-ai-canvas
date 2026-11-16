import { PMREMGenerator, type WebGLRenderer } from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { defaultPackagingSurface, type PackagingDocument } from "./types";

export const packagingStudios = {
    neutral: { name: "中性校样", key: "#ffffff", fill: "#ffffff", energy: 1 },
    commerce: { name: "电商白棚", key: "#ffffff", fill: "#e6f0ff", energy: 1.25 },
    warm: { name: "暖调精品", key: "#ffe0b5", fill: "#fff1df", energy: 0.9 },
    dramatic: { name: "深色工艺", key: "#dce5ff", fill: "#eed7b8", energy: 0.65 },
};
export const packagingSurface = (document: PackagingDocument) => document.surface || { ...defaultPackagingSurface, film: document.view.finish === "gloss" ? ("gloss" as const) : document.view.finish === "matte" ? ("matte" as const) : ("none" as const) };

export function packagingEnvironment(renderer: WebGLRenderer) {
    const room = new RoomEnvironment();
    const generator = new PMREMGenerator(renderer);
    const environment = generator.fromScene(room, 0.04);
    room.dispose();
    generator.dispose();
    return environment;
}
