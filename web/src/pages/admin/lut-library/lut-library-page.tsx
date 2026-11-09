import { App, AutoComplete, Button, Form, Input, InputNumber } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Pencil, Plus, RefreshCw, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { MAX_LUT_FILE_BYTES, parseCubeLut, timelineLutCube, type CubeLut } from "@/lib/timeline/timeline-lut";
import { deleteLUTLibraryItem, getLUTLibraryItem, listLUTLibrary, lutLibraryQueryKey, saveLUTLibraryItem, type LUTLibraryItem, type LUTLibraryWrite } from "@/services/api/lut-library";
import { AdminPageFrame } from "../components/admin-shell";
import { AdminDataTable, AdminTableEmpty } from "../components/admin-ui";
import { AdminModal } from "../ui/overlays";
import { AdminSwitch } from "../ui/controls";
import { getActiveUserScope } from "@/lib/user-scope";

type EditorValues = Omit<LUTLibraryWrite, "cube" | "expectedVersion" | "defaultStrength"> & { strength: number };

export default function LUTLibraryPage() {
    const { message, modal } = App.useApp();
    const queryClient = useQueryClient();
    const scope = getActiveUserScope();
    const query = useQuery({ queryKey: [...lutLibraryQueryKey, scope, "admin"], queryFn: ({ signal }) => listLUTLibrary(true, signal) });
    const [keyword, setKeyword] = useState("");
    const [category, setCategory] = useState("");
    const [editor, setEditor] = useState<LUTLibraryItem | "new" | undefined>();
    const [busy, setBusy] = useState(false);
    const [cube, setCube] = useState<CubeLut>();
    const [fileName, setFileName] = useState("");
    const [fileError, setFileError] = useState("");
    const fileInput = useRef<HTMLInputElement>(null);
    const fileVersion = useRef(0);
    const [form] = Form.useForm<EditorValues>();
    const items = query.data || [];
    const categories = [...new Set(items.map((item) => item.category))];
    const reload = () => void queryClient.invalidateQueries({ queryKey: lutLibraryQueryKey });
    const mutate = async (operation: () => Promise<unknown>) => {
        setBusy(true);
        try {
            await operation();
            reload();
            return true;
        } catch (error) {
            message.error(error instanceof Error ? error.message : "LUT 操作失败");
            return false;
        } finally {
            setBusy(false);
        }
    };
    const open = (item?: LUTLibraryItem) => {
        fileVersion.current++;
        setCube(undefined);
        setFileName("");
        setFileError("");
        setEditor(item || "new");
        form.setFieldsValue(item ? { ...item, strength: Math.round(item.defaultStrength * 100) } : { name: "", category: "自定义", description: "", enabled: true, sortOrder: (items.at(-1)?.sortOrder || 0) + 10, strength: 100 });
    };
    const importFile = async (file: File) => {
        const version = ++fileVersion.current;
        setFileError("");
        setCube(undefined);
        setFileName("");
        setBusy(true);
        try {
            if (!file.name.toLowerCase().endsWith(".cube")) throw new Error("请选择 .cube 文件");
            if (file.size > MAX_LUT_FILE_BYTES) throw new Error("LUT 文件不能超过 2 MB");
            const parsed = parseCubeLut(await file.text(), file.name);
            if (version !== fileVersion.current) return;
            setCube(parsed.cube);
            setFileName(file.name);
            if (!form.getFieldValue("name")) form.setFieldValue("name", file.name.replace(/\.cube$/i, ""));
        } catch (error) {
            if (version === fileVersion.current) setFileError(error instanceof Error ? error.message : "LUT 文件无效");
        } finally {
            if (version === fileVersion.current) setBusy(false);
        }
    };
    const save = async () => {
        if (fileError) return;
        if (editor === "new" && !cube) {
            setFileError("请先上传有效的 .cube 文件");
            return;
        }
        let values: EditorValues;
        try {
            values = await form.validateFields();
        } catch {
            return;
        }
        await mutate(async () => {
            await saveLUTLibraryItem(
                {
                    name: values.name,
                    category: values.category,
                    description: values.description || "",
                    enabled: values.enabled,
                    sortOrder: values.sortOrder,
                    defaultStrength: values.strength / 100,
                    cube,
                    expectedVersion: typeof editor === "object" ? editor.version : undefined,
                },
                typeof editor === "object" ? editor.id : undefined,
            );
            setEditor(undefined);
            message.success("LUT 已保存，剪辑台刷新滤镜库后即可选用");
        });
    };
    const download = (item: LUTLibraryItem) =>
        mutate(async () => {
            const detail = await getLUTLibraryItem(item.id, true);
            const table = timelineLutCube(detail.lut);
            const lines = [`LUT_3D_SIZE ${table.size}`, `DOMAIN_MIN ${table.domainMin.join(" ")}`, `DOMAIN_MAX ${table.domainMax.join(" ")}`];
            for (let i = 0; i < table.values.length; i += 3)
                lines.push(
                    table.values
                        .slice(i, i + 3)
                        .map((v) => v.toFixed(6))
                        .join(" "),
                );
            const url = URL.createObjectURL(new Blob([lines.join("\n") + "\n"], { type: "text/plain" }));
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = `${item.name.replace(/[\\/:*?"<>|]/g, "_")}.cube`;
            anchor.click();
            window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        });
    const columns: ColumnsType<LUTLibraryItem> = [
        {
            title: "滤镜",
            dataIndex: "name",
            render: (_, item) => (
                <div>
                    <strong>{item.name}</strong>
                    <div className="text-xs text-[var(--admin-text-muted)]">{item.description || "暂无说明"}</div>
                </div>
            ),
        },
        { title: "分类", dataIndex: "category", width: 120 },
        { title: "色表", width: 110, render: (_, item) => `${item.preset ? "内置" : "自定义"} · ${item.cubeSize} 阶` },
        { title: "默认强度", width: 100, render: (_, item) => `${Math.round(item.defaultStrength * 100)}%` },
        { title: "排序", dataIndex: "sortOrder", width: 80 },
        {
            title: "启用",
            width: 80,
            render: (_, item) => <AdminSwitch aria-label={`启用 ${item.name}`} checked={item.enabled} disabled={busy} onChange={(enabled) => void mutate(() => saveLUTLibraryItem({ ...item, enabled, expectedVersion: item.version }, item.id))} />,
        },
        {
            title: "操作",
            width: 170,
            render: (_, item) => (
                <div className="flex gap-1">
                    <Button size="small" aria-label={`编辑 ${item.name}`} icon={<Pencil size={14} />} disabled={busy} onClick={() => open(item)} />
                    <Button size="small" aria-label={`下载 ${item.name}`} icon={<Download size={14} />} disabled={busy} onClick={() => void download(item)} />
                    <Button
                        size="small"
                        danger
                        aria-label={`删除 ${item.name}`}
                        icon={<Trash2 size={14} />}
                        disabled={busy}
                        onClick={() =>
                            modal.confirm({
                                title: `删除「${item.name}」？`,
                                content: "删除后新作品无法选用。已有作品保存了色表快照，仍可预览和导出。",
                                okText: "删除",
                                okButtonProps: { danger: true },
                                onOk: async () => {
                                    if (!(await mutate(() => deleteLUTLibraryItem(item)))) throw new Error("删除失败，请刷新后重试");
                                },
                            })
                        }
                    />
                </div>
            ),
        },
    ];
    const filtered = items.filter((item) => (!category || item.category === category) && `${item.name} ${item.description} ${item.category}`.toLowerCase().includes(keyword.toLowerCase().trim()));
    return (
        <AdminPageFrame
            title="LUT 滤镜库"
            description="统一管理成片调色预设。已启用的滤镜供剪辑台选用；作品保存快照，后续管理操作不改写已有作品。"
            actions={
                <div className="flex gap-2">
                    <Button icon={<RefreshCw size={16} />} loading={query.isFetching} onClick={reload}>
                        刷新
                    </Button>
                    <Button type="primary" icon={<Plus size={16} />} disabled={busy} onClick={() => open()}>
                        上传 LUT
                    </Button>
                </div>
            }
        >
            <div className="flex flex-wrap gap-3">
                <Input aria-label="搜索 LUT" placeholder="搜索名称、分类或说明" value={keyword} onChange={(event) => setKeyword(event.target.value)} style={{ maxWidth: 320 }} />
                <AutoComplete aria-label="筛选分类" options={categories.map((value) => ({ value }))} value={category} onChange={setCategory} placeholder="全部分类" allowClear style={{ width: 180 }} />
                <span className="text-sm">
                    {items.length} 个滤镜 · {items.filter((item) => item.enabled).length} 个已启用
                </span>
            </div>
            {query.error ? (
                <div role="alert">
                    滤镜库加载失败：{query.error.message}
                    <Button onClick={reload}>重试</Button>
                </div>
            ) : null}
            <AdminDataTable
                table={{ loading: query.isLoading, rowKey: "id", columns, dataSource: filtered, pagination: { pageSize: 20, showSizeChanger: true }, scroll: { x: 850 } }}
                empty={<AdminTableEmpty title="没有匹配的 LUT" description="调整筛选条件或上传 .cube 文件。" />}
            />
            <AdminModal
                title={editor === "new" ? "上传 LUT" : "编辑 LUT"}
                open={Boolean(editor)}
                confirmLoading={busy}
                okText="保存"
                onOk={() => void save()}
                onCancel={() => {
                    if (!busy) {
                        fileVersion.current++;
                        setEditor(undefined);
                    }
                }}
                width={560}
            >
                <Form form={form} layout="vertical" disabled={busy}>
                    <Form.Item name="name" label="名称" rules={[{ required: true, whitespace: true, max: 120 }]}>
                        <Input maxLength={120} />
                    </Form.Item>
                    <Form.Item name="category" label="分类" rules={[{ required: true, whitespace: true, max: 80 }]}>
                        <AutoComplete options={categories.map((value) => ({ value }))} maxLength={80} />
                    </Form.Item>
                    <Form.Item name="description" label="适用场景 / 色彩说明">
                        <Input.TextArea maxLength={500} rows={2} />
                    </Form.Item>
                    <div className="flex gap-4">
                        <Form.Item name="strength" label="默认强度 %" rules={[{ required: true }]}>
                            <InputNumber min={0} max={100} precision={0} />
                        </Form.Item>
                        <Form.Item name="sortOrder" label="排序（数字小的靠前）" rules={[{ required: true }]}>
                            <InputNumber min={0} max={100000} precision={0} />
                        </Form.Item>
                        <Form.Item name="enabled" label="启用" valuePropName="checked">
                            <AdminSwitch />
                        </Form.Item>
                    </div>
                    <Button icon={<Upload size={16} />} onClick={() => fileInput.current?.click()} disabled={busy}>
                        {editor === "new" ? "选择 .cube 文件" : "替换 .cube 文件"}
                    </Button>
                    <p className="mt-2 text-sm">{fileName ? `${fileName} · ${cube?.size} 阶 · 格式校验通过` : "支持 2–33 阶 SDR 3D LUT，最大 2 MB。编辑时不选文件则保留原色表。"}</p>
                    {fileError ? (
                        <p role="alert" className="text-red-500">
                            {fileError}
                        </p>
                    ) : null}
                    <input
                        ref={fileInput}
                        hidden
                        type="file"
                        accept=".cube"
                        disabled={busy}
                        onChange={(event) => {
                            const file = event.target.files?.[0];
                            if (file) void importFile(file);
                            event.target.value = "";
                        }}
                    />
                </Form>
            </AdminModal>
        </AdminPageFrame>
    );
}
