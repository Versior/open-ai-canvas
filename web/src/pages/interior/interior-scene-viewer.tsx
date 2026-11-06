import { Html, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree, type RootState } from "@react-three/fiber";
import { Box as BoxIcon, Building, Download, Eye, EyeOff, Image as ImageIcon, ImagePlay, Layers, Maximize2, RotateCcw, Ruler, Sparkles, Square } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Box3, DoubleSide, HalfFloatType, Matrix4, NeutralToneMapping, PMREMGenerator, Raycaster, SRGBColorSpace, TextureLoader, Vector3, WebGLRenderTarget, type Material, type Mesh, type Object3D, type Texture } from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import type { SceneLabel } from "@/lib/interior/scene-3d";
import { renderModel, type SceneDimension } from "@/lib/interior/scene-compile";
import type { InteriorSceneData } from "@/lib/interior/scene-spec";
import { cn } from "@/lib/utils";
import { applyCutaway, buildSceneRoot, DIMENSION_GROUP, type FacadeNode } from "./interior-scene-three";

type ViewMode = "orbit" | "top";

/** 取景：建筑从东南方斜上方看；户型和房间看得更俯一些（约 57 度），剖开的外墙正好朝向镜头，内墙挡住的也少。 */
export function cameraFor(box: Box3, view: ViewMode, interior: boolean) {
    const center = box.getCenter(new Vector3());
    const size = box.getSize(new Vector3());
    const span = Math.max(size.x, size.y, size.z, 4);
    const distance = span * 1.15;
    const position =
        view === "top"
            ? new Vector3(center.x, center.y + distance * 1.4, center.z + 0.01)
            : interior
              ? new Vector3(center.x + distance * 0.46, center.y + distance * 1.18, center.z + distance * 0.6)
              : new Vector3(center.x + distance * 0.72, center.y + distance * 0.62, center.z + distance);
    return { position: position.toArray() as [number, number, number], target: center.toArray() as [number, number, number], far: span * 20, span };
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
 * 视角变化时最多每 120ms 用射线检查一次。打开「尺寸」时第二行写开间 × 进深和面积。
 */
function SceneLabels({ labels, root, hidden, details }: { labels: SceneLabel[]; root: Object3D; hidden: ReadonlySet<string>; details: boolean }) {
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
            <span className={cn("itd-scene-label", hiddenIndexes.has(index) && "is-occluded")}>
                {label.text}
                {details && label.detail ? <small>{label.detail}</small> : null}
            </span>
        </Html>
    ));
}

/** 尺寸线上的数字（毫米），和图纸上的标注一一对照。 */
function DimensionLabels({ dimensions }: { dimensions: SceneDimension[] }) {
    return dimensions.map((dimension, index) => (
        <Html key={`${dimension.text}-${index}`} position={[(dimension.a[0] + dimension.b[0]) / 2, dimension.y + 0.02, (dimension.a[1] + dimension.b[1]) / 2]} center zIndexRange={[18, 0]}>
            <span className={cn("itd-scene-dimension", dimension.total && "is-total")}>{dimension.text}</span>
        </Html>
    ));
}

