import {
    BackSide,
    FrontSide,
    Box3,
    BufferAttribute,
    BufferGeometry,
    CanvasTexture,
    CylinderGeometry,
    DoubleSide,
    ExtrudeGeometry,
    Group,
    Mesh,
    MeshPhysicalMaterial,
    Path,
    Quaternion,
    Shape,
    ShapeGeometry,
    SRGBColorSpace,
    Vector2,
    Vector3,
    type Texture,
} from "three";
import { packagingRoles, type PackagingDocument, type PackagingLayout, type PackagingPanel, type Point } from "./types";
import { packagingMaskLuminance } from "./artwork";
import { packagingVisibleLayers, renderPackagingArtworkCanvas } from "./layers";
import { packagingSurface } from "./surface";

export type PackagingTextures = { artwork: Texture; foil?: Texture; uv?: Texture; emboss?: Texture; coat?: Texture; normal?: Texture; holo?: Texture; inspection?: Texture };
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
    // The dieline is viewed from its printed side; reflect the whole scene, keeping UVs continuous across faces.
    root.scale.x = -1;
    const groups = new Map<string, Group>();
    const partGroups = new Map<string, Group>();
    const geometries: BufferGeometry[] = [];
    const materials: MeshPhysicalMaterial[] = [];
    const surface = packagingSurface(d);
    const checking = surface.inspection !== "artwork";
    const outside = new MeshPhysicalMaterial({
        color: textures ? "#ffffff" : d.material.color,
        roughness: textures?.uv ? 1 : d.view.finish === "gloss" ? 0.18 : d.view.finish === "matte" ? 0.95 : d.material.roughness,
        metalness: textures?.foil ? 1 : d.view.finish === "foil" ? 0.8 : d.material.metalness,
        map: checking ? (textures?.inspection ?? null) : (textures?.artwork ?? null),
        metalnessMap: checking ? null : (textures?.foil ?? null),
        roughnessMap: checking ? null : (textures?.uv ?? null),
        bumpMap: checking ? null : (textures?.emboss ?? null),
        bumpScale: surface.depth,
        normalMap: checking ? null : (textures?.normal ?? null),
        clearcoatNormalMap: checking ? null : (textures?.normal ?? null),
        clearcoat: checking ? 0 : textures?.coat ? 1 : surface.film === "gloss" ? 1 : 0,
        clearcoatMap: checking ? null : (textures?.coat ?? null),
        clearcoatRoughness: surface.film === "matte" || surface.film === "soft" ? 0.5 : 0.08,
        iridescence: checking ? 0 : textures?.holo ? 1 : 0,
        iridescenceMap: checking ? null : (textures?.holo ?? null),
        iridescenceThicknessRange: [100, 650],
        sheen: surface.film === "soft" ? 0.45 : 0,
        side: DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
    });
    if (checking) {
        outside.metalness = 0;
        outside.roughness = 1;
    }
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
    const layers: { panel: PackagingPanel; meshes: Mesh[] }[] = [];
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
            const filmOutside = outside.clone();
            filmOutside.side = FrontSide;
            const filmInside = inside.clone();
            filmInside.side = BackSide;
            materials.push(filmOutside, filmInside);
            const mesh = new Mesh(geometry, filmOutside);
            mesh.name = `${panel.id}-print`;
            mesh.castShadow = true;
            group.add(mesh);
            const lining = new Mesh(geometry, filmInside);
            lining.name = `${panel.id}-lining`;
            group.add(lining);
            continue;
        }
        const shape = panelShape(panel);
        const solid = new ExtrudeGeometry(shape, { depth: d.parameters.thickness, bevelEnabled: false, curveSegments: 12 });
        solid.translate(0, 0, -d.parameters.thickness / 2);
        const body = new Mesh(solid, [inside, edge]);
        body.name = `${panel.id}-paper`;
        body.castShadow = true;
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
        group.add(print);
        if (panel.inset) layers.push({ panel, meshes: [body, print] });
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
        for (const layer of layers) for (const mesh of layer.meshes) mesh.position.z = layer.panel.inset * fold;
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
                const bulge = sealed
                    ? 0
                    : d.parameters.width * 0.5 * d.parameters.inflation * Math.pow(Math.max(0, envelope), 0.6) + (surface.panel.surface!.startsWith("pillow") ? 0 : d.parameters.width * 0.25 * open * Math.sin(Math.PI * u) * (1 - v) ** 2);
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
                const back = panel.surface === "pouch-back" || panel.surface === "pillow-back";
                indices.push(...(back ? [a, a + 33, a + 1, a + 1, a + 33, a + 34] : [a, a + 1, a + 33, a + 1, a + 34, a + 33]));
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
    const surface = packagingSurface(d);
    const color = renderPackagingArtworkCanvas(d, layout, images, resolution, "artwork");
    const width = color.width,
        height = color.height;
    const masks = new Map<string, Uint8ClampedArray>();
    for (const role of packagingRoles) {
        if (role === "artwork" || !packagingVisibleLayers(d, role).length) continue;
        const canvas = renderPackagingArtworkCanvas(d, layout, images, resolution, role);
        masks.set(role, canvas.getContext("2d")!.getImageData(0, 0, width, height).data);
    }
    const channel = (role: string, i: number) => {
        const mask = masks.get(role);
        return mask ? packagingMaskLuminance(mask[i], mask[i + 1], mask[i + 2]) / 255 : 0;
    };
    const canvasOf = () => {
        const c = document.createElement("canvas");
        c.width = width;
        c.height = height;
        return c;
    };
    const rough = canvasOf(),
        metal = canvasOf(),
        coat = canvasOf(),
        bump = canvasOf(),
        normal = canvasOf(),
        holo = canvasOf(),
        inspection = canvasOf();
    const colorData = color.getContext("2d")!.getImageData(0, 0, width, height);
    const channels = [rough, metal, coat, bump, holo, inspection].map((c) => c.getContext("2d")!.createImageData(width, height));
    const gold = [1, 3, 5].map((i) => parseInt(surface.foilColor.slice(i, i + 2), 16));
    const silver = [1, 3, 5].map((i) => parseInt(surface.silverColor.slice(i, i + 2), 16));
    const baseRoughness = surface.film === "gloss" ? 0.18 : surface.film === "matte" || surface.film === "soft" ? 0.85 : d.material.roughness;
    for (let i = 0; i < colorData.data.length; i += 4) {
        const f = channel("foil", i),
            s = channel("silver", i),
            h = channel("holo", i),
            u = channel("uv", i),
            g = channel("gloss", i),
            e = channel("emboss", i),
            down = channel("deboss", i);
        const x = (i / 4) % width,
            y = Math.floor(i / 4 / width);
        const grain = surface.paper === "smooth" ? 0 : surface.paper === "linen" ? Math.sin(x * 1.7) * Math.sin(y * 1.7) * 10 : (Math.sin(x * 4.13 + y * 7.31) + Math.sin(x * 0.43 + y * 0.83)) * 5;
        const values = [
            255 * (baseRoughness * (1 - Math.max(f, s, h, u, g)) + 0.16 * Math.max(f, s, h) + 0.08 * Math.max(u, g)),
            255 * Math.max(d.material.metalness, f, s, h * 0.85),
            255 * Math.max(surface.film === "none" ? 0 : 0.75, u),
            Math.max(0, Math.min(255, 128 + (e - down) * 127 + grain)),
            h * 255,
            surface.inspection === "checker" ? ((Math.floor((x * layout.bounds.width) / width / 20) + Math.floor((y * layout.bounds.height) / height / 20)) % 2 ? 80 : 235) : channel(surface.inspection, i) * 255,
        ];
        channels.forEach((data, index) => {
            data.data[i] = data.data[i + 1] = data.data[i + 2] = values[index];
            data.data[i + 3] = 255;
        });
        for (let c = 0; c < 3; c++) colorData.data[i + c] = Math.max(0, Math.min(255, colorData.data[i + c] * (1 - Math.max(f, s, h)) + gold[c] * f + silver[c] * Math.max(s, h) + grain * 0.25));
    }
    color.getContext("2d")!.putImageData(colorData, 0, 0);
    [rough, metal, coat, bump, holo, inspection].forEach((c, i) => c.getContext("2d")!.putImageData(channels[i], 0, 0));
    const normalData = normal.getContext("2d")!.createImageData(width, height);
    for (let i = 0; i < normalData.data.length; i += 4) {
        const x = (i / 4) % width,
            y = Math.floor(i / 4 / width);
        const dx = channels[3].data[i + (x < width - 1 ? 4 : 0)] - channels[3].data[i - (x ? 4 : 0)];
        const dy = channels[3].data[i + (y < height - 1 ? width * 4 : 0)] - channels[3].data[i - (y ? width * 4 : 0)];
        normalData.data[i] = Math.max(0, Math.min(255, 128 - dx));
        normalData.data[i + 1] = Math.max(0, Math.min(255, 128 + dy));
        normalData.data[i + 2] = 255;
        normalData.data[i + 3] = 255;
    }
    normal.getContext("2d")!.putImageData(normalData, 0, 0);
    const texture = (canvas: HTMLCanvasElement, srgb = false) => {
        const t = new CanvasTexture(canvas);
        t.anisotropy = 4;
        if (srgb) t.colorSpace = SRGBColorSpace;
        return t;
    };
    return { artwork: texture(color, true), foil: texture(metal), uv: texture(rough), coat: texture(coat), emboss: texture(bump), normal: texture(normal), holo: masks.has("holo") ? texture(holo) : undefined, inspection: texture(inspection, true) };
}

