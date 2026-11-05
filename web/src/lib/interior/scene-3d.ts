/**
 * 室内设计「3D 模型」：让文本模型按固定格式输出一份三维场景 JSON（基础几何体搭出的建筑、房间和家具），
 * 页面用 three.js 渲染成可以旋转、缩放的模型。不执行模型写的代码，只读数据；解析时收紧数量、尺寸和取值，
 * 读不懂的物体直接丢掉，不拿默认值补出不存在的东西。
 */

export const SCENE_MATERIALS = ["wall", "concrete", "brick", "stone", "marble", "tile", "wood", "wood-dark", "glass", "metal", "metal-dark", "roof", "fabric", "leather", "grass", "soil", "water", "plant", "light"] as const;
export type SceneMaterial = (typeof SCENE_MATERIALS)[number];

export const SCENE_SHAPES = ["box", "cylinder", "sphere", "cone", "prism", "wall"] as const;
export type SceneShape = (typeof SCENE_SHAPES)[number];

export type SceneVector = [number, number, number];

/** 墙上的门窗洞：offset 是洞口中心离墙起点的距离，bottom 是洞口下沿离墙底的高度。窗洞自动补一块玻璃，门洞留空。 */
export type SceneOpening = { kind: "window" | "door"; offset: number; width: number; bottom: number; height: number };

/** 重复排列：同一个物体按 step 平移 count 次（含自己），用来做一排窗、柱子、栏杆、树。 */
export type SceneRepeat = { count: number; step: SceneVector };

export type SceneObject = {
    shape: SceneShape;
    /** 除 wall 外都要有：几何体中心点。 */
    position?: SceneVector;
    /** wall 用：墙在地面上的起点、终点 [x, z]，墙底高度 base（默认 0），厚度 thickness（默认 0.2），门窗洞 openings。 */
    start?: [number, number];
    end?: [number, number];
    base?: number;
    thickness?: number;
    openings?: SceneOpening[];
    repeat?: SceneRepeat;
    /** box、prism 用：宽（x）、高（y）、深（z）。 */
    size?: SceneVector;
    /** cylinder、sphere、cone 用。 */
    radius?: number;
    /** cylinder、cone、wall 用。 */
    height?: number;
    /** 绕 x、y、z 轴的角度（度）。 */
    rotation?: SceneVector;
    material: SceneMaterial;
    color?: string;
    name?: string;
    group?: string;
};

export type SceneLabel = { text: string; position: SceneVector };

export type InteriorScene3D = {
    version: 1;
    title: string;
    summary: string;
    ground: { material: SceneMaterial; size: [number, number] };
    objects: SceneObject[];
    labels: SceneLabel[];
};

export type InteriorSceneScope = "room" | "home" | "building";

export const SCENE_SCOPES: { value: InteriorSceneScope; label: string; hint: string }[] = [
    { value: "room", label: "单个房间", hint: "一个房间的硬装和家具，可以看清布置" },
    { value: "home", label: "整套户型", hint: "一套房子的所有房间，去掉屋顶从上往下看" },
    { value: "building", label: "建筑外观", hint: "别墅、小楼和庭院，看外立面和体量" },
];

/** 一个场景最多保留的物体和标注数（分几部分生成后合起来）；超出的按顺序截掉。 */
export const SCENE_MAX_OBJECTS = 1200;
export const SCENE_MAX_LABELS = 40;
/** 每一部分提示词里要求的物体上限：一个物体约 100 个字符，模型一次回复的长度有限。 */
const SCENE_PROMPT_OBJECTS = 200;
const SCENE_MAX_EXTENT = 200;
const SCENE_MIN_SIZE = 0.01;
const SCENE_MAX_SIZE = 120;
const SCENE_TEXT_LIMIT = 40;
const SCENE_MAX_OPENINGS = 16;
/** 一个物体最多重复的次数，和整个场景展开后的网格上限（渲染时用）。 */
export const SCENE_MAX_REPEAT = 60;
export const SCENE_MAX_MESHES = 4000;
const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

