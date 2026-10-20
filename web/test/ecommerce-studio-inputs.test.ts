import { expect, test } from "bun:test";
import {
    ecommerceStudioSources,
    ecommerceStudioSourceSignature,
    ecommerceStudioImageRole,
    openEcommerceStudio,
    ecommerceStudioExportSelection,
    ecommerceStudioShotSignature,
    ecommerceStudioInputSignature,
    validateEcommerceStudioResultInputs,
} from "../src/lib/ecommerce/ecommerce-studio";
import { createEcommerceProductProfile } from "../src/lib/ecommerce/ecommerce-contract";
import { createCanvasNodeGraph } from "../src/lib/canvas/canvas-node-graph";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";
import { canvasConnectionError } from "../src/lib/canvas/canvas-connection-policy";
import { defaultConfig } from "../src/stores/use-config-store";
import { hasEmbeddedEcommerceControls } from "../src/lib/canvas/canvas-image-source";
import { DEFAULT_ECOMMERCE_BRIEF, ecommerceWorkbenchPrompt } from "../src/lib/ecommerce/ecommerce-capabilities";
import { DEFAULT_ECOMMERCE_SETTING, parseEcommerceSetting } from "../src/services/api/ecommerce";
import { ecommercePlatformGuidance } from "../src/lib/ecommerce/ecommerce-platform-guidance";

test("only the selected supported platform guidance enters planning", () => {
    const brief = { ...structuredClone(DEFAULT_ECOMMERCE_BRIEF), name: "Cup", platform: "Amazon" };
    expect(ecommerceWorkbenchPrompt("planning", brief)).toContain("纯白 #FFFFFF");
    expect(ecommerceWorkbenchPrompt("planning", brief)).not.toContain("生活场景优先");
    expect(ecommercePlatformGuidance("custom marketplace")).toBe("");
    for (const platform of ["淘宝", "天猫", "京东", "拼多多", "抖音", "Amazon", "亚马逊", "Shopify"]) expect(ecommercePlatformGuidance(platform)).toContain("仅用于画面规划");
});

test("studio export keeps explicit adopted results and rejects changed plans or missing adopted versions", () => {
    const plan = { name: "Cup", style: "Soft light", shots: [{ title: "Hero", duty: "Show", prompt: "Draw cup" }] };
    const studio: CanvasNodeData = { id: "studio", type: CanvasNodeType.EcommerceStudio, position: { x: 0, y: 0 }, metadata: { ecommerceStudio: { brief: { ...structuredClone(DEFAULT_ECOMMERCE_BRIEF), name: "Cup" }, plan } } };
    const output = (id: string): CanvasNodeData => ({
        id,
        type: CanvasNodeType.Image,
        position: { x: 0, y: 0 },
        metadata: { storageKey: id, status: "success", ecommerceStudioOutput: { studioId: studio.id, shotIndex: 0, signature: ecommerceStudioShotSignature(plan, 0, studio.metadata!.ecommerceStudio!.brief) } },
    });
    const older = output("older"),
        latest = output("latest");
    expect(ecommerceStudioExportSelection(studio, [older, latest]).rows[0].resultNodeId).toBe("latest");
    studio.metadata!.ecommerceStudio!.adoptedResults = { "0": older.id };
    expect(ecommerceStudioExportSelection(studio, [older, latest]).selected.get("studio-shot-0")).toBe(older);
    expect(() => ecommerceStudioExportSelection(studio, [latest])).toThrow("已选结果");
    studio.metadata!.ecommerceStudio!.brief.facts = "New product facts";
    expect(() => ecommerceStudioExportSelection(studio, [older, latest])).toThrow("当前方案");
    studio.metadata!.ecommerceStudio!.brief.facts = "";
    plan.shots[0].prompt = "Different cup";
    expect(() => ecommerceStudioExportSelection(studio, [older, latest])).toThrow("当前方案");
});

test("ecommerce nodes use embedded controls while ordinary images keep their generation panel", () => {
    expect(hasEmbeddedEcommerceControls({ type: CanvasNodeType.Product })).toBe(true);
    expect(hasEmbeddedEcommerceControls({ type: CanvasNodeType.EcommerceStudio })).toBe(true);
    expect(hasEmbeddedEcommerceControls({ type: CanvasNodeType.Image })).toBe(false);
});

test("builtin templates preserve long categories and enter planning without polluting unrelated tools", () => {
    const template = { id: "builtin", name: "Template", category: "类".repeat(131), flow: "detail" as const, enabled: true, source: "MIT", style: "Shared lighting", shots: [{ title: "Hero", duty: "Full prompt with camera and whitespace" }] };
    expect(parseEcommerceSetting({ ...structuredClone(DEFAULT_ECOMMERCE_SETTING), templates: [template] }).templates[0].category).toBe(template.category);
    const brief = { ...structuredClone(DEFAULT_ECOMMERCE_BRIEF), name: "Real product", template };
    const prompt = ecommerceWorkbenchPrompt("planning", brief);
    expect(prompt).toContain(template.style);
    expect(prompt).toContain(template.shots[0].duty);
    expect(prompt).toContain("模板属性与示例文案均非当前商品事实");
    expect(ecommerceWorkbenchPrompt("model-cast", brief)).not.toContain("templateReference");
});

