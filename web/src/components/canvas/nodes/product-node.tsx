import { App } from "antd";
import { ChevronDown, Image as ImageIcon, Layers, Package, Sparkles, UserRound } from "lucide-react";
import { useEffect, useState } from "react";

import { useCanvasNodeActions } from "@/components/canvas/canvas-node-action-context";
import { useDownstreamNodes, useUpstreamNodes } from "@/components/canvas/canvas-node-graph-context";
import { CanvasEcommerceModelLibraryModal } from "@/components/canvas/canvas-ecommerce-model-library";
import { CanvasEcommerceSuitePanel } from "@/components/canvas/canvas-ecommerce-suite-panel";
import { CanvasEcommerceUniformDialog, type EcommerceUniformValue } from "@/components/canvas/canvas-ecommerce-uniform-dialog";
import { useSkillRuntimeCatalog } from "@/components/skills/skill-runtime-picker";
import { EcommerceNodeTitle } from "./canvas-ecommerce-node-title";
import {
    createEcommerceProductProfile,
    createEcommerceStyle,
    ecommerceCopySourceIssues,
    ECOMMERCE_PRODUCT_VIEWS,
    type EcommerceProductProfile,
    type EcommerceProductView,
} from "@/lib/ecommerce/ecommerce-contract";
import { effectiveProductViews } from "@/lib/ecommerce/ecommerce-canvas";
import {
    ECOMMERCE_ONE_CLICK_FLOWS,
    ecommerceOneClickFlow,
    ecommerceOneClickScreens,
    type EcommerceOneClickFlow,
} from "@/lib/ecommerce/ecommerce-oneclick";
import { ecommerceSuiteFromPresets, ecommerceSuiteMissing, ecommerceSuiteMoveRow, ecommerceSuiteRowId, ecommerceSuiteRows, ecommerceSuiteSkeleton, type EcommerceSuite, type EcommerceSuiteRow } from "@/lib/ecommerce/ecommerce-suite";
import { createEcommerceLayoutFromPreset } from "@/lib/ecommerce/ecommerce-layout";
import { stopCanvasDragFromInteractive } from "@/lib/canvas/node-interaction";
import { ECOMMERCE_STYLE_PRESETS, createEcommerceStyleFromPreset, ecommerceTypographyPreset, ecommerceTypographyPresetFor } from "@/lib/ecommerce/ecommerce-recipes";
import { createEcommerceVariantAxis, createEcommerceVariantSet, ecommerceVariantIssues, ecommerceVariantRows, type EcommerceVariantSet } from "@/lib/ecommerce/ecommerce-variants";
import { ecommerceModelById, ecommerceModelRefCount, type EcommerceModel } from "@/lib/ecommerce/ecommerce-models";
import { useEcommerceModelLibrary } from "@/stores/use-ecommerce-model-library";
import { useEcommerceSuitePrompt } from "@/stores/use-ecommerce-suite-prompt";
import type { CanvasTheme } from "@/lib/canvas-theme";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import "./canvas-ecommerce-node-card.css";

type ProductNodeContentProps = {
    node: CanvasNodeData;
    theme: CanvasTheme;
};

type ProfileFieldKey = keyof Pick<EcommerceProductProfile, "category" | "appearance" | "marks" | "forbidden" | "audience" | "facts" | "price">;

/**
 * 档案字段。分两组，因为它们的用途不一样：
 *
 * - **画面组**（外观 / 标识 / 禁止）管的是「画得像不像」——它们逐字进商品锁定块，
 *   是同一件商品的唯一依据。
 * - **文案组**（品类 / 人群 / 卖点 / 价格）管的是「话说不说得出来」。
 *   少了这一组，模型写文案时只剩两条路：编，或者写「暂未提供」——
 *   两条都不能要，所以起草之前会先拦下来。
 */
const PROFILE_FIELDS: { key: ProfileFieldKey; label: string; placeholder: string; rows: number; group: "copy" | "visual" }[] = [
    { key: "category", label: "品类", placeholder: "保温杯", rows: 1, group: "copy" },
    { key: "audience", label: "目标人群与场景", placeholder: "25–35 岁通勤上班族；办公室、通勤路上、健身房", rows: 2, group: "copy" },
    { key: "facts", label: "卖点与依据 · 一条一行", placeholder: "保温 12 小时：实测 95℃ 热水 12 小时后 68℃ / 316 不锈钢内胆：材质单编号 XX / 一键弹盖：单手可开", rows: 4, group: "copy" },
    { key: "price", label: "价格", placeholder: "¥199（空着就不在图上出现价格）", rows: 1, group: "copy" },
    { key: "appearance", label: "外观", placeholder: "哑光黑，304 不锈钢，磨砂质感，圆柱形杯身", rows: 3, group: "visual" },
    { key: "marks", label: "标识", placeholder: "杯身中部银色 Logo「THERMO」，位置与字体不变", rows: 2, group: "visual" },
    { key: "forbidden", label: "禁止", placeholder: "改变形状、增减部件、改变配色、移动图案位置", rows: 2, group: "visual" },
];

