import { Button, Input } from "antd";
import { Undo2 } from "lucide-react";
import { useMemo, useState } from "react";
import { compactStudioPrompts, studioPromptGroups } from "@/lib/ecommerce-studio/prompt-registry";

/**
 * 生图台出图提示词：按镜头、拍法、市场、风格、品类和微调分组列出内置写法，改过的成为覆盖。
 * 输入框里显示实际使用的文字；和内置写法一样或清空时自动回到默认，不保存多余的覆盖。
 */
export function StudioPromptsEditor({ value, disabled, onChange }: { value: Record<string, string> | undefined; disabled: boolean; onChange: (value: Record<string, string> | undefined) => void }) {
    const groups = useMemo(() => studioPromptGroups(), []);
    const [groupId, setGroupId] = useState(groups[0].id);
    const [query, setQuery] = useState("");
    const overrides = value || {};
    const changedIn = (entries: { key: string }[]) => entries.filter((entry) => overrides[entry.key] !== undefined).length;
    const text = query.trim().toLowerCase();
    const visibleGroups = text ? groups.filter((group) => `${group.title} ${group.entries.map((entry) => `${entry.label} ${overrides[entry.key] ?? entry.defaultText}`).join(" ")}`.toLowerCase().includes(text)) : groups;
    const group = visibleGroups.find((item) => item.id === groupId) || visibleGroups[0];
    const total = Object.keys(overrides).length;
    const patch = (key: string, next: string | undefined) => {
        const merged = { ...overrides };
        if (next === undefined) delete merged[key];
        else merged[key] = next;
        onChange(compactStudioPrompts(merged, groups));
    };
    return (
        <div className="admin-studio-prompts">
            <aside>
                <Input aria-label="搜索出图提示词" placeholder="搜索镜头、拍法或提示词内容" value={query} allowClear onChange={(event) => setQuery(event.target.value)} />
                <span className="admin-studio-prompts-total">{total ? `已改 ${total} 条，保存后生图台按新的写法出图` : "全部使用内置写法"}</span>
                <div className="admin-studio-prompts-groups">
                    {visibleGroups.map((item) => {
                        const changed = changedIn(item.entries);
                        return (
                            <button key={item.id} type="button" aria-pressed={item.id === group?.id} onClick={() => setGroupId(item.id)}>
                                <span>{item.title}</span>
                                {changed ? <em>已改 {changed}</em> : null}
                            </button>
                        );
                    })}
                </div>
            </aside>
            {group ? (
                <section className="admin-studio-prompts-fields" aria-label={group.title}>
                    <header>
                        <strong>{group.title}</strong>
                        <span>{group.hint}</span>
                    </header>
                    {group.entries.map((entry) => {
                        const custom = overrides[entry.key] !== undefined;
                        return (
                            <label key={entry.key} className="admin-studio-prompt">
                                <span className="admin-studio-prompt-head">
                                    <span>
                                        {entry.label}
                                        <small>{custom ? "已改" : "内置"}</small>
                                    </span>
                                    <Button type="text" size="small" icon={<Undo2 className="size-3.5" />} disabled={disabled || !custom} onClick={() => patch(entry.key, undefined)}>
                                        恢复内置
                                    </Button>
                                </span>
                                <Input.TextArea
                                    aria-label={`${group.title} ${entry.label}`}
                                    disabled={disabled}
                                    autoSize={{ minRows: 2, maxRows: 8 }}
                                    maxLength={2000}
                                    value={overrides[entry.key] ?? entry.defaultText}
                                    onChange={(event) => patch(entry.key, event.target.value)}
                                />
                            </label>
                        );
                    })}
                </section>
            ) : (
                <p>没有匹配的提示词。</p>
            )}
        </div>
    );
}
