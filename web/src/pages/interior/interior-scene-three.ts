/**
 * 3D 模型的 three.js 物体树：查看器和「边收边搭」的建模预览共用。只读编译好的物体列表，不执行模型写的任何代码。
 * 同样的材质、颜色和纹理共用一个材质对象；每个分组（楼层、屋顶、庭院）一个子节点，组里同材质的网格合成一个，
 * 几千个零件也只要几十次绘制。外墙按 facade 单独成组，查看器据此把朝向镜头的外墙剖开。
 */
import {
    BoxGeometry,
    BufferGeometry,
    ConeGeometry,
    CylinderGeometry,
    Euler,
    ExtrudeGeometry,
    Float32BufferAttribute,
    Group,
    LatheGeometry,
    Matrix4,
    Mesh,
    MeshStandardMaterial,
    Path,
    Shape,
    ShapeGeometry,
    SphereGeometry,
    Vector2,
    Vector3,
    type Material,
} from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { SCENE_MAX_MESHES, type SceneMaterial, type SceneObject, type SceneTexture } from "@/lib/interior/scene-3d";
import type { RenderModel, SceneDimension } from "@/lib/interior/scene-compile";
import { sceneTexture } from "./interior-scene-textures";

type MaterialLook = { color: string; roughness: number; metalness: number; opacity?: number; emissive?: boolean };

/** 材质的默认颜色和质感；方案或模型给了 color 时只换颜色。 */
export const LOOKS: Record<SceneMaterial, MaterialLook> = {
    wall: { color: "#f2efe9", roughness: 0.92, metalness: 0 },
    concrete: { color: "#b9b6b0", roughness: 0.95, metalness: 0 },
    brick: { color: "#a65a43", roughness: 0.9, metalness: 0 },
    stone: { color: "#8f8a82", roughness: 0.78, metalness: 0 },
    marble: { color: "#e9e6e1", roughness: 0.22, metalness: 0.04 },
    tile: { color: "#d9d6d0", roughness: 0.4, metalness: 0 },
    wood: { color: "#c8a27a", roughness: 0.62, metalness: 0 },
    "wood-dark": { color: "#6b4a33", roughness: 0.55, metalness: 0 },
    glass: { color: "#a8c8d8", roughness: 0.04, metalness: 0.1, opacity: 0.3 },
    metal: { color: "#c0c4c8", roughness: 0.28, metalness: 0.85 },
    "metal-dark": { color: "#2b2d30", roughness: 0.42, metalness: 0.55 },
    roof: { color: "#3e4247", roughness: 0.8, metalness: 0.05 },
    fabric: { color: "#d8d2c6", roughness: 0.98, metalness: 0 },
    leather: { color: "#7a5236", roughness: 0.5, metalness: 0 },
    grass: { color: "#7fa865", roughness: 1, metalness: 0 },
    soil: { color: "#7a5c42", roughness: 1, metalness: 0 },
    water: { color: "#5fa8c9", roughness: 0.06, metalness: 0.1, opacity: 0.55 },
    plant: { color: "#4f8a4a", roughness: 0.85, metalness: 0 },
    light: { color: "#fff4d6", roughness: 0.4, metalness: 0, emissive: true },
    ceramic: { color: "#f4f2ee", roughness: 0.15, metalness: 0 },
};

export const DIMENSION_GROUP = "尺寸";
const DEGREE = Math.PI / 180;
const WINDOW_FRAME = 0.06;
/** 第二版方案的零件多（家具按零件拼），网格合并后绘制次数很少，上限放宽；第一版沿用旧上限。 */
const MAX_COMPILED_MESHES = 20000;

function rectangle(target: Shape | Path, left: number, bottom: number, width: number, height: number) {
    target.moveTo(left, bottom);
    target.lineTo(left + width, bottom);
    target.lineTo(left + width, bottom + height);
    target.lineTo(left, bottom + height);
    target.closePath();
}

