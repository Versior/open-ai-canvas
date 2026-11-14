import { Box3, BufferAttribute, BufferGeometry, CanvasTexture, CylinderGeometry, DoubleSide, ExtrudeGeometry, Group, Mesh, MeshPhysicalMaterial, Path, Quaternion, Shape, ShapeGeometry, SRGBColorSpace, Vector2, Vector3, type Texture } from "three";
import type { PackagingDocument, PackagingLayout, PackagingPanel, Point } from "./types";

export type PackagingTextures = { artwork: Texture; foil?: Texture; uv?: Texture; emboss?: Texture };
export type PackagingScene = { root: Group; panels: Map<string, Group>; apply: (fold: number, open: number) => void; dispose: () => void };

export function panelOrigin(panel: PackagingPanel): Point {
    return panel.hinge?.[0] ?? [Math.min(...panel.points.map((p) => p[0])), Math.min(...panel.points.map((p) => p[1]))];
}

export function packagingUv(point: Point, layout: PackagingLayout): Point {
    return [(point[0] - layout.bounds.x) / layout.bounds.width, 1 - (point[1] - layout.bounds.y) / layout.bounds.height];
}

function panelShape(panel: PackagingPanel) {
    const [x, y] = panelOrigin(panel);
    const outline = new Shape(panel.points.map((point) => new Vector2(point[0] - x, y - point[1])));
    outline.holes = panel.holes.map((points) => new Path(points.map((p) => new Vector2(p[0] - x, y - p[1]))));
    return outline;
}

