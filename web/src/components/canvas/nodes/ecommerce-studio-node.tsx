import { useState } from "react";
import { App, Button, Checkbox, Input, InputNumber, Select } from "antd";
import { useCanvasNodeActions } from "../canvas-node-action-context";
import { useNodeInputs, useDownstreamNodes } from "../canvas-node-graph-context";
import { EcommerceNodeTitle } from "./canvas-ecommerce-node-title";
import { ModelPicker } from "@/components/model-picker";
import { SkillRuntimePicker, useSkillRuntimeCatalog } from "@/components/skills/skill-runtime-picker";
import { EcommerceChoiceInput, ECOMMERCE_BRIEF_CHOICES } from "../ecommerce-choice-input";
import { ECOMMERCE_CAPABILITIES } from "@/lib/ecommerce/ecommerce-capabilities";
import { EcommerceTemplateCatalogDetails } from "../ecommerce-template-catalog";
import { EcommerceSavedTemplatePicker } from "../ecommerce-saved-template-picker";
import { ecommerceStudioResultOptions } from "@/lib/ecommerce/ecommerce-studio";
import { useEffectiveConfig } from "@/stores/use-config-store";
import { DEFAULT_ECOMMERCE_BRIEF, ECOMMERCE_IMAGE_TYPES, studioWorkbenchRequest, type EcommerceWorkbenchAction } from "@/lib/ecommerce/ecommerce-capabilities";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import type { CanvasTheme } from "@/lib/canvas-theme";
import "./ecommerce-studio-node.css";

