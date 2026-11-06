import { App, Button, Input, Spin } from "antd";
import { Sparkles } from "lucide-react";
import { nanoid } from "nanoid";
import { useMemo, useRef, useState } from "react";
import { ModelPicker } from "@/components/model-picker";
import { SegmentedControl } from "@/components/ui/base/segmented-control";
import { AppModal } from "@/components/ui/product/app-modal/app-modal";
import { DEFAULT_ECOMMERCE_BRIEF } from "@/lib/ecommerce/ecommerce-capabilities";
import { buildEcommerceImageGeneration } from "@/lib/ecommerce/ecommerce-image-generation";
import { studioImageRequest, STUDIO_PREFERRED_TIER } from "@/lib/ecommerce-studio/image-options";
import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import type { ProductVideoImage } from "@/lib/product-video/job";
import { buildRemakePersonaPrompt, REMAKE_PERSONA_DEFAULT, REMAKE_PERSONA_OPTIONS, remakePersonaLabel, type RemakePersona } from "@/lib/remake/persona";
import { getActiveUserScope } from "@/lib/user-scope";
import { parseBackendGenerationResult, submitBackendGenerationTask } from "@/services/api/generation-task";
import { resourceIdFromStorageKey } from "@/services/api/resources";
import { waitForGenerationTask } from "@/services/api/task-center";
import { selectableModelsByCapability, type AiConfig } from "@/stores/use-config-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import { productVideoThumbUrl } from "../replace/product-video-assets";

const IMAGE_TIMEOUT_MS = 10 * 60_000;

type Field = Exclude<keyof RemakePersona, "note">;
const FIELDS: { key: Field; label: string }[] = [
    { key: "gender", label: "性别" },
    { key: "age", label: "年龄" },
    { key: "look", label: "长相" },
    { key: "body", label: "体型" },
    { key: "style", label: "穿搭" },
];

/** 用图片模型出一张模特全身照（3:4，1K），按所选模型计费；结果直接放进模特图。 */
async function generatePersona(config: AiConfig, model: string, persona: RemakePersona, signal: AbortSignal) {
    const profile = modelCapabilityConfigFor(config, model).image;
    const request = studioImageRequest(profile, STUDIO_PREFERRED_TIER, "3:4");
    const node = { id: "remake-persona", type: CanvasNodeType.Image, title: "", width: 0, height: 0, position: { x: 0, y: 0 }, metadata: { model } } as unknown as CanvasNodeData;
    const generation = buildEcommerceImageGeneration(
        config,
        node,
        { ...DEFAULT_ECOMMERCE_BRIEF, ...(request.aspectRatio ? { aspectRatio: request.aspectRatio } : {}), imageSettings: request.imageSettings },
        { textCount: 0, imageCount: 0, videoCount: 0, audioCount: 0, characterCount: 0 },
    );
    const task = await submitBackendGenerationTask({ mode: "image", prompt: buildRemakePersonaPrompt(persona), config: generation.config, signal, clientOperationId: `remake-persona-${nanoid(10)}`, metadata: { source: "video-remake-persona" } });
    const done = await waitForGenerationTask(task.id, { initialTask: task, signal, timeoutMs: IMAGE_TIMEOUT_MS });
    const image = parseBackendGenerationResult(done).images?.[0];
    const resourceId = resourceIdFromStorageKey(image?.storageKey);
    if (!resourceId) throw new Error("任务完成但没有可用的图片，请到任务中心核对");
    return { id: nanoid(10), resourceId, name: `AI 模特 · ${remakePersonaLabel(persona)}`, ...(image?.width ? { width: image.width } : {}), ...(image?.height ? { height: image.height } : {}) } satisfies ProductVideoImage;
}

/** AI 生成模特：选性别、年龄、长相、体型和穿搭，生成一位原创模特放进模特图。 */
export function RemakePersonaModal({ config, left, onClose, onAdd }: { config: AiConfig; left: number; onClose: () => void; onAdd: (image: ProductVideoImage) => void }) {
    const { message } = App.useApp();
    const models = useMemo(() => selectableModelsByCapability(config, "image"), [config]);
    const [model, setModel] = useState(() => (models.includes(config.imageModel) ? config.imageModel : models[0] || ""));
    const [persona, setPersona] = useState<RemakePersona>(REMAKE_PERSONA_DEFAULT);
    const [running, setRunning] = useState(false);
    const [result, setResult] = useState<ProductVideoImage>();
    const controller = useRef<AbortController | undefined>(undefined);
    const run = async () => {
        if (!model) {
            message.warning("请先选择图片模型");
            return;
        }
        controller.current = new AbortController();
        const scope = getActiveUserScope();
        setRunning(true);
        setResult(undefined);
        try {
            const image = await generatePersona(config, model, persona, controller.current.signal);
            if (getActiveUserScope() === scope) setResult(image);
        } catch (error) {
            if (!controller.current?.signal.aborted) message.error(error instanceof Error ? error.message : "生成失败");
        } finally {
            setRunning(false);
        }
    };
    const close = () => {
        controller.current?.abort();
        onClose();
    };
    return (
        <AppModal open onCancel={close} footer={null} width={640} centered title="AI 生成模特">
            <div className="rw-persona">
                <div className="rw-persona-form">
                    {FIELDS.map(({ key, label }) => (
                        <div key={key} className="rw-persona-row">
                            <span>{label}</span>
                            <SegmentedControl<string>
                                ariaLabel={label}
                                size="sm"
                                value={persona[key]}
                                disabled={running}
                                onChange={(value) => setPersona((current) => ({ ...current, [key]: value }))}
                                options={REMAKE_PERSONA_OPTIONS[key].map((item) => ({ value: item.value, label: item.label }))}
                            />
                        </div>
                    ))}
                    <Input.TextArea
                        value={persona.note}
                        maxLength={120}
                        autoSize={{ minRows: 1, maxRows: 3 }}
                        disabled={running}
                        placeholder="补充（可选）：短发、戴细框眼镜、浅色系穿搭…"
                        onChange={(event) => setPersona((current) => ({ ...current, note: event.target.value }))}
                        aria-label="补充要求"
                    />
                    <ModelPicker config={config} capability="image" value={model} onChange={setModel} fullWidth showSelectedPrice showOptionPrices placeholder="选择图片模型" />
                    <p className="rw-hint">只生成成年人，人物是原创的，不模仿真人或明星。按所选图片模型计费。</p>
                </div>
                <div className="rw-persona-preview" data-empty={!result || undefined}>
                    {result ? <img src={productVideoThumbUrl(result.resourceId)} alt={result.name} /> : running ? <Spin /> : <Sparkles size={22} aria-hidden />}
                </div>
            </div>
            <footer className="rw-persona-foot">
                <Button onClick={close}>{result ? "不用这张" : "取消"}</Button>
                <Button loading={running} disabled={!model} onClick={() => void run()}>
                    {result ? "换一张" : "生成"}
                </Button>
                <Button
                    type="primary"
                    disabled={!result || left <= 0}
                    onClick={() => {
                        if (!result) return;
                        onAdd(result);
                        onClose();
                    }}
                >
                    放进模特图
                </Button>
            </footer>
        </AppModal>
    );
}
