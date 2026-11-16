import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, GizmoHelper, GizmoViewport, OrbitControls, OrthographicCamera } from "@react-three/drei";
import { Component, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { OrthographicCamera as ThreeOrthographicCamera, PerspectiveCamera } from "three";
import type { OrbitControls as ThreeOrbitControls } from "three-stdlib";
import { Download, Maximize2, Move, Pause, Play, RotateCcw, Rotate3D, Sparkles } from "lucide-react";
import { buildPackagingScene, buildPackagingTextures, packagingCamera, type PackagingScene } from "@/lib/packaging/scene";
import { downloadPackaging, packagingGlb } from "@/lib/packaging/delivery";
import type { PackagingDocument, PackagingLayout } from "@/lib/packaging/types";
import { renderPackagingAnimation, renderPackagingPng } from "@/lib/packaging/render";
import { packagingMotionBounds } from "@/lib/packaging/animation";
import { captureUserSession, assertCurrentUserSession } from "@/lib/user-scope";
import { packagingResourceIds } from "@/lib/packaging/layers";
import { packagingEnvironment, packagingSurface, packagingStudios } from "@/lib/packaging/surface";

type Axis = "front" | "back" | "left" | "right" | "top" | "bottom" | "iso";
type Props = {
    document: PackagingDocument;
    layout: PackagingLayout;
    images: Map<string, HTMLImageElement>;
    imageRevision: number;
    onChange: (view: Partial<PackagingDocument["view"]>) => void;
    onError: (message: string) => void;
    name: string;
    onMockup?: (blob: Blob) => void;
    mockupDisabled?: boolean;
};

class PreviewBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
    state = { failed: false };
    static getDerivedStateFromError() {
        return { failed: true };
    }
    render() {
        if (this.state.failed)
            return (
                <div className="pkg-empty" role="alert">
                    <p>三维预览无法启动。刀版与项目保存仍可使用。</p>
                    <button type="button" onClick={() => this.setState({ failed: false })}>
                        重新启动预览
                    </button>
                </div>
            );
        return this.props.children;
    }
}

function ModelScene({
    built,
    doc,
    axis,
    move,
    rotate,
    playing,
    cameraRef,
}: {
    built: PackagingScene;
    doc: PackagingDocument;
    axis: { value: Axis; seq: number };
    move: boolean;
    rotate: boolean;
    playing: boolean;
    cameraRef: RefObject<PerspectiveCamera | ThreeOrthographicCamera | null>;
}) {
    const { camera, size, invalidate, gl, scene } = useThree();
    const studio = packagingStudios[packagingSurface(doc).studio];
    useEffect(() => {
        const environment = packagingEnvironment(gl);
        scene.environment = environment.texture;
        invalidate();
        return () => {
            scene.environment = null;
            environment.dispose();
        };
    }, [gl, scene, invalidate]);
    const controls = useRef<ThreeOrbitControls>(null);
    const motionBounds = useMemo(() => packagingMotionBounds(built, doc.view.fold, doc.view.open), [built]);
    const framingMotion = playing || doc.view.fold < 1 || doc.view.open > 0;
    useEffect(() => {
        cameraRef.current = camera;
        return () => {
            cameraRef.current = null;
        };
    }, [camera, cameraRef]);
    useEffect(() => {
        built.apply(doc.view.fold, doc.view.open);
        invalidate();
    }, [built, doc.view.fold, doc.view.open, invalidate]);
    useEffect(() => {
        const framing = packagingCamera(built.root, size.width / size.height, axis.value, framingMotion ? motionBounds : undefined);
        camera.position.copy(framing.position);
        camera.near = Math.max(0.1, framing.span / 20);
        camera.far = Math.max(1000, framing.span * 20);
        if (camera instanceof ThreeOrthographicCamera) {
            camera.zoom = Math.min(size.width, size.height) / (framing.radius * 2.2);
            camera.updateProjectionMatrix();
        }
        if (camera instanceof PerspectiveCamera) camera.updateProjectionMatrix();
        camera.lookAt(framing.center);
        if (controls.current) {
            controls.current.target.copy(framing.center);
            controls.current.update();
        }
        invalidate();
    }, [built, axis, camera, size.width, size.height, invalidate, framingMotion, motionBounds]);
    useFrame(() => {
        if (!rotate || !controls.current) return;
        controls.current.update();
        invalidate();
    });
    return (
        <>
            <ambientLight intensity={doc.view.light * 0.8 * studio.energy} color={studio.fill} />
            <directionalLight
                position={[400, 650, -500]}
                intensity={doc.view.light * 2}
                color={studio.key}
                castShadow
                shadow-bias={-0.0002}
                shadow-normalBias={0.1}
                shadow-mapSize={[2048, 2048]}
                shadow-camera-left={-1000}
                shadow-camera-right={1000}
                shadow-camera-top={1000}
                shadow-camera-bottom={-1000}
            />
            <directionalLight position={[-350, 200, 300]} intensity={doc.view.light * 0.5} color={studio.fill} />
            <primitive object={built.root} />
            {doc.view.shadows ? (
                <ContactShadows position={[0, -2, 0]} opacity={0.35} scale={Math.max(doc.parameters.length, doc.parameters.width, doc.parameters.height) * 5} blur={2} far={Math.max(doc.parameters.height * 2, 200)} resolution={512} />
            ) : null}
            <OrbitControls ref={controls} makeDefault enableRotate={!move} enablePan enableDamping autoRotate={rotate} minDistance={10} maxDistance={10000} />
            <GizmoHelper alignment="top-right" margin={[58, 60]}>
                <GizmoViewport axisColors={["#d57c86", "#9cb95b", "#819ecb"]} labelColor="#20252c" />
            </GizmoHelper>
        </>
    );
}

