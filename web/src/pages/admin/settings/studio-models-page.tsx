import { App, Button, Input } from "antd";
import { ImageOff, Pencil, RefreshCw, Search, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppModal } from "@/components/ui/product/app-modal/app-modal";
import {
    batchAdminStudioModels,
    importAdminStudioModel,
    listAdminStudioModels,
    STUDIO_MODEL_GENDER_LABEL,
    STUDIO_MODEL_IMPORT_MAX_BYTES,
    STUDIO_MODEL_KIND_LABEL,
    studioModelImageUrl,
    updateAdminStudioModel,
    type StudioModelGender,
    type StudioModelInput,
    type StudioModelItem,
    type StudioModelKind,
    type StudioModelPage,
    type StudioModelStatusFilter,
} from "@/services/api/studio-models";
import { AdminPageFrame } from "../components/admin-shell";
import { AdminSearchInput } from "../components/admin-search-input";
import { AdminBatchBar, AdminEmpty, AdminStatusBadge, PaginationBar } from "../components/admin-ui";
import { AdminCallout, AdminCheckbox, AdminIconButton, AdminSegmented, AdminSelect, AdminSwitch } from "../ui/controls";
import "./studio-models-page.css";

const KINDS: StudioModelKind[] = ["face", "pose", "style"];
const PAGE_SIZE = 48;
const GENDER_OPTIONS = (Object.keys(STUDIO_MODEL_GENDER_LABEL) as StudioModelGender[]).map((value) => ({ value, label: STUDIO_MODEL_GENDER_LABEL[value] }));
type StatusFilter = "all" | Exclude<StudioModelStatusFilter, "">;
const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
    { value: "all", label: "全部状态" },
    { value: "enabled", label: "已上架" },
    { value: "disabled", label: "未上架" },
];
const KIND_HINT: Record<StudioModelKind, { category: string; prompt: string; note: string }> = {
    face: { category: "例如：东亚女性、欧美男性、儿童", prompt: "外貌描述，例如：东亚女性，二十多岁，鹅蛋脸，黑色齐肩短发，气质干净", note: "上传清晰的正脸或半身照。只上传已获得肖像使用授权的人像，AI 生成的人像也要确认可商用。" },
    pose: { category: "例如：站姿、坐姿、走动、手部展示", prompt: "姿势描述，例如：站姿，重心在右腿，左手叉腰，右手自然下垂，身体微侧", note: "上传姿势参考图（白模、线稿或照片都可以），出图时只参考身体姿势，不照搬服装和背景。" },
    style: { category: "例如：通勤、休闲、运动、街头", prompt: "造型描述，例如：米色西装外套配白T，低马尾，淡妆，干练知性", note: "模特样式靠文字描述妆发、穿搭和气质，示意图可选。" },
};

function tagsText(tags: string[]) {
    return tags.join("，");
}

function parseTags(text: string) {
    return text
        .split(/[,，、;；\s]+/)
        .map((tag) => tag.trim())
        .filter(Boolean)
        .slice(0, 12);
}

function emptyInput(kind: StudioModelKind): StudioModelInput {
    return { kind, name: "", category: "", gender: "", tags: [], prompt: "", consent: false, enabled: kind !== "face" };
}

function fileStem(file: File) {
    return file.name.replace(/\.[^.]+$/, "").slice(0, 60) || "未命名素材";
}

type EditorState = { mode: "create"; kind: StudioModelKind } | { mode: "edit"; item: StudioModelItem };

