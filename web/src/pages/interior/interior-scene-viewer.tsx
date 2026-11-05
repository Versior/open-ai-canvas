import { Html, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree, type RootState } from "@react-three/fiber";
import { Download, Eye, EyeOff, ImagePlay, Layers, Maximize2, RotateCcw, Square, Box as BoxIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
    Box3,
    BoxGeometry,
    BufferGeometry,
    ConeGeometry,
    CylinderGeometry,
    Euler,
    ExtrudeGeometry,
    Float32BufferAttribute,
    Group,
    Matrix4,
    Mesh,
    MeshStandardMaterial,
    Path,
    PMREMGenerator,
    Raycaster,
    Shape,
    ShapeGeometry,
    SphereGeometry,
    Vector3,
    type Material,
    type Object3D,
} from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { SCENE_MAX_MESHES, type SceneLabel, type SceneMaterial, type SceneObject, type SceneTexture } from "@/lib/interior/scene-3d";
import { renderModel, type RenderModel } from "@/lib/interior/scene-compile";
import type { InteriorSceneData } from "@/lib/interior/scene-spec";
import { cn } from "@/lib/utils";
import { sceneTexture } from "./interior-scene-textures";

type MaterialLook = { color: string; roughness: number; metalness: number; opacity?: number; emissive?: boolean };

/** 材质的默认颜色和质感；方案或模型给了 color 时只换颜色。 */
const LOOKS: Record<SceneMaterial, MaterialLook> = {
    wall: { color: "#f2efe9", roughness: 0.92, metalness: 0 },
    concrete: { color: "#b9b6b0", roughness: 0.95, metalness: 0 },
    brick: { color: "#a65a43", roughness: 0.9, metalness: 0 },
    stone: { color: "#8f8a82", roughness: 0.85, metalness: 0 },
    marble: { color: "#e9e6e1", roughness: 0.25, metalness: 0.05 },
    tile: { color: "#d9d6d0", roughness: 0.45, metalness: 0 },
    wood: { color: "#c8a27a", roughness: 0.7, metalness: 0 },
    "wood-dark": { color: "#6b4a33", roughness: 0.6, metalness: 0 },
    glass: { color: "#a8c8d8", roughness: 0.05, metalness: 0.1, opacity: 0.32 },
    metal: { color: "#c0c4c8", roughness: 0.3, metalness: 0.8 },
    "metal-dark": { color: "#2b2d30", roughness: 0.45, metalness: 0.5 },
    roof: { color: "#3e4247", roughness: 0.8, metalness: 0.05 },
    fabric: { color: "#d8d2c6", roughness: 1, metalness: 0 },
    leather: { color: "#7a5236", roughness: 0.55, metalness: 0 },
    grass: { color: "#7fa865", roughness: 1, metalness: 0 },
    soil: { color: "#7a5c42", roughness: 1, metalness: 0 },
    water: { color: "#5fa8c9", roughness: 0.08, metalness: 0.1, opacity: 0.55 },
    plant: { color: "#4f8a4a", roughness: 0.9, metalness: 0 },
    light: { color: "#fff4d6", roughness: 0.4, metalness: 0, emissive: true },
    ceramic: { color: "#f4f2ee", roughness: 0.18, metalness: 0 },
};

const DEGREE = Math.PI / 180;

const WINDOW_FRAME = 0.06;

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

