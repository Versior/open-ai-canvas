/**
 * 电商创作在画布上的接线。
 *
 * 生成节点上游可能连着五个电商节点。它们都不产出媒体，只产出「约束」：
 * - 商品节点   → 商品锁定块（必须逐字保留的外观事实）+ 商品实拍参考图
 * - 品牌风格   → 跨整组图统一的视觉规范
 * - 卖点节点   → 可验证的商品主张
 * - 文案节点   → 图上要出现的文字（只留位，不生成）
 * - 拍法节点   → 拍摄方案（构图、光线、镜头……）
 *
 * 这里负责把五者编译成提示词、把商品实拍与模特参考图接成参考图，
 * 交给现有的生成链路，不另起一套生成系统。
 */
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";
import type { ReferenceImage } from "@/types/image";
import { compileEcommercePrompt, ECOMMERCE_PRODUCT_VIEWS, type EcommercePromptSources } from "./ecommerce-contract";
import { ecommerceModelById, ecommerceModelRefs, type EcommerceModel } from "./ecommerce-models";

/** 电商节点的类型，用于识别上游。 */
const ECOMMERCE_NODE_TYPES = new Set<string>([
    CanvasNodeType.Product,
    CanvasNodeType.ShotRecipe,
    CanvasNodeType.SellingPoint,
    CanvasNodeType.Copy,
    CanvasNodeType.Style,
    CanvasNodeType.Replica,
    CanvasNodeType.Teardown,
    CanvasNodeType.Aplus,
]);

export function isEcommerceNode(node: CanvasNodeData) {
    return ECOMMERCE_NODE_TYPES.has(node.type);
}

/**
 * 入边里的电商节点，按类型各取第一个。
 *
 * **沿约束链往上走**：`商品 → 拍法 → 图片` 这种串联里，图片节点要能同时拿到商品和拍法。
 * 只认直接入边的话，用户把商品连到拍法、拍法再连到图，商品就会静默丢失——连线看起来对，
 * 生成结果却没有锁定块，这是最难查的一类错。
 *
 * 只穿过电商节点：碰到图片、文本这些产出媒体的节点就停，避免把隔壁那条支线的约束吸进来。
 *
 * 多个同类节点不做静默合并——合并出来的约束用户没法核对。取第一个之外的在 UI 上
 * 由用户自己断开，这里只保证结果可预测。
 */
const ECOMMERCE_UPSTREAM_DEPTH = 6;

export function upstreamEcommerceNodes(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const incoming = new Map<string, string[]>();
    for (const connection of connections) {
        if (connection.relation === "batch-output") continue;
        const list = incoming.get(connection.toNodeId);
        if (list) list.push(connection.fromNodeId);
        else incoming.set(connection.toNodeId, [connection.fromNodeId]);
    }

    const found: Partial<Record<CanvasNodeType, CanvasNodeData>> = {};
    const visited = new Set<string>([nodeId]);
    let frontier = [nodeId];
    for (let depth = 0; depth < ECOMMERCE_UPSTREAM_DEPTH && frontier.length; depth += 1) {
        const next: string[] = [];
        for (const currentId of frontier) {
            for (const fromId of incoming.get(currentId) || []) {
                if (visited.has(fromId)) continue;
                visited.add(fromId);
                const node = nodeById.get(fromId);
                if (!node || !isEcommerceNode(node)) continue;
                next.push(fromId);
                if (!found[node.type as CanvasNodeType]) found[node.type as CanvasNodeType] = node;
            }
        }
        frontier = next;
    }

    return {
        product: found[CanvasNodeType.Product],
        recipe: found[CanvasNodeType.ShotRecipe],
        sellingPoints: found[CanvasNodeType.SellingPoint],
        copy: found[CanvasNodeType.Copy],
        style: found[CanvasNodeType.Style],
        replica: found[CanvasNodeType.Replica],
        teardown: found[CanvasNodeType.Teardown],
    };
}

function isUsableImageNode(node: CanvasNodeData | undefined): node is CanvasNodeData {
    return Boolean(node && node.type === CanvasNodeType.Image && (node.metadata?.content || node.metadata?.storageKey));
}

/**
 * 直接连进某个节点的图片，按连线顺序。
 *
 * 电商节点自己不产出媒体，所以通用输入解析（buildCanvasResourceInputResolver）
 * 不会把它们的上游图带下去——那条路只认素材节点。商品实拍因此要在这里单独接：
 * 用户把商品图连到商品节点，就是在说「这是这个商品」，生成时必须用上。
 */
