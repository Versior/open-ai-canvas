/**
 * 把拍法的文字描述翻译成一张构图线框图。
 *
 * 拍法节点如果只显示八个输入框，用户看不出这个拍法拍出来是什么样。线框图给出
 * 商品位、文案位和光向三个最关键的视觉信息——扫一眼就知道构图。
 *
 * 这是**启发式解析**，不是结构化数据：拍法字段是自由文本，用户可能写任何东西。
 * 所以只在文本里出现明确方位词时才移动元素，认不出来就落在默认位置，
 * 不猜、不硬凑。宁可示意不准，也不能给出误导性的确定感。
 */
import type { EcommerceShot } from "./ecommerce-contract";

export type EcommerceDiagramAnchor = "center" | "left" | "right";
export type EcommerceDiagramCopyZone = "top" | "bottom" | "left" | "right" | "around" | null;
export type EcommerceDiagramLight = "front" | "left" | "right" | "back";

export type EcommerceShotDiagram = {
    /** 商品在画面里的水平位置 */
    product: EcommerceDiagramAnchor;
    /** 文案位；null 表示这个拍法不留文案位 */
    copyZone: EcommerceDiagramCopyZone;
    /** 主光方向 */
    light: EcommerceDiagramLight;
    /** 是否近距离/微距——决定商品框画多大 */
    closeUp: boolean;
};

export function ecommerceShotDiagram(shot: EcommerceShot | undefined): EcommerceShotDiagram {
    if (!shot) return { product: "center", copyZone: null, light: "front", closeUp: false };
    const composition = `${shot.composition} ${shot.background}`;
    const copy = shot.copyZone;
    const lighting = shot.lighting;
    const lens = `${shot.lens} ${shot.purpose}`;

    const product: EcommerceDiagramAnchor = /偏左|左侧|左边/.test(composition)
        ? "left"
        : /偏右|右侧|右边/.test(composition)
            ? "right"
            : "center";

    const copyZone: EcommerceDiagramCopyZone = /四周|环绕/.test(copy)
        ? "around"
        : /顶部|上方|上部|标题位/.test(copy)
            ? "top"
            : /底部|下方|下部/.test(copy)
                ? "bottom"
                : /右侧|右边|一侧/.test(copy)
                    ? "right"
                    : /左侧|左边/.test(copy)
                        ? "left"
                        : null;

    const light: EcommerceDiagramLight = /侧逆|逆光|背光/.test(lighting)
        ? "back"
        : /右上|右侧|右边/.test(lighting)
            ? "right"
            : /左上|左侧|左边/.test(lighting)
                ? "left"
                : "front";

    const closeUp = /微距|近景|特写|局部|放大/.test(`${lens} ${shot.composition}`);

    return { product, copyZone, light, closeUp };
}

/** 线框图的几何：全部用百分比，容器多大都成立。 */
export function ecommerceDiagramBoxes(diagram: EcommerceShotDiagram) {
    const productWidth = diagram.closeUp ? 74 : 40;
    const productHeight = diagram.closeUp ? 68 : 52;
    const productLeft = diagram.product === "left" ? 6 : diagram.product === "right" ? 100 - productWidth - 6 : (100 - productWidth) / 2;
    const productTop = (100 - productHeight) / 2;
    const product = { left: productLeft, top: productTop, width: productWidth, height: productHeight };

    let copy: { left: number; top: number; width: number; height: number } | null = null;
    switch (diagram.copyZone) {
        case "top": copy = { left: 8, top: 4, width: 84, height: 16 }; break;
        case "bottom": copy = { left: 8, top: 80, width: 84, height: 16 }; break;
        case "left": copy = { left: 4, top: 34, width: 26, height: 32 }; break;
        case "right": copy = { left: 70, top: 34, width: 26, height: 32 }; break;
        case "around": copy = { left: 4, top: 4, width: 92, height: 92 }; break;
        default: copy = null;
    }
    return { product, copy };
}