/** 新增或修改素材。新增时可一次选多张图，每张一条素材，名称取文件名，其余字段共用。 */
function StudioModelEditor({ state, onClose, onSaved }: { state: EditorState; onClose: () => void; onSaved: () => void }) {
    const { message } = App.useApp();
    const kind = state.mode === "create" ? state.kind : state.item.kind;
    const [draft, setDraft] = useState<StudioModelInput>(() => (state.mode === "edit" ? { ...state.item } : emptyInput(kind)));
    const [tags, setTags] = useState(() => (state.mode === "edit" ? tagsText(state.item.tags) : ""));
    const [files, setFiles] = useState<File[]>([]);
    const [progress, setProgress] = useState<{ done: number; total: number }>();
    const input = useRef<HTMLInputElement>(null);
    const hint = KIND_HINT[kind];
    const busy = Boolean(progress);
    const patch = (value: Partial<StudioModelInput>) => setDraft((current) => ({ ...current, ...value }));
    const needsImage = kind !== "style";
    const many = state.mode === "create" && files.length > 1;

    const pick = (list: FileList | null) => {
        const picked = Array.from(list || []).filter((file) => /^image\/(png|jpeg|webp)$/.test(file.type));
        const tooBig = picked.filter((file) => file.size > STUDIO_MODEL_IMPORT_MAX_BYTES);
        if (tooBig.length) message.warning(`${tooBig.length} 张图超过 12 MiB，已跳过`);
        const accepted = picked.filter((file) => file.size <= STUDIO_MODEL_IMPORT_MAX_BYTES).slice(0, 100);
        setFiles(accepted);
        if (accepted.length === 1 && !draft.name.trim()) patch({ name: fileStem(accepted[0]) });
    };

    const save = async () => {
        const value: StudioModelInput = { ...draft, name: draft.name.trim(), tags: parseTags(tags) };
        if (!many && !value.name) return void message.warning("请填写名称");
        if (kind === "face" && value.enabled && !value.consent) return void message.warning("人脸素材要先确认已获得肖像使用授权才能上架");
        if (kind === "style" && !value.prompt.trim()) return void message.warning("模特样式要写清造型描述");
        if (state.mode === "edit") {
            setProgress({ done: 0, total: 1 });
            try {
                await updateAdminStudioModel(state.item.id, value);
                message.success("已保存");
                onSaved();
            } catch (error) {
                message.error(error instanceof Error ? error.message : "保存失败");
            } finally {
                setProgress(undefined);
            }
            return;
        }
        if (needsImage && !files.length) return void message.warning("请先选择图片");
        const queue: (File | undefined)[] = files.length ? files : [undefined];
        let failed = 0;
        setProgress({ done: 0, total: queue.length });
        for (const [index, file] of queue.entries()) {
            try {
                await importAdminStudioModel({ ...value, name: many && file ? fileStem(file) : value.name }, file);
            } catch (error) {
                failed += 1;
                message.error(`${file?.name || value.name}：${error instanceof Error ? error.message : "导入失败"}`);
            }
            setProgress({ done: index + 1, total: queue.length });
        }
        setProgress(undefined);
        if (failed < queue.length) {
            message.success(failed ? `已导入 ${queue.length - failed} 条，${failed} 条失败` : `已导入 ${queue.length} 条`);
            onSaved();
        }
    };

    return (
        <AppModal open onCancel={busy ? undefined : onClose} title={state.mode === "create" ? `新增${STUDIO_MODEL_KIND_LABEL[kind]}` : `修改${STUDIO_MODEL_KIND_LABEL[kind]}`} width={560} footer={null} maskClosable={!busy}>
            <div className="studio-model-editor">
                <p className="studio-model-editor-note">{hint.note}</p>
                {state.mode === "create" ? (
                    <div className="studio-model-editor-files">
                        <Button icon={<Upload className="size-4" />} disabled={busy} onClick={() => input.current?.click()}>
                            {files.length ? `已选 ${files.length} 张，重新选择` : needsImage ? "选择图片（可多选）" : "选择示意图（可选）"}
                        </Button>
                        <span>PNG、JPEG 或 WebP，每张 12 MiB 以内；多选时每张一条素材，名称取文件名。</span>
                        <input ref={input} type="file" hidden multiple={needsImage} accept="image/png,image/jpeg,image/webp" onChange={(event) => pick(event.target.files)} />
                    </div>
                ) : state.item.hasImage ? (
                    <img className="studio-model-editor-preview" src={studioModelImageUrl(state.item, true)} alt={state.item.name} />
                ) : null}
                {many ? null : (
                    <label className="studio-model-field">
                        <span>名称</span>
                        <Input value={draft.name} maxLength={60} disabled={busy} onChange={(event) => patch({ name: event.target.value })} />
                    </label>
                )}
                <div className="studio-model-field-row">
                    <label className="studio-model-field">
                        <span>分类</span>
                        <Input value={draft.category} maxLength={24} placeholder={hint.category} disabled={busy} onChange={(event) => patch({ category: event.target.value })} />
                    </label>
                    {kind === "face" ? (
                        <label className="studio-model-field">
                            <span>性别</span>
                            <AdminSelect<StudioModelGender> ariaLabel="性别" appearance="field" value={draft.gender} options={GENDER_OPTIONS} disabled={busy} onChange={(gender) => patch({ gender })} />
                        </label>
                    ) : null}
                </div>
                <label className="studio-model-field">
                    <span>标签（逗号或空格分隔，最多 12 个）</span>
                    <Input value={tags} maxLength={240} disabled={busy} placeholder="例如：短发，清爽，通勤" onChange={(event) => setTags(event.target.value)} />
                </label>
                <label className="studio-model-field">
                    <span>{kind === "style" ? "造型描述（必填）" : "出图描述"}</span>
                    <Input.TextArea value={draft.prompt} maxLength={600} autoSize={{ minRows: 2, maxRows: 6 }} placeholder={hint.prompt} disabled={busy} onChange={(event) => patch({ prompt: event.target.value })} />
                </label>
                {kind === "face" ? (
                    <AdminCheckbox checked={draft.consent} disabled={busy} onChange={(event) => patch({ consent: event.target.checked, enabled: event.target.checked ? draft.enabled : false })}>
                        已获得这张人像的肖像使用授权（或确认是可商用的 AI 人像）
                    </AdminCheckbox>
                ) : null}
                <label className="studio-model-switch">
                    <AdminSwitch aria-label="上架" checked={draft.enabled} disabled={busy || (kind === "face" && !draft.consent)} onChange={(enabled) => patch({ enabled })} />
                    <span>{draft.enabled ? "上架：生图台用户可以选用" : "暂不上架：只在后台可见"}</span>
                </label>
                <footer className="studio-model-editor-foot">
                    <Button disabled={busy} onClick={onClose}>
                        取消
                    </Button>
                    <Button type="primary" loading={busy} onClick={() => void save()}>
                        {progress && progress.total > 1 ? `正在导入 ${progress.done}/${progress.total}` : "保存"}
                    </Button>
                </footer>
            </div>
        </AppModal>
    );
}

