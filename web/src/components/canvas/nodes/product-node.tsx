import { App } from "antd";
import { ArrowUpRight, Image as ImageIcon, Plus, Replace, Unplug, UserRound, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useCanvasNodeActions } from "@/components/canvas/canvas-node-action-context";
import { useNodeConnections, useNodeInputs } from "@/components/canvas/canvas-node-graph-context";
import { CanvasEcommerceModelLibraryModal } from "@/components/canvas/canvas-ecommerce-model-library";
import { EcommerceNodeTitle } from "./canvas-ecommerce-node-title";
import { createEcommerceProductProfile, ecommerceCopySourceIssues, ECOMMERCE_PRODUCT_VIEWS, normalizeEcommerceProductName, type EcommerceProductProfile } from "@/lib/ecommerce/ecommerce-contract";
import type { EcommerceProductProfileDraft } from "@/lib/ecommerce/ecommerce-draft";
import { connectedStyleReferenceNodes, ecommerceProductReferenceSignature, effectiveProductViews } from "@/lib/ecommerce/ecommerce-canvas";
import { ECOMMERCE_ONE_CLICK_FLOWS } from "@/lib/ecommerce/ecommerce-oneclick";
import { stopCanvasDragFromInteractive } from "@/lib/canvas/node-interaction";
import { ecommerceModelById, ecommerceModelRefCount } from "@/lib/ecommerce/ecommerce-models";
import { useEcommerceModelLibrary } from "@/stores/use-ecommerce-model-library";
import { useEcommerceSettings } from "@/stores/use-ecommerce-settings";
import { ecommerceCapabilitySettings } from "@/services/api/ecommerce";
import { resolveImageUrl } from "@/services/image-storage";
import type { CanvasTheme } from "@/lib/canvas-theme";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import "./canvas-ecommerce-node-card.css";

type ProductProfileDraftField =
    | "name"
    | "englishBrandName"
    | "chineseBrandName"
    | "logoText"
    | "brandStyle"
    | "category"
    | "productModel"
    | "appearance"
    | "functions"
    | "marks"
    | "forbidden"
    | "parameters"
    | "sellingPoints"
    | "audience"
    | "painPoints"
    | "purchaseReasons"
    | "facts"
    | "detailPageSuggestions"
    | "price";

type ProductProfileDraft = Record<ProductProfileDraftField, string> & { unsure?: string; issues?: string[]; evidenceSignature: string };

const PRODUCT_PROFILE_DRAFT_FIELDS: { key: ProductProfileDraftField; label: string; ariaLabel?: string; rows?: number }[] = [
    { key: "name", label: "产品名称" },
    { key: "englishBrandName", label: "英文品牌名" },
    { key: "chineseBrandName", label: "中文品牌名" },
    { key: "logoText", label: "LOGO 文字", ariaLabel: "草稿 LOGO 文字", rows: 2 },
    { key: "brandStyle", label: "品牌风格（字体、图标、配色、材质感）", ariaLabel: "草稿品牌风格", rows: 2 },
    { key: "category", label: "品类" },
    { key: "productModel", label: "产品型号" },
    { key: "appearance", label: "外观", rows: 2 },
    { key: "functions", label: "主要功能", rows: 2 },
    { key: "marks", label: "其他标识", ariaLabel: "草稿标识", rows: 2 },
    { key: "forbidden", label: "禁止项", rows: 2 },
    { key: "parameters", label: "参数与来源（参数 | 数值 | 来源）", ariaLabel: "草稿参数与来源", rows: 3 },
    { key: "sellingPoints", label: "五类卖点（类型 | 内容 | 可视化建议）", ariaLabel: "草稿五类卖点", rows: 5 },
    { key: "audience", label: "目标人群与场景（建议）", ariaLabel: "草稿目标人群与场景", rows: 2 },
    { key: "painPoints", label: "使用痛点", rows: 2 },
    { key: "purchaseReasons", label: "购买理由", rows: 2 },
    { key: "facts", label: "卖点与依据（可见事实）", ariaLabel: "草稿卖点与依据", rows: 2 },
    { key: "detailPageSuggestions", label: "逐屏建议（屏数 | 主题 | 画面 | 文案）", ariaLabel: "草稿逐屏建议", rows: 5 },
    { key: "price", label: "真实价格（手动填写）", ariaLabel: "草稿真实价格" },
];

