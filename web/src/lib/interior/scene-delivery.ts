import { deliveryCsv, deliveryFileStem, xmlText } from "@/lib/delivery-text";
import { gridRegion } from "./scene-compile";
import { furnitureInfo, ROOM_TYPES, type SceneSpec, type SpecFloor, type SpecRect } from "./scene-spec";
import { compileSceneSpec } from "./scene-compile";
import { DESIGN_LAYERS, designQuantities, emptyDesignPlan, offlinePlanHtml, planDxf, planSvg, validateDesignPlan, type DesignLayer, type InteriorDesignPlan } from "./design-plan";

export type InteriorRoomSchedule = { floor: string; room: string; type: string; areaM2: number; floorFinish: string; furniture: number };
export type InteriorSceneReview = { code: string; message: string; floor?: string; room?: string };
const area = (rects: SpecRect[]) => Math.round(rects.reduce((sum, [x1, z1, x2, z2]) => sum + (x2 - x1) * (z2 - z1), 0) * 100) / 100;

/** L 形房间按 part 归组，面积用并集减柱子；重叠部分不重复计数。单位沿用场景的米。 */
export function interiorRoomSchedule(spec: SceneSpec): InteriorRoomSchedule[] {
    return spec.floors.flatMap((floor) => {
        const groups = new Map<string, typeof floor.rooms>();
        for (const room of floor.rooms) {
            const key = room.part || room.name;
            groups.set(key, [...(groups.get(key) || []), room]);
        }
        return [...groups.entries()].map(([name, rooms]) => {
            const main = rooms.find((room) => room.name === name) || rooms[0];
            return {
                floor: floor.name,
                room: name,
                type: ROOM_TYPES[main.type],
                areaM2: area(
                    gridRegion(
                        rooms.map((room) => room.rect),
                        floor.pillars,
                    ),
                ),
                floorFinish: main.floor || "未指定",
                furniture: floor.furniture.filter((item) => rooms.some((room) => room.name === item.room)).length,
            };
        });
    });
}

export function reviewInteriorScene(spec: SceneSpec): InteriorSceneReview[] {
    const issues: InteriorSceneReview[] = [{ code: "measurements_unverified", message: "尺寸、面积和家具规格来自 AI 方案；请用现场测量校正后交给设计师复核。此包不作为施工图。" }];
    for (const floor of spec.floors) {
        for (let a = 0; a < floor.rooms.length; a++) {
            const first = floor.rooms[a];
            for (const second of floor.rooms.slice(a + 1)) {
                if ((first.part || first.name) === (second.part || second.name)) continue;
                const intersection = Math.max(0, Math.min(first.rect[2], second.rect[2]) - Math.max(first.rect[0], second.rect[0])) * Math.max(0, Math.min(first.rect[3], second.rect[3]) - Math.max(first.rect[1], second.rect[1]));
                if (intersection > 0.05) issues.push({ code: "room_overlap", floor: floor.name, room: first.name, message: `${floor.name}的${first.name}与${second.name}重叠约 ${intersection.toFixed(2)} ㎡，请调整布局` });
            }
            if (!first.part && floor.rooms.length > 1 && !floor.doors.some((door) => door.room === first.name || door.between?.includes(first.name)) && !floor.open.some((pair) => pair.includes(first.name)))
                issues.push({ code: "access_unconfirmed", floor: floor.name, room: first.name, message: `${floor.name}的${first.name}未标出门或开放连接，请核对出入口` });
        }
        for (const item of floor.furniture) {
            const room = floor.rooms.find((room) => room.name === item.room);
            if (!room) {
                issues.push({ code: "furniture_room_missing", floor: floor.name, message: `${item.room}中的家具没有对应房间` });
                continue;
            }
            const size = item.size || furnitureInfo(item.type).size;
            const angle = item.facing ? (["e", "w"].includes(item.facing) ? 90 : 0) : item.rotate || 0;
            const radians = (angle * Math.PI) / 180;
            const w = Math.abs(size[0] * Math.cos(radians)) + Math.abs(size[1] * Math.sin(radians));
            const d = Math.abs(size[0] * Math.sin(radians)) + Math.abs(size[1] * Math.cos(radians));
            if (w > room.rect[2] - room.rect[0] + 0.01 || d > room.rect[3] - room.rect[1] + 0.01)
                issues.push({ code: "furniture_size", floor: floor.name, room: room.name, message: `${floor.name}的${room.name}放置${furnitureInfo(item.type).name}可能超出空间，请核对尺寸与朝向` });
        }
    }
    return issues;
}

