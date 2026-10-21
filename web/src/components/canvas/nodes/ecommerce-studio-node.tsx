import { useContext, useEffect, useRef, useState, type CSSProperties } from "react";
import { App, Button, Checkbox, Input, InputNumber, Select } from "antd";
import { ArrowUpRight, Images, ScanLine, Shirt, SwatchBook, Text, Package, Workflow, Layers } from "lucide-react";
import { CachedResourceImage } from "@/components/cached-resource-image";
import { useCanvasNodeActions } from "../canvas-node-action-context";
import { CanvasNodeGraphContext, useNodeInputs, useDownstreamNodes } from "../canvas-node-graph-context";
import { EcommerceNodeTitle } from "./canvas-ecommerce-node-title";
import { ModelPicker } from "@/components/model-picker";
import { EcommerceImageSettings } from "../ecommerce-image-settings";
import { SkillRuntimePicker, useSkillRuntimeCatalog } from "@/components/skills/skill-runtime-picker";
import { EcommerceChoiceInput, ECOMMERCE_BRIEF_CHOICES } from "../ecommerce-choice-input";
import { ECOMMERCE_CAPABILITIES } from "@/lib/ecommerce/ecommerce-capabilities";
import { EcommerceTemplateCatalogDetails } from "../ecommerce-template-catalog";
import { EcommerceSavedTemplatePicker } from "../ecommerce-saved-template-picker";
import { ecommerceStudioResultOptions, ecommerceStudioShotResults, ecommerceStudioSources } from "@/lib/ecommerce/ecommerce-studio";
import { useEffectiveConfig } from "@/stores/use-config-store";
import { DEFAULT_ECOMMERCE_BRIEF, ECOMMERCE_IMAGE_TYPES, patchEcommerceWorkbenchBrief, studioWorkbenchRequest, type EcommerceWorkbenchAction } from "@/lib/ecommerce/ecommerce-capabilities";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import type { CanvasTheme } from "@/lib/canvas-theme";
import "./ecommerce-studio-node.css";

const TOOL_GROUPS = [
    { title: "商品与套图", ids: ["planning", "suite-forge", "model-cast"] },
    { title: "花型与印刷", ids: ["pattern", "print-pack"] },
    { title: "文案与交付", ids: ["listing", "pipeline", "layers"] },
] as const;
const TOOL_ICONS = { planning: Images, "suite-forge": ScanLine, "model-cast": Shirt, pattern: SwatchBook, listing: Text, "print-pack": Package, pipeline: Workflow, layers: Layers };

