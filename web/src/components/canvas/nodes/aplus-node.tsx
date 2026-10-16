import { ChevronDown, Layers, LoaderCircle, Plus, Sparkles, Trash2 } from "lucide-react";
import { useState } from "react";

import { useCanvasNodeActions } from "@/components/canvas/canvas-node-action-context";
import { EcommerceNodeTitle } from "./canvas-ecommerce-node-title";
import {
    ECOMMERCE_APLUS_MODULES,
    createEcommerceAplus,
    createEcommerceAplusBlock,
    ecommerceAplusBlocked,
    ecommerceAplusExportSize,
    ecommerceAplusIssues,
    ecommerceAplusModule,
    ecommerceAplusReady,
    type EcommerceAplus,
    type EcommerceAplusBlock,
    type EcommerceAplusModuleId,
} from "@/lib/ecommerce/ecommerce-aplus";
import type { CanvasTheme } from "@/lib/canvas-theme";
import type { CanvasNodeData } from "@/types/canvas";
import "./canvas-ecommerce-node-card.css";

type AplusNodeContentProps = {
    node: CanvasNodeData;
    theme: CanvasTheme;
};

/**
 * A+ 内容节点——亚马逊详情页的模块化版式。
 *
 * A+ 不是「一张长图」，是**一组带硬性尺寸的槽位**：图放错尺寸会被审核拒，
 * 文字超字数会被截断。所以卡片主体是**模块清单**，每块一行，行上写着它自己的
 * 尺寸与字数上限——这是 A+ 相对其他图最不一样的地方，它有硬性规格，能真正校验。
 *
 * 每块单独出图：不同模块的画面尺寸差着量级（品牌头图 1940×600、四图一文 220×220），
 * 一次生成把两种尺寸混在一起，模型只会给出一张两头不讨好的图。
 *
 * 文字不进画面——A+ 的标题与正文由亚马逊自己的叠加层渲染，模型把字画进图里
 * 会和叠加层打架。这一条在模块规格里本来就写着（图文叠加模块自带蒙版层）。
 */
