import { App, Button, Form, Input, InputNumber, Radio, Select } from "antd";
import { useEffect, useMemo, useState } from "react";

import { AgentPetSprite } from "@/components/canvas/agent-pet-sprite";
import { AGENT_AVATAR_STATES } from "@/lib/canvas/agent-appearance";
import { AGENT_PET_ROW_LABELS, DEFAULT_AGENT_PET_STATE_ROWS } from "@/lib/canvas/agent-pet";
import { AGENT_PET_ROWS, agentPetSpritesheetURL, updateAdminAgentPet, type AdminAgentPet, type AdminAgentPetInput, type AgentPetAccess, type AgentPetRow } from "@/services/api/agent-pets";
import type { UserGroup } from "@/services/api/user-groups";
import { AdminSwitch } from "@/pages/admin/ui/controls";
import { AdminDrawer } from "@/pages/admin/ui/overlays";

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
};

const ACCESS_OPTIONS: Array<{ value: AgentPetAccess; label: string }> = [
    { value: "free", label: "免费" },
    { value: "vip", label: "VIP 专享" },
    { value: "paid", label: "积分购买" },
    { value: "spend", label: "消费解锁" },
];

/** 后台和用户端保存同一份完整配置；表格里的上架开关也走这里。 */
export function agentPetInput(pet: AdminAgentPet, patch: Partial<AdminAgentPetInput> = {}): AdminAgentPetInput {
    return {
        name: pet.name,
        description: pet.description,
        enabled: pet.enabled,
        access: pet.access,
        priceMicrocredits: pet.priceMicrocredits,
        unlockMicrocredits: pet.unlockMicrocredits,
        groupCodes: pet.groupCodes,
        stateRows: pet.stateRows,
        pixelated: pet.pixelated,
        sortOrder: pet.sortOrder,
        ...patch,
    };
}

export function AgentPetEditor({ open, pet, groups, onClose, onSaved }: { open: boolean; pet: AdminAgentPet | null; groups: UserGroup[]; onClose: () => void; onSaved: (pet: AdminAgentPet) => void }) {
    const { message, modal } = App.useApp();
    const [form] = Form.useForm<EditorValues>();
    const [saving, setSaving] = useState(false);
    const [previewRow, setPreviewRow] = useState<AgentPetRow | "look">("idle");
    const access = Form.useWatch("access", form);
    const pixelated = Form.useWatch("pixelated", form);

    useEffect(() => {
        if (!open || !pet) return;
        setPreviewRow(pet.spriteVersion === 2 ? "look" : "idle");
        form.setFieldsValue({
            name: pet.name,
            description: pet.description,
            enabled: pet.enabled,
            access: pet.access,
            priceCredits: pet.priceMicrocredits ? pet.priceMicrocredits / 1_000_000 : null,
            unlockCredits: pet.unlockMicrocredits ? pet.unlockMicrocredits / 1_000_000 : null,
            groupCodes: pet.groupCodes,
            pixelated: pet.pixelated,
            sortOrder: pet.sortOrder,
            stateRows: pet.stateRows,
        });
    }, [form, open, pet]);

    const groupOptions = useMemo(() => groups.map((group) => ({ value: group.code, label: `${group.name}（${group.code}）` })), [groups]);
    const rowOptions = useMemo(() => AGENT_PET_ROWS.map((row) => ({ value: row, label: AGENT_PET_ROW_LABELS[row] })), []);

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
        setSaving(true);
        try {
            const saved = await updateAdminAgentPet(pet.id, {
                name: values.name.trim(),
                description: (values.description || "").trim(),
                enabled: values.enabled,
                access: values.access,
                priceMicrocredits: values.access === "paid" ? Math.round((values.priceCredits || 0) * 1_000_000) : 0,
                unlockMicrocredits: values.access === "spend" ? Math.round((values.unlockCredits || 0) * 1_000_000) : 0,
                groupCodes: values.access === "free" ? [] : values.groupCodes || [],
                stateRows,
                pixelated: values.pixelated,
                sortOrder: values.sortOrder ?? 0,
            });
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
            size="min(680px, 100vw)"
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
                        <Form.Item name="access" label="开放方式">
                            <Radio.Group optionType="button" options={ACCESS_OPTIONS} onChange={(event) => changeAccess(event.target.value as AgentPetAccess)} />
                        </Form.Item>
                        {access === "paid" ? (
                            <Form.Item name="priceCredits" label="价格（积分）" rules={[{ required: true, message: "请填写价格" }]} extra="用户确认后从可用积分中扣除，已购买的用户不会重复扣费。">
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
                        <Form.Item name="sortOrder" label="排序" extra="数字越小越靠前。">
                            <InputNumber min={-100000} max={100000} precision={0} className="!w-32" />
                        </Form.Item>
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