/** 可编辑 SVG 空间草图：房间分区、名称和净面积。门窗细节以原始方案 JSON 与 3D 模型为准。 */
export function interiorFloorSvg(floor: SpecFloor, schedule: InteriorRoomSchedule[]) {
    if (!floor.rooms.length) throw new Error("楼层没有房间，无法导出平面图");
    const rects = floor.rooms.map((room) => room.rect);
    const minX = Math.min(...rects.map((rect) => rect[0])),
        minZ = Math.min(...rects.map((rect) => rect[1]));
    const maxX = Math.max(...rects.map((rect) => rect[2])),
        maxZ = Math.max(...rects.map((rect) => rect[3]));
    const scale = 65,
        pad = 65,
        width = (maxX - minX) * scale + pad * 2,
        height = (maxZ - minZ) * scale + pad * 2 + 55;
    const position = ([x1, z1, x2, z2]: SpecRect) => ({ x: (x1 - minX) * scale + pad, y: (z1 - minZ) * scale + pad, w: (x2 - x1) * scale, h: (z2 - z1) * scale });
    const shapes = floor.rooms
        .map((room) => {
            const { x, y, w, h } = position(room.rect);
            const row = schedule.find((row) => row.floor === floor.name && row.room === (room.part || room.name));
            return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#f3f0e8" stroke="#333" stroke-width="1.5"/>${room.part ? "" : `<text x="${x + w / 2}" y="${y + h / 2}" text-anchor="middle" font-size="13">${xmlText(room.name)}<tspan x="${x + w / 2}" dy="20">${row?.areaM2 ?? "?"} ㎡</tspan></text>`}`;
        })
        .join("");
    const pillars = floor.pillars
        .map((rect) => {
            const { x, y, w, h } = position(rect);
            return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#6b6b6b"/>`;
        })
        .join("");
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><title>${xmlText(floor.name)}空间草图</title><rect width="100%" height="100%" fill="white"/><g font-family="sans-serif" fill="#202020"><text x="${pad}" y="28" font-size="18">${xmlText(floor.name)} · 方案俯视图（方位未校准）</text><text x="${pad}" y="48" font-size="12">开间 ${(maxX - minX).toFixed(2)} m · 进深 ${(maxZ - minZ).toFixed(2)} m</text>${shapes}${pillars}<text x="${pad}" y="${height - 38}" font-size="12">AI 方案草图 · 尺寸待现场核实 · 不作为施工图</text><text x="${pad}" y="${height - 18}" font-size="12">门窗与家具定位请对照场景 JSON 和 3D 模型</text></g></svg>`;
}

export function interiorDeliveryFiles(spec: SceneSpec, design: InteriorDesignPlan = emptyDesignPlan()) {
    validateDesignPlan(design, spec);
    const rooms = interiorRoomSchedule(spec);
    const issues = reviewInteriorScene(spec);
    const furniture = spec.floors.flatMap((floor) =>
        floor.furniture.map((item) => {
            const size = item.size || furnitureInfo(item.type).size;
            return [floor.name, item.room, furnitureInfo(item.type).name, size[0], size[1], item.color || "", item.pos ? item.pos.join(",") : `锚点 ${item.at}`, item.facing || item.rotate || 0];
        }),
    );
    const quantities = designQuantities(spec, design);
    const drawings = compileSceneSpec(spec).plans.flatMap((plan) =>
        (Object.keys(DESIGN_LAYERS) as DesignLayer[])
            .filter((layer) => ["layout", "flooring", "ceiling"].includes(layer) || design.marks.some((mark) => mark.floor === plan.index && mark.layer === layer))
            .flatMap((layer) => {
                const stem = `${plan.index + 1}-${deliveryFileStem(plan.name)}-${DESIGN_LAYERS[layer].name}`;
                return [
                    { name: `图纸/${stem}.svg`, data: planSvg(spec, plan, layer, design) },
                    { name: `CAD/${stem}.dxf`, data: planDxf(spec, plan, layer, design) },
                ];
            }),
    );
    return [
        { name: "离线方案.html", data: offlinePlanHtml(spec, design) },
        { name: "设计图层与报价.json", data: JSON.stringify(design, null, 2) },
        {
            name: "工程量与报价.csv",
            data: deliveryCsv([
                ["类别", "项目", "工程量", "含损耗采购量", "单位", "材料单价", "人工单价", "金额"],
                ...quantities.map((row) => [row.category, row.name, row.quantity, row.purchase, row.unit, row.material ?? "待报价", row.labor ?? "待报价", row.total ?? "待报价"]),
            ]),
        },
        { name: "场景.json", data: JSON.stringify({ version: 2, title: spec.title, summary: spec.summary, spec }, null, 2) },
        { name: "房间面积.csv", data: deliveryCsv([["楼层", "房间", "类型", "净面积㎡（方案估算）", "地面材质", "家具数量"], ...rooms.map((row) => [row.floor, row.room, row.type, row.areaM2, row.floorFinish, row.furniture])]) },
        { name: "家具清单.csv", data: deliveryCsv([["楼层", "房间", "家具", "宽m", "深m", "颜色", "定位", "朝向或旋转角"], ...furniture]) },
        { name: "方案检查.json", data: JSON.stringify({ title: spec.title, rooms: rooms.length, issues }, null, 2) },
        {
            name: "方案说明.md",
            data: `# ${spec.title}\n\n${spec.summary}\n\n房间面积表按房间矩形并集减柱子计算，不含阳台与庭院，是墙中线方案面积。工程量表的地面扣墙体、柱子与楼梯洞，顶面按相同净投影，墙面按单面外墙与双面隔墙扣门窗；不含立面造型增量。家具按实际编译摆放算量，配置清单另附。材料按损耗增加采购量，人工按净量；报价未齐不计算整套总价。\n\n${issues.map((item) => `- ${item.message}`).join("\n")}\n\n图纸包含门窗开合、家具轮廓及尺寸，SVG 与 DXF 共用模型的实际定位。DXF 为毫米单位、分层可编辑的方案图，不声明国标施工图合规。水电与拆改为人工辅助标记，没有自动核定电气负荷、管径、坡度、立管或承重属性。封闭轮廓计投影面积，定制造型可在三维预览。离线 HTML 可双击查看各层平面、辅助图层与报价，不依赖外网；三维另在页面导出 GLB。施工前以现场测量、物业结构图和专业审核为准。`,
        },
        ...drawings,
        ...spec.floors.filter((floor) => floor.rooms.length).map((floor, index) => ({ name: `平面图/${index + 1}-${deliveryFileStem(floor.name)}.svg`, data: interiorFloorSvg(floor, rooms) })),
    ];
}