export function AplusNodeContent({ node, theme }: AplusNodeContentProps) {
    const { updateMetadata, generateEcommerceNode } = useCanvasNodeActions();
    const [editing, setEditing] = useState(false);
    const [generatingBlockId, setGeneratingBlockId] = useState<string | null>(null);

    const aplus: EcommerceAplus = node.metadata?.ecommerceAplus || createEcommerceAplus(node.title || "A+ 内容");
    const editable = Boolean(updateMetadata);
    const issues = ecommerceAplusIssues(aplus);
    const blocked = ecommerceAplusBlocked(issues);
    const ready = ecommerceAplusReady(aplus);

    const patch = (next: Partial<EcommerceAplus>) => updateMetadata?.(node.id, { ecommerceAplus: { ...aplus, ...next } });
    const commitBlocks = (blocks: EcommerceAplusBlock[]) => patch({ blocks });
    const patchBlock = (id: string, next: Partial<EcommerceAplusBlock>) => commitBlocks(aplus.blocks.map((block) => (block.id === id ? { ...block, ...next } : block)));

    const addBlock = (moduleId: EcommerceAplusModuleId) => {
        const block = createEcommerceAplusBlock(moduleId);
        commitBlocks([...aplus.blocks, block]);
        setEditing(true);
    };

    /**
     * 出一块的图。
     *
     * 只把**这一块**编译进提示词，不是整份 A+——一份 A+ 有八种尺寸，
     * 全塞进去模型没法决定该画哪一张。
     */
    const generate = async (block: EcommerceAplusBlock) => {
        if (!generateEcommerceNode) return;
        const module = ecommerceAplusModule(block.moduleId);
        if (!module) return;
        setGeneratingBlockId(block.id);
        try {
            const size = ecommerceAplusExportSize(block.moduleId);
            const lines = [`【A+ 内容】${module.name}（${module.officialName}）`];
            if (size) lines.push(`画面尺寸：${size.width}×${size.height}，严格按这个比例出图，不要留白边或自行裁剪`);
            lines.push("画面里不要出现任何文字、水印或图标——标题与正文由亚马逊的叠加层渲染，画进去会和叠加层打架。");
            if (block.body.trim()) lines.push(`这一块要讲的内容（只作为画面题材的依据，不要画成文字）：${block.body.trim()}`);
            await generateEcommerceNode(node, "image", lines.join("\n"));
        } finally {
            setGeneratingBlockId(null);
        }
    };

    return (
        <div className="ecom-card" style={{ color: theme.node.text }}>
            <header className="ecom-card-header">
                <div className="ecom-card-kicker">
                    <span className="ecom-card-mark"><Layers className="size-3.5" /></span>
                    <span>电商 / A+ 内容</span>
                </div>
                <span className={blocked ? "ecom-card-status ecom-card-status-warn" : "ecom-card-status"}>
                    {aplus.blocks.length} 块
                </span>
            </header>

            <EcommerceNodeTitle
                node={node}
                fallback="A+ 内容"
                subtitle="亚马逊详情页的模块化版式 · 每块有硬性尺寸与字数上限"
            />

            {aplus.blocks.length ? (
                <div className="ecom-aplus-list thin-scrollbar">
                    {aplus.blocks.map((block, index) => {
                        const module = ecommerceAplusModule(block.moduleId);
                        const size = ecommerceAplusExportSize(block.moduleId);
                        const headlineOver = module?.headlineMax ? block.headline.trim().length > module.headlineMax : false;
                        const bodyOver = module?.bodyMax ? block.body.trim().length > module.bodyMax : false;
                        return (
                            <div key={block.id} className="ecom-aplus-block" data-over={headlineOver || bodyOver ? "true" : undefined}>
                                <span className="ecom-aplus-block-head">
                                    <span className="ecom-point-index">{index + 1}</span>
                                    <span className="ecom-aplus-block-name">{module?.name || block.moduleId}</span>
                                    {size ? <span className="ecom-aplus-block-size tabular-nums">{size.width}×{size.height}</span> : null}
                                    <button
                                        type="button"
                                        className="ecom-aplus-block-go"
                                        disabled={!generateEcommerceNode || generatingBlockId === block.id}
                                        aria-label={`生成「${module?.name || block.moduleId}」的画面`}
                                        title={size ? `按 ${size.width}×${size.height} 出这一块的画面，文字不进画面` : "出这一块的画面"}
                                        onClick={() => void generate(block)}
                                    >
                                        {generatingBlockId === block.id ? <LoaderCircle className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
                                    </button>
                                </span>
                                <span className="ecom-aplus-block-brief">
                                    {block.headline.trim() || block.body.trim() || <span className="ecom-card-status ecom-card-status-warn">还是空的</span>}
                                </span>
                                {headlineOver || bodyOver ? (
                                    <span className="ecom-card-subtitle ecom-card-status-warn" style={{ whiteSpace: "normal" }}>
                                        {headlineOver ? `标题 ${block.headline.trim().length}/${module?.headlineMax} 字，平台上会被截断` : `正文 ${block.body.trim().length}/${module?.bodyMax} 字，平台上会被截断`}
                                    </span>
                                ) : null}
                            </div>
                        );
                    })}
                </div>
            ) : (
                <div className="ecom-card-stage">
                    <span className="ecom-card-stage-empty">还没有模块——点「编辑」加一块，或从下面的模块库直接加</span>
                </div>
            )}

            {/* 模块库常驻可见：A+ 的难点不在写文案，在「有哪几种槽位、各自什么规格」 */}
            <div className="ecom-action-row">
                <button type="button" className="ecom-action ecom-action-primary" disabled={!editable} onClick={() => setEditing(true)}>
                    <Plus className="size-3" />
                    加一块
                </button>
            </div>

            {editing && editable ? (
                <div className="ecom-card-editor">
                    <div className="ecom-field">
                        <span className="ecom-field-label">模块库 · 点一下加一块</span>
                        <div className="ecom-aplus-modules">
                            {ECOMMERCE_APLUS_MODULES.map((module) => {
                                const size = module.imageBest || module.imageMin;
                                return (
                                    <button
                                        key={module.id}
                                        type="button"
                                        className="ecom-aplus-module"
                                        title={`${module.officialName}\n\n${module.hint}`}
                                        onClick={() => addBlock(module.id)}
                                    >
                                        <span className="ecom-aplus-module-name">{module.name}</span>
                                        <span className="ecom-aplus-module-size tabular-nums">
                                            {size ? `${size.width}×${size.height}` : `${module.bodyMax || "—"} 字`}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <div className="ecom-field">
                        <span className="ecom-field-label">每块写什么</span>
                        {aplus.blocks.map((block, index) => {
                            const module = ecommerceAplusModule(block.moduleId);
                            const size = ecommerceAplusExportSize(block.moduleId);
                            const isChart = Boolean(module?.chart);
                            return (
                                <div key={block.id} className="ecom-field">
                                    <span className="flex items-center gap-1.5">
                                        <span className="ecom-field-label">{index + 1}. {module?.name || block.moduleId}</span>
                                        {size ? <span className="ecom-card-status tabular-nums">{size.width}×{size.height}</span> : null}
                                        <select
                                            className="ecom-field-input w-auto py-0.5"
                                            value={block.moduleId}
                                            aria-label={`第 ${index + 1} 块的模块`}
                                            onChange={(event) => patchBlock(block.id, { moduleId: event.target.value as EcommerceAplusModuleId })}
                                        >
                                            {ECOMMERCE_APLUS_MODULES.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                                        </select>
                                        <button type="button" className="ecom-chip" aria-label={`删除第 ${index + 1} 块`} onClick={() => commitBlocks(aplus.blocks.filter((item) => item.id !== block.id))}>
                                            <Trash2 className="size-3" />
                                        </button>
                                    </span>
                                    {module?.headlineMax ? (
                                        <input
                                            className="ecom-field-input"
                                            value={block.headline}
                                            placeholder={`标题，上限 ${module.headlineMax} 字（现在 ${block.headline.trim().length}）`}
                                            onChange={(event) => patchBlock(block.id, { headline: event.target.value })}
                                        />
                                    ) : null}
                                    {module?.bodyMax ? (
                                        <textarea
                                            className="ecom-field-input thin-scrollbar"
                                            rows={3}
                                            value={block.body}
                                            placeholder={`正文，上限 ${module.bodyMax} 字（现在 ${block.body.trim().length}）`}
                                            onChange={(event) => patchBlock(block.id, { body: event.target.value })}
                                        />
                                    ) : null}
                                    {isChart ? (
                                        <span className="ecom-card-subtitle" style={{ whiteSpace: "normal" }}>
                                            对比表最多 {module!.chart!.maxProducts} 个商品、{module!.chart!.maxRows} 行、单元格 ≤{module!.chart!.cellMax} 字；只对比自家系列，不点名竞品。
                                        </span>
                                    ) : null}
                                </div>
                            );
                        })}
                        {aplus.blocks.length ? null : <span className="ecom-card-status">还没有模块</span>}
                    </div>
                </div>
            ) : null}

            <div className="ecom-info-issues">
                {issues.length ? issues.slice(0, 2).map((issue, index) => (
                    <span key={index} className="ecom-card-subtitle" style={{ whiteSpace: "normal", color: issue.level === "block" ? "#d97706" : undefined }}>{issue.message}</span>
                )) : (
                    <span className="ecom-card-subtitle">
                        {ready ? "规格校验通过——每块按自己的尺寸单独出图" : "字数与尺寸会在提交前校验，不等到上架才发现被截断"}
                    </span>
                )}
            </div>

            <footer className="ecom-card-footer">
                <span>{aplus.blocks.length ? <>共 <b>{aplus.blocks.length}</b> 块{blocked ? "，有拦截项" : ""}</> : "还没有模块"}</span>
                {editable ? (
                    <button type="button" className="ecom-card-footer-action ecom-action" onClick={() => setEditing((value) => !value)} aria-expanded={editing}>
                        {editing ? "收起" : "编辑"}
                        <ChevronDown className="size-3" style={{ transform: editing ? "rotate(180deg)" : undefined, transition: "transform 140ms cubic-bezier(.16,1,.3,1)" }} />
                    </button>
                ) : null}
            </footer>
        </div>
    );
}