export function packagingCamera(root: Group, aspect: number, axis: "front" | "back" | "left" | "right" | "top" | "bottom" | "iso", box = new Box3().setFromObject(root)) {
    const center = box.getCenter(new Vector3());
    const size = box.getSize(new Vector3());
    const radius = size.length() / 2;
    const distance = (radius * 1.1) / Math.sin(Math.atan(Math.tan(Math.PI / 9) * Math.min(1, aspect)));
    const direction = { front: [0, 0.001, -1], back: [0, 0.001, 1], left: [-1, 0, 0], right: [1, 0, 0], top: [0, 1, 0.001], bottom: [0, -1, 0.001], iso: [0.8, 0.65, -1] }[axis];
    return { center, position: center.clone().add(new Vector3(...direction).normalize().multiplyScalar(distance)), span: Math.max(size.x, size.y, size.z), radius };
}

export function packagingFoldQuaternion(panel: PackagingPanel, fold: number) {
    if (!panel.hinge) return new Quaternion();
    const axis = new Vector3(panel.hinge[1][0] - panel.hinge[0][0], panel.hinge[0][1] - panel.hinge[1][1], 0).normalize();
    const progress = Math.min(1, Math.max(0, (fold - panel.phase * 0.5) / (1 - panel.phase * 0.5)));
    return new Quaternion().setFromAxisAngle(axis, panel.angle * progress);
}
