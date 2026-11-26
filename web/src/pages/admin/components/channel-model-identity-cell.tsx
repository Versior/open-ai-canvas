import { ModelIcon } from "@/components/model-picker";
import { modelGroupName } from "@/lib/model-group-name";
import type { ChannelModel } from "@/services/api/wallet";
import { ChannelModelDetailsCell } from "./channel-model-details-cell";

export function ChannelModelIdentityCell({ item }: { item: ChannelModel }) {
    const title = modelGroupName(item.modelKey, item.displayName);
    return (
        <div className="flex min-w-0 items-center gap-2">
            <span className="admin-channel-model-icon">
                <ModelIcon model={item.modelKey} icon={item.icon} />
            </span>
            <div className="min-w-0">
                <div className="truncate font-medium" title={title}>
                    {title}
                </div>
                {item.modelKey !== title && (
                    <div className="admin-monospace truncate text-xs text-foreground/60" title={item.modelKey}>
                        {item.modelKey}
                    </div>
                )}
                {item.channelLabel && ![title, item.modelKey, item.providerModelKey].includes(item.channelLabel) && (
                    <div className="truncate text-xs text-foreground/60" title={item.channelLabel}>
                        {item.channelLabel}
                    </div>
                )}
                {item.providerModelKey && item.providerModelKey !== item.modelKey && item.providerModelKey !== title && (
                    <div className="truncate text-xs text-foreground/60" title={item.providerModelKey}>
                        上游：{item.providerModelKey}
                    </div>
                )}
                {(item.description || Boolean(item.tags?.length)) && <ChannelModelDetailsCell description={item.description} tags={item.tags} />}
            </div>
        </div>
    );
}
