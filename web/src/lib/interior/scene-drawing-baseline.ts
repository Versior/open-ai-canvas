import type { SceneBrief } from "./scene-3d";
import type { InteriorSceneData } from "./scene-spec";
import { checkSceneCompletion } from "./scene-validation";

/** 用户确认过的同图结构也要经过当前校核，不能把历史失败或无图模型当作基准。 */
export function drawingBaselineBrief(scene: InteriorSceneData, description: string): SceneBrief {
    if (scene.version !== 2 || scene.spec.grid?.source !== "drawing" || !scene.spec.grid.image || !scene.spec.grid.width || !scene.spec.grid.depth) throw new Error("这份结构基准没有完整的图纸尺寸和对照范围");
    const { spec, issues } = checkSceneCompletion(scene.spec, scene.spec.scope);
    if (issues.length) throw new Error(`已校准结构未通过当前检查：${issues.join("；")}`);
    const size = { width: spec.grid!.width!, depth: spec.grid!.depth!, floors: spec.floors.length, storeyHeight: spec.floors[0].height };
    return {
        source: "drawing",
        scope: spec.scope,
        title: spec.title,
        summary: spec.summary,
        size,
        dimensionChains: { x: [size.width], z: [size.depth] },
        layout: spec,
        spaces: spec.floors.flatMap((floor) => [...floor.rooms.filter((room) => !room.part).map((room) => ({ name: room.name })), ...floor.balconies.filter((area) => area.name).map((area) => ({ name: area.name! }))]),
        description: description.trim() || spec.summary || spec.title,
        features: [],
        materials: [],
        furniture: [],
        renderNotes: "保持已校准的图纸结构，只调整材质、家具和光线。",
    };
}
