import { App, Button, Checkbox, Input, Segmented, Select, Switch } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Copy, Download, FlaskConical, Pencil, Plus, RefreshCw, RotateCcw, Search, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AdminPageFrame } from "@/pages/admin/components/admin-shell";
import { AdminDataTable, AdminRowActions, AdminStatTile, AdminStatusBadge, AdminTableEmpty } from "@/pages/admin/components/admin-ui";
import { AdminModal } from "@/pages/admin/ui/overlays";
import {
    SOCIAL_VIDEO_PARSE_EXPORT_FORMAT,
    deleteSocialVideoParseAPI,
    duplicateSocialVideoParseAPI,
    exportSocialVideoParseAPIs,
    getSocialVideoParseOverview,
    importSocialVideoParseAPIs,
    resetSocialVideoParseAPI,
    setSocialVideoParseAPIEnabled,
    testSocialVideoParseAPI,
    testSocialVideoParseAPIs,
    type SocialVideoParseAPI,
    type SocialVideoParseAPIInput,
    type SocialVideoParseBatchTestResult,
    type SocialVideoParseImportResult,
    type SocialVideoParseOverview,
    type SocialVideoParseSettings,
    type SocialVideoParseTestResult,
} from "@/services/api/social-video-parse";
import { ParseAPIEditor } from "./parse-api-editor";
import { ParseLogsPanel } from "./parse-logs-panel";
import { ParseSettingsPanel } from "./parse-settings-panel";
import { importResultSummary, ParseSourcesPanel } from "./parse-sources-panel";
import { PARSE_STATUS_META, ParseHealthTrack, ParseTestResultView, formatLatency, formatParseClock, formatParseTime, platformName } from "./parse-shared";
import "./video-parse.css";

type View = "apis" | "sources" | "logs" | "settings";

/** 表格按导入时的尝试顺序排：和后端 orderSocialVideoParseAPIs 的排序口径一致（轮流在此基础上转圈，按权重随机时权重大的靠前）。 */
const ORDER_NOTES: Record<SocialVideoParseSettings["strategy"], (attempts: number) => string> = {
    priority: (attempts) => `轮询方式：优先级。导入时按下表从上往下试，最多 ${attempts} 条，停用的跳过。`,
    round_robin: (attempts) => `轮询方式：轮流。每次导入从下一条接口开始，最多试 ${attempts} 条，停用的跳过。`,
    weighted: (attempts) => `轮询方式：按权重随机。权重越大越常被先用，最多试 ${attempts} 条，停用的跳过。`,
    fastest: (attempts) => `轮询方式：最快优先。按平均耗时从快到慢试（即下表顺序），最多 ${attempts} 条，停用的跳过。`,
};

function compareAPIs(strategy: SocialVideoParseSettings["strategy"]) {
    const byPriority = (left: SocialVideoParseAPI, right: SocialVideoParseAPI) => left.priority - right.priority || left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
    if (strategy === "weighted") return (left: SocialVideoParseAPI, right: SocialVideoParseAPI) => right.weight - left.weight || byPriority(left, right);
    if (strategy === "fastest") {
        const latency = (api: SocialVideoParseAPI) => api.state.avgLatencyMs || Number.MAX_SAFE_INTEGER;
        return (left: SocialVideoParseAPI, right: SocialVideoParseAPI) => latency(left) - latency(right) || byPriority(left, right);
    }
    return byPriority;
}

/** 自动停用的接口什么时候会被自动重试：冷却期从最近一次失败算起，后台每分钟巡检一次。 */
function recoverHint(api: SocialVideoParseAPI, settings?: SocialVideoParseSettings) {
    if (api.status !== "auto_disabled" || !settings) return "";
    if (!settings.autoRecover) return "需手动恢复";
    const at = api.state.autoDisabledAt ? new Date(api.state.autoDisabledAt).getTime() + settings.recoverAfterMinutes * 60_000 : Number.NaN;
    if (Number.isNaN(at)) return "";
    return at <= Date.now() ? "即将自动重试" : `${formatParseClock(at)} 自动重试`;
}

