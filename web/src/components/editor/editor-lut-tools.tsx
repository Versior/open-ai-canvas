import { App, Button, Slider } from "antd";
import { RefreshCw, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useEditorStoreContext } from "./editor-context";
import { MAX_LUT_FILE_BYTES, parseCubeLut, validateTimelineLut, type TimelineLut } from "@/lib/timeline/timeline-lut";
import { getLUTLibraryItem, listLUTLibrary, type LUTLibraryItem } from "@/services/api/lut-library";
import { getActiveUserScope } from "@/lib/user-scope";

export function EditorLutTools({ disabled, onBusyChange }: { disabled: boolean; onBusyChange?: (busy: boolean) => void }) {
    const { message } = App.useApp();
    const { project, dispatch } = useEditorStoreContext();
    const input = useRef<HTMLInputElement>(null);
    const [items, setItems] = useState<LUTLibraryItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [selecting, setSelecting] = useState(false);
    const [error, setError] = useState("");
    const [category, setCategory] = useState("");
    const [refresh, setRefresh] = useState(0);
    const scope = getActiveUserScope();
    const operation = useRef(0);
    useEffect(() => {
        onBusyChange?.(selecting);
        return () => onBusyChange?.(false);
    }, [selecting, onBusyChange]);
    useEffect(() => {
        const abort = new AbortController();
        setSelecting(false);
        setCategory("");
        setLoading(true);
        setError("");
        setItems([]);
        void listLUTLibrary(false, abort.signal)
            .then((values) => {
                if (!abort.signal.aborted && getActiveUserScope() === scope) setItems(values);
            })
            .catch((cause) => {
                if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : "滤镜库加载失败");
            })
            .finally(() => {
                if (!abort.signal.aborted) setLoading(false);
            });
        return () => {
            abort.abort();
            operation.current++;
        };
    }, [refresh, scope]);
    const lut = project?.colorLut;
    const set = (value: TimelineLut | null) => dispatch({ op: "setColorLut", payload: { lut: value } });
    const select = async (item: LUTLibraryItem) => {
        const version = ++operation.current;
        setSelecting(true);
        try {
            const detail = await getLUTLibraryItem(item.id);
            validateTimelineLut(detail.lut);
            if (version === operation.current && getActiveUserScope() === scope) set(detail.lut);
        } catch (cause) {
            if (version === operation.current) message.error(cause instanceof Error ? cause.message : "LUT 选用失败，请刷新滤镜库");
        } finally {
            if (version === operation.current) setSelecting(false);
        }
    };
    const importLut = async (file: File) => {
        const version = ++operation.current;
        setSelecting(true);
        try {
            if (!file.name.toLowerCase().endsWith(".cube")) throw new Error("请选择 .cube 文件");
            if (file.size > MAX_LUT_FILE_BYTES) throw new Error("LUT 文件不能超过 2 MB");
            const value = parseCubeLut(await file.text(), file.name);
            if (version === operation.current && getActiveUserScope() === scope) set(value);
        } catch (error) {
            if (version === operation.current) message.error(error instanceof Error ? error.message : "LUT 导入失败");
        } finally {
            if (version === operation.current) setSelecting(false);
        }
    };
    return (
        <div className="rw-lut-tools">
            <h3>成片 LUT 滤镜</h3>
            <p className="rw-hint">用于整条成片。预览可切换原色对比；导出会应用所选效果。</p>
            <div className="flex gap-2">
                <select aria-label="LUT 分类" value={category} onChange={(event) => setCategory(event.target.value)}>
                    <option value="">全部分类</option>
                    {[...new Set(items.map((item) => item.category))].map((name) => (
                        <option key={name} value={name}>
                            {name}
                        </option>
                    ))}
                </select>
                <Button size="small" aria-label="刷新滤镜库" icon={<RefreshCw size={14} />} loading={loading} disabled={selecting} onClick={() => setRefresh((value) => value + 1)}>
                    刷新
                </Button>
            </div>
            {error ? <p role="alert">滤镜库加载失败：{error}。可点击刷新重试。</p> : null}
            {loading ? <p role="status">正在加载滤镜库…</p> : null}
            {!loading && !error && !items.length ? <p className="rw-hint">暂无已启用滤镜，管理员可在后台 LUT 滤镜库上传。</p> : null}
            {selecting ? <p role="status">正在读取 LUT 色表…</p> : null}
            <div className="rw-lut-options" role="radiogroup" aria-label="LUT 滤镜">
                <button
                    type="button"
                    role="radio"
                    aria-checked={!lut}
                    disabled={disabled || selecting}
                    onClick={() => {
                        operation.current++;
                        set(null);
                    }}
                >
                    <strong>原色 · 不添加</strong>
                    <span>保留素材原始色彩</span>
                </button>
                {items
                    .filter((item) => !category || item.category === category)
                    .map((item) => (
                        <button key={item.id} type="button" role="radio" aria-checked={lut?.libraryId === item.id && lut?.libraryVersion === item.version} disabled={disabled || selecting} onClick={() => void select(item)}>
                            <strong>{item.name}</strong>
                            <span>{item.description || `${item.category} · ${item.cubeSize} 阶`}</span>
                        </button>
                    ))}
                {lut && (!lut.libraryId || !items.some((item) => item.id === lut.libraryId && item.version === lut.libraryVersion)) ? (
                    <button type="button" role="radio" aria-checked disabled={disabled}>
                        <strong>{lut.name}</strong>
                        <span>{lut.libraryId ? "已保存的作品滤镜快照" : `已导入 ${lut.cube?.size || 17} 阶 3D LUT`}</span>
                    </button>
                ) : null}
            </div>
            <Button icon={<Upload size={14} />} disabled={disabled || selecting} onClick={() => input.current?.click()}>
                导入 .cube LUT
            </Button>
            <p className="rw-hint">支持 2–33 阶 SDR 3D LUT，最大 2 MB。Log 素材请使用匹配相机的转换 LUT。</p>
            {lut ? (
                <div>
                    <label id="lut-strength-label">滤镜强度 · {Math.round(lut.strength * 100)}%</label>
                    <Slider ariaLabelledByForHandle="lut-strength-label" min={0} max={100} value={Math.round(lut.strength * 100)} disabled={disabled || selecting} onChange={(value) => set({ ...lut, strength: value / 100 })} />
                </div>
            ) : null}
            <input
                ref={input}
                hidden
                type="file"
                accept=".cube"
                disabled={disabled || selecting}
                onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void importLut(file);
                    event.target.value = "";
                }}
            />
        </div>
    );
}
