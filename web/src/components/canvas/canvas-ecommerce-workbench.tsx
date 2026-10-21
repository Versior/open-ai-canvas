import { App, Button, Checkbox, Input, InputNumber, Select, Tabs } from "antd";
import { useEffect, useState } from "react";
import { AppDrawer } from "@/components/ui/product/app-drawer";
import { ModelPicker } from "@/components/model-picker";
import { EcommerceImageSettings } from "./ecommerce-image-settings";
import { EcommerceChoiceInput, ECOMMERCE_BRIEF_CHOICES } from "./ecommerce-choice-input";
import { useEffectiveConfig } from "@/stores/use-config-store";
import { useEcommerceSettings } from "@/stores/use-ecommerce-settings";
import { ecommerceCapabilitySettings } from "@/services/api/ecommerce";
import { DEFAULT_ECOMMERCE_BRIEF, ecommerceActionCapability, ECOMMERCE_CAPABILITIES, ECOMMERCE_IMAGE_TYPES, patchEcommerceWorkbenchBrief, type EcommerceCapability, type EcommerceWorkbenchBrief } from "@/lib/ecommerce/ecommerce-capabilities";
import type { EcommerceWorkbenchAction, EcommerceWorkbenchRequest } from "@/lib/ecommerce/ecommerce-capabilities";
import { CanvasNodeType, type CanvasNodeData, type CanvasConnection } from "@/types/canvas";
import { EcommerceTemplateCatalogDetails } from "./ecommerce-template-catalog";
import { EcommerceSavedTemplatePicker } from "./ecommerce-saved-template-picker";
import { ECOMMERCE_PRINT_SPECS } from "@/lib/ecommerce/ecommerce-print-specs";
import { useEcommercePatternLibrary } from "@/stores/use-ecommerce-pattern-library";
import "./canvas-ecommerce-workbench.css";

