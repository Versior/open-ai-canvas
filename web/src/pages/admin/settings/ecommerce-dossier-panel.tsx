import { Button, Input } from "antd";
import { RotateCw, Undo2 } from "lucide-react";
import { ECOMMERCE_STUDIO_CAPABILITIES } from "@/lib/ecommerce/ecommerce-capabilities";
import { AdminStatusBadge } from "../components/admin-ui";
import { AdminCallout, AdminSwitch } from "../ui/controls";

/** 电商生图台的能力：「商品档案」看图识别商品事实并写卖点与文案；「出图策划」按商品排详情页、主图套图和单张图的每一张。 */
export type StudioCapability = (typeof ECOMMERCE_STUDIO_CAPABILITIES)[number];
export const DOSSIER = ECOMMERCE_STUDIO_CAPABILITIES[0];
export const DETAIL_PLAN = ECOMMERCE_STUDIO_CAPABILITIES[1];
export const DOSSIER_DEFAULT_KEY = `cap:${DOSSIER.id}`;
export function studioCapabilityDefaultKey(capability: StudioCapability) {
    return `cap:${capability.id}`;
}
const PROMPT_MAX = 20000;
const CLOSED_NOTE: Record<StudioCapability["id"], string> = {
    dossier: "关闭后，生图台不能再识别商品档案，也不能撰写卖点与文案。",
    "detail-plan": "关闭后，生图台不能再按商品策划：详情页和主图套图要先策划才能生成，关闭期间无法生成；单张图仍可按类型直接出。",
};

type CapabilityValue = { enabled: boolean; directorPrompt: string };

/**
 * 生图台能力的页签：开放开关和分析指令。
 * 用普通函数渲染而不是组件，开关、输入框和按钮留在设置页的元素树里，设置页的测试能直接找到。
 */
export function renderStudioCapabilityPanel({
    capability,
    value,
    defaultText,
    defaultsLoading,
    defaultsError,
    disabled,
    onChange,
    onRetryDefaults,
}: {
    capability: StudioCapability;
    value: CapabilityValue;
    defaultText: string;
    defaultsLoading: boolean;
    defaultsError: string;
    disabled: boolean;
    onChange: (change: Partial<CapabilityValue>) => void;
    onRetryDefaults: () => void;
}) {
    const custom = Boolean(value.directorPrompt);
    const text = value.directorPrompt || defaultText;
    const promptId = `ecm-${capability.id}-prompt`;
    return (
        <div className="ecm-card ecm-dossier">
            <section className="ecm-dossier-switch">
                <div>
                    <strong>开放使用</strong>
                    <p>
                        {capability.description}。{CLOSED_NOTE[capability.id]}
                    </p>
                </div>
                <AdminSwitch aria-label={capability.name + "开放使用"} disabled={disabled} checked={value.enabled} onChange={(enabled) => onChange({ enabled })} />
            </section>
            <section className="ecm-dossier-prompt">
                <div className="ecm-field-head">
                    <label htmlFor={promptId}>分析指令</label>
                    <AdminStatusBadge label={custom ? "自定义" : "内置默认"} tone={custom ? "info" : "neutral"} />
                    <span className="ecm-field-count">
                        {text.length.toLocaleString()} / {PROMPT_MAX.toLocaleString()} 字
                    </span>
                    {custom ? (
                        <Button type="text" size="small" icon={<Undo2 className="size-3.5" />} disabled={disabled} onClick={() => onChange({ directorPrompt: "" })}>
                            恢复内置默认
                        </Button>
                    ) : null}
                </div>
                {defaultsError ? (
                    <AdminCallout
                        tone="warning"
                        title="内置指令没有读到"
                        action={
                            <Button size="small" icon={<RotateCw className="size-3.5" />} loading={defaultsLoading} onClick={() => void onRetryDefaults()}>
                                重试读取默认指令
                            </Button>
                        }
                    >
                        {defaultsError}
                    </AdminCallout>
                ) : null}
                <Input.TextArea
                    id={promptId}
                    className="ecm-dossier-textarea"
                    aria-label={capability.name + "私有分析指令"}
                    disabled={disabled || (!value.directorPrompt && !defaultText)}
                    autoSize={{ minRows: 8, maxRows: 28 }}
                    maxLength={PROMPT_MAX}
                    value={text}
                    placeholder={defaultsLoading ? "正在读取内置指令…" : "内置指令未读取成功，请点击上方重试"}
                    onChange={(event) => onChange({ directorPrompt: event.target.value })}
                />
                <p className="ecm-hint">
                    输入框里是实际使用的完整指令。改动后成为自定义覆盖，恢复内置默认即回到内置写法。
                    {capability.id === "detail-plan" ? "电商知识库里的详情页、主图、版式、摄影、场景和文案方法由服务端按商品和策划范围检索后附在指令后面，不用写进这里。" : ""}
                </p>
            </section>
        </div>
    );
}
