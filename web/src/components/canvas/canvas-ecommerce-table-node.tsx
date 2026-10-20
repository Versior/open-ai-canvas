import { App } from "antd";
import { useRef, useState } from "react";
import { useCanvasNodeActions } from "@/components/canvas/canvas-node-action-context";
import { useNodeConnections, useNodeInputs, useDownstreamNodes } from "@/components/canvas/canvas-node-graph-context";
import { CanvasEcommerceSuitePanel } from "@/components/canvas/canvas-ecommerce-suite-panel";
import { useSkillRuntimeCatalog } from "@/components/skills/skill-runtime-picker";
import { ecommerceOneClickFlow, type EcommerceOneClickFlow } from "@/lib/ecommerce/ecommerce-oneclick";
import { ecommerceSuiteMoveRow, ecommerceSuiteRowId, ecommerceSuiteRows, type EcommerceSuite, type EcommerceSuiteRow } from "@/lib/ecommerce/ecommerce-suite";
import { stopCanvasDragFromInteractive } from "@/lib/canvas/node-interaction";
import { useEcommerceSettings } from "@/stores/use-ecommerce-settings";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import { ecommerceTableResults, ecommerceSuiteMetadata } from "@/lib/ecommerce/ecommerce-table";

export function CanvasEcommerceTableNodeContent({ node, readOnly = false }: { node: CanvasNodeData; readOnly?: boolean }) {
    return readOnly ? <ReadOnlyEcommerceTable node={node} /> : <EditableEcommerceTable node={node} />;
}

function ReadOnlyEcommerceTable({ node }: { node: CanvasNodeData }) {
    const flow = ecommerceOneClickFlow(node.metadata?.ecommerceFlowId);
    const rows = node.metadata?.ecommerceSuite?.rows || [];
    return (
        <div className="ecom-table-node" data-canvas-no-zoom data-canvas-wheel-scroll>
            <header className="ecom-suite-head">
                <h2 className="ecom-suite-title">{flow?.name || "电商创作表"}</h2>
                <span>只读</span>
            </header>
            <div className="ecom-suite-grid">
                <div className="ecom-suite-grid-head">
                    <span>屏次</span>
                    <span>职责</span>
                    <span>提示词</span>
                    <span />
                </div>
                {rows.map((row) => (
                    <div key={row.slotId} className="ecom-suite-grid-row">
                        <span>{row.title}</span>
                        <span>{row.duty}</span>
                        <p className="whitespace-pre-wrap">{row.prompt}</p>
                        <span />
                    </div>
                ))}
            </div>
        </div>
    );
}

