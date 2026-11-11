import { App, Button, Form, InputNumber } from "antd";
import { ArrowUpRight, Link2, ScanSearch } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { AdminStatusBadge, SettingsSectionCard } from "@/pages/admin/components/admin-ui";
import { Select, Switch } from "@/pages/admin/ui/controls";
import { formatDurationLimit } from "@/lib/canvas/video-teardown";
import { updateAdminFeatureAvailability } from "@/services/api/auth";
import { listAdminAllChannelModels, type AdminChannelModelListItem } from "@/services/api/wallet";
import { getAdminVideoReplicationSettings, updateVideoReplicationSettings, type AdminVideoReplicationSettingsView, type VideoReplicationSettings } from "@/services/api/video-replication-admin";
import { useUserStore, type FeatureAvailability } from "@/stores/use-user-store";

type SwitchKey = "videoReplicationEnabled" | "socialVideoImportEnabled";

const SWITCHES: { key: SwitchKey; title: string; description: string; icon: ReactNode }[] = [
    {
        key: "videoReplicationEnabled",
        title: "视频创作",
        description: "控制商品视频策划、参考视频创作与作品工作台。关闭后隐藏入口，用户不能新建；已经开始的拆解和分析照常完成，作品、记录和关键帧保留，重新开启后恢复。",
        icon: <ScanSearch className="size-4" aria-hidden="true" />,
    },
    {
        key: "socialVideoImportEnabled",
        title: "视频链接导入",
        description: "粘贴抖音、快手等分享链接导入视频（画布粘贴和视频创作共用）。关闭后画布按普通文字粘贴，参考视频只能上传文件；解析接口的巡检、自动恢复和订阅同步一并暂停，已经开始的导入会跑完。",
        icon: <Link2 className="size-4" aria-hidden="true" />,
    },
];

const SETTING_KEYS: (keyof VideoReplicationSettings)[] = ["maxDurationSeconds", "maxShots", "transcribeEnabled", "transcriptionChannelModelId"];

/** 转写模型下拉：系统渠道里 OpenAI Audio 协议的音频模型。已保存但现在不在列表里（删了或改了协议）的也列出来，标明不可用。 */
function transcriptionModelOptions(models: AdminChannelModelListItem[], selected: string | undefined) {
    const options = models
        .filter((item) => item.capability === "audio" && item.protocol === "openai-audio")
        .map((item) => {
            const usable = item.enabled && item.channelEnabled;
            return { value: item.id, label: `${item.displayName || item.modelKey} · ${item.channelName}${usable ? "" : "（已停用）"}`, disabled: !usable && item.id !== selected };
        });
    if (selected && !options.some((item) => item.value === selected)) options.push({ value: selected, label: "已保存的模型现在不可用", disabled: false });
    return [{ value: "", label: "不用模型，走服务器自建的转写服务", disabled: false }, ...options];
}

/** 表单里和已保存设置不同的字段；保存时只提交这些，别的管理员同时改的其他字段不会被这里的旧值盖掉。 */
function changedSettings(values: Partial<VideoReplicationSettings>, saved: VideoReplicationSettings | undefined): Partial<VideoReplicationSettings> {
    if (!saved) return {};
    return Object.fromEntries(SETTING_KEYS.filter((key) => values[key] !== undefined && values[key] !== saved[key]).map((key) => [key, values[key]]));
}

type Props = {
    /** 页签打开时读取设置；切回来时重新读一次，看得到别的管理员刚保存的值。 */
    active: boolean;
    features: FeatureAvailability | null;
    featuresError: string;
    onFeaturesChange: (features: FeatureAvailability) => void;
    /** 保存设置以后通知页面刷新概览（口播识别状态和限制也显示在概览里）。 */
    onSaved: () => void;
};

/**
 * 视频复刻的开关（功能开放里同一份配置，切换即保存）和拆解限制、口播识别（保存后对新任务和排队中的任务生效）。
 * 设置单独读取，不依赖概览里的统计查询：统计读不出来时设置照样能改。
 */