const image: CanvasNodeData = { id: "photo", type: CanvasNodeType.Image, position: { x: 0, y: 0 }, width: 300, height: 400, metadata: { storageKey: "photo", status: "success" } };
const style: CanvasNodeData = { ...image, id: "style", metadata: { storageKey: "style", status: "success", ecommerceReferenceRole: "style" } };
const product: CanvasNodeData = { ...image, id: "product", type: CanvasNodeType.Product, metadata: { productProfile: createEcommerceProductProfile("Test product") } };
const edges = [
    { id: "front", fromNodeId: image.id, toNodeId: product.id, toHandleId: "product-view:front" },
    { id: "style-edge", fromNodeId: style.id, toNodeId: product.id, toHandleId: "visual-reference:0" },
];

test("export rejects replaced photos and changed input roles but allows moving source nodes", () => {
    const sources = [image, style, product];
    const output: CanvasNodeData = {
        ...image,
        id: "output",
        metadata: { ecommerceStudioOutput: { studioId: "studio", shotIndex: 0, signature: "", sourceIds: [product.id], sourceSignature: ecommerceStudioInputSignature([product.id], sources, edges), inputIds: [] } },
    };
    expect(() => validateEcommerceStudioResultInputs(output, sources, edges)).not.toThrow();
    expect(() =>
        validateEcommerceStudioResultInputs(
            output,
            sources.map((node) => ({ ...node, position: { x: 500, y: 500 } })),
            edges,
        ),
    ).not.toThrow();
    expect(() =>
        validateEcommerceStudioResultInputs(
            output,
            sources.map((node) => (node.id === image.id ? { ...node, metadata: { ...node.metadata, storageKey: "replacement" } } : node)),
            edges,
        ),
    ).toThrow("素材已变化");
    expect(() =>
        validateEcommerceStudioResultInputs(
            output,
            sources,
            edges.filter((edge) => edge.id !== "front"),
        ),
    ).toThrow("素材已变化");
    expect(() => validateEcommerceStudioResultInputs(output, sources, [...edges, { id: "new-input", fromNodeId: product.id, toNodeId: "studio" }])).toThrow("输入连线已变化");
});

test("product entry creates a connected studio and reopening preserves its plan", () => {
    const result = openEcommerceStudio([image, style, product], edges, product.id);
    expect(result.studio.type).toBe(CanvasNodeType.EcommerceStudio);
    expect(result.studio.metadata?.ecommerceStudio?.brief.name).toBe("Test product");
    expect(createCanvasNodeGraph(result.nodes, result.connections).getInputNodes(result.studio.id)).toEqual([product]);
    const reopened = openEcommerceStudio(result.nodes, result.connections, product.id);
    expect(reopened.studio).toBe(result.studio);
    expect(reopened.nodes).toBe(result.nodes);
    expect(reopened.connections).toBe(result.connections);
    expect(() => openEcommerceStudio([], [], product.id)).toThrow("已删除");
    expect(() => openEcommerceStudio([{ ...product, metadata: { locked: true } }], [], product.id)).toThrow("锁定");
});

test("product inputs expand and deduplicate real photos while separating style references", () => {
    const sources = ecommerceStudioSources([product.id, image.id], [image, style, product], edges);
    expect(sources.map((node) => node.id)).toEqual(["product", "photo", "style"]);
    expect(ecommerceStudioImageRole(image, sources, edges)).toBe("商品实拍");
    expect(ecommerceStudioImageRole(style, sources, edges)).toContain("仅风格");
    expect(ecommerceStudioSourceSignature({ ...image, position: { x: 1000, y: 2000 } })).toBe(ecommerceStudioSourceSignature(image));
    expect(ecommerceStudioSourceSignature({ ...image, metadata: { storageKey: "replaced" } })).not.toBe(ecommerceStudioSourceSignature(image));
    expect(() => ecommerceStudioSources(["missing"], [image], [])).toThrow("已删除");
});

test("studio accepts actual product, image and text sources and rejects unsupported or locked inputs", () => {
    const studio = openEcommerceStudio([product], [], product.id).studio;
    const text = { ...image, id: "text", type: CanvasNodeType.Text };
    const unsupported = { ...image, id: "video", type: CanvasNodeType.Video };
    const nodes = [product, image, text, unsupported, studio];
    for (const source of [product, image, text]) expect(canvasConnectionError(defaultConfig, nodes, [], { fromNodeId: source.id, toNodeId: studio.id })).toBe("");
    expect(canvasConnectionError(defaultConfig, nodes, [], { fromNodeId: unsupported.id, toNodeId: studio.id })).toContain("只接受");
    expect(canvasConnectionError(defaultConfig, [...nodes.filter((node) => node.id !== studio.id), { ...studio, metadata: { locked: true } }], [], { fromNodeId: product.id, toNodeId: studio.id })).toContain("锁定");
    expect(canvasConnectionError(defaultConfig, nodes, [{ id: "result", fromNodeId: studio.id, toNodeId: image.id }], { fromNodeId: image.id, toNodeId: studio.id })).toContain("下游结果");
});
