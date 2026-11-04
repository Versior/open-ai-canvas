import { App, Button } from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs from "dayjs";
import { BadgePercent, Ban, CircleOff, Eye, FolderTree, Pencil, RefreshCw, Search, Sparkles, Tag, Trash2, Upload, Wallet } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { AgentPetSprite } from "@/components/canvas/agent-pet-sprite";
import { formatCredits } from "@/constant/credits";
import { useMinuteClock } from "@/hooks/use-minute-clock";
import { AGENT_PET_ASPECT } from "@/lib/canvas/agent-pet";
import { agentPetCategories, agentPetDiscountLabel, formatAgentPetCountdown } from "@/lib/canvas/agent-pet-store";
import {
    agentPetPreviewURL,
    agentPetSpritesheetURL,
    batchDeleteAdminAgentPets,
    batchUpdateAdminAgentPets,
    deleteAdminAgentPet,
    listAdminAgentPets,
    updateAdminAgentPet,
    type AdminAgentPet,
    type AdminAgentPetBatchInput,
    type AdminAgentPetBatchResult,
    type AgentPetAccess,
} from "@/services/api/agent-pets";
import { listAdminUserGroups, type UserGroup } from "@/services/api/user-groups";
import { AdminPageFrame } from "../components/admin-shell";
import { AdminSearchInput } from "../components/admin-search-input";
import { AdminBatchBar, AdminDataTable, AdminRowActions, AdminStatTile, AdminStatusBadge, AdminTableEmpty } from "../components/admin-ui";
import { AdminSelect, AdminSwitch } from "../ui/controls";
import { AgentPetBatchDialog, type AgentPetBatchMode } from "./components/agent-pet-batch-dialog";
import { AgentPetCategoryManager } from "./components/agent-pet-category-manager";
import { agentPetInput, AgentPetEditor } from "./components/agent-pet-editor";
import { AgentPetImportDialog } from "./components/agent-pet-import-dialog";
import "./agent-pets-page.css";

const THUMB_HEIGHT = 56;
const THUMB_WIDTH = Math.round(THUMB_HEIGHT * AGENT_PET_ASPECT);
const ACCESS_LABELS: Record<AgentPetAccess, string> = { free: "免费", vip: "VIP 专享", paid: "积分购买", spend: "消费解锁" };
const UNCATEGORIZED = "__none";

type Filters = { query: string; category: string; access: "all" | AgentPetAccess; status: "all" | "on" | "off"; source: "all" | "builtin" | "upload"; promo: "all" | "active" | "scheduled" | "ended" };
const EMPTY_FILTERS: Filters = { query: "", category: "all", access: "all", status: "all", source: "all", promo: "all" };

