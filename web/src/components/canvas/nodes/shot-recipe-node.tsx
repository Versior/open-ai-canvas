import { Aperture, ChevronDown, LoaderCircle, Plus, Sparkles, Sun, X } from "lucide-react";
import { useState } from "react";

import { useCanvasNodeActions } from "@/components/canvas/canvas-node-action-context";
import { EcommerceNodeTitle } from "./canvas-ecommerce-node-title";
import { useDownstreamNodes } from "@/components/canvas/canvas-node-graph-context";
import { createEcommerceShot, createEcommerceShotSet, ecommerceShotSetReady, type EcommerceShot, type EcommerceShotSet } from "@/lib/ecommerce/ecommerce-contract";
import { createEcommerceShotFromPreset, ecommerceShotPresetsByGroup } from "@/lib/ecommerce/ecommerce-recipes";
import { ecommerceDiagramBoxes, ecommerceShotDiagram } from "@/lib/ecommerce/ecommerce-shot-diagram";
import type { CanvasTheme } from "@/lib/canvas-theme";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import "./canvas-ecommerce-node-card.css";

type ShotRecipeNodeContentProps = {
    node: CanvasNodeData;
    theme: CanvasTheme;
};

const SHOT_FIELDS: { key: keyof Omit<EcommerceShot, "id" | "title">; label: string; placeholder: string }[] = [
    { key: "purpose", label: "用途", placeholder: "搜索页只展示这一张，决定点击率" },
    { key: "composition", label: "构图", placeholder: "商品完整入画，居中，四周留出约 15% 余量" },
    { key: "lighting", label: "光线", placeholder: "柔和均匀棚拍布光，主光在右上方 45°" },
    { key: "color", label: "色彩", placeholder: "中性白，低饱和，色温约 5500K" },
    { key: "lens", label: "镜头", placeholder: "85mm，f/8，平视机位" },
    { key: "background", label: "背景", placeholder: "纯白或浅灰无缝背景" },
    { key: "copyZone", label: "文案位", placeholder: "顶部留出标题位，不生成任何文字" },
    { key: "negative", label: "排除", placeholder: "杂物、水印、多余文字、夸张反光" },
];

/**
 * 拍法节点——一张**拍摄清单**，不是一个方案表单。
 *
 * 一套图（主图五张、详情页九屏）的差异是清单上的行，不是彼此独立的节点。
 * 拆成五个节点意味着同一套布光基准要填五遍，还要在画布上四处找哪份对应哪张。
 *
 * 卡片主体是清单本身：一行一张，带这一行的构图示意。点某一行才展开它的字段——
 * 用户要先看见"这五张分别是什么"，才谈得上改哪一张。
 *
 * 线框图是启发式解析文字得来的，认不出方位词就落默认位置——宁可示意不准，
 * 也不能给出误导性的确定感（见 ecommerce-shot-diagram.ts）。
 *
 * 所有字段都只描述「怎么拍」，一个字都不描述商品长什么样——那是商品节点的职责。
 */
