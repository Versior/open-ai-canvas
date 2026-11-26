import { useState } from "react";
import { Alert, Button } from "antd";
import type { ModelProtocolDefinition } from "@/lib/model-protocols";
import { AdminModal } from "@/pages/admin/ui/overlays";
import type { ChannelModel } from "@/services/api/wallet";
import type { ModelChannel } from "@/stores/use-config-store";
import { ChannelModelCopyPicker } from "./channel-model-copy-picker";
import { copyChannelModelConfiguration, initialChannelModelValues, type ChannelModelFormValues } from "./channel-model-editor-form";

export function ChannelModelTransferDialog({
    channel,
    target,
    models,
    protocols,
    protocolLoading,
    protocolError,
    onRetryProtocols,
    onPrepare,
    onClose,
}: {
    channel: ModelChannel;
    target: ChannelModel;
    models: ChannelModel[];
    protocols: ModelProtocolDefinition[];
    protocolLoading: boolean;
    protocolError: string;
    onRetryProtocols: () => void;
    onPrepare: (source: ChannelModel, draft: ChannelModelFormValues) => void;
    onClose: () => void;
}) {
    const [error, setError] = useState("");
    return (
        <AdminModal open centered width={640} title="从其他模型复制配置" onCancel={onClose} footer={null}>
            <div className="admin-model-transfer-body">
                {(protocolError || error) && (
                    <Alert
                        type="error"
                        title={protocolError || error}
                        action={
                            protocolError && (
                                <Button size="small" onClick={onRetryProtocols}>
                                    重试
                                </Button>
                            )
                        }
                    />
                )}
                <ChannelModelCopyPicker
                    mode="import"
                    channel={channel}
                    models={models}
                    target={target}
                    protocols={protocols}
                    disabled={protocolLoading || Boolean(protocolError)}
                    onCancel={onClose}
                    onApply={(source) => {
                        try {
                            onPrepare(source, copyChannelModelConfiguration(initialChannelModelValues(target, protocols), source, protocols));
                        } catch (cause) {
                            setError(cause instanceof Error ? cause.message : "无法读取来源配置");
                        }
                    }}
                />
            </div>
        </AdminModal>
    );
}