function statusOf(item: StudioModelItem): { label: string; tone: "success" | "warning" | "neutral" } {
    if (item.enabled) return { label: "已上架", tone: "success" };
    return item.kind === "face" && !item.consent ? { label: "待确认授权", tone: "warning" } : { label: "未上架", tone: "neutral" };
}

/** 后台「电商模特库」：维护生图台出模特图时可选的人脸、姿势和模特样式。 */
export default function StudioModelsPage() {
    const { message, modal } = App.useApp();
    const [kind, setKind] = useState<StudioModelKind>("face");
    // 输入框里的字和真正拿去查的关键词分开：停顿 300ms 再查，打字时不连发请求。
    const [search, setSearch] = useState("");
    const [query, setQuery] = useState("");
    const [category, setCategory] = useState("");
    const [status, setStatus] = useState<StatusFilter>("all");
    const [page, setPage] = useState(1);
    const [data, setData] = useState<StudioModelPage>();
    const [kindCounts, setKindCounts] = useState<Partial<Record<StudioModelKind, number>>>({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [selected, setSelected] = useState<string[]>([]);
    const [editor, setEditor] = useState<EditorState>();
    const [reload, setReload] = useState(0);

    // 换类型、筛选或翻页时清掉选择：批量操作只作用在眼前这一页看得到的素材上。
    const changeView = useCallback((apply: () => void, keepPage = false) => {
        apply();
        if (!keepPage) setPage(1);
        setSelected([]);
    }, []);

    useEffect(() => {
        const next = search.trim();
        if (next === query) return;
        const timer = setTimeout(() => changeView(() => setQuery(next)), 300);
        return () => clearTimeout(timer);
    }, [search, query, changeView]);

    useEffect(() => {
        const controller = new AbortController();
        setLoading(true);
        setError("");
        void listAdminStudioModels({ kind, q: query, category, status: status === "all" ? "" : status, page, pageSize: PAGE_SIZE }, controller.signal)
            .then((value) => {
                if (controller.signal.aborted) return;
                if (value.kindCounts) setKindCounts(value.kindCounts);
                // 批量删除后当前页可能空了，退回最后一页。
                const pages = Math.max(1, Math.ceil(value.total / PAGE_SIZE));
                if (!value.items.length && page > pages) {
                    setPage(pages);
                    return;
                }
                setData(value);
            })
            .catch((failure) => {
                if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "读取失败");
            })
            .finally(() => {
                if (!controller.signal.aborted) setLoading(false);
            });
        return () => controller.abort();
    }, [kind, query, category, status, page, reload]);

    const refresh = useCallback(() => {
        setSelected([]);
        setReload((value) => value + 1);
    }, []);

    const runBatch = async (ids: string[], action: "enable" | "disable" | "delete") => {
        try {
            const result = await batchAdminStudioModels(ids, action);
            message.success(`${{ enable: "已上架", disable: "已下架", delete: "已删除" }[action]} ${result.affected} 条`);
            refresh();
        } catch (failure) {
            message.error(failure instanceof Error ? failure.message : "操作失败");
        }
    };

    const confirmDelete = (ids: string[]) =>
        modal.confirm({
            title: `删除 ${ids.length} 条素材？`,
            content: "删除后生图台不能再选用；用户已经选用过的会保留在他们自己的资源库里。",
            okText: "删除",
            okButtonProps: { danger: true },
            cancelText: "取消",
            onOk: () => runBatch(ids, "delete"),
        });

    const items = data?.items || [];
    const pageIds = items.map((item) => item.id);
    const allSelected = pageIds.length > 0 && pageIds.every((id) => selected.includes(id));
    const toggle = (id: string) => setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
    const filtered = Boolean(query || category || status !== "all");
    // 当前分类被删空后仍留在筛选条里标 0，免得选中项凭空消失。
    const categoryCounts = data?.categoryCounts ?? [];
    const chips = category && !categoryCounts.some((item) => item.name === category) ? [...categoryCounts, { name: category, count: 0 }] : categoryCounts;
    const clearFilters = () =>
        changeView(() => {
            setSearch("");
            setQuery("");
            setCategory("");
            setStatus("all");
        });

    return (
        <AdminPageFrame
            title="电商模特库"
            description="生图台出模特图时可选的模特人脸、姿势和模特样式；上架后生图台用户可见，人脸须确认肖像授权"
            scroll
            actions={
                <>
                    <Button icon={<RefreshCw className="size-4" />} disabled={loading} onClick={refresh}>
                        刷新
                    </Button>
                    <Button type="primary" icon={<Upload className="size-4" />} onClick={() => setEditor({ mode: "create", kind })}>
                        新增{STUDIO_MODEL_KIND_LABEL[kind]}
                    </Button>
                </>
            }
        >
            <div className="studio-models">
                <div className="studio-models-toolbar">
                    <AdminSegmented<StudioModelKind>
                        ariaLabel="素材类型"
                        value={kind}
                        onChange={(value) =>
                            changeView(() => {
                                setKind(value);
                                setCategory("");
                                setData(undefined);
                            })
                        }
                        options={KINDS.map((value) => ({
                            value,
                            label: (
                                <span className="studio-models-kind">
                                    {STUDIO_MODEL_KIND_LABEL[value]}
                                    {kindCounts[value] !== undefined ? <em>{kindCounts[value]}</em> : null}
                                </span>
                            ),
                        }))}
                    />
                    <AdminSearchInput className="studio-models-search" allowClear prefix={<Search className="size-3.5" aria-hidden />} placeholder="搜索名称、分类、标签或描述" value={search} onValueChange={setSearch} />
                    <AdminSelect<StatusFilter> ariaLabel="上架状态" className="studio-models-status" value={status} options={STATUS_OPTIONS} onChange={(value) => changeView(() => setStatus(value))} />
                </div>
                {chips.length ? (
                    <div className="studio-models-categories" role="group" aria-label="按分类筛选">
                        <button type="button" aria-pressed={!category} onClick={() => changeView(() => setCategory(""))}>
                            全部<em>{kindCounts[kind] ?? ""}</em>
                        </button>
                        {chips.map((item) => (
                            <button key={item.name} type="button" aria-pressed={category === item.name} onClick={() => changeView(() => setCategory(item.name))}>
                                {item.name}
                                <em>{item.count}</em>
                            </button>
                        ))}
                    </div>
                ) : null}
                <div className="studio-models-meta">
                    <AdminCheckbox checked={allSelected} indeterminate={selected.length > 0 && !allSelected} disabled={!items.length} onChange={(event) => setSelected(event.target.checked ? pageIds : [])}>
                        全选本页
                    </AdminCheckbox>
                    <span>{data ? (filtered ? `筛出 ${data.total} 条` : `共 ${data.total} 条`) : loading ? "读取中…" : ""}</span>
                </div>
                <AdminBatchBar count={selected.length} onClear={() => setSelected([])}>
                    <Button size="small" onClick={() => void runBatch(selected, "enable")}>
                        上架
                    </Button>
                    <Button size="small" onClick={() => void runBatch(selected, "disable")}>
                        下架
                    </Button>
                    <Button size="small" danger onClick={() => confirmDelete(selected)}>
                        删除
                    </Button>
                </AdminBatchBar>
                {error ? (
                    <AdminCallout
                        tone="error"
                        title="模特库读取失败"
                        action={
                            <Button size="small" onClick={refresh}>
                                重试
                            </Button>
                        }
                    >
                        {error}
                    </AdminCallout>
                ) : null}
                {data && !items.length && !error ? (
                    <AdminEmpty
                        title={filtered ? "没有符合条件的素材" : `还没有${STUDIO_MODEL_KIND_LABEL[kind]}`}
                        description={filtered ? "换个关键词或分类，或者清除筛选看全部。" : KIND_HINT[kind].note}
                        action={
                            filtered ? (
                                <Button onClick={clearFilters}>清除筛选</Button>
                            ) : (
                                <Button icon={<Upload className="size-4" />} onClick={() => setEditor({ mode: "create", kind })}>
                                    新增{STUDIO_MODEL_KIND_LABEL[kind]}
                                </Button>
                            )
                        }
                    />
                ) : null}
                <div className="studio-models-grid" aria-busy={loading}>
                    {!data && loading && !error
                        ? Array.from({ length: 12 }, (_, index) => <div key={index} className="studio-model-card is-placeholder" aria-hidden />)
                        : items.map((item) => {
                              const state = statusOf(item);
                              const checked = selected.includes(item.id);
                              return (
                                  <article key={item.id} className="studio-model-card" data-selected={checked || undefined} data-off={!item.enabled || undefined}>
                                      <div className="studio-model-thumb">
                                          {item.hasImage ? (
                                              <img src={studioModelImageUrl(item, true)} alt={item.name} loading="lazy" />
                                          ) : (
                                              <span className="studio-model-thumb-text">
                                                  <ImageOff className="size-4" aria-hidden />
                                                  {item.prompt.slice(0, 40)}
                                              </span>
                                          )}
                                          <AdminCheckbox className="studio-model-select" checked={checked} aria-label={`选择 ${item.name}`} onChange={() => toggle(item.id)} />
                                      </div>
                                      <div className="studio-model-body">
                                          <strong title={item.name}>{item.name}</strong>
                                          <span>{[item.category || "未分类", item.kind === "face" ? STUDIO_MODEL_GENDER_LABEL[item.gender] : ""].filter(Boolean).join(" · ")}</span>
                                          {item.tags.length ? (
                                              <span className="studio-model-tags" title={item.tags.join(" · ")}>
                                                  {item.tags.slice(0, 4).join(" · ")}
                                              </span>
                                          ) : null}
                                          <div className="studio-model-actions">
                                              <AdminSwitch size="sm" aria-label={item.enabled ? `下架 ${item.name}` : `上架 ${item.name}`} checked={item.enabled} onChange={(enabled) => void runBatch([item.id], enabled ? "enable" : "disable")} />
                                              <AdminStatusBadge label={state.label} tone={state.tone} />
                                              <span className="studio-model-tools">
                                                  <AdminIconButton icon={Pencil} aria-label={`修改 ${item.name}`} title="修改" onClick={() => setEditor({ mode: "edit", item })} />
                                                  <AdminIconButton icon={Trash2} className="studio-model-delete" aria-label={`删除 ${item.name}`} title="删除" onClick={() => confirmDelete([item.id])} />
                                              </span>
                                          </div>
                                      </div>
                                  </article>
                              );
                          })}
                </div>
                {data && data.total > PAGE_SIZE ? <PaginationBar current={page} pageSize={PAGE_SIZE} total={data.total} pageSizeOptions={[PAGE_SIZE]} onChange={(next) => changeView(() => setPage(next), true)} /> : null}
            </div>
            {editor ? (
                <StudioModelEditor
                    state={editor}
                    onClose={() => setEditor(undefined)}
                    onSaved={() => {
                        setEditor(undefined);
                        refresh();
                    }}
                />
            ) : null}
        </AdminPageFrame>
    );
}