/** 各种材质给模型看的用途说明，也决定页面上的默认颜色。 */
const MATERIAL_HINTS: Record<SceneMaterial, string> = {
    wall: "白色或浅色墙面、楼板",
    concrete: "清水混凝土、外墙、台阶",
    brick: "红砖、砖墙",
    stone: "石材外墙、景观石",
    marble: "大理石地面、台面",
    tile: "瓷砖地面、卫生间",
    wood: "浅色木地板、木家具",
    "wood-dark": "深色木饰面、门、实木家具",
    glass: "窗户、玻璃幕墙、栏板（半透明）",
    metal: "不锈钢、灯具、五金",
    "metal-dark": "黑色窗框、栏杆、钢结构",
    roof: "屋面瓦、坡屋顶",
    fabric: "布艺沙发、床品、窗帘",
    leather: "皮质沙发、椅子",
    grass: "草坪",
    soil: "土地、花坛",
    water: "水池、泳池（半透明）",
    plant: "绿植、树冠、灌木",
    light: "灯带、发光灯具",
};

/** 从模型回复里取出 JSON 文本：去掉 ```json 代码块标记和前后的说明文字。 */
export function extractSceneJson(text: string) {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)(?:```|$)/i);
    const body = (fenced ? fenced[1] : text).trim();
    const start = body.indexOf("{");
    return start >= 0 ? body.slice(start) : body;
}

/**
 * 解析模型给的 JSON。回复太长被截断时，从末尾往前找最后一个完整的物体，补上括号再解析；
 * 返回 truncated 让页面告诉用户只保留了前面的部分。
 */
export function parseSceneJson(text: string): { value: unknown; truncated: boolean } {
    const json = extractSceneJson(text);
    try {
        return { value: JSON.parse(json), truncated: false };
    } catch {
        // 往前找 "}" 结尾的位置，依次尝试补齐 objects 数组和外层对象。
        let cut = json.length;
        for (let attempt = 0; attempt < 400; attempt += 1) {
            cut = json.lastIndexOf("}", cut - 1);
            if (cut <= 0) break;
            for (const tail of ["]}", "]}]}", "}"]) {
                try {
                    return { value: JSON.parse(json.slice(0, cut + 1) + tail), truncated: true };
                } catch {
                    // 换下一种补法。
                }
            }
        }
        throw new Error("模型没有返回能读懂的 3D 场景，请换一个模型或把描述写简单些再试");
    }
}

function finiteNumber(value: unknown) {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** 数值保留两位小数，省体积也去掉模型写出的长尾小数。 */
function round2(value: number) {
    return Math.round(value * 100) / 100;
}

function vector(value: unknown, limit: number, min = -limit): SceneVector | null {
    if (!Array.isArray(value) || value.length !== 3) return null;
    const numbers = value.map(finiteNumber);
    if (numbers.some((item) => item === null)) return null;
    return numbers.map((item) => round2(Math.min(limit, Math.max(min, item as number)))) as SceneVector;
}

function vector2(value: unknown): [number, number] | null {
    if (!Array.isArray(value) || value.length !== 2) return null;
    const numbers = value.map(finiteNumber);
    if (numbers.some((item) => item === null)) return null;
    return numbers.map((item) => round2(Math.min(SCENE_MAX_EXTENT, Math.max(-SCENE_MAX_EXTENT, item as number)))) as [number, number];
}

function dimension(value: unknown) {
    const number = finiteNumber(value);
    if (number === null || number <= 0) return null;
    return round2(Math.min(SCENE_MAX_SIZE, Math.max(SCENE_MIN_SIZE, number)));
}

function shortText(value: unknown, limit = SCENE_TEXT_LIMIT) {
    return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function material(value: unknown): SceneMaterial | null {
    return typeof value === "string" && (SCENE_MATERIALS as readonly string[]).includes(value) ? (value as SceneMaterial) : null;
}

function sceneObject(raw: unknown): SceneObject | null {
    if (!raw || typeof raw !== "object") return null;
    const item = raw as Record<string, unknown>;
    const shape = typeof item.shape === "string" && (SCENE_SHAPES as readonly string[]).includes(item.shape) ? (item.shape as SceneShape) : null;
    if (!shape) return null;
    const object = shape === "wall" ? sceneWall(item) : sceneSolid(shape, item);
    if (!object) return null;
    const rotation = vector(item.rotation, 360);
    if (rotation && rotation.some((value) => value !== 0)) object.rotation = rotation;
    if (typeof item.color === "string" && COLOR_PATTERN.test(item.color.trim())) object.color = item.color.trim().toLowerCase();
    const name = shortText(item.name);
    if (name) object.name = name;
    const group = shortText(item.group, 16);
    if (group) object.group = group;
    const repeat = item.repeat && typeof item.repeat === "object" ? (item.repeat as Record<string, unknown>) : null;
    const count = repeat ? finiteNumber(repeat.count) : null;
    const step = repeat ? vector(repeat.step, SCENE_MAX_EXTENT) : null;
    if (count !== null && step && Math.round(count) > 1) object.repeat = { count: Math.min(SCENE_MAX_REPEAT, Math.round(count)), step };
    return object;
}

/** 读一个按中心点摆放的几何体：box、prism 要三边尺寸，其余要半径，圆柱和圆锥还要高。 */
function sceneSolid(shape: Exclude<SceneShape, "wall">, item: Record<string, unknown>): SceneObject | null {
    const position = vector(item.position, SCENE_MAX_EXTENT);
    if (!position) return null;
    const object: SceneObject = { shape, position, material: material(item.material) || "wall" };
    if (shape === "box" || shape === "prism") {
        const size = Array.isArray(item.size) && item.size.length === 3 ? item.size.map(dimension) : null;
        if (!size || size.some((value) => value === null)) return null;
        object.size = size as SceneVector;
        return object;
    }
    const radius = dimension(item.radius);
    if (!radius) return null;
    object.radius = radius;
    if (shape !== "sphere") {
        const height = dimension(item.height);
        if (!height) return null;
        object.height = height;
    }
    return object;
}

/** 读一面墙：起点终点要隔开至少 10 厘米；门窗洞超出墙的部分裁掉，裁完太窄的丢掉。 */
function sceneWall(item: Record<string, unknown>): SceneObject | null {
    const start = vector2(item.start);
    const end = vector2(item.end);
    const height = dimension(item.height);
    if (!start || !end || !height) return null;
    const length = Math.hypot(end[0] - start[0], end[1] - start[1]);
    if (length < 0.1) return null;
    const object: SceneObject = { shape: "wall", start, end, height, material: material(item.material) || "wall" };
    const base = finiteNumber(item.base);
    if (base !== null && base !== 0) object.base = round2(Math.min(SCENE_MAX_EXTENT, Math.max(-SCENE_MAX_EXTENT, base)));
    const thickness = finiteNumber(item.thickness);
    if (thickness !== null && thickness > 0) object.thickness = round2(Math.min(2, Math.max(0.05, thickness)));
    const openings: SceneOpening[] = [];
    for (const raw of Array.isArray(item.openings) ? item.openings : []) {
        if (openings.length >= SCENE_MAX_OPENINGS || !raw || typeof raw !== "object") continue;
        const entry = raw as Record<string, unknown>;
        const kind = entry.kind === "door" ? "door" : "window";
        const offset = finiteNumber(entry.offset);
        const width = dimension(entry.width);
        const openingHeight = dimension(entry.height);
        const bottom = Math.max(0, finiteNumber(entry.bottom) ?? (kind === "door" ? 0 : 0.9));
        if (offset === null || !width || !openingHeight) continue;
        const left = Math.max(0, offset - width / 2);
        const right = Math.min(length, offset + width / 2);
        const top = Math.min(height, bottom + openingHeight);
        if (right - left < 0.2 || top - bottom < 0.2) continue;
        openings.push({ kind, offset: round2((left + right) / 2), width: round2(right - left), bottom: round2(bottom), height: round2(top - bottom) });
    }
    // 洞口重叠时三角化会出错，按位置排好后去掉和前一个重叠的。
    const kept: SceneOpening[] = [];
    for (const opening of openings.sort((a, b) => a.offset - b.offset)) {
        const previous = kept[kept.length - 1];
        if (previous && opening.offset - opening.width / 2 < previous.offset + previous.width / 2 + 0.05) continue;
        kept.push(opening);
    }
    if (kept.length) object.openings = kept;
    return object;
}

/**
 * 把解析出的 JSON 收成页面能渲染的场景：物体不超过 400 个，坐标在 ±200 米以内，尺寸在 1 厘米到 120 米之间，
 * 材质和形状只认列表里的。一个能用的物体都没有时报错。
 */
export function normalizeInteriorScene(value: unknown): { scene: InteriorScene3D; dropped: number } {
    if (!value || typeof value !== "object") throw new Error("模型返回的不是 3D 场景");
    const raw = value as Record<string, unknown>;
    const rawObjects = Array.isArray(raw.objects) ? raw.objects : [];
    const objects: SceneObject[] = [];
    let dropped = 0;
    for (const item of rawObjects) {
        if (objects.length >= SCENE_MAX_OBJECTS) {
            dropped += 1;
            continue;
        }
        const object = sceneObject(item);
        if (object) objects.push(object);
        else dropped += 1;
    }
    if (!objects.length) throw new Error("模型返回的场景里没有能显示的物体，请换一个模型再试");
    const labels: SceneLabel[] = [];
    for (const item of Array.isArray(raw.labels) ? raw.labels : []) {
        if (labels.length >= SCENE_MAX_LABELS || !item || typeof item !== "object") continue;
        const text = shortText((item as Record<string, unknown>).text, 20);
        const position = vector((item as Record<string, unknown>).position, SCENE_MAX_EXTENT);
        if (text && position) labels.push({ text, position });
    }
    const ground = raw.ground && typeof raw.ground === "object" ? (raw.ground as Record<string, unknown>) : {};
    const groundSize = Array.isArray(ground.size) && ground.size.length === 2 ? ground.size.map(dimension) : null;
    const scene: InteriorScene3D = {
        version: 1,
        title: shortText(raw.title) || "3D 模型",
        summary: shortText(raw.summary, 120),
        ground: { material: material(ground.material) || "concrete", size: groundSize && groundSize.every(Boolean) ? (groundSize as [number, number]) : sceneFootprint(objects) },
        objects,
        labels,
    };
    return { scene, dropped };
}

/** 没给地面大小时按物体占地外扩一圈。 */
function sceneFootprint(objects: SceneObject[]): [number, number] {
    let maxX = 4;
    let maxZ = 4;
    for (const object of objects) {
        if (object.start && object.end) {
            maxX = Math.max(maxX, Math.abs(object.start[0]), Math.abs(object.end[0]));
            maxZ = Math.max(maxZ, Math.abs(object.start[1]), Math.abs(object.end[1]));
            continue;
        }
        if (!object.position) continue;
        const half = object.size ? [object.size[0] / 2, object.size[2] / 2] : [object.radius || 0, object.radius || 0];
        maxX = Math.max(maxX, Math.abs(object.position[0]) + half[0]);
        maxZ = Math.max(maxZ, Math.abs(object.position[2]) + half[1]);
    }
    return [round2(Math.min(SCENE_MAX_SIZE, maxX * 2 + 4)), round2(Math.min(SCENE_MAX_SIZE, maxZ * 2 + 4))];
}

/** 场景里出现过的分组，按第一次出现的顺序；页面据此给出「隐藏屋顶」「只看一层」之类的开关。 */
export function sceneGroups(scene: InteriorScene3D) {
    const groups: string[] = [];
    for (const object of scene.objects) if (object.group && !groups.includes(object.group)) groups.push(object.group);
    return groups;
}

const SHAPE_GUIDE = [
    "- box：size [宽x, 高y, 深z]。墙、楼板、柜子、床、桌面都用它",
    "- cylinder：radius、height，竖直圆柱。柱子、圆桌、灯、树干",
    "- sphere：radius。树冠、灯球",
    "- cone：radius、height，尖朝上。尖顶、灌木、落地灯罩",
    "- prism：size [宽x, 高y, 深z]，横截面是等腰三角形、沿 z 方向延伸，用来做坡屋顶；要换方向就绕 y 轴转 90 度",
    '- wall：一面墙，不写 position，写 start [x,z]、end [x,z]（墙在地面上的两端）、height、base（墙底高度，二层的墙写 3）、thickness（默认 0.2），以及 openings 门窗洞：[{"kind":"window","offset":离起点距离,"width":1.5,"bottom":0.9,"height":1.6},{"kind":"door","offset":2,"width":0.9,"height":2.1}]。窗洞会自动装玻璃，门洞留空。外墙、隔墙都用 wall，一面墙一个物体，不要用一堆 box 拼',
];

const SCOPE_GUIDE: Record<InteriorSceneScope, string> = {
    room: "范围是一个房间：四面墙（朝镜头的一面墙可以只做半高，方便看里面）、地面、吊顶不做，门窗、硬装和全部主要家具都要有。",
    home: "范围是一整套户型：所有房间的墙体按真实布局分隔，门洞留出来，不做屋顶和吊顶（从上往下能看清户型），每个房间放主要家具，并在每个房间中央上方放标注。",
    building: "范围是建筑外观：建筑主体、每层楼板、外墙、门窗、阳台栏板、屋顶，以及庭院、围墙、道路和绿化；内部只做楼板和少量家具，每层写一个 group。",
};

export type ScenePromptInput = {
    scope: InteriorSceneScope;
    description: string;
    roomName?: string;
    styleName?: string;
    stylePrompt?: string;
    hasReference: boolean;
};

function geometryRules() {
    return [
        "坐标：y 轴向上，单位米，地面是 y=0；x 向右（东），z 向前（南，朝镜头）。每个物体的 position 是几何体的中心点，比如放在地上、高 3 米的柱子，中心 y 是 1.5。",
        "可以用的形状：",
        ...SHAPE_GUIDE,
        "rotation 写 [绕x, 绕y, 绕z] 的角度（度），不转可以不写。",
        '任何物体都可以加 repeat：{"count": 6, "step": [3, 0, 0]}，表示同一个物体每次平移 step 再放一个，一共 count 个（最多 60）。一排柱子、栏杆、台阶、树、路灯、书架隔板都用 repeat，不要一个个写。',
        `material 只能从这些里选：${SCENE_MATERIALS.map((item) => `${item}（${MATERIAL_HINTS[item]}）`).join("；")}。`,
        'color 可选，写成 "#RRGGBB"，用来覆盖材质的默认颜色，表现风格配色。',
        "建模规则：墙厚 0.2 米，层高 3 米，楼板厚 0.2 米；门窗用 wall 的 openings 开洞，不要另外拼墙；家具用真实尺寸（沙发约 2.2×0.8×0.9 米，双人床约 1.8×0.5×2.1 米，餐桌约 1.6×0.75×0.9 米）；物体贴着地面或楼板放，不要悬空，也不要明显穿插。name 可以不写，写的话不超过 6 个字。",
        "只输出一个 JSON 对象，不要解释，不要代码块标记，不要换行缩进。",
    ];
}

const OBJECT_EXAMPLE =
    '{"shape":"box","size":[10,0.2,8],"position":[0,0.1,0],"material":"wall"},{"shape":"wall","start":[-5,4],"end":[5,4],"height":3,"openings":[{"kind":"door","offset":5,"width":1.8,"height":2.4},{"kind":"window","offset":2,"width":2,"bottom":0.9,"height":1.6}],"material":"wall"},{"shape":"cylinder","radius":0.15,"height":3,"position":[-4,1.5,5],"material":"wood-dark","repeat":{"count":4,"step":[2.6,0,0]}}';

function requestLines(input: ScenePromptInput) {
    return [
        SCOPE_GUIDE[input.scope],
        ...(input.roomName ? [`空间：${input.roomName}。`] : []),
        ...(input.styleName ? [`风格：${input.styleName}${input.stylePrompt ? `（${input.stylePrompt}）` : ""}。用 color 表现这个风格的配色和材质。`] : []),
        ...(input.hasReference ? ["附图是用户给的户型图或现场照片，按图里的布局、比例和门窗位置建模。"] : []),
        `用户的需求：${input.description.trim() || "按上面的范围和风格做一个完整、比例真实的方案"}`,
    ];
}

/** 规划里的一部分：分组名、要搭什么、在地面上的范围 [x1, z1, x2, z2] 和高度范围。 */
export type ScenePlanPart = { group: string; brief: string; bounds: [number, number, number, number]; base: number; top: number };

/** 第一步的规划：总体尺寸、分成几部分、标注。每一部分再单独请求一次，拼起来就是完整的模型。 */
export type ScenePlan = { title: string; summary: string; ground: InteriorScene3D["ground"]; parts: ScenePlanPart[]; labels: SceneLabel[] };

export const SCENE_MAX_PARTS = 6;

/** 第一步：只做规划，不搭具体物体。回复很短，不会被截断。 */
export function buildScenePlanPrompt(input: ScenePromptInput) {
    return [
        "你是建筑和室内设计的三维建模师。要用基础几何体搭一个能在网页里旋转查看的三维模型，因为模型很细，分几部分来搭。这一步只做规划，不写具体物体。",
        "",
        ...requestLines(input),
        "",
        "坐标：y 轴向上，单位米，地面是 y=0；x 向右（东），z 向前（南，朝镜头），模型中心放在原点附近。",
        `把模型分成 2–${SCENE_MAX_PARTS} 部分，每部分之后会单独请求一次，每次最多 ${SCENE_PROMPT_OBJECTS} 个物体：建筑按楼层分（「一层」「二层」…，每层含这一层的楼板、外墙和门窗、内墙、楼梯、阳台和家具），再加「屋顶」「庭院」；户型按区域分（「客厅餐厅」「卧室」「厨卫」…）；单个房间按「墙地面和门窗」「家具」「软装灯具」分。`,
        "每部分写：group（分组名，2–6 个字）、brief（这部分要搭的具体内容，写清尺寸、门窗位置、家具，60–150 字，后面搭的时候只看得到这段说明和总体尺寸，所以要写具体）、bounds [x1, z1, x2, z2]（这部分在地面上的范围）、base 和 top（这部分的底和顶高度）。几部分的尺寸和位置要互相对得上，例如每层外墙的范围相同、二层 base 等于一层 top。",
        "title 写这个方案的名字（例如「三层新中式别墅」），summary 一句话说设计（风格、布局、主要材质），都不要提规划、分几部分这些建模过程。",
        "labels 是文字标注，放在房间或区域中央上方，最多 20 个。",
        '只输出一个 JSON 对象，不要解释，不要代码块标记：{"title":"一句话标题","summary":"一句话说明","ground":{"material":"grass","size":[宽,深]},"parts":[{"group":"一层","brief":"……","bounds":[-6,-5,6,5],"base":0,"top":3.2}],"labels":[{"text":"客厅","position":[0,3.4,0]}]}',
    ].join("\n");
}

function planPart(raw: unknown): ScenePlanPart | null {
    if (!raw || typeof raw !== "object") return null;
    const item = raw as Record<string, unknown>;
    const group = shortText(item.group, 16);
    const brief = shortText(item.brief, 400);
    const bounds = Array.isArray(item.bounds) && item.bounds.length === 4 ? item.bounds.map(finiteNumber) : null;
    if (!group || !bounds || bounds.some((value) => value === null)) return null;
    const base = finiteNumber(item.base) ?? 0;
    const top = finiteNumber(item.top) ?? base + 3;
    const clamp = (value: number) => round2(Math.min(SCENE_MAX_EXTENT, Math.max(-SCENE_MAX_EXTENT, value)));
    return { group, brief, bounds: (bounds as number[]).map(clamp) as ScenePlanPart["bounds"], base: clamp(base), top: clamp(Math.max(top, base + 0.1)) };
}

/** 读第一步的规划；没有能用的部分时报错。 */
export function normalizeScenePlan(value: unknown): ScenePlan {
    if (!value || typeof value !== "object") throw new Error("模型没有给出建模规划");
    const raw = value as Record<string, unknown>;
    const parts = (Array.isArray(raw.parts) ? raw.parts : [])
        .map(planPart)
        .filter((item): item is ScenePlanPart => item !== null)
        .slice(0, SCENE_MAX_PARTS);
    if (!parts.length) throw new Error("模型给的建模规划里没有能用的部分，请换一个模型再试");
    const ground = raw.ground && typeof raw.ground === "object" ? (raw.ground as Record<string, unknown>) : {};
    const groundSize = Array.isArray(ground.size) && ground.size.length === 2 ? ground.size.map(dimension) : null;
    const labels: SceneLabel[] = [];
    for (const item of Array.isArray(raw.labels) ? raw.labels : []) {
        if (labels.length >= SCENE_MAX_LABELS || !item || typeof item !== "object") continue;
        const text = shortText((item as Record<string, unknown>).text, 20);
        const position = vector((item as Record<string, unknown>).position, SCENE_MAX_EXTENT);
        if (text && position) labels.push({ text, position });
    }
    return {
        title: shortText(raw.title) || "3D 模型",
        summary: shortText(raw.summary, 120),
        ground: { material: material(ground.material) || "concrete", size: groundSize && groundSize.every(Boolean) ? (groundSize as [number, number]) : planFootprint(parts) },
        parts,
        labels,
    };
}

function planFootprint(parts: ScenePlanPart[]): [number, number] {
    const extent = parts.reduce((value, part) => Math.max(value, ...part.bounds.map(Math.abs)), 4);
    const size = round2(Math.min(SCENE_MAX_SIZE, extent * 2 + 8));
    return [size, size];
}

/** 第二步：按规划搭其中一部分，只输出这一部分的物体。 */
export function buildScenePartPrompt(input: ScenePromptInput, plan: ScenePlan, index: number) {
    const part = plan.parts[index];
    const others = plan.parts.filter((_, other) => other !== index).map((item) => `- ${item.group}：x ${item.bounds[0]}~${item.bounds[2]}，z ${item.bounds[1]}~${item.bounds[3]}，高 ${item.base}~${item.top} 米`);
    return [
        "你是建筑和室内设计的三维建模师。一个三维模型分几部分来搭，现在只搭其中一部分，其他部分由别人搭，最后拼在一起。",
        "",
        ...requestLines(input),
        "",
        `整体：${plan.title}。${plan.summary}`,
        `现在要搭的是「${part.group}」：${part.brief}`,
        `这一部分在地面上的范围是 x ${part.bounds[0]}~${part.bounds[2]}、z ${part.bounds[1]}~${part.bounds[3]}，高度 ${part.base}~${part.top} 米。所有物体都放在这个范围里，墙体和楼板要正好贴到范围边上，和别的部分对得上。`,
        ...(others.length ? ["其他部分（不要搭，只用来对齐）：", ...others] : []),
        "",
        ...geometryRules(),
        `要做得完整、细致：外墙按真实比例开门窗，有楼梯或台阶、栏板、檐口这些细节；室内有家具和灯具；室外有铺装、绿化。一般需要 40–${SCENE_PROMPT_OBJECTS} 个物体，不超过 ${SCENE_PROMPT_OBJECTS} 个。先写墙、楼板这些结构，再写门窗和细节，最后写家具和绿化。`,
        `输出格式：{"objects":[${OBJECT_EXAMPLE}]}`,
    ].join("\n");
}

/** 把规划和各部分的回复拼成一个场景；某部分没读出来时跳过它，并在 failedParts 里记下分组名。 */
export function assembleScene(plan: ScenePlan, parts: (unknown | null)[]): { scene: InteriorScene3D; dropped: number; failedParts: string[] } {
    const objects: unknown[] = [];
    const failedParts: string[] = [];
    parts.forEach((value, index) => {
        const group = plan.parts[index]?.group || "";
        const items = value && typeof value === "object" && Array.isArray((value as { objects?: unknown }).objects) ? (value as { objects: unknown[] }).objects : null;
        if (!items?.length) {
            failedParts.push(group);
            return;
        }
        for (const item of items) objects.push(item && typeof item === "object" ? { ...(item as object), group } : item);
    });
    const { scene, dropped } = normalizeInteriorScene({ title: plan.title, summary: plan.summary, ground: plan.ground, objects, labels: plan.labels });
    return { scene, dropped, failedParts };
}

/**
 * 一句话修改：把现有物体按序号列给模型，只要它输出改动（删哪些、改哪些字段、加哪些），
 * 回复短，不会因为整份场景太长被截断。
 */
export function buildSceneEditPrompt(scene: InteriorScene3D, instruction: string) {
    return [
        "你是建筑和室内设计的三维建模师。下面是一个已经搭好的三维模型，objects 里每个物体的 i 是它的序号，group 是它属于哪一部分。请按用户的修改要求改它：只改要求里提到的部分，先按 group 和形状、材质找准要改的物体，再用它的 i 写改动。",
        "",
        `修改要求：${instruction.trim()}`,
        "",
        `当前模型：${JSON.stringify({ title: scene.title, ground: scene.ground, objects: scene.objects.map((object, index) => ({ i: index, ...object })), labels: scene.labels })}`,
        "",
        ...geometryRules(),
        '只输出改动：{"remove":[要删的序号],"update":[{"index":序号,"set":{要改的字段，例如 "color":"#888888" 或 "position":[x,y,z]}}],"add":[新物体，格式同上],"labels":[如果标注要变，写完整的新标注列表，不变就不写],"title":"标题要变才写"}。没有改动的项可以不写。',
    ].join("\n");
}

/** 把模型给的改动应用到场景上，再整体收紧一遍；一处改动都没有时报错，不算成功改了一版。 */
export function applyScenePatch(scene: InteriorScene3D, value: unknown): { scene: InteriorScene3D; dropped: number } {
    if (!value || typeof value !== "object") throw new Error("模型没有给出改动");
    const patch = value as Record<string, unknown>;
    const remove = new Set(
        (Array.isArray(patch.remove) ? patch.remove : [])
            .map(finiteNumber)
            .filter((item): item is number => item !== null)
            .map(Math.round),
    );
    const updates = new Map<number, Record<string, unknown>>();
    for (const item of Array.isArray(patch.update) ? patch.update : []) {
        if (!item || typeof item !== "object") continue;
        const index = finiteNumber((item as Record<string, unknown>).index);
        const set = (item as Record<string, unknown>).set;
        if (index !== null && set && typeof set === "object") updates.set(Math.round(index), set as Record<string, unknown>);
    }
    const added = Array.isArray(patch.add) ? patch.add : [];
    const labels = Array.isArray(patch.labels) ? patch.labels : null;
    const title = shortText(patch.title);
    if (!remove.size && !updates.size && !added.length && !labels && !title) throw new Error("模型没有给出任何改动，换个说法再试试");
    const objects: unknown[] = [];
    scene.objects.forEach((object, index) => {
        if (remove.has(index)) return;
        const set = updates.get(index);
        objects.push(set ? { ...object, ...set } : object);
    });
    objects.push(...added);
    return normalizeInteriorScene({ title: title || scene.title, summary: scene.summary, ground: scene.ground, objects, labels: labels ?? scene.labels });
}