function downloadJSON(filename: string, value: unknown) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 读导入文件 / 粘贴的清单：导出格式或直接是接口数组。 */
function parseImportText(text: string): SocialVideoParseAPIInput[] {
    const value: unknown = JSON.parse(text);
    const apis = Array.isArray(value) ? value : value && typeof value === "object" ? (value as { format?: unknown; apis?: unknown }).apis : undefined;
    const format = !Array.isArray(value) && value && typeof value === "object" ? (value as { format?: unknown }).format : undefined;
    if (format !== undefined && format !== SOCIAL_VIDEO_PARSE_EXPORT_FORMAT) throw new Error(`格式不对，应为 ${SOCIAL_VIDEO_PARSE_EXPORT_FORMAT}`);
    if (!Array.isArray(apis) || !apis.length) throw new Error("清单里没有接口");
    return apis as SocialVideoParseAPIInput[];
}

/**
 * 后台「视频解析接口」：用户粘贴的短视频链接靠这里的第三方接口解析和下载。
 * 接口按平台分类，按设置的方式轮询；连续失败自动停用、到点自动恢复；订阅源定时采集新接口。
 */
export default function VideoParsePage() {
    const { message, modal } = App.useApp();
    const [overview, setOverview] = useState<SocialVideoParseOverview | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState("");
    const [view, setView] = useState<View>("apis");
    const [platform, setPlatform] = useState("all");
    const [status, setStatus] = useState("all");
    const [keyword, setKeyword] = useState("");
    const [editing, setEditing] = useState<SocialVideoParseAPI | null>(null);
    const [editorOpen, setEditorOpen] = useState(false);
    const [testing, setTesting] = useState("");
    const [testResult, setTestResult] = useState<SocialVideoParseTestResult | null>(null);
    const [batchResult, setBatchResult] = useState<SocialVideoParseBatchTestResult | null>(null);
    const [batchTesting, setBatchTesting] = useState(false);
    const [importOpen, setImportOpen] = useState(false);
    const [importText, setImportText] = useState("");
    const [importAutoEnable, setImportAutoEnable] = useState(true);
    const [importing, setImporting] = useState(false);
    const importInputRef = useRef<HTMLInputElement>(null);
    const requestRef = useRef(0);

    const reload = useCallback(async () => {
        const request = ++requestRef.current;
        setLoading(true);
        try {
            const data = await getSocialVideoParseOverview();
            if (request !== requestRef.current) return;
            setOverview(data);
            setLoadError("");
        } catch (error) {
            if (request === requestRef.current) setLoadError(error instanceof Error ? error.message : "读取视频解析接口失败");
        } finally {
            if (request === requestRef.current) setLoading(false);
        }
    }, []);
    useEffect(() => {
        void reload();
    }, [reload]);

    const settings = overview?.settings;
    const strategy = settings?.strategy ?? "priority";
    const platforms = useMemo(() => overview?.platforms || [], [overview?.platforms]);
    const apis = useMemo(() => overview?.apis || [], [overview?.apis]);
    const visibleAPIs = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        return apis
            .filter(
                (api) =>
                    (platform === "all" || api.platforms.includes(platform)) &&
                    (status === "all" || api.status === status) &&
                    (!query || api.name.toLowerCase().includes(query) || api.url.toLowerCase().includes(query) || api.remark.toLowerCase().includes(query)),
            )
            .sort(compareAPIs(strategy));
    }, [apis, keyword, platform, status, strategy]);
    const platformFilters = useMemo(
        () => [{ id: "all", name: "全部", count: apis.length, available: true }, ...platforms.map((item) => ({ id: item.id, name: item.name, count: apis.filter((api) => api.platforms.includes(item.id)).length, available: item.available }))],
        [apis, platforms],
    );
    const stats = useMemo(() => {
        const recent = apis.flatMap((api) => api.state.recent);
        return {
            active: apis.filter((api) => api.status === "active").length,
            autoDisabled: apis.filter((api) => api.status === "auto_disabled").length,
            disabled: apis.filter((api) => api.status === "disabled").length,
            covered: platforms.filter((item) => item.available).length,
            rate: recent.length ? Math.round((recent.filter(Boolean).length / recent.length) * 100) : null,
        };
    }, [apis, platforms]);

    const openEditor = (api: SocialVideoParseAPI | null) => {
        setEditing(api);
        setEditorOpen(true);
    };
    const runAction = async (task: () => Promise<unknown>, success: string, failure: string) => {
        try {
            await task();
            message.success(success);
        } catch (error) {
            message.error(error instanceof Error ? error.message : failure);
        } finally {
            void reload();
        }
    };
    const testOne = async (api: SocialVideoParseAPI) => {
        setTesting(api.id);
        try {
            setTestResult(await testSocialVideoParseAPI({ id: api.id, platform: platform === "all" ? undefined : platform }));
        } catch (error) {
            message.error(error instanceof Error ? error.message : "测试接口失败");
        } finally {
            setTesting("");
            void reload();
        }
    };
    const testAll = async () => {
        setBatchTesting(true);
        try {
            setBatchResult(await testSocialVideoParseAPIs({ platform: platform === "all" ? undefined : platform }));
        } catch (error) {
            message.error(error instanceof Error ? error.message : "批量测试失败");
        } finally {
            setBatchTesting(false);
            void reload();
        }
    };
    const exportAll = async () => {
        try {
            const document = await exportSocialVideoParseAPIs();
            downloadJSON(`video-parse-apis-${new Date().toISOString().slice(0, 10)}.json`, document);
            message.success(`已导出 ${document.apis.length} 条接口，不含密钥`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "导出失败");
        }
    };
    const runImport = async () => {
        let items: SocialVideoParseAPIInput[];
        try {
            items = parseImportText(importText);
        } catch (error) {
            message.error(error instanceof Error ? `清单读不出来：${error.message}` : "清单读不出来");
            return;
        }
        setImporting(true);
        try {
            const result: SocialVideoParseImportResult = await importSocialVideoParseAPIs({ format: SOCIAL_VIDEO_PARSE_EXPORT_FORMAT, version: 1, apis: items, autoEnable: importAutoEnable });
            setImportOpen(false);
            setImportText("");
            if (result.errors.length)
                modal.warning({
                    title: `导入完成：${importResultSummary(result)}`,
                    content: (
                        <ul className="admin-video-parse-notes">
                            {result.errors.map((item) => (
                                <li key={item}>{item}</li>
                            ))}
                        </ul>
                    ),
                });
            else message.success(`导入完成：${importResultSummary(result)}`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "导入失败");
        } finally {
            setImporting(false);
            void reload();
        }
    };

    const orderField = strategy === "priority" || strategy === "round_robin" ? "priority" : strategy === "weighted" ? "weight" : null;
    const columns: ColumnsType<SocialVideoParseAPI> = [
        {
            title: "接口",
            key: "api",
            render: (_, api) => (
                <div className="admin-video-parse-api">
                    <div className="admin-video-parse-api-name">
                        <strong title={api.name}>{api.name}</strong>
                        {api.sourceId ? <span className="admin-video-parse-tag">订阅</span> : null}
                        {api.hasSecret ? <span className="admin-video-parse-tag">密钥</span> : null}
                    </div>
                    <div className="admin-video-parse-api-request" title={`${api.method} ${api.url}`}>
                        <span className="admin-video-parse-method">{api.method}</span>
                        <span className="admin-video-parse-mono admin-video-parse-ellipsis">{api.url}</span>
                    </div>
                    {api.remark ? (
                        <small className="admin-video-parse-ellipsis" title={api.remark}>
                            {api.remark}
                        </small>
                    ) : null}
                </div>
            ),
        },
        {
            title: "平台",
            key: "platforms",
            width: 170,
            render: (_, api) => (
                <div className="admin-video-parse-platforms">
                    {api.platforms.map((item) => (
                        <span key={item}>{platformName(platforms, item)}</span>
                    ))}
                </div>
            ),
        },
        {
            title: "状态",
            key: "status",
            width: 136,
            render: (_, api) => {
                const meta = PARSE_STATUS_META[api.status];
                const hint = recoverHint(api, settings);
                return (
                    <div className="admin-video-parse-state">
                        <div className="admin-video-parse-status">
                            <AdminStatusBadge label={meta.label} tone={meta.tone} title={api.state.autoDisabledReason || undefined} />
                            <Switch
                                size="small"
                                checked={api.enabled}
                                aria-label={`${api.enabled ? "停用" : "启用"}${api.name}`}
                                onChange={(checked) => void runAction(() => setSocialVideoParseAPIEnabled(api.id, checked), checked ? "接口已启用" : "接口已停用", "修改接口失败")}
                            />
                        </div>
                        {hint ? <small title={api.state.autoDisabledReason || undefined}>{hint}</small> : null}
                    </div>
                );
            },
        },
        {
            title: "最近调用",
            key: "health",
            width: 230,
            render: (_, api) => {
                const error = api.state.lastError;
                return (
                    <div className="admin-video-parse-health">
                        <div className="admin-video-parse-health-head">
                            <ParseHealthTrack recent={api.state.recent} successCount={api.state.successCount} failureCount={api.state.failureCount} />
                            {api.state.avgLatencyMs ? (
                                <span className="admin-video-parse-latency" title="平均耗时">
                                    {formatLatency(api.state.avgLatencyMs)}
                                </span>
                            ) : null}
                        </div>
                        <small className="admin-video-parse-health-line" title={error ? `${formatParseTime(api.state.lastFailureAt)} ${error}` : formatParseTime(api.state.lastCheckedAt)}>
                            <span>{api.state.lastCheckedAt ? formatParseClock(api.state.lastCheckedAt) : "还没调用过"}</span>
                            {error ? <span className="admin-video-parse-error admin-video-parse-ellipsis">{error}</span> : null}
                        </small>
                    </div>
                );
            },
        },
        ...(orderField
            ? [
                  {
                      title: orderField === "priority" ? "优先级" : "权重",
                      key: "order",
                      width: 76,
                      align: "center" as const,
                      render: (_: unknown, api: SocialVideoParseAPI) => <span className="admin-video-parse-order">{orderField === "priority" ? api.priority : api.weight}</span>,
                  },
              ]
            : []),
        {
            title: "操作",
            key: "actions",
            width: 208,
            fixed: "right",
            render: (_, api) => (
                <AdminRowActions
                    primary={{ label: testing === api.id ? "测试中…" : "测试", icon: <FlaskConical className="size-3.5" />, disabled: Boolean(testing), onClick: () => testOne(api) }}
                    visibleActionCount={1}
                    actions={[
                        { key: "edit", label: "编辑", icon: <Pencil className="size-3.5" />, onClick: () => openEditor(api) },
                        ...(api.status === "auto_disabled"
                            ? [{ key: "reset", label: "恢复使用", icon: <RotateCcw className="size-3.5" />, onClick: () => runAction(() => resetSocialVideoParseAPI(api.id), "已恢复，导入时会重新使用这条接口", "恢复失败") }]
                            : []),
                        { key: "copy", label: "复制", icon: <Copy className="size-3.5" />, onClick: () => runAction(() => duplicateSocialVideoParseAPI(api.id), "已复制一条（副本先停用）", "复制失败") },
                        {
                            key: "delete",
                            label: "删除",
                            icon: <Trash2 className="size-3.5" />,
                            danger: true,
                            confirm: { title: `删除接口「${api.name}」？`, description: "删除后它的调用统计也会清掉，不能恢复。", okText: "删除" },
                            onClick: () => runAction(() => deleteSocialVideoParseAPI(api.id), "接口已删除", "删除失败"),
                        },
                    ]}
                />
            ),
        },
    ];

    return (
        <AdminPageFrame
            title="视频解析接口"
            description="用户粘贴短视频链接时，由这里的第三方接口解析并下载视频。"
            scroll
            actions={
                <>
                    <Button icon={<FlaskConical className="size-4" />} loading={batchTesting} disabled={!apis.length} onClick={() => void testAll()}>
                        {platform === "all" ? "全部测试" : `测试${platformName(platforms, platform)}接口`}
                    </Button>
                    <Button icon={<Upload className="size-4" />} onClick={() => setImportOpen(true)}>
                        导入
                    </Button>
                    <Button icon={<Download className="size-4" />} disabled={!apis.length} onClick={() => void exportAll()}>
                        导出
                    </Button>
                    <Button type="primary" icon={<Plus className="size-4" />} onClick={() => openEditor(null)}>
                        新增接口
                    </Button>
                </>
            }
        >
            <div className="admin-video-parse">
                {loadError ? (
                    <div className="admin-video-parse-load-error" role="alert">
                        <span>{loadError}</span>
                        <Button size="small" onClick={() => void reload()}>
                            重新加载
                        </Button>
                    </div>
                ) : null}
                <div className="admin-video-parse-stats">
                    <AdminStatTile label="正常接口" value={stats.active} detail={`共 ${apis.length} 条`} />
                    <AdminStatTile label="自动停用" value={stats.autoDisabled} trend={stats.autoDisabled ? { value: "待恢复", tone: "warning" } : undefined} />
                    <AdminStatTile label="手动停用" value={stats.disabled} />
                    <AdminStatTile
                        label="可导入的平台"
                        value={`${stats.covered} / ${platforms.length || 7}`}
                        detail={
                            platforms
                                .filter((item) => item.available)
                                .map((item) => item.name)
                                .join("、") || "还没有"
                        }
                    />
                    <AdminStatTile label="最近成功率" value={stats.rate === null ? "—" : `${stats.rate}%`} detail="各接口最近 10 次" />
                </div>
                <Segmented
                    className="admin-video-parse-views"
                    aria-label="视频解析接口视图"
                    value={view}
                    onChange={(value) => setView(value as View)}
                    options={[
                        { label: `接口（${apis.length}）`, value: "apis" },
                        { label: `订阅源（${overview?.sources.length || 0}）`, value: "sources" },
                        { label: "调用记录", value: "logs" },
                        { label: "设置", value: "settings" },
                    ]}
                />
                {view === "apis" ? (
                    <div className="admin-video-parse-panel">
                        <div className="admin-video-parse-toolbar">
                            <div className="admin-video-parse-platform-filter" role="group" aria-label="按平台筛选">
                                {platformFilters.map((item) => (
                                    <button
                                        key={item.id}
                                        type="button"
                                        className="admin-video-parse-chip"
                                        aria-pressed={platform === item.id}
                                        title={item.id === "all" ? undefined : item.available ? `${item.name}有可用接口，用户可以导入这个平台的链接` : `${item.name}没有可用接口，用户粘贴这个平台的链接会提示暂不支持`}
                                        onClick={() => setPlatform(item.id)}
                                    >
                                        {item.id === "all" ? null : <span className="admin-video-parse-chip-dot" data-available={item.available} aria-hidden="true" />}
                                        <span>{item.name}</span>
                                        <span className="admin-video-parse-chip-count">{item.count}</span>
                                    </button>
                                ))}
                            </div>
                            <div className="admin-video-parse-toolbar-end">
                                <Select
                                    aria-label="按状态筛选"
                                    value={status}
                                    onChange={setStatus}
                                    options={[
                                        { label: "全部状态", value: "all" },
                                        { label: "正常", value: "active" },
                                        { label: "自动停用", value: "auto_disabled" },
                                        { label: "已停用", value: "disabled" },
                                    ]}
                                />
                                <Input aria-label="搜索接口" allowClear prefix={<Search className="size-4" />} placeholder="搜索名称、地址或备注" value={keyword} onChange={(event) => setKeyword(event.target.value)} />
                                <Button icon={<RefreshCw className="size-4" />} loading={loading} onClick={() => void reload()}>
                                    刷新
                                </Button>
                            </div>
                        </div>
                        {settings && apis.length ? (
                            <p className="admin-video-parse-order-note">
                                <span>{ORDER_NOTES[strategy](settings.maxAttempts)}</span>
                                <Button type="link" size="small" onClick={() => setView("settings")}>
                                    修改
                                </Button>
                            </p>
                        ) : null}
                        <AdminDataTable
                            table={{ rowKey: "id", loading, pagination: false, columns, dataSource: visibleAPIs, scroll: { x: orderField ? 1122 : 1046 } }}
                            empty={
                                apis.length ? (
                                    <AdminTableEmpty filtered />
                                ) : (
                                    <AdminTableEmpty
                                        title="还没有解析接口"
                                        description="用户粘贴的抖音、快手等链接要靠第三方解析接口下载视频。新增一条接口，或在「订阅源」里订阅一份接口清单。"
                                        action={
                                            <Button type="primary" icon={<Plus className="size-4" />} onClick={() => openEditor(null)}>
                                                新增接口
                                            </Button>
                                        }
                                    />
                                )
                            }
                        />
                    </div>
                ) : null}
                {view === "sources" && overview ? <ParseSourcesPanel sources={overview.sources} apis={apis} onChanged={() => void reload()} /> : null}
                {view === "logs" && overview ? <ParseLogsPanel logs={overview.logs} platforms={platforms} /> : null}
                {/* 设置页切走时不卸载，没保存的修改留在表单里。 */}
                {overview ? (
                    <div hidden={view !== "settings"}>
                        <ParseSettingsPanel settings={overview.settings} platforms={platforms} onSaved={() => void reload()} />
                    </div>
                ) : null}
            </div>
            <ParseAPIEditor
                open={editorOpen}
                api={editing}
                platforms={platforms}
                sampleLinks={overview?.settings.sampleLinks || {}}
                onClose={() => setEditorOpen(false)}
                onSaved={() => {
                    setEditorOpen(false);
                    void reload();
                }}
            />
            <AdminModal title="测试结果" open={Boolean(testResult)} onCancel={() => setTestResult(null)} footer={null} width={760}>
                {testResult ? <ParseTestResultView result={testResult} platforms={platforms} /> : null}
            </AdminModal>
            <AdminModal title="批量测试结果" open={Boolean(batchResult)} onCancel={() => setBatchResult(null)} footer={null} width={760}>
                {batchResult ? (
                    <div className="admin-video-parse-batch">
                        <p className="admin-video-parse-muted">{`测了 ${batchResult.results.length} 条，通过 ${batchResult.results.filter((item) => item.ok).length} 条。结果已计入各接口的运行状态。`}</p>
                        <ul>
                            {batchResult.results.map((item) => (
                                <li key={item.id || item.name}>
                                    <AdminStatusBadge label={item.ok ? "可用" : "失败"} tone={item.ok ? "success" : "error"} />
                                    <strong>{item.name}</strong>
                                    <span className="admin-video-parse-muted">{`${platformName(platforms, item.platform)} · ${formatLatency(item.latencyMs)}`}</span>
                                    {!item.ok ? <span className="admin-video-parse-error">{item.message}</span> : null}
                                </li>
                            ))}
                        </ul>
                        {batchResult.skipped.length ? (
                            <>
                                <p className="admin-video-parse-muted">没测的接口（在「设置」里给对应平台填测试链接后再测）：</p>
                                <ul className="admin-video-parse-notes">
                                    {batchResult.skipped.map((item) => (
                                        <li key={item}>{item}</li>
                                    ))}
                                </ul>
                            </>
                        ) : null}
                    </div>
                ) : null}
            </AdminModal>
            <AdminModal title="导入接口" open={importOpen} onCancel={() => !importing && setImportOpen(false)} onOk={() => void runImport()} okText="开始导入" okButtonProps={{ disabled: !importText.trim() }} confirmLoading={importing} width={720}>
                <div className="admin-video-parse-import">
                    <p className="admin-video-parse-muted">{`选择导出的 JSON 文件，或把接口清单粘贴到下面（格式 ${SOCIAL_VIDEO_PARSE_EXPORT_FORMAT}，也可以直接是接口数组）。请求方式、地址和请求体都相同的视为同一条，只更新定义，不重复添加；新接口先停用。`}</p>
                    <Button icon={<Upload className="size-4" />} onClick={() => importInputRef.current?.click()}>
                        选择文件
                    </Button>
                    <input
                        ref={importInputRef}
                        type="file"
                        accept="application/json,.json"
                        className="hidden"
                        aria-label="选择接口清单文件"
                        onChange={(event) => {
                            const file = event.target.files?.[0];
                            event.target.value = "";
                            if (file) void file.text().then(setImportText);
                        }}
                    />
                    <Input.TextArea
                        className="admin-video-parse-mono"
                        value={importText}
                        onChange={(event) => setImportText(event.target.value)}
                        autoSize={{ minRows: 8, maxRows: 16 }}
                        placeholder={`{ "format": "${SOCIAL_VIDEO_PARSE_EXPORT_FORMAT}", "apis": [ ... ] }`}
                    />
                    <Checkbox checked={importAutoEnable} onChange={(event) => setImportAutoEnable(event.target.checked)}>
                        导入后用各平台的测试链接测一遍，通过的直接启用
                    </Checkbox>
                </div>
            </AdminModal>
        </AdminPageFrame>
    );
}
