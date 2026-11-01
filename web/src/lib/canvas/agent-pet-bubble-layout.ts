/** 头顶云朵气泡的定位与外形。坐标单位为 CSS 像素，气泡盒子以左上角为原点。 */

/** 云朵到视口边缘的最小距离。 */
export const AGENT_PET_BUBBLE_MARGIN = 8;
/** 云朵凸起超出文字盒子的高度（见 agentPetCloudPath 的弧半径）。 */
export const AGENT_PET_BUBBLE_BULGE = 8;
/** 尾巴从云朵边缘到尖端的长度。 */
export const AGENT_PET_BUBBLE_TAIL = 14;

export type AgentPetBubbleAnchor = {
    /** 形象外框在视口中的位置和尺寸。 */
    left: number;
    top: number;
    width: number;
    height: number;
    /** 头顶最高的不透明像素相对外框高度的比例。 */
    headTop: number;
};
export type AgentPetBubbleSize = { width: number; height: number };
export type AgentPetBubbleViewport = { width: number; height: number };
export type AgentPetBubblePlacement = "top" | "left" | "right";
export type AgentPetBubbleLayout = {
    placement: AgentPetBubblePlacement;
    left: number;
    top: number;
    /** 尾巴根部（在云朵内）与尖端（指向形象），相对气泡盒子。 */
    tail: { baseX: number; baseY: number; tipX: number; tipY: number };
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));

/**
 * 默认放在头顶正上方，水平方向跟着头部并夹在视口内，尾巴尖始终指向头顶。
 * 头顶空间不够时（形象被拖到屏幕上沿）改放在形象左侧或右侧，与头部大致同高，绝不盖住形象。
 */
export function layoutAgentPetBubble(anchor: AgentPetBubbleAnchor, size: AgentPetBubbleSize, viewport: AgentPetBubbleViewport): AgentPetBubbleLayout {
    const edge = AGENT_PET_BUBBLE_MARGIN + AGENT_PET_BUBBLE_BULGE;
    const headX = anchor.left + anchor.width / 2;
    const headY = anchor.top + anchor.height * anchor.headTop;
    const top = headY - 2 - AGENT_PET_BUBBLE_TAIL - size.height;
    if (top >= edge) {
        const left = clamp(headX - size.width / 2, edge, viewport.width - size.width - edge);
        const target = headX - left;
        return {
            placement: "top",
            left,
            top,
            tail: { baseX: clamp(target, 18, size.width - 18), baseY: size.height - 4, tipX: clamp(target, 8, size.width - 8), tipY: size.height + AGENT_PET_BUBBLE_TAIL },
        };
    }
    // 形象图集左右各留有透明边，身体大约占中间 60%。
    const bodyLeft = anchor.left + anchor.width * 0.2;
    const bodyRight = anchor.left + anchor.width * 0.8;
    const roomLeft = bodyLeft - AGENT_PET_BUBBLE_TAIL - edge;
    const roomRight = viewport.width - bodyRight - AGENT_PET_BUBBLE_TAIL - edge;
    const placement: AgentPetBubblePlacement = roomLeft >= size.width || roomLeft >= roomRight ? "left" : "right";
    const sideTop = clamp(headY + 12 - size.height / 2, edge, viewport.height - size.height - edge);
    const tailY = clamp(headY + 12 - sideTop, 14, size.height - 14);
    if (placement === "left") {
        const left = clamp(bodyLeft - AGENT_PET_BUBBLE_TAIL - size.width, edge, viewport.width - size.width - edge);
        return { placement, left, top: sideTop, tail: { baseX: size.width - 4, baseY: tailY, tipX: size.width + AGENT_PET_BUBBLE_TAIL, tipY: tailY + 2 } };
    }
    const left = clamp(bodyRight + AGENT_PET_BUBBLE_TAIL, edge, viewport.width - size.width - edge);
    return { placement, left, top: sideTop, tail: { baseX: 4, baseY: tailY, tipX: -AGENT_PET_BUBBLE_TAIL, tipY: tailY + 2 } };
}

const round = (value: number) => Math.round(value * 10) / 10;

/**
 * 云朵轮廓：沿圆角矩形（超椭圆 n=4）等距取点，相邻两点之间画向外鼓起的圆弧，弧半径轮流变化，
 * 像一串大小不一的泡泡。路径按屏幕顺时针方向绘制，sweep=1 时圆弧朝外。
 */
export function agentPetCloudPath(width: number, height: number) {
    const a = width / 2;
    const b = height / 2;
    const samples = 240;
    const points: Array<[number, number]> = [];
    for (let index = 0; index <= samples; index += 1) {
        const t = (index / samples) * Math.PI * 2;
        const cos = Math.cos(t);
        const sin = Math.sin(t);
        points.push([a + a * Math.sign(cos) * Math.abs(cos) ** 0.5, b + b * Math.sign(sin) * Math.abs(sin) ** 0.5]);
    }
    const lengths = [0];
    for (let index = 1; index < points.length; index += 1) {
        lengths.push(lengths[index - 1] + Math.hypot(points[index][0] - points[index - 1][0], points[index][1] - points[index - 1][1]));
    }
    const perimeter = lengths[lengths.length - 1];
    const count = Math.max(8, Math.min(22, Math.round(perimeter / 30)));
    const anchors: Array<[number, number]> = [];
    let cursor = 0;
    for (let bump = 0; bump < count; bump += 1) {
        const distance = (bump / count) * perimeter;
        while (cursor < lengths.length - 2 && lengths[cursor + 1] < distance) cursor += 1;
        const span = lengths[cursor + 1] - lengths[cursor] || 1;
        const ratio = (distance - lengths[cursor]) / span;
        anchors.push([points[cursor][0] + (points[cursor + 1][0] - points[cursor][0]) * ratio, points[cursor][1] + (points[cursor + 1][1] - points[cursor][1]) * ratio]);
    }
    const factors = [0.62, 0.7, 0.58];
    let path = `M ${round(anchors[0][0])} ${round(anchors[0][1])}`;
    for (let bump = 0; bump < count; bump += 1) {
        const [x1, y1] = anchors[bump];
        const [x2, y2] = anchors[(bump + 1) % count];
        const radius = Math.hypot(x2 - x1, y2 - y1) * factors[bump % factors.length];
        path += ` A ${round(radius)} ${round(radius)} 0 0 1 ${round(x2)} ${round(y2)}`;
    }
    return `${path} Z`;
}

/** 小尾巴：一段弯弯的楔形，根部藏在云朵里，尖端指向形象。 */
export function agentPetBubbleTailPath(layout: AgentPetBubbleLayout) {
    const { baseX, baseY, tipX, tipY } = layout.tail;
    if (layout.placement === "top") {
        return `M ${round(baseX - 9)} ${round(baseY - 2)} Q ${round(baseX - 2)} ${round(baseY + 6)} ${round(tipX)} ${round(tipY)} Q ${round(baseX + 4)} ${round(baseY + 4)} ${round(baseX + 9)} ${round(baseY - 2)} Z`;
    }
    const direction = layout.placement === "left" ? 1 : -1;
    return `M ${round(baseX - 2 * direction)} ${round(baseY - 9)} Q ${round(baseX + 6 * direction)} ${round(baseY - 2)} ${round(tipX)} ${round(tipY)} Q ${round(baseX + 4 * direction)} ${round(baseY + 4)} ${round(baseX - 2 * direction)} ${round(baseY + 9)} Z`;
}
