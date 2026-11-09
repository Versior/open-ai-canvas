import { App, Button, Slider } from "antd";
import { Upload } from "lucide-react";
import { useRef } from "react";
import { useEditorStoreContext } from "./editor-context";
import { MAX_LUT_FILE_BYTES, parseCubeLut, TIMELINE_LUT_PRESETS, type TimelineLut } from "@/lib/timeline/timeline-lut";

export function EditorLutTools({ disabled }: { disabled: boolean }) {
    const { message } = App.useApp();
    const { project, dispatch } = useEditorStoreContext();
    const input = useRef<HTMLInputElement>(null);
    const lut = project?.colorLut;
    const set = (value: TimelineLut | null) => dispatch({ op: "setColorLut", payload: { lut: value } });
    const importLut = async (file: File) => {
        try {
            if (!file.name.toLowerCase().endsWith(".cube")) throw new Error("请选择 .cube 文件");
            if (file.size > MAX_LUT_FILE_BYTES) throw new Error("LUT 文件不能超过 2 MB");
            set(parseCubeLut(await file.text(), file.name));
        } catch (error) {
            message.error(error instanceof Error ? error.message : "LUT 导入失败");
        }
    };
    return (
        <div className="rw-lut-tools">
            <h3>成片 LUT 滤镜</h3>
            <p className="rw-hint">用于整条成片。预览可切换原色对比；导出会应用所选效果。</p>
            <div className="rw-lut-options" role="radiogroup" aria-label="LUT 滤镜">
                <button type="button" role="radio" aria-checked={!lut} disabled={disabled} onClick={() => set(null)}>
                    <strong>原色 · 不添加</strong>
                    <span>保留素材原始色彩</span>
                </button>
                {TIMELINE_LUT_PRESETS.map((preset) => (
                    <button key={preset.id} type="button" role="radio" aria-checked={lut?.preset === preset.id} disabled={disabled} onClick={() => set({ name: preset.label, preset: preset.id, strength: lut?.strength ?? 1 })}>
                        <strong>{preset.label}</strong>
                        <span>{preset.hint}</span>
                    </button>
                ))}
                {lut?.cube ? (
                    <button type="button" role="radio" aria-checked disabled={disabled}>
                        <strong>{lut.name}</strong>
                        <span>已导入 {lut.cube.size} 阶 3D LUT</span>
                    </button>
                ) : null}
            </div>
            <Button icon={<Upload size={14} />} disabled={disabled} onClick={() => input.current?.click()}>
                导入 .cube LUT
            </Button>
            <p className="rw-hint">支持 2–33 阶 SDR 3D LUT，最大 2 MB。Log 素材请使用匹配相机的转换 LUT。</p>
            {lut ? (
                <div>
                    <label id="lut-strength-label">滤镜强度 · {Math.round(lut.strength * 100)}%</label>
                    <Slider ariaLabelledByForHandle="lut-strength-label" min={0} max={100} value={Math.round(lut.strength * 100)} disabled={disabled} onChange={(value) => set({ ...lut, strength: value / 100 })} />
                </div>
            ) : null}
            <input
                ref={input}
                hidden
                type="file"
                accept=".cube"
                disabled={disabled}
                onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void importLut(file);
                    event.target.value = "";
                }}
            />
        </div>
    );
}