export function connectedImageNodes(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    return connections
        .filter((connection) => connection.toNodeId === nodeId && connection.relation !== "batch-output")
        .map((connection) => nodeById.get(connection.fromNodeId))
        .filter(isUsableImageNode);
}

/**
 * 商品节点实际生效的视角绑定。
 *
 * 显式绑定的优先，空槽按候选图顺序自动认领。商品节点卡片读它来显示——
 * 显示与生成必须用同一份判据，否则又会出现「卡片上有图、生成时没用上」。
 *
 * 候选图由调用方给：生成链路传连进商品节点的图，卡片传它的上游素材节点。
 * 两处必须是同一批图，所以规则留在这里，不各写一份。
 *
 * 用 `in` 而不是取非空来判断槽位是否被占：显式清空的槽位（值写成空串）
 * 要能挡住自动认领，否则用户刚取消的视角下一秒又被自动填回来。
 *
 * **绑到一个已经不在画布上的图时，那个槽位等于没绑。** 用户换了商品实拍
 * （删掉旧图、连上新图）之后，`views.front` 还指着旧节点 id——它既不会让位给
 * 新图，生成时也取不到图，模型于是照旧档案画上一个商品。用户看到的是
 * 「我明明换了图，它还认成之前那个」。
 */
export function effectiveProductViews(profile: EcommercePromptSources["profile"], candidates: CanvasNodeData[]) {
    const views: Partial<Record<string, string>> = { ...(profile?.views || {}) };
    if (!profile) return views;
    const candidateIds = new Set(candidates.filter(isUsableImageNode).map((node) => node.id));
    for (const view of ECOMMERCE_PRODUCT_VIEWS) {
        const bound = views[view.id];
        if (bound && !candidateIds.has(bound)) delete views[view.id];
    }
    const claimed = new Set(Object.values(views).filter(Boolean) as string[]);
    const free = ECOMMERCE_PRODUCT_VIEWS.filter((view) => !(view.id in views));
    if (!free.length) return views;
    const available = candidates.filter((node) => isUsableImageNode(node) && !claimed.has(node.id));
    free.forEach((view, index) => {
        const node = available[index];
        if (node) views[view.id] = node.id;
    });
    return views;
}

/**
 * 商品节点上按视角绑定的图片节点，按视角顺序返回。
 *
 * **没绑视角时用连进商品节点的图补齐。** 这是原先最大的一个静默丢失：
 * 商品图连上来了、卡片上也看见了，但生成时只读 `profile.views`——
 * 用户不逐张点视角标签，参考图就是空的，模型于是自己编一个商品出来。
 * 连进来就是在指定「这是这个商品」，不该再要求用户点一遍标签才生效。
 */
export function productViewNodes(profile: EcommercePromptSources["profile"], nodes: CanvasNodeData[], connections: CanvasConnection[] = [], productNodeId?: string) {
    if (!profile) return [];
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    // 给了商品节点就用「连进它的图」当候选池，没给就是把整个 nodes 当候选池。
    // 传空数组会让每一个已绑定的视角都被判成悬空然后清掉——那是「不传上下文」，
    // 不是「这个商品没有任何图」。
    const views = effectiveProductViews(profile, productNodeId ? connectedImageNodes(productNodeId, nodes, connections) : nodes);
    const picked: CanvasNodeData[] = [];
    const seen = new Set<string>();
    for (const view of ECOMMERCE_PRODUCT_VIEWS) {
        const node = views[view.id] ? nodeById.get(views[view.id]!) : undefined;
        if (!isUsableImageNode(node) || seen.has(node.id)) continue;
        seen.add(node.id);
        picked.push(node);
    }
    return picked;
}

/**
 * 模特的参考图。
 *
 * 直接按 storageKey 造 ReferenceImage，**不反查画布上的图节点**：
 * 模特库是用户级的，跟着账号走、跨画布复用，那些图多半不在当前画布上。
 * 早先按 storageKey 反查画布节点，结果就是「模特库里有图，生成时一张都用不上」。
 * hydrateNodeGenerationContext 会拿 storageKey 去解析成 data URL。
 */
