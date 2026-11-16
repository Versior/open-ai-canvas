import { packet } from "./motion-geometry";

export const duration = 2.55;
export const smooth = (a: number, b: number, value: number) => {
    const t = Math.max(0, Math.min(1, (value - a) / (b - a)));
    return t * t * (3 - 2 * t);
};

export function layoutCards(width: number, height: number, count: number) {
    const aspect = width / height;
    const columns = Math.min(count, aspect > 1.55 ? (count > 5 ? 4 : 5) : aspect > 1 ? 4 : aspect > 0.64 ? 3 : 2);
    const rows = Math.ceil(count / columns);
    const centerY = rows === 1 ? 2.55 : 1.85 + (rows - 1) * 1.69;
    const worldHeight = Math.max(6, rows * 3.38 + 1.2, (columns * 2.02 + (columns - 1) * 0.3 + 1.3) / aspect);
    return {
        centerY,
        worldHeight,
        worldWidth: worldHeight * aspect,
        positions: Array.from({ length: count }, (_, index): [number, number, number] => {
            const row = Math.floor(index / columns);
            const rowCount = Math.min(columns, count - row * columns);
            return [((index % columns) - (rowCount - 1) / 2) * 2.32, 1.85 + (rows - row - 1) * 3.38, 0.12];
        }),
    };
}

export function cardPose(layout: ReturnType<typeof layoutCards>, index: number, time: number) {
    const lift = smooth(0.25, 0.8, time);
    const fan = smooth(0.85, 1.4, time);
    const settle = smooth(1.4, 2.35, time);
    const flatten = smooth(2.28, 2.5, time);
    const end = layout.positions[index];
    const centers = [
        [2.4, 0.45, 1.2],
        [0, 1.05, -1.2],
        [-1.7, 0.9, -0.6],
        [-2.4, 0.1, 0.6],
        [0.15, -0.35, 1.8],
    ];
    const center = layout.positions.length === 5 ? centers[index] : [(index - (layout.positions.length - 1) / 2) * 0.8, 0.6 - (index % 3) * 0.35, (layout.positions.length - index) * 0.55];
    const stackZ = (layout.positions.length === 5 ? center[2] / 0.6 - 0.5 : (layout.positions.length - 1) / 2 - index) * packet.cardGap;
    const fanX = Math.max(-layout.worldWidth / 2 + 1.4, Math.min(layout.worldWidth / 2 - 1.4, center[0]));
    const fanY = layout.centerY + center[1];
    const rotation = smooth(1.04, 1.4, time) * (1 - settle);
    return {
        visible: true,
        position: [fanX * fan * (1 - settle) + end[0] * settle, ((layout.centerY - 0.6 + 1.85 * lift) * (1 - fan) + fanY * fan) * (1 - settle) + end[1] * settle, (stackZ * (1 - fan) + center[2] * fan) * (1 - flatten) + end[2] * flatten] as [
            number,
            number,
            number,
        ],
        rotation: [rotation * 0.025, rotation * (index % 2 ? -0.07 : 0.07) - 0.035 * flatten, rotation * (index % 2 ? -0.12 : 0.12) + (index % 2 ? -0.008 : 0.008) * flatten] as [number, number, number],
        scale: 1,
        settled: settle,
    };
}

export function packetPose(layout: ReturnType<typeof layoutCards>, time: number) {
    const lift = smooth(0.25, 0.8, time);
    return { y: layout.centerY - 0.65 - 1.65 * lift - 1.2 * smooth(0.8, 1.25, time), opacity: 1 - smooth(0.9, 1.25, time) };
}