function geometryFor(object: SceneObject): BufferGeometry {
    switch (object.shape) {
        case "wall":
            throw new Error("墙由 wallGeometries 生成");
        case "box": {
            const [width, height, depth] = object.size!;
            const geometry = new BoxGeometry(width, height, depth);
            if (object.texture) boxUvInMeters(geometry, [width, height, depth]);
            return geometry;
        }
        case "rbox": {
            const [width, height, depth] = object.size!;
            const radius = Math.max(0.002, Math.min(object.round ?? 0.02, Math.min(width, height, depth) / 2 - 0.001));
            return new RoundedBoxGeometry(width, height, depth, 2, radius);
        }
        case "hip": {
            const [width, height, depth] = object.size!;
            return hipGeometry(width, height, depth);
        }
        case "prism": {
            // 横截面是等腰三角形（底边在下），沿 z 方向延伸，用来做坡屋顶和山墙。
            const [width, height, depth] = object.size!;
            const shape = new Shape();
            shape.moveTo(-width / 2, -height / 2);
            shape.lineTo(width / 2, -height / 2);
            shape.lineTo(0, height / 2);
            shape.closePath();
            const geometry = new ExtrudeGeometry(shape, { depth, bevelEnabled: false });
            geometry.translate(0, 0, -depth / 2);
            return geometry;
        }
        case "cylinder":
            return new CylinderGeometry(object.radiusTop ?? object.radius!, object.radius!, object.height!, 28);
        case "cone":
            return new ConeGeometry(object.radius!, object.height!, 28);
        case "sphere": {
            const geometry = new SphereGeometry(object.radius!, 24, 16);
            if (object.scale) geometry.scale(...object.scale);
            return geometry;
        }
    }
}