const profileRows = (rows: string[][]) => rows.map((row) => row.join(" | ")).join("\n");
const splitProfileRows = (value: string) => value.split(/\r?\n/).map((line) => line.split(/[|｜]/).map((part) => part.trim())).filter((row) => row.some(Boolean));
const formatParameters = (profile: EcommerceProductProfile) => profileRows((profile.parameters || []).map((item) => [item.name, item.value, item.source]));
const formatSellingPoints = (profile: EcommerceProductProfile) => profileRows((profile.sellingPoints || []).map((item) => [item.type, item.content, item.visualization]));
const formatDetailPageSuggestions = (profile: EcommerceProductProfile) => profileRows((profile.detailPageSuggestions || []).map((item) => [item.screen, item.theme, item.visual, item.copy]));
const parseParameters = (value: string) => splitProfileRows(value).map(([name = "", parameterValue = "", ...source]) => ({ name, value: parameterValue, source: source.join(" | ") })).filter((item) => item.name);
const parseSellingPoints = (value: string): NonNullable<EcommerceProductProfile["sellingPoints"]> => splitProfileRows(value).map(([type = "", content = "", ...visualization]) => ({ type: type as NonNullable<EcommerceProductProfile["sellingPoints"]>[number]["type"], content, visualization: visualization.join(" | ") })).filter((item) => item.type);
const parseDetailPageSuggestions = (value: string) => splitProfileRows(value).map(([screen = "", theme = "", visual = "", ...copy]) => ({ screen, theme, visual, copy: copy.join(" | ") })).filter((item) => item.screen);

