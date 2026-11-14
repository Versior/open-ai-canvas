import ClipperLib from "clipper-lib";
import type { PackagingDocument, PackagingLayout, PackagingPanel, PackagingPart, Point } from "./types";

const rectangle = (x: number, y: number, w: number, h: number): Point[] => [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
];
const area = (points: Point[]) => points.reduce((sum, p, i) => sum + p[0] * points[(i + 1) % points.length][1] - points[(i + 1) % points.length][0] * p[1], 0) / 2;

export function compilePackaging(d: PackagingDocument): PackagingLayout {
    const p = d.parameters;
    const panels: PackagingPanel[] = [];
    const parts: PackagingPart[] = [];
    const dimensions: PackagingLayout["dimensions"] = [];
    const innerLength = p.length - p.thickness;
    const innerWidth = p.width - p.thickness;
    const innerHeight = p.height - p.thickness;
    const add = (partId: string, id: string, name: string, points: Point[], parentId?: string, hinge?: [Point, Point], angle = Math.PI / 2, phase = 0, lid = false) => {
        const panel: PackagingPanel = { partId, id: `${partId}-${id}`, name, points, holes: [], parentId: parentId ? `${partId}-${parentId}` : undefined, hinge, angle: parentId ? angle : 0, phase, lid };
        panels.push(panel);
        return panel;
    };
    const part = (id: string, name: string, translation: PackagingPart["translation"] = [0, 0, 0], rotation: PackagingPart["rotation"] = [-Math.PI / 2, 0, 0], openTranslation: PackagingPart["translation"] = [0, 0, 0]) =>
        parts.push({ id, name, translation, rotation, openTranslation });
    const tub = (id: string, name: string, x: number, y: number, w: number, depth: number, height: number, front = height) => {
        add(id, "bottom", `${name}底面`, rectangle(x, y, w, depth));
        add(id, "back", `${name}后壁`, rectangle(x, y - height, w, height), "bottom", [
            [x, y],
            [x + w, y],
        ]);
        add(
            id,
            "right",
            `${name}右壁`,
            [
                [x + w, y],
                [x + w + height, y],
                [x + w + front, y + depth],
                [x + w, y + depth],
            ],
            "bottom",
            [
                [x + w, y],
                [x + w, y + depth],
            ],
        );
        add(id, "front", `${name}前壁`, rectangle(x, y + depth, w, front), "bottom", [
            [x + w, y + depth],
            [x, y + depth],
        ]);
        add(
            id,
            "left",
            `${name}左壁`,
            [
                [x, y],
                [x, y + depth],
                [x - front, y + depth],
                [x - height, y],
            ],
            "bottom",
            [
                [x, y + depth],
                [x, y],
            ],
        );
        const ear = Math.min(p.glue, w / 4, depth / 4);
        add(
            id,
            "ear-left",
            "左后粘接耳",
            [
                [x, y - height],
                [x - ear, y - height + ear / 2],
                [x - ear, y - ear / 2],
                [x, y],
            ],
            "back",
            [
                [x, y],
                [x, y - height],
            ],
            Math.PI / 2,
            0.35,
        );
        add(
            id,
            "ear-right",
            "右后粘接耳",
            [
                [x + w, y - height],
                [x + w + ear, y - height + ear / 2],
                [x + w + ear, y - ear / 2],
                [x + w, y],
            ],
            "back",
            [
                [x + w, y - height],
                [x + w, y],
            ],
            Math.PI / 2,
            0.35,
        );
        add(
            id,
            "front-ear-left",
            "左前粘接耳",
            [
                [x, y + depth],
                [x - ear, y + depth + ear / 2],
                [x - ear, y + depth + front - ear / 2],
                [x, y + depth + front],
            ],
            "front",
            [
                [x, y + depth + front],
                [x, y + depth],
            ],
            Math.PI / 2,
            0.35,
        );
        add(
            id,
            "front-ear-right",
            "右前粘接耳",
            [
                [x + w, y + depth],
                [x + w, y + depth + front],
                [x + w + ear, y + depth + front - ear / 2],
                [x + w + ear, y + depth + ear / 2],
            ],
            "front",
            [
                [x + w, y + depth],
                [x + w, y + depth + front],
            ],
            Math.PI / 2,
            0.35,
        );
    };
    const tube = (id: string, name: string, x: number, y: number, w: number, depth: number, h: number, caps: boolean) => {
        add(id, "front", `${name}正面`, rectangle(x, y, w, h));
        add(id, "right", `${name}右侧`, rectangle(x + w, y, depth, h), "front", [
            [x + w, y],
            [x + w, y + h],
        ]);
        add(id, "back", `${name}背面`, rectangle(x + w + depth, y, w, h), "right", [
            [x + w + depth, y],
            [x + w + depth, y + h],
        ]);
        add(id, "left", `${name}左侧`, rectangle(x + w * 2 + depth, y, depth, h), "back", [
            [x + w * 2 + depth, y],
            [x + w * 2 + depth, y + h],
        ]);
        add(
            id,
            "glue",
            "粘口",
            [
                [x + 2 * (w + depth), y],
                [x + 2 * (w + depth) + p.glue, y + p.glue / 3],
                [x + 2 * (w + depth) + p.glue, y + h - p.glue / 3],
                [x + 2 * (w + depth), y + h],
            ],
            "left",
            [
                [x + 2 * (w + depth), y],
                [x + 2 * (w + depth), y + h],
            ],
            Math.PI / 2,
            0.15,
        );
        if (!caps) return;
        const reverse = d.template.structure === "reverse-tuck";
        for (const bottom of [false, true]) {
            const bx = reverse && bottom ? x : x + w + depth;
            const by = bottom ? y + h : y;
            const sign = bottom ? 1 : -1;
            const parent = reverse && bottom ? "front" : "back";
            const key = bottom ? "bottom" : "top";
            const origin: [Point, Point] = bottom
                ? [
                      [bx + w, by],
                      [bx, by],
                  ]
                : [
                      [bx, by],
                      [bx + w, by],
                  ];
            add(id, key, bottom ? "底盖" : "顶盖", rectangle(bx, bottom ? by : by - depth, w, depth), parent, origin, Math.PI / 2, 0.4, !bottom);
            const ty = by + sign * depth;
            add(
                id,
                `${key}-tab`,
                "插舌",
                [
                    [bx, ty],
                    [bx + w, ty],
                    [bx + w - Math.min(5, w / 8), ty + sign * p.tab],
                    [bx + Math.min(5, w / 8), ty + sign * p.tab],
                ],
                key,
                bottom
                    ? [
                          [bx + w, ty],
                          [bx, ty],
                      ]
                    : [
                          [bx, ty],
                          [bx + w, ty],
                      ],
                Math.PI / 2,
                0.7,
                !bottom,
            );
            for (const [side, sx] of [
                ["right", x + w],
                ["left", x + 2 * w + depth],
            ] as const) {
                const wing = Math.min(w / 2, depth * 0.8);
                add(
                    id,
                    `${key}-${side}-wing`,
                    "防尘翼",
                    [
                        [sx, by],
                        [sx + depth, by],
                        [sx + depth - depth * 0.12, by + sign * wing],
                        [sx + depth * 0.12, by + sign * wing],
                    ],
                    side,
                    bottom
                        ? [
                              [sx + depth, by],
                              [sx, by],
                          ]
                        : [
                              [sx, by],
                              [sx + depth, by],
                          ],
                    Math.PI / 2,
                    0.25,
                    !bottom,
                );
            }
        }
    };
    const structure = d.template.structure;
    if (structure === "tuck" || structure === "reverse-tuck") {
        part("box", "纸盒", [-innerLength / 2, innerHeight, -innerWidth / 2], [0, 0, 0]);
        tube("box", "", 0, 0, innerLength, innerWidth, innerHeight, true);
    }
    if (["tray", "display", "mailer"].includes(structure)) {
        part("tray", "托盘", [-innerLength / 2, p.thickness / 2, innerWidth / 2]);
        tub("tray", "", 0, 0, innerLength, innerWidth, p.height - p.thickness / 2, structure === "display" ? p.frontHeight - p.thickness / 2 : p.height - p.thickness / 2);
        if (structure === "mailer") {
            const wall = p.height - p.thickness / 2;
            add(
                "tray",
                "lid",
                "一体翻盖",
                rectangle(0, -wall - innerWidth, innerLength, innerWidth),
                "back",
                [
                    [0, -wall],
                    [innerLength, -wall],
                ],
                Math.PI / 2,
                0.55,
                true,
            );
            add(
                "tray",
                "lid-tab",
                "前插舌",
                rectangle(0, -wall - innerWidth - p.tab, innerLength, p.tab),
                "lid",
                [
                    [0, -wall - innerWidth],
                    [innerLength, -wall - innerWidth],
                ],
                Math.PI / 2,
                0.8,
                true,
            );
        }
    }
    if (structure === "lid-base" || structure === "drawer" || structure === "book" || structure === "double-door") {
        part("base", "内盒", [-innerLength / 2, p.thickness / 2, innerWidth / 2]);
        tub("base", "内盒", 0, 0, innerLength, innerWidth, p.height - p.thickness / 2);
        const offset = innerLength + 2 * p.height + p.glue * 2 + 30;
        if (structure === "lid-base") {
            const lw = p.length + 2 * p.gap;
            const ld = p.width + 2 * p.gap;
            const lh = Math.max(8, p.height * 0.4);
            part("lid", "外盖", [-lw / 2, p.height + p.thickness, -ld / 2], [Math.PI / 2, 0, 0], [0, p.height, 0]);
            tub("lid", "外盖", offset, 0, lw, ld, lh);
        }
        if (structure === "drawer") {
            const sw = p.length + 2 * (p.gap + p.thickness);
            const sh = p.height + p.gap;
            part("sleeve", "套筒", [-sw / 2, sh, innerWidth / 2], [Math.PI / 2, 0, 0]);
            tube("sleeve", "套筒", offset, 0, sw, sh, innerWidth, false);
            parts[0].openTranslation = [0, 0, innerWidth * 0.9];
        }
        if (structure === "book" || structure === "double-door") {
            const coverWidth = p.length + 2 * p.gap;
            const depth = p.width + 2 * p.gap;
            part("cover", "封套", [-coverWidth / 2, 0, depth / 2]);
            const coverX = offset + p.height + p.gap + coverWidth;
            add("cover", "bottom", "封套底板", rectangle(coverX, 0, coverWidth, depth));
            if (structure === "book") {
                add("cover", "spine", "书脊", rectangle(coverX - p.height - p.gap, 0, p.height + p.gap, depth), "bottom", [
                    [coverX, depth],
                    [coverX, 0],
                ]);
                add(
                    "cover",
                    "lid",
                    "翻盖",
                    rectangle(offset, 0, coverWidth, depth),
                    "spine",
                    [
                        [coverX - p.height - p.gap, depth],
                        [coverX - p.height - p.gap, 0],
                    ],
                    Math.PI / 2,
                    0.5,
                    true,
                );
            }
            if (structure === "double-door") {
                for (const right of [false, true]) {
                    const edge = right ? coverX + coverWidth : coverX;
                    const key = right ? "right" : "left";
                    const spineX = right ? edge : edge - p.height;
                    add(
                        "cover",
                        `${key}-spine`,
                        "侧脊",
                        rectangle(spineX, 0, p.height, depth),
                        "bottom",
                        right
                            ? [
                                  [edge, 0],
                                  [edge, depth],
                              ]
                            : [
                                  [edge, depth],
                                  [edge, 0],
                              ],
                    );
                    const lidX = right ? edge + p.height : edge - p.height - coverWidth / 2;
                    const foldX = right ? edge + p.height : edge - p.height;
                    add(
                        "cover",
                        `${key}-lid`,
                        right ? "右翻门" : "左翻门",
                        rectangle(lidX, 0, coverWidth / 2, depth),
                        `${key}-spine`,
                        right
                            ? [
                                  [foldX, 0],
                                  [foldX, depth],
                              ]
                            : [
                                  [foldX, depth],
                                  [foldX, 0],
                              ],
                        Math.PI / 2,
                        0.5,
                        true,
                    );
                }
            }
        }
    }
    if (structure === "pouch" || structure === "spout-pouch") {
        part("bag", "袋体", [-p.length / 2, p.height, 0], [0, 0, 0]);
        const front = add("bag", "front", "袋正面", rectangle(0, 0, p.length, p.height));
        front.surface = "pouch-front";
        const back = add("bag", "back", "袋背面", rectangle(p.length + p.glue * 2, 0, p.length, p.height));
        back.surface = "pouch-back";
    }
    if (structure === "pillow") {
        part("pillow", "枕形盒", [-p.length / 2, p.height, 0], [0, 0, 0]);
        for (const back of [false, true]) {
            const x = back ? p.length : 0;
            const points: Point[] = [];
            for (let i = 0; i <= 24; i++) points.push([x + (p.length * i) / 24, p.width * 0.25 * Math.sin((Math.PI * i) / 24)]);
            for (let i = 24; i >= 0; i--) points.push([x + (p.length * i) / 24, p.height - p.width * 0.25 * Math.sin((Math.PI * i) / 24)]);
            const panel = add("pillow", back ? "back" : "front", back ? "背面" : "正面", points);
            panel.surface = back ? "pillow-back" : "pillow";
        }
    }
    if (p.windowWidth > 0) {
        if (["pouch", "spout-pouch", "pillow"].includes(structure)) throw new Error("软包装曲面暂不支持实体开窗，请关闭开窗后预览");
        const target = panels.find((panel) => panel.name === "正面" || panel.id.endsWith("-front"));
        if (target) {
            const minX = Math.min(...target.points.map((v) => v[0]));
            const minY = Math.min(...target.points.map((v) => v[1]));
            const maxX = Math.max(...target.points.map((v) => v[0]));
            const maxY = Math.max(...target.points.map((v) => v[1]));
            if (p.windowWidth < maxX - minX - 4 && p.windowHeight < maxY - minY - 4) target.holes.push(rectangle((minX + maxX - p.windowWidth) / 2, (minY + maxY - p.windowHeight) / 2, p.windowWidth, p.windowHeight));
        }
        if (!panels.some((panel) => panel.holes.length)) throw new Error("当前面板容不下此开窗尺寸，请缩小开窗");
    }
    const scale = 1000;
    const union = new ClipperLib.Clipper();
    union.AddPaths(
        panels.map((panel) => panel.points.map(([x, y]) => ({ X: Math.round(x * scale), Y: Math.round(y * scale) }))),
        ClipperLib.PolyType.ptSubject,
        true,
    );
    const contours: ClipperLib.Paths = [];
    union.Execute(ClipperLib.ClipType.ctUnion, contours, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
    const cuts = contours.map((path) => path.map(({ X, Y }): Point => [X / scale, Y / scale]));
    const offset = new ClipperLib.ClipperOffset(2, 0.25 * scale);
    offset.AddPaths(contours, ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
    const expanded: ClipperLib.Paths = [];
    if (p.bleed > 0) offset.Execute(expanded, p.bleed * scale);
    const bleed = expanded.map((path) => path.map(({ X, Y }): Point => [X / scale, Y / scale]));
    const all = [...cuts, ...bleed].flat();
    const minX = Math.min(...all.map((v) => v[0]));
    const minY = Math.min(...all.map((v) => v[1]));
    const maxX = Math.max(...all.map((v) => v[0]));
    const maxY = Math.max(...all.map((v) => v[1]));
    dimensions.push({ a: [minX, maxY + 10], b: [maxX, maxY + 10], label: `${(maxX - minX).toFixed(1)} mm` }, { a: [maxX + 10, minY], b: [maxX + 10, maxY], label: `${(maxY - minY).toFixed(1)} mm` });
    const warnings = ["尺寸按外尺寸和输入纸厚生成；投产前核对白样、压痕与套合间隙。"];
    if (structure.includes("pouch") || structure === "pillow") warnings.push("软包装为可控曲面预览，未模拟封口设备或材料受力。");
    if (["book", "double-door", "lid-base"].includes(structure)) warnings.push("硬盒图示为结构板件；裱纸包边与工厂开料须单独核定。");
    return {
        panels,
        parts,
        cuts: [...cuts, ...panels.flatMap((panel) => panel.holes)],
        creases: panels.flatMap((panel) => (panel.hinge ? [panel.hinge] : [])),
        bleed,
        bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
        dimensions,
        areaMm2: panels.reduce((sum, panel) => sum + Math.abs(area(panel.points)) - panel.holes.reduce((s, h) => s + Math.abs(area(h)), 0), 0),
        warnings,
    };
}