/**
 * 一面墙：在墙的立面（沿墙长度 × 高度）上画轮廓、挖门窗洞再挤出厚度。局部坐标里墙从原点沿 x 走，
 * 放到场景里时整组平移到起点、绕 y 轴转到终点方向。第一版场景的窗洞补一块玻璃和一圈窗框；
 * 第二版方案的洞口（hole）由方案编译时另外生成窗框和门扇。
 */
function wallGeometries(object: SceneObject) {
    const [startX, startZ] = object.start!;
    const [endX, endZ] = object.end!;
    const length = Math.hypot(endX - startX, endZ - startZ);
    const height = object.height!;
    const thickness = object.thickness ?? 0.2;
    const outline = new Shape();
    rectangle(outline, 0, 0, length, height);
    const windows: { geometry: BufferGeometry; kind: "glass" | "frame" }[] = [];
    for (const opening of object.openings || []) {
        const hole = new Path();
        rectangle(hole, opening.offset - opening.width / 2, opening.bottom, opening.width, opening.height);
        outline.holes.push(hole);
        if (opening.kind !== "window") continue;
        const glass = new BoxGeometry(opening.width, opening.height, 0.03);
        glass.translate(opening.offset, opening.bottom + opening.height / 2, 0);
        windows.push({ geometry: glass, kind: "glass" });
        const frame = new Shape();
        rectangle(frame, -opening.width / 2, -opening.height / 2, opening.width, opening.height);
        const inner = new Path();
        rectangle(inner, -opening.width / 2 + WINDOW_FRAME, -opening.height / 2 + WINDOW_FRAME, opening.width - WINDOW_FRAME * 2, opening.height - WINDOW_FRAME * 2);
        frame.holes.push(inner);
        const frameGeometry = new ExtrudeGeometry(frame, { depth: 0.08, bevelEnabled: false });
        frameGeometry.translate(opening.offset, opening.bottom + opening.height / 2, -0.04);
        windows.push({ geometry: frameGeometry, kind: "frame" });
    }
    const wall = new ExtrudeGeometry(outline, { depth: thickness, bevelEnabled: false });
    wall.translate(0, 0, -thickness / 2);
    return { wall, windows, angle: Math.atan2(-(endZ - startZ), endX - startX), origin: new Vector3(startX, object.base ?? 0, startZ) };
}

/** 方块的 UV 按米算（每个面各自按宽高拉伸），铺纹理时木地板、瓷砖的大小和真实一致。 */
function boxUvInMeters(geometry: BufferGeometry, [width, height, depth]: [number, number, number]) {
    const uv = geometry.getAttribute("uv");
    // BoxGeometry 的面顺序：+x、-x、+y、-y、+z、-z，每面 4 个顶点。
    const faces: [number, number][] = [
        [depth, height],
        [depth, height],
        [width, depth],
        [width, depth],
        [width, height],
        [width, height],
    ];
    for (let face = 0; face < 6; face += 1) {
        for (let vertex = 0; vertex < 4; vertex += 1) {
            const index = face * 4 + vertex;
            uv.setXY(index, uv.getX(index) * faces[face][0], uv.getY(index) * faces[face][1]);
        }
    }
    uv.needsUpdate = true;
}

/** 其他形状按法线方向做盒状投影，UV 直接用米：圆角方块、旋转体、挤出体铺木纹、布纹时纹理大小一致。 */
function projectUvInMeters(geometry: BufferGeometry) {
    if (!geometry.getAttribute("normal")) geometry.computeVertexNormals();
    const position = geometry.getAttribute("position");
    const normal = geometry.getAttribute("normal");
    const uvs = new Float32Array(position.count * 2);
    for (let index = 0; index < position.count; index += 1) {
        const nx = Math.abs(normal.getX(index));
        const ny = Math.abs(normal.getY(index));
        const nz = Math.abs(normal.getZ(index));
        const [u, v] = ny >= nx && ny >= nz ? [position.getX(index), position.getZ(index)] : nx >= nz ? [position.getZ(index), position.getY(index)] : [position.getX(index), position.getY(index)];
        uvs[index * 2] = u;
        uvs[index * 2 + 1] = v;
    }
    geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
}

