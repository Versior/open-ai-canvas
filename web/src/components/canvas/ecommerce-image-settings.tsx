import { useRef } from "react";
import { Button } from "antd";
import { ImageParameterFields, ImageParameterInput } from "@/components/image-parameter-fields";
import { ImageSizePicker } from "@/components/image-size-picker";
import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import { defaultImageParamsForModel } from "@/lib/model-selection";
import { imageSizePresets } from "@/lib/image-size-presets";
import { ecommerceImageSettings, type EcommerceImageSettings } from "@/lib/ecommerce/ecommerce-image-generation";
import type { EcommerceWorkbenchBrief } from "@/lib/ecommerce/ecommerce-capabilities";
import type { AiConfig } from "@/stores/use-config-store";

export function EcommerceImageSettings({ config, model, brief, disabled, onChange }: { config: AiConfig; model: string; brief: EcommerceWorkbenchBrief; disabled: boolean; onChange: (brief: Partial<EcommerceWorkbenchBrief>) => void }) {
    const profile = modelCapabilityConfigFor(config, model).image!;
    let error = "";
    let settings = { ...defaultImageParamsForModel(config, model), ...brief.imageSettings };
    try { settings = ecommerceImageSettings(config, model, brief); } catch (reason) { error = reason instanceof Error ? reason.message : "请重新选择生图参数"; }
    const current = useRef<EcommerceImageSettings>(settings);
    current.current = settings;
    const change = (key: keyof EcommerceImageSettings | "count", value: string) => {
        if (disabled || key === "count") return;
        current.current = { ...current.current, [key]: value };
        const size = current.current.size || "";
        const ratio = size.includes(":") ? size : imageSizePresets(profile).find((preset) => preset.size === size)?.ratio;
        onChange({ imageSettings: { ...current.current }, aspectRatio: ratio });
    };
    return <div className="ecommerce-image-settings" data-canvas-no-drag data-canvas-no-zoom data-canvas-wheel-scroll onPointerDown={(event) => event.stopPropagation()}>
        <p>以下设置用于整组生成和单张重生成，选项跟随图片模型。</p>
        {error ? <p role="alert">{error}</p> : null}
        <Button size="small" disabled={disabled} onClick={() => onChange({ imageSettings: defaultImageParamsForModel(config, model), aspectRatio: undefined })}>使用当前模型默认</Button>
        <fieldset disabled={disabled}>
            {profile.parameters ? <ImageParameterFields profile={profile} config={{ ...config, ...settings, model }} showCount={false} showTransparent={false} onChange={change} /> : <>
                <ImageSizePicker profile={profile} size={settings.size} quality={settings.quality} imageResolution={settings.imageResolution} onChange={(size, quality, resolution) => { change("size", size); if (quality !== undefined) change("quality", quality); if (resolution !== undefined) change("imageResolution", resolution); }} />
                {profile.quality.supported ? <div className="space-y-1.5"><div>质量</div><ImageParameterInput inlineChoices field={{ name: "quality", label: "质量", type: "string", values: profile.quality.values, default: profile.quality.default }} value={settings.quality} disabled={disabled} onChange={(value) => change("quality", String(value ?? "auto"))} /></div> : null}
            </>}
        </fieldset>
    </div>;
}