/** 把一个分组里同材质的网格合成一个，几千个零件也只要几十次绘制。 */
function mergeGroup(group: Group) {
    group.updateMatrixWorld(true);
    const inverse = group.matrixWorld.clone().invert();
    const buckets = new Map<Material, BufferGeometry[]>();
    const meshes: Mesh[] = [];
    group.traverse((node) => {
        if (!(node instanceof Mesh)) return;
        meshes.push(node);
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
        if (!geometry) return { merged: [], ok: false };
        merged.push(geometry);
        const mesh = new Mesh(geometry, material);
        const transparent = (material as MeshStandardMaterial).transparent;
        mesh.castShadow = !transparent && material.name !== "light";
        mesh.receiveShadow = !transparent;
        replacement.push(mesh);
    }
    for (const child of [...group.children]) group.remove(child);
    for (const mesh of replacement) group.add(mesh);
    return { merged, ok: true, meshes };
}

/**
 * 把渲染模型搭成 three.js 的物体树：同样的材质、颜色和纹理共用一个材质对象，每个分组一个子节点（方便隐藏），
 * 分组里同材质的网格合成一个。返回 dispose，换场景或离开时释放几何体和材质。
 */
function buildSceneRoot(model: RenderModel) {
    const root = new Group();
    root.name = model.title;
    const materials = new Map<string, Material>();
    const geometries: BufferGeometry[] = [];
    const groups = new Map<string, Group>();
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
    let meshes = 0;
    for (const [objectIndex, object] of model.objects.entries()) {
        if (meshes >= SCENE_MAX_MESHES) break;
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
        let parent = groups.get(groupName);
        if (!parent) {
            parent = new Group();
            parent.name = groupName || "其他";
            groups.set(groupName, parent);
            root.add(parent);
        }
        const count = object.repeat?.count || 1;
        for (let index = 0; index < count && meshes < SCENE_MAX_MESHES; index += 1) {
            const copy = index === 0 ? template : template.clone();
            if (index && object.repeat) copy.position.add(new Vector3(...object.repeat.step).multiplyScalar(index));
            parent.add(copy);
            meshes += copy.children.length;
        }
    }
    for (const group of groups.values()) {
        const result = mergeGroup(group);
        if (result.ok) geometries.push(...result.merged);
    }
    const { ground } = model;
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
    return {
        root,
        groups,
        dispose: () => {
            for (const geometry of geometries) geometry.dispose();
            for (const material of materials.values()) material.dispose();
        },
    };
}

type ViewMode = "orbit" | "top";

function cameraFor(box: Box3, view: ViewMode) {
    const center = box.getCenter(new Vector3());
    const size = box.getSize(new Vector3());
    const span = Math.max(size.x, size.y, size.z, 4);
    const distance = span * 1.15;
    const position = view === "top" ? new Vector3(center.x, center.y + distance * 1.4, center.z + 0.01) : new Vector3(center.x + distance * 0.72, center.y + distance * 0.62, center.z + distance);
    return { position: position.toArray() as [number, number, number], target: center.toArray() as [number, number, number], far: span * 20 };
}

function downloadBlob(blob: Blob, fileName: string) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function safeFileName(value: string) {
    return value.replace(/[\\/:*?"<>|\s]+/g, "_") || "3D模型";
}

/** 挡住标注的物体要离标注至少这么远（米，另加距离的 1%）：标注常放在台阶、家具上或树冠里，贴着的不算挡住。 */
const LABEL_OCCLUDE_MARGIN = 0.6;
const LABEL_CHECK_MS = 120;

function shownInScene(object: Object3D | null) {
    for (let node = object; node; node = node.parent) if (!node.visible) return false;
    return true;
}

/**
 * 文字标注：被墙、楼板、屋顶挡住时隐藏，避免室内的标注透过外墙叠在一起；玻璃和隐藏的分组不算遮挡。
 * 视角变化时最多每 120ms 用射线检查一次。
 */
function SceneLabels({ labels, root, hidden }: { labels: SceneLabel[]; root: Object3D; hidden: ReadonlySet<string> }) {
    const camera = useThree((state) => state.camera);
    const [occluded, setOccluded] = useState("");
    const check = useRef({ matrix: new Matrix4(), at: 0, stale: true });
    const raycaster = useMemo(() => new Raycaster(), []);
    useEffect(() => {
        check.current.stale = true;
    }, [hidden, labels, root]);
    useFrame(({ clock }) => {
        const state = check.current;
        const now = clock.elapsedTime * 1000;
        if (!state.stale && (state.matrix.equals(camera.matrixWorld) || now - state.at < LABEL_CHECK_MS)) return;
        state.matrix.copy(camera.matrixWorld);
        state.at = now;
        state.stale = false;
        const origin = camera.getWorldPosition(new Vector3());
        const result: number[] = [];
        for (const [index, label] of labels.entries()) {
            const target = new Vector3(...label.position);
            const distance = origin.distanceTo(target);
            raycaster.set(origin, target.sub(origin).normalize());
            raycaster.far = Math.max(0, distance - LABEL_OCCLUDE_MARGIN - distance * 0.01);
            const blocked = raycaster.intersectObject(root, true).some((hit) => {
                const material = (hit.object as Mesh).material as Material | undefined;
                return !material?.transparent && shownInScene(hit.object);
            });
            if (blocked) result.push(index);
        }
        const next = result.join(",");
        setOccluded((current) => (current === next ? current : next));
    });
    const hiddenIndexes = useMemo(() => new Set(occluded ? occluded.split(",").map(Number) : []), [occluded]);
    return labels.map((label, index) => (
        <Html key={`${label.text}-${index}`} position={label.position} center zIndexRange={[20, 0]}>
            <span className={cn("itd-scene-label", hiddenIndexes.has(index) && "is-occluded")}>{label.text}</span>
        </Html>
    ));
}

/** 环境光照：three 自带的「房间」环境贴图，玻璃、金属、瓷砖有柔和的反光，不依赖外网的 HDR。 */
function SceneEnvironment() {
    const gl = useThree((state) => state.gl);
    const scene = useThree((state) => state.scene);
    useEffect(() => {
        const generator = new PMREMGenerator(gl);
        const environment = generator.fromScene(new RoomEnvironment(), 0.04).texture;
        scene.environment = environment;
        scene.environmentIntensity = 0.6;
        return () => {
            scene.environment = null;
            environment.dispose();
            generator.dispose();
        };
    }, [gl, scene]);
    return null;
}

/**
 * 可以拖动旋转、滚轮缩放、右键平移的三维模型；能按楼层和分组隐藏、剖切看某一层、切到俯视、全屏，
 * 下载 GLB（通用三维格式）或场景数据。
 */
export function InteriorSceneViewer({
    scene,
    className,
    onError,
    onSnapshot,
    snapshotBusy,
}: {
    scene: InteriorSceneData;
    className?: string;
    onError?: (message: string) => void;
    /** 按当前视角截一张图（不带标注），交给调用方去出效果图。 */
    onSnapshot?: (image: Blob) => void;
    snapshotBusy?: boolean;
}) {
    const [cutFloor, setCutFloor] = useState<number | undefined>(undefined);
    const model = useMemo(() => renderModel(scene, { cutFloor }), [scene, cutFloor]);
    const built = useMemo(() => buildSceneRoot(model), [model]);
    useEffect(() => () => built.dispose(), [built]);
    const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
    const [view, setView] = useState<ViewMode>("orbit");
    const [labels, setLabels] = useState(true);
    const [resetKey, setResetKey] = useState(0);
    const [exporting, setExporting] = useState(false);
    const frameRef = useRef<HTMLDivElement>(null);
    const glRef = useRef<RootState["gl"] | null>(null);
    const floors = scene.version === 2 ? scene.spec.floors.map((floor) => floor.name) : [];
    const canCut = scene.version === 2 && (scene.spec.scope === "building" || floors.length > 1);

    useEffect(() => {
        setHidden(new Set());
        setView("orbit");
        setCutFloor(undefined);
    }, [scene]);
    useEffect(() => {
        for (const [name, group] of built.groups) group.visible = !hidden.has(name);
    }, [built, hidden]);

    // 相机按整个模型的包围盒取景（剖切时沿用完整模型的取景，切楼层时画面不跳）。
    const frameBox = useRef<{ scene: InteriorSceneData; box: Box3 } | null>(null);
    if (!frameBox.current || frameBox.current.scene !== scene) frameBox.current = { scene, box: new Box3().setFromObject(built.root) };
    const box = frameBox.current.box;
    const camera = useMemo(() => cameraFor(box, view), [box, view]);
    const span = Math.max(...box.getSize(new Vector3()).toArray(), 4);
    const visibleLabels = labels ? model.labels : [];

    const toggleGroup = (name: string) =>
        setHidden((current) => {
            const next = new Set(current);
            if (next.has(name)) next.delete(name);
            else next.add(name);
            return next;
        });
    const toggleCut = () => {
        setHidden(new Set());
        setCutFloor((current) => (current === undefined ? Math.max(0, floors.length - 1) : undefined));
    };
    const exportGlb = async () => {
        setExporting(true);
        try {
            const result = await new GLTFExporter().parseAsync(built.root, { binary: true, onlyVisible: true });
            downloadBlob(new Blob([result as ArrayBuffer], { type: "model/gltf-binary" }), `${safeFileName(scene.title)}.glb`);
        } catch (error) {
            onError?.(error instanceof Error && error.message ? `导出 GLB 失败：${error.message}` : "导出 GLB 失败");
        } finally {
            setExporting(false);
        }
    };
    const exportJson = () => downloadBlob(new Blob([JSON.stringify(scene, null, 2)], { type: "application/json" }), `${safeFileName(scene.title)}.json`);
    const snapshot = () => {
        const canvas = glRef.current?.domElement;
        if (!canvas || !onSnapshot) return;
        canvas.toBlob((blob) => (blob ? onSnapshot(blob) : onError?.("截图失败，请再试一次")), "image/png");
    };
    const fullscreen = () => {
        const frame = frameRef.current;
        if (!frame) return;
        if (document.fullscreenElement) void document.exitFullscreen();
        else void frame.requestFullscreen?.().catch(() => onError?.("浏览器不允许全屏"));
    };

    return (
        <div ref={frameRef} className={cn("itd-scene-frame", className)}>
            <Canvas
                key={`${view}-${resetKey}`}
                shadows
                dpr={[1, 2]}
                gl={{ antialias: true, alpha: true, logarithmicDepthBuffer: model.legacy, preserveDrawingBuffer: true }}
                camera={{ position: camera.position, fov: 40, near: Math.max(0.05, span / 400), far: camera.far }}
                aria-label={`${scene.title}，可以拖动旋转、滚轮缩放`}
                onCreated={(state) => (glRef.current = state.gl)}
            >
                <SceneEnvironment />
                <hemisphereLight args={["#ffffff", "#8d8577", 0.55]} />
                <directionalLight
                    castShadow
                    position={[camera.target[0] + span * 0.55, camera.target[1] + span * 1.1, camera.target[2] + span * 0.45]}
                    intensity={2.1}
                    color="#fff6ea"
                    shadow-mapSize={[2048, 2048]}
                    shadow-camera-left={-span}
                    shadow-camera-right={span}
                    shadow-camera-top={span}
                    shadow-camera-bottom={-span}
                    shadow-camera-far={span * 4}
                    shadow-bias={-0.0002}
                    shadow-normalBias={Math.max(0.02, span / 600)}
                />
                <primitive object={built.root} dispose={null} />
                <SceneLabels labels={visibleLabels} root={built.root} hidden={hidden} />
                <OrbitControls makeDefault target={camera.target} enableDamping dampingFactor={0.12} maxPolarAngle={view === "top" ? Math.PI / 2 : Math.PI * 0.49} minDistance={0.5} maxDistance={span * 6} />
            </Canvas>
            <div className="itd-scene-toolbar" role="toolbar" aria-label="3D 模型查看">
                <button type="button" className="itd-scene-tool" aria-pressed={view === "orbit"} onClick={() => setView("orbit")} title="自由视角">
                    <BoxIcon className="size-4" aria-hidden />
                </button>
                <button type="button" className="itd-scene-tool" aria-pressed={view === "top"} onClick={() => setView("top")} title="俯视">
                    <Square className="size-4" aria-hidden />
                </button>
                <button type="button" className="itd-scene-tool" onClick={() => setResetKey((value) => value + 1)} title="重置视角" aria-label="重置视角">
                    <RotateCcw className="size-4" aria-hidden />
                </button>
                {canCut ? (
                    <button type="button" className="itd-scene-tool" aria-pressed={cutFloor !== undefined} onClick={toggleCut} title={cutFloor === undefined ? "剖切：去掉屋顶和上面的楼层，看一层的室内" : "退出剖切"}>
                        <Layers className="size-4" aria-hidden />
                    </button>
                ) : null}
                {model.labels.length ? (
                    <button type="button" className="itd-scene-tool" aria-pressed={labels} onClick={() => setLabels((value) => !value)} title={labels ? "隐藏标注" : "显示标注"}>
                        {labels ? <Eye className="size-4" aria-hidden /> : <EyeOff className="size-4" aria-hidden />}
                    </button>
                ) : null}
                <button type="button" className="itd-scene-tool" onClick={fullscreen} title="全屏" aria-label="全屏">
                    <Maximize2 className="size-4" aria-hidden />
                </button>
                <span className="itd-scene-tool-gap" aria-hidden />
                {onSnapshot ? (
                    <button type="button" className="itd-scene-tool is-text" disabled={snapshotBusy} onClick={snapshot} title="按现在的视角截图，用白模渲染出装修效果图">
                        <ImagePlay className="size-4" aria-hidden />
                        出效果图
                    </button>
                ) : null}
                <button type="button" className="itd-scene-tool is-text" disabled={exporting} onClick={() => void exportGlb()} title="下载 GLB，可以在 Blender、SketchUp 等软件里打开">
                    <Download className="size-4" aria-hidden />
                    GLB
                </button>
                <button type="button" className="itd-scene-tool is-text" onClick={exportJson} title="下载场景数据">
                    JSON
                </button>
            </div>
            {cutFloor !== undefined ? (
                <div className="itd-scene-groups" role="radiogroup" aria-label="剖切到哪一层">
                    {floors.map((name, index) => (
                        <button key={name} type="button" role="radio" className="itd-scene-group" aria-checked={cutFloor === index} aria-pressed={cutFloor === index} onClick={() => setCutFloor(index)}>
                            {name}
                        </button>
                    ))}
                </div>
            ) : model.groups.length > 1 ? (
                <div className="itd-scene-groups" role="group" aria-label="按分组显示">
                    {model.groups.map((name) => (
                        <button key={name} type="button" className="itd-scene-group" aria-pressed={!hidden.has(name)} onClick={() => toggleGroup(name)}>
                            {name}
                        </button>
                    ))}
                </div>
            ) : null}
            <p className="itd-scene-hint">拖动旋转 · 滚轮缩放 · 右键平移</p>
        </div>
    );
}
