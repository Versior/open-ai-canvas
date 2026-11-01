import { App, AutoComplete, DatePicker, Form, Input, InputNumber, Radio, Select } from "antd";
import type { Dayjs } from "dayjs";
import { useEffect, useMemo, useState } from "react";

import { formatCredits } from "@/constant/credits";
import { batchUpdateAdminAgentPets, type AdminAgentPet, type AdminAgentPetBatchInput, type AdminAgentPetBatchResult, type AgentPetAccess } from "@/services/api/agent-pets";
import type { UserGroup } from "@/services/api/user-groups";
import { AdminModal } from "@/pages/admin/ui/overlays";
import { AGENT_PET_ACCESS_OPTIONS, AGENT_PET_BADGE_PRESETS } from "./agent-pet-editor";

const CREDIT = 1_000_000;

export type AgentPetBatchMode = "category" | "badge" | "access" | "promotion";

const TITLES: Record<AgentPetBatchMode, string> = {
    category: "批量设置分类",
    badge: "批量设置角标",
    access: "批量设置开放方式与价格",
    promotion: "批量开启限时促销",
};

type BatchValues = {
    category: string;
    badge: string;
    access: AgentPetAccess;
    priceCredits: number | null;
    unlockCredits: number | null;
    groupCodes: string[];
    promoLabel: string;
    /** 折扣（折）：8 表示 8 折，0 表示限时免费。 */
    discount: number | null;
    promoStartsAt: Dayjs | null;
    promoEndsAt: Dayjs | null;
};