export function buildPackagingScene(d: PackagingDocument, layout: PackagingLayout, textures?: PackagingTextures): PackagingScene {
    const root = new Group();
    root.name = "packaging";
    const groups = new Map<string, Group>();
    const partGroups = new Map<string, Group>();
    const geometries: BufferGeometry[] = [];
    const materials: MeshPhysicalMaterial[] = [];
    const outside = new MeshPhysicalMaterial({
        color: textures ? "#ffffff" : d.material.color,
        roughness: textures?.uv ? 1 : d.view.finish === "gloss" ? 0.18 : d.view.finish === "matte" ? 0.95 : d.material.roughness,
        metalness: textures?.foil ? 1 : d.view.finish === "foil" ? 0.8 : d.material.metalness,
        map: textures?.artwork ?? null,
        metalnessMap: textures?.foil ?? null,
        roughnessMap: textures?.uv ?? null,
        bumpMap: textures?.emboss ?? null,
        bumpScale: d.parameters.thickness * 0.15,
        clearcoat: d.view.finish === "gloss" ? 1 : 0,
        side: DoubleSide,
    });
    const inside = new MeshPhysicalMaterial({ color: d.material.insideColor, roughness: 0.88, side: DoubleSide });
    const edge = new MeshPhysicalMaterial({ color: d.material.insideColor, roughness: 0.95 });
    materials.push(outside, inside, edge);
    for (const spec of layout.parts) {
        const group = new Group();
        group.name = spec.id;
        group.position.set(...spec.translation);
        group.rotation.set(...spec.rotation);
        partGroups.set(spec.id, group);
        root.add(group);
    }
    const surfaces: { panel: PackagingPanel; geometry: BufferGeometry; original: Float32Array }[] = [];
    for (const panel of layout.panels) {
        const group = new Group();
        group.name = panel.id;
        const origin = panelOrigin(panel);
        if (panel.parentId) {
            const parent = layout.panels.find((item) => item.id === panel.parentId)!;
            const parentOrigin = panelOrigin(parent);
            group.position.set(origin[0] - parentOrigin[0], parentOrigin[1] - origin[1], 0);
            groups.get(panel.parentId)!.add(group);
        }
        if (!panel.parentId) {
            const first = layout.panels.find((item) => item.partId === panel.partId)!;
            const firstOrigin = panelOrigin(first);
            group.position.set(origin[0] - firstOrigin[0], firstOrigin[1] - origin[1], 0);
            partGroups.get(panel.partId)!.add(group);
        }
        groups.set(panel.id, group);
        if (panel.surface) {
            const geometry = curvedPanelGeometry(panel, layout);
            const original = new Float32Array(geometry.getAttribute("position").array);
            surfaces.push({ panel, geometry, original });
            geometries.push(geometry);
            const mesh = new Mesh(geometry, [outside, inside]);
            mesh.name = `${panel.id}-print`;
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            group.add(mesh);
            continue;
        }
        const shape = panelShape(panel);
        const solid = new ExtrudeGeometry(shape, { depth: d.parameters.thickness, bevelEnabled: false, curveSegments: 12 });
        solid.translate(0, 0, -d.parameters.thickness / 2);
        const body = new Mesh(solid, [inside, edge]);
        body.name = `${panel.id}-paper`;
        body.castShadow = true;
        body.receiveShadow = true;
        group.add(body);
        const face = new ShapeGeometry(shape, 12);
        const vertices = face.getAttribute("position");
        const uv = face.getAttribute("uv");
        for (let index = 0; index < vertices.count; index++) {
            const coordinate = packagingUv([vertices.getX(index) + origin[0], origin[1] - vertices.getY(index)], layout);
            uv.setXY(index, ...coordinate);
        }
        face.translate(0, 0, -d.parameters.thickness / 2 - 0.002);
        const print = new Mesh(face, outside);
        print.name = `${panel.id}-print`;
        print.castShadow = true;
        print.receiveShadow = true;
        group.add(print);
        geometries.push(solid, face);
    }
    if (d.template.structure === "spout-pouch") {
        const geometry = new CylinderGeometry(d.parameters.spoutRadius, d.parameters.spoutRadius, Math.max(8, d.parameters.spoutRadius * 2), 24);
        const material = new MeshPhysicalMaterial({ color: "#eeeae1", roughness: 0.45 });
        const spout = new Mesh(geometry, material);
        spout.name = "spout";
        spout.position.set(d.parameters.length * 0.76, d.parameters.spoutRadius, 0);
        partGroups.get("bag")!.add(spout);
        geometries.push(geometry);
        materials.push(material);
    }
    const apply = (fold: number, open: number) => {
        for (const panel of layout.panels) {
            if (!panel.hinge) continue;
            const progress = Math.min(1, Math.max(0, (fold - panel.phase * 0.5) / (1 - panel.phase * 0.5)));
            const angle = panel.angle * progress * (panel.lid ? 1 - open : 1);
            const axis = new Vector3(panel.hinge[1][0] - panel.hinge[0][0], panel.hinge[0][1] - panel.hinge[1][1], 0).normalize();
            groups.get(panel.id)!.quaternion.setFromAxisAngle(axis, angle);
        }
        for (const spec of layout.parts) partGroups.get(spec.id)!.position.set(spec.translation[0] + spec.openTranslation[0] * open, spec.translation[1] + spec.openTranslation[1] * open, spec.translation[2] + spec.openTranslation[2] * open);
        for (const surface of surfaces) {
            const position = surface.geometry.getAttribute("position");
            const origin = panelOrigin(surface.panel);
            const partPanels = layout.panels.filter((panel) => panel.partId === surface.panel.partId);
            const firstOrigin = panelOrigin(partPanels[0]);
            const back = surface.panel.surface === "pouch-back" || surface.panel.surface === "pillow-back";
            for (let i = 0; i < position.count; i++) {
                const x = surface.original[i * 3];
                const y = surface.original[i * 3 + 1];
                const u = x / d.parameters.length;
                const v = -y / d.parameters.height;
                const envelope = Math.sin(Math.PI * u) * Math.sin(Math.PI * v);
                const sealed = !surface.panel.surface!.startsWith("pillow") && (x < d.parameters.glue || x > d.parameters.length - d.parameters.glue || -y > d.parameters.height - d.parameters.glue);
                const bulge = sealed ? 0 : d.parameters.width * 0.5 * d.parameters.inflation * Math.pow(Math.max(0, envelope), 0.6);
                position.setXYZ(i, x - (origin[0] - firstOrigin[0]) * fold, y, (back ? 1 : -1) * (bulge + d.parameters.thickness) * fold);
            }
            position.needsUpdate = true;
            surface.geometry.computeVertexNormals();
        }
        root.updateMatrixWorld(true);
    };
    apply(d.view.fold, d.view.open);
    return {
        root,
        panels: groups,
        apply,
        dispose: () => {
            geometries.forEach((g) => g.dispose());
            materials.forEach((m) => m.dispose());
        },
    };
}

