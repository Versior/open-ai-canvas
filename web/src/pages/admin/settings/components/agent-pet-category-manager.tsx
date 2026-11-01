import { App, Button, Input } from "antd";
import { Check, Pencil, Trash2, X } from "lucide-react";
import { useState } from "react";

import { agentPetCategories } from "@/lib/canvas/agent-pet-store";
import { batchUpdateAdminAgentPets, type AdminAgentPet, type AdminAgentPetBatchResult } from "@/services/api/agent-pets";
import { AdminModal } from "@/pages/admin/ui/overlays";

/**
 * 分类管理：分类是形象上的一个标签，这里按分类整体重命名（同名即合并）或移除（形象变为未分类）。
 * 新分类在编辑形象或批量设置分类时直接输入即可创建。
 */
export function AgentPetCategoryManager({ open, pets, onClose, onDone }: { open: boolean; pets: AdminAgentPet[]; onClose: () => void; onDone: (result: AdminAgentPetBatchResult, summary: string) => void }) {
    const { message, modal } = App.useApp();
    const [editing, setEditing] = useState("");
    const [draft, setDraft] = useState("");
    const [busy, setBusy] = useState("");
    const categories = agentPetCategories(pets);
    const uncategorized = pets.filter((pet) => !pet.category).length;

    const apply = async (from: string, to: string, summary: string) => {
        setBusy(from);
        try {
            const ids = pets.filter((pet) => pet.category === from).map((pet) => pet.id);
            onDone(await batchUpdateAdminAgentPets({ ids, category: to }), summary);
            setEditing("");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "修改分类失败");
        } finally {
            setBusy("");
        }
    };

    const rename = (from: string) => {
        const to = draft.trim();
        if (!to || to === from) {
            setEditing("");
            return;
        }
        if ([...to].length > 12) {
            message.error("分类不超过 12 个字");
            return;
        }
        const merging = categories.some((category) => category.name === to);
        void apply(from, to, merging ? `已把「${from}」合并到「${to}」` : `已把「${from}」改名为「${to}」`);
    };

    const remove = (name: string, count: number) => {
        modal.confirm({
            title: `移除分类「${name}」？`,
            content: `其中 ${count} 个形象会变为未分类，形象本身不受影响。`,
            okText: "移除分类",
            cancelText: "取消",
            okButtonProps: { danger: true },
            onOk: () => apply(name, "", `已移除分类「${name}」`),
        });
    };

    return (
        <AdminModal open={open} title="分类管理" footer={null} width={520} onCancel={onClose}>
            <p className="mb-3 text-xs leading-5 text-foreground/50">商店按这些分类筛选，顺序跟随形象排序。改名为已有分类即合并；新分类在编辑形象或批量设置分类时输入即可创建。</p>
            <ul className="divide-y divide-foreground/[0.06] rounded-xl border border-foreground/10">
                {categories.map((category) => (
                    <li key={category.name} className="flex min-h-12 items-center gap-2 px-3 py-2">
                        {editing === category.name ? (
                            <>
                                <Input size="small" autoFocus maxLength={12} value={draft} onChange={(event) => setDraft(event.target.value)} onPressEnter={() => rename(category.name)} className="min-w-0 flex-1" aria-label="新分类名称" />
                                <Button size="small" type="text" icon={<Check className="size-3.5" />} loading={busy === category.name} onClick={() => rename(category.name)} aria-label="保存分类名称" />
                                <Button size="small" type="text" icon={<X className="size-3.5" />} disabled={busy === category.name} onClick={() => setEditing("")} aria-label="取消" />
                            </>
                        ) : (
                            <>
                                <span className="min-w-0 flex-1 truncate text-sm font-medium">{category.name}</span>
                                <span className="shrink-0 text-xs tabular-nums text-foreground/45">{category.count} 个形象</span>
                                <Button
                                    size="small"
                                    type="text"
                                    icon={<Pencil className="size-3.5" />}
                                    disabled={Boolean(busy)}
                                    onClick={() => {
                                        setEditing(category.name);
                                        setDraft(category.name);
                                    }}
                                >
                                    改名
                                </Button>
                                <Button size="small" type="text" danger icon={<Trash2 className="size-3.5" />} loading={busy === category.name} disabled={Boolean(busy) && busy !== category.name} onClick={() => remove(category.name, category.count)}>
                                    移除
                                </Button>
                            </>
                        )}
                    </li>
                ))}
                {categories.length === 0 ? <li className="px-3 py-6 text-center text-xs text-foreground/45">还没有分类</li> : null}
            </ul>
            {uncategorized ? <p className="mt-3 text-xs text-foreground/45">另有 {uncategorized} 个形象未分类，在列表里筛选「未分类」后可以批量设置。</p> : null}
        </AdminModal>
    );
}
