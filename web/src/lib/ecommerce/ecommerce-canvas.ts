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
import { compileEcommercePrompt, createEcommerceProductProfile, ecommerceTailOutsideVisualSchema, ECOMMERCE_PRODUCT_VIEWS, type EcommerceCopy, type EcommercePromptSources } from "./ecommerce-contract";
import { ecommercePlatformGuidance } from "./ecommerce-platform-guidance";
import { ecommerceModelById, ecommerceModelRefs, type EcommerceModel } from "./ecommerce-models";
import type { EcommerceOneClickFlowId } from "./ecommerce-oneclick";
import { ECOMMERCE_REPLICA_PRODUCT_HANDLE, ECOMMERCE_REPLICA_REFERENCE_HANDLE, ecommerceReplicaInputIssue, ecommerceReplicaInputNodes } from "./ecommerce-replica";
import type { EcommerceSuiteRow } from "./ecommerce-suite";

/** 电商节点的类型，用于识别上游。 */
const ECOMMERCE_NODE_TYPES = new Set<string>([CanvasNodeType.Product, CanvasNodeType.ShotRecipe, CanvasNodeType.SellingPoint, CanvasNodeType.Copy, CanvasNodeType.Style, CanvasNodeType.Replica, CanvasNodeType.Teardown, CanvasNodeType.Aplus]);

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
    return connectedImageInputNodes(nodeId, nodes, connections).filter(isUsableImageNode);
}

function connectedImageInputNodes(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    return connections
        .filter((connection) => connection.toNodeId === nodeId && connection.relation !== "batch-output")
        .map((connection) => nodeById.get(connection.fromNodeId))
        .filter((node): node is CanvasNodeData => node?.type === CanvasNodeType.Image);
}

export function isEcommerceStyleReference(node: CanvasNodeData) {
    return node.metadata?.ecommerceReferenceRole === "style";
}

export function connectedStyleReferenceNodes(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const ids = new Set(connections.filter((edge) => edge.toNodeId === nodeId && edge.toHandleId?.startsWith("visual-reference:")).map((edge) => edge.fromNodeId));
    const viewIds = new Set(connections.filter((edge) => edge.toNodeId === nodeId && edge.toHandleId?.startsWith("product-view:")).map((edge) => edge.fromNodeId));
    return connectedImageNodes(nodeId, nodes, connections).filter((node) => ids.has(node.id) || (!viewIds.has(node.id) && isEcommerceStyleReference(node)));
}

export function connectedProductImageNodes(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const ids = new Set(connectedStyleReferenceNodes(nodeId, nodes, connections).map((node) => node.id));
    return connectedImageNodes(nodeId, nodes, connections).filter((node) => !ids.has(node.id));
}

export function isEcommerceInputHandle(handle?: string, targetType?: CanvasNodeData["type"]) {
    const productHandle = Boolean(handle?.startsWith("product-view:") || handle?.startsWith("visual-reference:"));
    const replicaHandle = handle === ECOMMERCE_REPLICA_REFERENCE_HANDLE || handle === ECOMMERCE_REPLICA_PRODUCT_HANDLE;
    if (targetType === CanvasNodeType.Product) return productHandle;
    if (targetType === CanvasNodeType.Replica) return replicaHandle;
    if (targetType) return false;
    return productHandle || replicaHandle;
}

export function withEcommerceInputConnection(connections: CanvasConnection[], edge: CanvasConnection) {
    if (!isEcommerceInputHandle(edge.toHandleId)) return [...connections, edge];
    const productHandle = isEcommerceInputHandle(edge.toHandleId, CanvasNodeType.Product);
    return [...connections.filter((item) => !(item.toNodeId === edge.toNodeId && (item.toHandleId === edge.toHandleId || (productHandle && item.fromNodeId === edge.fromNodeId)))), edge];
}

