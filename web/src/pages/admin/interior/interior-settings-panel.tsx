import { Alert, App, Button, Form, InputNumber, Select, Skeleton, Switch, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";
import { getAdminInteriorSettings, saveAdminInteriorSettings, type InteriorModelRef, type InteriorSettings, type InteriorSurface } from "@/services/api/interior";
import { InteriorModelSelect } from "./interior-model-select";

type SettingsForm = { defaultSurface: InteriorSurface; allowSurfaceSwitch: boolean; maxStylesPerRun: number; maxCountPerStyle: number };

function errorText(error: unknown, fallback: string) {
    return error instanceof Error && error.message ? error.message : fallback;
}

/** 全局配置：默认交互模式、一次对比几个风格、每个风格出几张，以及没有单独指定时用的出图模型。 */
export function InteriorSettingsPanel() {
    const { message } = App.useApp();
    const [form] = Form.useForm<SettingsForm>();
    const [loaded, setLoaded] = useState(false);
    const [error, setError] = useState("");
    const [saving, setSaving] = useState(false);
    const [defaultModel, setDefaultModel] = useState<InteriorModelRef | undefined>();

    const reload = useCallback(async () => {
        try {
            const settings = await getAdminInteriorSettings();
            form.setFieldsValue({ defaultSurface: settings.defaultSurface, allowSurfaceSwitch: settings.allowSurfaceSwitch, maxStylesPerRun: settings.maxStylesPerRun, maxCountPerStyle: settings.maxCountPerStyle });
            setDefaultModel(settings.defaultModel);
            setError("");
        } catch (cause) {
            setError(errorText(cause, "读取室内设计配置失败"));
        } finally {
            setLoaded(true);
        }
    }, [form]);

    useEffect(() => {
        void reload();
    }, [reload]);

    const save = async (values: SettingsForm) => {
        const input: InteriorSettings = { ...values, ...(defaultModel ? { defaultModel } : {}) };
        setSaving(true);
        try {
            const saved = await saveAdminInteriorSettings(input);
            setDefaultModel(saved.defaultModel);
            message.success("已保存");
        } catch (cause) {
            message.error(errorText(cause, "保存失败"));
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="itd-admin-panel is-narrow">
            {error ? <Alert type="error" showIcon message={error} /> : null}
            {!loaded ? <Skeleton active paragraph={{ rows: 5 }} /> : null}
            <Form<SettingsForm> form={form} layout="vertical" className="itd-admin-form" onFinish={(values) => void save(values)} hidden={!loaded}>
                <Form.Item name="defaultSurface" label="默认交互模式" extra="快速出图面向业主，只展示必要选项；专业模式面向设计师和装企，开放模型、比例、画质和全部参数。">
                    <Select
                        options={[
                            { value: "quick", label: "快速出图" },
                            { value: "pro", label: "专业模式" },
                        ]}
                    />
                </Form.Item>
                <Form.Item name="allowSurfaceSwitch" label="允许用户切换交互模式" valuePropName="checked">
                    <Switch />
                </Form.Item>
                <Form.Item label="全局默认出图模型" extra="出图方式没有单独指定模型时使用。快速出图一律用默认模型；都没配置时用用户当前选择的图片模型。">
                    <InteriorModelSelect value={defaultModel} onChange={setDefaultModel} placeholder="不指定（用用户当前的图片模型）" />
                </Form.Item>
                <Form.Item name="maxStylesPerRun" label="一次最多对比几个风格" extra="每个风格单独建一个生成任务，分别计费。">
                    <InputNumber min={1} max={4} />
                </Form.Item>
                <Form.Item name="maxCountPerStyle" label="每个风格最多出几张" extra="出图方式里的上限更小时以出图方式为准。">
                    <InputNumber min={1} max={4} />
                </Form.Item>
                <Typography.Paragraph type="secondary">出图价格按所选模型在「渠道与模型」里的单价计算；对外开放前请先配置好模型价格。</Typography.Paragraph>
                <Button type="primary" htmlType="submit" loading={saving}>
                    保存
                </Button>
            </Form>
        </div>
    );
}