export function PackagingViewport(props: Props) {
    const [axis, setAxis] = useState({ value: "iso" as Axis, seq: 0 });
    const [move, setMove] = useState(false);
    const [rotate, setRotate] = useState(false);
    const [playing, setPlaying] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [resolution, setResolution] = useState(2048);
    const [videoProgress, setVideoProgress] = useState<number>();
    const videoOperation = useRef<AbortController>(null);
    const mounted = useRef(true);
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
            videoOperation.current?.abort();
        };
    }, []);
    const host = useRef<HTMLDivElement>(null);
    const camera = useRef<PerspectiveCamera | ThreeOrthographicCamera>(null);
    const ready = packagingResourceIds(props.document).every((id) => props.images.has(id));
    const surface = packagingSurface(props.document);
    const textures = useMemo(
        () => (ready ? buildPackagingTextures(props.document, props.layout, props.images, surface.quality) : undefined),
        [props.document.artworks, props.document.material, props.layout, props.imageRevision, surface.quality, surface.paper, surface.film, surface.foilColor, surface.silverColor, surface.inspection, ready],
    );
    const built = useMemo(() => buildPackagingScene(props.document, props.layout, textures), [props.layout, props.document.material, props.document.view.finish, surface.depth, surface.film, surface.inspection, textures]);
    useEffect(() => () => built.dispose(), [built]);
    useEffect(
        () => () => {
            if (textures) Object.values(textures).forEach((texture) => texture?.dispose());
        },
        [textures],
    );
    useEffect(() => {
        if (!playing) return;
        const started = performance.now();
        const timer = window.setInterval(() => {
            const fold = Math.min(1, (performance.now() - started) / 3500);
            props.onChange({ fold });
            if (fold === 1) setPlaying(false);
        }, 40);
        return () => window.clearInterval(timer);
    }, [playing]);
    const exportFile = async (kind: "png" | "glb" | "animation" | "video") => {
        if (!ready) {
            props.onError("图稿尚未加载完成，暂不能导出");
            return;
        }
        const session = captureUserSession();
        const controller = new AbortController();
        videoOperation.current = controller;
        setExporting(true);
        setPlaying(false);
        setRotate(false);
        try {
            if (kind === "video") {
                setVideoProgress(0);
                const capturedTextures = textures
                    ? {
                          artwork: textures.artwork.clone(),
                          foil: textures.foil?.clone(),
                          uv: textures.uv?.clone(),
                          emboss: textures.emboss?.clone(),
                          coat: textures.coat?.clone(),
                          normal: textures.normal?.clone(),
                          holo: textures.holo?.clone(),
                          inspection: textures.inspection?.clone(),
                      }
                    : undefined;
                const scene = buildPackagingScene(props.document, props.layout, capturedTextures);
                try {
                    const blob = await renderPackagingAnimation(scene, props.document, Math.min(resolution, 2048), axis.value, AbortSignal.any([controller.signal, session.signal]), setVideoProgress);
                    assertCurrentUserSession(session);
                    controller.signal.throwIfAborted();
                    downloadPackaging(blob, `${props.name}-折叠开合`, blob.type === "video/mp4" ? "mp4" : "webm");
                } finally {
                    scene.dispose();
                    if (capturedTextures) Object.values(capturedTextures).forEach((texture) => texture?.dispose());
                }
                return;
            }
            if (kind !== "png") {
                if (kind === "animation" && props.layout.panels.some((p) => p.surface)) throw new Error("袋体曲面动画不能导出为铰链动画，请导出当前 GLB 姿态");
                const blob = await packagingGlb(built.root, props.layout, kind === "animation");
                assertCurrentUserSession(session);
                controller.signal.throwIfAborted();
                downloadPackaging(blob, `${props.name}${kind === "animation" ? "-折叠开合" : ""}`, "glb");
                return;
            }
            const blob = await renderPackagingPng(built.root, props.document, resolution, axis.value);
            assertCurrentUserSession(session);
            controller.signal.throwIfAborted();
            downloadPackaging(blob, props.name, "png");
        } catch (e) {
            if (!controller.signal.aborted && !session.signal.aborted && mounted.current) props.onError(e instanceof Error ? e.message : "导出失败");
        } finally {
            if (mounted.current && !session.signal.aborted) {
                setExporting(false);
                setVideoProgress(undefined);
            }
            videoOperation.current = null;
        }
    };
    return (
        <section className="pkg-model" ref={host}>
            <header>
                <div>
                    <strong>3D 成品预览</strong>
                    <span>{ready ? "拖动旋转 · 滚轮缩放" : "图稿加载中"}</span>
                </div>
                <button
                    type="button"
                    className="pkg-icon"
                    title="全屏预览"
                    onClick={() => {
                        void host.current?.requestFullscreen().catch((e: Error) => props.onError(e.message));
                    }}
                >
                    <Maximize2 size={16} />
                </button>
            </header>
            <div className={`pkg-three is-${props.document.view.background}`}>
                <PreviewBoundary>
                    <Canvas frameloop="demand" shadows camera={{ fov: 40, near: 0.01, far: 10000, position: [400, 300, -500] }} gl={{ alpha: true, antialias: true }}>
                        {props.document.view.projection === "orthographic" ? <OrthographicCamera makeDefault position={[400, 300, -500]} near={0.01} far={10000} /> : null}
                        <ModelScene built={built} doc={props.document} axis={axis} move={move} rotate={rotate} playing={playing} cameraRef={camera} />
                    </Canvas>
                </PreviewBoundary>
                <div className="pkg-camera-actions">
                    {(
                        [
                            ["front", "前"],
                            ["back", "后"],
                            ["left", "左"],
                            ["right", "右"],
                            ["top", "顶"],
                            ["bottom", "底"],
                            ["iso", "等轴"],
                        ] as [Axis, string][]
                    ).map(([value, label]) => (
                        <button type="button" key={value} aria-pressed={axis.value === value} onClick={() => setAxis((v) => ({ value, seq: v.seq + 1 }))}>
                            {label}
                        </button>
                    ))}
                </div>
            </div>
            <div className="pkg-model-controls">
                <div className="pkg-control-row">
                    <label>
                        折叠 <output>{Math.round(props.document.view.fold * 100)}%</output>
                    </label>
                    <input
                        aria-label="折叠进度"
                        type="range"
                        min={0}
                        max={1}
                        step={0.01}
                        value={props.document.view.fold}
                        onChange={(e) => {
                            setPlaying(false);
                            props.onChange({ fold: Number(e.target.value) });
                        }}
                    />
                    <button
                        type="button"
                        className="pkg-icon"
                        aria-label={playing ? "暂停折叠" : "播放折叠"}
                        title={playing ? "暂停折叠" : "播放折叠"}
                        onClick={() => {
                            if (!playing) props.onChange({ fold: 0, open: 0 });
                            setPlaying((v) => !v);
                        }}
                    >
                        {playing ? <Pause size={16} /> : <Play size={16} />}
                    </button>
                </div>
                <div className="pkg-control-row">
                    <label>
                        开合 <output>{Math.round(props.document.view.open * 100)}%</output>
                    </label>
                    <input aria-label="开合进度" type="range" min={0} max={1} step={0.01} value={props.document.view.open} onChange={(e) => props.onChange({ open: Number(e.target.value) })} />
                </div>
                <div className="pkg-toolbar">
                    <button type="button" aria-pressed={move} onClick={() => setMove((v) => !v)}>
                        <Move size={15} />
                        平移
                    </button>
                    <button type="button" aria-pressed={rotate} onClick={() => setRotate((v) => !v)}>
                        <Rotate3D size={15} />
                        自动转动
                    </button>
                    <button type="button" onClick={() => setAxis((v) => ({ value: "iso", seq: v.seq + 1 }))}>
                        <RotateCcw size={15} />
                        复位
                    </button>
                    <select aria-label="投影方式" value={props.document.view.projection} onChange={(e) => props.onChange({ projection: e.target.value as PackagingDocument["view"]["projection"] })}>
                        <option value="perspective">透视</option>
                        <option value="orthographic">正交</option>
                    </select>
                </div>
                <div className="pkg-toolbar">
                    {props.onMockup ? (
                        <button
                            type="button"
                            data-requires-login
                            disabled={exporting || !ready || props.mockupDisabled}
                            title="保存当前方案后，以此视角生成包装效果图"
                            onClick={() => {
                                setExporting(true);
                                setPlaying(false);
                                setRotate(false);
                                void renderPackagingPng(built.root, props.document, 1024, axis.value, camera.current ?? undefined)
                                    .then(props.onMockup)
                                    .catch((error: unknown) => props.onError(error instanceof Error ? error.message : "包装参考图生成失败"))
                                    .finally(() => setExporting(false));
                            }}
                        >
                            <Sparkles size={15} />
                            用此视角生成效果图
                        </button>
                    ) : null}
                    <select aria-label="导出图片尺寸" value={resolution} onChange={(e) => setResolution(Number(e.target.value))}>
                        <option value={1024}>1K</option>
                        <option value={2048}>2K</option>
                        <option value={4096}>4K</option>
                    </select>
                    <button
                        type="button"
                        disabled={exporting || !ready}
                        data-requires-login
                        onClick={() => {
                            void exportFile("png").catch((e: Error) => props.onError(e.message));
                        }}
                    >
                        <Download size={15} />
                        PNG
                    </button>
                    <button
                        type="button"
                        disabled={exporting || !ready}
                        data-requires-login
                        onClick={() => {
                            void exportFile("glb").catch((e: Error) => props.onError(e.message));
                        }}
                    >
                        GLB
                    </button>
                    <button
                        type="button"
                        disabled={exporting || !ready || props.layout.panels.some((p) => p.surface)}
                        data-requires-login
                        onClick={() => {
                            void exportFile("animation").catch((e: Error) => props.onError(e.message));
                        }}
                    >
                        动画 GLB
                    </button>
                    <button type="button" data-requires-login disabled={exporting || !ready} onClick={() => void exportFile("video")}>
                        {videoProgress === undefined ? "动画视频" : `录制 ${videoProgress}%`}
                    </button>
                    {videoProgress !== undefined ? (
                        <button type="button" onClick={() => videoOperation.current?.abort()}>
                            取消录制
                        </button>
                    ) : null}
                </div>
                <p className="pkg-help">动画视频：8 秒折叠与开合，最高 2K，下载 MP4 / WebM；录制期间保持此页打开。动画 GLB 需在三维软件中播放，袋体曲面请导出视频。</p>
                {props.onMockup && props.mockupDisabled ? <p className="pkg-help">保存当前方案后可生成效果图；后台需开放包装写入与模型效果图。</p> : null}
            </div>
        </section>
    );
}
