import { motion, useReducedMotion } from "motion/react";
import type { CSSProperties, ReactNode } from "react";

import { aceternityMotion } from "@/lib/aceternity-motion";
import { canvasThemes } from "@/lib/canvas-theme";
import { cn } from "@/lib/utils";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";

export type CanvasCreateCommand = {
    id: string;
    label: string;
    icon: ReactNode;
    badge?: string;
    section: "node" | "workflow" | "project" | "resource";
    /**
     * section 内的二级分组标题。
     *
     * 电商画布的「创作节点」有二十来项（十三个电商节点 + 通用节点），
     * 平铺成一张四列网格是一团——用户要找「A+ 内容」得把整片扫一遍。
     * 分组后标题本身就是导航。
     */
    group?: string;
    onClick: () => void;
};

export function CanvasCreateMenu({ commands }: { commands: CanvasCreateCommand[] }) {
    const theme = canvasThemes[useActiveTheme()];
    const projectCommands = commands.filter((command) => command.section === "project");
    const nodeCommands = commands.filter((command) => command.section === "node");
    /**
     * 按 group 聚拢，保持命令注册顺序。
     *
     * 无 group 的通用节点（文本、图片、视频……）在 defaultOrder 上被电商节点夹在中间，
     * 直接按出现顺序聚拢会得到两个同名的「创作节点」段。所以显式把它排到最后：
     * 电商画布里电商节点本来就该在前，自由画布里只有这一段，排哪都一样。
     */
    const groupedNodeCommands = (() => {
        const groups = new Map<string, CanvasCreateCommand[]>();
        for (const command of nodeCommands) {
            const title = command.group || "";
            const list = groups.get(title);
            if (list) list.push(command);
            else groups.set(title, [command]);
        }
        const named = [...groups].filter(([title]) => title).map(([title, commands]) => ({ title, commands }));
        const rest = groups.get("");
        return rest?.length ? [...named, { title: "", commands: rest }] : named;
    })();
    const workflowCommands = commands.filter((command) => command.section === "workflow");
    const resourceCommands = commands.filter((command) => command.section === "resource");

    return (
        <div>
            <header className="flex min-h-7 items-center justify-between gap-2 border-b pb-2" style={{ borderColor: theme.toolbar.border }}>
                <h2 className="font-semibold leading-none" style={{ fontSize: "var(--fs-caption)" }}>添加节点</h2>
                {projectCommands.map((command) => (
                    <button
                        key={command.id}
                        type="button"
                        className="inline-flex h-6 min-w-0 items-center gap-1 rounded-[var(--dock-item-radius)] px-2 font-medium outline-none transition-colors hover:bg-black/5 focus-visible:ring-2 dark:hover:bg-white/8 [&_svg]:size-3"
                        style={{ color: theme.node.muted, fontSize: "var(--fs-tiny)", "--tw-ring-color": theme.node.muted } as CSSProperties}
                        title={command.label}
                        onMouseDown={(event) => event.stopPropagation()}
                        onClick={command.onClick}
                    >
                        {command.icon}
                        <span className="whitespace-nowrap">{command.label}</span>
                    </button>
                ))}
            </header>

            {groupedNodeCommands.map((group) => (
                <div key={group.title || "default"}>
                    <MenuSection title={group.title || "创作节点"} color={theme.node.muted} spaced={Boolean(group.title)} />
                    <CanvasCreateCommandGrid commands={group.commands} variant="node" />
                </div>
            ))}

            {workflowCommands.length ? (
                <>
                    <MenuSection title="工作流" color={theme.node.muted} spaced />
                    <CanvasCreateCommandGrid commands={workflowCommands} variant="workflow" />
                </>
            ) : null}

            <MenuSection title="导入资源" color={theme.node.muted} spaced />
            <CanvasCreateCommandGrid commands={resourceCommands} variant="compact" />
        </div>
    );
}

function CanvasCreateCommandGrid({ commands, variant }: { commands: CanvasCreateCommand[]; variant: "node" | "compact" | "workflow" }) {
    const theme = canvasThemes[useActiveTheme()];
    const reducedMotion = useReducedMotion();

    return (
        <div className={cn("grid gap-1", variant === "node" ? "grid-cols-4" : variant === "workflow" ? "grid-cols-1" : "grid-cols-2")}>
            {commands.map((command) => (
                <motion.button
                    key={command.id}
                    type="button"
                    whileHover={reducedMotion ? undefined : { y: -1 }}
                    whileTap={reducedMotion ? undefined : { scale: 0.98 }}
                    transition={aceternityMotion.spring.dock}
                    className={cn(
                        "group min-w-0 overflow-hidden border border-black/10 bg-white/70 outline-none transition-colors hover:border-black/20 hover:bg-black/5 focus-visible:ring-2 dark:border-white/10 dark:bg-white/[.04] dark:hover:border-white/20 dark:hover:bg-white/8",
                        variant === "node"
                            ? "flex h-[var(--canvas-create-node-height)] flex-col items-start justify-between rounded-[var(--dock-item-radius)] px-2 py-2 text-left"
                            : variant === "workflow"
                                ? "flex h-[var(--canvas-create-resource-height)] items-center justify-start gap-2 rounded-[var(--dock-item-radius)] px-2 text-left"
                                : "flex h-[var(--canvas-create-resource-height)] items-center justify-center gap-2 rounded-[var(--dock-item-radius)] px-2 text-center",
                    )}
                    style={{ color: theme.node.text, "--tw-ring-color": theme.node.muted } as CSSProperties}
                    title={command.label}
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={command.onClick}
                >
                    {variant === "node" ? (
                        <>
                            <span className="flex w-full min-w-0 items-center justify-between gap-1">
                                <span className="grid size-6 shrink-0 place-items-center opacity-65 transition-opacity group-hover:opacity-100 [&_svg]:size-5">{command.icon}</span>
                                {command.badge ? <span className="shrink-0 font-medium leading-none" style={{ color: theme.node.muted, fontSize: "var(--fs-tiny)" }}>{command.badge}</span> : null}
                            </span>
                            <span className="block w-full overflow-hidden text-ellipsis whitespace-nowrap font-medium leading-none" style={{ fontSize: "var(--fs-label)" }}>{command.label}</span>
                        </>
                    ) : (
                        <>
                            <span className="grid size-4 shrink-0 place-items-center opacity-65 transition-opacity group-hover:opacity-100 [&_svg]:size-3.5">{command.icon}</span>
                            <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-medium leading-none" style={{ fontSize: "var(--fs-label)" }}>{command.label}</span>
                        </>
                    )}
                </motion.button>
            ))}
        </div>
    );
}

function MenuSection({ title, color, spaced = false }: { title: string; color: string; spaced?: boolean }) {
    return <h3 className="mb-1 mt-2 px-1 font-medium leading-none" style={{ color, fontSize: "var(--fs-tiny)", marginTop: spaced ? "var(--space-4)" : "var(--space-2)" }}>{title}</h3>;
}