/** 智能体样式：管理用户可更换的形象库（上架、分类、开放方式与价格、限时促销、批量导入与批量操作）。 */
export default function AgentPetsSettingsPage() {
    const { message, modal } = App.useApp();
    const [pets, setPets] = useState<AdminAgentPet[]>([]);
    const [groups, setGroups] = useState<UserGroup[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState("");
    const [editing, setEditing] = useState<AdminAgentPet | null>(null);
    const [editorOpen, setEditorOpen] = useState(false);
    const [togglingId, setTogglingId] = useState("");
    const [previewId, setPreviewId] = useState("");
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
    const [batchMode, setBatchMode] = useState<AgentPetBatchMode | null>(null);
    const [batchBusy, setBatchBusy] = useState("");
    const [importOpen, setImportOpen] = useState(false);
    const [categoryOpen, setCategoryOpen] = useState(false);
    const now = useMinuteClock();

    const load = useCallback(async () => {
        setLoading(true);
        setLoadError("");
        try {
            const [nextPets, nextGroups] = await Promise.all([listAdminAgentPets(), listAdminUserGroups()]);
            setPets(nextPets);
            setGroups(nextGroups.groups);
            setSelectedIds((ids) => ids.filter((id) => nextPets.some((pet) => pet.id === id)));
        } catch (error) {
            const text = error instanceof Error ? error.message : "读取形象库失败";
            setLoadError(text);
            message.error(text);
        } finally {
            setLoading(false);
        }
    }, [message]);

    useEffect(() => {
        void load();
    }, [load]);

    const replace = useCallback((saved: AdminAgentPet[]) => {
        setPets((items) => {
            const next = [...items];
            for (const pet of saved) {
                const index = next.findIndex((item) => item.id === pet.id);
                if (index >= 0) next[index] = pet;
                else next.push(pet);
            }
            return next.sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id));
        });
    }, []);

    const edit = useCallback((pet: AdminAgentPet) => {
        setEditing(pet);
        setEditorOpen(true);
    }, []);

    const toggle = useCallback(
        async (pet: AdminAgentPet, enabled: boolean) => {
            setTogglingId(pet.id);
            try {
                replace([await updateAdminAgentPet(pet.id, agentPetInput(pet, { enabled }))]);
                message.success(enabled ? `「${pet.name}」已上架` : `「${pet.name}」已下架，已拥有的用户仍可使用`);
            } catch (error) {
                message.error(error instanceof Error ? error.message : "更新上架状态失败");
            } finally {
                setTogglingId("");
            }
        },
        [message, replace],
    );

    const remove = useCallback(
        async (pet: AdminAgentPet) => {
            try {
                await deleteAdminAgentPet(pet.id);
                setPets((items) => items.filter((item) => item.id !== pet.id));
                setSelectedIds((ids) => ids.filter((id) => id !== pet.id));
                message.success("形象已删除");
            } catch (error) {
                message.error(error instanceof Error ? error.message : "删除形象失败");
            }
        },
        [message],
    );

    /** 批量结果：合并修改后的形象，有跳过的项时列出原因。 */
    const finishBatch = useCallback(
        (result: AdminAgentPetBatchResult, summary: string) => {
            replace(result.pets);
            if (result.deleted.length) {
                setPets((items) => items.filter((item) => !result.deleted.includes(item.id)));
                setSelectedIds((ids) => ids.filter((id) => !result.deleted.includes(id)));
            }
            if (!result.skipped.length) {
                message.success(summary);
                return;
            }
            modal.info({
                title: summary,
                content: (
                    <div className="space-y-1 text-sm">
                        <p className="text-foreground/60">以下 {result.skipped.length} 个形象没有处理：</p>
                        <ul className="max-h-60 list-disc space-y-0.5 overflow-y-auto pl-5">
                            {result.skipped.map((item) => (
                                <li key={item.id}>
                                    {item.name}：{item.reason}
                                </li>
                            ))}
                        </ul>
                    </div>
                ),
                okText: "知道了",
            });
        },
        [message, modal, replace],
    );

    const runBatch = async (key: string, input: Omit<AdminAgentPetBatchInput, "ids">, done: (count: number) => string) => {
        setBatchBusy(key);
        try {
            const result = await batchUpdateAdminAgentPets({ ids: selectedIds, ...input });
            finishBatch(result, done(result.pets.length));
        } catch (error) {
            message.error(error instanceof Error ? error.message : "批量操作失败");
        } finally {
            setBatchBusy("");
        }
    };

    const confirmEndPromotion = () =>
        modal.confirm({
            title: `结束所选 ${selectedIds.length} 个形象的促销？`,
            content: "结束后恢复原价，已按促销价购买的用户不受影响。",
            okText: "结束促销",
            cancelText: "取消",
            onOk: () => runBatch("end-promo", { promotion: { enabled: false } }, (count) => `已结束 ${count} 个形象的促销`),
        });

    const confirmDelete = () =>
        modal.confirm({
            title: `删除所选 ${selectedIds.length} 个形象？`,
            content: "只会删除没人购买或领取过的上传形象；内置形象和已有人拥有的形象会跳过，可以改为下架。删除后不可恢复。",
            okText: "删除",
            cancelText: "取消",
            okButtonProps: { danger: true },
            onOk: async () => {
                setBatchBusy("delete");
                try {
                    const result = await batchDeleteAdminAgentPets(selectedIds);
                    finishBatch(result, `已删除 ${result.deleted.length} 个形象`);
                } catch (error) {
                    message.error(error instanceof Error ? error.message : "批量删除失败");
                } finally {
                    setBatchBusy("");
                }
            },
        });

    const groupNames = useMemo(() => new Map(groups.map((group) => [group.code, group.name])), [groups]);
    const categories = useMemo(() => agentPetCategories(pets), [pets]);
    const categoryNames = useMemo(() => categories.map((category) => category.name), [categories]);
    const selectedPets = useMemo(() => pets.filter((pet) => selectedIds.includes(pet.id)), [pets, selectedIds]);

    const visiblePets = useMemo(() => {
        const query = filters.query.trim().toLowerCase();
        return pets.filter((pet) => {
            if (query && ![pet.name, pet.description, pet.id, pet.category, pet.badge].some((value) => value.toLowerCase().includes(query))) return false;
            if (filters.category === UNCATEGORIZED ? pet.category !== "" : filters.category !== "all" && pet.category !== filters.category) return false;
            if (filters.access !== "all" && pet.access !== filters.access) return false;
            if (filters.status !== "all" && pet.enabled !== (filters.status === "on")) return false;
            if (filters.source !== "all" && pet.source !== filters.source) return false;
            if (filters.promo !== "all" && pet.promoState !== filters.promo) return false;
            return true;
        });
    }, [filters, pets]);
    const filtered = JSON.stringify(filters) !== JSON.stringify(EMPTY_FILTERS);

    const stats = useMemo(() => {
        const count = (predicate: (pet: AdminAgentPet) => boolean) => pets.filter(predicate).length;
        return {
            listed: count((pet) => pet.enabled),
            uploads: count((pet) => pet.source === "upload"),
            paid: count((pet) => pet.access === "paid"),
            spend: count((pet) => pet.access === "spend"),
            vip: count((pet) => pet.access === "vip"),
            activePromos: count((pet) => pet.promoState === "active"),
            scheduledPromos: count((pet) => pet.promoState === "scheduled"),
            owners: pets.reduce((sum, pet) => sum + pet.ownerCount, 0),
            revenue: pets.reduce((sum, pet) => sum + pet.revenueMicrocredits, 0),
        };
    }, [pets]);

    const columns = useMemo<ColumnsType<AdminAgentPet>>(
        () => [
            {
                key: "pet",
                title: "形象",
                render: (_, pet) => (
                    <div className="flex min-w-0 items-center gap-3" onPointerEnter={() => setPreviewId(pet.id)} onPointerLeave={() => setPreviewId("")}>
                        <div className="grid shrink-0 place-items-center rounded-lg bg-foreground/[0.04]" style={{ width: THUMB_WIDTH + 8, height: THUMB_HEIGHT + 8 }}>
                            <AgentPetSprite
                                src={agentPetSpritesheetURL(pet)}
                                preview={agentPetPreviewURL(pet)}
                                version={pet.spriteVersion}
                                state="idle"
                                stateRows={pet.stateRows}
                                width={THUMB_WIDTH}
                                height={THUMB_HEIGHT}
                                paused={previewId !== pet.id}
                                pixelated={pet.pixelated}
                                lookAtPointer={false}
                                lazy
                            />
                        </div>
                        <div className="min-w-0">
                            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                                <button type="button" className="admin-table-primary-link truncate font-medium" onClick={() => edit(pet)}>
                                    {pet.name}
                                </button>
                                {pet.badge ? <AdminStatusBadge label={pet.badge} tone="warning" /> : null}
                                {pet.source === "upload" ? <AdminStatusBadge label="上传" /> : null}
                                {pet.spriteVersion === 2 ? <AdminStatusBadge label="视线跟随" tone="info" /> : null}
                            </div>
                            <div className="line-clamp-1 text-xs text-foreground/45" title={pet.description}>
                                {pet.description || "—"}
                            </div>
                        </div>
                    </div>
                ),
            },
            {
                key: "category",
                title: "分类",
                width: 104,
                render: (_, pet) =>
                    pet.category ? (
                        <span className="agent-pet-category-chip" title={pet.category}>
                            {pet.category}
                        </span>
                    ) : (
                        <span className="text-xs text-foreground/35">未分类</span>
                    ),
            },
            {
                key: "enabled",
                title: "上架",
                width: 72,
                align: "center",
                render: (_, pet) => <AdminSwitch size="sm" checked={pet.enabled} loading={togglingId === pet.id} disabled={Boolean(togglingId)} aria-label={`${pet.name} 上架`} onChange={(checked) => void toggle(pet, checked)} />,
            },
            {
                key: "access",
                title: "开放方式与价格",
                width: 200,
                render: (_, pet) => {
                    const names = pet.groupCodes.map((code) => groupNames.get(code) || code).join("、");
                    if (pet.access === "vip") return <AdminStatusBadge label={`VIP 专享 · ${names || "未选分组"}`} tone="warning" />;
                    if (pet.access === "free") return <AdminStatusBadge label="免费" />;
                    return (
                        <div className="text-xs leading-5">
                            {pet.access === "paid" ? (
                                <div className="agent-pet-price">
                                    <span className={pet.promotion ? "agent-pet-price-now is-sale" : "agent-pet-price-now"}>{pet.promotion && pet.priceMicrocredits === 0 ? "限时免费" : `${formatCredits(pet.priceMicrocredits, 2)} 积分`}</span>
                                    {pet.promotion ? <span className="agent-pet-price-list">{formatCredits(pet.listPriceMicrocredits, 2)}</span> : null}
                                </div>
                            ) : (
                                <div className="agent-pet-price">
                                    <span className="agent-pet-price-now">消费满 {formatCredits(pet.unlockMicrocredits, 2)} 积分</span>
                                </div>
                            )}
                            {names ? <div className="text-foreground/45">会员免费：{names}</div> : null}
                        </div>
                    );
                },
            },
            {
                key: "promo",
                title: "限时促销",
                width: 168,
                render: (_, pet) => <PromotionCell pet={pet} now={now} />,
            },
            {
                key: "sales",
                title: "拥有 / 收入",
                width: 112,
                align: "right",
                render: (_, pet) => (
                    <div className="text-xs leading-5 tabular-nums">
                        <div>{pet.ownerCount} 人</div>
                        <div className="text-foreground/45">{pet.revenueMicrocredits ? `${formatCredits(pet.revenueMicrocredits, 2)} 积分` : "—"}</div>
                    </div>
                ),
            },
            { key: "sort", title: "排序", dataIndex: "sortOrder", width: 64, align: "center", render: (value: number) => <span className="tabular-nums">{value}</span> },
            {
                key: "actions",
                title: "操作",
                width: 140,
                align: "center",
                render: (_, pet) => (
                    <AdminRowActions
                        primary={{ label: "编辑", icon: <Pencil className="size-3.5" />, onClick: () => edit(pet) }}
                        visibleActionCount={1}
                        // 内置形象只能下架，不提供删除入口。
                        actions={
                            pet.source === "upload"
                                ? [
                                      {
                                          key: "delete",
                                          label: "删除",
                                          icon: <Trash2 className="size-3.5" />,
                                          danger: true,
                                          disabled: pet.ownerCount > 0,
                                          confirm: { title: `删除形象「${pet.name}」？`, description: "删除后不可恢复；已有用户购买或领取的形象不能删除，可以下架。", okText: "确认删除" },
                                          onClick: () => remove(pet),
                                      },
                                  ]
                                : []
                        }
                    />
                ),
            },
        ],
        [edit, groupNames, now, previewId, remove, toggle, togglingId],
    );

    const setFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => setFilters((current) => ({ ...current, [key]: value }));
    const busy = Boolean(batchBusy);

    return (
        <AdminPageFrame
            title="智能体样式"
            description="管理用户可更换的助手形象：上架、分类、开放方式与价格、限时促销。形象文件存在本服务器，不访问外部站点。"
            actions={
                <div className="flex flex-wrap items-center gap-2">
                    <Button icon={<RefreshCw className="size-4" />} loading={loading} onClick={() => void load()}>
                        刷新
                    </Button>
                    <Button icon={<FolderTree className="size-4" />} onClick={() => setCategoryOpen(true)}>
                        分类管理
                    </Button>
                    <Button type="primary" icon={<Upload className="size-4" />} onClick={() => setImportOpen(true)}>
                        批量导入
                    </Button>
                </div>
            }
        >
            <div className="agent-pets-overview">
                <AdminStatTile label="已上架" value={`${stats.listed} / ${pets.length}`} detail={`内置 ${pets.length - stats.uploads} · 上传 ${stats.uploads}`} />
                <AdminStatTile label="付费与会员形象" value={stats.paid + stats.spend + stats.vip} detail={`积分购买 ${stats.paid} · 消费解锁 ${stats.spend} · VIP ${stats.vip}`} />
                <AdminStatTile label="进行中的促销" value={stats.activePromos} detail={stats.scheduledPromos ? `另有 ${stats.scheduledPromos} 个即将开始` : "可在列表中选中后批量开启"} />
                <AdminStatTile label="累计收入" value={`${formatCredits(stats.revenue, 2)} 积分`} detail={`购买与领取共 ${stats.owners} 人次`} />
            </div>
            <AdminDataTable
                toolbar={
                    <AdminSearchInput
                        allowClear
                        className="app-list-search"
                        prefix={<Search className="size-4 text-foreground/40" />}
                        value={filters.query}
                        aria-label="搜索形象"
                        placeholder="搜索名称、简介、分类或角标"
                        onValueChange={(value) => setFilter("query", value)}
                    />
                }
                toolbarActive={filtered}
                onReset={() => setFilters(EMPTY_FILTERS)}
                toolbarFilters={
                    <>
                        <AdminSelect
                            ariaLabel="按分类筛选"
                            className="w-36"
                            value={filters.category}
                            options={[{ value: "all", label: "全部分类" }, ...categories.map((category) => ({ value: category.name, label: `${category.name}（${category.count}）` })), { value: UNCATEGORIZED, label: "未分类" }]}
                            onChange={(value) => setFilter("category", value)}
                        />
                        <AdminSelect
                            ariaLabel="按开放方式筛选"
                            className="w-32"
                            value={filters.access}
                            options={[{ value: "all", label: "全部方式" }, ...(Object.keys(ACCESS_LABELS) as AgentPetAccess[]).map((value) => ({ value, label: ACCESS_LABELS[value] }))]}
                            onChange={(value) => setFilter("access", value as Filters["access"])}
                        />
                        <AdminSelect
                            ariaLabel="按上架状态筛选"
                            className="w-28"
                            value={filters.status}
                            options={[
                                { value: "all", label: "全部状态" },
                                { value: "on", label: "已上架" },
                                { value: "off", label: "未上架" },
                            ]}
                            onChange={(value) => setFilter("status", value as Filters["status"])}
                        />
                        <AdminSelect
                            ariaLabel="按促销筛选"
                            className="w-28"
                            value={filters.promo}
                            options={[
                                { value: "all", label: "全部促销" },
                                { value: "active", label: "进行中" },
                                { value: "scheduled", label: "未开始" },
                                { value: "ended", label: "已结束" },
                            ]}
                            onChange={(value) => setFilter("promo", value as Filters["promo"])}
                        />
                        <AdminSelect
                            ariaLabel="按来源筛选"
                            className="w-28"
                            value={filters.source}
                            options={[
                                { value: "all", label: "全部来源" },
                                { value: "builtin", label: "内置" },
                                { value: "upload", label: "上传" },
                            ]}
                            onChange={(value) => setFilter("source", value as Filters["source"])}
                        />
                    </>
                }
                trailing={<span className="text-xs text-foreground/45">{filtered ? `筛选出 ${visiblePets.length} 个` : `共 ${pets.length} 个`}</span>}
                batchActions={
                    <AdminBatchBar count={selectedIds.length} onClear={() => setSelectedIds([])}>
                        <Button size="small" icon={<Eye className="size-3.5" />} loading={batchBusy === "on"} disabled={busy} onClick={() => void runBatch("on", { enabled: true }, (count) => `已上架 ${count} 个形象`)}>
                            上架
                        </Button>
                        <Button size="small" icon={<Ban className="size-3.5" />} loading={batchBusy === "off"} disabled={busy} onClick={() => void runBatch("off", { enabled: false }, (count) => `已下架 ${count} 个形象，已拥有的用户仍可使用`)}>
                            下架
                        </Button>
                        <Button size="small" icon={<FolderTree className="size-3.5" />} disabled={busy} onClick={() => setBatchMode("category")}>
                            设分类
                        </Button>
                        <Button size="small" icon={<Tag className="size-3.5" />} disabled={busy} onClick={() => setBatchMode("badge")}>
                            设角标
                        </Button>
                        <Button size="small" icon={<Wallet className="size-3.5" />} disabled={busy} onClick={() => setBatchMode("access")}>
                            定价与开放方式
                        </Button>
                        <Button size="small" icon={<BadgePercent className="size-3.5" />} disabled={busy} onClick={() => setBatchMode("promotion")}>
                            开促销
                        </Button>
                        <Button size="small" icon={<CircleOff className="size-3.5" />} loading={batchBusy === "end-promo"} disabled={busy} onClick={confirmEndPromotion}>
                            结束促销
                        </Button>
                        <Button size="small" danger icon={<Trash2 className="size-3.5" />} loading={batchBusy === "delete"} disabled={busy} onClick={confirmDelete}>
                            删除
                        </Button>
                    </AdminBatchBar>
                }
                skeletonColumns={columns.length}
                table={{
                    className: "app-data-table",
                    size: "small",
                    rowKey: "id",
                    loading,
                    columns,
                    dataSource: visiblePets,
                    pagination: false,
                    scroll: { x: 1180 },
                    rowSelection: {
                        columnWidth: 36,
                        selectedRowKeys: selectedIds,
                        preserveSelectedRowKeys: true,
                        onChange: (keys) => setSelectedIds(keys.map(String)),
                    },
                }}
                empty={
                    loadError ? (
                        <div className="admin-inline-load-error" role="status">
                            <span>形象库暂不可用：{loadError}</span>
                            <Button size="small" onClick={() => void load()}>
                                重试
                            </Button>
                        </div>
                    ) : (
                        <AdminTableEmpty filtered={filtered} title={filtered ? undefined : "还没有形象"} />
                    )
                }
            />
            <p className="mt-3 flex items-center gap-1.5 text-xs text-foreground/50">
                <Sparkles className="size-3.5" aria-hidden="true" />
                支持 Codex 宠物 ZIP（pet.json + 图集）或单张 WebP / PNG 图集：8 列，1536×1872（v1）或 1536×2288（v2，带 16 个视线方向）。上传的形象可以在编辑里设置说话风格和专属台词。
            </p>
            <AgentPetEditor
                open={editorOpen}
                pet={editing}
                groups={groups}
                categories={categoryNames}
                onClose={() => setEditorOpen(false)}
                onSaved={(saved) => {
                    replace([saved]);
                    setEditorOpen(false);
                }}
            />
            <AgentPetBatchDialog
                mode={batchMode}
                pets={selectedPets}
                groups={groups}
                categories={categoryNames}
                onClose={() => setBatchMode(null)}
                onDone={(result) => {
                    const labels: Record<AgentPetBatchMode, string> = { category: "分类", badge: "角标", access: "开放方式与价格", promotion: "促销" };
                    finishBatch(result, `已更新 ${result.pets.length} 个形象的${batchMode ? labels[batchMode] : "配置"}`);
                    setBatchMode(null);
                }}
            />
            <AgentPetImportDialog
                open={importOpen}
                onClose={() => setImportOpen(false)}
                onImported={(imported) => {
                    replace(imported);
                    // 清掉筛选，刚导入的形象（未上架、免费）一定看得见。
                    setFilters(EMPTY_FILTERS);
                    setSelectedIds(imported.map((pet) => pet.id));
                    message.success(`已导入 ${imported.length} 个形象并为你选中，可以批量设置分类、价格后上架`);
                }}
            />
            <AgentPetCategoryManager open={categoryOpen} pets={pets} onClose={() => setCategoryOpen(false)} onDone={(result, summary) => finishBatch(result, summary)} />
        </AdminPageFrame>
    );
}

