import { App, Button, Checkbox, Form, Input, InputNumber, Segmented, Select, Switch } from "antd";
import { FlaskConical } from "lucide-react";
import { useEffect, useState } from "react";
import { configuredSecretText } from "@/pages/admin/components/admin-ui";
import { AdminModal } from "@/pages/admin/ui/overlays";
import type { SocialVideoPlatform } from "@/services/api/social-video";
import {
    createSocialVideoParseAPI,
    emptySocialVideoParseAPIInput,
    socialVideoParseAPIInput,
    testSocialVideoParseAPI,
    updateSocialVideoParseAPI,
    type SocialVideoParseAPI,
    type SocialVideoParseAPIInput,
    type SocialVideoParseTestResult,
} from "@/services/api/social-video-parse";
import { ParseHeadersEditor, ParseTestResultView } from "./parse-shared";

type Props = {
    open: boolean;
    /** 编辑的接口；为空表示新建。 */
    api: SocialVideoParseAPI | null;
    platforms: readonly SocialVideoPlatform[];
    sampleLinks: Record<string, string>;
    onClose: () => void;
    onSaved: () => void;
};

type FormValues = SocialVideoParseAPIInput & { secret?: string; clearSecret?: boolean };

function inputFromValues(values: FormValues): SocialVideoParseAPIInput {
    const clean = (headers: FormValues["headers"]) => (headers || []).map((header) => ({ name: header.name.trim(), value: header.value.trim() })).filter((header) => header.name || header.value);
    return {
        ...values,
        name: values.name.trim(),
        url: values.url.trim(),
        body: values.method === "POST" && values.bodyType !== "none" ? (values.body || "").trim() : "",
        bodyType: values.method === "POST" ? values.bodyType : "none",
        headers: clean(values.headers),
        downloadHeaders: clean(values.downloadHeaders),
        secret: values.secret?.trim() || "",
        clearSecret: Boolean(values.clearSecret),
        remark: (values.remark || "").trim(),
    };
}

