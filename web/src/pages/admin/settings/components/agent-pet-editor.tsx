import { App, AutoComplete, Button, DatePicker, Form, Input, InputNumber, Radio, Select } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { useEffect, useMemo, useState } from "react";

import { AgentPetSprite } from "@/components/canvas/agent-pet-sprite";
import { AGENT_AVATAR_STATES } from "@/lib/canvas/agent-appearance";
import { AGENT_PET_ROW_LABELS, DEFAULT_AGENT_PET_STATE_ROWS } from "@/lib/canvas/agent-pet";
import { AGENT_PET_TONE_LABELS, AGENT_PET_TONES, agentPetDiscountLabel } from "@/lib/canvas/agent-pet-store";
import { AGENT_PET_ROWS, agentPetSpritesheetURL, updateAdminAgentPet, type AdminAgentPet, type AdminAgentPetInput, type AgentPetAccess, type AgentPetRow, type AgentPetTone } from "@/services/api/agent-pets";
import type { UserGroup } from "@/services/api/user-groups";
import { AdminSwitch } from "@/pages/admin/ui/controls";
import { AdminDrawer } from "@/pages/admin/ui/overlays";

const CREDIT = 1_000_000;

type EditorValues = {
    name: string;
    description: string;
    enabled: boolean;
    access: AgentPetAccess;
    priceCredits: number | null;
    unlockCredits: number | null;
    groupCodes: string[];
    pixelated: boolean;
    sortOrder: number;
    stateRows: Partial<Record<string, AgentPetRow>>;
    category: string;
    badge: string;
    promoEnabled: boolean;
    promoLabel: string;
    promoPriceCredits: number | null;
    promoStartsAt: Dayjs | null;
    promoEndsAt: Dayjs | null;
    tone: AgentPetTone;
    linesText: string;
};

export const AGENT_PET_ACCESS_OPTIONS: Array<{ value: AgentPetAccess; label: string }> = [
    { value: "free", label: "免费" },
    { value: "vip", label: "VIP 专享" },
    { value: "paid", label: "积分购买" },
    { value: "spend", label: "消费解锁" },
];

export const AGENT_PET_BADGE_PRESETS = ["新品", "热门", "推荐", "限定"];
const TONE_OPTIONS = AGENT_PET_TONES.map((tone) => ({ value: tone, label: AGENT_PET_TONE_LABELS[tone] }));
const MAX_LINES = 4;
const MAX_LINE_RUNES = 40;

/** 后台和用户端保存同一份完整配置；表格里的上架开关、批量以外的单项修改都走这里。价格取原价，不是促销价。 */
export function agentPetInput(pet: AdminAgentPet, patch: Partial<AdminAgentPetInput> = {}): AdminAgentPetInput {
    return {
        name: pet.name,
        description: pet.description,
        enabled: pet.enabled,
        access: pet.access,
        priceMicrocredits: pet.access === "paid" ? pet.listPriceMicrocredits : 0,
        unlockMicrocredits: pet.unlockMicrocredits,
        groupCodes: pet.groupCodes,
        stateRows: pet.stateRows,
        pixelated: pet.pixelated,
        sortOrder: pet.sortOrder,
        category: pet.category,
        badge: pet.badge,
        promoEnabled: pet.promoEnabled,
        promoLabel: pet.promoLabel,
        promoPriceMicrocredits: pet.promoPriceMicrocredits,
        promoStartsAt: pet.promoStartsAt,
        promoEndsAt: pet.promoEndsAt,
        tone: pet.tone,
        lines: pet.lines,
        ...patch,
    };
}

