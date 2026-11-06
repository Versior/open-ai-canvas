import { Html, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Button } from "antd";
import { Check, LoaderCircle, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { NeutralToneMapping, Vector3, type Group } from "three";
import type { InteriorSceneScope, SceneObject } from "@/lib/interior/scene-3d";
import { compileSceneSpec, type SceneDimension } from "@/lib/interior/scene-compile";
import { readPartialScene, type SceneBuildPhase, type SceneBuildProgress } from "@/lib/interior/scene-stream";
import type { SpecGrid } from "@/lib/interior/scene-spec";
import { cn } from "@/lib/utils";
import { buildSceneRoot, type BuiltScene } from "./interior-scene-three";
import { CutawayController, SceneEnvironment, SceneLights } from "./interior-scene-viewer";

const PHASE_ORDER: SceneBuildPhase[] = ["waiting", "reading", "grid", "rooms", "openings", "furniture", "exterior"];
/** 新长出来的部分用多久从地面升起来。 */
const GROW_MS = 650;

function elapsedText(since: number, now: number) {
    const seconds = Math.max(0, Math.round((now - since) / 1000));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** 只有轴网、房间还没写出来时，先按轴网画两道尺寸线。 */
function gridDimensions(grid: SpecGrid): SceneDimension[] {
    const xs = grid.x.length >= 2 ? grid.x : grid.width ? [0, grid.width] : [];
    const zs = grid.z.length >= 2 ? grid.z : grid.depth ? [0, grid.depth] : [];
    if (!xs.length && !zs.length) return [];
    const x0 = xs[0] ?? 0;
    const z0 = zs[0] ?? 0;
    const mm = (value: number) => String(Math.round(value * 1000));
    const result: SceneDimension[] = [];
    for (let index = 0; index < xs.length - 1; index += 1) result.push({ a: [xs[index], z0 - 1], b: [xs[index + 1], z0 - 1], text: mm(xs[index + 1] - xs[index]), y: 0.01 });
    for (let index = 0; index < zs.length - 1; index += 1) result.push({ a: [x0 - 1, zs[index]], b: [x0 - 1, zs[index + 1]], text: mm(zs[index + 1] - zs[index]), y: 0.01 });
    return result;
}

function keyOf(object: SceneObject) {
    return JSON.stringify(object);
}

/** 镜头慢慢转，同时把取景中心和距离缓缓挪到正在长大的模型上；用户拖动也不打架。 */
function BuildRig({ center, radius }: { center: [number, number, number]; radius: number }) {
    const camera = useThree((state) => state.camera);
    const controls = useThree((state) => state.controls) as unknown as { target: Vector3 } | null;
    const goal = useMemo(() => new Vector3(...center), [center]);
    useFrame((_, delta) => {
        if (!controls) return;
        const k = 1 - Math.exp(-delta * 2.2);
        controls.target.lerp(goal, k);
        const offset = camera.position.clone().sub(controls.target);
        const distance = offset.length();
        offset.setLength(distance + (radius * 2.6 - distance) * k);
        camera.position.copy(controls.target).add(offset);
    });
    return null;
}

/** 新长出来的那一批从地面升起来（整批一起按高度从 0 拉到 1）。 */
function Grow({ group, born }: { group: Group; born: number }) {
    useFrame(() => {
        const t = Math.min(1, (performance.now() - born) / GROW_MS);
        const eased = 1 - (1 - t) ** 3;
        group.scale.y = Math.max(0.001, eased);
    });
    return <primitive object={group} dispose={null} />;
}

type Step = { key: string; label: string; detail?: string; state: "done" | "active" | "todo" };

function buildSteps(progress: SceneBuildProgress, scope: InteriorSceneScope | "auto", hasReference: boolean): Step[] {
    const at = PHASE_ORDER.indexOf(progress.phase);
    const state = (from: SceneBuildPhase, until: SceneBuildPhase): Step["state"] => (at > PHASE_ORDER.indexOf(until) ? "done" : at >= PHASE_ORDER.indexOf(from) ? "active" : "todo");
    const grid = progress.grid;
    const size = grid?.width && grid?.depth ? `${grid.width} × ${grid.depth} 米` : grid?.x.length && grid.z.length ? `${grid.x.length - 1} × ${grid.z.length - 1} 跨` : "";
    const building = (progress.scope || scope) === "building";
    return [
        { key: "read", label: hasReference ? "读图" : "读需求", detail: progress.reading.length ? `${progress.reading.length} 条记录` : "", state: at === 0 ? "active" : state("reading", "reading") },
        { key: "grid", label: "轴网和尺寸", detail: size, state: state("grid", "grid") },
        { key: "rooms", label: "房间", detail: progress.rooms ? `${progress.rooms} 个` : "", state: state("rooms", "rooms") },
        { key: "openings", label: "门窗、柱子", detail: progress.doors + progress.windows ? `${progress.doors} 门 · ${progress.windows} 窗` : "", state: state("openings", "openings") },
        { key: "furniture", label: "家具布置", detail: progress.furniture ? `${progress.furniture} 件` : "", state: state("furniture", "furniture") },
        ...(building ? [{ key: "exterior", label: "屋顶和庭院", state: state("exterior", "exterior") } as Step] : []),
    ];
}

/**
 * 正在生成的 3D 模型：模型的方案边写边读，房间、墙、门窗和家具写出来一样就搭一样，新的部分从地面升起来；
 * 旁边列出 AI 读图记录和每一步的进度、已用时间。没有文字时（推理模型还在想）显示正在看图。
 */
export function InteriorSceneBuildStage({
    text,
    scope,
    startedAt,
    stage,
    stalled,
    referenceUrl,
    onRetry,
}: {
    text: string;
    scope: InteriorSceneScope | "auto";
    startedAt: string;
    stage?: string;
    stalled?: string;
    referenceUrl?: string;
    onRetry?: () => void;
}) {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, []);
    // 系统要求减少动效时不转镜头，新部分直接出现。
    const reducedMotion = useMemo(() => typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches), []);
    const legacyAnalyze = stage === "analyze";
    const parsed = useMemo(() => (legacyAnalyze ? null : readPartialScene(text, scope)), [text, scope, legacyAnalyze]);
    // 读不出来的那一刻沿用上一次读到的方案，预览不闪空。
    const lastGood = useRef<SceneBuildProgress | null>(null);
    if (parsed && (parsed.spec || !lastGood.current?.spec)) lastGood.current = parsed;
    const progress = parsed?.spec ? parsed : lastGood.current || parsed;
    const specKey = progress?.spec ? JSON.stringify(progress.spec) : "";
    const compiled = useMemo(() => (progress?.spec ? compileSceneSpec(progress.spec) : null), [specKey]); // eslint-disable-line react-hooks/exhaustive-deps
    const seen = useRef(new Set<string>());
    const parts = useMemo(() => {
        const dimensions = compiled ? compiled.dimensions : progress?.grid ? gridDimensions(progress.grid) : [];
        if (!compiled) return { base: dimensions.length ? buildSceneRoot({ title: "", objects: [], legacy: false, dimensions }) : null, grow: null as BuiltScene | null, born: performance.now(), dimensions };
        const stable: SceneObject[] = [];
        const fresh: SceneObject[] = [];
        for (const object of compiled.objects) (seen.current.has(keyOf(object)) ? stable : fresh).push(object);
        const base = buildSceneRoot({ title: compiled.title, objects: stable, legacy: false, ground: compiled.ground, dimensions });
        const grow = fresh.length ? buildSceneRoot({ title: "", objects: fresh, legacy: false }) : null;
        return { base, grow, born: reducedMotion ? 0 : performance.now(), dimensions };
        // progress.grid 只在没有房间时用；房间出来以后跟着 compiled 走。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [compiled, compiled ? "" : JSON.stringify(progress?.grid || null)]);
    useEffect(() => {
        if (compiled) seen.current = new Set(compiled.objects.map(keyOf));
    }, [compiled]);
    useEffect(
        () => () => {
            parts.base?.dispose();
            parts.grow?.dispose();
        },
        [parts],
    );
    // 镜头转到哪面，哪面外墙剖开，边搭边能看到屋里。
    const facades = useMemo(() => [...(parts.base?.facades || []), ...(parts.grow?.facades || [])], [parts]);
    const plan =
        compiled?.plan ||
        (progress?.grid ? [progress.grid.x[0] ?? 0, progress.grid.z[0] ?? 0, progress.grid.x[progress.grid.x.length - 1] ?? progress.grid.width ?? 8, progress.grid.z[progress.grid.z.length - 1] ?? progress.grid.depth ?? 8] : [0, 0, 8, 8]);
    const height = progress?.spec ? progress.spec.floors.reduce((sum, floor) => sum + floor.height, 0) : 3;
    const center = useMemo((): [number, number, number] => [(plan[0] + plan[2]) / 2, height / 3, (plan[1] + plan[3]) / 2], [plan[0], plan[1], plan[2], plan[3], height]); // eslint-disable-line react-hooks/exhaustive-deps
    const radius = Math.max(4, Math.hypot(plan[2] - plan[0], plan[3] - plan[1]) / 2 + 1.5, height * 0.9);
    const steps = progress ? buildSteps(progress, scope, Boolean(referenceUrl)) : [];
    const writing = text.length > 0;
    const title = progress?.title || (legacyAnalyze ? "AI 正在分析方案" : stage === "edit" ? "AI 正在按你的要求改" : "AI 正在建模");
    return (
        <div className="itd-build">
            <div className="itd-build-canvas">
                <Canvas
                    shadows
                    dpr={[1, 1.5]}
                    gl={{ antialias: true, alpha: true, toneMapping: NeutralToneMapping }}
                    camera={{ position: [center[0] + radius * 1.2, radius * 2.0, center[2] + radius * 1.5], fov: 40, near: 0.1, far: 400 }}
                    aria-label="正在搭建的 3D 模型"
                >
                    <SceneEnvironment />
                    <SceneLights target={center} span={radius * 2} />
                    {parts.base ? <primitive object={parts.base.root} dispose={null} /> : null}
                    {parts.grow ? <Grow key={parts.born} group={parts.grow.root} born={parts.born} /> : null}
                    {compiled
                        ? compiled.labels.map((label, index) => (
                              <Html key={`${label.text}-${index}`} position={label.position} center zIndexRange={[20, 0]}>
                                  <span className="itd-scene-label is-building">{label.text}</span>
                              </Html>
                          ))
                        : null}
                    {parts.dimensions.map((dimension, index) => (
                        <Html key={`d-${dimension.text}-${index}`} position={[(dimension.a[0] + dimension.b[0]) / 2, dimension.y + 0.02, (dimension.a[1] + dimension.b[1]) / 2]} center zIndexRange={[18, 0]}>
                            <span className={cn("itd-scene-dimension", dimension.total && "is-total")}>{dimension.text}</span>
                        </Html>
                    ))}
                    <BuildRig center={center} radius={radius} />
                    <CutawayController facades={facades} enabled />
                    <OrbitControls makeDefault autoRotate={!reducedMotion} autoRotateSpeed={0.55} enableDamping dampingFactor={0.12} maxPolarAngle={Math.PI * 0.49} />
                </Canvas>
                {!compiled && !progress?.grid ? (
                    <div className="itd-build-waiting" role="status">
                        <LoaderCircle className="size-5 motion-safe:animate-spin" aria-hidden />
                        <span>{writing ? "正在读 AI 写出来的方案" : referenceUrl ? "AI 正在看图、读尺寸标注（推理模型这一步可能要几十秒）" : "AI 正在构思方案（推理模型这一步可能要几十秒）"}</span>
                    </div>
                ) : null}
            </div>
            <aside className="itd-build-panel" aria-live="polite">
                <header>
                    <strong>{title}</strong>
                    <span>
                        已用 {elapsedText(Date.parse(startedAt), now)}
                        {writing ? ` · 已写 ${text.length.toLocaleString("zh-CN")} 字` : ""}
                    </span>
                </header>
                {stalled ? (
                    <div className="itd-build-stalled" role="alert">
                        <span>{stalled}</span>
                        {onRetry ? (
                            <Button size="small" icon={<RefreshCw className="size-3.5" aria-hidden />} onClick={onRetry}>
                                重新查询
                            </Button>
                        ) : null}
                    </div>
                ) : null}
                {legacyAnalyze ? (
                    <p className="itd-build-tail">{text.slice(-240) || "AI 正在看图、读需求、查知识库补全方案"}</p>
                ) : (
                    <ol className="itd-build-steps">
                        {steps.map((step) => (
                            <li key={step.key} className={cn("itd-build-step", `is-${step.state}`)}>
                                <span className="itd-build-step-mark" aria-hidden>
                                    {step.state === "done" ? <Check className="size-3.5" /> : step.state === "active" ? <LoaderCircle className="size-3.5 motion-safe:animate-spin" /> : null}
                                </span>
                                <span className="itd-build-step-label">{step.label}</span>
                                {step.detail ? <small>{step.detail}</small> : null}
                            </li>
                        ))}
                    </ol>
                )}
                {progress?.reading.length ? (
                    <section className="itd-build-reading" aria-label="AI 读图记录">
                        <h3>{referenceUrl ? "AI 读图记录" : "设计思路"}</h3>
                        <ul>
                            {progress.reading.map((line, index) => (
                                <li key={`${index}-${line}`}>{line}</li>
                            ))}
                        </ul>
                    </section>
                ) : null}
                {referenceUrl ? (
                    <figure className="itd-build-reference">
                        <img src={referenceUrl} alt="你的附图" />
                        <figcaption>你的附图</figcaption>
                    </figure>
                ) : null}
                <p className="itd-build-note">离开页面不会中断，回来接着看。</p>
            </aside>
        </div>
    );
}