export function EcommerceStudioNodeContent({ node, theme }: { node: CanvasNodeData; theme: CanvasTheme }) {
    const { updateMetadata, runEcommerceWorkbench, stopEcommerceWorkbench, isEcommerceWorkbenchRunning, openEcommerceWorkbench, focusNode, viewImage } = useCanvasNodeActions();
    const { message } = App.useApp();
    const config = useEffectiveConfig();
    const skills = useSkillRuntimeCatalog();
    const upstream = useNodeInputs(node.id);
    const graph = useContext(CanvasNodeGraphContext);
    const downstream = useDownstreamNodes(node.id);
    const [busy, setBusy] = useState(false);
    const [section, setSection] = useState<"brief" | "plan" | "results" | "tools">("brief");
    const [selectedResults, setSelectedResults] = useState<string[]>([]);
    const [composeWidth, setComposeWidth] = useState(800);
    const [composeGap, setComposeGap] = useState(0);
    const [elapsed, setElapsed] = useState(0);
    const bodyRef = useRef<HTMLDivElement>(null);
    const studio = node.metadata?.ecommerceStudio || { brief: { ...structuredClone(DEFAULT_ECOMMERCE_BRIEF), name: node.title || "电商生图台" } };
    const brief = patchEcommerceWorkbenchBrief(studio.brief, {});
    const { plan } = studio;
    const running = busy || Boolean(isEcommerceWorkbenchRunning?.(node.id));
    const work = node.metadata?.ecommerceWorkbench;
    const active = work?.steps.filter((step) => step.status === "running").at(-1);
    const error = work?.steps.find((step) => step.error)?.error;
    const completedShots = work?.steps.filter((step) => step.id.startsWith("shot-") && step.status === "succeeded").length || 0;
    useEffect(() => {
        const tick = () => setElapsed(work?.startedAt ? Math.max(0, Math.floor((Date.now() - Date.parse(work.startedAt)) / 1000)) : 0);
        tick();
        if (!running) return;
        const timer = window.setInterval(tick, 1000);
        return () => window.clearInterval(timer);
    }, [running, work?.startedAt]);
    const interrupted = !running && node.metadata?.ecommerceWorkbench?.steps.some((step) => step.status === "running");
    const locked = Boolean(node.metadata?.locked) || !updateMetadata || running;
    const patch = (value: Partial<typeof studio>) => {
        if (!locked) updateMetadata?.(node.id, { ecommerceStudio: { ...studio, ...value } });
    };
    const patchBrief = (value: Partial<typeof brief>) => patch({ brief: patchEcommerceWorkbenchBrief(brief, value) });
    const productInputs = upstream.filter((item) => item.type === CanvasNodeType.Product).flatMap((item) => graph.getInputNodes?.(item.id) || []);
    const inputNodes = [...new Map([...upstream, ...productInputs].map((item) => [item.id, item])).values()];
    const inputEdges = upstream.flatMap((item) => graph.getConnections?.(item.id) || []);
    const images = ecommerceStudioSources(
        upstream.map((item) => item.id),
        inputNodes,
        inputEdges,
    ).filter((item) => item.type === CanvasNodeType.Image && Boolean(item.metadata?.storageKey || item.metadata?.content));
    const hasProduct = upstream.some((item) => item.type === CanvasNodeType.Product);
    const hasInput = images.some((item) => Boolean(item.metadata?.storageKey || item.metadata?.content)) || hasProduct;
    const shotReady = (shot: NonNullable<typeof plan>["shots"][number]) => Boolean(shot.title.trim() && shot.duty.trim() && shot.prompt?.trim());
    const results = downstream.filter((item) => item.type === CanvasNodeType.Image);
    const availableResults = results.filter((item) => item.metadata?.status === "success" && item.metadata.storageKey);
    const selectedImages = selectedResults.filter((id) => availableResults.some((item) => item.id === id));
    const unfinished = plan?.shots.flatMap((_, index) => (ecommerceStudioShotResults(node, results, index).length ? [] : [index])) || [];
    const invalidAdopted = plan?.shots.findIndex((_, index) => {
        const adopted = studio.adoptedResults?.[String(index)];
        return Boolean(adopted && !ecommerceStudioShotResults(node, results, index).some((result) => result.id === adopted));
    }) ?? -1;
    const exportIssue = !plan?.shots.length ? "先规划并生成图片，再导出采用结果" : invalidAdopted >= 0 ? `第 ${invalidAdopted + 1} 张采用版本已失效，请重新选择` : unfinished.length ? `还有 ${unfinished.length} 张画面没有当前方案的结果` : "";
    const run = async (action: EcommerceWorkbenchAction, shotIndices?: number[], generateAfterPlanning = false, resumeReceiptId?: string, retryFailed = false, restoreStudioInputs = false, resultIds = selectedImages) => {
        if (locked || !runEcommerceWorkbench) return;
        setBusy(true);
        try {
            const request = studioWorkbenchRequest(
                node.id,
                brief,
                upstream.map((item) => item.id),
                action,
            );
            const previous = resumeReceiptId ? node.metadata?.ecommerceWorkbench?.request : undefined;
            await runEcommerceWorkbench(previous ? { ...structuredClone(previous), resumeReceiptId, retryFailed, ...(restoreStudioInputs ? { restoreStudioInputs: true } : {}) } : { ...request, textModel: studio.textModel || "", imageModel: studio.imageModel || "", shotIndices, generateAfterPlanning, ...(["studio-place-results", "studio-compose"].includes(action) ? { resultIds, composeWidth, composeGap } : {}) });
            if (action === "planning") setSection((previous?.generateAfterPlanning ?? generateAfterPlanning) && !brief.reviewRequired ? "results" : "plan");
            if (action === "studio-generate" || action === "studio-compose") setSection("results");
            message.success(
                (previous?.generateAfterPlanning ?? generateAfterPlanning) && !brief.reviewRequired
                    ? "整组图片已生成，请在图片结果中挑选后添加到画布"
                    : action.startsWith("review-")
                      ? "当前版本已确认"
                      : action === "studio-export"
                        ? "套图原图与清单已导出"
                        : action === "save-template"
                          ? "已保存到我的模板"
                          : action === "studio-generate"
                            ? "图片已生成，请挑选需要的结果"
                            : action === "studio-place-results"
                              ? "选中图片已添加到画布"
                              : action === "studio-compose"
                                ? "长图已合成，可在结果中预览并添加到画布"
                            : "方案已更新，请核对后出图",
            );
        } catch (error) {
            message.error(error instanceof Error ? error.message : "执行失败");
        } finally {
            setBusy(false);
        }
    };
    const editShot = (index: number, change: Partial<NonNullable<typeof plan>["shots"][number]>) => {
        if (plan) patch({ plan: { ...plan, shots: plan.shots.map((shot, i) => (i === index ? { ...shot, ...change } : shot)) } });
    };
    return (
        <div
            className="ecommerce-studio-node"
            style={
                {
                    color: theme.node.text,
                    background: theme.node.fill,
                    "--studio-surface": theme.node.fill,
                    "--studio-text": theme.node.text,
                    "--studio-muted": theme.node.muted,
                    "--studio-border": theme.node.edge,
                    "--studio-hover": theme.toolbar.itemHover,
                } as CSSProperties
            }
            data-canvas-no-zoom
            data-canvas-wheel-scroll
            onPointerDown={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
        >
            <header className="ecommerce-studio-header">
                <EcommerceNodeTitle node={node} fallback="电商生图台" subtitle="商品素材 → 画面方案 → 图片结果" disabled={running} />
                <div className="ecommerce-studio-status">
                    <span>{images.length || hasProduct ? `已连接 ${images.length} 张图片${hasProduct ? " · 含商品档案" : ""}` : "待连接商品或图片"}</span>
                    <span>{plan ? `${plan.shots.length} 个画面` : "尚未规划"}</span>
                </div>
                <nav className="ecommerce-studio-nav" aria-label="生图台工作区">
                    {(
                        [
                            ["brief", "商品信息"],
                            ["plan", "画面方案"],
                            ["results", "图片结果"],
                            ["tools", "电商工具"],
                        ] as const
                    ).map(([id, label]) => (
                        <button
                            type="button"
                            key={id}
                            aria-pressed={section === id}
                            aria-controls={`studio-${node.id}-${id}`}
                            onClick={() => {
                                setSection(id);
                                bodyRef.current?.scrollTo({ top: 0 });
                            }}
                        >
                            {label}
                        </button>
                    ))}
                </nav>
                {running || interrupted || error || work?.stopped ? (
                    <div className="ecommerce-studio-execution" role={error && !running ? "alert" : "status"} aria-live="polite">
                        <div className="ecommerce-studio-execution-heading">
                            <strong>{running ? work?.stopped ? "正在停止" : active?.id.startsWith("shot-") ? `正在生成第 ${active.id.slice(5)} 张` : active?.id === "planning" || active?.id === "suite-forge" ? "正在分析商品与规划画面" : "正在处理" : work?.stopped ? "已停止后续生成" : interrupted ? "上次执行未完成" : "执行未完成"}</strong>
                            {running ? <Button size="small" disabled={work?.stopped} onClick={stopEcommerceWorkbench}>{work?.stopped ? "停止中…" : "停止"}</Button> : null}
                        </div>
                        {running ? <><p>已用 {elapsed} 秒 · 已完成 {completedShots} 张{work?.request?.generateAfterPlanning || work?.request?.action === "studio-generate" ? ` / ${work.request.shotIndices?.length || plan?.shots.length || brief.count} 张` : ""}</p><p>完成后可在图片结果中挑选。停止后会保留已完成的图片。</p></> : <p>{error || "可读取已有任务继续，无需重复提交分析。"}</p>}
                        {running && active?.id.startsWith("shot-") ? <progress aria-label="整组图片完成进度" value={completedShots} max={work?.request?.shotIndices?.length || plan?.shots.length || brief.count} /> : null}
                        {!running && work?.request && work.steps.some((step) => step.taskId) ? <div className="ecommerce-studio-actions"><Button size="small" disabled={locked} onClick={() => void run(work.request!.action, undefined, false, node.id)}>读取已有任务并继续</Button><Button size="small" disabled={locked} onClick={() => void run(work.request!.action, undefined, false, node.id, false, true)}>恢复上次参数并继续</Button></div> : null}
                    </div>
                ) : null}
            </header>
            <div className="ecommerce-studio-body" ref={bodyRef}>
                <fieldset disabled={locked}>
                    <details className="ecommerce-studio-generation-settings" data-canvas-no-drag>
                        <summary>整组生图设置 · 尺寸与质量</summary>
                        <label>图片模型<ModelPicker config={config} capability="image" value={studio.imageModel || config.imageModel || config.model} onChange={(imageModel) => patch({ imageModel })} fullWidth /></label>
                        <EcommerceImageSettings config={config} model={studio.imageModel || config.imageModel || config.model} brief={brief} disabled={locked} onChange={patchBrief} />
                    </details>
                    <section id={`studio-${node.id}-brief`} className="ecommerce-studio-section" hidden={section !== "brief"}>
                        <p className="ecommerce-studio-inputs">连接商品或实拍，写下这套图的用途。</p>
                        <label>
                            商品名称
                            <Input value={brief.name} maxLength={100} onChange={(event) => patchBrief({ name: event.target.value })} />
                        </label>
                        <label>
                            画面要求
                            <Input.TextArea rows={3} maxLength={6000} value={brief.direction} onChange={(event) => patchBrief({ direction: event.target.value })} placeholder="例如：淘宝夏季上新，突出透气面料，干净的自然光场景" />
                        </label>
                        <div className="ecommerce-studio-grid ecommerce-studio-essentials">
                            <label>
                                发布平台
                                <EcommerceChoiceInput label="平台" disabled={locked} choices={ECOMMERCE_BRIEF_CHOICES.platform} value={brief.platform} onChange={(platform) => patchBrief({ platform })} />
                            </label>
                            <label>
                                生成张数
                                <InputNumber aria-label="生图台计划张数" min={Math.max(1, new Set(brief.imageTypes).size)} max={30} value={brief.count} onChange={(value) => patchBrief({ count: value || 1 })} />
                            </label>
                        </div>
                        <details>
                            <summary>商品事实与发布要求</summary>
                            <label>
                                已核实事实
                                <Input.TextArea rows={3} maxLength={12000} value={brief.facts} onChange={(event) => patchBrief({ facts: event.target.value })} />
                            </label>
                            <label>
                                禁止项
                                <Input.TextArea rows={2} maxLength={6000} value={brief.forbidden} onChange={(event) => patchBrief({ forbidden: event.target.value })} />
                            </label>
                            <div className="ecommerce-studio-grid">
                                {(["market", "language"] as const).map((key, i) => (
                                    <label key={key}>
                                        {["市场", "语言"][i]}
                                        <EcommerceChoiceInput label={["市场", "语言"][i]} disabled={locked} choices={ECOMMERCE_BRIEF_CHOICES[key]} value={brief[key]} onChange={(value) => patchBrief({ [key]: value })} />
                                    </label>
                                ))}
                            </div>
                        </details>
                        <details>
                            <summary>品牌与商品保护</summary>
                            <label>
                                品牌视觉要求
                                <Input.TextArea rows={2} maxLength={6000} value={brief.brand || ""} onChange={(event) => patchBrief({ brand: event.target.value })} placeholder="色板、字体、禁用元素；品牌要求不作为商品事实" />
                            </label>
                            <label>
                                生成模式
                                <Select
                                    aria-label="商品生成模式"
                                    value={brief.generationMode || "standard"}
                                    options={[
                                        { value: "standard", label: "标准生成" },
                                        { value: "product-protected", label: "商品保护 · 强化实拍约束" },
                                    ]}
                                    onChange={(generationMode) => patchBrief({ generationMode })}
                                />
                            </label>
                            <p>商品保护要求连接实拍并保留全部实拍参考；它是模型约束，不保证逐像素不变。</p>
                            <Checkbox checked={Boolean(brief.reviewRequired)} onChange={(event) => patchBrief({ reviewRequired: event.target.checked })}>
                                生成前审核方案，导出前审核采用结果
                            </Checkbox>
                        </details>
                        <details>
                            <summary>常用画面要求</summary>
                            <div className="ecommerce-studio-actions" aria-label="常用画面要求">
                                {ECOMMERCE_BRIEF_CHOICES.direction.map((value) => (
                                    <Button size="small" key={value} disabled={locked} onClick={() => patchBrief({ direction: [brief.direction, value].filter(Boolean).join("；").slice(0, 6000) })}>
                                        {value}
                                    </Button>
                                ))}
                            </div>
                        </details>
                        <details>
                            <summary>模型与分析技能</summary>
                            <div className="ecommerce-studio-grid">
                                <label>
                                    分析模型
                                    <ModelPicker config={config} capability="text" value={studio.textModel || config.model} onChange={(textModel) => patch({ textModel })} fullWidth />
                                </label>
                            </div>
                            <label>
                                分析 Skills（可选）
                                <SkillRuntimePicker
                                    skills={skills.skills}
                                    loading={skills.loading}
                                    value={studio.skillIds || []}
                                    onChange={(skillIds) => {
                                        if (!locked) patch({ skillIds });
                                    }}
                                    ariaLabel="生图台分析技能"
                                />
                            </label>
                            {skills.error ? <p role="alert">{skills.error}</p> : null}
                        </details>
                        <details>
                            <summary>套图模板{brief.template ? ` · ${brief.template.name}` : " · 可选"}</summary>
                            {brief.template ? (
                                <div className="ecommerce-studio-template">
                                    <span>
                                        {brief.template.name} · {brief.template.shots.length} 张参考画面
                                    </span>
                                    <Button size="small" disabled={locked} onClick={() => patchBrief({ template: undefined })}>
                                        取消模板
                                    </Button>
                                </div>
                            ) : null}
                            {section === "brief" ? <EcommerceSavedTemplatePicker disabled={locked} onApply={(template) => patchBrief({ template, count: template.shots.length })} /> : null}
                            {section === "brief" ? (
                                <EcommerceTemplateCatalogDetails
                                    title="选择内置套图模板"
                                    disabled={locked}
                                    onApply={(template) => {
                                        if (!locked) patchBrief({ template, count: template.shots.length });
                                    }}
                                />
                            ) : null}
                        </details>
                        <details>
                            <summary>需要哪些画面 · 已选 {brief.imageTypes.length} 类</summary>
                            <Checkbox.Group options={ECOMMERCE_IMAGE_TYPES.map(([, label]) => label)} value={brief.imageTypes} onChange={(values) => patchBrief({ imageTypes: values.map(String) })} />
                            <p>每个已选图型至少一张，剩余张数按商品需求分配。新增图型超过总张数时会同步增加张数。</p>
                        </details>
                        <div className="ecommerce-studio-actions">
                            <Button
                                onClick={() => {
                                    patch({ plan: { name: brief.name, style: plan?.style || "", shots: [...(plan?.shots || []), { title: "新画面", duty: "", prompt: "" }] } });
                                    setSection("plan");
                                }}
                                disabled={locked || (plan?.shots.length || 0) >= 30}
                            >
                                手动添加画面
                            </Button>
                        </div>
                    </section>
                    <section id={`studio-${node.id}-plan`} className="ecommerce-studio-section" hidden={section !== "plan"}>
                        {plan ? (
                            <>
                                <div className="ecommerce-studio-actions">
                                    <Button disabled={locked || plan.shots.length >= 30} onClick={() => patch({ plan: { ...plan, shots: [...plan.shots, { title: "新画面", duty: "", prompt: "" }] } })}>
                                        添加画面
                                    </Button>
                                    <Button disabled={locked || !plan.shots.length} onClick={() => void run("save-template")}>
                                        保存到我的模板
                                    </Button>
                                </div>
                                <label>
                                    整套视觉规范
                                    <Input.TextArea rows={2} maxLength={6000} value={plan.style} onChange={(event) => patch({ plan: { ...plan, style: event.target.value } })} />
                                </label>
                                <p className="ecommerce-studio-inputs">填写画面名称、职责和完整提示词后可出图。分析指令使用后台配置的默认规则。</p>
                                {brief.reviewRequired ? (
                                    <Button disabled={locked} onClick={() => void run("review-plan")}>
                                        确认当前方案{studio.planReview ? " · 已有审核记录，改动后须重审" : ""}
                                    </Button>
                                ) : null}
                                <div className="ecommerce-studio-shots">
                                    {plan.shots.map((shot, index) => (
                                        <details key={index}>
                                            <summary>
                                                <span>
                                                    {String(index + 1).padStart(2, "0")} · {shot.title || "未命名画面"}
                                                </span>
                                                <span className="ecommerce-studio-shot-state">{!shotReady(shot) ? "待补充" : ecommerceStudioShotResults(node, results, index).length ? "已有结果" : "待生成"}</span>
                                            </summary>
                                            <label>
                                                画面名称
                                                <Input maxLength={100} value={shot.title} onChange={(event) => editShot(index, { title: event.target.value })} />
                                            </label>
                                            <label>
                                                画面职责
                                                <Input.TextArea maxLength={12000} rows={2} value={shot.duty} onChange={(event) => editShot(index, { duty: event.target.value })} placeholder="这一张展示什么、解决什么问题" />
                                            </label>
                                            <label>
                                                生图提示词
                                                <Input.TextArea rows={4} maxLength={20000} value={shot.prompt || ""} onChange={(event) => editShot(index, { prompt: event.target.value })} />
                                            </label>
                                            <div className="ecommerce-studio-actions">
                                                <Button disabled={locked || !brief.name.trim() || !hasInput || !shotReady(shot)} onClick={() => void run("studio-generate", [index])}>
                                                    生成这一张
                                                </Button>
                                                <Button disabled={locked} onClick={() => patch({ plan: { ...plan, shots: plan.shots.filter((_, i) => i !== index) }, adoptedResults: {} })}>
                                                    移除画面
                                                </Button>
                                            </div>
                                        </details>
                                    ))}
                                </div>
                                {unfinished.length > 0 && unfinished.length < plan.shots.length ? (
                                    <Button disabled={locked || !hasInput || unfinished.some((index) => !shotReady(plan.shots[index]))} onClick={() => void run("studio-generate", unfinished)}>
                                        生成未完成画面 · {unfinished.length} 张
                                    </Button>
                                ) : null}
                            </>
                        ) : (
                            <div className="ecommerce-studio-empty">
                                <strong>先为商品安排画面</strong>
                                <p>填写商品信息并规划，或手动添加画面。方案将在这里逐张展示。</p>
                                <Button
                                    disabled={locked}
                                    onClick={() => {
                                        patch({ plan: { name: brief.name, style: "", shots: [{ title: "新画面", duty: "", prompt: "" }] } });
                                    }}
                                >
                                    手动添加第一张
                                </Button>
                                <Button onClick={() => setSection("brief")}>填写商品信息</Button>
                            </div>
                        )}
                    </section>
                    <section id={`studio-${node.id}-results`} className="ecommerce-studio-section" hidden={section !== "results"}>
                        {availableResults.length ? (
                            <div className="ecommerce-studio-candidates">
                                <div className="ecommerce-studio-execution-heading"><strong>挑选生成结果 · {selectedImages.length} / {availableResults.length}</strong><Checkbox disabled={locked} checked={selectedImages.length === availableResults.length} indeterminate={selectedImages.length > 0 && selectedImages.length < availableResults.length} onChange={(event) => setSelectedResults(event.target.checked ? availableResults.map((item) => item.id) : [])}>全选</Checkbox></div>
                                <p>勾选需要的图片后再添加到画布。点击图片可放大查看，未选图片会保留在这里。</p>
                                <div className="ecommerce-studio-candidate-grid">
                                    {availableResults.map((result) => <article key={result.id} className="ecommerce-studio-candidate" data-selected={selectedImages.includes(result.id)}>
                                        <button type="button" className="ecommerce-studio-preview" aria-label={`预览${result.title || "生成结果"}`} onClick={() => viewImage?.(result)}><CachedResourceImage storageKey={result.metadata?.storageKey} src={result.metadata?.content} variant="thumbnail" alt={result.title || "生成结果"} /></button>
                                        <Checkbox disabled={locked} checked={selectedImages.includes(result.id)} onChange={(event) => setSelectedResults((current) => event.target.checked ? [...current, result.id] : current.filter((id) => id !== result.id))}>{result.title || "生成结果"}</Checkbox>
                                        <span>{result.metadata?.ecommerceCandidate ? "待添加到画布" : "已在画布"}</span>
                                    </article>)}
                                </div>
                                <div className="ecommerce-studio-actions"><Button className="ecommerce-command" disabled={locked || !selectedImages.length} onClick={() => void run("studio-place-results")}>添加选中图片到画布 · {selectedImages.length}</Button><Button disabled={locked || !availableResults.some((item) => item.metadata?.ecommerceCandidate)} onClick={() => void run("studio-place-results", undefined, false, undefined, false, false, availableResults.map((item) => item.id))}>全部添加到画布 · {availableResults.length}</Button></div>
                                <details>
                                    <summary>长图排版</summary>
                                    <p>按下方顺序拼接已选图片，等比缩放、保留完整画面。</p>
                                    {selectedImages.map((id, index) => <div key={id} className="ecommerce-studio-compose-row"><span>{index + 1}. {availableResults.find((item) => item.id === id)?.title || "图片"}</span><Button size="small" disabled={locked || index === 0} onClick={() => setSelectedResults((current) => { const next = current.filter((value) => selectedImages.includes(value)); [next[index - 1], next[index]] = [next[index], next[index - 1]]; return next; })}>上移</Button><Button size="small" disabled={locked || index === selectedImages.length - 1} onClick={() => setSelectedResults((current) => { const next = current.filter((value) => selectedImages.includes(value)); [next[index], next[index + 1]] = [next[index + 1], next[index]]; return next; })}>下移</Button></div>)}
                                    <div className="ecommerce-studio-grid"><label>长图宽度（px）<InputNumber aria-label="长图宽度" min={320} max={2400} value={composeWidth} onChange={(value) => setComposeWidth(value || 800)} /></label><label>图片间距（px）<InputNumber aria-label="长图间距" min={0} max={200} value={composeGap} onChange={(value) => setComposeGap(value ?? 0)} /></label></div>
                                    <Button disabled={locked || !selectedImages.length} onClick={() => void run("studio-compose")}>合成所选图片为长图 · {selectedImages.length} 张</Button>
                                </details>
                            </div>
                        ) : null}
                        {plan?.shots.length ? (
                            <>
                                <p className="ecommerce-studio-inputs">按画面选择采用版本。方案改动后，旧图不会自动作为新方案结果。</p>
                                <div className="ecommerce-studio-results">
                                    {plan.shots.map((shot, index) => {
                                        const versions = ecommerceStudioShotResults(node, results, index);
                                        const selectedId = studio.adoptedResults?.[String(index)];
                                        const selected = selectedId ? versions.find((item) => item.id === selectedId) : versions.at(-1);
                                        return (
                                            <article key={index} className="ecommerce-studio-result">
                                                <button type="button" className="ecommerce-studio-preview" disabled={!selected} aria-label={`定位第 ${index + 1} 张结果`} onClick={() => selected && (selected.metadata?.ecommerceCandidate ? viewImage?.(selected) : focusNode?.(selected.id))}>
                                                    {selected ? (
                                                        <CachedResourceImage
                                                            storageKey={selected.metadata?.storageKey}
                                                            src={selected.metadata?.content}
                                                            variant="thumbnail"
                                                            alt={shot.title || `画面 ${index + 1}`}
                                                            fallback={<span>图片暂不可用</span>}
                                                            loadingFallback={<span>读取图片…</span>}
                                                        />
                                                    ) : (
                                                        <span>{selectedId ? "采用版本已失效" : "尚无当前方案结果"}</span>
                                                    )}
                                                </button>
                                                <div>
                                                    <strong>
                                                        {index + 1}. {shot.title || "未命名画面"}
                                                    </strong>
                                                    <label>
                                                        采用版本
                                                        <Select
                                                            aria-label={`第 ${index + 1} 张采用结果`}
                                                            disabled={locked}
                                                            value={selectedId || ""}
                                                            options={ecommerceStudioResultOptions(node, results, index)}
                                                            onChange={(value) => patch({ adoptedResults: { ...studio.adoptedResults, [String(index)]: value } })}
                                                        />
                                                    </label>
                                                </div>
                                            </article>
                                        );
                                    })}
                                </div>
                                {brief.reviewRequired ? (
                                    <Button disabled={locked} onClick={() => void run("review-delivery")}>
                                        确认当前采用结果{studio.deliveryReview ? " · 已有审核记录，换图后须重审" : ""}
                                    </Button>
                                ) : null}
                            </>
                        ) : (
                            <div className="ecommerce-studio-empty">
                                <Images size={28} aria-hidden="true" />
                                <strong>图片结果会收在这里</strong>
                                <p>先填写商品信息并规划生成，再挑选每张图的采用版本。</p>
                                <Button onClick={() => setSection("brief")}>填写商品信息</Button>
                            </div>
                        )}
                        {results.length ? (
                            <details>
                                <summary>输出记录 · {results.length}</summary>
                                <div className="ecommerce-studio-actions">
                                    {results.map((result, index) => (
                                        <Button size="small" key={result.id} onClick={() => result.metadata?.ecommerceCandidate ? viewImage?.(result) : focusNode?.(result.id)}>
                                            结果 {index + 1}
                                            {result.metadata?.status === "error" ? " · 失败" : ""}
                                        </Button>
                                    ))}
                                </div>
                            </details>
                        ) : null}
                    </section>
                    <section id={`studio-${node.id}-tools`} className="ecommerce-studio-tools ecommerce-studio-section" aria-label="更多电商功能" hidden={section !== "tools"}>
                        <p className="ecommerce-studio-inputs">选择工具，在侧栏完成设置；结果会保留在画布中。</p>
                        {TOOL_GROUPS.map((group) => (
                            <div className="ecommerce-studio-tool-group" key={group.title}>
                                <h3>{group.title}</h3>
                                <div>
                                    {group.ids.map((id) => {
                                        const item = ECOMMERCE_CAPABILITIES.find((entry) => entry.id === id)!;
                                        const Icon = TOOL_ICONS[id];
                                        return (
                                            <button key={item.id} type="button" disabled={locked || !openEcommerceWorkbench} onClick={() => openEcommerceWorkbench?.(node, item.id)}>
                                                <Icon size={20} aria-hidden="true" />
                                                <span>
                                                    <strong>{item.name}</strong>
                                                    <span>{item.description}</span>
                                                </span>
                                                <ArrowUpRight size={15} aria-hidden="true" />
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
                    </section>
                </fieldset>
                {node.metadata?.ecommerceWorkbench?.steps.length ? (
                    <details className="ecommerce-studio-log" open={node.metadata.ecommerceWorkbench.steps.some((step) => step.status === "failed")}>
                        <summary>执行记录 · {running ? "执行中" : node.metadata.ecommerceWorkbench.steps.some((step) => step.status === "failed") ? "有步骤失败" : "已完成"}</summary>
                        {node.metadata?.ecommerceWorkbench?.steps.map((step) => (
                            <p key={step.id} role={step.error ? "alert" : undefined}>
                                {step.id} · {step.status === "running" ? "执行中" : step.status === "succeeded" ? "完成" : "失败"}
                                {step.error ? "：" + step.error : ""}
                            </p>
                        ))}
                        {!running && node.metadata?.ecommerceWorkbench?.request && node.metadata.ecommerceWorkbench.steps.some((step) => step.taskId) && node.metadata.ecommerceWorkbench.steps.some((step) => step.status !== "succeeded") ? (
                            <div className="ecommerce-studio-actions">
                                <Button disabled={locked} onClick={() => void run(node.metadata!.ecommerceWorkbench!.request!.action, undefined, false, node.id)}>
                                    {node.metadata.ecommerceWorkbench.inputSignature ? "恢复已有任务与后续步骤" : "读取已有规划结果"}
                                </Button>
                                {node.metadata.ecommerceWorkbench.inputSignature && node.metadata.ecommerceWorkbench.steps.some((step) => step.status === "failed") ? (
                                    <Button disabled={locked} onClick={() => void run(node.metadata!.ecommerceWorkbench!.request!.action, undefined, false, node.id, true)}>
                                        重试失败步骤并继续
                                    </Button>
                                ) : null}
                            </div>
                        ) : null}
                    </details>
                ) : null}
            </div>
            <footer className="ecommerce-studio-footer" aria-label="当前工作区操作">
                {running ? (
                    <Button block onClick={stopEcommerceWorkbench}>
                        停止当前操作
                    </Button>
                ) : (
                    <>
                        <p role="status">
                            {node.metadata?.locked
                                ? "节点已锁定，解锁后可编辑"
                                : section === "brief" || section === "plan"
                                  ? !brief.name.trim()
                                      ? "请填写商品名称"
                                      : !hasInput
                                        ? "连接商品或图片后可生成；也可先仅规划画面"
                                        : section === "plan" && plan?.shots.some((shot) => !shotReady(shot))
                                          ? "补齐画面名称、职责和提示词后可生成"
                                          : brief.reviewRequired
                                            ? "已开启审核，生成前需确认方案"
                                            : `本次生成将提交模型任务 · ${section === "plan" ? plan?.shots.length || 0 : brief.count} 张`
                                  : section === "results"
                                    ? exportIssue || "导出前请核对商品外观、文字和采用版本"
                                    : "全部电商工具均可在侧栏打开"}
                        </p>
                        <div className="ecommerce-studio-actions">
                            {section === "brief" ? (
                                <>
                                    <Button disabled={locked || !brief.name.trim()} onClick={() => void run("planning")}>
                                        仅规划画面
                                    </Button>
                                    <Button className="ecommerce-command" disabled={locked || !brief.name.trim() || !hasInput} onClick={() => void run("planning", undefined, true)}>
                                        规划并生成图片 · {brief.count} 张
                                    </Button>
                                </>
                            ) : null}
                            {section === "plan" ? (
                                <Button className="ecommerce-command" disabled={locked || !brief.name.trim() || !hasInput || !plan?.shots.length || plan.shots.some((shot) => !shotReady(shot))} onClick={() => void run("studio-generate")}>
                                    生成整组 · {plan?.shots.length || 0} 张
                                </Button>
                            ) : null}
                            {section === "results" ? (
                                <Button className="ecommerce-command" disabled={locked || Boolean(exportIssue)} onClick={() => void run("studio-export")}>
                                    导出采用结果与清单
                                </Button>
                            ) : null}
                        </div>
                    </>
                )}
            </footer>
        </div>
    );
}
