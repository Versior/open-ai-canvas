import { App, Button, Form, InputNumber } from "antd";
import { ArrowUpRight, Link2, ScanSearch } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { AdminStatusBadge, SettingsSectionCard } from "@/pages/admin/components/admin-ui";
import { Switch } from "@/pages/admin/ui/controls";
import { formatDurationLimit } from "@/lib/canvas/video-teardown";
import { updateAdminFeatureAvailability } from "@/services/api/auth";
import { updateVideoReplicationSettings, type AdminVideoReplicationOverview, type VideoReplicationSettings } from "@/services/api/video-replication-admin";
import { useUserStore, type FeatureAvailability } from "@/stores/use-user-store";

type SwitchKey = "videoReplicationEnabled" | "socialVideoImportEnabled";

const SWITCHES: { key: SwitchKey; title: string; description: string; icon: ReactNode }[] = [
    {
        key: "videoReplicationEnabled",
        title: "视频复刻",
        description: "关闭后侧栏不显示入口，用户不能新建拆解，页面上也看不到记录；已经开始的拆解和分析照常完成，记录和关键帧都保留，重新开启后恢复。",
        icon: <ScanSearch className="size-4" aria-hidden="true" />,
    },
    {
        key: "socialVideoImportEnabled",
        title: "视频链接导入",
        description: "粘贴抖音、快手等分享链接导入视频（画布粘贴和视频复刻共用）。关闭后画布按普通文字粘贴，视频复刻只能上传文件；解析接口的巡检、自动恢复和订阅同步一并暂停，已经开始的导入会跑完。",
        icon: <Link2 className="size-4" aria-hidden="true" />,
    },
];

const SETTING_KEYS: (keyof VideoReplicationSettings)[] = ["maxDurationSeconds", "maxShots", "transcribeEnabled"];

/** 表单里和已保存设置不同的字段；保存时只提交这些，别的管理员同时改的其他字段不会被这里的旧值盖掉。 */
function changedSettings(values: Partial<VideoReplicationSettings>, saved: VideoReplicationSettings | undefined): Partial<VideoReplicationSettings> {
    if (!saved) return {};
    return Object.fromEntries(SETTING_KEYS.filter((key) => values[key] !== undefined && values[key] !== saved[key]).map((key) => [key, values[key]]));
}

type Props = {
    features: FeatureAvailability | null;
    featuresError: string;
    onFeaturesChange: (features: FeatureAvailability) => void;
    overview: AdminVideoReplicationOverview | null;
    onSaved: () => void;
};