export function ecommerceModelReferenceImages(model: EcommerceModel | undefined): ReferenceImage[] {
    return ecommerceModelRefs(model).map((ref, index) => ({
        id: `ecommerce-model:${model!.id}:${index + 1}`,
        name: `${model!.name}-${index + 1}.png`,
        type: "image/png",
        dataUrl: "",
        storageKey: ref,
    }));
}

export type EcommerceGenerationInputs = {
    sources: EcommercePromptSources;
    /** 编译出的提示词；没有上游电商节点时为空串。 */
    prompt: string;
    /** 商品实拍与模特参考图，供调用方接进参考图列表。 */
    referenceImages: ReferenceImage[];
};

/**
 * 这个节点用的是哪位模特。
 *
 * 自己的优先，没有就继承上游商品节点的——一键出整套时模特挂在商品上，
 * 因为「同一套图里是同一个人」是这一套的属性，不是其中某一张的。
 * 单张要换人是刻意的选择，所以自己挂了就用自己的。
 */
export function resolveEcommerceModel(node: CanvasNodeData | undefined, customModels: EcommerceModel[] = [], fallback?: EcommerceModel) {
    return ecommerceModelById(node?.metadata?.ecommerceModelId, customModels) || fallback;
}

/**
 * 生成时用到的电商输入。
 *
 * 一个电商节点都没连时返回空结果，调用方原样走原来的链路——
 * 没有电商节点连线的画布完全不受影响。
 *
 * 拍法是一张清单（一行一张图），所以要读产物节点自己认领了哪一行：
 * ecommerceShotId 对上清单里的行号，提示词只展开那一行。没认领时由
 * ecommerceShotSetBlock 决定降级行为，不在这里猜。
 *
 * 清单位置有两处：独立的拍法节点（用户自己排的），或商品节点上的 `ecommerceShotSet`
 * （一键流程按行业套路生成的，不铺拍法节点）。前者优先——用户手排的那张是他核对过的。
 */
export function resolveEcommerceInputs(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[], customModels: EcommerceModel[] = []): EcommerceGenerationInputs {
    const upstream = upstreamEcommerceNodes(nodeId, nodes, connections);
    const target = nodes.find((node) => node.id === nodeId);
    const model = resolveEcommerceModel(target, customModels, resolveEcommerceModel(upstream.product, customModels));
    const shotId = target?.metadata?.ecommerceShotId;
    const sources: EcommercePromptSources = {
        profile: upstream.product?.metadata?.productProfile,
        shotSet: upstream.recipe?.metadata?.shotSet || upstream.product?.metadata?.ecommerceShotSet,
        shotId,
        sellingPoints: upstream.sellingPoints?.metadata?.sellingPoints,
        // 文案的覆盖链：**这一屏自己的** → 独立的文案节点。
        // 一键流程按屏写的文字不在这里——它写在那一张的提示词里（ecommerceSuite）。
        copy: target?.metadata?.ecommerceCopy || upstream.copy?.metadata?.ecommerceCopy,
        style: upstream.style?.metadata?.ecommerceStyle,
        replica: upstream.replica?.metadata?.ecommerceReplica,
        teardown: upstream.teardown?.metadata?.ecommerceTeardown,
        model,
    };
    return {
        sources,
        prompt: compileEcommercePrompt(sources),
        referenceImages: [
            ...productViewNodes(sources.profile, nodes, connections, upstream.product?.id).map(productViewReferenceImage),
            ...ecommerceModelReferenceImages(model),
        ],
    };
}

/** 商品实拍按画布图节点读，走通用解析（绘图/调色节点也在这里被正确处理）。 */
function productViewReferenceImage(node: CanvasNodeData): ReferenceImage {
    return {
        id: node.id,
        name: node.title || `${node.id}.png`,
        type: node.metadata?.mimeType || "image/png",
        dataUrl: "",
        url: node.metadata?.content,
        storageKey: node.metadata?.storageKey,
        bytes: node.metadata?.bytes,
        width: node.metadata?.naturalWidth,
        height: node.metadata?.naturalHeight,
    };
}

/**
 * 把编译出的电商提示词并到节点自己的提示词前面。
 *
 * 顺序固定：约束在前、节点自己的提示词在后。节点提示词是用户临时想补的一句，
 * 放在后面才不会把锁定块顶掉。
 */
export function mergeEcommercePrompt(ecommercePrompt: string, nodePrompt: string) {
    const parts = [ecommercePrompt.trim(), nodePrompt.trim()].filter(Boolean);
    return parts.join("\n\n");
}
