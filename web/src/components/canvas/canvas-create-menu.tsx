import type { CSSProperties, ReactNode } from "react";

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

/**
 * 添加节点菜单：节点网格无边框，靠表面明度分层；
 * 工作流与导入资源合并到底部浅底轨道，hover 时提亮为浮层表面。
 */
export function CanvasCreateMenu({ commands }: { commands: CanvasCreateCommand[] }) {
    const themeKey = useActiveTheme();
    const theme = canvasThemes[themeKey];
    const isDark = themeKey === "dark";
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
    const footerCommands = [...commands.filter((command) => command.section === "workflow"), ...commands.filter((command) => command.section === "resource")];
    const vars = {
        "--create-hover": theme.toolbar.itemHover,
        "--create-chip": theme.toolbar.itemHover,
        "--create-chip-hover": theme.toolbar.activeBg,
        "--create-track": theme.toolbar.itemHover,
        // 亮色轨道内提亮为白色浮块并配贴边小阴影；暗色只靠表面提亮，不用投影。
        "--create-track-hover": isDark ? theme.toolbar.activeBg : theme.spatial.elevated,
        "--create-track-hover-shadow": isDark ? "none" : "var(--shadow-xs)",
        "--tw-ring-color": theme.node.muted,
        color: theme.node.text,
    } as CSSProperties;

    return (
        <div className="flex flex-col" style={vars}>
            <header className="flex h-8 items-center justify-between gap-2 pl-2 pr-1">
                <h2 className="font-semibold leading-none" style={{ fontSize: "var(--fs-ui)" }}>添加节点</h2>
                {projectCommands.map((command) => (
                    <button
                        key={command.id}
                        type="button"
                        className="inline-flex h-6 min-w-0 items-center gap-1 rounded-[var(--r-md)] px-2 font-medium outline-none transition-colors hover:bg-[var(--create-chip-hover)] focus-visible:ring-2 [&_svg]:size-3.5"
                        style={{ color: theme.node.muted, background: "var(--create-chip)", fontSize: "var(--fs-label)" }}
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
                    {group.title || groupedNodeCommands.length > 1 ? (
                        <MenuSection title={group.title || "创作节点"} color={theme.node.muted} spaced={Boolean(group.title)} />
                    ) : null}
                    <div role="group" aria-label={group.title || "创作节点"} className="mt-1 grid grid-cols-4 gap-0.5">
                        {group.commands.map((command) => (
                            <button
                                key={command.id}
                                type="button"
                                className="group relative flex h-[var(--canvas-create-node-height)] min-w-0 flex-col items-center justify-center gap-2 rounded-[var(--r-md)] px-1 outline-none transition-colors hover:bg-[var(--create-hover)] focus-visible:ring-2"
                                title={command.badge ? `${command.label}（${command.badge}）` : command.label}
                                onMouseDown={(event) => event.stopPropagation()}
                                onClick={command.onClick}
                            >
                                <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-[var(--create-chip)] transition-colors group-hover:bg-[var(--create-chip-hover)] [&_svg]:size-[18px] [&_svg]:stroke-[1.75]">
                                    {command.icon}
                                </span>
                                <span className="block w-full truncate text-center font-medium leading-none" style={{ fontSize: "var(--fs-caption)" }}>{command.label}</span>
                                {command.badge ? (
                                    <span
                                        className="absolute right-1 top-1 rounded-[var(--r-xs)] px-1 font-medium leading-4"
                                        style={{ color: theme.node.muted, background: "var(--create-chip)", fontSize: "var(--fs-label)" }}
                                    >
                                        {command.badge}
                                    </span>
                                ) : null}
                            </button>
                        ))}
                    </div>
                </div>
            ))}

            {footerCommands.length ? (
                <div role="group" aria-label="工作流与导入资源" className="mt-2 grid gap-0.5 rounded-[10px] p-0.5" style={{ background: "var(--create-track)", gridTemplateColumns: `repeat(${footerCommands.length}, minmax(0, 1fr))` }}>
                    {footerCommands.map((command) => (
                        <button
                            key={command.id}
                            type="button"
                            className={cn(
                                "group flex h-[var(--canvas-create-resource-height)] min-w-0 items-center justify-center gap-1.5 rounded-[var(--r-md)] px-2 font-medium outline-none transition-[background-color,box-shadow] hover:bg-[var(--create-track-hover)] hover:shadow-[var(--create-track-hover-shadow)] focus-visible:ring-2",
                                "[&_svg]:size-3.5",
                            )}
                            style={{ fontSize: "var(--fs-caption)" }}
                            title={command.label}
                            onMouseDown={(event) => event.stopPropagation()}
                            onClick={command.onClick}
                        >
                            <span className="grid shrink-0 place-items-center opacity-70 transition-opacity group-hover:opacity-100">{command.icon}</span>
                            <span className="truncate">{command.label}</span>
                        </button>
                    ))}
                </div>
            ) : null}
        </div>
    );
}

function MenuSection({ title, color, spaced = false }: { title: string; color: string; spaced?: boolean }) {
    return <h3 className="mb-1 mt-2 px-1 font-medium leading-none" style={{ color, fontSize: "var(--fs-tiny)", marginTop: spaced ? "var(--space-4)" : "var(--space-2)" }}>{title}</h3>;
}
