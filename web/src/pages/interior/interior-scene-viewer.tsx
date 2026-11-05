import { Html, OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { Download, Eye, EyeOff, Maximize2, RotateCcw, Square, Box as BoxIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Box3, BoxGeometry, BufferGeometry, ConeGeometry, CylinderGeometry, Euler, ExtrudeGeometry, Group, Mesh, MeshStandardMaterial, Path, PlaneGeometry, Shape, SphereGeometry, Vector3, type Material } from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { SCENE_MAX_MESHES, sceneGroups, type InteriorScene3D, type SceneMaterial, type SceneObject } from "@/lib/interior/scene-3d";
import { cn } from "@/lib/utils";

type MaterialLook = { color: string; roughness: number; metalness: number; opacity?: number; emissive?: boolean };

/** 材质的默认颜色和质感；模型给了 color 时只换颜色。 */
const LOOKS: Record<SceneMaterial, MaterialLook> = {
    wall: { color: "#f2efe9", roughness: 0.92, metalness: 0 },
    concrete: { color: "#b9b6b0", roughness: 0.95, metalness: 0 },
    brick: { color: "#a65a43", roughness: 0.9, metalness: 0 },
    stone: { color: "#8f8a82", roughness: 0.85, metalness: 0 },
    marble: { color: "#e9e6e1", roughness: 0.3, metalness: 0.05 },
    tile: { color: "#d9d6d0", roughness: 0.5, metalness: 0 },
    wood: { color: "#c8a27a", roughness: 0.7, metalness: 0 },
    "wood-dark": { color: "#6b4a33", roughness: 0.65, metalness: 0 },
    glass: { color: "#a8c8d8", roughness: 0.05, metalness: 0.1, opacity: 0.35 },
    metal: { color: "#c0c4c8", roughness: 0.3, metalness: 0.8 },
    "metal-dark": { color: "#2b2d30", roughness: 0.4, metalness: 0.6 },
    roof: { color: "#3e4247", roughness: 0.8, metalness: 0.05 },
    fabric: { color: "#d8d2c6", roughness: 1, metalness: 0 },
    leather: { color: "#7a5236", roughness: 0.6, metalness: 0 },
    grass: { color: "#7fa865", roughness: 1, metalness: 0 },
    soil: { color: "#7a5c42", roughness: 1, metalness: 0 },
    water: { color: "#5fa8c9", roughness: 0.1, metalness: 0.1, opacity: 0.55 },
    plant: { color: "#4f8a4a", roughness: 0.9, metalness: 0 },
    light: { color: "#fff4d6", roughness: 0.4, metalness: 0, emissive: true },
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
 * 放到场景里时整组平移到起点、绕 y 轴转到终点方向。窗洞补一块玻璃和一圈深色窗框。
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

function geometryFor(object: SceneObject): BufferGeometry {
    switch (object.shape) {
        case "wall":
            throw new Error("墙由 wallGeometries 生成");
        case "box": {
            const [width, height, depth] = object.size!;
            return new BoxGeometry(width, height, depth);
        }
        case "prism": {
            // 横截面是等腰三角形（底边在下），沿 z 方向延伸，用来做坡屋顶。
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
            return new CylinderGeometry(object.radius!, object.radius!, object.height!, 24);
        case "cone":
            return new ConeGeometry(object.radius!, object.height!, 24);
        case "sphere":
            return new SphereGeometry(object.radius!, 24, 16);
    }
}

/**
 * 把场景数据搭成 three.js 的物体树：同样的材质和颜色共用一个材质对象，每个 group 一个子节点（方便隐藏）。
 * 返回 dispose，换场景或离开时释放几何体和材质。
 */
function buildSceneRoot(scene: InteriorScene3D) {
    const root = new Group();
    root.name = scene.title;
    const materials = new Map<string, Material>();
    const geometries: BufferGeometry[] = [];
    const groups = new Map<string, Group>();
    const materialFor = (kind: SceneMaterial, color?: string) => {
        const key = `${kind}:${color || ""}`;
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
                ...(look.emissive ? { emissive: tint, emissiveIntensity: 0.9 } : {}),
            });
            material.name = kind;
            materials.set(key, material);
        }
        return material;
    };
    const meshOf = (geometry: BufferGeometry, kind: SceneMaterial, color?: string) => {
        const mesh = new Mesh(geometry, materialFor(kind, color));
        mesh.castShadow = LOOKS[kind].opacity === undefined;
        mesh.receiveShadow = true;
        return mesh;
    };
    let meshes = 0;
    for (const object of scene.objects) {
        if (meshes >= SCENE_MAX_MESHES) break;
        // 先搭出一份（墙连同门窗是一组），repeat 时按步长复制这一份，几何体共用。
        const template = new Group();
        if (object.shape === "wall") {
            const parts = wallGeometries(object);
            geometries.push(parts.wall, ...parts.windows.map((item) => item.geometry));
            template.add(meshOf(parts.wall, object.material, object.color));
            for (const item of parts.windows) template.add(meshOf(item.geometry, item.kind === "glass" ? "glass" : "metal-dark"));
            template.position.copy(parts.origin);
            template.rotation.y = parts.angle;
        } else {
            const geometry = geometryFor(object);
            geometries.push(geometry);
            template.add(meshOf(geometry, object.material, object.color));
            template.position.set(...object.position!);
            if (object.rotation) template.rotation.copy(new Euler(object.rotation[0] * DEGREE, object.rotation[1] * DEGREE, object.rotation[2] * DEGREE));
        }
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
    const [groundWidth, groundDepth] = scene.ground.size;
    const groundGeometry = new PlaneGeometry(groundWidth, groundDepth);
    geometries.push(groundGeometry);
    const ground = new Mesh(groundGeometry, materialFor(scene.ground.material));
    ground.name = "地面";
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.005;
    ground.receiveShadow = true;
    root.add(ground);
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
    const distance = span * 1.25;
    const position = view === "top" ? new Vector3(center.x, center.y + distance * 1.4, center.z + 0.01) : new Vector3(center.x + distance * 0.75, center.y + distance * 0.65, center.z + distance);
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

/** 可以拖动旋转、滚轮缩放、右键平移的三维模型；能按分组隐藏、切到俯视、全屏，下载 GLB（通用三维格式）或场景数据。 */
export function InteriorSceneViewer({ scene, className, onError }: { scene: InteriorScene3D; className?: string; onError?: (message: string) => void }) {
    const built = useMemo(() => buildSceneRoot(scene), [scene]);
    useEffect(() => () => built.dispose(), [built]);
    const groups = useMemo(() => sceneGroups(scene), [scene]);
    const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
    const [view, setView] = useState<ViewMode>("orbit");
    const [labels, setLabels] = useState(true);
    const [resetKey, setResetKey] = useState(0);
    const [exporting, setExporting] = useState(false);
    const frameRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        setHidden(new Set());
        setView("orbit");
    }, [scene]);
    useEffect(() => {
        for (const [name, group] of built.groups) group.visible = !hidden.has(name);
    }, [built, hidden]);

    // 相机按整个模型的包围盒取景，不信模型自己写的机位。
    const box = useMemo(() => new Box3().setFromObject(built.root), [built]);
    const camera = useMemo(() => cameraFor(box, view), [box, view]);
    const span = Math.max(...box.getSize(new Vector3()).toArray(), 4);
    const visibleLabels = labels ? scene.labels : [];

    const toggleGroup = (name: string) =>
        setHidden((current) => {
            const next = new Set(current);
            if (next.has(name)) next.delete(name);
            else next.add(name);
            return next;
        });
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
    const fullscreen = () => {
        const frame = frameRef.current;
        if (!frame) return;
        if (document.fullscreenElement) void document.exitFullscreen();
        else void frame.requestFullscreen?.().catch(() => onError?.("浏览器不允许全屏"));
    };

    return (
        <div ref={frameRef} className={cn("itd-scene-frame", className)}>
            <Canvas key={`${view}-${resetKey}`} shadows dpr={[1, 2]} gl={{ antialias: true, alpha: true }} camera={{ position: camera.position, fov: 42, near: 0.05, far: camera.far }} aria-label={`${scene.title}，可以拖动旋转、滚轮缩放`}>
                <hemisphereLight args={["#ffffff", "#8d8577", 0.85]} />
                <directionalLight
                    castShadow
                    position={[camera.target[0] + span * 0.6, camera.target[1] + span * 1.1, camera.target[2] + span * 0.4]}
                    intensity={1.6}
                    shadow-mapSize={[2048, 2048]}
                    shadow-camera-left={-span}
                    shadow-camera-right={span}
                    shadow-camera-top={span}
                    shadow-camera-bottom={-span}
                    shadow-camera-far={span * 4}
                    shadow-bias={-0.0004}
                />
                <primitive object={built.root} dispose={null} />
                {visibleLabels.map((label, index) => (
                    <Html key={`${label.text}-${index}`} position={label.position} center zIndexRange={[20, 0]}>
                        <span className="itd-scene-label">{label.text}</span>
                    </Html>
                ))}
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
                {scene.labels.length ? (
                    <button type="button" className="itd-scene-tool" aria-pressed={labels} onClick={() => setLabels((value) => !value)} title={labels ? "隐藏标注" : "显示标注"}>
                        {labels ? <Eye className="size-4" aria-hidden /> : <EyeOff className="size-4" aria-hidden />}
                    </button>
                ) : null}
                <button type="button" className="itd-scene-tool" onClick={fullscreen} title="全屏" aria-label="全屏">
                    <Maximize2 className="size-4" aria-hidden />
                </button>
                <span className="itd-scene-tool-gap" aria-hidden />
                <button type="button" className="itd-scene-tool is-text" disabled={exporting} onClick={() => void exportGlb()} title="下载 GLB，可以在 Blender、SketchUp 等软件里打开">
                    <Download className="size-4" aria-hidden />
                    GLB
                </button>
                <button type="button" className="itd-scene-tool is-text" onClick={exportJson} title="下载场景数据">
                    JSON
                </button>
            </div>
            {groups.length > 1 ? (
                <div className="itd-scene-groups" role="group" aria-label="按分组显示">
                    {groups.map((name) => (
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
