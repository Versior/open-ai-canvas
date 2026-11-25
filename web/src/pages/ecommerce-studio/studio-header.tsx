import { App, Button, Dropdown, Tooltip } from "antd";
import { Bot, ChevronDown, Ellipsis, Package, Plus, Trash2 } from "lucide-react";
import type { MenuProps } from "antd";
import { type ReactNode, useRef, useState } from "react";
import { RelativeTime } from "@/components/ui/product/relative-time";
import { studioDisplayName } from "@/lib/ecommerce-studio/brief";
import { studioOutputCount, studioProductCover } from "@/lib/ecommerce-studio/product";
import type { StudioProduct } from "@/lib/ecommerce-studio/types";
import { InlineName, SaveBadge, studioImageUrl } from "./studio-parts";
import { askStudioAgent } from "./use-studio-agent";
import { useStudioStore } from "./use-studio-store";

// 常用的助手任务：点选后填进助手输入框，由用户确认后发送。
const AGENT_PROMPTS: { key: string; label: string; text: string }[] = [
    { key: "fill", label: "识别商品，写标题和卖点", text: "请看看这件商品的照片，帮我建好商品档案，再写一句主标题和 3–5 条卖点；每条都要有依据，看不清或照片给不了的信息列成需要我确认的问题。" },
    { key: "main", label: "排一套主图", text: "请根据商品信息帮我排一套主图（白底、卖点、场景、细节、多角度），排好后把要出的图交给我确认。" },
    { key: "detail", label: "排一套详情页", text: "请根据商品信息，按这个品类帮我排一套详情页，排好后把要出的图交给我确认。" },
    { key: "review", label: "找出文案风险", text: "请找出这件商品的标题和卖点里可能缺少依据或容易误导的说法，并给出可选修改建议；不要阻塞出图。" },
];

function Cover({ product }: { product: StudioProduct }) {
    const cover = studioProductCover(product);
    return <span className="es-cover">{cover ? <img src={studioImageUrl(cover, true)} alt="" /> : <Package size={15} strokeWidth={1.6} aria-hidden />}</span>;
}

export function StudioHeader({
    product,
    saved,
    tools,
    children,
    onSwitch,
    onCreate,
    onDeleted,
}: {
    product: StudioProduct;
    saved: boolean;
    tools: NonNullable<MenuProps["items"]>;
    children: ReactNode;
    onSwitch: (id: string) => void;
    onCreate: () => void;
    onDeleted: () => void;
}) {
    const { message, modal } = App.useApp();
    const products = useStudioStore((state) => state.products);
    const update = useStudioStore((state) => state.update);
    const remove = useStudioStore((state) => state.remove);
    const flush = useStudioStore((state) => state.flush);
    const saveState = useStudioStore((state) => state.saveStates[product.id] || "saved");
    const saveError = useStudioStore((state) => state.saveErrors[product.id]);
    const name = studioDisplayName(product);
    const moreTrigger = useRef<HTMLButtonElement | HTMLAnchorElement>(null);
    const [moreOpen, setMoreOpen] = useState(false);

    const switchItems: MenuProps["items"] = products.map((item) => ({
        key: item.id,
        label: (
            <span className="es-switch-item">
                <Cover product={item} />
                <span className="es-switch-text">
                    <strong>{studioDisplayName(item)}</strong>
                    <small>
                        {studioOutputCount(item)} 张图 · <RelativeTime value={item.updatedAt} />
                    </small>
                </span>
            </span>
        ),
    }));

    const confirmDelete = () =>
        modal.confirm({
            title: `删除「${name}」？`,
            content: "只删除生图台里的商品信息和生成记录，已上传的商品图和生成的图片仍保留在素材库与任务中心。",
            okText: "删除",
            okButtonProps: { danger: true },
            cancelText: "取消",
            onOk: async () => {
                try {
                    await remove(product.id);
                    onDeleted();
                } catch (error) {
                    message.error(error instanceof Error ? error.message : "删除失败");
                }
            },
        });
    const moreItems: MenuProps["items"] = [...tools, ...(saved ? [{ type: "divider" as const }, { key: "delete", danger: true, icon: <Trash2 size={14} />, label: "删除商品", onClick: confirmDelete }] : [])];

    return (
        <header className="es-head">
            <div className="es-head-product">
                <Cover product={product} />
                {saved ? <InlineName value={product.name} placeholder={name} onCommit={(value) => update(product.id, (current) => ({ ...current, name: value }))} /> : <span className="es-head-name">{name}</span>}
                {products.length ? (
                    <Dropdown autoFocus trigger={["click"]} menu={{ items: switchItems, selectedKeys: [product.id], onClick: ({ key }) => onSwitch(key) }} rootClassName="es-portal es-switch-menu">
                        <Button type="text" className="es-switch es-head-command" icon={<ChevronDown size={14} aria-hidden />} iconPlacement="end" aria-label="切换商品" aria-haspopup="menu" title="切换商品">
                            <span className="es-head-command-label">切换商品</span>
                        </Button>
                    </Dropdown>
                ) : null}
            </div>
            <div className="es-head-nav">{children}</div>
            <div className="es-head-end">
                {saved ? (
                    <div className={saveState === "saved" ? "sr-only" : "es-head-status"}>
                        <SaveBadge state={saveState} error={saveError} onRetry={() => void flush(product.id).catch(() => undefined)} />
                    </div>
                ) : null}
                <div className="es-head-actions">
                    <Button className="es-head-command" aria-label="新建商品" title="新建商品" icon={<Plus size={15} aria-hidden />} onClick={onCreate}>
                        <span className="es-head-command-label">新建商品</span>
                    </Button>
                    <Tooltip title={saved ? undefined : "先上传商品图或填写信息，保存后才能交给助手"}>
                        <Dropdown
                            autoFocus
                            trigger={["click"]}
                            disabled={!saved}
                            menu={{
                                items: AGENT_PROMPTS.map(({ key, label }) => ({ key, label })),
                                onClick: ({ key }) => {
                                    const prompt = AGENT_PROMPTS.find((item) => item.key === key);
                                    if (prompt) askStudioAgent(product.id, name, prompt.text);
                                },
                            }}
                        >
                            <Button type="text" className="es-head-command" aria-label="让助手做" aria-haspopup="menu" title="让助手做" icon={<Bot size={15} aria-hidden />} disabled={!saved}>
                                <span className="es-head-command-label">让助手做</span>
                            </Button>
                        </Dropdown>
                    </Tooltip>
                    <Dropdown
                        autoFocus
                        trigger={["click"]}
                        open={moreOpen}
                        onOpenChange={setMoreOpen}
                        menu={{
                            items: moreItems,
                            onKeyDownCapture: (event) => {
                                if (event.key !== "Escape") return;
                                event.stopPropagation();
                                setMoreOpen(false);
                                moreTrigger.current?.focus({ preventScroll: true });
                            },
                        }}
                        rootClassName="es-portal"
                    >
                        <Button ref={moreTrigger} type="text" className="es-head-command es-head-more" aria-label="更多操作" aria-haspopup="menu" aria-expanded={moreOpen} title="更多操作" icon={<Ellipsis size={16} aria-hidden />}>
                            <span className="es-head-command-label">更多</span>
                        </Button>
                    </Dropdown>
                </div>
            </div>
        </header>
    );
}