export function EcommerceStudioNodeContent({ node, theme }: { node: CanvasNodeData; theme: CanvasTheme }) {
    const { updateMetadata, runEcommerceWorkbench, stopEcommerceWorkbench, isEcommerceWorkbenchRunning, openEcommerceWorkbench, focusNode } = useCanvasNodeActions();
    const { message } = App.useApp();
    const config = useEffectiveConfig();
    const skills = useSkillRuntimeCatalog();
    const upstream = useNodeInputs(node.id);
    const downstream = useDownstreamNodes(node.id);
    const [busy, setBusy] = useState(false);
    const [section, setSection] = useState<"brief" | "plan" | "tools">("brief");
    const studio = node.metadata?.ecommerceStudio || { brief: { ...structuredClone(DEFAULT_ECOMMERCE_BRIEF), name: node.title || "电商生图台" } };
    const { brief, plan } = studio;
    const running = busy || Boolean(isEcommerceWorkbenchRunning?.(node.id));
    const interrupted = !running && node.metadata?.ecommerceWorkbench?.steps.some((step) => step.status === "running");
    const locked = Boolean(node.metadata?.locked) || !updateMetadata || running;
    const patch = (value: Partial<typeof studio>) => {
        if (!locked) updateMetadata?.(node.id, { ecommerceStudio: { ...studio, ...value } });
    };
    const patchBrief = (value: Partial<typeof brief>) => patch({ brief: { ...brief, ...value } });
    const images = upstream.filter((item) => item.type === CanvasNodeType.Image);
    const hasProduct = upstream.some((item) => item.type === CanvasNodeType.Product);
    const hasInput = images.some((item) => Boolean(item.metadata?.storageKey || item.metadata?.content)) || hasProduct;
    const shotReady = (shot: NonNullable<typeof plan>["shots"][number]) => Boolean(shot.title.trim() && shot.duty.trim() && shot.prompt?.trim());
    const results = downstream.filter((item) => item.type === CanvasNodeType.Image);
    const run = async (action: EcommerceWorkbenchAction, shotIndices?: number[]) => {
        if (locked || !runEcommerceWorkbench) return;
        setBusy(true);
        try {
            const request = studioWorkbenchRequest(
                node.id,
                brief,
                upstream.map((item) => item.id),
                action,
            );
            await runEcommerceWorkbench({ ...request, textModel: studio.textModel || "", imageModel: studio.imageModel || "", shotIndices });
            if (action === "planning") setSection("plan");
            message.success(action === "studio-export" ? "套图原图与清单已导出" : action === "save-template" ? "已保存到我的模板" : action === "studio-generate" ? "图片已生成，结果连接在生图台右侧" : "方案已更新，请核对后出图");
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
        <div className="ecommerce-studio-node" style={{ color: theme.node.text, background: theme.node.fill }} data-canvas-no-zoom data-canvas-wheel-scroll onPointerDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
            <EcommerceNodeTitle node={node} fallback="电商生图台" subtitle="商品素材 → 画面方案 → 图片结果" />
            <div className="ecommerce-studio-status">
                <span>{images.length || hasProduct ? `已连接 ${images.length} 张图片${hasProduct ? " · 含商品档案" : ""}` : "待连接商品或图片"}</span>
                <span>{plan ? `${plan.shots.length} 个画面` : "尚未规划"}</span>
            </div>
            <nav className="ecommerce-studio-nav" aria-label="生图台工作区">
                {(
                    [
                        ["brief", "商品信息"],
                        ["plan", "画面方案"],
                        ["tools", "电商工具"],
                    ] as const
                ).map(([id, label]) => (
                    <button type="button" key={id} aria-pressed={section === id} aria-controls={`studio-${node.id}-${id}`} onClick={() => setSection(id)}>
                        {label}
                    </button>
                ))}
            </nav>
            {running ? <Button onClick={stopEcommerceWorkbench}>停止当前操作</Button> : interrupted ? <p role="status">上次执行已中断。可在任务中心查看已提交任务，核对后重新执行。</p> : null}
            <fieldset disabled={locked}>
                <section id={`studio-${node.id}-brief`} className="ecommerce-studio-section" hidden={section !== "brief"}>
                    <p className="ecommerce-studio-inputs">连接商品实拍，补充本次需求，再规划画面。商品档案与实拍会一同用于分析。</p>
                    <label>
                        商品名称
                        <Input value={brief.name} maxLength={100} onChange={(event) => patchBrief({ name: event.target.value })} />
                    </label>
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
                            {(["market", "platform", "language"] as const).map((key, i) => (
                                <label key={key}>
                                    {["市场", "平台", "语言"][i]}
                                    <EcommerceChoiceInput label={["市场", "平台", "语言"][i]} disabled={locked} choices={ECOMMERCE_BRIEF_CHOICES[key]} value={brief[key]} onChange={(value) => patchBrief({ [key]: value })} />
                                </label>
                            ))}
                        </div>
                    </details>
                    <label>
                        画面要求
                        <Input.TextArea rows={2} maxLength={6000} value={brief.direction} onChange={(event) => patchBrief({ direction: event.target.value })} placeholder="场景、风格、卖点与需要的画面" />
                    </label>
                    <div className="ecommerce-studio-actions" aria-label="常用画面要求">
                        {ECOMMERCE_BRIEF_CHOICES.direction.map((value) => (
                            <Button size="small" key={value} disabled={locked} onClick={() => patchBrief({ direction: [brief.direction, value].filter(Boolean).join("；").slice(0, 6000) })}>
                                {value}
                            </Button>
                        ))}
                    </div>
                    <details>
                        <summary>模型与分析技能</summary>
                        <div className="ecommerce-studio-grid">
                            <label>
                                分析模型
                                <ModelPicker config={config} capability="text" value={studio.textModel || config.model} onChange={(textModel) => patch({ textModel })} fullWidth />
                            </label>
                            <label>
                                图片模型
                                <ModelPicker config={config} capability="image" value={studio.imageModel || config.imageModel || config.model} onChange={(imageModel) => patch({ imageModel })} fullWidth />
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
                    <details>
                        <summary>图型与数量 · {brief.count} 张</summary>
                        <InputNumber aria-label="生图台计划张数" min={1} max={30} value={brief.count} onChange={(value) => patchBrief({ count: value || 1 })} />
                        <Checkbox.Group options={ECOMMERCE_IMAGE_TYPES.map(([, label]) => label)} value={brief.imageTypes} onChange={(values) => patchBrief({ imageTypes: values.map(String) })} />
                    </details>
                    <div className="ecommerce-studio-actions">
                        <Button className="ecommerce-command" disabled={locked || !brief.name.trim()} onClick={() => void run("planning")}>
                            规划画面
                        </Button>
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
                            <Button disabled={locked || plan.shots.length >= 30} onClick={() => patch({ plan: { ...plan, shots: [...plan.shots, { title: "新画面", duty: "", prompt: "" }] } })}>
                                添加画面
                            </Button>
                            <Button disabled={locked || !plan.shots.length} onClick={() => void run("save-template")}>
                                保存到我的模板
                            </Button>
                            <label>
                                整套视觉规范
                                <Input.TextArea rows={2} maxLength={6000} value={plan.style} onChange={(event) => patch({ plan: { ...plan, style: event.target.value } })} />
                            </label>
                            <p className="ecommerce-studio-inputs">填写画面名称、职责和完整提示词后可出图。分析指令使用后台配置的默认规则。</p>
                            <div className="ecommerce-studio-shots">
                                {plan.shots.map((shot, index) => (
                                    <details key={index}>
                                        <summary>
                                            {index + 1}. {shot.title || "未命名画面"}
                                            {shotReady(shot) ? "" : " · 待补充"}
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
                                        <label>
                                            采用结果
                                            <Select
                                                aria-label={`第 ${index + 1} 张采用结果`}
                                                disabled={locked}
                                                value={studio.adoptedResults?.[String(index)] || ""}
                                                options={ecommerceStudioResultOptions(node, results, index)}
                                                onChange={(value) => patch({ adoptedResults: { ...studio.adoptedResults, [String(index)]: value } })}
                                            />
                                        </label>
                                    </details>
                                ))}
                            </div>
                            <Button className="ecommerce-command" disabled={locked || !brief.name.trim() || !hasInput || !plan.shots.length || plan.shots.some((shot) => !shotReady(shot))} onClick={() => void run("studio-generate")}>
                                生成整组 · {plan.shots.length} 张
                            </Button>
                            <p className="ecommerce-studio-inputs">核对商品外观、文字和平台要求后，选择每张采用的版本。方案改变后需要重新生成，已选版本失效时不会自动替换。</p>
                            <Button disabled={locked || !plan.shots.length} onClick={() => void run("studio-export")}>
                                导出采用结果与清单
                            </Button>
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
                <section id={`studio-${node.id}-tools`} className="ecommerce-studio-tools ecommerce-studio-section" aria-label="更多电商功能" hidden={section !== "tools"}>
                    <h3>更多电商功能</h3>
                    <div>
                        {ECOMMERCE_CAPABILITIES.map((item) => (
                            <button key={item.id} type="button" disabled={locked || !openEcommerceWorkbench} onClick={() => openEcommerceWorkbench?.(node, item.id)}>
                                <strong>{item.name}</strong>
                                <span>{item.description}</span>
                            </button>
                        ))}
                    </div>
                </section>
            </fieldset>
            {node.metadata?.ecommerceWorkbench?.steps.map((step) => (
                <p key={step.id} role={step.error ? "alert" : undefined}>
                    {step.id} · {step.status === "running" ? "执行中" : step.status === "succeeded" ? "完成" : "失败"}
                    {step.error ? "：" + step.error : ""}
                </p>
            ))}
            {results.length ? (
                <div className="ecommerce-studio-actions">
                    {results.map((result, index) => (
                        <Button size="small" key={result.id} onClick={() => focusNode?.(result.id)}>
                            结果 {index + 1}
                            {result.metadata?.status === "error" ? " · 失败" : ""}
                        </Button>
                    ))}
                </div>
            ) : null}
        </div>
    );
}
