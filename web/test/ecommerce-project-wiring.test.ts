import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { ecommerceBriefRows } from "@/lib/ecommerce/ecommerce-brief";
import { ecommerceOneClickFlow } from "@/lib/ecommerce/ecommerce-oneclick";
import { ecommerceSuiteDraftPrompt, reconcileEcommerceSuiteDraftRows } from "@/lib/ecommerce/ecommerce-suite";

const page = readFileSync(new URL("../src/pages/canvas/project.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const tableNode = readFileSync(new URL("../src/components/canvas/canvas-ecommerce-table-node.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");

function callback(startMarker: string, endMarker: string) {
    const start = page.indexOf(startMarker);
    const end = page.indexOf(endMarker, start);
    if (start < 0 || end < 0) throw new Error(`callback not found: ${startMarker}`);
    return page.slice(start, end);
}
test("async ecommerce analysis rejects results from a stale global model", () => {
    const profile = callback("    const draftEcommerceProfile = useCallback(", "    const draftEcommerceSuite = useCallback(");
    const ordinary = callback("    const draftEcommerceSuite = useCallback(", "    const generateEcommerceSuite = useCallback(");
    const reverse = callback("    const reverseEcommerceSuite = useCallback(", "    const reverseEcommerceSuiteRef = useRef(");

    expect(page).toContain("const effectiveConfigRef = useRef(effectiveConfig);");
    expect(page).toContain("effectiveConfigRef.current = effectiveConfig;");
    expect(profile).toMatch(/resolveEcommerceTableModels\(effectiveConfig\)\.analysisModel[\s\S]*?runEcommerceTextDraft\([\s\S]*?resolvedAnalysisModel/);
    expect(profile).toMatch(/resolveEcommerceTableModels\(effectiveConfigRef\.current\)\.analysisModel[\s\S]*?resolvedAnalysisModel !== latestAnalysisModel/);
    expect(profile).not.toContain("ecommerceAnalysisModel:");
    for (const block of [ordinary, reverse]) {
        expect(block).toMatch(/resolveEcommerceTableModels\(effectiveConfigRef\.current, \{ analysisModel: latest\.metadata\?\.ecommerceAnalysisModel \}\)\.analysisModel/);
    }
});

test("product profile analysis declares matching planning capability and flow", () => {
    const runner = callback("    const runEcommerceTextDraft = useCallback(", "    const draftEcommerceProfile = useCallback(");
    const profile = callback("    const draftEcommerceProfile = useCallback(", "    const draftEcommerceSuite = useCallback(");

    expect(profile).toMatch(/runEcommerceTextDraft\([\s\S]*?resolvedAnalysisModel,\s*false,\s*"cap:planning",\s*"planning",?\s*\)/);
    expect(runner).toContain("...(ecommerceCapability ? { ecommerceCapability } : {})");
});

test("商品输入只在用户选中合法图片后创建节点和连线", () => {
    const block = callback("    const addEcommerceInput = useCallback(", "    const addEcommerceReference = useCallback(");

    expect(block).toContain("requestDeferredImageUpload");
    expect(block).not.toContain("handleUploadRequest(plan.node.id)");
    expect(block.indexOf("requestDeferredImageUpload")).toBeLessThan(block.indexOf("createEcommerceStyleReference"));
    expect(block.indexOf("requestDeferredImageUpload")).toBeLessThan(block.indexOf("setConnections"));
    expect(block).toContain("nodesRef.current.find((item) => item.id === product.id)");
    expect(block).toContain("return undefined");
});

test("套图分析允许空模型交给底层解析全局默认值", () => {
    const block = callback("    const draftEcommerceSuite = useCallback(", "    const generateEcommerceSuite = useCallback(");

    expect(block).not.toContain("if (!analysisModel?.trim())");
    expect(block).not.toContain("未选择分析模型");
    expect(block).toMatch(/resolveEcommerceTableModels\(effectiveConfig, \{ analysisModel \}\)[\s\S]*?runEcommerceTextDraft\([\s\S]*?resolvedAnalysisModel/);
    expect(block).not.toContain("ecommerceAnalysisSkillsByFlow");
});

test("普通分析和参考套图分析保留内置导演约束并标记服务端导演注入", () => {
    const ordinary = callback("    const draftEcommerceSuite = useCallback(", "    const generateEcommerceSuite = useCallback(");
    const reverse = callback("    const reverseEcommerceSuite = useCallback(", "    const reverseEcommerceSuiteRef = useRef(");

    for (const block of [ordinary, reverse]) {
        expect(block).not.toMatch(/ecommerceSuiteDraftPrompt\([\s\S]{0,300}?,\s*null[,)]/);
        expect(block).toMatch(/runEcommerceTextDraft\([\s\S]*?flowId[,\s]*\)/);
    }
});

test("普通分析和参考套图分析都把统一平台 id 交给平台硬规范", () => {
    const ordinary = callback("    const draftEcommerceSuite = useCallback(", "    const generateEcommerceSuite = useCallback(");
    const reverse = callback("    const reverseEcommerceSuite = useCallback(", "    const reverseEcommerceSuiteRef = useRef(");

    expect(ordinary).toContain("resolveEcommercePlatformId(");
    expect(ordinary).toMatch(/const uniform = \{\s*platformId,/);
    expect(ordinary).toMatch(/ecommerceSuiteDraftPrompt\([\s\S]*?undefined, uniform\)/);
    expect(reverse).toContain("resolveEcommercePlatformId(");
    expect(reverse).toMatch(/ecommerceSuiteDraftPrompt\([\s\S]*?undefined, \{ platformId \}\)/);
});

test("商品识别只返回待确认草稿，不直接写入正式商品档案", () => {
    const block = callback("    const draftEcommerceProfile = useCallback(", "    const draftEcommerceSuite = useCallback(");

    expect(block).toContain("return parsed");
    expect(block).not.toContain("updateNodeMetadataFromContent");
});

test("切换全局默认模型后生成回调会立即刷新", () => {
    const block = callback("    const generateEcommerceSuite = useCallback(", "    // 动作 Context 在批次队列之前组装");

    expect(block).toMatch(/\n\s*\[[^\n]*\beffectiveConfig\b[^\n]*\],\n\s*\);\s*$/);
});

test("套图生成记录当前方案签名并把输入快照交给批次队列", () => {
    const sourceSignature = callback("    const ecommerceResultSourceSignature = useCallback(", "    const bindEcommerceSuite = useCallback(");
    const generation = callback("    const generateEcommerceSuite = useCallback(", "    // 动作 Context 在批次队列之前组装");

    expect(sourceSignature).toMatch(/ecommerceGenerationSourceSignature\(\{ source, row, target: image, nodes: graphNodes, connections: graphConnections, config: effectiveConfig, customModels: useEcommerceModelLibrary\.getState\(\)\.models \}\)/);
    expect(tableNode).toContain("ecommerceGenerationSourceSignature({ source: node, row, target: candidate");
    expect(generation).toMatch(/batchSourceNodeId: suiteNode\.id,[\s\S]*?batchRowId: row\.slotId,[\s\S]*?batchResultInputSignature: undefined/);
    expect(generation).toContain("batchInputSignature: signature");
    expect(generation).toContain("createCanvasBatchInputSnapshot(item, snapshotNodes, graphConnections, assets");
    expect(generation).toContain("inputSnapshot: snapshots.get(id)");
});

test("详情页真实生图尺寸走模型预设映射，用户显式尺寸仍优先", () => {
    const generation = callback("    const generateEcommerceSuite = useCallback(", "    // 动作 Context 在批次队列之前组装");

    expect(generation).toMatch(/const resolvedImageSize = imageSize \|\| ecommerceImageSettings\([\s\S]*?aspectRatio: ecommerceOneClickScreens\(flow\)\[0\]\?\.aspectRatio[\s\S]*?\)\.size/);
    expect(generation).toContain("...(resolvedImageSize ? { size: resolvedImageSize } : {})");
    expect(generation).not.toContain("...(imageSize ? { size: imageSize } : {})");
});

test("自动装订恢复路径也使用统一切片解析且不再默认淘宝", () => {
    const binding = callback("    const bindingRef = useRef(new Set<string>());", "    const canvasNodeActions =");

    expect(binding).toContain("ecommerceBriefSlicePlatform(source.metadata?.ecommerceBrief, plan.platform || product.metadata?.ecommercePlatform)");
    expect(binding).not.toContain('plan.platform || product.metadata?.ecommercePlatform || "taobao"');
});

test("真实页面把画布种类和工作区模式传给连线创建菜单", () => {
    const start = page.indexOf("<CanvasConnectionCreateMenu");
    const menu = page.slice(start, page.indexOf("/>", start) + 2);

    expect(menu).toContain("canvasKind={canvasKind}");
    expect(menu).toContain("workspaceMode={workspaceMode}");
});

test("创作表行同步到 BatchTable 时保留跳过状态", () => {
    expect(tableNode).toContain("enabled: row.enabled !== false");
});

test("普通分析和参考套图重新分析都用同一纯函数保留跳过行", () => {
    const ordinary = callback("    const draftEcommerceSuite = useCallback(", "    const generateEcommerceSuite = useCallback(");
    expect(ordinary).toContain("const reconciled = reconcileEcommerceSuiteDraftRows(rows, parsed);");
    expect(ordinary).toContain("if (!reconciled)");
    expect(ordinary).toContain("槽位、顺序或数量");
    expect(ordinary).toContain("rows: reconciled");
    expect(ordinary).toContain("reconciled.filter((row) => row.enabled !== false).length");

    const reverse = callback("    const reverseEcommerceSuite = useCallback(", "    const reverseEcommerceSuiteRef = useRef(");
    expect(reverse).toContain("const requestedRows = ecommerceBriefRows(flow, previousRows, { imageCount: count });");
    expect(reverse).toContain("ecommerceSuiteDraftPrompt(flow, product.metadata?.productProfile, requestedRows, undefined, { platformId })");
    expect(reverse).toContain("const rows = reconcileEcommerceSuiteDraftRows(requestedRows, parsed);");
    expect(reverse).toContain("if (!rows)");
    expect(reverse).toContain("rows.filter((row) => row.enabled !== false).length");
});

test("计划 9 张只约束启用屏，跳过屏保留在编辑表且不干扰页面校验", () => {
    const flow = ecommerceOneClickFlow("detail")!;
    const previous = Array.from({ length: 9 }, (_, index) => ({
        slotId: `detail-${index + 1}`,
        title: `第 ${index + 1} 屏`,
        duty: "展示商品",
        prompt: "旧提示词",
        ...(index === 3 ? { enabled: false } : {}),
    }));
    const planned = ecommerceBriefRows(flow, previous, { imageCount: 9 });
    const prompt = ecommerceSuiteDraftPrompt(flow, undefined, planned);
    const outputRows = planned.filter((row) => prompt.includes(`${row.slotId} | ${row.title} | ${row.duty}`));
    const parsed = planned.filter((row) => row.enabled !== false).map((row) => ({ slotId: row.slotId, title: "新屏", duty: "新职责", prompt: "新提示词" }));
    const merged = reconcileEcommerceSuiteDraftRows(planned, parsed);
    const rejected = reconcileEcommerceSuiteDraftRows(planned, parsed.slice(0, -1));
    const ordinary = callback("    const draftEcommerceSuite = useCallback(", "    const generateEcommerceSuite = useCallback(");
    const reverse = callback("    const reverseEcommerceSuite = useCallback(", "    const reverseEcommerceSuiteRef = useRef(");

    expect({
        modelOutputRows: outputRows.length,
        mergedRows: merged?.length,
        rejected,
        ordinaryCountsEnabledRows: ordinary.includes("reconciled.filter((row) => row.enabled !== false).length"),
        reverseCountsEnabledRows: reverse.includes("rows.filter((row) => row.enabled !== false).length"),
    }).toEqual({ modelOutputRows: 9, mergedRows: 10, rejected: undefined, ordinaryCountsEnabledRows: true, reverseCountsEnabledRows: true });
});