/** 对选中的形象做同一项修改；不适用的形象由服务端跳过并返回原因。 */
export function AgentPetBatchDialog({
    mode,
    pets,
    groups,
    categories,
    onClose,
    onDone,
}: {
    mode: AgentPetBatchMode | null;
    pets: AdminAgentPet[];
    groups: UserGroup[];
    categories: string[];
    onClose: () => void;
    onDone: (result: AdminAgentPetBatchResult) => void;
}) {
    const { message } = App.useApp();
    const [form] = Form.useForm<BatchValues>();
    const [saving, setSaving] = useState(false);
    const access = Form.useWatch("access", form);
    const discount = Form.useWatch("discount", form);

    useEffect(() => {
        if (!mode) return;
        form.resetFields();
        form.setFieldsValue({ access: "paid", discount: 8, groupCodes: [] });
    }, [form, mode]);

    const paidPets = useMemo(() => pets.filter((pet) => pet.access === "paid"), [pets]);
    const groupOptions = useMemo(() => groups.map((group) => ({ value: group.code, label: `${group.name}（${group.code}）` })), [groups]);

    const submit = async () => {
        if (!mode) return;
        const values = await form.validateFields();
        const input: AdminAgentPetBatchInput = { ids: pets.map((pet) => pet.id) };
        if (mode === "category") input.category = (values.category || "").trim();
        if (mode === "badge") input.badge = (values.badge || "").trim();
        if (mode === "access") {
            input.access = {
                mode: values.access,
                priceMicrocredits: values.access === "paid" ? Math.round((values.priceCredits || 0) * CREDIT) : 0,
                unlockMicrocredits: values.access === "spend" ? Math.round((values.unlockCredits || 0) * CREDIT) : 0,
                groupCodes: values.access === "free" ? [] : values.groupCodes || [],
            };
        }
        if (mode === "promotion") {
            input.promotion = {
                enabled: true,
                label: (values.promoLabel || "").trim(),
                percent: Math.round((values.discount ?? 0) * 10),
                startsAt: values.promoStartsAt ? values.promoStartsAt.toISOString() : null,
                endsAt: values.promoEndsAt ? values.promoEndsAt.toISOString() : null,
            };
        }
        setSaving(true);
        try {
            onDone(await batchUpdateAdminAgentPets(input));
        } catch (error) {
            message.error(error instanceof Error ? error.message : "批量修改失败");
        } finally {
            setSaving(false);
        }
    };

    return (
        <AdminModal open={Boolean(mode)} title={mode ? `${TITLES[mode]}（${pets.length} 个）` : ""} okText="应用到所选形象" cancelText="取消" confirmLoading={saving} width={560} onOk={() => void submit()} onCancel={() => !saving && onClose()}>
            <Form form={form} layout="vertical" requiredMark={false} className="pt-2">
                {mode === "category" ? (
                    <Form.Item name="category" label="分类" extra="留空表示移出分类。输入新名称即可新建分类。" rules={[{ max: 12, message: "分类不超过 12 个字" }]}>
                        <AutoComplete options={categories.map((value) => ({ value }))} allowClear placeholder="如：猫咪" autoFocus filterOption={matchesOption} />
                    </Form.Item>
                ) : null}
                {mode === "badge" ? (
                    <Form.Item name="badge" label="角标" extra="显示在商店卡片上；留空清除角标。" rules={[{ max: 6, message: "角标不超过 6 个字" }]}>
                        <AutoComplete options={AGENT_PET_BADGE_PRESETS.map((value) => ({ value }))} allowClear placeholder="如：新品" autoFocus filterOption={matchesOption} />
                    </Form.Item>
                ) : null}
                {mode === "access" ? (
                    <>
                        <Form.Item name="access" label="开放方式">
                            <Radio.Group optionType="button" options={AGENT_PET_ACCESS_OPTIONS} />
                        </Form.Item>
                        {access === "paid" ? (
                            <Form.Item name="priceCredits" label="统一价格（积分）" rules={[{ required: true, message: "请填写价格" }]} extra="已购买的用户不受影响。">
                                <InputNumber min={0.01} max={1_000_000} precision={2} step={1} className="!w-48" />
                            </Form.Item>
                        ) : null}
                        {access === "spend" ? (
                            <Form.Item name="unlockCredits" label="累计消费门槛（积分）" rules={[{ required: true, message: "请填写累计消费门槛" }]}>
                                <InputNumber min={0.01} max={1_000_000} precision={2} step={10} className="!w-48" />
                            </Form.Item>
                        ) : null}
                        {access && access !== "free" ? (
                            <Form.Item name="groupCodes" label={access === "vip" ? "可使用的分组" : "免费使用的分组（可选）"} rules={access === "vip" ? [{ required: true, type: "array", min: 1, message: "VIP 专享至少选择一个分组" }] : undefined}>
                                <Select mode="multiple" allowClear showSearch optionFilterProp="label" options={groupOptions} placeholder="选择用户分组" />
                            </Form.Item>
                        ) : null}
                        <p className="text-xs leading-5 text-foreground/50">改成积分购买以外的方式时，会同时结束这些形象的促销。</p>
                    </>
                ) : null}
                {mode === "promotion" ? (
                    <>
                        <p className="mb-4 rounded-lg bg-foreground/[0.04] px-3 py-2 text-xs leading-5 text-foreground/60">
                            只对积分购买的形象生效：所选 {pets.length} 个中有 {paidPets.length} 个可以促销，其余会跳过。
                        </p>
                        <div className="grid gap-x-4 sm:grid-cols-2">
                            <Form.Item name="promoLabel" label="活动名称" extra="默认“限时特惠”，免费时为“限时免费”。" rules={[{ max: 8, message: "活动名称不超过 8 个字" }]}>
                                <Input maxLength={8} placeholder="如：双十一" />
                            </Form.Item>
                            <Form.Item name="discount" label="折扣" extra="按原价打折，0 表示限时免费。" rules={[{ required: true, message: "请填写折扣" }]}>
                                <InputNumber min={0} max={9.9} precision={1} step={0.5} suffix="折" className="!w-40" />
                            </Form.Item>
                            <Form.Item name="promoStartsAt" label="开始时间" extra="留空立即开始。">
                                <DatePicker showTime={{ format: "HH:mm" }} format="YYYY-MM-DD HH:mm" className="w-full" />
                            </Form.Item>
                            <Form.Item
                                name="promoEndsAt"
                                label="结束时间"
                                extra="留空则一直进行，直到手动结束。"
                                dependencies={["promoStartsAt"]}
                                rules={[
                                    ({ getFieldValue }) => ({
                                        validator: (_, value: Dayjs | null) => {
                                            const start = getFieldValue("promoStartsAt") as Dayjs | null;
                                            return !value || !start || value.isAfter(start) ? Promise.resolve() : Promise.reject(new Error("结束时间须晚于开始时间"));
                                        },
                                    }),
                                ]}
                            >
                                <DatePicker showTime={{ format: "HH:mm" }} format="YYYY-MM-DD HH:mm" className="w-full" />
                            </Form.Item>
                        </div>
                        {paidPets.length && discount !== null && discount !== undefined ? (
                            <div className="max-h-40 overflow-y-auto rounded-lg border border-foreground/10 px-3 py-2 text-xs leading-6">
                                {paidPets.slice(0, 20).map((pet) => (
                                    <div key={pet.id} className="flex items-center justify-between gap-3">
                                        <span className="truncate">{pet.name}</span>
                                        <span className="shrink-0 tabular-nums text-foreground/60">
                                            <s>{formatCredits(pet.listPriceMicrocredits, 2)}</s> → <b className="text-foreground">{discount === 0 ? "免费" : formatCredits(previewPrice(pet.listPriceMicrocredits, discount), 2)}</b>
                                        </span>
                                    </div>
                                ))}
                                {paidPets.length > 20 ? <div className="text-foreground/45">…还有 {paidPets.length - 20} 个</div> : null}
                            </div>
                        ) : null}
                    </>
                ) : null}
            </Form>
        </AdminModal>
    );
}

/** 输入新名称时只列出包含它的已有项，下拉框不会盖住确认按钮。 */
function matchesOption(input: string, option?: { value?: string | number }) {
    return String(option?.value ?? "").includes(input.trim());
}

/** 与服务端相同的算法：原价 × 折扣，四舍五入到 0.01 积分。 */
function previewPrice(listPrice: number, discount: number) {
    const cent = 10_000;
    const percent = Math.round(discount * 10);
    return Math.floor((Math.floor((listPrice * percent) / 100) + cent / 2) / cent) * cent;
}