export function ReplicationSettingsPanel({ active, features, featuresError, onFeaturesChange, onSaved }: Props) {
    const { message } = App.useApp();
    const setGlobalFeatures = useUserStore((state) => state.setFeatures);
    const [savingKey, setSavingKey] = useState<SwitchKey | null>(null);
    const [form] = Form.useForm<VideoReplicationSettings>();
    const [view, setView] = useState<AdminVideoReplicationSettingsView | null>(null);
    const [loadError, setLoadError] = useState("");
    const [reloadKey, setReloadKey] = useState(0);
    const [saving, setSaving] = useState(false);
    const [dirty, setDirtyState] = useState(false);
    const dirtyRef = useRef(false);
    const maxDurationSeconds = Form.useWatch("maxDurationSeconds", form);
    const [models, setModels] = useState<AdminChannelModelListItem[]>([]);
    const [modelsError, setModelsError] = useState("");
    useEffect(() => {
        if (!active) return;
        let cancelled = false;
        void listAdminAllChannelModels()
            .then((result) => {
                if (cancelled) return;
                setModels(result.models);
                setModelsError("");
            })
            .catch((cause) => {
                if (!cancelled) setModelsError(cause instanceof Error ? cause.message : "读取渠道模型失败");
            });
        return () => {
            cancelled = true;
        };
    }, [active, reloadKey]);
    useEffect(() => {
        if (!active) return;
        const controller = new AbortController();
        void getAdminVideoReplicationSettings(controller.signal)
            .then((result) => {
                if (controller.signal.aborted) return;
                setView(result);
                setLoadError("");
            })
            .catch((cause) => {
                if (!controller.signal.aborted) setLoadError(cause instanceof Error ? cause.message : "读取视频创作设置失败");
            });
        return () => controller.abort();
    }, [active, reloadKey]);
    const settings = view?.settings;
    const savedModel = settings?.transcriptionChannelModelId || undefined;
    const modelOptions = useMemo(() => transcriptionModelOptions(models, savedModel), [models, savedModel]);
    // 重新读取会换掉 settings 对象：内容没变、或者正在改的时候都不重置表单。
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
            setDirty(false);
            setView(saved);
            setLoadError("");
            form.setFieldsValue(saved.settings);
            message.success("设置已保存");
            onSaved();
        } catch (cause) {
            message.error(cause instanceof Error ? cause.message : "保存设置失败");
        } finally {
            setSaving(false);
        }
    };
    const transcription = view?.transcription;

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

            {loadError ? (
                <div className="admin-vr-load-error" role="alert">
                    <span>{`读取拆解限制和口播识别设置失败：${loadError}`}</span>
                    <Button size="small" onClick={() => setReloadKey((value) => value + 1)}>
                        重新加载
                    </Button>
                </div>
            ) : null}
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
                    description="拆解时把音轨交给转写模型或自建转写服务识别口播；不能识别时让看图模型从画面字幕读口播。"
                    status={transcription ? <AdminStatusBadge label={transcription.available ? "现在可用" : "现在不可用"} tone={transcription.available ? "success" : "warning"} /> : undefined}
                >
                    <Form.Item name="transcribeEnabled" label="允许识别口播" valuePropName="checked" extra="关闭后拆解不调用转写服务，用户端的「识别口播」开关不能打开。">
                        <Switch aria-label="允许识别口播" />
                    </Form.Item>
                    <Form.Item
                        name="transcriptionChannelModelId"
                        label="转写模型"
                        extra={
                            modelsError ? (
                                <span className="admin-vr-error">{`读取渠道模型失败：${modelsError}`}</span>
                            ) : (
                                <>
                                    选系统渠道里协议为 OpenAI Audio 的音频模型，要能返回分句时间（比如 whisper-1）。走平台渠道，费用由平台承担，不扣用户积分。
                                    {modelOptions.length > 1 ? null : (
                                        <>
                                            {" 渠道里还没有这类模型，先去 "}
                                            <Link to="/admin/channels" className="admin-vr-link">
                                                渠道管理
                                                <ArrowUpRight className="size-3" aria-hidden="true" />
                                            </Link>
                                            {" 添加。"}
                                        </>
                                    )}
                                </>
                            )
                        }
                    >
                        <Select ariaLabel="转写模型" appearance="field" options={modelOptions} className="admin-vr-model-select" />
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
                                <dt>转写方式</dt>
                                <dd>
                                    <AdminStatusBadge label={transcription.engine === "channel" ? "转写模型" : transcription.engine === "whisper" ? "自建服务" : "未配置"} tone={transcription.serviceConfigured ? "success" : "neutral"} />
                                    <span className="admin-vr-muted">
                                        {transcription.engine === "channel" ? (
                                            `用 ${transcription.model}`
                                        ) : transcription.engine === "whisper" ? (
                                            <>
                                                用服务器自建的 whisper.cpp 服务（环境变量 <code>CANVAS_WHISPER_BASE_URL</code>）。
                                            </>
                                        ) : (
                                            <>
                                                选一个转写模型，或在服务器环境变量 <code>CANVAS_WHISPER_BASE_URL</code> 里配置 whisper.cpp 服务地址（改后重启后端）。
                                            </>
                                        )}
                                    </span>
                                </dd>
                            </div>
                            {transcription.modelIssue ? (
                                <div>
                                    <dt>转写模型</dt>
                                    <dd>
                                        <AdminStatusBadge label="不可用" tone="warning" />
                                        <span className="admin-vr-muted">{transcription.modelIssue}</span>
                                    </dd>
                                </div>
                            ) : null}
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
