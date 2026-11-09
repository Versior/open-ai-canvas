import presets from "../../../../backend/internal/app/timeline_lut_presets.json";

export const TIMELINE_LUT_PRESETS = presets;
export const MAX_LUT_FILE_BYTES = 2 * 1024 * 1024;
export type CubeLut = { size: number; values: number[]; domainMin: number[]; domainMax: number[] };
export type TimelineLut = { name: string; strength: number; preset?: string; cube?: CubeLut };
const clamp = (value: number) => Math.max(0, Math.min(1, value));

export function validateTimelineLut(value: unknown): asserts value is TimelineLut {
    if (!value || typeof value !== "object") throw new Error("LUT 配置无效");
    const lut = value as TimelineLut;
    if (typeof lut.name !== "string" || lut.name.length > 120 || !Number.isFinite(lut.strength) || lut.strength < 0 || lut.strength > 1) throw new Error("LUT 名称或强度无效");
    if (lut.preset && !lut.cube && presets.some((preset) => preset.id === lut.preset)) return;
    const cube = lut.cube;
    if (lut.preset || !cube || !Number.isInteger(cube.size) || cube.size < 2 || cube.size > 33 || !Array.isArray(cube.values) || cube.values.length !== cube.size ** 3 * 3) throw new Error("LUT 必须是 2–33 阶的 3D 色彩表");
    if (cube.values.some((v) => !Number.isFinite(v) || v < 0 || v > 1)) throw new Error("仅支持输出范围 0–1 的 SDR LUT");
    if (![cube.domainMin, cube.domainMax].every((domain) => Array.isArray(domain) && domain.length === 3 && domain.every(Number.isFinite)) || cube.domainMin.some((min, i) => min >= cube.domainMax[i] || !Number.isFinite(cube.domainMax[i] - min)))
        throw new Error("LUT 输入范围无效");
}

export function timelineLutSignature(lut?: TimelineLut): string {
    if (!lut || lut.strength === 0) return "";
    const text = JSON.stringify(lut);
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
    return (hash >>> 0).toString(16);
}

/** .cube 顺序为红色最快、蓝色最慢；只保存数值，不接受服务器文件路径或滤镜表达式。 */
export function parseCubeLut(text: string, name: string): TimelineLut {
    if (text.length > MAX_LUT_FILE_BYTES) throw new Error("LUT 文件不能超过 2 MB");
    const cube: CubeLut = { size: 0, values: [], domainMin: [0, 0, 0], domainMax: [1, 1, 1] };
    const seen = new Set<string>();
    for (const raw of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
        const line = raw.split("#")[0].trim();
        if (!line) continue;
        const [key, ...args] = line.split(/\s+/);
        if (key === "TITLE") continue;
        if (["LUT_3D_SIZE", "DOMAIN_MIN", "DOMAIN_MAX"].includes(key)) {
            if (seen.has(key) || cube.values.length) throw new Error("LUT 文件头重复或顺序无效");
            seen.add(key);
            if (key === "LUT_3D_SIZE") {
                if (args.length !== 1 || !Number.isInteger(Number(args[0])) || Number(args[0]) < 2 || Number(args[0]) > 33) throw new Error("支持 2–33 阶 3D LUT；请将高阶 LUT 转为 33 阶后导入");
                cube.size = Number(args[0]);
            } else {
                if (args.length !== 3) throw new Error("LUT 输入范围无效");
                cube[key === "DOMAIN_MIN" ? "domainMin" : "domainMax"] = args.map(Number);
            }
        } else {
            if (!cube.size || args.length !== 2 || cube.values.length >= cube.size ** 3 * 3) throw new Error("无效的 .cube 文件，仅支持 3D LUT");
            cube.values.push(...[key, ...args].map(Number));
        }
    }
    const lut: TimelineLut = { name: name.slice(0, 120), strength: 1, cube };
    validateTimelineLut(lut);
    cube.values = cube.values.map((value) => Number(value.toFixed(6)));
    return lut;
}

export function timelineLutCube(lut: TimelineLut): CubeLut {
    validateTimelineLut(lut);
    if (lut.cube) return lut.cube;
    const preset = presets.find((preset) => preset.id === lut.preset)!;
    const size = 17;
    const values: number[] = [];
    for (let b = 0; b < size; b++)
        for (let g = 0; g < size; g++)
            for (let r = 0; r < size; r++) {
                const rgb = [r, g, b].map((v) => (v / (size - 1) - 0.5) * preset.contrast + 0.5);
                const luma = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
                values.push(...rgb.map((v, i) => clamp(Math.pow(clamp(luma + (v - luma) * preset.saturation + preset.lift[i]), preset.gamma[i]) * preset.gain[i])));
            }
    return { size, values, domainMin: [0, 0, 0], domainMax: [1, 1, 1] };
}
