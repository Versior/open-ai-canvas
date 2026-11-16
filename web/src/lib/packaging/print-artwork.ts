import { PDFDocument, PDFName } from "pdf-lib";
import type { PackagingLayout } from "./types";

export type PackagingPrintColor = "rgb" | "cmyk" | "gray";

export function packagingPrintPixels(rgba: Uint8ClampedArray, mode: PackagingPrintColor) {
    const channels = mode === "gray" ? 1 : mode === "cmyk" ? 4 : 3;
    const out = new Uint8Array((rgba.length / 4) * channels);
    for (let i = 0, p = 0; i < rgba.length; i += 4, p += channels) {
        if (mode === "gray") {
            out[p] = 255 - Math.round(rgba[i] * 0.2126 + rgba[i + 1] * 0.7152 + rgba[i + 2] * 0.0722);
            continue;
        }
        if (mode === "rgb") {
            out.set(rgba.subarray(i, i + 3), p);
            continue;
        }
        const maximum = Math.max(rgba[i], rgba[i + 1], rgba[i + 2]);
        out[p + 3] = 255 - maximum;
        if (!maximum) continue;
        out[p] = Math.round(((maximum - rgba[i]) * 255) / maximum);
        out[p + 1] = Math.round(((maximum - rgba[i + 1]) * 255) / maximum);
        out[p + 2] = Math.round(((maximum - rgba[i + 2]) * 255) / maximum);
    }
    return out;
}

export async function packagingArtworkPdf(name: string, layout: PackagingLayout, rgba: Uint8ClampedArray, width: number, height: number, mode: PackagingPrintColor) {
    if (width * height > 40_000_000 || rgba.length !== width * height * 4) throw new Error("印刷画幅超过 4000 万像素，请拆分生产版面");
    const pdf = await PDFDocument.create();
    pdf.setTitle(name);
    pdf.setCreator("影策包装工作台");
    pdf.setSubject(mode === "cmyk" ? "1:1 artwork; formula CMYK, no ICC or PDF/X; spot dieline overprint; verify with printer" : mode === "gray" ? "1:1 process plate; black is process coverage; no dieline" : "1:1 RGB review artwork with spot dieline");
    const context = pdf.context;
    const mm = 72 / 25.4,
        margin = 6;
    const w = (layout.bounds.width + margin * 2) * mm,
        h = (layout.bounds.height + margin * 2) * mm;
    const page = pdf.addPage([w, h]);
    const points = layout.cuts.flat();
    const left = (Math.min(...points.map((p) => p[0])) - layout.bounds.x + margin) * mm;
    const right = (Math.max(...points.map((p) => p[0])) - layout.bounds.x + margin) * mm;
    const top = h - (Math.min(...points.map((p) => p[1])) - layout.bounds.y + margin) * mm;
    const bottom = h - (Math.max(...points.map((p) => p[1])) - layout.bounds.y + margin) * mm;
    page.node.set(PDFName.of("TrimBox"), context.obj([left, bottom, right, top]));
    page.node.set(PDFName.of("BleedBox"), context.obj([margin * mm, margin * mm, w - margin * mm, h - margin * mm]));
    pdf.catalog.set(PDFName.of("ViewerPreferences"), context.obj({ PrintScaling: "None" }));
    const image = context.register(
        context.flateStream(packagingPrintPixels(rgba, mode), { Type: "XObject", Subtype: "Image", Width: width, Height: height, BitsPerComponent: 8, ColorSpace: mode === "cmyk" ? "DeviceCMYK" : mode === "gray" ? "DeviceGray" : "DeviceRGB" }),
    );
    const spot = (name: string, values: number[]) => context.obj(["Separation", name, "DeviceCMYK", { FunctionType: 2, Domain: [0, 1], C0: [0, 0, 0, 0], C1: values, N: 1 }]);
    page.node.set(
        PDFName.of("Resources"),
        context.obj({ XObject: { Artwork: image }, ColorSpace: { Cut: spot("CutContour", [0, 1, 1, 0]), Crease: spot("Crease", [1, 0, 0, 0]) }, ExtGState: { Overprint: { Type: "ExtGState", OP: true, op: true, OPM: 1 } } }),
    );
    const x = (v: number) => ((v - layout.bounds.x + margin) * mm).toFixed(4);
    const y = (v: number) => (h - (v - layout.bounds.y + margin) * mm).toFixed(4);
    const path = (points: PackagingLayout["cuts"][number], close: boolean) => points.map((p, i) => `${x(p[0])} ${y(p[1])} ${i ? "l" : "m"}`).join("\n") + (close ? "\nh" : "") + "\nS\n";
    const content =
        `q ${layout.bounds.width * mm} 0 0 ${layout.bounds.height * mm} ${margin * mm} ${margin * mm} cm /Artwork Do Q\n` +
        (mode === "gray" ? "" : "q /Overprint gs 0.5 w /Cut CS 1 SCN\n" + layout.cuts.map((p) => path(p, true)).join("") + "/Crease CS 1 SCN\n" + layout.creases.map((p) => path(p, false)).join("") + "Q\n") +
        `q 0 G 0.3 w ${margin * mm - 12} ${margin * mm} m ${margin * mm - 3} ${margin * mm} l S ${margin * mm} ${margin * mm - 12} m ${margin * mm} ${margin * mm - 3} l S ${w - margin * mm + 3} ${h - margin * mm} m ${w - margin * mm + 12} ${h - margin * mm} l S ${w - margin * mm} ${h - margin * mm + 3} m ${w - margin * mm} ${h - margin * mm + 12} l S Q`;
    page.node.addContentStream(context.register(context.flateStream(content)));
    return new Blob([new Uint8Array(await pdf.save())], { type: "application/pdf" });
}