export function ShotRecipeNodeContent({ node, theme }: ShotRecipeNodeContentProps) {
    const { updateMetadata, generateEcommerceShotSet } = useCanvasNodeActions();
    const downstream = useDownstreamNodes(node.id);
    const [editing, setEditing] = useState(false);
    const [activeShotId, setActiveShotId] = useState<string | null>(null);
    const [generatingShotId, setGeneratingShotId] = useState<string | null>(null);
    const [generatingAll, setGeneratingAll] = useState(false);

    const set: EcommerceShotSet = node.metadata?.shotSet || createEcommerceShotSet(node.title || "未命名拍法");
    const editable = Boolean(updateMetadata);
    const shots = set.shots;
    const activeShot = shots.find((shot) => shot.id === activeShotId) || shots[0];
    const ready = ecommerceShotSetReady(set);

    // 下游图片各自认领了哪一行——认领不到的行会退化成只用整组统一，卡片上要点出来。
    const claimed = new Set(downstream.filter((item) => item.type === CanvasNodeType.Image).map((item) => item.metadata?.ecommerceShotId).filter(Boolean) as string[]);
    const unclaimed = shots.filter((shot) => !claimed.has(shot.id));

    const patchSet = (next: Partial<EcommerceShotSet>) => updateMetadata?.(node.id, { shotSet: { ...set, ...next } });
    const commitShots = (next: EcommerceShot[]) => patchSet({ shots: next });
    const patchShot = (id: string, next: Partial<EcommerceShot>) => commitShots(shots.map((shot) => (shot.id === id ? { ...shot, ...next } : shot)));

    const generate = async (shotIds?: string[]) => {
        if (!generateEcommerceShotSet) return;
        const single = shotIds?.length === 1 ? shotIds[0] : null;
        if (single) setGeneratingShotId(single);
        else setGeneratingAll(true);
        try {
            await generateEcommerceShotSet(node, shotIds);
        } finally {
            setGeneratingShotId(null);
            setGeneratingAll(false);
        }
    };

    const diagram = ecommerceShotDiagram(activeShot);
    const boxes = ecommerceDiagramBoxes(diagram);

    return (
        <div className="ecom-card" style={{ color: theme.node.text }}>
            <header className="ecom-card-header">
                <div className="ecom-card-kicker">
                    <span className="ecom-card-mark"><Aperture className="size-3.5" /></span>
                    <span>电商 / 拍摄清单</span>
                </div>
                <span className={unclaimed.length ? "ecom-card-status ecom-card-status-warn" : "ecom-card-status"}>
                    {shots.length} 张
                </span>
            </header>

            <EcommerceNodeTitle
                node={node}
                fallback="未命名拍法"
                subtitle={set.global.trim() || "整组统一要求还没写——比如统一的调性、统一不出现的东西"}
            />

            {activeShot ? (
                <div className="ecom-card-stage">
                    <div className="ecom-shot-diagram" aria-hidden>
                        <span
                            className="ecom-shot-frame ecom-shot-frame-product"
                            style={{ left: `${boxes.product.left}%`, top: `${boxes.product.top}%`, width: `${boxes.product.width}%`, height: `${boxes.product.height}%` }}
                        >
                            <span className="ecom-shot-frame-label">商品</span>
                        </span>
                        {boxes.copy ? (
                            <span
                                className="ecom-shot-frame ecom-shot-frame-copy"
                                style={{ left: `${boxes.copy.left}%`, top: `${boxes.copy.top}%`, width: `${boxes.copy.width}%`, height: `${boxes.copy.height}%` }}
                            >
                                <span className="ecom-shot-frame-label">文案位</span>
                            </span>
                        ) : null}
                        <span className="ecom-shot-light" style={lightArrowStyle(diagram.light)} title={`主光：${lightLabel(diagram.light)}`}>
                            <Sun className="size-3.5" />
                        </span>
                    </div>
                </div>
            ) : (
                <div className="ecom-card-stage">
                    <p className="ecom-card-stage-empty">还没有清单行。从拍法库载入，或自己加一行。</p>
                </div>
            )}

            <div className="ecom-shot-list thin-scrollbar">
                {shots.map((shot, index) => (
                    <div key={shot.id} className="ecom-shot-row" data-active={activeShot?.id === shot.id ? "true" : undefined}>
                        <button
                            type="button"
                            className="ecom-shot-row-pick"
                            aria-pressed={activeShot?.id === shot.id}
                            onClick={() => setActiveShotId(shot.id)}
                            title={shot.purpose || shot.composition}
                        >
                            <span className="ecom-point-index">{index + 1}</span>
                            <span className="ecom-shot-row-body">
                                <span className="ecom-shot-row-title">{shot.title.trim() || "未命名"}</span>
                                <span className="ecom-shot-row-brief">{shot.composition.trim() || "还没写构图"}</span>
                            </span>
                            {claimed.has(shot.id) ? null : <span className="ecom-card-status ecom-card-status-warn">未认领</span>}
                        </button>
                        {/* 每行一个出图入口：清单就是提示词的来源，出图必须长在行上 */}
                        <button
                            type="button"
                            className="ecom-shot-row-go"
                            disabled={!generateEcommerceShotSet}
                            title={`按第 ${index + 1} 行的构图、光线、背景出这一张`}
                            aria-label={`生成第 ${index + 1} 张：${shot.title.trim() || "未命名"}`}
                            onClick={() => void generate([shot.id])}
                        >
                            {generatingShotId === shot.id ? <LoaderCircle className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
                        </button>
                    </div>
                ))}
            </div>

            <div className="ecom-action-row">
                <button
                    type="button"
                    className="ecom-action ecom-action-primary"
                    disabled={!generateEcommerceShotSet || !ready || generatingAll}
                    title={ready ? `按清单出 ${shots.length} 张，缺的产物节点会先补齐` : "清单还没写内容——至少给一行填上构图、光线或背景"}
                    onClick={() => void generate()}
                >
                    {generatingAll ? <LoaderCircle className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
                    {generatingAll ? "提交中…" : `生成整组 · ${shots.length} 张`}
                </button>
            </div>

            {editing && editable ? (
                <div className="ecom-card-editor">
                    <div className="ecom-field">
                        <span className="ecom-field-label">整组统一要求（只写一遍，并进每一张）</span>
                        <textarea
                            className="ecom-field-input thin-scrollbar"
                            rows={2}
                            value={set.global}
                            placeholder="整组保持同一布光基调与背景色系；不出现任何文字、水印、认证标识"
                            onChange={(event) => patchSet({ global: event.target.value })}
                        />
                    </div>

                    <div className="ecom-field">
                        <span className="ecom-field-label">换拍法（替换整张清单）</span>
                        <div className="ecom-chip-row">
                            {ecommerceShotPresetsByGroup().map(({ group, presets }) => (
                                <span key={group} className="flex flex-wrap items-center gap-1">
                                    <span className="ecom-card-status">{group}</span>
                                    {presets.map((preset) => (
                                        <button
                                            key={preset.id}
                                            type="button"
                                            className="ecom-chip"
                                            title={preset.hint}
                                            onClick={() => {
                                                const shot = createEcommerceShotFromPreset(preset.id);
                                                if (shot) commitShots([...shots, shot]);
                                            }}
                                        >
                                            + {preset.name}
                                        </button>
                                    ))}
                                </span>
                            ))}
                        </div>
                    </div>

                    {activeShot ? (
                        <div className="ecom-field">
                            <span className="flex items-center gap-1.5">
                                <span className="ecom-field-label">第 {shots.indexOf(activeShot) + 1} 行</span>
                                <button
                                    type="button"
                                    className="ecom-chip"
                                    aria-label="这一行上移"
                                    disabled={shots.indexOf(activeShot) === 0}
                                    onClick={() => {
                                        const index = shots.indexOf(activeShot);
                                        const next = [...shots];
                                        [next[index - 1], next[index]] = [next[index], next[index - 1]];
                                        commitShots(next);
                                    }}
                                >
                                    ↑
                                </button>
                                <button
                                    type="button"
                                    className="ecom-chip"
                                    aria-label="这一行下移"
                                    disabled={shots.indexOf(activeShot) === shots.length - 1}
                                    onClick={() => {
                                        const index = shots.indexOf(activeShot);
                                        const next = [...shots];
                                        [next[index + 1], next[index]] = [next[index], next[index + 1]];
                                        commitShots(next);
                                    }}
                                >
                                    ↓
                                </button>
                                <button
                                    type="button"
                                    className="ecom-chip"
                                    aria-label="删除这一行"
                                    onClick={() => {
                                        const index = shots.indexOf(activeShot);
                                        commitShots(shots.filter((shot) => shot.id !== activeShot.id));
                                        setActiveShotId(shots[index + 1]?.id || shots[index - 1]?.id || null);
                                    }}
                                >
                                    <X className="size-3" />
                                </button>
                                <button
                                    type="button"
                                    className="ecom-chip"
                                    disabled={!generateEcommerceShotSet || generatingShotId === activeShot.id}
                                    title="改完这一行的构图、光线、背景，直接出这一张"
                                    onClick={() => void generate([activeShot.id])}
                                >
                                    {generatingShotId === activeShot.id ? <LoaderCircle className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
                                    出这一张
                                </button>
                            </span>
                            <input
                                className="ecom-field-input"
                                value={activeShot.title}
                                placeholder="这一张叫什么，例如「主图1 · 核心展示」"
                                onChange={(event) => patchShot(activeShot.id, { title: event.target.value })}
                            />
                            {SHOT_FIELDS.map((field) => (
                                <label key={field.key} className="ecom-field">
                                    <span className="ecom-field-label">{field.label}</span>
                                    <textarea
                                        className="ecom-field-input thin-scrollbar"
                                        rows={field.key === "composition" || field.key === "negative" ? 2 : 1}
                                        value={activeShot[field.key]}
                                        placeholder={field.placeholder}
                                        onChange={(event) => patchShot(activeShot.id, { [field.key]: event.target.value } as Partial<EcommerceShot>)}
                                    />
                                </label>
                            ))}
                        </div>
                    ) : null}

                    <button type="button" className="ecom-action" onClick={() => { const shot = createEcommerceShot("新的一张"); commitShots([...shots, shot]); setActiveShotId(shot.id); }}>
                        <Plus className="size-3" />
                        加一行
                    </button>
                </div>
            ) : null}

            <footer className="ecom-card-footer">
                <span>{unclaimed.length ? <>有 <b>{unclaimed.length}</b> 行没有图认领</> : <>清单 <b>{shots.length}</b> 行，全部有图认领</>}</span>
                {editable ? (
                    <button type="button" className="ecom-card-footer-action ecom-action" onClick={() => setEditing((value) => !value)} aria-expanded={editing}>
                        {editing ? "收起" : "编辑清单"}
                        <ChevronDown className="size-3" style={{ transform: editing ? "rotate(180deg)" : undefined, transition: "transform 140ms cubic-bezier(.16,1,.3,1)" }} />
                    </button>
                ) : null}
            </footer>
        </div>
    );
}

function lightLabel(light: ReturnType<typeof ecommerceShotDiagram>["light"]) {
    return light === "left" ? "左上方" : light === "right" ? "右上方" : light === "back" ? "侧逆光" : "正面柔和光";
}

/** 光向箭头摆在画面外侧，避免压住商品框。 */
function lightArrowStyle(light: ReturnType<typeof ecommerceShotDiagram>["light"]) {
    switch (light) {
        case "left": return { left: "-4px", top: "8px" } as const;
        case "right": return { right: "-4px", top: "8px" } as const;
        case "back": return { right: "-4px", bottom: "8px" } as const;
        default: return { left: "50%", top: "-6px", transform: "translateX(-50%)" } as const;
    }
}