function PromotionCell({ pet, now }: { pet: AdminAgentPet; now: number }) {
    if (pet.access !== "paid" || pet.promoState === "none") return <span className="text-xs text-foreground/35">—</span>;
    const price =
        pet.promoPriceMicrocredits === 0 ? `免费领取（原价 ${formatCredits(pet.listPriceMicrocredits, 2)}）` : `${formatCredits(pet.promoPriceMicrocredits, 2)} 积分 · ${agentPetDiscountLabel(pet.promoPriceMicrocredits, pet.listPriceMicrocredits)}`;
    const state =
        pet.promoState === "active"
            ? { label: "进行中", tone: "success" as const, detail: pet.promoEndsAt ? formatAgentPetCountdown(pet.promoEndsAt, now) : "手动结束前一直有效" }
            : pet.promoState === "scheduled"
              ? { label: "未开始", tone: "info" as const, detail: pet.promoStartsAt ? `${dayjs(pet.promoStartsAt).format("MM-DD HH:mm")} 开始` : "" }
              : { label: "已结束", tone: "neutral" as const, detail: pet.promoEndsAt ? `${dayjs(pet.promoEndsAt).format("MM-DD HH:mm")} 结束` : "" };
    return (
        <div className="text-xs leading-5">
            <div className="flex items-center gap-1.5">
                <AdminStatusBadge label={state.label} tone={state.tone} />
                <span className="truncate" title={pet.promoLabel}>
                    {pet.promoLabel}
                </span>
            </div>
            <div className="text-foreground/45">{price}</div>
            {state.detail ? <div className="text-foreground/45">{state.detail}</div> : null}
        </div>
    );
}