export function ProductNodeContent({ node, theme }: { node: CanvasNodeData; theme: CanvasTheme }) {
    const actions = useCanvasNodeActions();
    const setting = useEcommerceSettings((state) => state.setting);
    const { updateMetadata, upload, updateEcommerceInputAnchor } = actions;
    const inputs = useNodeInputs(node.id);
    const connections = useNodeConnections(node.id);
    const { message } = App.useApp();
    const [modelPickerOpen, setModelPickerOpen] = useState(false);
    const [profileDraft, setProfileDraft] = useState<ProductProfileDraft>();
    const [identifying, setIdentifying] = useState(false);
    const cardRef = useRef<HTMLDivElement>(null);
    const inputAnchorsRef = useRef(new Map<string, { y: number; x: number }>());
    const models = useEcommerceModelLibrary((state) => state.models);
    const hydrateModels = useEcommerceModelLibrary((state) => state.hydrate);
    const touchModel = useEcommerceModelLibrary((state) => state.touchModel);
    useEffect(() => {
        void hydrateModels().catch((error) => message.error(error instanceof Error ? error.message : "加载失败"));
    }, [hydrateModels, message]);

    const profile = node.metadata?.productProfile || createEcommerceProductProfile(node.title || "商品");
    const evidenceSignature = useMemo(() => ecommerceProductReferenceSignature(node, inputs, connections), [node, inputs, connections]);
    const evidenceSignatureRef = useRef(evidenceSignature);
    const profileRef = useRef(profile);
    evidenceSignatureRef.current = evidenceSignature;
    profileRef.current = profile;
    const views = effectiveProductViews(profile, inputs, connections, node.id);
    const inputById = new Map(inputs.map((item) => [item.id, item]));
    const referenceIds = new Set(connectedStyleReferenceNodes(node.id, inputs, connections).map((item) => item.id));
    connections.filter((edge) => edge.toNodeId === node.id && edge.toHandleId?.startsWith("visual-reference:")).forEach((edge) => referenceIds.add(edge.fromNodeId));
    const references = inputs.filter((item) => referenceIds.has(item.id));
    const productImages = inputs.filter((item) => item.type === CanvasNodeType.Image && !referenceIds.has(item.id) && (item.metadata?.content || item.metadata?.storageKey));
    const editable = Boolean(updateMetadata);
    const model = ecommerceModelById(node.metadata?.ecommerceModelId, models);
    const profileSummary = [profile.category, profile.appearance]
        .map((value) => value.trim())
        .filter(Boolean)
        .join(" · ");
    const editProductProfile = (issues?: string[]) => {
        const currentProfile = profileRef.current;
        setProfileDraft({
            name: normalizeEcommerceProductName(currentProfile.name),
            englishBrandName: currentProfile.englishBrandName ?? "",
            chineseBrandName: currentProfile.chineseBrandName ?? "",
            logoText: currentProfile.logoText ?? "",
            brandStyle: currentProfile.brandStyle ?? "",
            category: currentProfile.category ?? "",
            productModel: currentProfile.productModel ?? "",
            appearance: currentProfile.appearance ?? "",
            functions: currentProfile.functions ?? "",
            marks: currentProfile.marks ?? "",
            forbidden: currentProfile.forbidden ?? "",
            parameters: formatParameters(currentProfile),
            sellingPoints: formatSellingPoints(currentProfile),
            audience: currentProfile.audience ?? "",
            painPoints: currentProfile.painPoints ?? "",
            purchaseReasons: currentProfile.purchaseReasons ?? "",
            facts: currentProfile.facts ?? "",
            detailPageSuggestions: formatDetailPageSuggestions(currentProfile),
            price: currentProfile.price ?? "",
            issues,
            evidenceSignature: evidenceSignatureRef.current,
        });
    };
    const openSuite = (flow: (typeof ECOMMERCE_ONE_CLICK_FLOWS)[number]["id"]) => {
        if (!setting.enabled || !setting.flows[flow].enabled) {
            message.warning("管理员已停用此创作用途");
            return;
        }
        const issues = ["main", "detail", "seed"].includes(flow) ? ecommerceCopySourceIssues(profile) : [];
        if (["main", "detail", "seed", "wear"].includes(flow) && !productImages.length) issues.push("商品视觉证据");
        if (issues.length) {
            editProductProfile(issues);
            message.warning(`请先补充商品资料：${issues.join("、")}`);
            return;
        }
        actions.openEcommerceTable?.(node, flow);
    };
    const identifyProduct = async () => {
        if (identifying || !actions.draftEcommerceProfile) return;
        setProfileDraft(undefined);
        setIdentifying(true);
        const requestedEvidence = evidenceSignatureRef.current;
        try {
            const draft = (await actions.draftEcommerceProfile(node)) as EcommerceProductProfileDraft | undefined;
            if (!draft) return;
            if (requestedEvidence !== evidenceSignatureRef.current) {
                message.warning("商品图片已变化，请重新识别");
                return;
            }
            const currentProfile = profileRef.current;
            const recognized = (value: string | undefined, current: string) => (value?.trim() ? value : current);
            setProfileDraft({
                name: normalizeEcommerceProductName(draft.name) || normalizeEcommerceProductName(currentProfile.name),
                englishBrandName: recognized(draft.englishBrandName, currentProfile.englishBrandName ?? ""),
                chineseBrandName: recognized(draft.chineseBrandName, currentProfile.chineseBrandName ?? ""),
                logoText: recognized(draft.logoText, currentProfile.logoText ?? ""),
                brandStyle: recognized(draft.brandStyle, currentProfile.brandStyle ?? ""),
                category: recognized(draft.category, currentProfile.category),
                productModel: recognized(draft.productModel, currentProfile.productModel ?? ""),
                appearance: recognized(draft.appearance, currentProfile.appearance),
                functions: recognized(draft.functions, currentProfile.functions ?? ""),
                marks: recognized(draft.marks, currentProfile.marks),
                forbidden: recognized(draft.forbidden, currentProfile.forbidden),
                parameters: draft.parameters?.length ? profileRows(draft.parameters.map((item) => [item.name, item.value, item.source])) : formatParameters(currentProfile),
                sellingPoints: draft.sellingPoints?.length ? profileRows(draft.sellingPoints.map((item) => [item.type, item.content, item.visualization])) : formatSellingPoints(currentProfile),
                audience: recognized(draft.audience, currentProfile.audience),
                painPoints: recognized(draft.painPoints, currentProfile.painPoints ?? ""),
                purchaseReasons: recognized(draft.purchaseReasons, currentProfile.purchaseReasons ?? ""),
                facts: recognized(draft.facts, currentProfile.facts),
                detailPageSuggestions: draft.detailPageSuggestions?.length
                    ? profileRows(draft.detailPageSuggestions.map((item) => [item.screen, item.theme, item.visual, item.copy]))
                    : formatDetailPageSuggestions(currentProfile),
                price: currentProfile.price,
                unsure: draft.unsure ?? "",
                evidenceSignature: requestedEvidence,
            });
        } catch (error) {
            message.error(error instanceof Error ? error.message : "商品识别失败");
        } finally {
            setIdentifying(false);
        }
    };
    const confirmProfileDraft = () => {
        if (!profileDraft || !updateMetadata) return;
        if (profileDraft.evidenceSignature !== evidenceSignatureRef.current) {
            setProfileDraft(undefined);
            message.warning("商品图片已变化，请重新识别");
            return;
        }
        const currentProfile = profileRef.current;
        updateMetadata(node.id, {
            productProfile: {
                ...currentProfile,
                name: normalizeEcommerceProductName(profileDraft.name),
                englishBrandName: profileDraft.englishBrandName.trim(),
                chineseBrandName: profileDraft.chineseBrandName.trim(),
                logoText: profileDraft.logoText.trim(),
                brandStyle: profileDraft.brandStyle.trim(),
                category: profileDraft.category.trim(),
                productModel: profileDraft.productModel.trim(),
                appearance: profileDraft.appearance.trim(),
                functions: profileDraft.functions.trim(),
                marks: profileDraft.marks.trim(),
                forbidden: profileDraft.forbidden.trim(),
                parameters: parseParameters(profileDraft.parameters),
                sellingPoints: parseSellingPoints(profileDraft.sellingPoints),
                audience: profileDraft.audience.trim(),
                painPoints: profileDraft.painPoints.trim(),
                purchaseReasons: profileDraft.purchaseReasons.trim(),
                facts: profileDraft.facts.trim(),
                detailPageSuggestions: parseDetailPageSuggestions(profileDraft.detailPageSuggestions),
                price: profileDraft.price.trim(),
            },
        });
        setProfileDraft(undefined);
    };

    const updateProfileDraft = (key: ProductProfileDraftField, value: string) => setProfileDraft((current) => (current ? { ...current, [key]: value } : current));
    const addInput = (handle: string) => actions.addEcommerceInput?.(node, handle);
    const referenceEdges = connections.filter((edge) => edge.toNodeId === node.id && referenceIds.has(edge.fromNodeId));
    const referenceHandles = new Set(connections.filter((edge) => edge.toNodeId === node.id).map((edge) => edge.toHandleId));
    const referenceSlots = references.map((image) => {
        const edge = referenceEdges.find((item) => item.fromNodeId === image.id && item.toHandleId?.startsWith("visual-reference:"));
        let handle = edge?.toHandleId;
        if (!handle) {
            let index = 0;
            while (referenceHandles.has(`visual-reference:${index}`)) index += 1;
            handle = `visual-reference:${index}`;
            referenceHandles.add(handle);
        }
        return { image, handle };
    });
    let nextReference = 0;
    while (referenceHandles.has(`visual-reference:${nextReference}`)) nextReference += 1;
    const anchorLayout = [...ECOMMERCE_PRODUCT_VIEWS.map((view) => `product-view:${view.id}`), ...referenceSlots.map(({ handle, image }) => `${handle}:${image.id}`), `visual-reference:${nextReference}`].join("|");
    useEffect(() => {
        const card = cardRef.current;
        const wrapper = card?.closest<HTMLElement>("[data-node-id]");
        if (!editable || !updateEcommerceInputAnchor || !card || !wrapper) return;
        const slots = [...card.querySelectorAll<HTMLElement>("[data-ecommerce-input]")];
        let frame = 0;
        const measure = () => {
            frame = 0;
            const nodeRect = wrapper.getBoundingClientRect();
            if (!nodeRect.width || !nodeRect.height) return;
            const activeHandles = new Set<string>();
            for (const slot of slots) {
                const handle = slot.dataset.ecommerceInput;
                const pin = slot.querySelector<HTMLElement>(".ecom-input-pin");
                if (!handle || !pin) continue;
                activeHandles.add(handle);
                const pinRect = pin.getBoundingClientRect();
                if (!pinRect.width || !pinRect.height || pin.checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true }) === false) continue;
                const y = Math.min(1, Math.max(0, (pinRect.top + pinRect.height / 2 - nodeRect.top) / nodeRect.height));
                const x = Math.min(1, Math.max(0, (pinRect.left + pinRect.width / 2 - nodeRect.left) / nodeRect.width));
                const previous = inputAnchorsRef.current.get(handle);
                if (previous && Math.abs(previous.y - y) < 0.0001 && Math.abs(previous.x - x) < 0.0001) continue;
                inputAnchorsRef.current.set(handle, { y, x });
                updateEcommerceInputAnchor(node.id, handle, y, x);
            }
            for (const handle of inputAnchorsRef.current.keys()) {
                if (!activeHandles.has(handle)) inputAnchorsRef.current.delete(handle);
            }
        };
        const schedule = () => {
            if (!frame) frame = requestAnimationFrame(measure);
        };
        const observer = new ResizeObserver(schedule);
        observer.observe(wrapper);
        for (const slot of slots) {
            observer.observe(slot);
            const pin = slot.querySelector<HTMLElement>(".ecom-input-pin");
            if (pin) observer.observe(pin);
        }
        wrapper.addEventListener("scroll", schedule, true);
        schedule();
        return () => {
            observer.disconnect();
            wrapper.removeEventListener("scroll", schedule, true);
            if (frame) cancelAnimationFrame(frame);
        };
    }, [anchorLayout, editable, node.id, updateEcommerceInputAnchor]);

    return (
        <div ref={cardRef} className="ecom-card ecom-product-card" data-canvas-no-zoom data-canvas-wheel-scroll style={{ color: theme.node.text }} onMouseDown={stopCanvasDragFromInteractive}>
            <header className="ecom-card-header">
                <EcommerceNodeTitle node={node} fallback="商品" />
                <span className="ecom-card-status">{productImages.length} 张商品图</span>
            </header>
            {node.metadata?.ecommerceOneClick && editable ? (
                <div className="ecom-input-section" role="status">
                    <p>{node.metadata.ecommerceOneClick.status === "failed" ? `自动装订失败：${node.metadata.ecommerceOneClick.error || "请重试"}` : "等待本轮图片完成后自动装订"}</p>
                    {node.metadata.ecommerceOneClick.status === "failed" ? (
                        <button type="button" className="ecom-action" onClick={() => updateMetadata?.(node.id, { ecommerceOneClick: { ...node.metadata!.ecommerceOneClick!, status: "running", error: undefined } })}>
                            重试装订（不重新生图）
                        </button>
                    ) : null}
                    <button type="button" className="ecom-action" onClick={() => updateMetadata?.(node.id, { ecommerceOneClick: undefined })}>
                        取消自动装订
                    </button>
                </div>
            ) : null}
            <ol className="ecom-product-guide" aria-label="快捷创作流程">
                <li className="ecom-product-step">
                    <div className="ecom-product-step-heading">
                        <span className="ecom-product-step-number">1</span>
                        <div>
                            <h4>商品素材</h4>
                            <p>先上传正面图，其他视角按需补充</p>
                        </div>
                    </div>
                    <div className="ecom-input-grid">
                        {ECOMMERCE_PRODUCT_VIEWS.map((view) => (
                            <ProductInputSlot key={view.id} product={node} handle={`product-view:${view.id}`} label={view.label} image={inputById.get(views[view.id] || "")} editable={editable} onAdd={() => addInput(`product-view:${view.id}`)} />
                        ))}
                    </div>
                    <details className="ecom-product-advanced">
                        <summary>
                            补充素材与模特 <span>{references.length ? `${references.length} 张参考图` : "可选"}</span>
                        </summary>
                        <div className="ecom-product-advanced-body">
                            <section className="ecom-input-section" aria-label="参考图">
                                <h4>
                                    参考图 <span>{references.length}</span>
                                </h4>
                                <div className="ecom-input-grid ecom-reference-grid">
                                    {referenceSlots.map(({ image, handle }, index) => {
                                        return <ProductInputSlot key={image.id} product={node} handle={handle} label={`参考 ${index + 1}`} image={image} editable={editable} onAdd={() => upload?.(image)} />;
                                    })}
                                    <ProductInputSlot product={node} handle={`visual-reference:${nextReference}`} label="添加参考" editable={editable} onAdd={() => addInput(`visual-reference:${nextReference}`)} />
                                </div>
                            </section>
                            <div className="ecom-product-model-row">
                                <button type="button" className="ecom-model-pick" disabled={!editable || !setting.modelLibraryEnabled} onClick={() => setModelPickerOpen(true)}>
                                    <UserRound className="size-4" />
                                    <span className="truncate">{model?.name || "选择模特"}</span>
                                    {model ? <span className="ecom-model-pick-hint">{ecommerceModelRefCount(model)} 张参考图</span> : null}
                                </button>
                                {node.metadata?.ecommerceModelId && editable ? (
                                    <button type="button" className="ecom-input-icon" title="取消模特" aria-label="取消模特" onClick={() => updateMetadata?.(node.id, { ecommerceModelId: undefined })}>
                                        <X className="size-4" />
                                    </button>
                                ) : null}
                            </div>
                        </div>
                    </details>
                </li>
                <li className="ecom-product-step">
                    <div className="ecom-product-step-heading">
                        <span className="ecom-product-step-number">2</span>
                        <div>
                            <h4>确认商品</h4>
                            <p>{profileSummary || "让 AI 从实拍中识别品类与外观"}</p>
                        </div>
                    </div>
                    <button
                        type="button"
                        className="ecom-product-identify"
                        aria-label="AI 识别商品信息"
                        disabled={!editable || !productImages.length || !actions.draftEcommerceProfile || identifying || Boolean(profileDraft)}
                        onClick={() => void identifyProduct()}
                    >
                        <span>{identifying ? "正在识别商品…" : "AI 识别商品信息"}</span>
                        <small role="status" aria-live="polite">
                            {identifying ? "正在分析图片，请稍候" : "生成待核对草稿"}
                        </small>
                    </button>
                    {node.metadata?.productProfile && editable ? (
                        <button type="button" className="ecom-action" aria-label="编辑商品信息" disabled={identifying} onClick={() => editProductProfile()}>
                            编辑商品信息
                        </button>
                    ) : null}
                    {profileDraft ? (
                        <section className="ecom-product-draft" aria-label="本次识别草稿，请核对后应用">
                            <p className="ecom-product-draft-note">
                                {profileDraft.issues?.length
                                    ? `当前用途还缺：${profileDraft.issues.join("、")}。请补充后确认应用。`
                                    : profileDraft.unsure
                                      ? "模型推测：" + profileDraft.unsure + "。未识别字段沿用已有值；价格沿用已有手填值。"
                                      : "未识别字段沿用已有值；价格沿用已有手填值。请核对后应用。"}
                            </p>
                            <div className="ecom-product-draft-grid">
                                {PRODUCT_PROFILE_DRAFT_FIELDS.map((field) => (
                                    <label className="ecom-field" key={field.key}>
                                        <span className="ecom-field-label">{field.label}</span>
                                        {field.rows ? (
                                            <textarea
                                                className="ecom-field-input"
                                                aria-label={field.ariaLabel ?? `草稿${field.label}`}
                                                rows={field.rows}
                                                value={profileDraft[field.key]}
                                                onChange={(event) => updateProfileDraft(field.key, event.target.value)}
                                            />
                                        ) : (
                                            <input
                                                className="ecom-field-input"
                                                aria-label={field.ariaLabel ?? `草稿${field.label}`}
                                                value={profileDraft[field.key]}
                                                onChange={(event) => updateProfileDraft(field.key, event.target.value)}
                                            />
                                        )}
                                    </label>
                                ))}
                            </div>
                            <div className="ecom-action-row ecom-product-draft-actions">
                                <button type="button" className="ecom-action" aria-label="放弃商品草稿" onClick={() => setProfileDraft(undefined)}>
                                    放弃草稿
                                </button>
                                <button type="button" className="ecom-action ecom-action-primary" aria-label="确认并应用商品草稿" onClick={confirmProfileDraft}>
                                    确认并应用
                                </button>
                            </div>
                        </section>
                    ) : null}
                </li>
                <li className="ecom-product-step">
                    <div className="ecom-product-step-heading">
                        <span className="ecom-product-step-number">3</span>
                        <div>
                            <h4>选择用途</h4>
                            <p>选择用途并进入创作表，完成生成与交付</p>
                        </div>
                    </div>
                    <div className="ecom-oneclick-row">
                        {ECOMMERCE_ONE_CLICK_FLOWS.map((flow) => {
                            const disabledByAdmin = !setting.enabled || !setting.flows[flow.id].enabled;
                            return (
                                <button key={flow.id} type="button" className="ecom-oneclick" disabled={!editable || disabledByAdmin || !actions.openEcommerceTable} onClick={() => openSuite(flow.id)}>
                                    <span className="ecom-oneclick-copy">
                                        <span className="ecom-oneclick-name">{flow.name.replace(/^一键/, "")}</span>
                                        <span className="ecom-oneclick-hint">{disabledByAdmin ? "管理员已停用此用途" : flow.hint}</span>
                                    </span>
                                    <ArrowUpRight className="size-3.5" aria-hidden="true" />
                                </button>
                            );
                        })}
                    </div>
                </li>
                {actions.openEcommerceStudio ? (
                    <li className="ecom-product-step">
                        <div className="ecom-product-step-heading">
                            <span className="ecom-product-step-number">4</span>
                            <div>
                                <h4>生成交付</h4>
                                <p>在创作表中确认提示词，再批量生成与交付</p>
                            </div>
                        </div>
                        <button type="button" className="ecom-oneclick ecom-studio-link" disabled={!editable || !setting.enabled || !ecommerceCapabilitySettings(setting).planning.enabled} onClick={() => actions.openEcommerceStudio?.(node)}>
                            <span className="ecom-oneclick-name">电商生图台</span>
                            <ArrowUpRight className="size-3.5" aria-hidden="true" />
                        </button>
                    </li>
                ) : null}
            </ol>
            <CanvasEcommerceModelLibraryModal
                open={modelPickerOpen}
                activeModelId={node.metadata?.ecommerceModelId}
                onClose={() => setModelPickerOpen(false)}
                onSelect={async (model) => {
                    await touchModel(model.id);
                    updateMetadata?.(node.id, { ecommerceModelId: model.id });
                }}
            />
        </div>
    );
}