/** 视频复刻的开关（功能开放里同一份配置，切换即保存）和拆解限制、口播识别（保存后对新任务和排队中的任务生效）。 */
export function ReplicationSettingsPanel({ features, featuresError, onFeaturesChange, overview, onSaved }: Props) {
    const { message } = App.useApp();
    const setGlobalFeatures = useUserStore((state) => state.setFeatures);
    const [savingKey, setSavingKey] = useState<SwitchKey | null>(null);
    const [form] = Form.useForm<VideoReplicationSettings>();
    const [saving, setSaving] = useState(false);
    const [dirty, setDirtyState] = useState(false);
    const dirtyRef = useRef(false);
    const maxDurationSeconds = Form.useWatch("maxDurationSeconds", form);
    const settings = overview?.settings;
    // 概览刷新会换掉 settings 对象：内容没变、或者正在改的时候都不重置表单。
    const settingsKey = useMemo(() => (settings ? JSON.stringify(settings) : ""), [settings]);
    const setDirty = (value: boolean) => {
        dirtyRef.current = value;
        setDirtyState(value);
    };
    useEffect(() => {
        if (settingsKey && !dirtyRef.current) form.setFieldsValue(JSON.parse(settingsKey) as VideoReplicationSettings);
    }, [form, settingsKey]);

    const toggle = async (key: SwitchKey, enabled: boolean) => {
        if (!features || savingKey) return;
        setSavingKey(key);
        try {
            const result = await updateAdminFeatureAvailability({ [key]: enabled });
            if (result.features[key] !== enabled) throw new Error("服务端返回的开关状态和这次保存的不一致，请刷新后核对");
            onFeaturesChange(result.features);
            setGlobalFeatures(result.features);
            message.success(`${SWITCHES.find((item) => item.key === key)?.title}已${enabled ? "开启" : "关闭"}，前台立即生效`);
        } catch (cause) {
            message.error(cause instanceof Error ? cause.message : "保存开关失败");
        } finally {
            setSavingKey(null);
        }
    };
    const discard = () => {
        if (settings) form.setFieldsValue(settings);
        setDirty(false);
    };
    const save = async () => {
        const values = await form.validateFields().catch(() => null);
        if (!values) return;
        const patch = changedSettings(values, settings);
        if (!Object.keys(patch).length) {
            setDirty(false);
            return;
        }
        setSaving(true);
        try {
            const saved = await updateVideoReplicationSettings(patch);
            form.setFieldsValue(saved);
            setDirty(false);
            message.success("设置已保存");
            onSaved();
        } catch (cause) {
            message.error(cause instanceof Error ? cause.message : "保存设置失败");
        } finally {
            setSaving(false);
        }
    };
    const transcription = overview?.transcription;

    return (
        <div className="admin-vr-settings">
            <SettingsSectionCard title="开放状态" description="和「功能开放」里是同一份配置，切换即保存，前台立即生效。" layout="stacked">
                <ul className="admin-vr-switches">
                    {SWITCHES.map((item) => (
                        <li key={item.key}>
                            <span className="admin-vr-switch-icon">{item.icon}</span>
                            <div className="admin-vr-switch-copy">
                                <strong>{item.title}</strong>
                                <span>{item.description}</span>
                            </div>
                            <div className="admin-vr-switch-control">
                                {features ? <AdminStatusBadge label={features[item.key] ? "已开放" : "已关闭"} tone={features[item.key] ? "success" : "neutral"} /> : null}
                                <Switch
                                    checked={Boolean(features?.[item.key])}
                                    loading={savingKey === item.key}
                                    disabled={!features || savingKey !== null}
                                    onChange={(checked) => void toggle(item.key, checked)}
                                    aria-label={`${item.title}，切换后立即保存`}
                                />
                            </div>
                        </li>
                    ))}
                </ul>
                {featuresError ? (
                    <p className="admin-vr-error admin-vr-switches-error" role="alert">
                        {`读取开关失败：${featuresError}`}
                    </p>
                ) : null}
            </SettingsSectionCard>

            {/* 改回原值时不算未保存。 */}
            <Form form={form} layout="vertical" requiredMark={false} className="admin-vr-settings-form" disabled={!settings} onValuesChange={(_, values) => setDirty(Object.keys(changedSettings(values, settings)).length > 0)}>
                <SettingsSectionCard title="拆解限制" description="超过时长的视频在上传和导入后就拦下；镜头多于上限时合并相邻的短镜头。保存后新建和排队中的拆解都按新限制执行。">
                    <div className="admin-vr-grid">
                        <Form.Item
                            name="maxDurationSeconds"
                            label="视频最长"
                            rules={[{ required: true, type: "integer", min: 10, max: 180, message: "填 10 到 180 之间的整数" }]}
                            extra={typeof maxDurationSeconds === "number" && maxDurationSeconds >= 10 && maxDurationSeconds <= 180 ? `即 ${formatDurationLimit(maxDurationSeconds)}。链接导入本身最长 3 分钟。` : "10 到 180 秒。"}
                        >
                            <InputNumber min={10} max={180} precision={0} addonAfter="秒" />
                        </Form.Item>
                        <Form.Item name="maxShots" label="最多镜头" rules={[{ required: true, type: "integer", min: 1, max: 60, message: "填 1 到 60 之间的整数" }]} extra="1 到 60 个；镜头越多，分析时看图模型的调用越多。">
                            <InputNumber min={1} max={60} precision={0} addonAfter="个镜头" />
                        </Form.Item>
                    </div>
                </SettingsSectionCard>
                <SettingsSectionCard
                    title="口播识别"
                    description="拆解时把音轨交给语音转写服务识别口播；不能识别时让看图模型从画面字幕读口播。"
                    status={transcription ? <AdminStatusBadge label={transcription.available ? "现在可用" : "现在不可用"} tone={transcription.available ? "success" : "warning"} /> : undefined}
                >
                    <Form.Item name="transcribeEnabled" label="允许识别口播" valuePropName="checked" extra="关闭后拆解不调用转写服务，用户端的「识别口播」开关不能打开。">
                        <Switch aria-label="允许识别口播" />
                    </Form.Item>
                    {transcription ? (
                        <dl className="admin-vr-checks">
                            <div>
                                <dt>字幕转写（功能开放）</dt>
                                <dd>
                                    <AdminStatusBadge label={transcription.featureEnabled ? "已开放" : "未开放"} tone={transcription.featureEnabled ? "success" : "neutral"} />
                                    <Link to="/admin/settings/features" className="admin-vr-link">
                                        功能开放
                                        <ArrowUpRight className="size-3" aria-hidden="true" />
                                    </Link>
                                </dd>
                            </div>
                            <div>
                                <dt>转写服务</dt>
                                <dd>
                                    <AdminStatusBadge label={transcription.serviceConfigured ? "已配置" : "未配置"} tone={transcription.serviceConfigured ? "success" : "neutral"} />
                                    <span className="admin-vr-muted">
                                        在服务器环境变量 <code>CANVAS_WHISPER_BASE_URL</code> 里配置 whisper.cpp 服务地址，改后重启后端。
                                    </span>
                                </dd>
                            </div>
                            {transcription.note ? (
                                <div>
                                    <dt>现在</dt>
                                    <dd className="admin-vr-muted">{transcription.note}</dd>
                                </div>
                            ) : null}
                        </dl>
                    ) : null}
                </SettingsSectionCard>
                <div className="admin-vr-settings-actions" data-dirty={dirty || undefined}>
                    <span className="admin-vr-muted">{dirty ? "有修改还没保存" : "保存后，新建和排队中的拆解马上按新设置执行。"}</span>
                    <div className="admin-vr-settings-buttons">
                        {dirty ? (
                            <Button disabled={saving} onClick={discard}>
                                撤销修改
                            </Button>
                        ) : null}
                        <Button type="primary" disabled={!dirty} loading={saving} onClick={() => void save()}>
                            保存设置
                        </Button>
                    </div>
                </div>
            </Form>
        </div>
    );
}