/** 四坡屋顶：底面 width × depth，屋脊沿长边，高 height；中心在几何体中心。UV 按米（沿檐口、沿坡面）。 */
function hipGeometry(width: number, height: number, depth: number): BufferGeometry {
    if (width < depth) {
        const turned = hipGeometry(depth, height, width);
        turned.rotateY(Math.PI / 2);
        return turned;
    }
    const a = width / 2;
    const b = depth / 2;
    const r = (width - depth) / 2;
    const y0 = -height / 2;
    const y1 = height / 2;
    const A = [-a, y0, b];
    const B = [a, y0, b];
    const C = [r, y1, 0];
    const D = [-r, y1, 0];
    const E = [a, y0, -b];
    const F = [-a, y0, -b];
    const slopeLong = Math.hypot(b, height);
    const slopeShort = Math.hypot(a - r, height);
    const positions: number[] = [];
    const uvs: number[] = [];
    const triangle = (points: number[][], coords: number[][]) => {
        for (const point of points) positions.push(...point);
        for (const coord of coords) uvs.push(...coord);
    };
    triangle(
        [A, B, C],
        [
            [-a, 0],
            [a, 0],
            [r, slopeLong],
        ],
    );
    triangle(
        [A, C, D],
        [
            [-a, 0],
            [r, slopeLong],
            [-r, slopeLong],
        ],
    );
    triangle(
        [E, F, D],
        [
            [a, 0],
            [-a, 0],
            [-r, slopeLong],
        ],
    );
    triangle(
        [E, D, C],
        [
            [a, 0],
            [-r, slopeLong],
            [r, slopeLong],
        ],
    );
    triangle(
        [B, E, C],
        [
            [b, 0],
            [-b, 0],
            [0, slopeShort],
        ],
    );
    triangle(
        [F, A, D],
        [
            [-b, 0],
            [b, 0],
            [0, slopeShort],
        ],
    );
    triangle(
        [A, E, B],
        [
            [-a, b],
            [a, -b],
            [a, b],
        ],
    );
    triangle(
        [A, F, E],
        [
            [-a, b],
            [-a, -b],
            [a, -b],
        ],
    );
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
    geometry.computeVertexNormals();
    return geometry;
}

/** 挤出体：axis 为 y 时轮廓是俯视的 [x, z]、往上挤出；为 z 时轮廓是正视的 [x, y]、往前挤出。都按厚度居中。 */
function extrudeGeometry(object: SceneObject) {
    const axisY = object.axis !== "z";
    const toShape = ([u, v]: [number, number]): [number, number] => (axisY ? [u, -v] : [u, v]);
    const trace = (target: Shape | Path, points: [number, number][]) => {
        points.forEach((point, index) => {
            const [x, y] = toShape(point);
            if (index) target.lineTo(x, y);
            else target.moveTo(x, y);
        });
        target.closePath();
    };
    const shape = new Shape();
    trace(shape, object.outline || []);
    for (const hole of object.holes || []) {
        const path = new Path();
        trace(path, hole);
        shape.holes.push(path);
    }
    const depth = object.depth ?? 0.02;
    const bevel = object.bevel ?? 0;
    const geometry = new ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2, curveSegments: 4 });
    geometry.translate(0, 0, -depth / 2);
    if (axisY) geometry.rotateX(-Math.PI / 2);
    return geometry;
}

