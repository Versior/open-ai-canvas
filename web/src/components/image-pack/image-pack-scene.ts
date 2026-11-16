import * as THREE from "three";
import { cardGeometry, packet, packetFrontGeometry } from "./motion-geometry";
import { cardPose, duration, layoutCards, packetPose, smooth } from "./motion-plan";

export type PackImage = { url: string; label: string };
export type PackPhase = "loading" | "opening" | "settling" | "error";
type PackEvent = { phase: "opening" | "error" } | { phase: "settling"; images: Array<{ x: number; y: number; width: number; height: number }> };

export function createImagePackScene(canvas: HTMLCanvasElement, images: readonly PackImage[], anchor: HTMLElement, onPhase: (event: PackEvent) => void) {
    const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);
    const scene = new THREE.Scene();
    const presentation = new THREE.Group();
    const content = new THREE.Group();
    presentation.add(content);
    scene.add(presentation);
    const camera = new THREE.OrthographicCamera(-7, 7, 3.5, -3.5, 0.1, 50);
    let layout = layoutCards(800, 360, images.length);
    let phase: PackPhase = "loading";
    let openedAt = 0;
    let frameId = 0;
    let disposed = false;
    let lastFrame = 0;
    let origin = { x: 0, y: 0, scale: 1, rotation: 0 };
    let firstFrame = true;
    const frameTimes: number[] = [];
    const textures: THREE.Texture[] = [];
    const cards: Array<{ group: THREE.Group; sheen: THREE.Mesh<THREE.ShapeGeometry, THREE.ShaderMaterial>; shadow: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>; imageBounds: [number, number, number, number] }> = [];

    const shadowCanvas = document.createElement("canvas");
    shadowCanvas.width = shadowCanvas.height = 128;
    const shadowCtx = shadowCanvas.getContext("2d")!;
    const shadowGradient = shadowCtx.createRadialGradient(64, 64, 3, 64, 64, 62);
    shadowGradient.addColorStop(0, "#40502f60");
    shadowGradient.addColorStop(1, "#40502f00");
    shadowCtx.fillStyle = shadowGradient;
    shadowCtx.fillRect(0, 0, 128, 128);
    const shadowTexture = new THREE.CanvasTexture(shadowCanvas);
    textures.push(shadowTexture);
    const packShadow = new THREE.Mesh(new THREE.PlaneGeometry(3.7, 0.55), new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false }));
    packShadow.position.set(0, 0.3, -1);
    content.add(packShadow);

    const packetCanvas = document.createElement("canvas");
    packetCanvas.width = 600;
    packetCanvas.height = 800;
    const packetArtwork = new Image();
    packetArtwork.src = new URL("./packet-artwork.svg", import.meta.url).href;
    const packetMap = new THREE.CanvasTexture(packetCanvas);
    packetMap.colorSpace = THREE.SRGBColorSpace;
    textures.push(packetMap);
    const pack = new THREE.Group();
    const front = new THREE.Mesh(packetFrontGeometry(), new THREE.MeshBasicMaterial({ map: packetMap, transparent: true, side: THREE.DoubleSide }));
    pack.add(front);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(packet.width, packet.height), new THREE.MeshBasicMaterial({ color: 0xc4c8ee, transparent: true, side: THREE.DoubleSide }));
    back.position.z = packet.backZ;
    pack.add(back);
    for (const side of [-1, 1]) {
        const wall = new THREE.Mesh(new THREE.BoxGeometry(0.015, packet.height, 0.6), new THREE.MeshBasicMaterial({ color: 0xadb8dd, transparent: true }));
        wall.position.x = (side * packet.width) / 2;
        pack.add(wall);
    }
    pack.add(new THREE.Mesh(new THREE.BoxGeometry(packet.width, 0.13, 0.6), new THREE.MeshBasicMaterial({ color: 0xadb8dd, transparent: true })));
    pack.children[pack.children.length - 1].position.y = -1.7;
    content.add(pack);
    const sealCanvas = document.createElement("canvas");
    sealCanvas.width = 600;
    sealCanvas.height = 55;
    const sealMap = new THREE.CanvasTexture(sealCanvas);
    sealMap.colorSpace = THREE.SRGBColorSpace;
    textures.push(sealMap);
    const sealMaterial = new THREE.MeshBasicMaterial({ map: sealMap, transparent: true, side: THREE.DoubleSide });
    const seal = new THREE.Group();
    const stripGeometry = new THREE.PlaneGeometry(packet.width, 0.22, 40, 1);
    const stripRest = stripGeometry.attributes.position.array.slice();
    seal.add(new THREE.Mesh(stripGeometry, sealMaterial));
    content.add(seal);

    const rainbow = [0xf33991, 0xff8142, 0xffdb49, 0x47d696, 0x36c5ee, 0x6373e9, 0xb84fe5];
    const ribbonCanvas = document.createElement("canvas");
    ribbonCanvas.width = 64;
    ribbonCanvas.height = 256;
    const ribbonCtx = ribbonCanvas.getContext("2d")!;
    const ribbonFade = ribbonCtx.createLinearGradient(0, 256, 0, 0);
    for (const [stop, color] of [
        [0, "#ffffff00"],
        [0.08, "#fffffff2"],
        [0.65, "#fffffff2"],
        [0.85, "#ffffffa0"],
        [1, "#ffffff00"],
    ] as const)
        ribbonFade.addColorStop(stop, color);
    ribbonCtx.fillStyle = ribbonFade;
    ribbonCtx.fillRect(0, 0, 64, 256);
    const ribbonEdge = ribbonCtx.createLinearGradient(0, 0, 64, 0);
    for (const [stop, color] of [
        [0, "#ffffff00"],
        [0.09, "#ffffffff"],
        [0.91, "#ffffffff"],
        [1, "#ffffff00"],
    ] as const)
        ribbonEdge.addColorStop(stop, color);
    ribbonCtx.globalCompositeOperation = "destination-in";
    ribbonCtx.fillStyle = ribbonEdge;
    ribbonCtx.fillRect(0, 0, 64, 256);
    const ribbonTexture = new THREE.CanvasTexture(ribbonCanvas);
    textures.push(ribbonTexture);
    const ribbonViewportHeight = { value: canvas.height };
    const ribbons = Array.from({ length: 14 }, (_, i) => {
        const geometry = new THREE.PlaneGeometry(1, 1, 2, 56);
        geometry.setAttribute("position", new THREE.BufferAttribute(geometry.attributes.position.array, 3).setUsage(THREE.DynamicDrawUsage));
        const ribbon = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ map: ribbonTexture, color: rainbow[i % rainbow.length], side: THREE.DoubleSide, transparent: true, depthWrite: false }));
        ribbon.material.onBeforeCompile = (shader) => {
            shader.uniforms.ribbonViewportHeight = ribbonViewportHeight;
            shader.fragmentShader = "uniform float ribbonViewportHeight;\n" + shader.fragmentShader.replace("#include <alphatest_fragment>", "diffuseColor.a *= smoothstep(0.0, 48.0, ribbonViewportHeight - gl_FragCoord.y);\n#include <alphatest_fragment>");
        };
        ribbon.frustumCulled = false;
        return ribbon;
    });
    const ribbonGroup = new THREE.Group();
    ribbonGroup.add(...ribbons);
    content.add(ribbonGroup);
    const confetti = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.07, 0.1), new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide, depthWrite: false }), 108);
    confetti.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    confetti.frustumCulled = false;
    content.add(confetti);
    let seed = 12;
    const random = () => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed / 4294967296;
    };
    const particles = Array.from({ length: 108 }, (_, i) => {
        confetti.setColorAt(i, new THREE.Color(rainbow[i % rainbow.length]));
        return { vx: (random() - 0.5) * 6.7, vy: 1.8 + random() * 3.4, vz: (random() - 0.5) * 3.2, spin: random() * 8 - 4, size: 0.55 + random() * 1.2, delay: random() * 0.28 };
    });
    const particleTransform = new THREE.Object3D();

    function resize() {
        const width = canvas.clientWidth;
        const height = canvas.clientHeight;
        layout = layoutCards(width, height, images.length);
        camera.left = -layout.worldWidth / 2;
        camera.right = -camera.left;
        camera.top = layout.worldHeight / 2;
        camera.bottom = -camera.top;
        camera.position.set(0, layout.centerY, 14);
        camera.lookAt(0, layout.centerY, 0);
        camera.updateProjectionMatrix();
        renderer.setSize(width, height, false);
        ribbonViewportHeight.value = canvas.height;
        if (phase !== "loading") requestRender();
    }
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    function play() {
        const bounds = anchor.getBoundingClientRect();
        const canvasBounds = canvas.getBoundingClientRect();
        const transform = new DOMMatrix(getComputedStyle(anchor).transform);
        origin = {
            x: ((bounds.left + bounds.width / 2 - canvasBounds.left) / canvasBounds.width - 0.5) * layout.worldWidth,
            y: layout.centerY + (0.5 - (bounds.top + bounds.height / 2 - canvasBounds.top) / canvasBounds.height) * layout.worldHeight,
            scale: (anchor.offsetWidth / canvas.clientWidth) * (layout.worldWidth / packet.width),
            rotation: -Math.atan2(transform.b, transform.a),
        };
        phase = "opening";
        openedAt = performance.now() / 1000;
        frameTimes.length = 0;
        lastFrame = 0;
        requestRender();
    }

    function requestRender() {
        if (!disposed && !frameId) frameId = requestAnimationFrame(animate);
    }

    function animate(timestamp: number) {
        frameId = 0;
        if (disposed) return;
        if (document.hidden) {
            lastFrame = 0;
            return;
        }
        const time = timestamp / 1000;
        const t = reduceMotion ? 6 : time - openedAt;
        canvas.dataset.frame = t.toFixed(3);
        if (phase === "opening" && lastFrame) frameTimes.push(timestamp - lastFrame);
        lastFrame = timestamp;
        const pose = packetPose(layout, t);
        // 在等待袋子的实际位置开包；袋子退出后，整组作品才平滑移向结果区域。
        const settlePresentation = smooth(1.25, 2.35, t);
        content.position.y = -(layout.centerY - 0.65);
        presentation.position.set(origin.x * (1 - settlePresentation), origin.y * (1 - settlePresentation) + (layout.centerY - 0.65) * settlePresentation, 0);
        presentation.scale.setScalar(origin.scale + (1 - origin.scale) * settlePresentation);
        presentation.rotation.z = origin.rotation * (1 - settlePresentation);
        pack.position.set(0, pose.y, 0);
        pack.visible = pose.opacity > 0;
        pack.traverse((object) => {
            if (object instanceof THREE.Mesh) object.material.opacity = pose.opacity;
        });
        packShadow.material.opacity = 0.55 * pose.opacity;
        const tear = smooth(0, 0.35, t);
        seal.position.set(tear * 3.2, layout.centerY + 1.14 + Math.sin(tear * Math.PI) * 0.8 - Math.max(0, t - 0.35) ** 2 * 1.5, 0.31 + tear * 3.2);
        seal.rotation.z = -tear * 1.1;
        sealMaterial.opacity = 1 - smooth(0.65, 1.35, t);
        seal.visible = t < 1.35;
        const stripVertices = stripGeometry.attributes.position;
        for (let i = 0; i < stripVertices.count; i++) {
            const x = stripRest[i * 3];
            stripVertices.setXYZ(i, x, stripRest[i * 3 + 1] + Math.sin(x * 3 + t * 4) * 0.18 * tear, Math.sin(x * 2 + t * 3) * 0.15 * tear);
        }
        stripVertices.needsUpdate = true;
        ribbonGroup.visible = t > 0.32 && t < 2.3 && !reduceMotion;
        ribbonGroup.position.set(0, layout.centerY + 0.65 + 0.32 * smooth(1.3, 2.3, t), -2.5);
        ribbonGroup.scale.setScalar(1.05);
        if (ribbonGroup.visible)
            ribbons.forEach((ribbon, i) => {
                const growth = smooth(0.32 + i * 0.006, 0.72 + i * 0.006, t);
                const uv = ribbon.geometry.attributes.uv,
                    points = ribbon.geometry.attributes.position;
                for (let j = 0; j < points.count; j++) {
                    const s = uv.getY(j),
                        spread = s ** 0.72 * growth;
                    const wave = (Math.sin(s * 17 - t * 6 + i * 0.16) * 0.14 + Math.sin(s * 29 - t * 9 + i * 0.3) * 0.035) * s * growth;
                    points.setXYZ(
                        j,
                        (i - 6.5) * 0.43 * spread + (uv.getX(j) - 0.5) * 0.54 * (0.12 + 0.88 * spread) + wave,
                        s * (2.9 + Math.sin(i * 1.7) * 0.16 + Math.cos(i * 2.9) * 0.09) * growth,
                        -0.65 + Math.sin(s * 14 - t * 5 + i * 0.2) * 0.05 * spread,
                    );
                }
                points.needsUpdate = true;
                ribbon.material.opacity = 0.62 * growth * (1 - smooth(1.25 + i * 0.008, 2.05 + i * 0.008, t));
            });
        cards.forEach((card, i) => {
            const pose = cardPose(layout, i, t);
            card.group.visible = pose.visible;
            card.group.position.set(...pose.position);
            card.group.rotation.set(...pose.rotation);
            card.sheen.material.uniforms.phase.value = ((time * 0.75 + i * 0.19) % 2.5) - 0.5;
            card.sheen.material.uniforms.opacity.value = !reduceMotion && phase === "opening" ? 0.13 * (1 - smooth(1.8, 2.45, t)) : 0;
            card.shadow.position.set(card.group.position.x, card.group.position.y - 1.67, -1);
            card.shadow.material.opacity = pose.settled * 0.4;
        });
        confetti.visible = t > 0.4 && t < duration && !reduceMotion;
        confetti.material.opacity = 0.85 * (1 - smooth(1.75, 2.5, t));
        if (confetti.visible) {
            particles.forEach((particle, i) => {
                const pt = Math.max(0, t - 0.4 - particle.delay);
                particleTransform.position.set(particle.vx * pt * 1.3, layout.centerY + 0.8 + particle.vy * pt * 0.8 - 1.9 * pt * pt, particle.vz * pt * 0.2 + 4.7);
                particleTransform.rotation.set(particle.spin * pt, particle.spin * pt * 0.65, particle.spin * pt * 1.2);
                particleTransform.scale.setScalar(particle.size);
                particleTransform.updateMatrix();
                confetti.setMatrixAt(i, particleTransform.matrix);
            });
            confetti.instanceMatrix.needsUpdate = true;
        }
        renderer.render(scene, camera);
        if (firstFrame) {
            firstFrame = false;
            onPhase({ phase: "opening" });
        }
        if (phase === "opening" && t >= duration) {
            phase = "settling";
            const bounds = canvas.getBoundingClientRect();
            // 将卡片内的照片投影到页面，原图从这些坐标平滑落到真实结果块。
            onPhase({
                phase,
                images: cards.map((card) => {
                    const [left, top, right, bottom] = card.imageBounds;
                    const corners = [
                        [left, top],
                        [right, top],
                        [left, bottom],
                        [right, bottom],
                    ].map(([x, y]) => card.group.localToWorld(new THREE.Vector3(x, y, 0.008)).project(camera));
                    const x = bounds.left + ((Math.min(...corners.map((corner) => corner.x)) + 1) * bounds.width) / 2;
                    const y = bounds.top + ((1 - Math.max(...corners.map((corner) => corner.y))) * bounds.height) / 2;
                    return {
                        x,
                        y,
                        width: ((Math.max(...corners.map((corner) => corner.x)) - Math.min(...corners.map((corner) => corner.x))) * bounds.width) / 2,
                        height: ((Math.max(...corners.map((corner) => corner.y)) - Math.min(...corners.map((corner) => corner.y))) * bounds.height) / 2,
                    };
                }),
            });
            if (frameTimes.length) {
                canvas.dataset.fps = (1000 / (frameTimes.reduce((sum, value) => sum + value, 0) / frameTimes.length)).toFixed(1);
                canvas.dataset.slowFrames = String(frameTimes.filter((value) => value > 34).length);
            }
        }
        if (!reduceMotion && phase === "opening") requestRender();
    }
    function visibilityChange() {
        if (!document.hidden && phase !== "loading") requestRender();
    }
    function contextLost(event: Event) {
        event.preventDefault();
        phase = "error";
        onPhase({ phase: "error" });
        dispose();
    }
    document.addEventListener("visibilitychange", visibilityChange);
    canvas.addEventListener("webglcontextlost", contextLost);

    const sourceImages = images.map((item) => {
        const image = new Image();
        image.crossOrigin = "anonymous";
        image.src = item.url;
        return image;
    });
    const ready = (async () => {
        await Promise.all([packetArtwork, ...sourceImages].map((image) => image.decode()));
        if (disposed) return;
        packetCanvas.getContext("2d")!.drawImage(packetArtwork, 0, 0, 600, 800);
        packetMap.needsUpdate = true;
        sealCanvas.getContext("2d")!.drawImage(packetCanvas, 0, 0, 600, 55, 0, 0, 600, 55);
        sealMap.needsUpdate = true;
        sourceImages.forEach((image, index) => {
            const surface = document.createElement("canvas");
            surface.width = 600;
            surface.height = 900;
            const ctx = surface.getContext("2d")!;
            ctx.fillStyle = "#faf9f4";
            ctx.fillRect(0, 0, 600, 900);
            const ratio = Math.min(552 / image.naturalWidth, 758 / image.naturalHeight);
            const w = image.naturalWidth * ratio,
                h = image.naturalHeight * ratio;
            ctx.drawImage(image, (600 - w) / 2, 40 + (758 - h) / 2, w, h);
            ctx.fillStyle = "#747b67";
            ctx.font = "14px sans-serif";
            ctx.fillText("STAGE / YOUR CREATION", 24, 842);
            ctx.fillStyle = "#2c3824";
            ctx.font = "bold 23px sans-serif";
            ctx.fillText(images[index].label, 24, 878, 485);
            ctx.font = "18px sans-serif";
            ctx.fillText(String(index + 1).padStart(2, "0"), 540, 875);
            const texture = new THREE.CanvasTexture(surface);
            texture.colorSpace = THREE.SRGBColorSpace;
            textures.push(texture);
            const geometry = cardGeometry(),
                group = new THREE.Group();
            group.add(new THREE.Mesh(geometry.edge, new THREE.MeshBasicMaterial({ color: 0xe8e4d9 })));
            const face = new THREE.Mesh(geometry.face, new THREE.MeshBasicMaterial({ map: texture }));
            face.position.z = 0.003;
            group.add(face);
            const sheen = new THREE.Mesh(
                geometry.face.clone(),
                new THREE.ShaderMaterial({
                    transparent: true,
                    depthWrite: false,
                    uniforms: { phase: { value: -1 }, opacity: { value: 0 } },
                    vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
                    fragmentShader:
                        "varying vec2 vUv; uniform float phase; uniform float opacity; void main() { float stripe = exp(-pow((vUv.x + vUv.y * .5 - phase) * 7.0, 2.0)); vec3 color = .7 + .3 * cos(vec3(0.0, 2.0, 4.0) + vUv.y * 5.0); gl_FragColor = vec4(color, stripe * opacity); }",
                }),
            );
            sheen.position.z = 0.007;
            group.add(sheen);
            const shadow = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.4), new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false }));
            cards.push({ group, sheen, shadow, imageBounds: [(-w / 600) * 1.01, (0.5 - (40 + (758 - h) / 2) / 900) * 3.04, (w / 600) * 1.01, (0.5 - (40 + (758 + h) / 2) / 900) * 3.04] });
            content.add(group, shadow);
            renderer.initTexture(texture);
        });
        resize();
        renderer.render(scene, camera);
        if (disposed) return;
        play();
    })();

    function dispose() {
        if (disposed) return;
        disposed = true;
        cancelAnimationFrame(frameId);
        observer.disconnect();
        document.removeEventListener("visibilitychange", visibilityChange);
        canvas.removeEventListener("webglcontextlost", contextLost);
        sourceImages.forEach((image) => image.removeAttribute("src"));
        packetArtwork.removeAttribute("src");
        scene.traverse((object) => {
            if (!(object instanceof THREE.Mesh)) return;
            object.geometry.dispose();
            for (const material of [object.material].flat()) material.dispose();
        });
        textures.forEach((texture) => texture.dispose());
        confetti.dispose();
        renderer.dispose();
        renderer.forceContextLoss();
    }

    return {
        ready,
        dispose,
    };
}
