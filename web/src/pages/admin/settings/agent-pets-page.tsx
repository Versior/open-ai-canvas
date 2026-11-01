import { App, Button } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Eye, Pencil, RefreshCw, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AgentPetSprite } from "@/components/canvas/agent-pet-sprite";
import { formatCredits } from "@/constant/credits";
import { AGENT_PET_ASPECT } from "@/lib/canvas/agent-pet";
import { AGENT_PET_IMPORT_MAX_BYTES, agentPetSpritesheetURL, deleteAdminAgentPet, importAdminAgentPet, listAdminAgentPets, updateAdminAgentPet, type AdminAgentPet } from "@/services/api/agent-pets";
import { listAdminUserGroups, type UserGroup } from "@/services/api/user-groups";
import { AdminPageFrame } from "../components/admin-shell";
import { AdminDataTable, AdminRowActions, AdminStatusBadge, AdminTableEmpty } from "../components/admin-ui";
import { AdminSwitch } from "../ui/controls";
import { agentPetInput, AgentPetEditor } from "./components/agent-pet-editor";

const THUMB_HEIGHT = 56;
const THUMB_WIDTH = Math.round(THUMB_HEIGHT * AGENT_PET_ASPECT);

/** 智能体样式：管理用户可更换的形象库（上架、免费 / VIP / 积分购买、状态动作）。 */
export default function AgentPetsSettingsPage() {
    const { message } = App.useApp();
    const [pets, setPets] = useState<AdminAgentPet[]>([]);
    const [groups, setGroups] = useState<UserGroup[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState("");
    const [editing, setEditing] = useState<AdminAgentPet | null>(null);
    const [editorOpen, setEditorOpen] = useState(false);
    const [togglingId, setTogglingId] = useState("");
    const [importing, setImporting] = useState(false);
    const [previewId, setPreviewId] = useState("");
    const fileInput = useRef<HTMLInputElement>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setLoadError("");
        try {
            const [nextPets, nextGroups] = await Promise.all([listAdminAgentPets(), listAdminUserGroups()]);
            setPets(nextPets);
            setGroups(nextGroups.groups);
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

    const replace = useCallback((saved: AdminAgentPet) => {
        setPets((items) => {
            const exists = items.some((item) => item.id === saved.id);
            const next = exists ? items.map((item) => (item.id === saved.id ? saved : item)) : [...items, saved];
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
                replace(await updateAdminAgentPet(pet.id, agentPetInput(pet, { enabled })));
                message.success(enabled ? `「${pet.name}」已上架` : `「${pet.name}」已下架，已购买的用户仍可使用`);
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
                message.success("形象已删除");
            } catch (error) {
                message.error(error instanceof Error ? error.message : "删除形象失败");
            }
        },
        [message],
    );

    const importFile = async (file?: File) => {
        if (!file) return;
        if (!/\.(zip|webp|png)$/i.test(file.name)) {
            message.error("请选择 Codex 宠物 ZIP，或 WebP / PNG 图集");
            return;
        }
        if (file.size > AGENT_PET_IMPORT_MAX_BYTES) {
            message.error("形象文件不能超过 32 MiB");
            return;
        }
        setImporting(true);
        try {
            const pet = await importAdminAgentPet(file);
            replace(pet);
            message.success(`已导入「${pet.name}」，确认配置后再上架`);
            edit(pet);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "导入形象失败");
        } finally {
            setImporting(false);
        }
    };

    const groupNames = useMemo(() => new Map(groups.map((group) => [group.code, group.name])), [groups]);

    const columns = useMemo<ColumnsType<AdminAgentPet>>(
        () => [
            {
                key: "pet",
                title: "形象",
                render: (_, pet) => (
                    <div className="flex min-w-0 items-center gap-3" onPointerEnter={() => setPreviewId(pet.id)} onPointerLeave={() => setPreviewId("")}>
                        <div className="grid shrink-0 place-items-center rounded-lg bg-foreground/[0.04]" style={{ width: THUMB_WIDTH + 8, height: THUMB_HEIGHT + 8 }}>
                            <AgentPetSprite src={agentPetSpritesheetURL(pet)} version={pet.spriteVersion} state="idle" width={THUMB_WIDTH} height={THUMB_HEIGHT} paused={previewId !== pet.id} pixelated={pet.pixelated} lookAtPointer={false} />
                        </div>
                        <div className="min-w-0">
                            <div className="flex items-center gap-2">
                                <button type="button" className="admin-table-primary-link truncate font-medium" onClick={() => edit(pet)}>
                                    {pet.name}
                                </button>
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
                key: "enabled",
                title: "上架",
                width: 80,
                align: "center",
                render: (_, pet) => <AdminSwitch size="sm" checked={pet.enabled} loading={togglingId === pet.id} disabled={Boolean(togglingId)} aria-label={`${pet.name} 上架`} onChange={(checked) => void toggle(pet, checked)} />,
            },
            {
                key: "access",
                title: "开放方式",
                width: 220,
                render: (_, pet) => {
                    const names = pet.groupCodes.map((code) => groupNames.get(code) || code).join("、");
                    if (pet.access === "vip") return <AdminStatusBadge label={`VIP 专享 · ${names || "未选分组"}`} tone="warning" />;
                    if (pet.access === "paid") {
                        return (
                            <div className="text-xs leading-5">
                                <AdminStatusBadge label={`${formatCredits(pet.priceMicrocredits, 2)} 积分`} tone="success" />
                                {names ? <div className="text-foreground/45">会员免费：{names}</div> : null}
                            </div>
                        );
                    }
                    return <AdminStatusBadge label="免费" tone="neutral" />;
                },
            },
            { key: "owners", title: "已购", dataIndex: "ownerCount", width: 80, align: "center", render: (value: number) => <span className="tabular-nums">{value}</span> },
            { key: "sort", title: "排序", dataIndex: "sortOrder", width: 80, align: "center", render: (value: number) => <span className="tabular-nums">{value}</span> },
            {
                key: "actions",
                title: "操作",
                width: 150,
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
                                          confirm: { title: `删除形象「${pet.name}」？`, description: "删除后不可恢复；已有用户购买的形象不能删除，可以下架。", okText: "确认删除" },
                                          onClick: () => remove(pet),
                                      },
                                  ]
                                : []
                        }
                    />
                ),
            },
        ],
        [edit, groupNames, previewId, remove, toggle, togglingId],
    );

    const listed = pets.filter((pet) => pet.enabled).length;
    return (
        <AdminPageFrame
            title="智能体样式"
            description={`用户可在 Agent 设置里更换的助手形象。已上架 ${listed} / ${pets.length} 个；形象文件存在本服务器，不访问外部站点。`}
            actions={
                <div className="flex items-center gap-2">
                    <Button icon={<RefreshCw className="size-4" />} loading={loading} onClick={() => void load()}>
                        刷新
                    </Button>
                    <input
                        ref={fileInput}
                        type="file"
                        accept=".zip,.webp,.png,application/zip,image/webp,image/png"
                        className="hidden"
                        onChange={(event) => {
                            void importFile(event.target.files?.[0]);
                            event.currentTarget.value = "";
                        }}
                    />
                    <Button type="primary" icon={<Upload className="size-4" />} loading={importing} onClick={() => fileInput.current?.click()}>
                        导入形象
                    </Button>
                </div>
            }
        >
            <p className="mb-3 flex items-center gap-1.5 text-xs text-foreground/50">
                <Eye className="size-3.5" aria-hidden="true" />
                支持 Codex 宠物 ZIP（pet.json + 图集）或单张 WebP / PNG 图集：8 列，1536×1872（v1）或 1536×2288（v2，带 16 个视线方向）。导入后默认未上架。
            </p>
            <AdminDataTable
                skeletonColumns={columns.length}
                table={{ className: "app-data-table", size: "small", rowKey: "id", loading, columns, dataSource: pets, pagination: false, scroll: { x: 860 } }}
                empty={
                    loadError ? (
                        <div className="admin-inline-load-error" role="status">
                            <span>形象库暂不可用：{loadError}</span>
                            <Button size="small" onClick={() => void load()}>
                                重试
                            </Button>
                        </div>
                    ) : (
                        <AdminTableEmpty title="还没有形象" />
                    )
                }
            />
            <AgentPetEditor
                open={editorOpen}
                pet={editing}
                groups={groups}
                onClose={() => setEditorOpen(false)}
                onSaved={(saved) => {
                    replace(saved);
                    setEditorOpen(false);
                }}
            />
        </AdminPageFrame>
    );
}
