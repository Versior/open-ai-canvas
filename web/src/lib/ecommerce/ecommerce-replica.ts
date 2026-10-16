/**
 * 爆款复刻——照着别人的图做自己的图。
 *
 * 这是调研里最没有争议的一块：美图、稿定、摹小仙、绘蛙、即创五家头部同时押注，
 * 已经实质标准化。设计师真实的起手式本来就是「照着这个做」，工具不该假装不是。
 *
 * 双输入是行业共识形态：
 * - **参考图**给结构：构图、布光、配色、版式、装饰
 * - **产品图**给主体：必须是我自己的那件商品
 *
 * 一条硬边界：**复刻的是公式，不是画面。** 所有头部产品的官方话术都是这句，
 * 因为抄画面是侵权。工具侧能做的不是「判断版权」（做不了），而是把
 * 「不复刻清单」做成不可清空的默认值，并且逐条写进提示词——让模型知道
 * 参考图里的品牌标识、模特面孔、原创文案、装饰图形一个都不能搬。
 */
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

/** 可以从参考图里复刻的维度。勾选哪些，提示词就写哪些。 */
export type EcommerceReplicaAspect = "composition" | "lighting" | "palette" | "layout" | "props" | "mood";

export const ECOMMERCE_REPLICA_ASPECTS: { id: EcommerceReplicaAspect; label: string; hint: string }[] = [
    { id: "composition", label: "构图", hint: "主体在画面里的位置、占比、留白关系" },
    { id: "lighting", label: "布光", hint: "主光方向、软硬、明暗层次" },
    { id: "palette", label: "配色", hint: "背景色系、商品与背景的对比关系" },
    { id: "layout", label: "版式", hint: "文字块的位置与层级关系（不含具体文案）" },
    { id: "props", label: "道具", hint: "陪衬物的种类与摆放方式" },
    { id: "mood", label: "氛围", hint: "整体情绪与质感倾向" },
];

/**
 * 复刻强度。
 *
 * 高=结构贴着参考图走；中=借结构换风格；低=只借氛围。
 * 行业里普遍做成三档（美图的「复刻相似度」就是高/中/低），因为
 * 「太像」会被平台判搬运，「太不像」用户觉得白花了钱。
 */
export type EcommerceReplicaFidelity = "high" | "medium" | "low";

export const ECOMMERCE_REPLICA_FIDELITIES: { id: EcommerceReplicaFidelity; label: string; hint: string }[] = [
    { id: "high", label: "贴近", hint: "结构尽量照搬，只换商品与文案。适合同品类直接对标" },
    { id: "medium", label: "借鉴", hint: "借结构换风格，保留自己的品牌调性" },
    { id: "low", label: "取意", hint: "只借氛围与情绪，版面自己排。适合跨品类参考" },
];

/**
 * 不可复刻清单。
 *
 * 这不是建议，是硬边界：抄这几样是侵权，而且平台有图像指纹稽查。
 * 做成常量而不是可编辑字段——用户把它清空不该是「设置」，是「事故」。
 */
export const ECOMMERCE_REPLICA_NEVER = [
    "参考图中的品牌标识、Logo 与店铺水印",
    "参考图中的模特面孔与可辨识的人物形象",
    "参考图中的原创文案、字体设计与图形元素",
    "参考图本身的画面内容（不是把参考图换个商品贴上去）",
] as const;

/**
 * 这张参考图是「别人的爆款」还是「自己的场景素材」。
 *
 * 两种用途的约束**正好相反**，所以必须分开，不能混在一段提示词里：
 *
 * - `replicate` 复刻爆款：参考图是别人的图。抄画面是侵权，所以不可复刻清单是硬边界，
 *   模型要「借结构、换画面」。
 * - `compose` 溶图合成：参考图是**自己的**场景图或模特图（实地拍的、图库买的）。
 *   这里没有侵权问题，反而要**尽量贴合**——光线方向、透视、色温、接触阴影全部要对上，
 *   否则商品看起来像贴上去的。模型常见的错是给商品单独打光，于是它浮在场景之上。
 *
 * 合并成一个模式是错的：同一句「不要照搬参考图」在溶图里会把场景也丢掉。
 */
export type EcommerceReplicaPurpose = "replicate" | "compose";

export const ECOMMERCE_REPLICA_PURPOSES: { id: EcommerceReplicaPurpose; label: string; hint: string }[] = [
    { id: "replicate", label: "复刻爆款", hint: "参考图是别人的爆款图——借它的结构，换自己的商品与画面" },
    { id: "compose", label: "溶图合成", hint: "参考图是自己的场景或模特图——把自己的商品自然地放进去" },
];