function geometryFor(object: SceneObject): BufferGeometry {
    let geometry: BufferGeometry;
    switch (object.shape) {
        case "wall":
            throw new Error("墙由 wallGeometries 生成");
        case "box": {
            const [width, height, depth] = object.size!;
            geometry = new BoxGeometry(width, height, depth);
            if (object.texture) boxUvInMeters(geometry, [width, height, depth]);
            break;
        }
        case "rbox": {
            const [width, height, depth] = object.size!;
            const radius = Math.max(0.002, Math.min(object.round ?? 0.02, Math.min(width, height, depth) / 2 - 0.001));
            geometry = new RoundedBoxGeometry(width, height, depth, 2, radius);
            break;
        }
        case "hip": {
            const [width, height, depth] = object.size!;
            geometry = hipGeometry(width, height, depth);
            break;
        }
        case "prism": {
            // 横截面是等腰三角形（底边在下），沿 z 方向延伸，用来做坡屋顶和山墙。
            const [width, height, depth] = object.size!;
            const shape = new Shape();
            shape.moveTo(-width / 2, -height / 2);
            shape.lineTo(width / 2, -height / 2);
            shape.lineTo(0, height / 2);
            shape.closePath();
            geometry = new ExtrudeGeometry(shape, { depth, bevelEnabled: false });
            geometry.translate(0, 0, -depth / 2);
            break;
        }
        case "cylinder":
            geometry = new CylinderGeometry(object.radiusTop ?? object.radius!, object.radius!, object.height!, 28);
            break;
        case "cone":
            geometry = new ConeGeometry(object.radius!, object.height!, 28);
            break;
        case "sphere":
            geometry = new SphereGeometry(object.radius!, 24, 16);
            break;
        case "lathe":
            geometry = new LatheGeometry(
                (object.profile || []).map(([radius, y]) => new Vector2(Math.max(0, radius), y)),
                object.segments ?? 32,
            );
            break;
        case "extrude":
            geometry = extrudeGeometry(object);
            break;
        default:
            throw new Error("不认识的几何形状");
    }
    if (object.scale) geometry.scale(...object.scale);
    if (object.texture && object.shape !== "box" && object.shape !== "hip") projectUvInMeters(geometry);
    return geometry;
}

/** 把一个分组里同材质的网格合成一个。 */
function mergeGroup(group: Group) {
    group.updateMatrixWorld(true);
    const inverse = group.matrixWorld.clone().invert();
    const buckets = new Map<Material, BufferGeometry[]>();
    group.traverse((node) => {
        if (!(node instanceof Mesh)) return;
        const geometry = (node.geometry as BufferGeometry).clone();
        geometry.applyMatrix4(new Matrix4().multiplyMatrices(inverse, node.matrixWorld));
        const flat = geometry.index ? geometry.toNonIndexed() : geometry;
        if (flat !== geometry) geometry.dispose();
        for (const name of Object.keys(flat.attributes)) if (name !== "position" && name !== "normal" && name !== "uv") flat.deleteAttribute(name);
        if (!flat.getAttribute("uv")) flat.setAttribute("uv", new Float32BufferAttribute(new Float32Array((flat.getAttribute("position").count || 0) * 2), 2));
        if (!flat.getAttribute("normal")) flat.computeVertexNormals();
        flat.clearGroups();
        const material = node.material as Material;
        const list = buckets.get(material) || [];
        list.push(flat);
        buckets.set(material, list);
    });
    const merged: BufferGeometry[] = [];
    const replacement: Mesh[] = [];
    for (const [material, geometries] of buckets) {
        const geometry = mergeGeometries(geometries, false);
        for (const item of geometries) item.dispose();
        if (!geometry) return { merged, ok: false };
        merged.push(geometry);
        const mesh = new Mesh(geometry, material);
        const transparent = (material as MeshStandardMaterial).transparent;
        mesh.castShadow = !transparent && material.name !== "light";
        mesh.receiveShadow = !transparent;
        replacement.push(mesh);
    }
    for (const child of [...group.children]) group.remove(child);
    for (const mesh of replacement) group.add(mesh);
    return { merged, ok: true };
}

/** 一面可以剖开的外墙：full 是整面墙连同门窗、窗帘、踢脚线，curb 是剖开后留下的那截矮墙。 */
export type FacadeNode = { normal: [number, number]; full: Group; curb: Group };

export type BuiltScene = { root: Group; groups: Map<string, Group>; facades: FacadeNode[]; dispose: () => void };

type BuildInput = Pick<RenderModel, "title" | "objects" | "legacy"> & { ground?: RenderModel["ground"]; dimensions?: SceneDimension[] };