const initialBrief = DEFAULT_ECOMMERCE_BRIEF;
type Props = {
    studioId?: string;
    initialCapability?: EcommerceCapability;
    open: boolean;
    onClose: () => void;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    selectedIds: Set<string>;
    busy: boolean;
    onRun: (request: EcommerceWorkbenchRequest) => Promise<string>;
    onStop: () => void;
    onLayers: (node: CanvasNodeData) => void;
    onFocus: (id: string) => void;
    onAssets: () => void;
};
export function CanvasEcommerceWorkbench({ studioId, initialCapability = "planning", open, onClose, nodes, connections, selectedIds, busy, onRun, onStop, onLayers, onFocus, onAssets }: Props) {
    const { message, modal } = App.useApp();
    const config = useEffectiveConfig();
    const setting = useEcommerceSettings((state) => state.setting);
    const [capability, setCapability] = useState<EcommerceCapability>("planning");
    const [brief, setBrief] = useState(initialBrief);
    const [sources, setSources] = useState<string[]>([]);
    const [textModel, setTextModel] = useState(""),
        [imageModel, setImageModel] = useState("");
    const [from, setFrom] = useState("#000000"),
        [to, setTo] = useState("#d66042"),
        [tolerance, setTolerance] = useState(24);
    const [widthCm, setWidthCm] = useState(20),
        [heightCm, setHeightCm] = useState(20),
        [layout, setLayout] = useState<"tile" | "contain" | "cover">("contain");
    const [visibility, setVisibility] = useState<Record<string, boolean>>({});
    const [printSpecId, setPrintSpecId] = useState("");
    const [patternId, setPatternId] = useState("");
    const [error, setError] = useState("");
    const patterns = useEcommercePatternLibrary((state) => state.patterns);
    const restore = (request: EcommerceWorkbenchRequest) => {
        setBrief(patchEcommerceWorkbenchBrief(structuredClone(request.brief), {}));
        setSources([...request.sourceIds]);
        setTextModel(request.textModel);
        setImageModel(request.imageModel);
        setFrom(request.from);
        setTo(request.to);
        setTolerance(request.tolerance);
        setWidthCm(request.widthCm);
        setHeightCm(request.heightCm);
        setLayout(request.layout);
        setVisibility({ ...request.layerVisibility });
        setPrintSpecId(request.printSpecId || "");
        setPatternId(request.patternId || "");
    };
    useEffect(() => {
        if (open) {
            void useEcommercePatternLibrary.getState().hydrate().catch((error) => setError(error instanceof Error ? error.message : "花型库读取失败"));
            setCapability(initialCapability);
            const studio = nodes.find((node) => node.id === studioId);
            const saved = studio?.metadata?.ecommerceStudio;
            const previous = studio?.metadata?.ecommerceWorkbench?.request;
            if (previous) restore(previous);
            setBrief(patchEcommerceWorkbenchBrief(structuredClone(saved?.brief || previous?.brief || initialBrief), {}));
            setTextModel(saved?.textModel || previous?.textModel || "");
            setImageModel(saved?.imageModel || previous?.imageModel || "");
            setSources(studioId ? [...new Set(connections.filter((edge) => edge.toNodeId === studioId && edge.relation !== "batch-output").map((edge) => edge.fromNodeId))] : [...selectedIds].filter((id) => id !== studioId));
            setError("");
            void useEcommerceSettings
                .getState()
                .load()
                .catch((error) => setError(error instanceof Error ? error.message : "配置读取失败"));
        }
    }, [open, studioId, initialCapability]);
    const patch = (change: Partial<EcommerceWorkbenchBrief>) => setBrief((current) => patchEcommerceWorkbenchBrief(current, change));
    const run = async (action: EcommerceWorkbenchAction, generateAfterPlanning = false) => {
        setError("");
        try {
            await onRun({ studioId, action, brief, sourceIds: sources, textModel, imageModel, from, to, tolerance, widthCm, heightCm, layout, layerVisibility: visibility, printSpecId, patternId, generateAfterPlanning });
            message.success(generateAfterPlanning && !brief.reviewRequired ? "整组图片已生成，结果已连接到生图台" : "操作完成，结果与步骤记录已写入画布");
        } catch (error) {
            setError(error instanceof Error ? error.message : "执行失败");
        }
    };
    const command = (title: string, action: EcommerceWorkbenchAction, primary = false) => (
        <Button className={primary ? "ecommerce-command" : undefined} disabled={busy || !setting.enabled || !ecommerceCapabilitySettings(setting)[ecommerceActionCapability(action)]?.enabled} onClick={() => void run(action)}>
            {title}
        </Button>
    );
    const selectedImages = sources.map((id) => nodes.find((node) => node.id === id)).filter((node): node is CanvasNodeData => node?.type === CanvasNodeType.Image);
    const history = nodes
        .filter((node) => node.metadata?.ecommerceWorkbench)
        .slice(-30)
        .reverse();
    return (
        <AppDrawer open={open} onClose={onClose} title="电商工作台" size={780} className="ecommerce-workbench" extra={busy ? <Button onClick={onStop}>停止当前步骤</Button> : <Button onClick={onAssets}>素材库</Button>}>
            <div data-canvas-no-zoom data-canvas-wheel-scroll>
                <Tabs activeKey={capability} onChange={(key) => setCapability(key as EcommerceCapability)} items={ECOMMERCE_CAPABILITIES.map((item) => ({ key: item.id, label: item.name }))} />
                <p className="ecommerce-workbench-hint">{ECOMMERCE_CAPABILITIES.find((item) => item.id === capability)?.description}</p>
                {!ecommerceCapabilitySettings(setting)[capability]?.enabled ? <p role="alert">管理员已停用此功能</p> : null}
                {error ? (
                    <p role="alert" className="ecommerce-workbench-error">
                        {error}
                    </p>
                ) : null}
                <fieldset disabled={busy}>
                    <div className="ecommerce-workbench-source-group">
                    <h3>输入素材</h3>
                    <label>
                        名称
                        <Input aria-label="工作台项目名称" value={brief.name} maxLength={100} onChange={(event) => patch({ name: event.target.value })} placeholder="商品、花型或模特名称" />
                    </label>
                    <label>
                        输入素材（按选择顺序使用）
                        <Select
                            aria-label="工作台输入素材"
                            mode="multiple"
                            value={sources}
                            onChange={setSources}
                            options={nodes
                                .filter((node) => [CanvasNodeType.Image, CanvasNodeType.Text, CanvasNodeType.Product].includes(node.type as CanvasNodeType))
                                .map((node) => ({ value: node.id, label: (node.title || node.type) + " · " + node.id.slice(-6) }))}
                        />
                    </label>
                    <div className="ecommerce-workbench-sources">
                        {sources.map((id, index) => {
                            const node = nodes.find((node) => node.id === id);
                            return (
                                <div key={id}>
                                    <span>
                                        {index + 1}. {node?.title || id}
                                    </span>
                                    <Button
                                        size="small"
                                        disabled={!index}
                                        onClick={() =>
                                            setSources((current) => {
                                                const next = [...current];
                                                [next[index - 1], next[index]] = [next[index], next[index - 1]];
                                                return next;
                                            })
                                        }
                                    >
                                        上移
                                    </Button>
                                </div>
                            );
                        })}
                    </div>
                    </div>
                    <details open={["planning", "listing", "pipeline"].includes(capability)}>
                        <summary>商品与发布信息</summary>
                        <label>
                            已核实事实
                            <Input.TextArea aria-label="已核实商品事实" rows={3} maxLength={12000} value={brief.facts} onChange={(event) => patch({ facts: event.target.value })} placeholder="只填已确认的材质、参数、用途与依据" />
                        </label>
                        <label>
                            禁止声明
                            <Input.TextArea rows={2} maxLength={6000} value={brief.forbidden} onChange={(event) => patch({ forbidden: event.target.value })} />
                        </label>
                        <div className="ecommerce-workbench-grid">
                            {(["market", "platform", "language"] as const).map((key, index) => (
                                <label key={key}>
                                    {["市场", "平台", "语言"][index]}
                                    <EcommerceChoiceInput label={["市场", "平台", "语言"][index]} disabled={busy} choices={ECOMMERCE_BRIEF_CHOICES[key]} value={brief[key]} onChange={(value) => patch({ [key]: value })} />
                                </label>
                            ))}
                        </div>
                    </details>
                    <label>
                        补充要求
                        <Input.TextArea aria-label="工作台补充要求" rows={3} maxLength={6000} value={brief.direction} onChange={(event) => patch({ direction: event.target.value })} />
                    </label>
                    {!["print-pack", "layers"].includes(capability) ? (
                        <details>
                        <summary>模型设置</summary>
                        <div className="ecommerce-workbench-grid">
                            <label>
                                分析模型
                                <ModelPicker config={config} capability="text" value={textModel || config.model} onChange={setTextModel} fullWidth />
                            </label>
                            <label>
                                图片模型
                                <ModelPicker config={config} capability="image" value={imageModel || config.imageModel || config.model} onChange={setImageModel} fullWidth />
                            </label>
                        </div>
                        <EcommerceImageSettings config={config} model={imageModel || config.imageModel || config.model} brief={brief} disabled={busy} onChange={patch} />
                        </details>
                    ) : null}
                    {capability === "planning" ? <EcommerceSavedTemplatePicker disabled={busy} onApply={(template) => patch({ template, count: template.shots.length })} /> : null}
                    {capability === "planning" ? (
                        <>
                            <EcommerceTemplateCatalogDetails title="选择内置套图模板" disabled={busy} onApply={(template) => patch({ template, count: template.shots.length })} />
                            {brief.template ? (
                                <p>
                                    {brief.template.name} · {brief.template.shots.length} 张参考画面{" "}
                                    <Button size="small" disabled={busy} onClick={() => patch({ template: undefined })}>
                                        取消模板
                                    </Button>
                                </p>
                            ) : null}
                        </>
                    ) : null}
                    {capability === "planning" ? (
                        <>
                            <label>
                                计划张数
                                <InputNumber min={Math.max(1, new Set(brief.imageTypes).size)} max={30} value={brief.count} onChange={(value) => patch({ count: value || 1 })} />
                            </label>
                            <label>
                                图型（25 类）
                                <Checkbox.Group options={ECOMMERCE_IMAGE_TYPES.map(([, name]) => name)} value={brief.imageTypes} onChange={(values) => patch({ imageTypes: values.map(String) })} />
                                <p>每个已选图型至少一张，剩余张数按商品需求分配；新增图型超过总张数时会同步增加张数。</p>
                            </label>
                            <div className="ecommerce-workbench-actions">
                                {studioId ? <Button className="ecommerce-command" disabled={busy || !setting.enabled || !ecommerceCapabilitySettings(setting).planning.enabled} onClick={() => void run("planning", true)}>规划并生成图片 · {brief.count} 张</Button> : null}
                                {command("AI 规划方案", "planning", true)}
                                {command("采用方案创建生图台", "apply-plan")}
                                {command("方案保存为模板", "save-template")}
                            </div>
                        </>
                    ) : null}
                    {capability === "suite-forge" ? (
                        <>
                            <p>选择参考图片并调整顺序。反推方案经核对后可直接用于生图台，或保存为模板。</p>
                            <div className="ecommerce-workbench-actions">
                                {command("反推套图与视觉锁", "suite-forge", true)}
                                {command("保存选中方案为模板", "save-template")}
                                {command("采用方案创建生图台", "apply-plan")}
                            </div>
                        </>
                    ) : null}
                    {capability === "model-cast" ? (
                        <>
                            <label>
                                成年模特身份
                                <Input.TextArea aria-label="模特身份" rows={3} value={brief.identity} maxLength={2000} onChange={(event) => patch({ identity: event.target.value })} placeholder="成年、年龄段、性别呈现、身高、体型、面部特征及服装要求" />
                            </label>
                            <label>
                                姿态
                                <Checkbox.Group options={["正面全身", "侧面全身", "背面全身", "面部近景", "半身", "坐姿", "行走", "生活场景"]} value={brief.poses} onChange={(values) => patch({ poses: values.map(String) })} />
                            </label>
                            <p>有参考图时锁定该身份；没有参考图时，先生成第一张，再作为后续姿态的参考。每个姿态各提交一个任务，身份一致性须人工核对。</p>
                            <div className="ecommerce-workbench-actions">
                                {command("生成多姿态参考", "model-cast", true)}
                                {command("选中结果保存为模特", "save-model")}
                            </div>
                        </>
                    ) : null}
                    {capability === "pattern" ? (
                        <>
                            <label>我的花型<Select aria-label="选择私人花型" value={patternId || undefined} placeholder="选择已保存花型" options={patterns.map((pattern) => ({ value: pattern.id, label: pattern.name }))} onChange={setPatternId} /></label>
                            <div className="ecommerce-workbench-actions">{command("选中图片保存为花型", "save-pattern")}{command("已选花型添加到画布", "add-pattern")}<Button disabled={busy || !patternId} onClick={() => void useEcommercePatternLibrary.getState().remove(patternId).then(() => { setPatternId(""); message.success("已从本机花型库移除，图片文件保留"); }).catch((error) => setError(error instanceof Error ? error.message : "移除失败"))}>移除已选花型</Button></div>
                            <div className="ecommerce-workbench-actions">
                                {command("从商品图提取花型", "pattern-extract")}
                                {command("花型起稿", "pattern-draft")}
                                {command("画风与构图衍生", "pattern-derive")}
                                {command("像素验缝", "seams")}
                            </div>
                            <div className="ecommerce-workbench-grid">
                                <label>
                                    源色
                                    <Input type="color" value={from} onChange={(event) => setFrom(event.target.value)} />
                                </label>
                                <label>
                                    目标色
                                    <Input type="color" value={to} onChange={(event) => setTo(event.target.value)} />
                                </label>
                                <label>
                                    容差
                                    <InputNumber min={0} max={255} value={tolerance} onChange={(value) => setTolerance(value || 0)} />
                                </label>
                            </div>
                            {command("确定性改色并保留原图", "recolor", true)}
                        </>
                    ) : null}
                    {capability === "listing" ? command("根据事实与图片生成 Listing", "listing", true) : null}
                    {["print-pack", "pipeline"].includes(capability) ? (
                        <>
                            <label>印刷品类<Select aria-label="印刷品类" value={printSpecId} onChange={setPrintSpecId} options={[{ value: "", label: "自定义尺寸" }, ...ECOMMERCE_PRINT_SPECS.map((spec) => ({ value: spec.id, label: spec.label }))]} /></label>
                            {printSpecId ? <p>按品类输出固定 300DPI 规格与实物示意；示意图不是实拍。量产前以目标机型、尺码与工厂模板为准。</p> : null}
                            <div className="ecommerce-workbench-grid">
                                <label>
                                    宽度 cm
                                    <InputNumber disabled={Boolean(printSpecId)} aria-label="印刷宽度" min={0.1} max={138} value={printSpecId ? (ECOMMERCE_PRINT_SPECS.find((item) => item.id === printSpecId)?.width || 0) / 300 * 2.54 : widthCm} onChange={(value) => setWidthCm(value || 1)} />
                                </label>
                                <label>
                                    高度 cm
                                    <InputNumber disabled={Boolean(printSpecId)} aria-label="印刷高度" min={0.1} max={138} value={printSpecId ? (ECOMMERCE_PRINT_SPECS.find((item) => item.id === printSpecId)?.height || 0) / 300 * 2.54 : heightCm} onChange={(value) => setHeightCm(value || 1)} />
                                </label>
                                <label>
                                    版式
                                    <Select
                                        aria-label="印刷版式"
                                        value={layout}
                                        onChange={setLayout}
                                        options={[
                                            { value: "contain", label: "单区域 · 完整保留" },
                                            { value: "cover", label: "单区域 · 裁切铺满" },
                                            { value: "tile", label: "满印 · 重复平铺" },
                                        ]}
                                    />
                                </label>
                            </div>
                            <p>输出实际 300DPI PNG、预览和清单。满印验缝失败会停止；单区域由你明确选择。请核对承印商色彩与裁切要求。</p>
                            <div className="ecommerce-workbench-actions">
                                {command(capability === "pipeline" ? "验缝 → 规格包 → Listing" : "生成 300DPI 规格包", capability, true)}
                                {capability === "pipeline" ? (
                                    <>
                                        {command("单步验缝", "seams")}
                                        {command("单步规格包", "print-pack")}
                                        {command("单步 Listing", "listing")}
                                    </>
                                ) : null}
                            </div>
                        </>
                    ) : null}
                    {capability === "layers" ? (
                        <>
                            <p>选择源图开始 AI 分层；已有图层组可在画布调整显隐与顺序。导出时按输入素材顺序从顶到底，所有图层须为相同完整画布尺寸。</p>
                            <Button
                                disabled={busy || !selectedImages.length}
                                onClick={() => {
                                    onClose();
                                    onLayers(selectedImages[0]);
                                }}
                            >
                                打开 AI 分层
                            </Button>
                            <div className="ecommerce-workbench-sources">
                                {selectedImages.map((node) => (
                                    <Checkbox key={node.id} checked={visibility[node.id] !== false} onChange={(event) => setVisibility((current) => ({ ...current, [node.id]: event.target.checked }))}>
                                        {node.title || node.id} · 导出时可见
                                    </Checkbox>
                                ))}
                            </div>
                            {command("导出 PNG 图层、PSD 与 ZIP", "export-layers", true)}
                        </>
                    ) : null}
                </fieldset>
                <details className="ecommerce-workbench-history">
                    <summary>执行与版本记录（{history.length}）</summary>
                    {history.map((node) => {
                        const work = node.metadata!.ecommerceWorkbench!;
                        return (
                            <article key={node.id}>
                                <button type="button" onClick={() => onFocus(node.id)}>
                                    {node.title}
                                </button>
                                <span>{work.steps.map((step) => step.id + "：" + { running: "执行中", succeeded: "完成", failed: "失败" }[step.status]).join(" · ")}</span>
                                {work.steps
                                    .filter((step) => step.error)
                                    .map((step) => (
                                        <p role="alert" key={step.id}>
                                            {step.error}
                                        </p>
                                    ))}
                                <Button
                                    size="small"
                                    disabled={busy}
                                    onClick={() => {
                                        if (work.request) restore(work.request);
                                        else {
                                            setBrief(structuredClone(work.brief));
                                            setSources([...work.sourceIds]);
                                        }
                                        if (ECOMMERCE_CAPABILITIES.some((item) => item.id === work.capability)) setCapability(work.capability as EcommerceCapability);
                                    }}
                                >
                                    复用配置
                                </Button>
                                {work.request && work.steps.some((step) => step.taskId) ? <Button size="small" disabled={busy} onClick={() => void onRun({ ...structuredClone(work.request!), resumeReceiptId: node.id, retryFailed: false }).then(() => message.success("已有任务与后续步骤已完成")).catch((error) => setError(error instanceof Error ? error.message : "恢复失败"))}>恢复原任务</Button> : null}
                                {work.request && work.inputSignature && work.steps.some((step) => step.taskId) && work.steps.some((step) => step.status === "failed") ? <Button size="small" disabled={busy} onClick={() => void onRun({ ...structuredClone(work.request!), resumeReceiptId: node.id, retryFailed: true }).then(() => message.success("失败步骤已重试，后续步骤已完成")).catch((error) => setError(error instanceof Error ? error.message : "重试失败"))}>重试失败步骤并继续</Button> : null}
                                {work.request?.action === "pipeline" ? <div className="ecommerce-workbench-actions">{(["seams", "print-pack", "listing"] as const).map((step, index) => <Button key={step} size="small" disabled={busy || work.steps.some((item) => item.status === "running")} onClick={() => modal.confirm({ title: "从" + ["验缝", "规格包", "Listing"][index] + "重新执行？", content: "本步骤及其下游记录将失效，已有结果图片保留。Listing 会提交新的模型任务并可能计费。", okText: "重新执行", cancelText: "取消", onOk: () => onRun({ ...structuredClone(work.request!), resumeReceiptId: node.id, rerunFrom: step }).then(() => message.success("步骤与下游已重新执行")).catch((error) => { setError(error instanceof Error ? error.message : "重跑失败"); throw error; }) })}>从{["验缝", "规格包", "Listing"][index]}重跑</Button>)}</div> : null}
                            </article>
                        );
                    })}
                </details>
            </div>
        </AppDrawer>
    );
}
