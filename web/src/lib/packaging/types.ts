export type PackagingStructure = "tuck" | "reverse-tuck" | "mailer" | "tray" | "display" | "lid-base" | "drawer" | "book" | "double-door" | "pillow" | "pouch" | "spout-pouch";
export type PackagingParameters = {
    length: number;
    width: number;
    height: number;
    thickness: number;
    bleed: number;
    glue: number;
    tab: number;
    gap: number;
    frontHeight: number;
    windowWidth: number;
    windowHeight: number;
    inflation: number;
    spoutRadius: number;
};
export type PackagingTemplate = { id: string; name: string; category: string; structure: PackagingStructure; description: string; enabled: boolean; defaults: PackagingParameters };
export type PackagingMaterial = { id: string; name: string; color: string; insideColor: string; thickness: number; roughness: number; metalness: number; enabled: boolean };
export type PackagingCatalog = { revision: number; enabled: boolean; mockupEnabled: boolean; maxProjects: number; templates: PackagingTemplate[]; materials: PackagingMaterial[] };
export const packagingRoles = ["artwork", "foil", "silver", "uv", "gloss", "emboss", "deboss", "holo"] as const;
export type PackagingRole = (typeof packagingRoles)[number];
export const packagingRoleNames: Record<PackagingRole, string> = { artwork: "四色印刷", foil: "烫金", silver: "烫银", uv: "局部 UV", gloss: "局部亮面", emboss: "击凸", deboss: "击凹", holo: "镭射" };
export type PackagingText = { kind: "text"; value: string; font: "sans" | "serif" | "mono"; weight: 400 | 700; align: "left" | "center" | "right"; color: string; fontSize?: number; lineHeight?: number; letterSpacing?: number; wrap?: boolean };
export type PackagingLayerContent = PackagingText | { kind: "shape"; shape: "rectangle" | "ellipse"; color: string };
export type PackagingArtwork = {
    id: string;
    resourceId: string;
    name: string;
    panelId: string;
    role: PackagingRole;
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
    opacity: number;
    content?: PackagingLayerContent;
    visible?: boolean;
    locked?: boolean;
};
export type PackagingSurface = {
    paper: "smooth" | "kraft" | "linen";
    film: "none" | "matte" | "gloss" | "soft";
    studio: "neutral" | "commerce" | "warm" | "dramatic";
    inspection: PackagingRole | "checker";
    quality: 1024 | 2048 | 4096;
    depth: number;
    foilColor: string;
    silverColor: string;
};
export const defaultPackagingSurface: PackagingSurface = { paper: "smooth", film: "none", studio: "neutral", inspection: "artwork", quality: 2048, depth: 0.2, foilColor: "#d9b465", silverColor: "#dce0e7" };
export type PackagingView = {
    fold: number;
    open: number;
    layout: "split" | "dieline" | "model";
    background: "transparent" | "light" | "dark";
    projection: "perspective" | "orthographic";
    finish: "paper" | "matte" | "gloss" | "foil" | "emboss";
    light: number;
    shadows: boolean;
    dimensions: boolean;
};
export type PackagingDocument = { version: 1; template: PackagingTemplate; parameters: PackagingParameters; material: PackagingMaterial; artworks: PackagingArtwork[]; view: PackagingView; surface?: PackagingSurface; notes: string };
export type PackagingProject = { id: string; userId: string; name: string; templateId: string; revision: number; createdAt: string; updatedAt: string; document: PackagingDocument };
export type PackagingProjectSummary = Omit<PackagingProject, "document">;
export type Point = [number, number];
export type PackagingPanel = {
    id: string;
    name: string;
    partId: string;
    points: Point[];
    holes: Point[][];
    parentId?: string;
    hinge?: [Point, Point];
    angle: number;
    phase: number;
    lid: boolean;
    inset: number;
    surface?: "pouch-front" | "pouch-back" | "pillow" | "pillow-back";
};
export type PackagingPart = { id: string; name: string; translation: [number, number, number]; rotation: [number, number, number]; openTranslation: [number, number, number] };
export type PackagingLayout = {
    panels: PackagingPanel[];
    parts: PackagingPart[];
    cuts: Point[][];
    creases: [Point, Point][];
    bleed: Point[][];
    bounds: { x: number; y: number; width: number; height: number };
    dimensions: { a: Point; b: Point; label: string }[];
    areaMm2: number;
    warnings: string[];
};

export function newPackagingDocument(template: PackagingTemplate, material: PackagingMaterial): PackagingDocument {
    return {
        version: 1,
        template: structuredClone(template),
        parameters: { ...template.defaults, thickness: material.thickness },
        material: structuredClone(material),
        artworks: [],
        surface: { ...defaultPackagingSurface },
        view: { fold: 1, open: 0, layout: "split", background: "dark", projection: "perspective", finish: "paper", light: 1.3, shadows: true, dimensions: false },
        notes: "",
    };
}

export function validatePackagingParameters(p: PackagingParameters) {
    const range = (n: number, min: number, max: number) => Number.isFinite(n) && n >= min && n <= max;
    if (![p.length, p.width, p.height].every((v) => range(v, 10, 1000))) throw new Error("长、宽、高必须为 10–1000 毫米");
    if (
        !range(p.thickness, 0.05, Math.min(10, p.length / 5, p.width / 5, p.height / 5)) ||
        !range(p.bleed, 0, 20) ||
        !range(p.glue, 2, Math.min(80, p.length, p.width)) ||
        !range(p.tab, 2, Math.min(100, p.length, p.width)) ||
        !range(p.gap, 0.1, 10) ||
        !range(p.frontHeight, 5, p.height) ||
        !range(p.inflation, 0, 1) ||
        !range(p.spoutRadius, 0, Math.min(p.length, p.width) / 4)
    )
        throw new Error("结构参数超出范围，请核对纸厚、粘口、插舌与间隙");
    if (!range(p.windowWidth, 0, p.length - 4) || !range(p.windowHeight, 0, p.height - 4) || (p.windowWidth === 0) !== (p.windowHeight === 0)) throw new Error("开窗宽高须同时填写，距边缘至少 2 毫米");
    if (2 * (p.length + p.width) + p.glue + 2 * p.bleed > 4000 || p.height + 2 * (p.width + p.tab) + 2 * p.bleed > 4000) throw new Error("展开刀版不能超过 4 米");
}
