import { validatePackagingParameters, type PackagingDocument, type PackagingMaterial, type PackagingParameters, type PackagingTemplate } from "./types";

const structures = ["tuck", "reverse-tuck", "mailer", "tray", "display", "lid-base", "drawer", "book", "double-door", "pillow", "pouch", "spout-pouch"] as const;
const identifier = /^[A-Za-z0-9_-]{1,80}$/;
const record = (value: unknown): Record<string, unknown> => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("包装方案字段格式无效");
    return value as Record<string, unknown>;
};
const text = (value: unknown, max: number, pattern?: RegExp) => {
    if (typeof value !== "string" || [...value].length > max || (pattern && !pattern.test(value))) throw new Error("包装方案文本或标识无效");
    return value;
};
const number = (value: unknown, min: number, max: number) => {
    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new Error("包装方案数值超出范围");
    return value;
};
const boolean = (value: unknown) => {
    if (typeof value !== "boolean") throw new Error("包装方案开关无效");
    return value;
};
const choice = <T extends string>(value: unknown, values: readonly T[]): T => {
    if (typeof value !== "string" || !values.includes(value as T)) throw new Error("包装方案枚举无效");
    return value as T;
};
function parameters(value: unknown): PackagingParameters {
    const r = record(value);
    const p = Object.fromEntries(["length", "width", "height", "thickness", "bleed", "glue", "tab", "gap", "frontHeight", "windowWidth", "windowHeight", "inflation", "spoutRadius"].map((key) => [key, number(r[key], 0, 1000)])) as PackagingParameters;
    validatePackagingParameters(p);
    return p;
}
function template(value: unknown): PackagingTemplate {
    const r = record(value);
    const name = text(r.name, 80);
    if (!name.trim()) throw new Error("盒型名称不能为空");
    return {
        id: text(r.id, 80, identifier),
        name,
        category: choice(r.category, ["折叠纸盒", "礼盒", "托盘展示", "软包装"]),
        structure: choice(r.structure, structures),
        description: text(r.description, 800),
        enabled: boolean(r.enabled),
        defaults: parameters(r.defaults),
    };
}
function material(value: unknown): PackagingMaterial {
    const r = record(value);
    const name = text(r.name, 80);
    if (!name.trim()) throw new Error("材料名称不能为空");
    return {
        id: text(r.id, 80, identifier),
        name,
        color: text(r.color, 7, /^#[0-9a-fA-F]{6}$/),
        insideColor: text(r.insideColor, 7, /^#[0-9a-fA-F]{6}$/),
        thickness: number(r.thickness, 0.05, 10),
        roughness: number(r.roughness, 0, 1),
        metalness: number(r.metalness, 0, 1),
        enabled: boolean(r.enabled),
    };
}

export function parsePackagingDocument(value: unknown): PackagingDocument {
    const r = record(value);
    if (r.version !== 1 || !Array.isArray(r.artworks) || r.artworks.length > 40) throw new Error("包装方案版本或图稿数量无效");
    const v = record(r.view);
    const ids = new Set<string>();
    const artworks = r.artworks.map((value: unknown) => {
        const a = record(value);
        const id = text(a.id, 80, identifier);
        if (ids.has(id)) throw new Error("图稿标识重复");
        ids.add(id);
        return {
            id,
            resourceId: text(a.resourceId, 80, identifier),
            name: text(a.name, 200),
            panelId: text(a.panelId, 80, /^(?:[A-Za-z0-9_-]{1,80})?$/),
            role: choice(a.role, ["artwork", "foil", "uv", "emboss"] as const),
            x: number(a.x, -8000, 8000),
            y: number(a.y, -8000, 8000),
            width: number(a.width, 0.1, 8000),
            height: number(a.height, 0.1, 8000),
            rotation: number(a.rotation, -360, 360),
            opacity: number(a.opacity, 0, 1),
        };
    });
    return {
        version: 1,
        template: template(r.template),
        parameters: parameters(r.parameters),
        material: material(r.material),
        artworks,
        view: {
            fold: number(v.fold, 0, 1),
            open: number(v.open, 0, 1),
            layout: choice(v.layout, ["split", "dieline", "model"]),
            background: choice(v.background, ["transparent", "light", "dark"]),
            projection: choice(v.projection, ["perspective", "orthographic"]),
            finish: choice(v.finish, ["paper", "matte", "gloss", "foil", "emboss"]),
            light: number(v.light, 0.2, 5),
            shadows: boolean(v.shadows),
            dimensions: boolean(v.dimensions),
        },
        notes: text(r.notes, 4000),
    };
}
