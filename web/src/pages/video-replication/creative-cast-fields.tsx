import { useState } from "react";
import { SegmentedControl } from "@/components/ui/base/segmented-control";
import { creativeNeedsPerson, creativeNeedsSpeech, createCreativeJob, type CreativeBrief, type CreativeCast } from "@/lib/remake/creative";
import { addRemakeModels } from "@/lib/remake/job";
import type { AiConfig } from "@/stores/use-config-store";
import type { ProductVideoImage } from "@/lib/product-video/job";
import { ProductVideoImageSlot } from "./replace/product-video-assets";
import { RemakePersonaModal } from "./remake/remake-persona";
import { RemakeLanguageField, RemakeVoiceFields } from "./remake/remake-sound";
import type { RemakeEdit } from "./remake/remake-recipe";

/** 首页复用作品配方的素材、模特与音色能力，首次策划前就确定演员和声音。 */
export function CreativeCastFields({
    scene,
    value,
    config,
    subjectImages,
    disabled,
    onChange,
    onPendingChange,
}: {
    scene: CreativeBrief["scene"];
    value: CreativeCast;
    config: AiConfig;
    subjectImages?: ProductVideoImage[];
    disabled: boolean;
    onChange: (value: CreativeCast) => void;
    onPendingChange: (pending: boolean) => void;
}) {
    const [persona, setPersona] = useState(false);
    const [pending, setPending] = useState({ models: false, backgrounds: false });
    const job = { ...createCreativeJob("cast-preview"), ...value };
    const edit: RemakeEdit = (update) => {
        const next = update(job);
        onChange({ people: next.people, models: next.models, backgrounds: next.backgrounds, audio: next.audio, language: next.language, voice: next.voice });
    };
    const upload = (slot: keyof typeof pending, active: boolean) => {
        const next = { ...pending, [slot]: active };
        setPending(next);
        onPendingChange(next.models || next.backgrounds);
    };
    return (
        <section className="vc-cast" aria-label="人物场景与声音">
            <div>
                <h3>{creativeNeedsPerson(scene) ? "出镜人物 · 必填" : "出镜人物"}</h3>
                {value.people === "model" && subjectImages?.length ? (
                    <button
                        type="button"
                        disabled={disabled}
                        onClick={() =>
                            onChange({
                                ...value,
                                models: addRemakeModels(
                                    value.models,
                                    subjectImages.slice(0, 1).map((image) => ({ ...image, role: "figure" })),
                                ),
                            })
                        }
                    >
                        使用主体图作人物参考
                    </button>
                ) : null}
                <SegmentedControl
                    ariaLabel="创作人物"
                    value={value.people}
                    size="sm"
                    disabled={disabled}
                    onChange={(people) => onChange({ ...value, people })}
                    options={[
                        { value: "model", label: "人物出镜" },
                        { value: "none", label: "不露脸", disabled: creativeNeedsPerson(scene) },
                    ]}
                />
                {value.people === "model" ? (
                    <ProductVideoImageSlot
                        slot="models"
                        items={value.models}
                        disabled={disabled}
                        hint="上传同一人物的人脸或全身图，每段共用身份"
                        onPendingChange={(active) => upload("models", active)}
                        onAdd={(images) => onChange({ ...value, models: addRemakeModels(value.models, images) })}
                        onRemove={(id) => onChange({ ...value, models: value.models.filter((image) => image.id !== id) })}
                        generate={{ label: "AI 生成模特", onClick: () => setPersona(true) }}
                    />
                ) : (
                    <p>不出现人脸，可拍手部操作。人物口播请切换为人物出镜。</p>
                )}
            </div>
            <div>
                <h3>场景参考</h3>
                <ProductVideoImageSlot
                    slot="backgrounds"
                    items={value.backgrounds}
                    disabled={disabled}
                    hint="可选；没有图片时按脚本设计统一环境"
                    onPendingChange={(active) => upload("backgrounds", active)}
                    onAdd={(images) => onChange({ ...value, backgrounds: [...value.backgrounds, ...images].slice(0, 3) })}
                    onRemove={(id) => onChange({ ...value, backgrounds: value.backgrounds.filter((image) => image.id !== id) })}
                />
            </div>
            <div>
                <h3>声音</h3>
                <SegmentedControl
                    ariaLabel="创作声音"
                    value={value.audio}
                    size="sm"
                    disabled={disabled}
                    onChange={(audio) => onChange({ ...value, audio })}
                    options={[
                        { value: "rewrite", label: "人物口播" },
                        { value: "voice", label: "统一旁白", disabled: creativeNeedsSpeech(scene) },
                        { value: "mute", label: "无台词", disabled: creativeNeedsSpeech(scene) },
                    ]}
                />
                {value.audio !== "mute" ? <RemakeLanguageField job={job} edit={edit} disabled={disabled} /> : null}
                {value.audio === "voice" ? <RemakeVoiceFields job={job} edit={edit} config={config} disabled={disabled} /> : null}
                <p>{value.audio === "rewrite" ? "视频模型生成台词与口型，需支持声音；身份参考不保证跨段音色一致。" : value.audio === "voice" ? "每段使用同一音色生成旁白，不驱动人物口型。" : "保留环境声设计，不写口播台词。"}</p>
            </div>
            {persona ? (
                <RemakePersonaModal
                    config={config}
                    left={3 - value.models.length}
                    onClose={() => setPersona(false)}
                    onAdd={(image) => {
                        onChange({ ...value, people: "model", models: addRemakeModels(value.models, [image]) });
                        setPersona(false);
                    }}
                />
            ) : null}
        </section>
    );
}