/** 溶图必须对上的一项。少一项，商品就会「浮」在场景里。 */
const COMPOSE_REQUIREMENTS = [
    "光线：主光方向、软硬、色温与场景完全一致；商品上的受光面与场景里其他物体的受光面朝向相同",
    "透视：商品的视平线与场景一致，不要出现俯视的商品摆在平视的场景里",
    "接触：商品与承托面之间要有接触阴影，落地处要有环境遮蔽——没有阴影的商品看起来是浮着的",
    "反射：光滑台面或有反射的场景里，商品下方要有对应的倒影",
    "色温：商品的冷暖与场景的环境光一致，不要出现商品偏冷、场景偏暖",
    "边缘：商品边缘要吃到场景的环境光，不要像抠图贴上去一样生硬",
] as const;

export type EcommerceReplica = {
    name: string;
    purpose: EcommerceReplicaPurpose;
    fidelity: EcommerceReplicaFidelity;
    aspects: EcommerceReplicaAspect[];
    /** 从参考图里读出来的结构笔记。模型读图后填，用户可改。 */
    notes: string;
    /** 额外的不复刻项，追加在硬边界之后。 */
    extraExclude: string;
};

export function createEcommerceReplica(name = "未命名复刻"): EcommerceReplica {
    return { name, purpose: "replicate", fidelity: "medium", aspects: ["composition", "lighting", "palette"], notes: "", extraExclude: "" };
}

export function ecommerceReplicaReady(replica: EcommerceReplica | undefined) {
    if (!replica) return false;
    // 溶图不勾复刻维度——它要的是「融进去」，维度清单在这里没有意义
    if (replica.purpose === "compose") return true;
    return replica.aspects.length > 0;
}

const FIDELITY_DIRECTION: Record<EcommerceReplicaFidelity, string> = {
    high: "结构尽量贴近参考图，只替换商品与文案；版式关系、布光方向、背景色系保持一致。",
    medium: "借用参考图的结构关系，但配色与质感按自己的品牌调性走。",
    low: "只取参考图的氛围与情绪，版面与构图自行安排。",
};

/**
 * 复刻块。
 *
 * 顺序刻意如此：先说「参考图给的是公式」，再说复刻什么，然后是不可复刻清单，
 * 最后才是强度。把边界放在强度前面，是因为模型读到「贴近」会倾向于照抄，
 * 边界必须先立在它前面。
 */
export function ecommerceReplicaBlock(replica: EcommerceReplica | undefined) {
    if (!ecommerceReplicaReady(replica)) return "";
    const replicaValue = replica!;

    // 溶图：参考图是场景底，商品要融进去。这里的要求是「尽量贴合」，
    // 与复刻的「不要照搬」正好相反，所以整块单独写。
    if (replicaValue.purpose === "compose") {
        const composeLines: string[] = [
            "参考图是**场景底图**（自己的实景或图库素材），把它完整保留下来，只把商品放进去。",
            "商品必须自然地存在于这个场景里，不是贴上去的。以下每一项都要对上：",
            ...COMPOSE_REQUIREMENTS.map((item) => `- ${item}`),
        ];
        if (replicaValue.extraExclude.trim()) composeLines.push(`不要出现：${replicaValue.extraExclude.trim()}`);
        if (replicaValue.notes.trim()) composeLines.push(`场景笔记：${replicaValue.notes.trim()}`);
        return [`【溶图合成】${replicaValue.name.trim() || "未命名溶图"}`, ...composeLines].join("\n");
    }

    const aspects = ECOMMERCE_REPLICA_ASPECTS.filter((aspect) => replicaValue.aspects.includes(aspect.id)).map((aspect) => aspect.label);
    const lines: string[] = [
        "参考图给的是**爆款公式**，不是画面。只复刻结构关系，不搬运画面内容。",
    ];
    if (aspects.length) lines.push(`复刻维度：${aspects.join("、")}`);
    // 边界必须排在强度前面：模型读到「贴近」会倾向于照抄，边界立在它前面才拦得住
    lines.push("绝对不复刻：");
    for (const never of ECOMMERCE_REPLICA_NEVER) lines.push(`- ${never}`);
    if (replicaValue.extraExclude.trim()) lines.push(`- ${replicaValue.extraExclude.trim()}`);
    lines.push(`方向：${FIDELITY_DIRECTION[replicaValue.fidelity]}`);
    if (replicaValue.notes.trim()) lines.push(`结构笔记：${replicaValue.notes.trim()}`);
    return [`【复刻参考】${replicaValue.name.trim() || "未命名复刻"}`, ...lines].join("\n");
}

/** 复刻节点上游的参考图——只认第一张，多张参考会互相打架。 */
export function ecommerceReplicaReferenceNode(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const fromIds = connections.filter((connection) => connection.toNodeId === nodeId && connection.relation !== "batch-output").map((connection) => connection.fromNodeId);
    return nodes.find((node) => fromIds.includes(node.id) && node.type === CanvasNodeType.Image && (node.metadata?.content || node.metadata?.storageKey));
}
