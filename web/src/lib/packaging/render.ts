import { AmbientLight, Color, DirectionalLight, Mesh, OrthographicCamera, PerspectiveCamera, PlaneGeometry, Scene, ShadowMaterial, WebGLRenderer, type Box3, type Group } from "three";
import { packagingCamera, type PackagingScene } from "./scene";
import { packagingAnimationDuration, packagingAnimationPose, packagingMotionBounds } from "./animation";
import type { PackagingDocument } from "./types";

export type PackagingCameraAxis = "front" | "back" | "left" | "right" | "top" | "bottom" | "iso";

function packagingRender(root: Group, document: PackagingDocument, resolution: number, axis: PackagingCameraAxis, activeCamera?: PerspectiveCamera | OrthographicCamera, bounds?: Box3) {
    const renderer = new WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(resolution, resolution);
    renderer.setPixelRatio(1);
    const scene = new Scene();
    if (document.view.background !== "transparent") scene.background = new Color(document.view.background === "dark" ? "#202329" : "#f5f2ec");
    scene.add(root);
    const light = new DirectionalLight("#ffffff", document.view.light * 2);
    light.position.set(400, 650, -500);
    const groundGeometry = new PlaneGeometry(10000, 10000);
    const groundMaterial = new ShadowMaterial({ opacity: 0.22 });
    if (document.view.shadows) {
        renderer.shadowMap.enabled = true;
        light.castShadow = true;
        light.shadow.bias = -0.0002;
        light.shadow.normalBias = 0.1;
        light.shadow.mapSize.set(2048, 2048);
        light.shadow.camera.left = -1500;
        light.shadow.camera.right = 1500;
        light.shadow.camera.top = 1500;
        light.shadow.camera.bottom = -1500;
        light.shadow.camera.far = 5000;
        const ground = new Mesh(groundGeometry, groundMaterial);
        ground.rotation.x = -Math.PI / 2;
        ground.position.y = -2;
        ground.receiveShadow = true;
        scene.add(ground);
    }
    scene.add(light, new AmbientLight("#ffffff", document.view.light));
    const framing = packagingCamera(root, 1, axis, bounds);
    const camera = activeCamera?.clone() ?? (document.view.projection === "orthographic" ? new OrthographicCamera(-framing.span, framing.span, framing.span, -framing.span, 0.01, 10000) : new PerspectiveCamera(40, 1, 0.01, 10000));
    if (!activeCamera) {
        camera.near = Math.max(0.1, framing.span / 20);
        camera.far = Math.max(1000, framing.span * 20);
        camera.position.copy(framing.position);
        camera.lookAt(framing.center);
    }
    if (camera instanceof PerspectiveCamera) camera.aspect = 1;
    if (activeCamera && camera instanceof OrthographicCamera) {
        camera.left = camera.bottom;
        camera.right = camera.top;
    }
    camera.updateProjectionMatrix();
    return {
        renderer,
        draw: () => renderer.render(scene, camera),
        dispose: () => {
            groundGeometry.dispose();
            groundMaterial.dispose();
            renderer.dispose();
            renderer.forceContextLoss();
        },
    };
}

export async function renderPackagingPng(root: Group, document: PackagingDocument, resolution: number, axis: PackagingCameraAxis, activeCamera?: PerspectiveCamera | OrthographicCamera) {
    const render = packagingRender(root.clone(true), document, resolution, axis, activeCamera);
    try {
        render.draw();
        return await new Promise<Blob>((resolve, reject) => render.renderer.domElement.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("PNG 编码失败"))), "image/png"));
    } finally {
        render.dispose();
    }
}

export async function renderPackagingAnimation(built: PackagingScene, document: PackagingDocument, resolution: number, axis: PackagingCameraAxis, signal: AbortSignal, onProgress: (progress: number) => void) {
    if (typeof MediaRecorder === "undefined") throw new Error("当前浏览器不支持动画视频录制，请使用 Chrome 或下载动画 GLB");
    const mimeType = ["video/mp4;codecs=avc1.42E01E", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((type) => MediaRecorder.isTypeSupported(type));
    if (!mimeType) throw new Error("当前浏览器没有可用的视频编码器，请下载动画 GLB");
    signal.throwIfAborted();
    const render = packagingRender(
        built.root,
        { ...document, view: { ...document.view, background: document.view.background === "transparent" ? "light" : document.view.background } },
        resolution,
        axis,
        undefined,
        packagingMotionBounds(built, document.view.fold, document.view.open),
    );
    try {
        const stream = render.renderer.domElement.captureStream(30);
        try {
            const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
            const chunks: Blob[] = [];
            const stop = () => {
                if (recorder.state !== "inactive") recorder.stop();
            };
            signal.addEventListener("abort", stop, { once: true });
            try {
                built.apply(0, 0);
                render.draw();
                return await new Promise<Blob>((resolve, reject) => {
                    recorder.ondataavailable = (event) => {
                        if (event.data.size) chunks.push(event.data);
                    };
                    recorder.onerror = () => {
                        clearInterval(timer);
                        reject(new Error("动画视频编码失败"));
                    };
                    recorder.onstop = () => {
                        clearInterval(timer);
                        if (signal.aborted) {
                            reject(signal.reason);
                            return;
                        }
                        if (!chunks.length) {
                            reject(new Error("动画视频未生成内容"));
                            return;
                        }
                        resolve(new Blob(chunks, { type: mimeType.split(";")[0] }));
                    };
                    recorder.start();
                    const started = performance.now();
                    const timer = window.setInterval(() => {
                        const elapsed = (performance.now() - started) / 1000;
                        const pose = packagingAnimationPose(elapsed);
                        built.apply(pose.fold, pose.open);
                        render.draw();
                        onProgress(Math.min(100, Math.round((elapsed / packagingAnimationDuration) * 100)));
                        if (elapsed >= packagingAnimationDuration + 0.3) stop();
                    }, 1000 / 30);
                });
            } finally {
                signal.removeEventListener("abort", stop);
                stop();
            }
        } finally {
            stream.getTracks().forEach((track) => track.stop());
        }
    } finally {
        render.dispose();
    }
}
