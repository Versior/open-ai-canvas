import { Button, Input } from "antd";
import { Search, Undo2 } from "lucide-react";
import { useMemo, useState } from "react";
import { compactStudioPrompts, studioPromptGroups, type StudioPromptGroup } from "@/lib/ecommerce-studio/prompt-registry";
import { cn } from "@/lib/utils";
import { AdminEmpty, AdminStatusBadge } from "../components/admin-ui";

/** 左侧分组栏的三段：主图镜头、详情页镜头，以及拍摄方式、市场等通用规则。 */
const SECTIONS = [
    { title: "主图镜头", match: (group: StudioPromptGroup) => group.id.startsWith("shot.main-") },
    { title: "详情页镜头", match: (group: StudioPromptGroup) => group.id.startsWith("shot.detail-") },
    { title: "通用规则", match: (group: StudioPromptGroup) => !group.id.startsWith("shot.") },
];

const shortTitle = (group: StudioPromptGroup) => group.title.replace(/^(主图|详情页) · /, "");

/**
 * 生图台出图提示词：按镜头、拍法、市场、风格、品类和微调分组列出内置写法，改过的成为覆盖。
 * 输入框里显示实际使用的文字；和内置写法一样或清空时自动回到默认，不保存多余的覆盖。
 */
export function StudioPromptsEditor({ value, disabled, onChange }: { value: Record<string, string> | undefined; disabled: boolean; onChange: (value: Record<string, string> | undefined) => void }) {
    const groups = useMemo(() => studioPromptGroups(), []);
    const [groupId, setGroupId] = useState(groups[0].id);
    const [query, setQuery] = useState("");
    const overrides = value || {};
    const text = query.trim().toLowerCase();
    // 搜索时每组只留命中的条目；组名命中时整组都留下。
    const visibleGroups = text
        ? groups.flatMap((group) => {
              if (group.title.toLowerCase().includes(text)) return [group];
              const entries = group.entries.filter((entry) => `${entry.label} ${overrides[entry.key] ?? entry.defaultText}`.toLowerCase().includes(text));
              return entries.length ? [{ ...group, entries }] : [];
          })
        : groups;
    const group = visibleGroups.find((item) => item.id === groupId) || visibleGroups[0];
    const changedIn = (item: StudioPromptGroup) => groups.find((full) => full.id === item.id)?.entries.filter((entry) => overrides[entry.key] !== undefined).length ?? 0;
    const total = Object.keys(overrides).length;
    const update = (next: Record<string, string>) => onChange(compactStudioPrompts(next, groups));
    const patch = (key: string, next: string | undefined) => {
        const merged = { ...overrides };
        if (next === undefined) delete merged[key];
        else merged[key] = next;
        update(merged);
    };
    const restoreGroup = (item: StudioPromptGroup) => {
        const keys = new Set(groups.find((full) => full.id === item.id)?.entries.map((entry) => entry.key));
        update(Object.fromEntries(Object.entries(overrides).filter(([key]) => !keys.has(key))));
    };
    const groupChanged = group ? changedIn(group) : 0;
    return (
        <div className="ecm-card ecm-prompts">
            <aside className="ecm-prompts-rail">
                <div className="ecm-prompts-rail-inner">
                    <Input aria-label="搜索出图提示词" placeholder="搜索镜头、拍法或提示词内容" prefix={<Search className="size-3.5" aria-hidden />} value={query} allowClear onChange={(event) => setQuery(event.target.value)} />
                    <p className="ecm-prompts-total">{text ? `${visibleGroups.reduce((sum, item) => sum + item.entries.length, 0)} 条匹配` : total ? `已改 ${total} 条，其余用内置写法` : "全部使用内置写法"}</p>
                    <nav className="ecm-prompts-nav" aria-label="提示词分组">
                        {SECTIONS.map((section) => {
                            const items = visibleGroups.filter(section.match);
                            if (!items.length) return null;
                            return (
                                <div key={section.title} className="ecm-prompts-section">
                                    <span className="ecm-prompts-section-title">{section.title}</span>
                                    {items.map((item) => {
                                        const changed = changedIn(item);
                                        return (
                                            <button key={item.id} type="button" aria-pressed={item.id === group?.id} onClick={() => setGroupId(item.id)}>
                                                <span>{shortTitle(item)}</span>
                                                {changed ? <em>已改 {changed}</em> : null}
                                            </button>
                                        );
                                    })}
                                </div>
                            );
                        })}
                    </nav>
                </div>
            </aside>
            {group ? (
                <section className="ecm-prompts-main" aria-label={group.title}>
                    <header className="ecm-prompts-head">
                        <div>
                            <h3>{group.title}</h3>
                            <p>{group.hint}</p>
                        </div>
                        {groupChanged ? (
                            <Button size="small" icon={<Undo2 className="size-3.5" />} disabled={disabled} onClick={() => restoreGroup(group)}>
                                本组恢复内置
                            </Button>
                        ) : null}
                    </header>
                    <div className="ecm-prompts-entries">
                        {group.entries.map((entry) => {
                            const custom = overrides[entry.key] !== undefined;
                            const id = `ecm-prompt-${entry.key}`;
                            return (
                                <div key={entry.key} className={cn("ecm-prompt", custom && "is-custom")}>
                                    <div className="ecm-field-head">
                                        <label htmlFor={id}>{entry.label}</label>
                                        {custom ? <AdminStatusBadge label="已改" tone="info" /> : <span className="ecm-field-count">内置</span>}
                                        {custom ? (
                                            <Button type="text" size="small" icon={<Undo2 className="size-3.5" />} disabled={disabled} onClick={() => patch(entry.key, undefined)}>
                                                恢复内置
                                            </Button>
                                        ) : null}
                                    </div>
                                    <Input.TextArea
                                        id={id}
                                        aria-label={`${group.title} ${entry.label}`}
                                        disabled={disabled}
                                        autoSize={{ minRows: 2, maxRows: 8 }}
                                        maxLength={2000}
                                        value={overrides[entry.key] ?? entry.defaultText}
                                        onChange={(event) => patch(entry.key, event.target.value)}
                                    />
                                </div>
                            );
                        })}
                    </div>
                </section>
            ) : (
                <div className="ecm-prompts-main">
                    <AdminEmpty title="没有匹配的提示词" description="换个关键词，或清空搜索看全部分组。" />
                </div>
            )}
        </div>
    );
}