/**
 * 商品节点——电商画布上唯一的入口。
 *
 * **卡片的主体是一排套图入口，不是九套方案、不是十三种节点。**
 *
 * 前面几版把「一步能做完的事」拆成十几个节点让用户自己接：铺九屏、连文案、
 * 连排版、逐张点生成、等九张出完、再逐张叠字、再拼长图、再切片。每一步都
 * 「可配置」，合起来是一条没人走得完的流水线。行业里真正在用的工具只有一个按钮。
 *
 * 点一个入口打开的是**套图面板**——一张表，一行一张图，每行一条完整提示词。
 * 过程在那张表里，不在画布上：节点是出图时才铺的，铺出来的是结果。
 *
 * 商品档案仍然要填——它是「同一件商品」的唯一依据，模型从图里猜出来的不算数。
 * 但它折叠在编辑里：设计师要看的是商品，不是输入框。
 */
export function ProductNodeContent({ node, theme }: ProductNodeContentProps) {
    const { updateMetadata, generateEcommerceSuite, draftEcommerceSuite, draftEcommerceProfile, spawnEcommerceMaterials, generateEcommerceModelPreset } = useCanvasNodeActions();
    const upstream = useUpstreamNodes(node.id);
    const downstream = useDownstreamNodes(node.id);
    const { message } = App.useApp();
    const [editing, setEditing] = useState(false);
    const [suiteFlow, setSuiteFlow] = useState<EcommerceOneClickFlow["id"] | null>(null);
    const [analyzing, setAnalyzing] = useState(false);
    const [modelPickerOpen, setModelPickerOpen] = useState(false);

    const models = useEcommerceModelLibrary((state) => state.models);
    const hydrateModels = useEcommerceModelLibrary((state) => state.hydrate);
    const touchModel = useEcommerceModelLibrary((state) => state.touchModel);
    useEffect(() => { void hydrateModels(); }, [hydrateModels]);

    // 用户自己那份分析提示词：**只要他没改回默认，就一直用它**。
    // 存在账号上而不是画布上——调好一版写法，上新每个商品都该用它。
    // 节点上那份优先（有人按商品微调过），节点上没有才继承用户级默认。
    const { skills: availableSkills, loading: skillsLoading } = useSkillRuntimeCatalog();

    const directorDefault = useEcommerceSuitePrompt((state) => state.director);
    const hydrateDirector = useEcommerceSuitePrompt((state) => state.hydrate);
    const setDirectorDefault = useEcommerceSuitePrompt((state) => state.setDirector);
    useEffect(() => { void hydrateDirector(); }, [hydrateDirector]);

    const profile = node.metadata?.productProfile || createEcommerceProductProfile(node.title || "未命名商品");
    const variants = node.metadata?.ecommerceVariants || createEcommerceVariantSet();
    const suite: EcommerceSuite | undefined = node.metadata?.ecommerceSuite;
    const images = upstream.filter((item) => item.type === CanvasNodeType.Image && (item.metadata?.content || item.metadata?.storageKey));
    const editable = Boolean(updateMetadata);
    const imageById = new Map(images.map((image) => [image.id, image]));
    // 卡片显示的是**实际生效的视角**，不是 profile.views 原文：空槽由连进来的图
    // 按顺序自动认领。显示与生成读同一份判据，否则又会出现「卡片上有图、生成时没用上」。
    const views = effectiveProductViews(profile, images);
    const autoBound = new Set(ECOMMERCE_PRODUCT_VIEWS.filter((view) => !(view.id in profile.views)).map((view) => view.id));
    const boundCount = ECOMMERCE_PRODUCT_VIEWS.filter((view) => imageById.has(views[view.id] || "")).length;
    const variantRows = ecommerceVariantRows(variants);
    const variantIssues = ecommerceVariantIssues(variants, [profile.appearance, profile.marks]);

    const activeModel = ecommerceModelById(node.metadata?.ecommerceModelId, models);
    const modelRefs = ecommerceModelRefCount(activeModel);
    const summary = [profile.category, profile.appearance, profile.marks].map((value) => value.trim().split("\n")[0]).filter(Boolean).join(" · ");
    const filledFields = PROFILE_FIELDS.filter((field) => profile[field.key].trim()).length;
    const heroImage = views.front ? imageById.get(views.front) : images[0];

    const patch = (next: Partial<EcommerceProductProfile>) => updateMetadata?.(node.id, { productProfile: { ...profile, ...next } });
    const patchVariants = (next: Partial<EcommerceVariantSet>) => updateMetadata?.(node.id, { ecommerceVariants: { ...variants, ...next } });
    // 显式清空写成空串而不是删键：删了会被自动认领立刻填回来，
    // 用户看到的是「取消不掉」。
    const bindView = (view: EcommerceProductView, nodeId: string) => patch({ views: { ...profile.views, [view]: nodeId } });

    const flows = ECOMMERCE_ONE_CLICK_FLOWS.map((flow) => ({
        flow,
        screens: ecommerceOneClickScreens(flow),
        missing: ecommerceSuiteMissing(suite?.flow === flow.id ? suite : undefined, ecommerceOneClickScreens(flow).length),
    }));
    // 起草文案之前必须先有事实：品类、卖点与依据、目标人群与场景。
    // 缺了它们，模型只有两条路——编，或者写「暂未提供」。两条都不能要。
    const copySourceIssues = ecommerceCopySourceIssues(profile);
    const activeFlow = ecommerceOneClickFlow(suiteFlow || undefined);
    // 面板上的分析模型与出图模型存在商品节点上：分析要读图、出图不用，
    // 两者常常不是同一个模型，而全局配置只有一个。空串交给 ModelPicker 自己解析默认。
    const analysisModel = node.metadata?.ecommerceAnalysisModel || "";
    const imageModel = node.metadata?.ecommerceImageModel || "";
    // 表里显示哪一张已经出了图：产物节点按槽位认回来。
    const nodeBySlot = new Map<string, CanvasNodeData>();
    for (const child of downstream) {
        const slotId = child.metadata?.ecommerceShotId;
        if (child.type === CanvasNodeType.Image && slotId && !nodeBySlot.has(slotId)) nodeBySlot.set(slotId, child);
    }

    // 色彩美学 / 字体风格当前选的是哪个预设——从 ecommerceStyle 反查，
    // 不另存一个 id：存两份一定会分叉（预设改了、字段没改）。
    const activeStyle = node.metadata?.ecommerceStyle;
    const stylePresetId = ECOMMERCE_STYLE_PRESETS.find((preset) => preset.style.name === activeStyle?.name && preset.style.palette.join() === (activeStyle?.palette || []).join())?.id || "";
    const typographyPresetId = ecommerceTypographyPresetFor(activeStyle?.typography || "")?.id || "";
    // 风格参考图的候选就是连着的那几张实拍——用户手上只有这些图。
    const styleReferenceCandidates = images.map((image) => ({ key: image.metadata?.storageKey || "", label: image.title || image.id })).filter((item) => item.key);

    const openSuitePanel = (flowId: EcommerceOneClickFlow["id"]) => {
        if (!images.length) {
            message.warning("先连一张商品实拍——模型才知道要画的是什么东西");
            return;
        }
        setSuiteFlow(flowId);
    };

    const runSuiteDraft = async () => {
        if (!suiteFlow) return;
        setAnalyzing(true);
        try {
            await draftEcommerceSuite?.(node, suiteFlow, analysisModel || undefined);
        } finally {
            setAnalyzing(false);
        }
    };

    /** 兜底：不调模型，按行业套路的拍法预设铺一份能用的提示词底子。 */
    const seedSuitePresets = () => {
        if (!suiteFlow) return;
        const flow = ecommerceOneClickFlow(suiteFlow);
        if (!flow) return;
        updateMetadata?.(node.id, { ecommerceSuite: { flow: flow.id, rows: ecommerceSuiteFromPresets(flow), source: "preset", updatedAt: new Date().toISOString() } });
    };

    /**
     * 改表里的一格：标题 / 职责 / 提示词。
     *
     * 还没分析过时用户也能直接开写——从骨架起一份，不是让他先点一次「铺底」。
     * 手写的行不能被后续的铺底或分析冲掉（那两处是整体覆盖，用户点了才知道）。
     */
    const patchSuiteRow = (slotId: string, patch: Partial<Pick<EcommerceSuiteRow, "title" | "duty" | "prompt">>) => {
        if (!suiteFlow) return;
        const flow = ecommerceOneClickFlow(suiteFlow);
        if (!flow) return;
        const current = suite?.flow === flow.id ? suite : { flow: flow.id, rows: ecommerceSuiteSkeleton(flow), source: "preset" as const, updatedAt: "" };
        updateMetadata?.(node.id, { ecommerceSuite: { ...current, rows: current.rows.map((row) => (row.slotId === slotId ? { ...row, ...patch } : row)) } });
    };

    /**
     * 加一屏。
     *
     * **这一套出几张由这张表定，不由行业套路定。** 用户想拆成十二屏就加三行，
     * 想只出六屏就删三行——「九屏」只是一个起点。
     */
    const addSuiteRow = () => {
        if (!suiteFlow) return;
        const flow = ecommerceOneClickFlow(suiteFlow);
        if (!flow) return;
        const current = suite?.flow === flow.id ? suite : { flow: flow.id, rows: ecommerceSuiteSkeleton(flow), source: "preset" as const, updatedAt: "" };
        updateMetadata?.(node.id, {
            ecommerceSuite: { ...current, source: "preset", rows: [...current.rows, { slotId: ecommerceSuiteRowId(flow, current.rows), title: "", duty: "", prompt: "" }] },
        });
    };

    /**
     * 抹掉表里所有提示词。**屏次与职责留着**——用户想重来一遍时，
     * 通常还要原来那套结构，而不是从空白骨架重新想一遍分几屏。
     * 画布上已经出的图也不动。
     */
    const clearSuitePrompts = () => {
        if (!suiteFlow) return;
        const flow = ecommerceOneClickFlow(suiteFlow);
        if (!flow) return;
        const current = suite?.flow === flow.id ? suite : { flow: flow.id, rows: ecommerceSuiteSkeleton(flow), source: "preset" as const, updatedAt: "" };
        updateMetadata?.(node.id, { ecommerceSuite: { ...current, source: "preset", rows: current.rows.map((row) => ({ ...row, prompt: "" })) } });
    };

    /**
     * 把某一行往前/往后挪。顺序决定叙事，也决定长图怎么接。
     */
    const moveSuiteRow = (slotId: string, delta: number) => {
        if (!suiteFlow) return;
        const flow = ecommerceOneClickFlow(suiteFlow);
        if (!flow) return;
        const current = suite?.flow === flow.id ? suite : { flow: flow.id, rows: ecommerceSuiteSkeleton(flow), source: "preset" as const, updatedAt: "" };
        updateMetadata?.(node.id, { ecommerceSuite: { ...current, source: "preset", rows: ecommerceSuiteMoveRow(current.rows, slotId, delta) } });
    };

    /**
     * 删一屏。
     *
     * 只从表里删，**不动画布上已经铺出去的那张图**——用户可能只是想这一套不再出它，
     * 但那张图还有用。真要删图他自己在画布上删，那是另一件事。
     */
    const removeSuiteRow = (slotId: string) => {
        if (!suiteFlow) return;
        const flow = ecommerceOneClickFlow(suiteFlow);
        if (!flow) return;
        const current = suite?.flow === flow.id ? suite : { flow: flow.id, rows: ecommerceSuiteSkeleton(flow), source: "preset" as const, updatedAt: "" };
        if (current.rows.length <= 1) {
            message.warning("至少留一屏——空表出不了图");
            return;
        }
        updateMetadata?.(node.id, { ecommerceSuite: { ...current, source: "preset", rows: current.rows.filter((row) => row.slotId !== slotId) } });
    };

    /**
     * 整组统一的几条。
     *
     * **色彩美学与字体风格写进 `ecommerceStyle`**——那是现成的字段，编译链已经会把它
     * 变成每张图前面的【品牌风格】块，不必再造一条通路。字体单独选过就覆盖色板预设
     * 里那一条（同一套色板配无衬线是干净，配粗黑是张扬，两件事要能分开调）。
     *
     * 平台与语言写自己的字段：它们进分析提示词（模型据此写图上的字），
     * 不直接进画面约束。
     */
    const patchSuiteUniform = (patch: Partial<EcommerceUniformValue>) => {
        const metadata: Record<string, unknown> = {};
        if (patch.platform !== undefined) metadata.ecommercePlatform = patch.platform || undefined;
        if (patch.language !== undefined) metadata.ecommerceLanguage = patch.language || undefined;
        if (patch.styleReferenceKey !== undefined) metadata.ecommerceStyleReferenceKey = patch.styleReferenceKey || undefined;

        const nextPresetId = patch.stylePresetId !== undefined ? patch.stylePresetId : stylePresetId;
        const nextTypographyId = patch.typographyPresetId !== undefined ? patch.typographyPresetId : typographyPresetId;
        if (patch.stylePresetId !== undefined || patch.typographyPresetId !== undefined) {
            const base = nextPresetId ? createEcommerceStyleFromPreset(nextPresetId) : undefined;
            if (base || nextTypographyId) {
                const typography = nextTypographyId ? ecommerceTypographyPreset(nextTypographyId)?.typography || "" : base?.typography || "";
                metadata.ecommerceStyle = { ...(base || createEcommerceStyle("自定义")), typography };
            } else {
                // 两个都清空就是不用品牌风格块——不留一份空壳，空壳会往提示词里塞一段废话
                metadata.ecommerceStyle = undefined;
            }
        }
        updateMetadata?.(node.id, metadata as Parameters<NonNullable<typeof updateMetadata>>[1]);
    };

    const runSuiteGenerate = (slotId?: string) => {
        const flowId = suiteFlow;
        // 单张出图不关面板——用户多半要接着出下一张。
        if (slotId) {
            if (flowId) void generateEcommerceSuite?.(node, flowId, [slotId]);
            return;
        }
        setSuiteFlow(null);
        if (flowId) void generateEcommerceSuite?.(node, flowId);
    };

    return (
        <div className="ecom-card" style={{ color: theme.node.text }} onMouseDown={stopCanvasDragFromInteractive}>
            <header className="ecom-card-header">
                <div className="ecom-card-kicker">
                    <span className="ecom-card-mark"><Package className="size-3.5" /></span>
                    <span>电商 / 商品</span>
                </div>
                <span className="ecom-card-status">
                    {boundCount}/{ECOMMERCE_PRODUCT_VIEWS.length} 视角
                </span>
            </header>

            <EcommerceNodeTitle
                node={node}
                fallback="未命名商品"
                subtitle={summary || (images.length ? "档案还没填——点下方「编辑」" : "把商品实拍连到本节点开始")}
            />

            {heroImage?.metadata?.content ? (
                <div className="ecom-card-stage">
                    <img src={heroImage.metadata.content} alt="" className="ecom-card-stage-image" draggable={false} />
                </div>
            ) : null}

            <div className="ecom-view-strip">
                {ECOMMERCE_PRODUCT_VIEWS.map((view) => {
                    const bound = views[view.id] ? imageById.get(views[view.id]!) : undefined;
                    const auto = autoBound.has(view.id) && Boolean(bound);
                    return (
                        <button
                            key={view.id}
                            type="button"
                            className="ecom-view-slot"
                            data-filled={bound ? "true" : "false"}
                            data-auto={auto ? "true" : "false"}
                            disabled={!editable}
                            title={bound
                                ? `${view.label}：${bound.title || bound.id}${auto ? "（按连线自动认领，可在「编辑」里改）" : ""}`
                                : `${view.label}未指定——${view.hint}`}
                            aria-label={`${view.label}视角`}
                            onClick={() => setEditing(true)}
                        >
                            {bound?.metadata?.content
                                ? <img src={bound.metadata.content} alt="" draggable={false} />
                                : <ImageIcon className="size-3.5" />}
                            <span className="ecom-view-slot-label">{view.label}</span>
                        </button>
                    );
                })}
            </div>

            {/* 模特挂在商品上，不挂在每一张图上：同一套图里是同一个人，是这一套的属性。
                产物图生成时继承它——九屏各选一次模特，必然选出九个人。 */}
            <button
                type="button"
                className="ecom-model-pick"
                data-filled={activeModel ? "true" : "false"}
                disabled={!editable}
                title={activeModel ? `模特：${activeModel.name}（${modelRefs} 张参考图）——这一套图都用这个人` : "选一个模特——这一套图都用这个人"}
                onClick={() => setModelPickerOpen(true)}
            >
                <UserRound className="size-3.5 shrink-0" />
                <span className="truncate">{activeModel ? activeModel.name : "还没有选模特"}</span>
                <span className="ecom-model-pick-hint">{activeModel ? `${modelRefs} 张参考图 · 整组统一` : "服饰、配饰、上身图需要"}</span>
            </button>

            {/* 整组统一：色彩 / 字体 / 语言 / 平台 / 风格参考图。
                放在卡片上而不是套图面板里——这几条是「这一套长什么样」的底色，
                调一次用一整套，跟「这一张画什么」不是同一层的事。 */}
            {editable ? (
                <CanvasEcommerceUniformDialog
                    value={{ platform: node.metadata?.ecommercePlatform || "", language: node.metadata?.ecommerceLanguage || "", stylePresetId, typographyPresetId, styleReferenceKey: node.metadata?.ecommerceStyleReferenceKey || "" }}
                    styleReferenceCandidates={styleReferenceCandidates}
                    onChange={patchSuiteUniform}
                    theme={theme}
                />
            ) : null}

            {/* 一排套图入口。整张卡片的存在理由就是这几颗按钮。
                点开的是套图面板——一张表，一行一张图，每行一条完整提示词；
                节点在批量生成时才铺，过程在表里不在画布上。 */}
            <div className="ecom-oneclick-row">
                {flows.map(({ flow, screens, missing }) => (
                    <button
                        key={flow.id}
                        type="button"
                        className="ecom-oneclick"
                        data-blocked={images.length ? undefined : "true"}
                        disabled={!generateEcommerceSuite || !draftEcommerceSuite}
                        title={images.length ? flow.hint : "先连一张商品实拍"}
                        onClick={() => openSuitePanel(flow.id)}
                    >
                        <span className="ecom-oneclick-name">
                            <Sparkles className="size-3.5" />
                            {flow.name}
                        </span>
                        <span className="ecom-oneclick-hint">{flow.hint}</span>
                        <span className="ecom-oneclick-stat tabular-nums" data-warn={missing ? "true" : undefined}>
                            {screens.length} 张 · {missing ? `还差 ${missing} 条提示词` : "提示词齐了"}
                        </span>
                    </button>
                ))}
            </div>

            {variantRows.length ? (
                <div className="ecom-variant-count" data-heavy={variantRows.length * 5 > 40 ? "true" : "false"}>
                    <b>{variantRows.length}</b>
                    <span>个 SKU 组合 · 约 {variantRows.length * 5} 张图</span>
                </div>
            ) : null}

            {editing && editable ? (
                <div className="ecom-card-editor">
                    {/* 读图起草：把「填表」变成「核对」。
                        商品实拍会真的递进模型（见 runEcommerceTextDraft）——上一版走云 agent，
                        那边没有取图工具，模型只能回一句「未挂载视觉查看工具」。
                        档案是后面所有图的依据，所以提示词里明确要求把推测的那几条点出来。 */}
                    {images.length ? (
                        <button
                            type="button"
                            className="ecom-action ecom-action-primary"
                            disabled={!draftEcommerceProfile}
                            title="助手会真的读这几张商品实拍，起草档案并把推测的那几条点出来——推测的必须你核对过才进锁定块"
                            onClick={() => void draftEcommerceProfile?.(node)}
                        >
                            <Sparkles className="size-3" />
                            让助手读图起草档案
                        </button>
                    ) : null}

                    <div className="ecom-chip-row">
                        {images.length ? images.map((image) => {
                            const bound = ECOMMERCE_PRODUCT_VIEWS.find((view) => views[view.id] === image.id);
                            const auto = bound ? autoBound.has(bound.id) : false;
                            return (
                                <span key={image.id} className="flex min-w-0 items-center gap-1">
                                    <span className="ecom-card-status truncate" title={image.title}>{image.title || image.id}</span>
                                    {auto ? <span className="ecom-card-status" title="按连线自动认领的视角，点标签可以改">自动</span> : null}
                                    <span className="ecom-chip-row">
                                        {ECOMMERCE_PRODUCT_VIEWS.map((view) => (
                                            <button
                                                key={view.id}
                                                type="button"
                                                className="ecom-chip"
                                                aria-pressed={bound?.id === view.id}
                                                title={view.hint}
                                                onClick={() => bindView(view.id, bound?.id === view.id ? "" : image.id)}
                                            >
                                                {view.label}
                                            </button>
                                        ))}
                                    </span>
                                </span>
                            );
                        }) : <span className="ecom-card-status">还没有连入商品实拍</span>}
                    </div>

                    {/* 档案分两组：文案组决定「话说不说得出来」，画面组决定「画得像不像」。
                        文案组缺了会被文案面板拦下来，所以它在前面、并且带说明。 */}
                    <span className="ecom-field-group">
                        文案依据 · 缺了写不出话
                        {copySourceIssues.length ? <span className="ecom-card-status-warn">还缺 {copySourceIssues.join("、")}</span> : null}
                    </span>
                    {PROFILE_FIELDS.filter((field) => field.group === "copy").map((field) => (
                        <label key={field.key} className="ecom-field">
                            <span className="ecom-field-label">{field.label}</span>
                            <textarea
                                className="ecom-field-input thin-scrollbar"
                                value={profile[field.key]}
                                rows={field.rows}
                                placeholder={field.placeholder}
                                onChange={(event) => patch({ [field.key]: event.target.value } as Partial<EcommerceProductProfile>)}
                            />
                        </label>
                    ))}

                    <span className="ecom-field-group">画面依据 · 决定画得像不像</span>
                    {PROFILE_FIELDS.filter((field) => field.group === "visual").map((field) => (
                        <label key={field.key} className="ecom-field">
                            <span className="ecom-field-label">{field.label}</span>
                            <textarea
                                className="ecom-field-input thin-scrollbar"
                                value={profile[field.key]}
                                rows={field.rows}
                                placeholder={field.placeholder}
                                onChange={(event) => patch({ [field.key]: event.target.value } as Partial<EcommerceProductProfile>)}
                            />
                        </label>
                    ))}

                    {/* 提示词不在这张卡片上编辑——审核面是一张 N 行的表，在面板里。
                        这里只报「几行写了」，并给一个入口。九行挤在 460px 宽的卡片里
                        没法对齐、没法扫，也装不下那条完整提示词。 */}
                    <div className="ecom-field">
                        <span className="ecom-field-label">出图提示词 · 一张一条，随图一起交给模型</span>
                        <div className="ecom-chip-row">
                            {ECOMMERCE_ONE_CLICK_FLOWS.map((flow) => {
                                const screens = ecommerceOneClickScreens(flow);
                                const missing = ecommerceSuiteMissing(suite?.flow === flow.id ? suite : undefined, screens.length);
                                return (
                                    <button
                                        key={flow.id}
                                        type="button"
                                        className="ecom-chip"
                                        title={`打开「${flow.name}」的套图表：${screens.length} 张，一行一张一条完整提示词`}
                                        onClick={() => openSuitePanel(flow.id)}
                                    >
                                        {flow.name}
                                        <span className="tabular-nums" data-warn={missing ? "true" : undefined} style={{ marginLeft: 4 }}>
                                            {screens.length - missing}/{screens.length}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                        <span className="ecom-card-subtitle" style={{ whiteSpace: "normal" }}>
                            分析模型读你的商品实拍，为每一张写一条能直接出图的提示词——主图画什么、上身图画什么、
                            细节图画什么，构图光线全不一样。逐条核对过再批量出图。
                        </span>
                    </div>

                    <div className="ecom-field">
                        <span className="ecom-field-label">SKU 变体 · 多色多规格一次出全套</span>
                        <div className="ecom-variant-grid">
                            {variants.axes.map((axis) => (
                                <div key={axis.id} className="ecom-variant-axis">
                                    <input
                                        className="ecom-field-input"
                                        style={{ width: 66 }}
                                        value={axis.name}
                                        placeholder="轴名"
                                        aria-label="变体轴名"
                                        onChange={(event) => patchVariants({ axes: variants.axes.map((item) => (item.id === axis.id ? { ...item, name: event.target.value } : item)) })}
                                    />
                                    <input
                                        className="ecom-field-input"
                                        value={axis.values.join(" / ")}
                                        placeholder="黑 / 白 / 米，用斜杠分隔"
                                        aria-label={`${axis.name || "变体"}的取值`}
                                        onChange={(event) => patchVariants({ axes: variants.axes.map((item) => (item.id === axis.id ? { ...item, values: event.target.value.split("/").map((value) => value.trim()) } : item)) })}
                                    />
                                    <button type="button" className="ecom-chip" aria-label={`删除变体轴 ${axis.name || ""}`} onClick={() => patchVariants({ axes: variants.axes.filter((item) => item.id !== axis.id) })}>
                                        ×
                                    </button>
                                </div>
                            ))}
                        </div>
                        <button type="button" className="ecom-action" onClick={() => patchVariants({ axes: [...variants.axes, createEcommerceVariantAxis()] })}>
                            + 加一条变体轴
                        </button>
                        <span className="ecom-card-subtitle" style={{ whiteSpace: "normal" }}>
                            轴名就是占位符——在拍法、卖点、文案里写 {"{颜色}"}，生成时按这一行的值替换。
                        </span>
                        {variantIssues.length ? (
                            <span className="ecom-card-subtitle ecom-card-status-warn" style={{ whiteSpace: "normal" }}>{variantIssues[0].message}</span>
                        ) : null}
                    </div>

                    {/* 单张起手：只要一张时不必走一键——一键是「交一整套活」，
                        只要一张主图的人不该被九个屏的任务量吓到。 */}
                    <button
                        type="button"
                        className="ecom-action"
                        disabled={!spawnEcommerceMaterials || !images.length}
                        title={images.length ? "只铺一张主图，不生成" : "先连一张商品实拍"}
                        onClick={() => void spawnEcommerceMaterials?.(node, "single")}
                    >
                        <Layers className="size-3" />
                        只要一张主图
                    </button>
                </div>
            ) : null}

            <footer className="ecom-card-footer">
                <span>档案 <b>{filledFields}</b>/<b>{PROFILE_FIELDS.length}</b> 项</span>
                {editable ? (
                    <button type="button" className="ecom-card-footer-action ecom-action" onClick={() => setEditing((value) => !value)} aria-expanded={editing}>
                        {editing ? "收起" : "编辑"}
                        <ChevronDown className="size-3" style={{ transform: editing ? "rotate(180deg)" : undefined, transition: "transform 140ms cubic-bezier(.16,1,.3,1)" }} />
                    </button>
                ) : null}
            </footer>

            {activeFlow ? (
                <CanvasEcommerceSuitePanel
                    open={Boolean(suiteFlow)}
                    flow={activeFlow}
                    suite={suite?.flow === activeFlow.id ? suite : undefined}
                    rows={activeFlow ? ecommerceSuiteRows(activeFlow, suite) : []}
                    nodeBySlot={nodeBySlot}
                    analysisModel={analysisModel}
                    imageModel={imageModel}
                    imageSize={node.metadata?.ecommerceImageSize || ""}
                    imageQuality={node.metadata?.ecommerceImageQuality || ""}
                    directorPrompt={node.metadata?.ecommerceSuitePrompt || directorDefault}
                    skillIds={node.metadata?.ecommerceAnalysisSkills || []}
                    availableSkills={availableSkills}
                    skillsLoading={skillsLoading}
                    autoBind={node.metadata?.ecommerceAutoBind !== false}
                    onSkillIdsChange={(skillIds) => updateMetadata?.(node.id, { ecommerceAnalysisSkills: skillIds })}
                    onAutoBindChange={(value) => updateMetadata?.(node.id, { ecommerceAutoBind: value })}
                    onClearPrompts={clearSuitePrompts}
                    analyzing={analyzing}
                    onAnalysisModelChange={(model) => updateMetadata?.(node.id, { ecommerceAnalysisModel: model })}
                    onImageModelChange={(model) => updateMetadata?.(node.id, { ecommerceImageModel: model })}
                    onImageOptionChange={(key, value) => updateMetadata?.(node.id, key === "size" ? { ecommerceImageSize: value } : { ecommerceImageQuality: value })}
                    onDirectorPromptChange={(value) => {
                        // 改了就同时记到账号上——下次开新画布不用再设一遍。
                        // 「恢复默认」传空串，两边一起清掉。
                        updateMetadata?.(node.id, { ecommerceSuitePrompt: value });
                        if (!value.trim()) setDirectorDefault("");
                    }}
                    onAnalyze={() => void runSuiteDraft()}
                    onSeedPresets={seedSuitePresets}
                    onRowChange={patchSuiteRow}
                    onAddRow={addSuiteRow}
                    onRemoveRow={removeSuiteRow}
                    onGenerate={() => runSuiteGenerate()}
                    onGenerateOne={(slotId) => runSuiteGenerate(slotId)}
                    onMoveRow={moveSuiteRow}
                    onClose={() => setSuiteFlow(null)}
                />
            ) : null}

            <CanvasEcommerceModelLibraryModal
                open={modelPickerOpen}
                activeModelId={node.metadata?.ecommerceModelId}
                onClose={() => setModelPickerOpen(false)}
                onGeneratePreset={generateEcommerceModelPreset}
                onSelect={(model: EcommerceModel) => {
                    touchModel(model.id);
                    updateMetadata?.(node.id, { ecommerceModelId: model.id });
                }}
            />
        </div>
    );
}
