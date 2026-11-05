import { App, Button, Form, Input, InputNumber, Radio, Switch } from "antd";
import { useEffect, useState } from "react";
import { SettingsSectionCard } from "@/pages/admin/components/admin-ui";
import type { SocialVideoPlatform } from "@/services/api/social-video";
import { updateSocialVideoParseSettings, type SocialVideoParseSettings } from "@/services/api/social-video-parse";

const STRATEGIES: { value: SocialVideoParseSettings["strategy"]; label: string; description: string }[] = [
    { value: "priority", label: "优先级", description: "按接口的优先级数字从小到大依次尝试，前一个失败再换下一个。" },
    { value: "round_robin", label: "轮流", description: "每次从下一条接口开始，把调用量平均分到各接口上。" },
    { value: "weighted", label: "按权重随机", description: "按接口的权重随机排序，权重越大越常被先用。" },
    { value: "fastest", label: "最快优先", description: "按最近的平均耗时从快到慢尝试，没调用过的排在后面。" },
];

/** 接口池的全局设置：轮询方式、失败多少次自动停用、多久自动恢复、定期巡检和各平台的测试链接。 */
export function ParseSettingsPanel({ settings, platforms, onSaved }: { settings: SocialVideoParseSettings; platforms: readonly SocialVideoPlatform[]; onSaved: () => void }) {
    const { message } = App.useApp();
    const [form] = Form.useForm<SocialVideoParseSettings>();
    const [saving, setSaving] = useState(false);
    const strategy = Form.useWatch("strategy", form);
    const autoRecover = Form.useWatch("autoRecover", form);

    useEffect(() => {
        form.setFieldsValue({ ...settings, sampleLinks: { ...settings.sampleLinks } });
    }, [form, settings]);

    const save = async () => {
        const values = await form.validateFields().catch(() => null);
        if (!values) return;
        setSaving(true);
        try {
            const sampleLinks = Object.fromEntries(
                Object.entries(values.sampleLinks || {})
                    .map(([platform, link]) => [platform, (link || "").trim()])
                    .filter(([, link]) => link),
            );
            await updateSocialVideoParseSettings({ ...settings, ...values, sampleLinks });
            message.success("设置已保存");
            onSaved();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存设置失败");
        } finally {
            setSaving(false);
        }
    };

    return (
        <Form form={form} layout="vertical" requiredMark={false} className="admin-video-parse-settings">
            <SettingsSectionCard title="轮询方式" description="一次导入最多依次尝试几个接口，按什么顺序。">
                <Form.Item name="strategy" label="顺序">
                    <Radio.Group optionType="button" options={STRATEGIES.map((item) => ({ label: item.label, value: item.value }))} />
                </Form.Item>
                <p className="admin-video-parse-muted">{STRATEGIES.find((item) => item.value === strategy)?.description}</p>
                <Form.Item name="maxAttempts" label="一次导入最多尝试" extra="视频超过 3 分钟、超过大小限制时直接失败，不再换接口。">
                    <InputNumber min={1} max={10} precision={0} addonAfter="个接口" />
                </Form.Item>
            </SettingsSectionCard>
            <SettingsSectionCard title="失败自动停用" description="接口连续失败到次数就自动停用，导入时跳过它；成功一次就恢复。">
                <Form.Item name="failureThreshold" label="连续失败">
                    <InputNumber min={1} max={20} precision={0} addonAfter="次后停用" />
                </Form.Item>
                <Form.Item name="autoRecover" label="自动恢复" valuePropName="checked" extra="冷却期满后用测试链接测一次，通过就恢复；这个平台没有测试链接时先放行一次，下一次真实调用再失败会立刻停用。">
                    <Switch />
                </Form.Item>
                {autoRecover ? (
                    <Form.Item name="recoverAfterMinutes" label="冷却时间">
                        <InputNumber min={5} max={1440} precision={0} addonAfter="分钟" />
                    </Form.Item>
                ) : null}
                <Form.Item name="healthCheckMinutes" label="定期巡检" extra="0 表示不巡检；开着的接口每隔这么久用测试链接测一次，结果同样计入连续失败。最少 10 分钟。">
                    <InputNumber min={0} max={1440} precision={0} addonAfter="分钟" />
                </Form.Item>
            </SettingsSectionCard>
            <SettingsSectionCard title="各平台测试链接" description="测试、巡检、自动恢复和订阅新接口的自动启用都用这里的链接，请填能长期打开的公开视频。">
                <div className="admin-video-parse-grid">
                    {platforms.map((platform) => (
                        <Form.Item key={platform.id} name={["sampleLinks", platform.id]} label={platform.name}>
                            <Input className="admin-video-parse-mono" placeholder={`${platform.name}的一条视频分享链接`} allowClear />
                        </Form.Item>
                    ))}
                </div>
            </SettingsSectionCard>
            <div className="admin-video-parse-settings-actions">
                <Button type="primary" loading={saving} onClick={() => void save()}>
                    保存设置
                </Button>
            </div>
        </Form>
    );
}