function curvedPanelGeometry(panel: PackagingPanel, layout: PackagingLayout) {
    const origin = panelOrigin(panel);
    const minX = Math.min(...panel.points.map((p) => p[0]));
    const maxX = Math.max(...panel.points.map((p) => p[0]));
    const minY = Math.min(...panel.points.map((p) => p[1]));
    const maxY = Math.max(...panel.points.map((p) => p[1]));
    const vertices: number[] = [];
    const uv: number[] = [];
    const indices: number[] = [];
    for (let row = 0; row <= 32; row++)
        for (let col = 0; col <= 32; col++) {
            const x = minX + ((maxX - minX) * col) / 32;
            const arc = panel.surface?.startsWith("pillow") ? panel.points[12][1] * Math.sin((Math.PI * col) / 32) : 0;
            const y = minY + arc + ((maxY - minY - arc * 2) * row) / 32;
            vertices.push(x - origin[0], origin[1] - y, 0);
            uv.push(...packagingUv([x, y], layout));
            if (row < 32 && col < 32) {
                const a = row * 33 + col;
                indices.push(a, a + 33, a + 1, a + 1, a + 33, a + 34);
            }
        }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(new Float32Array(vertices), 3));
    geometry.setAttribute("uv", new BufferAttribute(new Float32Array(uv), 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
}

export function buildPackagingTextures(d: PackagingDocument, layout: PackagingLayout, images: Map<string, HTMLImageElement>, resolution = 2048): PackagingTextures {
    const make = (role: "artwork" | "foil" | "uv" | "emboss") => {
        const canvas = document.createElement("canvas");
        const scale = resolution / Math.max(layout.bounds.width, layout.bounds.height);
        canvas.width = Math.max(1, Math.round(layout.bounds.width * scale));
        canvas.height = Math.max(1, Math.round(layout.bounds.height * scale));
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = role === "artwork" ? d.material.color : "black";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.scale(scale, scale);
        ctx.translate(-layout.bounds.x, -layout.bounds.y);
        for (const art of d.artworks.filter((a) => a.role === role)) {
            ctx.save();
            const targets = art.panelId ? layout.panels.filter((p) => p.id === art.panelId) : layout.panels;
            ctx.beginPath();
            for (const panel of targets)
                for (const points of [panel.points, ...panel.holes]) {
                    ctx.moveTo(...points[0]);
                    points.slice(1).forEach((p) => ctx.lineTo(...p));
                    ctx.closePath();
                }
            ctx.clip("evenodd");
            ctx.globalAlpha = art.opacity;
            ctx.translate(art.x + art.width / 2, art.y + art.height / 2);
            ctx.rotate((art.rotation * Math.PI) / 180);
            ctx.drawImage(images.get(art.resourceId)!, -art.width / 2, -art.height / 2, art.width, art.height);
            ctx.restore();
        }
        if (role === "uv") {
            const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
            for (let i = 0; i < data.data.length; i += 4) {
                const value = Math.round(255 * d.material.roughness * (1 - data.data[i + 1] / 255) + (35 * data.data[i + 1]) / 255);
                data.data[i] = value;
                data.data[i + 1] = value;
                data.data[i + 2] = value;
            }
            ctx.putImageData(data, 0, 0);
        }
        const texture = new CanvasTexture(canvas);
        if (role === "artwork") texture.colorSpace = SRGBColorSpace;
        return texture;
    };
    return {
        artwork: make("artwork"),
        foil: d.artworks.some((a) => a.role === "foil") ? make("foil") : undefined,
        uv: d.artworks.some((a) => a.role === "uv") ? make("uv") : undefined,
        emboss: d.artworks.some((a) => a.role === "emboss") ? make("emboss") : undefined,
    };
}

export function packagingCamera(root: Group, aspect: number, axis: "front" | "back" | "left" | "right" | "top" | "bottom" | "iso") {
    const box = new Box3().setFromObject(root);
    const center = box.getCenter(new Vector3());
    const size = box.getSize(new Vector3());
    const distance = (Math.max(size.x, size.y, size.z) * 1.7) / Math.min(1, aspect);
    const direction = { front: [0, 0.001, -1], back: [0, 0.001, 1], left: [-1, 0, 0], right: [1, 0, 0], top: [0, 1, 0.001], bottom: [0, -1, 0.001], iso: [0.8, 0.65, -1] }[axis];
    return { center, position: center.clone().add(new Vector3(...direction).normalize().multiplyScalar(distance)), span: Math.max(size.x, size.y, size.z) };
}

export function packagingFoldQuaternion(panel: PackagingPanel, fold: number) {
    if (!panel.hinge) return new Quaternion();
    const axis = new Vector3(panel.hinge[1][0] - panel.hinge[0][0], panel.hinge[0][1] - panel.hinge[1][1], 0).normalize();
    const progress = Math.min(1, Math.max(0, (fold - panel.phase * 0.5) / (1 - panel.phase * 0.5)));
    return new Quaternion().setFromAxisAngle(axis, panel.angle * progress);
}
