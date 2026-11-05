import { Input } from "antd";
import { useState } from "react";
import { AppModal } from "@/components/ui/product/app-modal/app-modal";
import { parseEcomgenTemplate } from "@/lib/ecommerce/ecomgen-template";
import type { EcommerceFlowId, EcommerceSuiteTemplate } from "@/services/api/ecommerce-canvas";
import { AdminCallout, AdminSelect } from "../ui/controls";
import { TEMPLATE_FLOW_OPTIONS } from "./ecommerce-template-form";

/** 粘贴一套 ecomgen.suite v1 JSON，解析成后台精选里的草稿。解析成功后交给调用方加入；重复或超过上限时调用方提示，弹窗不关。 */
export function EcomgenImportModal({ disabled, onCancel, onImport }: { disabled: boolean; onCancel: () => void; onImport: (template: EcommerceSuiteTemplate) => void }) {
    const [text, setText] = useState("");
    const [flow, setFlow] = useState<EcommerceFlowId>("detail");
    const [error, setError] = useState("");
    const submit = () => {
        let template: EcommerceSuiteTemplate;
        try {
            template = parseEcomgenTemplate(text, flow);
        } catch (failure) {
            setError(failure instanceof SyntaxError ? "不是有效的 JSON，请粘贴完整的 .suite.json 文件内容" : failure instanceof Error ? failure.message : "模板导入失败");
            return;
        }
        setError("");
        onImport(template);
    };
    return (
        <AppModal open title="导入 EcomGen 套图 JSON" width={640} okText="解析为草稿" cancelText="取消" okButtonProps={{ disabled: disabled || !text.trim() }} onOk={submit} onCancel={onCancel}>
            <div className="ecm-import">
                <p className="ecm-hint">支持 ecomgen.suite v1 的单套 .suite.json。导入后是草稿：先核对画面方向和商品事实，再启用并保存。只导入你有权使用的模板。</p>
                <label className="ecm-field">
                    <span>用途</span>
                    <AdminSelect<EcommerceFlowId> ariaLabel="导入模板用途" appearance="field" disabled={disabled} value={flow} options={TEMPLATE_FLOW_OPTIONS} onChange={setFlow} />
                </label>
                <label className="ecm-field">
                    <span>JSON 内容</span>
                    <Input.TextArea
                        aria-label="EcomGen 模板 JSON"
                        className="ecm-import-json"
                        rows={10}
                        disabled={disabled}
                        maxLength={200000}
                        value={text}
                        placeholder="粘贴单套 .suite.json 文件内容"
                        onChange={(event) => {
                            setText(event.target.value);
                            setError("");
                        }}
                    />
                </label>
                {error ? (
                    <AdminCallout tone="error" title="没能解析">
                        {error}
                    </AdminCallout>
                ) : null}
            </div>
        </AppModal>
    );
}
