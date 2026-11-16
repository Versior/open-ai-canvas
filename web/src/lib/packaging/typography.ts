import type { PackagingArtwork, PackagingText } from "./types";

export const packagingFonts = { sans: "Arial, sans-serif", serif: "Georgia, serif", mono: "monospace" };
export const packagingTextSize = (art: PackagingArtwork) => (art.content?.kind === "text" && art.content.fontSize !== undefined ? art.content.fontSize : art.height / ((art.content?.kind === "text" ? art.content.value.split("\n").length : 1) * 1.25));
export type PackagingTextMeasure = (value: string) => Pick<TextMetrics, "width" | "actualBoundingBoxDescent">;
export type PackagingTextMeasureFactory = (art: PackagingArtwork) => PackagingTextMeasure;
export const packagingTextFont = (art: PackagingArtwork, text: PackagingText) => `${text.weight} ${packagingTextSize(art)}px ${packagingFonts[text.font]}`;

export function preparePackagingTextContext(ctx: CanvasRenderingContext2D, art: PackagingArtwork, text: PackagingText) {
    ctx.font = packagingTextFont(art, text);
    ctx.letterSpacing = `${text.letterSpacing ?? 0}px`;
}

export const measurePackagingText: PackagingTextMeasureFactory = (art) => {
    const ctx = document.createElement("canvas").getContext("2d")!;
    preparePackagingTextContext(ctx, art, art.content as PackagingText);
    return (value) => ctx.measureText(value);
};

// Widths are measured with the same font and tracking used by the canvas painter.
export function packagingTextLayout(art: PackagingArtwork, measure?: PackagingTextMeasure) {
    const text = art.content as PackagingText;
    const size = packagingTextSize(art);
    const lineHeight = size * (text.lineHeight ?? 1.25);
    const widthOf = text.wrap ? measure || measurePackagingText(art) : measure;
    const lines = text.wrap
        ? text.value.split("\n").flatMap((paragraph) => {
              const tokens = paragraph.match(/[A-Za-z0-9_]+|\s+|[^A-Za-z0-9_\s]/gu) || [""];
              const result: string[] = [];
              let line = "";
              for (const token of tokens) {
                  if (line && widthOf!(line + token).width > art.width) {
                      result.push(line.trimEnd());
                      line = "";
                  }
                  if (!line && !token.trim()) continue;
                  for (const char of [...token]) {
                      if (line && widthOf!(line + char).width > art.width) {
                          result.push(line);
                          line = "";
                      }
                      line += char;
                  }
              }
              result.push(line.trimEnd());
              return result;
          })
        : text.value.split("\n");
    const metrics = measure ? lines.map(measure) : undefined;
    return {
        lines,
        fontSize: size,
        lineHeight,
        height: Math.max(lines.length * lineHeight, metrics ? size + (lines.length - 1) * lineHeight + metrics.at(-1)!.actualBoundingBoxDescent : 0),
        width: metrics ? Math.max(0, ...metrics.map((m) => m.width)) : undefined,
    };
}

export function scalePackagingText(art: PackagingArtwork, scale: number) {
    if (art.content?.kind !== "text") return {};
    return { content: { ...art.content, ...(art.content.fontSize === undefined ? {} : { fontSize: art.content.fontSize * scale }), ...(art.content.letterSpacing === undefined ? {} : { letterSpacing: art.content.letterSpacing * scale }) } };
}