export function AgentPetEditor({ open, pet, groups, categories, onClose, onSaved }: { open: boolean; pet: AdminAgentPet | null; groups: UserGroup[]; categories: string[]; onClose: () => void; onSaved: (pet: AdminAgentPet) => void }) {
    const { message, modal } = App.useApp();
    const [form] = Form.useForm<EditorValues>();
    const [saving, setSaving] = useState(false);
    const [previewRow, setPreviewRow] = useState<AgentPetRow | "look">("idle");
    const access = Form.useWatch("access", form);
    const pixelated = Form.useWatch("pixelated", form);
    const promoEnabled = Form.useWatch("promoEnabled", form);
    const priceCredits = Form.useWatch("priceCredits", form);
    const promoPriceCredits = Form.useWatch("promoPriceCredits", form);
    const uploaded = pet?.source === "upload";

    useEffect(() => {
        if (!open || !pet) return;
        setPreviewRow(pet.spriteVersion === 2 ? "look" : "idle");
        form.setFieldsValue({
            name: pet.name,
            description: pet.description,
            enabled: pet.enabled,
            access: pet.access,
            priceCredits: pet.listPriceMicrocredits ? pet.listPriceMicrocredits / CREDIT : null,
            unlockCredits: pet.unlockMicrocredits ? pet.unlockMicrocredits / CREDIT : null,
            groupCodes: pet.groupCodes,
            pixelated: pet.pixelated,
            sortOrder: pet.sortOrder,
            stateRows: pet.stateRows,
            category: pet.category,
            badge: pet.badge,
            promoEnabled: pet.promoEnabled,
            promoLabel: pet.promoLabel,
            promoPriceCredits: pet.promoEnabled ? pet.promoPriceMicrocredits / CREDIT : null,
            promoStartsAt: pet.promoStartsAt ? dayjs(pet.promoStartsAt) : null,
            promoEndsAt: pet.promoEndsAt ? dayjs(pet.promoEndsAt) : null,
            tone: pet.tone || "gentle",
            linesText: pet.lines.join("\n"),
        });
    }, [form, open, pet]);

    const groupOptions = useMemo(() => groups.map((group) => ({ value: group.code, label: `${group.name}（${group.code}）` })), [groups]);
    const rowOptions = useMemo(() => AGENT_PET_ROWS.map((row) => ({ value: row, label: AGENT_PET_ROW_LABELS[row] })), []);
    const categoryOptions = useMemo(() => categories.map((name) => ({ value: name })), [categories]);
    const discount = promoEnabled && priceCredits && promoPriceCredits !== null && promoPriceCredits !== undefined ? agentPetDiscountLabel(promoPriceCredits, priceCredits) : "";

    const changeAccess = (next: AgentPetAccess) => {
        // 切到 VIP 时默认勾选带 VIP / SVIP 徽章的分组，管理员仍可修改。
        if (next === "vip" && !(form.getFieldValue("groupCodes") as string[] | undefined)?.length) {
            form.setFieldValue(
                "groupCodes",
                groups.filter((group) => group.badgeStyle !== "none").map((group) => group.code),
            );
        }
    };

    const close = () => {
        if (saving) return;
        if (!form.isFieldsTouched()) {
            onClose();
            return;
        }
        modal.confirm({ title: "放弃形象修改？", content: "尚未保存的修改将丢失。", okText: "放弃修改", cancelText: "继续编辑", okButtonProps: { danger: true }, onOk: onClose });
    };

    const save = async () => {
        if (!pet) return;
        const values = await form.validateFields();
        const stateRows = Object.fromEntries(Object.entries(values.stateRows || {}).filter(([, row]) => Boolean(row))) as Partial<Record<string, AgentPetRow>>;
        const paid = values.access === "paid";
        const promo = paid && values.promoEnabled;
        setSaving(true);
        try {
            const saved = await updateAdminAgentPet(
                pet.id,
                agentPetInput(pet, {
                    name: values.name.trim(),
                    description: (values.description || "").trim(),
                    enabled: values.enabled,
                    access: values.access,
                    priceMicrocredits: paid ? Math.round((values.priceCredits || 0) * CREDIT) : 0,
                    unlockMicrocredits: values.access === "spend" ? Math.round((values.unlockCredits || 0) * CREDIT) : 0,
                    groupCodes: values.access === "free" ? [] : values.groupCodes || [],
                    stateRows,
                    pixelated: values.pixelated,
                    sortOrder: values.sortOrder ?? 0,
                    category: (values.category || "").trim(),
                    badge: (values.badge || "").trim(),
                    promoEnabled: Boolean(promo),
                    promoLabel: promo ? (values.promoLabel || "").trim() : "",
                    promoPriceMicrocredits: promo ? Math.round((values.promoPriceCredits || 0) * CREDIT) : 0,
                    promoStartsAt: promo && values.promoStartsAt ? values.promoStartsAt.toISOString() : null,
                    promoEndsAt: promo && values.promoEndsAt ? values.promoEndsAt.toISOString() : null,
                    tone: uploaded ? values.tone : pet.tone,
                    lines: uploaded ? splitLines(values.linesText) : pet.lines,
                }),
            );
            onSaved(saved);
            message.success("形象配置已保存");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存形象失败");
        } finally {
            setSaving(false);
        }
    };

    return (
        <AdminDrawer
            title={pet ? `编辑形象 · ${pet.name}` : "编辑形象"}
            open={open}
            size="min(720px, 100vw)"
            onClose={close}
            mask={{ closable: !saving }}
            destroyOnHidden
            extra={
                <Button type="primary" loading={saving} onClick={() => void save()}>
                    保存
                </Button>
            }
        >
            {pet ? (
                <div className="space-y-5">
                    <section className="flex flex-col gap-4 sm:flex-row">
                        <div className="grid shrink-0 place-items-center rounded-xl bg-foreground/[0.04] p-3" style={{ width: 216, height: 232 }}>
                            <AgentPetSprite
                                src={agentPetSpritesheetURL(pet)}
                                version={pet.spriteVersion}
                                state="idle"
                                row={previewRow === "look" ? undefined : previewRow}
                                width={192}
                                height={208}
                                pixelated={Boolean(pixelated)}
                                lookAtPointer={previewRow === "look"}
                                label={`${pet.name} 预览`}
                            />
                        </div>
                        <div className="min-w-0 flex-1">
                            <div className="mb-2 text-xs font-medium text-foreground/60">动作预览</div>
                            <div className="flex flex-wrap gap-1.5">
                                {pet.spriteVersion === 2 ? (
                                    <Button size="small" aria-pressed={previewRow === "look"} onClick={() => setPreviewRow("look")}>
                                        跟随鼠标
                                    </Button>
                                ) : null}
                                {AGENT_PET_ROWS.map((row) => (
                                    <Button key={row} size="small" aria-pressed={previewRow === row} onClick={() => setPreviewRow(row)}>
                                        {AGENT_PET_ROW_LABELS[row]}
                                    </Button>
                                ))}
                            </div>
                            <p className="mt-3 text-xs leading-5 text-foreground/50">{pet.spriteVersion === 2 ? "v2 图集带 16 个视线方向：用户鼠标移动时，形象在待机状态下会看向鼠标。" : "v1 图集只有 9 个动作，不支持看向鼠标。"}</p>
                        </div>
                    </section>
                    <Form form={form} layout="vertical" requiredMark={false}>
                        <div className="grid gap-x-4 sm:grid-cols-[1fr_auto_auto]">
                            <Form.Item name="name" label="形象名称" rules={[{ required: true, whitespace: true, message: "请填写形象名称" }]}>
                                <Input maxLength={40} showCount />
                            </Form.Item>
                            <Form.Item name="enabled" label="上架" valuePropName="checked">
                                <AdminSwitch aria-label="上架" />
                            </Form.Item>
                            <Form.Item name="pixelated" label="像素清晰" valuePropName="checked" tooltip="像素风图集缩放时保持硬边">
                                <AdminSwitch aria-label="像素清晰" />
                            </Form.Item>
                        </div>
                        <Form.Item name="description" label="简介">
                            <Input.TextArea maxLength={200} showCount autoSize={{ minRows: 2, maxRows: 4 }} />
                        </Form.Item>
                        <div className="grid gap-x-4 sm:grid-cols-[1fr_1fr_auto]">
                            <Form.Item name="category" label="分类" extra="商店按分类筛选；输入新名称即可新建。" rules={[{ max: 12, message: "分类不超过 12 个字" }]}>
                                <AutoComplete options={categoryOptions} allowClear placeholder="如：猫咪" filterOption={(input, option) => String(option?.value ?? "").includes(input)} />
                            </Form.Item>
                            <Form.Item name="badge" label="角标" extra="显示在商店卡片上，最多 6 个字。" rules={[{ max: 6, message: "角标不超过 6 个字" }]}>
                                <AutoComplete options={AGENT_PET_BADGE_PRESETS.map((value) => ({ value }))} allowClear placeholder="如：新品" filterOption={(input, option) => String(option?.value ?? "").includes(input.trim())} />
                            </Form.Item>
                            <Form.Item name="sortOrder" label="排序" extra="越小越靠前。">
                                <InputNumber min={-100000} max={100000} precision={0} className="!w-28" />
                            </Form.Item>
                        </div>

                        <div className="mb-2 mt-1 text-sm font-medium">开放方式与价格</div>
                        <Form.Item name="access">
                            <Radio.Group optionType="button" options={AGENT_PET_ACCESS_OPTIONS} onChange={(event) => changeAccess(event.target.value as AgentPetAccess)} />
                        </Form.Item>
                        {access === "paid" ? (
                            <Form.Item name="priceCredits" label="原价（积分）" rules={[{ required: true, message: "请填写价格" }]} extra="用户确认后从可用积分中扣除，已购买的用户不会重复扣费。">
                                <InputNumber min={0.01} max={1_000_000} precision={2} step={1} className="!w-48" />
                            </Form.Item>
                        ) : null}
                        {access === "spend" ? (
                            <Form.Item
                                name="unlockCredits"
                                label="累计消费门槛（积分）"
                                rules={[{ required: true, message: "请填写累计消费门槛" }]}
                                extra="与用户列表的“已消费”同一口径：只统计已结算的模型调用，购买形象不计入。达标后用户第一次选择时领取，之后调高门槛也不影响已领取的用户。"
                            >
                                <InputNumber min={0.01} max={1_000_000} precision={2} step={10} className="!w-48" />
                            </Form.Item>
                        ) : null}
                        {access === "vip" || access === "paid" || access === "spend" ? (
                            <Form.Item
                                name="groupCodes"
                                label={access === "vip" ? "可使用的分组" : "免费使用的分组（可选）"}
                                rules={access === "vip" ? [{ required: true, type: "array", min: 1, message: "VIP 专享至少选择一个分组" }] : undefined}
                                extra={access === "vip" ? "只有这些分组的用户能使用，其他用户看到“VIP 专享”。" : access === "spend" ? "这些分组的用户不受消费门槛限制，直接可用。" : "这些分组的用户无需购买即可使用。"}
                            >
                                <Select mode="multiple" allowClear showSearch optionFilterProp="label" options={groupOptions} placeholder="选择用户分组" />
                            </Form.Item>
                        ) : null}

                        {access === "paid" ? (
                            <section className="mb-5 rounded-xl border border-foreground/10 p-4">
                                <div className="flex items-center justify-between gap-3">
                                    <div>
                                        <div className="text-sm font-medium">限时促销</div>
                                        <div className="mt-0.5 text-xs text-foreground/50">在设定时间内按促销价出售，促销价填 0 即“限时免费”领取。</div>
                                    </div>
                                    <Form.Item name="promoEnabled" valuePropName="checked" noStyle>
                                        <AdminSwitch aria-label="开启限时促销" />
                                    </Form.Item>
                                </div>
                                {promoEnabled ? (
                                    <div className="mt-4 grid gap-x-4 sm:grid-cols-2">
                                        <Form.Item name="promoLabel" label="活动名称" extra="默认“限时特惠”，免费时为“限时免费”。" rules={[{ max: 8, message: "活动名称不超过 8 个字" }]}>
                                            <Input maxLength={8} placeholder="如：双十一" />
                                        </Form.Item>
                                        <Form.Item
                                            name="promoPriceCredits"
                                            label="促销价（积分）"
                                            extra={discount ? `相当于 ${discount}` : "须低于原价"}
                                            rules={[
                                                { required: true, message: "请填写促销价" },
                                                { validator: (_, value: number | null) => (value === null || value === undefined || !priceCredits || value < priceCredits ? Promise.resolve() : Promise.reject(new Error("促销价须低于原价"))) },
                                            ]}
                                        >
                                            <InputNumber min={0} max={1_000_000} precision={2} step={1} className="!w-48" />
                                        </Form.Item>
                                        <Form.Item name="promoStartsAt" label="开始时间" extra="留空立即开始。">
                                            <DatePicker showTime={{ format: "HH:mm" }} format="YYYY-MM-DD HH:mm" className="w-full" />
                                        </Form.Item>
                                        <Form.Item
                                            name="promoEndsAt"
                                            label="结束时间"
                                            extra="留空则一直进行，直到手动关闭。"
                                            dependencies={["promoStartsAt"]}
                                            rules={[
                                                ({ getFieldValue }) => ({
                                                    validator: (_, value: Dayjs | null) => {
                                                        if (!value) return Promise.resolve();
                                                        const start = getFieldValue("promoStartsAt") as Dayjs | null;
                                                        if (start && !value.isAfter(start)) return Promise.reject(new Error("结束时间须晚于开始时间"));
                                                        return Promise.resolve();
                                                    },
                                                }),
                                            ]}
                                        >
                                            <DatePicker showTime={{ format: "HH:mm" }} format="YYYY-MM-DD HH:mm" className="w-full" />
                                        </Form.Item>
                                    </div>
                                ) : null}
                            </section>
                        ) : null}

                        <div className="mb-2 text-sm font-medium">说话风格与台词</div>
                        {uploaded ? (
                            <div className="grid gap-x-4 sm:grid-cols-[180px_1fr]">
                                <Form.Item name="tone" label="说话风格" extra="决定头顶气泡的语气。">
                                    <Select options={TONE_OPTIONS} />
                                </Form.Item>
                                <Form.Item
                                    name="linesText"
                                    label="专属台词"
                                    extra={`每行一句，最多 ${MAX_LINES} 句、每句 ${MAX_LINE_RUNES} 字以内；会和时间提醒、灵感、贴心话轮流出现。`}
                                    rules={[
                                        {
                                            validator: (_, value: string | undefined) => {
                                                const lines = splitLines(value);
                                                if (lines.length > MAX_LINES) return Promise.reject(new Error(`专属台词最多 ${MAX_LINES} 句`));
                                                if (lines.some((line) => [...line].length > MAX_LINE_RUNES)) return Promise.reject(new Error(`每句台词不超过 ${MAX_LINE_RUNES} 个字`));
                                                return Promise.resolve();
                                            },
                                        },
                                    ]}
                                >
                                    <Input.TextArea autoSize={{ minRows: 3, maxRows: 6 }} placeholder={"我会一直陪着你创作～\n今天的灵感也很不错！"} />
                                </Form.Item>
                            </div>
                        ) : (
                            <p className="mb-5 rounded-lg bg-foreground/[0.04] px-3 py-2.5 text-xs leading-5 text-foreground/60">
                                内置形象自带「{pet.tone ? AGENT_PET_TONE_LABELS[pet.tone] : "温柔"}」风格和 {pet.lines.length} 句专属台词：{pet.lines.join(" / ")}
                            </p>
                        )}

                        <div className="mb-2 text-sm font-medium">状态动作</div>
                        <p className="mb-3 text-xs leading-5 text-foreground/50">助手处于某个状态时播放的动作；留空使用默认。“已完成”的动作播一次后回到待机。</p>
                        <div className="grid gap-x-4 sm:grid-cols-2">
                            {AGENT_AVATAR_STATES.map((state) => (
                                <Form.Item key={state.id} name={["stateRows", state.id]} label={state.label} className="!mb-3">
                                    <Select allowClear options={rowOptions} placeholder={`默认：${AGENT_PET_ROW_LABELS[DEFAULT_AGENT_PET_STATE_ROWS[state.id]]}`} />
                                </Form.Item>
                            ))}
                        </div>
                    </Form>
                </div>
            ) : null}
        </AdminDrawer>
    );
}

function splitLines(value: string | undefined) {
    return (value || "")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
}