function EditableEcommerceTable({ node }: { node: CanvasNodeData }) {
    const actions = useCanvasNodeActions();
    const { updateMetadata, draftEcommerceSuite, generateEcommerceSuite, reverseEcommerceSuite, bindEcommerceSuite } = actions;
    const setting = useEcommerceSettings((state) => state.setting);
    const inputs = useNodeInputs(node.id);
    const connections = useNodeConnections(node.id);
    const downstream = useDownstreamNodes(node.id);
    const product = inputs.find((item) => item.type === CanvasNodeType.Product && connections.some((edge) => edge.fromNodeId === item.id && edge.toNodeId === node.id));
    const { message } = App.useApp();
    const [analyzing, setAnalyzing] = useState(false);
    const [generating, setGenerating] = useState(false);
    const analysisInFlight = useRef(false);
    const generationInFlight = useRef(false);
    const { skills, loading: skillsLoading, error: skillsError, refresh: refreshSkills } = useSkillRuntimeCatalog();
    const activeFlow = ecommerceOneClickFlow(node.metadata?.ecommerceFlowId) || ecommerceOneClickFlow("main")!;
    const suite = node.metadata?.ecommerceSuite;
    const currentSuite = (flow: EcommerceOneClickFlow): EcommerceSuite => node.metadata?.ecommerceSuitesByFlow?.[flow.id] || (suite?.flow === flow.id ? suite : { flow: flow.id, rows: ecommerceSuiteRows(flow, undefined), source: "draft", updatedAt: "" });
    const results = ecommerceTableResults(currentSuite(activeFlow).rows, downstream, activeFlow.id);
    const changeRows = (update: (rows: EcommerceSuiteRow[], flow: EcommerceOneClickFlow) => EcommerceSuiteRow[]) => {
        if (node.metadata?.locked) return false;
        const current = currentSuite(activeFlow);
        const next = { ...current, rows: update(current.rows, activeFlow), updatedAt: new Date().toISOString() };
        updateMetadata?.(node.id, {
            ...ecommerceSuiteMetadata(node.metadata, next),
            batchTable: { operation: "product", concurrency: 10, ...node.metadata?.batchTable, rows: next.rows.map((row) => ({ id: row.slotId, enabled: true, inputNodeIds: [], prompt: row.prompt, cells: { title: row.title, duty: row.duty } })) },
        });
    };
    const patchSuiteRow = (slotId: string, patch: Partial<Pick<EcommerceSuiteRow, "title" | "duty" | "prompt">>) => changeRows((rows) => rows.map((row) => (row.slotId === slotId ? { ...row, ...patch } : row)));
    const analyze = async (rows: EcommerceSuiteRow[], reverse = false) => {
        if (node.metadata?.locked || analysisInFlight.current) return;
        analysisInFlight.current = true;
        setAnalyzing(true);
        try {
            if (reverse) await reverseEcommerceSuite?.(node, activeFlow.id, node.metadata?.ecommerceAnalysisModel || undefined);
            else await draftEcommerceSuite?.(node, activeFlow.id, node.metadata?.ecommerceAnalysisModel || undefined, rows);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "分析失败");
        } finally {
            analysisInFlight.current = false;
            setAnalyzing(false);
        }
    };
    const generate = async (slotId?: string, rows?: EcommerceSuiteRow[]) => {
        if (node.metadata?.locked) return false;
        if (generationInFlight.current) return false;
        generationInFlight.current = true;
        setGenerating(true);
        try {
            const enqueued = await generateEcommerceSuite?.(node, activeFlow.id, slotId ? [slotId] : undefined, rows);

            return Boolean(enqueued);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "生成失败");
        } finally {
            generationInFlight.current = false;
            setGenerating(false);
        }
    };
    return (
        <div className="ecom-table-node" onMouseDown={stopCanvasDragFromInteractive} data-canvas-no-zoom data-canvas-wheel-scroll>
            <div className="ecom-table-source">{product ? `商品输入：${product.title || "商品"}` : "请连接商品节点后分析或生成"}</div>
            <fieldset disabled={Boolean(node.metadata?.locked)} style={{ display: "contents" }}>
                <CanvasEcommerceSuitePanel
                    embedded
                    open
                    flow={activeFlow}
                    suite={currentSuite(activeFlow)}
                    rows={currentSuite(activeFlow).rows}
                    nodeBySlot={results.selected}
                    candidatesBySlot={results.candidates}
                    analysisModel={node.metadata?.ecommerceAnalysisModel || ""}
                    imageModel={node.metadata?.ecommerceImageModel || ""}
                    imageSize={node.metadata?.ecommerceImageSize || ""}
                    imageQuality={node.metadata?.ecommerceImageQuality || ""}
                    templates={setting.templates}
                    brief={node.metadata?.ecommerceBrief}
                    onBriefChange={(value) => updateMetadata?.(node.id, { ecommerceBrief: value })}
                    autoBindAvailable={setting.autoBindEnabled}
                    skillIds={node.metadata?.ecommerceAnalysisSkillsByFlow?.[activeFlow.id] ?? []}
                    availableSkills={skills}
                    skillsLoading={skillsLoading}
                    skillsError={skillsError}
                    onRefreshSkills={refreshSkills}
                    autoBind={node.metadata?.ecommerceAutoBind === true}
                    analyzing={analyzing}
                    generating={generating}
                    onAnalysisModelChange={(value) => updateMetadata?.(node.id, { ecommerceAnalysisModel: value })}
                    onImageModelChange={(value) => updateMetadata?.(node.id, { ecommerceImageModel: value })}
                    onImageOptionChange={(key, value) => updateMetadata?.(node.id, key === "size" ? { ecommerceImageSize: value } : { ecommerceImageQuality: value })}
                    onSkillIdsChange={(value) => updateMetadata?.(node.id, { ecommerceAnalysisSkillsByFlow: { ...node.metadata?.ecommerceAnalysisSkillsByFlow, [activeFlow.id]: value } })}
                    onAutoBindChange={(value) => updateMetadata?.(node.id, { ecommerceAutoBind: value })}
                    onClearPrompts={() => changeRows((rows) => rows.map((row) => ({ ...row, prompt: "" })))}
                    onAnalyze={(rows) => void analyze(rows)}
                    onRowChange={patchSuiteRow}
                    onReverse={
                        reverseEcommerceSuite
                            ? () => {
                                  actions.updateMetadata && void analyze(currentSuite(activeFlow).rows, true);
                              }
                            : undefined
                    }
                    onBind={bindEcommerceSuite ? (rows) => bindEcommerceSuite(node, rows) : undefined}
                    onRowsChange={(rows) => changeRows(() => rows)}
                    onAddRow={() => changeRows((rows, flow) => [...rows, { slotId: ecommerceSuiteRowId(flow, rows), title: "", duty: "", prompt: "" }])}
                    onRemoveRow={(id) => {
                        if (currentSuite(activeFlow).rows.length <= 1) {
                            message.warning("至少保留一行");
                            return;
                        }
                        changeRows((rows) => rows.filter((row) => row.slotId !== id));
                    }}
                    onGenerate={(rows) => void generate(undefined, rows)}
                    onGenerateOne={(id, rows) => void generate(id, rows)}
                    onMoveRow={(id, delta) => changeRows((rows) => ecommerceSuiteMoveRow(rows, id, delta))}
                    onClose={() => {}}
                />
            </fieldset>
        </div>
    );
}