/**
 * 把渲染模型搭成 three.js 的物体树。返回 dispose，换场景或离开时释放几何体和材质。
 * ground 可以不给（建模预览里新长出来的那一批单独成树时用）。
 */
export function buildSceneRoot(model: BuildInput): BuiltScene {
    const root = new Group();
    root.name = model.title;
    const materials = new Map<string, Material>();
    const geometries: BufferGeometry[] = [];
    const groups = new Map<string, Group>();
    const bulks = new Map<string, Group>();
    const facadeNodes = new Map<string, FacadeNode>();
    const materialFor = (kind: SceneMaterial, color?: string, texture?: SceneTexture) => {
        const key = `${kind}:${color || ""}:${texture || ""}`;
        let material = materials.get(key);
        if (!material) {
            const look = LOOKS[kind];
            const tint = color || look.color;
            material = new MeshStandardMaterial({
                color: tint,
                roughness: look.roughness,
                metalness: look.metalness,
                transparent: look.opacity !== undefined,
                opacity: look.opacity ?? 1,
                depthWrite: look.opacity === undefined,
                envMapIntensity: kind === "glass" || kind === "water" || kind === "metal" || kind === "marble" || kind === "ceramic" ? 1 : 0.5,
                ...(texture ? { map: sceneTexture(texture) } : {}),
                ...(look.emissive ? { emissive: tint, emissiveIntensity: 0.9 } : {}),
            });
            material.name = kind;
            materials.set(key, material);
        }
        return material;
    };
    const meshOf = (geometry: BufferGeometry, kind: SceneMaterial, color?: string, texture?: SceneTexture) => {
        const mesh = new Mesh(geometry, materialFor(kind, color, texture));
        mesh.castShadow = LOOKS[kind].opacity === undefined;
        mesh.receiveShadow = true;
        return mesh;
    };
    const groupFor = (name: string) => {
        let parent = groups.get(name);
        if (!parent) {
            parent = new Group();
            parent.name = name || "其他";
            groups.set(name, parent);
            root.add(parent);
            const bulk = new Group();
            parent.add(bulk);
            bulks.set(name, bulk);
        }
        return parent;
    };
    const cap = model.legacy ? SCENE_MAX_MESHES : MAX_COMPILED_MESHES;
    let meshes = 0;
    for (const [objectIndex, object] of model.objects.entries()) {
        if (meshes >= cap) break;
        // 先搭出一份（墙连同门窗是一组），repeat 时按步长复制这一份，几何体共用。
        const template = new Group();
        if (object.shape === "wall") {
            const parts = wallGeometries(object);
            geometries.push(parts.wall, ...parts.windows.map((item) => item.geometry));
            template.add(meshOf(parts.wall, object.material, object.color, object.texture));
            for (const item of parts.windows) template.add(meshOf(item.geometry, item.kind === "glass" ? "glass" : "metal-dark"));
            template.position.copy(parts.origin);
            template.rotation.y = parts.angle;
        } else {
            const geometry = geometryFor(object);
            geometries.push(geometry);
            template.add(meshOf(geometry, object.material, object.color, object.texture));
            template.position.set(...object.position!);
            if (object.rotation) template.rotation.copy(new Euler(object.rotation[0] * DEGREE, object.rotation[1] * DEGREE, object.rotation[2] * DEGREE, object.euler || "XYZ"));
        }
        // 第一版场景是模型自己拼的方块，常把两块面叠在同一个平面上，屏幕会来回闪出花纹；
        // 每个物体按序号放大一点点（最多约 0.5%），重叠的面就分开了。第二版由程序生成，不重叠，不需要。
        if (model.legacy) template.scale.multiplyScalar(1 + (objectIndex % 9) * 0.0006);
        if (object.name) template.name = object.name;
        const groupName = object.group || "";
        const parent = groupFor(groupName);
        let target = bulks.get(groupName)!;
        if (object.facade) {
            let node = facadeNodes.get(object.facade.id);
            if (!node) {
                node = { normal: object.facade.normal, full: new Group(), curb: new Group() };
                node.curb.visible = false;
                parent.add(node.full, node.curb);
                facadeNodes.set(object.facade.id, node);
            }
            target = object.facade.curb ? node.curb : node.full;
        }
        const count = object.repeat?.count || 1;
        for (let index = 0; index < count && meshes < cap; index += 1) {
            const copy = index === 0 ? template : template.clone();
            if (index && object.repeat) copy.position.add(new Vector3(...object.repeat.step).multiplyScalar(index));
            target.add(copy);
            meshes += copy.children.length;
        }
    }
    for (const bulk of bulks.values()) {
        const result = mergeGroup(bulk);
        if (result.ok) geometries.push(...result.merged);
    }
    for (const node of facadeNodes.values())
        for (const part of [node.full, node.curb]) {
            const result = mergeGroup(part);
            if (result.ok) geometries.push(...result.merged);
        }
    if (model.dimensions?.length) {
        const lines = new Group();
        lines.name = DIMENSION_GROUP;
        // 哑光深灰：金属材质在亮环境里会反白，尺寸线就看不清了。
        const ink = materialFor("wall", "#3d4248");
        for (const dimension of model.dimensions) {
            const [ax, az] = dimension.a;
            const [bx, bz] = dimension.b;
            const length = Math.hypot(bx - ax, bz - az);
            const angle = Math.atan2(-(bz - az), bx - ax);
            const line = new BoxGeometry(length, 0.006, dimension.total ? 0.034 : 0.024);
            const tick = new BoxGeometry(0.03, 0.006, 0.3);
            geometries.push(line, tick);
            const holder = new Group();
            holder.position.set((ax + bx) / 2, dimension.y, (az + bz) / 2);
            holder.rotation.y = angle;
            holder.add(new Mesh(line, ink));
            for (const end of [-1, 1]) {
                const mark = new Mesh(tick, ink);
                mark.position.x = (end * length) / 2;
                mark.rotation.y = Math.PI / 4;
                holder.add(mark);
            }
            lines.add(holder);
        }
        const result = mergeGroup(lines);
        if (result.ok) geometries.push(...result.merged);
        for (const child of lines.children) child.castShadow = false;
        groups.set(DIMENSION_GROUP, lines);
        root.add(lines);
    }
    const { ground } = model;
    if (ground) {
        const shape = new Shape();
        rectangle(shape, -ground.size[0] / 2, -ground.size[1] / 2, ground.size[0], ground.size[1]);
        for (const [x1, z1, x2, z2] of ground.holes) {
            const hole = new Path();
            // 地面在 xy 平面上画好再转平：平面上的 y 对应场景里的 -z。
            rectangle(hole, x1 - ground.center[0], -(z2 - ground.center[1]), x2 - x1, z2 - z1);
            shape.holes.push(hole);
        }
        const groundGeometry = new ShapeGeometry(shape);
        geometries.push(groundGeometry);
        const groundMesh = new Mesh(groundGeometry, materialFor(ground.material, ground.color, ground.texture));
        groundMesh.name = "地面";
        groundMesh.rotation.x = -Math.PI / 2;
        groundMesh.position.set(ground.center[0], ground.y, ground.center[1]);
        groundMesh.receiveShadow = true;
        root.add(groundMesh);
    }
    return {
        root,
        groups,
        facades: [...facadeNodes.values()],
        dispose: () => {
            for (const geometry of geometries) geometry.dispose();
            for (const material of materials.values()) material.dispose();
        },
    };
}

/** 外墙剖开：外墙朝外的方向和「目标点指向镜头」的水平方向夹角小于约 75 度时，这面墙挡着看室内，换成矮墙。 */
export function applyCutaway(facades: FacadeNode[], camera: Vector3, target: Vector3, enabled: boolean) {
    const dx = camera.x - target.x;
    const dz = camera.z - target.z;
    const length = Math.hypot(dx, dz) || 1;
    for (const node of facades) {
        const facing = enabled && (node.normal[0] * dx + node.normal[1] * dz) / length > 0.25;
        node.full.visible = !facing;
        node.curb.visible = facing;
    }
}
