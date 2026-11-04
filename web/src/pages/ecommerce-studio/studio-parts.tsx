import { Tooltip } from "antd";
import { Pencil } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ModelPicker } from "@/components/model-picker";
import type { ModelRequirements } from "@/lib/model-selection";
import { resourceFileUrl } from "@/services/api/resources";
import { selectableModelsByCapability, useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import type { StudioSaveState } from "./use-studio-store";

export function studioImageUrl(resourceId: string, thumbnail = false) {
    return `${resourceFileUrl(resourceId)}${thumbnail ? "?variant=thumbnail" : ""}`;
}

/** 生图台的文本 / 图片模型跟随全局默认，选中后写回全局默认，与创作页、工作台保持一致。 */
export function useStudioModel(kind: "text" | "image") {
    const config = useEffectiveConfig();
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const models = useMemo(() => selectableModelsByCapability(config, kind), [config, kind]);
    const configured = kind === "text" ? config.textModel : config.imageModel || config.model;
    const value = models.includes(configured) ? configured : models[0] || "";
    const change = useCallback(
        (model: string) => {
            updateConfig(kind === "text" ? "textModel" : "imageModel", model);
            if (kind === "image") updateConfig("model", model);
        },
        [kind, updateConfig],
    );
    return { config, models, value, change };
}

/** 带输入要求的模型选择：看不了图、接不住这么多参考图的模型会直接标出原因。 */
export function StudioModelPicker({ kind, imageCount, placeholder }: { kind: "text" | "image"; imageCount: number; placeholder: string }) {
    const { config, models, value, change } = useStudioModel(kind);
    const requirements = useMemo<ModelRequirements>(() => ({ capability: kind, input: { textCount: 0, imageCount, videoCount: 0, audioCount: 0, characterCount: 0 } }), [imageCount, kind]);
    if (!models.length) {
        return (
            <span className="es-inline-note" data-tone="warning">
                暂无可用的{kind === "text" ? "文本" : "图片"}模型，
                <a href="/settings?section=models" target="_blank" rel="noreferrer">
                    去模型设置
                </a>
            </span>
        );
    }
    return (
        <ModelPicker
            config={config}
            value={value}
            onChange={change}
            capability={kind}
            requirements={requirements}
            variant="creation"
            fullWidth
            className="creation-model-picker es-model-picker"
            showSelectedPrice={false}
            showOptionPrices
            placeholder={placeholder}
        />
    );
}

export function ratioValue(ratio: string) {
    const [width, height] = ratio.split(":").map(Number);
    return width > 0 && height > 0 ? width / height : 1;
}

export function ratioStyle(ratio: string): CSSProperties {
    return { ["--es-ratio" as string]: String(ratioValue(ratio)) };
}

const SAVE_LABEL: Record<StudioSaveState, string> = { saved: "已保存", dirty: "未保存", saving: "保存中…", error: "保存失败，点击重试" };

export function SaveBadge({ state, error, onRetry }: { state: StudioSaveState; error?: string; onRetry: () => void }) {
    if (state !== "error") {
        return (
            <span className="es-save" data-state={state} role="status">
                {SAVE_LABEL[state]}
            </span>
        );
    }
    return (
        <Tooltip title={error}>
            <button type="button" className="es-save" data-state="error" onClick={onRetry}>
                {SAVE_LABEL.error}
            </button>
        </Tooltip>
    );
}

/** 名称类字段：铅笔入口单击编辑，回车或失焦提交，Esc 放弃。 */
export function InlineName({ value, placeholder, onCommit }: { value: string; placeholder: string; onCommit: (value: string) => void }) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(value);
    const input = useRef<HTMLInputElement>(null);
    useEffect(() => {
        if (editing) input.current?.select();
    }, [editing]);
    if (editing) {
        return (
            <input
                ref={input}
                className="es-name-input"
                value={draft}
                maxLength={60}
                aria-label="商品名称"
                onChange={(event) => setDraft(event.target.value)}
                onBlur={() => {
                    setEditing(false);
                    if (draft.trim() !== value) onCommit(draft.trim());
                }}
                onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                    if (event.key === "Escape") {
                        setDraft(value);
                        setEditing(false);
                    }
                }}
            />
        );
    }
    return (
        <button
            type="button"
            className="es-name"
            onClick={() => {
                setDraft(value);
                setEditing(true);
            }}
            aria-label="修改商品名称"
        >
            <span>{value || placeholder}</span>
            <Pencil size={13} aria-hidden />
        </button>
    );
}