/** 新建 / 编辑一条解析接口：请求怎么发、返回里怎么取视频地址，并能在保存前直接用测试链接试一次。 */
export function ParseAPIEditor({ open, api, platforms, sampleLinks, onClose, onSaved }: Props) {
    const { message, modal } = App.useApp();
    const [form] = Form.useForm<FormValues>();
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);
    const [testURL, setTestURL] = useState("");
    const [testResult, setTestResult] = useState<SocialVideoParseTestResult | null>(null);
    const method = Form.useWatch("method", form);
    const bodyType = Form.useWatch("bodyType", form);
    const selectedPlatforms = (Form.useWatch("platforms", form) as string[] | undefined) || [];

    useEffect(() => {
        if (!open) return;
        form.resetFields();
        form.setFieldsValue(api ? { ...socialVideoParseAPIInput(api), secret: "", clearSecret: false } : { ...emptySocialVideoParseAPIInput(), secret: "", clearSecret: false });
        setTestURL("");
        setTestResult(null);
    }, [api, form, open]);

    const close = () => {
        if (saving) return;
        if (!form.isFieldsTouched()) {
            onClose();
            return;
        }
        modal.confirm({ title: "放弃接口修改？", content: "还没保存的修改会丢失。", okText: "放弃修改", cancelText: "继续编辑", okButtonProps: { danger: true }, onOk: onClose });
    };
    const save = async () => {
        const values = await form.validateFields().catch(() => null);
        if (!values) return;
        setSaving(true);
        try {
            const input = inputFromValues({ ...form.getFieldsValue(true), ...values });
            if (api) await updateSocialVideoParseAPI(api.id, input);
            else await createSocialVideoParseAPI(input);
            message.success(api ? "接口已保存" : "接口已添加");
            onSaved();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存接口失败");
        } finally {
            setSaving(false);
        }
    };
    const runTest = async () => {
        const values = await form.validateFields().catch(() => null);
        if (!values) return;
        setTesting(true);
        try {
            const input = inputFromValues({ ...form.getFieldsValue(true), ...values });
            setTestResult(await testSocialVideoParseAPI({ id: api?.id, api: input, url: testURL.trim() || undefined }));
        } catch (error) {
            message.error(error instanceof Error ? error.message : "测试接口失败");
        } finally {
            setTesting(false);
        }
    };
    const platformOptions = platforms.map((platform) => ({ label: platform.name, value: platform.id }));
    const sampleHint = selectedPlatforms.find((platform) => sampleLinks[platform]);

    return (
        <AdminModal
            title={api ? `编辑接口：${api.name}` : "新增解析接口"}
            open={open}
            width={920}
            className="admin-video-parse-editor"
            onCancel={close}
            maskClosable={!saving}
            footer={[
                <Button key="cancel" onClick={close} disabled={saving}>
                    取消
                </Button>,
                <Button key="save" type="primary" loading={saving} onClick={() => void save()}>
                    保存
                </Button>,
            ]}
        >
            <Form form={form} layout="vertical" requiredMark={false} className="admin-video-parse-form">
                <section>
                    <h3>基本信息</h3>
                    <Form.Item name="category" label="接口分类" tooltip="用于独立分类和筛选，例如官方服务、开源自建、公共备用；与支持的平台独立">
                        <Input maxLength={60} placeholder="例如：公共备用" />
                    </Form.Item>
                    <div className="admin-video-parse-grid">
                        <Form.Item name="name" label="名称" rules={[{ required: true, whitespace: true, message: "请填写接口名称" }]}>
                            <Input maxLength={60} placeholder="如：某某去水印接口" />
                        </Form.Item>
                        <Form.Item name="platforms" label="支持的平台" rules={[{ required: true, type: "array", min: 1, message: "请至少选择一个平台" }]}>
                            <Select mode="multiple" options={platformOptions} placeholder="选择这条接口能解析的平台" />
                        </Form.Item>
                    </div>
                    <div className="admin-video-parse-grid is-4">
                        <Form.Item name="priority" label="优先级" tooltip="「优先级」轮询方式下数字越小越先用">
                            <InputNumber min={0} max={9999} precision={0} className="w-full" />
                        </Form.Item>
                        <Form.Item name="weight" label="权重" tooltip="「按权重随机」轮询方式下生效，1–100">
                            <InputNumber min={1} max={100} precision={0} className="w-full" />
                        </Form.Item>
                        <Form.Item name="timeoutSeconds" label="超时（秒）">
                            <InputNumber min={3} max={60} precision={0} className="w-full" />
                        </Form.Item>
                        <Form.Item name="enabled" label="启用" valuePropName="checked">
                            <Switch />
                        </Form.Item>
                    </div>
                </section>
                <section>
                    <h3>请求</h3>
                    <p className="admin-video-parse-muted">
                        变量：<code>{"{url}"}</code> 视频链接（地址里自动编码），<code>{"{key}"}</code> 密钥，<code>{"{platform}"}</code> 平台标识。密钥请填在「密钥」里，不要直接写进地址。
                    </p>
                    <div className="admin-video-parse-grid is-method">
                        <Form.Item name="method" label="方式">
                            <Segmented options={["GET", "POST"]} />
                        </Form.Item>
                        <Form.Item name="url" label="接口地址" rules={[{ required: true, whitespace: true, message: "请填写接口地址" }]}>
                            <Input className="admin-video-parse-mono" placeholder="https://api.example.com/parse?url={url}&key={key}" />
                        </Form.Item>
                    </div>
                    {method === "POST" ? (
                        <>
                            <Form.Item name="bodyType" label="请求体">
                                <Segmented
                                    options={[
                                        { label: "无", value: "none" },
                                        { label: "JSON", value: "json" },
                                        { label: "表单", value: "form" },
                                    ]}
                                />
                            </Form.Item>
                            {bodyType && bodyType !== "none" ? (
                                <Form.Item name="body" label={bodyType === "json" ? "JSON 请求体" : "表单请求体"}>
                                    <Input.TextArea className="admin-video-parse-mono" autoSize={{ minRows: 2, maxRows: 8 }} placeholder={bodyType === "json" ? '{"url":"{url}","token":"{key}"}' : "url={url}&token={key}"} />
                                </Form.Item>
                            ) : null}
                        </>
                    ) : null}
                    <Form.Item name="headers" label="请求头">
                        <ParseHeadersEditor />
                    </Form.Item>
                    <div className="admin-video-parse-grid">
                        <Form.Item name="secret" label={api?.hasSecret ? `密钥（${configuredSecretText}）` : "密钥"} extra="在地址、请求体或请求头里用 {key} 引用，加密保存，不会再显示。">
                            <Input.Password autoComplete="new-password" placeholder={api?.hasSecret ? "留空保留原密钥" : "没有可以不填"} />
                        </Form.Item>
                        {api?.hasSecret ? (
                            <Form.Item name="clearSecret" label="清除密钥" valuePropName="checked">
                                <Checkbox>保存时清除已存的密钥</Checkbox>
                            </Form.Item>
                        ) : null}
                    </div>
                </section>
                <section>
                    <h3>返回字段</h3>
                    <p className="admin-video-parse-muted">
                        字段路径写法如 <code>data.url</code>、<code>data.items[0].play</code>。视频地址字段留空时，按字段名和地址特征自动找视频地址，测试后可以一键填入。
                    </p>
                    <div className="admin-video-parse-grid is-3">
                        <Form.Item name={["mapping", "successPath"]} label="成功标记字段">
                            <Input className="admin-video-parse-mono" placeholder="如 code，留空不判断" />
                        </Form.Item>
                        <Form.Item name={["mapping", "successValues"]} label="成功取值">
                            <Input className="admin-video-parse-mono" placeholder="200,0,true,success,ok" />
                        </Form.Item>
                        <Form.Item name={["mapping", "messagePath"]} label="错误信息字段">
                            <Input className="admin-video-parse-mono" placeholder="如 msg" />
                        </Form.Item>
                        <Form.Item name={["mapping", "videoUrlPath"]} label="视频地址字段">
                            <Input className="admin-video-parse-mono" placeholder="留空自动识别" />
                        </Form.Item>
                        <Form.Item name={["mapping", "titlePath"]} label="标题字段">
                            <Input className="admin-video-parse-mono" placeholder="留空自动识别" />
                        </Form.Item>
                        <Form.Item name={["mapping", "idPath"]} label="视频 ID 字段">
                            <Input className="admin-video-parse-mono" placeholder="用来去重，可不填" />
                        </Form.Item>
                        <Form.Item name={["mapping", "coverPath"]} label="封面字段">
                            <Input className="admin-video-parse-mono" placeholder="可不填" />
                        </Form.Item>
                        <Form.Item name={["mapping", "durationPath"]} label="时长字段">
                            <Input className="admin-video-parse-mono" placeholder="可不填，超 3 分钟直接拦下" />
                        </Form.Item>
                        <Form.Item name={["mapping", "durationUnit"]} label="时长单位">
                            <Segmented
                                options={[
                                    { label: "秒", value: "s" },
                                    { label: "毫秒", value: "ms" },
                                ]}
                            />
                        </Form.Item>
                    </div>
                    <Form.Item name="downloadHeaders" label="下载视频时带的请求头" extra="有的视频地址要求带 Referer 等请求头才能下载；默认会带手机浏览器的 User-Agent。">
                        <ParseHeadersEditor namePlaceholder="名称，如 Referer" valuePlaceholder="值，如 https://www.douyin.com/" />
                    </Form.Item>
                    <Form.Item name="remark" label="备注">
                        <Input maxLength={200} placeholder="来源、额度、联系方式等，只有管理员能看到" />
                    </Form.Item>
                </section>
                <section className="admin-video-parse-test">
                    <h3>试一下</h3>
                    <div className="admin-video-parse-test-row">
                        <Input value={testURL} onChange={(event) => setTestURL(event.target.value)} placeholder={sampleHint ? `留空用设置里的测试链接（${sampleLinks[sampleHint]}）` : "粘贴一条要测试的分享链接"} aria-label="测试链接" />
                        <Button icon={<FlaskConical className="size-4" />} loading={testing} onClick={() => void runTest()}>
                            测试
                        </Button>
                    </div>
                    <p className="admin-video-parse-muted">测试会调一次接口、按上面的字段取出视频地址，再读视频开头确认能打开，不下载整段视频，也不保存修改。</p>
                    {testResult ? (
                        <ParseTestResultView
                            result={testResult}
                            platforms={platforms}
                            onUseVideoPath={(path) => {
                                form.setFieldValue(["mapping", "videoUrlPath"], path);
                                message.success("已填入视频地址字段");
                            }}
                        />
                    ) : null}
                </section>
            </Form>
        </AdminModal>
    );
}