export function withImageAsEcommerceReference(connections: CanvasConnection[], imageId: string, productIds: string[]) {
    const products = new Set(productIds);
    return connections.map((edge) => {
        if (edge.fromNodeId !== imageId || !products.has(edge.toNodeId) || edge.relation === "batch-output" || edge.toHandleId?.startsWith("visual-reference:")) return edge;
        const occupied = new Set(connections.filter((item) => item.toNodeId === edge.toNodeId).map((item) => item.toHandleId));
        let index = 0;
        while (occupied.has(`visual-reference:${index}`)) index += 1;
        return { ...edge, toHandleId: `visual-reference:${index}`, toAnchorRatio: undefined, toAnchorXRatio: undefined };
    });
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
export function effectiveProductViews(profile: EcommercePromptSources["profile"], candidates: CanvasNodeData[], connections: CanvasConnection[] = [], productNodeId?: string) {
    const views: Partial<Record<string, string>> = { ...(profile?.views || {}) };
    if (!profile) return views;
    const explicit = connections.filter((edge) => edge.toNodeId === productNodeId && isEcommerceInputHandle(edge.toHandleId));
    const visualIds = new Set(explicit.filter((edge) => edge.toHandleId?.startsWith("visual-reference:")).map((edge) => edge.fromNodeId));
    for (const id of visualIds) {
        for (const view of ECOMMERCE_PRODUCT_VIEWS) if (views[view.id] === id) delete views[view.id];
    }
    for (const edge of explicit) {
        const view = ECOMMERCE_PRODUCT_VIEWS.find((item) => edge.toHandleId === `product-view:${item.id}`);
        if (view && candidates.some((node) => node.id === edge.fromNodeId && node.type === CanvasNodeType.Image)) {
            for (const other of ECOMMERCE_PRODUCT_VIEWS) if (other.id !== view.id && views[other.id] === edge.fromNodeId) delete views[other.id];
            views[view.id] = edge.fromNodeId;
        }
    }
    const explicitIds = new Set(explicit.filter((edge) => edge.toHandleId?.startsWith("product-view:")).map((edge) => edge.fromNodeId));
    const candidateIds = new Set(candidates.filter((node) => node.type === CanvasNodeType.Image && !visualIds.has(node.id) && (explicitIds.has(node.id) || (isUsableImageNode(node) && !isEcommerceStyleReference(node)))).map((node) => node.id));
    for (const view of ECOMMERCE_PRODUCT_VIEWS) {
        const bound = views[view.id];
        if (bound && !candidateIds.has(bound)) delete views[view.id];
    }
    const claimed = new Set(Object.values(views).filter(Boolean) as string[]);
    const free = ECOMMERCE_PRODUCT_VIEWS.filter((view) => !(view.id in views));
    if (!free.length) return views;
    const available = candidates.filter((node) => isUsableImageNode(node) && !isEcommerceStyleReference(node) && !visualIds.has(node.id) && !claimed.has(node.id));
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
    const views = effectiveProductViews(profile, productNodeId ? connectedImageInputNodes(productNodeId, nodes, connections) : nodes, connections, productNodeId);
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

export function ecommerceProductReferenceImages(product: CanvasNodeData, nodes: CanvasNodeData[], connections: CanvasConnection[]): ReferenceImage[] {
    const profile = product.metadata?.productProfile || createEcommerceProductProfile(product.title || "商品");
    const views = effectiveProductViews(profile, connectedImageInputNodes(product.id, nodes, connections), connections, product.id);
    return productViewNodes(profile, nodes, connections, product.id).map((node) => {
        const label = ECOMMERCE_PRODUCT_VIEWS.find((view) => views[view.id] === node.id)?.label;
        return { ...productViewReferenceImage(node), name: `商品${label || "实拍"}：${node.title || node.id}` };
    });
}

const inlineMediaIdentities = new WeakMap<object, { content: string; token: string }>();
const inlineMediaIdentitiesByContent = new Map<string, string>();
// shortcut: retain 32 legacy inline values for exact clone matching; persisted media use storageKey.
const INLINE_MEDIA_IDENTITY_CACHE_SIZE = 32;
let nextInlineMediaIdentity = 0;

function inlineMediaIdentity(node: CanvasNodeData) {
    const metadata = node.metadata;
    const content = metadata?.content;
    if (!metadata || !content || metadata.storageKey) return "";
    const cached = inlineMediaIdentities.get(metadata);
    if (cached?.content === content) return cached.token;
    let token = inlineMediaIdentitiesByContent.get(content);
    if (!token) {
        token = `inline:${++nextInlineMediaIdentity}`;
        inlineMediaIdentitiesByContent.set(content, token);
        if (inlineMediaIdentitiesByContent.size > INLINE_MEDIA_IDENTITY_CACHE_SIZE) inlineMediaIdentitiesByContent.delete(inlineMediaIdentitiesByContent.keys().next().value!);
    }
    inlineMediaIdentities.set(metadata, { content, token });
    return token;
}

/** Lightweight exact media identity; signed URLs and inline bytes never enter snapshots. */
export function ecommerceMediaIdentity(node: CanvasNodeData | undefined) {
    if (!node) return null;
    return [node.id, node.metadata?.storageKey || "", node.metadata?.assetId || "", node.metadata?.mimeType || "", inlineMediaIdentity(node)] as const;
}

/** Stable identity for the exact product pixels submitted to analysis; UI labels are intentionally excluded. */
export function ecommerceProductReferenceSignature(product: CanvasNodeData, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const profile = product.metadata?.productProfile || createEcommerceProductProfile(product.title || "商品");
    return JSON.stringify(productViewNodes(profile, nodes, connections, product.id).map(ecommerceMediaIdentity));
}
export function ecommerceReferenceImageGuide(images: Pick<ReferenceImage, "name">[]) {
    if (!images.length) return "";
    return ["【输入图片对应关系】以下编号按本次实际提交的图片顺序：", ...images.map((image, index) => `第 ${index + 1} 张：${image.name}`)].join("\n");
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
    /**
     * 最终提示词（已含当前平台规则）；没有上游电商节点、也没有平台信息时为空串。
     *
     * 平台段在这里就拼好，不给下游留第二条路径：任何调用方只要用上这个 prompt，
     * 平台规则就一定在。
     */
    prompt: string;
    /** 商品实拍与模特参考图，供调用方接进参考图列表。 */
    referenceImages: ReferenceImage[];
    /**
     * 这一张用到的文案，以及它是从哪儿来的。
     *
     * `row` = 当前表行（即时草稿也算），`node` = 产物节点自己的旧数据，`none` = 没有。
     * 空值必须能被区分出来：表行被用户清空之后不能再悄悄回退到节点旧值，
     * 否则「我明明删了字，出图还带着」会再犯一次。
     */
    copy: { value?: EcommerceCopy; source: "row" | "node" | "none" };
    /** 由文案通道推出的文字模式；无电商上下文时 undefined。 */
    textMode?: EcommerceTextMode;
    /**
     * 这一行为什么不能新生成；空 = 可以。
     *
     * 只在读到表行时才有结论——判据是那一行自己的 `imagePromptContractVersion`，
     * 节点上没有这份数据。单图执行与批量生成都读这里，判据不各写一份。
     */
    issue?: string;
};

/** 图上文字的来源模式：模型直接画字，还是本地叠字一次。 */
export type EcommerceTextMode = "model" | "local";

/** 严格映射，不做默认值补全——没有电商上下文就该是 undefined。 */
export function ecommerceTextModeOf(renderCopyText: boolean | undefined): EcommerceTextMode | undefined {
    if (renderCopyText === true) return "model";
    if (renderCopyText === false) return "local";
    return undefined;
}

/** 没有新合同版本号的详情行——读得出来，但不能直接拿去生成。 */
export const ECOMMERCE_LEGACY_DETAIL_PROMPT_ERROR = "旧版详情行未按新合同规划，请重新规划后再生成";

/** 占位事实进了文案或提示词——这些词不能入画。 */
export const ECOMMERCE_PROMPT_PLACEHOLDER_ERROR = "这一行还含占位事实，请补齐依据或删掉占位词后再生成";

/** 认领了详情行，却在画布上找不到它——不能当作「没有电商上下文」放行。 */
export const ECOMMERCE_MISSING_DETAIL_ROW_ERROR = "这一张认领的详情行已不存在，请回到创作表重新规划后再生成";

const ECOMMERCE_PLACEHOLDER = /(待补充|未识别|暂未提供|暂无|不予填写)/;

/**
 * 这一行能不能拿去新生成。`""` = 可以，其他 = 给用户看的拒绝原因。
 *
 * 只做「读」的校验，不改数据：旧自由文本要能原样显示、原样预览，
 * 但新合同要求文案只走 `copy`，所以这种行必须回到规划阶段重新拆。
 *
 * 详情行只认 `imagePromptContractVersion === 1`。没有版本号的旧行不猜安全——
 * 「看着像纯画面」也可能是被截断的自由文本，猜错的代价是把营销文案画进图里。
 * 提交前调用它做硬校验，比在生成时才炸更容易解释。
 */
export function ecommerceRowPromptIssue(row: EcommerceSuiteRow, flowId = "detail"): string {
    const copyText = [row.copy?.headline, row.copy?.subhead, row.copy?.price, row.copy?.cta].filter(Boolean).join("\n");
    if (ECOMMERCE_PLACEHOLDER.test(copyText) || ECOMMERCE_PLACEHOLDER.test(row.prompt)) return ECOMMERCE_PROMPT_PLACEHOLDER_ERROR;
    if (flowId === "detail" && row.imagePromptContractVersion !== 1) return ECOMMERCE_LEGACY_DETAIL_PROMPT_ERROR;
    return "";
}

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
export function resolveEcommerceInputs(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[], customModels: EcommerceModel[] = [], rowsOverride?: EcommerceSuiteRow[]): EcommerceGenerationInputs {
    const upstream = upstreamEcommerceNodes(nodeId, nodes, connections);
    const target = nodes.find((node) => node.id === nodeId);
    const model = resolveEcommerceModel(target, customModels, resolveEcommerceModel(upstream.product, customModels));
    const styleReferences = upstream.product ? connectedStyleReferenceNodes(upstream.product.id, nodes, connections) : [];
    const shotId = target?.metadata?.ecommerceShotId;
    const flowId = target?.metadata?.ecommerceFlowId;
    // 平台按「表 → 商品」读：表上的补充信息最贴近这一次投放，商品节点是它的默认值。
    // 每次解析都重读，不在分析时把平台冻进行里——用户之后改平台，重出就该按新平台。
    const table = target?.metadata?.batchSourceNodeId ? nodes.find((node) => node.id === target.metadata!.batchSourceNodeId && node.type === CanvasNodeType.BatchTable) : undefined;
    const platform = (table?.metadata?.ecommerceBrief?.platform || table?.metadata?.ecommercePlatform || upstream.product?.metadata?.ecommercePlatform)?.trim();
    // 没填平台就整段省略：凭空塞一段「未指定平台」只会把每个签名都改一遍。
    const platformGuidance = platform ? ecommercePlatformGuidance(platform, flowId as EcommerceOneClickFlowId | undefined) : "";
    // 文案的唯一真相是**当前表行**：调用方刚改过、还没落盘的那一份（rowsOverride）优先，
    // 其次是这张产物认领的创作表里那一行。表行没有时，才退回节点自己的旧数据。
    const row = shotId ? (rowsOverride ?? suiteRowsFor(target, nodes))?.find((item) => item.slotId === shotId) : undefined;
    const nodeCopy = target?.metadata?.ecommerceCopy || upstream.copy?.metadata?.ecommerceCopy;
    const copy: EcommerceGenerationInputs["copy"] = row ? { value: row.copy, source: "row" } : nodeCopy ? { value: nodeCopy, source: "node" } : { source: "none" };
    // 详情页认领了某一行却读不到它（表被删、行被删、表串了流程）：这不是「没有电商上下文」，
    // 而是这一张不该被生出来。旧节点上的文案只留给预览，绝不能顶进新生成的提示词——
    // 否则用户删掉的那一行旧营销文字会照样画回图上。
    const missingDetailRow = Boolean(shotId) && !row && flowId === "detail";
    const issue = row ? ecommerceRowPromptIssue(row, flowId || "detail") : missingDetailRow ? ECOMMERCE_MISSING_DETAIL_ROW_ERROR : "";
    // 只有新合同详情行才把画面段交给编译器；旧行没有这个字段，绝不能靠提示词里
    // 的长相去猜它「看起来只写画面」。
    const detailContractRow = row?.imagePromptContractVersion === 1 && (flowId || "detail") === "detail" ? row : undefined;
    const sources: EcommercePromptSources = {
        profile: upstream.product ? upstream.product.metadata?.productProfile || createEcommerceProductProfile(upstream.product.title || "商品") : undefined,
        shotSet: upstream.recipe?.metadata?.shotSet,
        shotId,
        sellingPoints: upstream.sellingPoints?.metadata?.sellingPoints,
        // 结构化文案既供详情页随画面生成，也保留给本地编辑与排版回退。
        // 认领不到详情行时留空：旧节点文案可以预览，但不参与新生成。
        copy: missingDetailRow ? undefined : copy.value,
        // 版式只在「模型画字」时进提示词（见 compileEcommercePrompt），
        // 本地叠字的用途读它只会白改签名。
        layout: row?.layout,
        visualPrompt: detailContractRow?.prompt,
        // 详情页让图片模型把确认文案与画面一次生成；其他一键入口仍可按平台要求走无字底图。
        renderCopyText: target?.metadata?.ecommerceProductId && flowId ? flowId === "detail" : undefined,
        style: upstream.style?.metadata?.ecommerceStyle,
        styleReferenceNames: styleReferences.map((node) => node.title || node.id),
        imageDrivenStyle: Boolean(upstream.product),
        replica: upstream.replica?.metadata?.ecommerceReplica,
        teardown: upstream.teardown?.metadata?.ecommerceTeardown,
        model,
    };
    const compiledPrompt = compileEcommercePrompt(sources);
    // 平台规则与编译结果在这里合成唯一一份最终提示词——下游没有第二个拼接点，
    // 也就不会有人漏掉它。平台只约束画面，不产生营销文案，copy 唯一来源不变。
    // 编译结果是空的时候连平台段也不拼：没有电商上下文就不该凭空多出一段约束。
    const finalPrompt = compiledPrompt ? [platformGuidance, compiledPrompt].filter(Boolean).join("\n\n") : "";
    return {
        sources,
        prompt: finalPrompt,
        referenceImages: [
            ...(upstream.product ? ecommerceProductReferenceImages(upstream.product, nodes, connections) : []),
            ...styleReferences.map((node) => ({ ...productViewReferenceImage(node), name: `视觉参考：${node.title || node.id}` })),
            ...ecommerceModelReferenceImages(model),
            ...ecommerceReplicaReferenceImages(upstream.replica, nodes, connections),
        ],
        copy,
        textMode: ecommerceTextModeOf(sources.renderCopyText),
        ...(issue ? { issue } : {}),
    };
}

const ECOMMERCE_SUITE_FLOW_IDS = ["detail", "main", "wear", "seed"] as const;

/**
 * 这张产物所属创作表的那一份套图。
 *
 * 认表靠 `batchSourceNodeId`（生成准备时写死的表 id），并核对流程归属——
 * 同一张画布上详情页和主图各有一张表，只按 id 认会串表。
 */
function suiteRowsFor(target: CanvasNodeData | undefined, nodes: CanvasNodeData[]): EcommerceSuiteRow[] | undefined {
    const tableId = target?.metadata?.batchSourceNodeId;
    const flowId = target?.metadata?.ecommerceFlowId;
    if (!tableId || !flowId) return undefined;
    const table = nodes.find((node) => node.id === tableId && node.type === CanvasNodeType.BatchTable);
    if (!table || table.metadata?.ecommerceFlowId !== flowId) return undefined;
    const flow = ECOMMERCE_SUITE_FLOW_IDS.find((id) => id === flowId);
    const indexed = flow ? table.metadata?.ecommerceSuitesByFlow?.[flow] : undefined;
    if (indexed?.flow === flowId) return indexed.rows;
    return table.metadata?.ecommerceSuite?.flow === flowId ? table.metadata.ecommerceSuite.rows : undefined;
}

function ecommerceReplicaReferenceImages(replica: CanvasNodeData | undefined, nodes: CanvasNodeData[], connections: CanvasConnection[]): ReferenceImage[] {
    if (!replica) return [];
    const inputs = ecommerceReplicaInputNodes(replica.id, nodes, connections);
    if (ecommerceReplicaInputIssue(inputs) || inputs.referenceImages.length !== 1 || inputs.productImages.length !== 1) return [];
    const referenceRole = replica.metadata?.ecommerceReplica?.purpose === "compose" ? "参考图（场景）" : "参考图（结构）";
    return inputs.ordered.map(({ node, role }) => ({
        ...productViewReferenceImage(node),
        name: `${role === "product" ? "商品图（主体）" : referenceRole}：${node.title || node.id}`,
    }));
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
 *
 * `context.visualPrompt` 是**存在性**判定，不是真假判定：`undefined` = 这条路径没有画面段，
 * 尾部原样保留；明确给了（哪怕是空串）= 这一行按画面 schema 走，尾部只留 schema 之外的话。
 * 用 truthy 判断会让「用户把画面段清空了」退回旧行为，旧营销行正好从尾巴上回来。
 */
export function mergeEcommercePrompt(ecommercePrompt: string, nodePrompt: string, context?: { visualPrompt?: string }) {
    const visual = context?.visualPrompt?.trim();
    let tail = nodePrompt.trim();
    // 只移除已经编译的同一段原文，保留随后追加的相机、质感及用户补充。
    if (visual && tail.startsWith(visual) && (tail.length === visual.length || /^\s/.test(tail.slice(visual.length)))) {
        tail = tail.slice(visual.length).trim();
    }
    if (visual !== undefined) tail = ecommerceTailOutsideVisualSchema(tail);
    const parts = [ecommercePrompt.trim(), tail].filter(Boolean);
    return parts.join("\n\n");
}