function ProductInputSlot({ product, handle, label, image, editable, onAdd }: { product: CanvasNodeData; handle: string; label: string; image?: CanvasNodeData; editable: boolean; onAdd: () => void }) {
    const actions = useCanvasNodeActions();

    const content = image?.metadata?.content || "";
    const storageKey = image?.metadata?.storageKey;
    const imageKey = useMemo(() => [storageKey, content] as const, [storageKey, content]);
    const [resolved, setResolved] = useState({ key: imageKey, url: content });
    const src = resolved.key === imageKey ? resolved.url : content;
    const hasImage = Boolean(content || storageKey);
    useEffect(() => {
        let cancelled = false;
        if (storageKey) {
            void resolveImageUrl(storageKey, content)
                .then((url) => {
                    if (!cancelled) setResolved({ key: imageKey, url });
                })
                .catch(() => {
                    if (!cancelled) setResolved({ key: imageKey, url: "" });
                });
        }
        return () => {
            cancelled = true;
        };
    }, [content, imageKey, storageKey]);

    return (
        <div
            className="ecom-input-slot"
            data-filled={hasImage || undefined}
            data-ecommerce-input={editable ? handle : undefined}
            data-product-node-id={product.id}
            onPointerUp={(event) => {
                if (editable) actions.dropEcommerceInput?.(event, product.id, handle);
            }}
        >
            <button
                type="button"
                className="ecom-input-preview"
                title={hasImage ? `查看${label}` : `上传${label}`}
                aria-label={hasImage ? `查看${label}` : `上传${label}`}
                disabled={!hasImage && !editable}
                onClick={() => (image && hasImage ? actions.viewImage?.(image) : editable ? (image ? actions.upload?.(image) : onAdd()) : undefined)}
            >
                {src ? <img src={src} alt={label} draggable={false} loading="lazy" onError={() => setResolved({ key: imageKey, url: "" })} /> : <ImageIcon className="size-5" />}
            </button>
            <span className="ecom-input-label">{label}</span>
            {editable ? (
                <button
                    type="button"
                    className="ecom-input-pin"
                    title={`连接到${label}`}
                    aria-label={`连接到${label}`}
                    onPointerDown={(event) => {
                        if (event.button === 0) actions.connectEcommerceInput?.(event, product.id, handle);
                    }}
                    onClick={(event) => {
                        if (event.detail === 0) actions.connectEcommerceInput?.(event as unknown as React.PointerEvent, product.id, handle);
                    }}
                >
                    <Plus className="size-3" />
                </button>
            ) : null}
            <div className="ecom-input-tools">
                {image && editable ? (
                    <>
                        <button type="button" className="ecom-input-icon" title="替换图片" aria-label={`替换${label}`} onClick={() => actions.upload?.(image)}>
                            <Replace className="size-3" />
                        </button>
                        <button type="button" className="ecom-input-icon" title="断开连接" aria-label={`断开${label}`} onClick={() => actions.disconnectEcommerceInput?.(product.id, handle, image.id)}>
                            <Unplug className="size-3" />
                        </button>
                    </>
                ) : null}
            </div>
        </div>
    );
}