/** 环境光照：three 自带的「房间」环境贴图，玻璃、金属、瓷砖有柔和的反光，不依赖外网的 HDR。 */
export function SceneEnvironment() {
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

/** 天光、主光（带柔和阴影）一套：主光放得高，房间里不会被墙投下大片阴影。 */
export function SceneLights({ target, span }: { target: [number, number, number]; span: number }) {
    return (
        <>
            <hemisphereLight args={["#ffffff", "#8d8577", 0.6]} />
            <directionalLight
                castShadow
                position={[target[0] + span * 0.38, target[1] + span * 1.35, target[2] + span * 0.52]}
                intensity={2.0}
                color="#fff6ea"
                shadow-mapSize={[2048, 2048]}
                shadow-camera-left={-span}
                shadow-camera-right={span}
                shadow-camera-top={span}
                shadow-camera-bottom={-span}
                shadow-camera-far={span * 4}
                shadow-bias={-0.0002}
                shadow-normalBias={Math.max(0.02, span / 600)}
                shadow-radius={3}
            />
        </>
    );
}

/**
 * 环境光遮蔽（GTAO）：墙角、家具底下、柜子缝里自然变暗，模型不再像一堆贴了颜色的方块。
 * 接管这一帧的绘制；创建失败（显卡不支持半浮点等）时退回普通绘制。
 */
export function AmbientOcclusion({ enabled, box }: { enabled: boolean; box?: Box3 }) {
    const gl = useThree((state) => state.gl);
    const scene = useThree((state) => state.scene);
    const camera = useThree((state) => state.camera);
    const size = useThree((state) => state.size);
    const pipeline = useMemo(() => {
        if (!enabled) return null;
        try {
            const pixelRatio = gl.getPixelRatio();
            const target = new WebGLRenderTarget(Math.max(1, size.width * pixelRatio), Math.max(1, size.height * pixelRatio), { type: HalfFloatType, samples: 4 });
            const composer = new EffectComposer(gl, target);
            composer.addPass(new RenderPass(scene, camera));
            const ao = new GTAOPass(scene, camera, size.width, size.height);
            ao.updateGtaoMaterial({ radius: 0.4, distanceExponent: 1.2, thickness: 1, scale: 1, samples: 16 });
            // 降噪半径放大一点：窗帘、栏杆这些细长的边缘上不留噪点。
            ao.updatePdMaterial({ radius: 10, rings: 3, samples: 16 });
            ao.blendIntensity = 0.85;
            composer.addPass(ao);
            composer.addPass(new OutputPass());
            return { composer, ao };
        } catch {
            return null;
        }
        // size 变化只调 setSize，不重建。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled, gl, scene, camera]);
    useEffect(() => {
        pipeline?.composer.setSize(size.width, size.height);
    }, [pipeline, size.width, size.height]);
    // 只在模型的包围盒里算遮蔽，背景和远处地面不出噪点。
    useEffect(() => {
        if (pipeline && box) pipeline.ao.setSceneClipBox(box.clone().expandByScalar(0.5));
    }, [pipeline, box]);
    useEffect(() => () => pipeline?.composer.dispose(), [pipeline]);
    const composer = pipeline?.composer;
    useFrame((_, delta) => {
        if (composer) composer.render(delta);
        else gl.render(scene, camera);
    }, 1);
    return null;
}

/** 每帧看一眼镜头方向：朝向镜头的外墙剖开，俯视时不剖。 */
export function CutawayController({ facades, enabled }: { facades: FacadeNode[]; enabled: boolean }) {
    const camera = useThree((state) => state.camera);
    const controls = useThree((state) => state.controls) as unknown as { target?: Vector3 } | null;
    const last = useRef("");
    useEffect(() => {
        last.current = "";
    }, [facades, enabled]);
    useFrame(() => {
        const target = controls?.target || new Vector3();
        const key = `${enabled}:${camera.position.x.toFixed(2)}:${camera.position.y.toFixed(2)}:${camera.position.z.toFixed(2)}:${target.x.toFixed(2)}:${target.z.toFixed(2)}`;
        if (key === last.current) return;
        last.current = key;
        const steep = Math.hypot(camera.position.x - target.x, camera.position.z - target.z) < (camera.position.y - target.y) * 0.3;
        applyCutaway(facades, camera.position, target, enabled && !steep);
    });
    return null;
}

/** 把附图（户型图）按方案里读出来的轴线框铺在平面上，半透明盖在模型上面，图纸和模型哪里没对上一眼就能看出来。 */
function DrawingOverlay({ url, plan, box, y, opacity }: { url: string; plan: [number, number, number, number]; box: [number, number, number, number]; y: number; opacity: number }) {
    const [texture, setTexture] = useState<Texture | null>(null);
    useEffect(() => {
        let alive = true;
        const loader = new TextureLoader();
        loader.setCrossOrigin("use-credentials");
        loader.load(url, (loaded) => {
            loaded.colorSpace = SRGBColorSpace;
            if (alive) setTexture(loaded);
            else loaded.dispose();
        });
        return () => {
            alive = false;
        };
    }, [url]);
    useEffect(() => () => texture?.dispose(), [texture]);
    if (!texture) return null;
    const [x0, z0, x1, z1] = plan;
    const [left, top, right, bottom] = box.map((value) => value / 1000);
    const width = (x1 - x0) / Math.max(0.05, right - left);
    const depth = (z1 - z0) / Math.max(0.05, bottom - top);
    const originX = x0 - left * width;
    const originZ = z0 - top * depth;
    return (
        <mesh position={[originX + width / 2, y, originZ + depth / 2]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={30}>
            <planeGeometry args={[width, depth]} />
            <meshBasicMaterial map={texture} transparent opacity={opacity} depthTest={false} depthWrite={false} side={DoubleSide} toneMapped={false} />
        </mesh>
    );
}

/**
 * 可以拖动旋转、滚轮缩放、右键平移的三维模型；户型和房间朝向镜头的外墙自动剖开，能按楼层和分组隐藏、
 * 剖切看某一层、切到俯视、显示尺寸线、对照附图、全屏，下载 GLB（通用三维格式）或场景数据。
 */
export function InteriorSceneViewer({
    scene,
    className,
    onError,
    onSnapshot,
    snapshotBusy,
    referenceUrl,
}: {
    scene: InteriorSceneData;
    className?: string;
    onError?: (message: string) => void;
    /** 按当前视角截一张图（不带标注），交给调用方去出效果图。 */
    onSnapshot?: (image: Blob) => void;
    snapshotBusy?: boolean;
    /** 用户上传的户型图或照片，用来对照。 */
    referenceUrl?: string;
}) {
    const [cutFloor, setCutFloor] = useState<number | undefined>(undefined);
    const model = useMemo(() => renderModel(scene, { cutFloor }), [scene, cutFloor]);
    const built = useMemo(() => buildSceneRoot(model), [model]);
    useEffect(() => () => built.dispose(), [built]);
    const interior = scene.version === 2 && scene.spec.scope !== "building";
    const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
    const [view, setView] = useState<ViewMode>("orbit");
    const [labels, setLabels] = useState(true);
    const [dimensions, setDimensions] = useState(interior);
    const [cutaway, setCutaway] = useState(true);
    const [quality, setQuality] = useState(true);
    const [drawing, setDrawing] = useState<"off" | "panel" | "overlay">("off");
    const [resetKey, setResetKey] = useState(0);
    const [exporting, setExporting] = useState(false);
    const frameRef = useRef<HTMLDivElement>(null);
    const glRef = useRef<RootState["gl"] | null>(null);
    const floors = scene.version === 2 ? scene.spec.floors.map((floor) => floor.name) : [];
    // 户型只有一层时也能剖切：墙只砌到 1.2 米，转到哪个角度都能看清每个房间。
    const canCut = scene.version === 2 && (scene.spec.scope !== "room" || floors.length > 1);
    const overlayBox = scene.version === 2 ? scene.spec.grid?.image : undefined;
    const overlayPlan = useMemo((): [number, number, number, number] | undefined => {
        if (scene.version !== 2 || !overlayBox) return undefined;
        const grid = scene.spec.grid!;
        const x0 = grid.x.length ? grid.x[0] : model.plan[0];
        const z0 = grid.z.length ? grid.z[0] : model.plan[1];
        const x1 = grid.x.length > 1 ? grid.x[grid.x.length - 1] : grid.width !== undefined ? x0 + grid.width : model.plan[2];
        const z1 = grid.z.length > 1 ? grid.z[grid.z.length - 1] : grid.depth !== undefined ? z0 + grid.depth : model.plan[3];
        return [x0, z0, x1, z1];
    }, [scene, overlayBox, model.plan]);

    useEffect(() => {
        setHidden(new Set());
        setView("orbit");
        setCutFloor(undefined);
        setDrawing("off");
    }, [scene]);
    useEffect(() => {
        for (const [name, group] of built.groups) group.visible = name === DIMENSION_GROUP ? dimensions : !hidden.has(name);
    }, [built, hidden, dimensions]);

    // 相机按整个模型的包围盒取景（剖切时沿用完整模型的取景，切楼层时画面不跳）。
    // 尺寸线在平面外面，取景时先拿掉，不然画面会偏小。
    const frameBox = useRef<{ scene: InteriorSceneData; box: Box3 } | null>(null);
    if (!frameBox.current || frameBox.current.scene !== scene) {
        const dims = built.groups.get(DIMENSION_GROUP);
        if (dims) built.root.remove(dims);
        frameBox.current = { scene, box: new Box3().setFromObject(built.root) };
        if (dims) built.root.add(dims);
    }
    const box = frameBox.current.box;
    const camera = useMemo(() => cameraFor(box, view, interior), [box, view, interior, resetKey]); // eslint-disable-line react-hooks/exhaustive-deps
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
    const toggleDrawing = () => {
        const next = drawing === "off" ? "panel" : drawing === "panel" && overlayBox ? "overlay" : "off";
        if (next === "overlay") setView("top");
        setDrawing(next);
    };
    const exportGlb = async () => {
        setExporting(true);
        const dims = built.groups.get(DIMENSION_GROUP);
        const wasVisible = dims?.visible ?? false;
        if (dims) dims.visible = false;
        try {
            const result = await new GLTFExporter().parseAsync(built.root, { binary: true, onlyVisible: true });
            downloadBlob(new Blob([result as ArrayBuffer], { type: "model/gltf-binary" }), `${safeFileName(scene.title)}.glb`);
        } catch (error) {
            onError?.(error instanceof Error && error.message ? `导出 GLB 失败：${error.message}` : "导出 GLB 失败");
        } finally {
            if (dims) dims.visible = wasVisible;
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
                gl={{ antialias: true, alpha: true, logarithmicDepthBuffer: model.legacy, preserveDrawingBuffer: true, toneMapping: NeutralToneMapping, toneMappingExposure: 1.05 }}
                camera={{ position: camera.position, fov: 40, near: Math.max(0.05, camera.span / 400), far: camera.far }}
                aria-label={`${scene.title}，可以拖动旋转、滚轮缩放`}
                onCreated={(state) => (glRef.current = state.gl)}
            >
                <SceneEnvironment />
                <SceneLights target={camera.target} span={camera.span} />
                <primitive object={built.root} dispose={null} />
                <SceneLabels labels={visibleLabels} root={built.root} hidden={hidden} details={dimensions} />
                {dimensions && model.dimensions.length ? <DimensionLabels dimensions={model.dimensions} /> : null}
                {drawing === "overlay" && referenceUrl && overlayBox && overlayPlan && view === "top" ? <DrawingOverlay url={referenceUrl} plan={overlayPlan} box={overlayBox} y={model.ground.y + 0.05} opacity={0.5} /> : null}
                <CutawayController facades={built.facades} enabled={cutaway} />
                <AmbientOcclusion enabled={quality && !model.legacy} box={box} />
                <OrbitControls makeDefault target={camera.target} enableDamping dampingFactor={0.12} maxPolarAngle={view === "top" ? Math.PI / 2 : Math.PI * 0.49} minDistance={0.5} maxDistance={camera.span * 6} />
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
                {interior && built.facades.length ? (
                    <button type="button" className="itd-scene-tool" aria-pressed={cutaway} onClick={() => setCutaway((value) => !value)} title={cutaway ? "朝向镜头的外墙已剖开，点一下显示全部外墙" : "剖开朝向镜头的外墙，看室内"}>
                        <Building className="size-4" aria-hidden />
                    </button>
                ) : null}
                {canCut ? (
                    <button
                        type="button"
                        className="itd-scene-tool"
                        aria-pressed={cutFloor !== undefined}
                        onClick={toggleCut}
                        title={cutFloor !== undefined ? "退出剖切" : floors.length > 1 || (scene.version === 2 && scene.spec.scope === "building") ? "剖切：去掉屋顶和上面的楼层，看一层的室内" : "剖切：墙只砌到 1.2 米，看清每个房间的布置"}
                    >
                        <Layers className="size-4" aria-hidden />
                    </button>
                ) : null}
                {model.dimensions.length ? (
                    <button type="button" className="itd-scene-tool" aria-pressed={dimensions} onClick={() => setDimensions((value) => !value)} title={dimensions ? "隐藏尺寸" : "显示尺寸线和房间面积"}>
                        <Ruler className="size-4" aria-hidden />
                    </button>
                ) : null}
                {model.labels.length ? (
                    <button type="button" className="itd-scene-tool" aria-pressed={labels} onClick={() => setLabels((value) => !value)} title={labels ? "隐藏标注" : "显示标注"}>
                        {labels ? <Eye className="size-4" aria-hidden /> : <EyeOff className="size-4" aria-hidden />}
                    </button>
                ) : null}
                {referenceUrl ? (
                    <button type="button" className="itd-scene-tool" aria-pressed={drawing !== "off"} onClick={toggleDrawing} title={drawing === "off" ? "对照附图" : drawing === "panel" && overlayBox ? "把附图叠在俯视图上" : "关闭对照"}>
                        <ImageIcon className="size-4" aria-hidden />
                    </button>
                ) : null}
                {!model.legacy ? (
                    <button type="button" className="itd-scene-tool" aria-pressed={quality} onClick={() => setQuality((value) => !value)} title={quality ? "关闭环境光遮蔽（显卡吃力时关掉）" : "打开环境光遮蔽，墙角和家具底下更真实"}>
                        <Sparkles className="size-4" aria-hidden />
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
            {referenceUrl && drawing === "panel" ? (
                <figure className="itd-scene-drawing">
                    <img src={referenceUrl} alt="附图" />
                    <figcaption>{overlayBox ? "再点一次「对照附图」把图纸叠在俯视图上" : "附图（这次的方案没有读出图纸位置，只能并排对照）"}</figcaption>
                </figure>
            ) : null}
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
