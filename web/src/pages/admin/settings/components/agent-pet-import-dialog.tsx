import { Button } from "antd";
import { CheckCircle2, FileArchive, LoaderCircle, Upload, XCircle } from "lucide-react";
import { useRef, useState, type DragEvent } from "react";

import { cn } from "@/lib/utils";
import { AGENT_PET_IMPORT_MAX_BYTES, importAdminAgentPet, type AdminAgentPet } from "@/services/api/agent-pets";
import { ApiError } from "@/services/api/request";
import { AdminModal } from "@/pages/admin/ui/overlays";

/** 一次最多排队的文件数；服务端导入有频率限制（默认每分钟 30 次）。 */
const MAX_FILES = 30;
const ACCEPTED = /\.(zip|webp|png)$/i;

type ImportItem = { key: string; file: File; status: "waiting" | "running" | "done" | "failed"; message?: string; pet?: AdminAgentPet };

/** 批量导入：拖入或选择多个 Codex 宠物 ZIP / WebP / PNG 图集，逐个导入并显示结果。导入后默认未上架。 */
export function AgentPetImportDialog({ open, onClose, onImported }: { open: boolean; onClose: () => void; onImported: (pets: AdminAgentPet[]) => void }) {
    const [items, setItems] = useState<ImportItem[]>([]);
    const [running, setRunning] = useState(false);
    const [dragging, setDragging] = useState(false);
    const input = useRef<HTMLInputElement>(null);
    const imported = items.filter((item) => item.pet).map((item) => item.pet as AdminAgentPet);
    const waiting = items.filter((item) => item.status === "waiting").length;

    const add = (files: FileList | File[] | null) => {
        if (!files) return;
        setItems((current) => {
            const next = [...current];
            for (const file of Array.from(files)) {
                if (next.length >= MAX_FILES) break;
                const key = `${file.name}:${file.size}:${file.lastModified}`;
                if (next.some((item) => item.key === key)) continue;
                const problem = !ACCEPTED.test(file.name) ? "只支持 ZIP、WebP、PNG" : file.size > AGENT_PET_IMPORT_MAX_BYTES ? "超过 32 MiB" : "";
                next.push({ key, file, status: problem ? "failed" : "waiting", message: problem || undefined });
            }
            return next;
        });
    };

    const update = (key: string, patch: Partial<ImportItem>) => setItems((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)));

    const start = async () => {
        setRunning(true);
        const queue = items.filter((item) => item.status === "waiting");
        for (let index = 0; index < queue.length; index += 1) {
            const item = queue[index];
            update(item.key, { status: "running" });
            try {
                const pet = await importAdminAgentPet(item.file);
                update(item.key, { status: "done", pet, message: pet.name });
            } catch (error) {
                // 触发频率限制时停下，剩下的保持待导入，稍后可以继续。
                if (error instanceof ApiError && error.status === 429) {
                    update(item.key, { status: "waiting", message: "导入太频繁，稍后点「继续导入」" });
                    break;
                }
                update(item.key, { status: "failed", message: error instanceof Error ? error.message : "导入失败" });
            }
        }
        setRunning(false);
    };

    const close = () => {
        if (running) return;
        if (imported.length) onImported(imported);
        setItems([]);
        onClose();
    };

    const onDrop = (event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        setDragging(false);
        add(event.dataTransfer.files);
    };

    return (
        <AdminModal
            open={open}
            title="批量导入形象"
            width={600}
            onCancel={close}
            footer={
                <div className="flex items-center justify-between gap-3">
                    <span className="text-xs text-foreground/50">{items.length ? `已导入 ${imported.length} / ${items.length} 个` : `一次最多 ${MAX_FILES} 个文件`}</span>
                    <div className="flex gap-2">
                        <Button disabled={running} onClick={close}>
                            {imported.length ? "完成" : "取消"}
                        </Button>
                        <Button type="primary" loading={running} disabled={!waiting} onClick={() => void start()}>
                            {imported.length && waiting ? `继续导入 ${waiting} 个` : `开始导入${waiting ? ` ${waiting} 个` : ""}`}
                        </Button>
                    </div>
                </div>
            }
        >
            <div
                className={cn("agent-pet-import-drop", dragging && "is-dragging")}
                role="button"
                tabIndex={0}
                aria-label="选择或拖入形象文件"
                onClick={() => input.current?.click()}
                onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        input.current?.click();
                    }
                }}
                onDragOver={(event) => {
                    event.preventDefault();
                    setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
            >
                <Upload className="size-6" aria-hidden="true" />
                <div className="text-sm font-medium">拖入文件，或点击选择</div>
                <div className="text-xs text-foreground/50">Codex 宠物 ZIP（pet.json + 图集）或单张 WebP / PNG 图集，可多选；导入后默认未上架</div>
                <input
                    ref={input}
                    type="file"
                    multiple
                    accept=".zip,.webp,.png,application/zip,image/webp,image/png"
                    className="hidden"
                    onChange={(event) => {
                        add(event.target.files);
                        event.currentTarget.value = "";
                    }}
                />
            </div>
            {items.length ? (
                <ul className="mt-3 max-h-72 space-y-1 overflow-y-auto">
                    {items.map((item) => (
                        <li key={item.key} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-foreground/[0.03]">
                            <FileArchive className="size-4 shrink-0 text-foreground/40" aria-hidden="true" />
                            <span className="min-w-0 flex-1 truncate" title={item.file.name}>
                                {item.file.name}
                            </span>
                            <span className="shrink-0 tabular-nums text-foreground/40">{(item.file.size / 1024 / 1024).toFixed(1)} MB</span>
                            <span
                                className={cn("flex w-44 shrink-0 items-center justify-end gap-1 truncate", item.status === "failed" && "text-[var(--admin-status-error)]", item.status === "done" && "text-[var(--admin-status-success)]")}
                                title={item.message}
                            >
                                {item.status === "running" ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" /> : null}
                                {item.status === "done" ? <CheckCircle2 className="size-3.5" aria-hidden="true" /> : null}
                                {item.status === "failed" ? <XCircle className="size-3.5" aria-hidden="true" /> : null}
                                <span className="truncate">{item.status === "waiting" ? item.message || "待导入" : item.status === "running" ? "导入中…" : item.message}</span>
                            </span>
                        </li>
                    ))}
                </ul>
            ) : null}
        </AdminModal>
    );
}
