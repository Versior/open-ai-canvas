import { X } from "lucide-react";

import { AppModal } from "@/components/ui/product/app-modal";

import { WorkDetailPane } from "./work-detail";

/**
 * 灵感广场点开作品用弹窗，不离开列表：Modal 挂在 body 上，背后的列表仍在下面。
 * 切换作品时用 key 重建内容体；关闭时销毁媒体，避免外链视频继续占用。
 */
export function LibTVWorkDetailDialog({
    templateUuid,
    onClose,
}: {
    templateUuid?: string;
    onClose: () => void;
}) {
    return (
        <AppModal
            flush
            open={Boolean(templateUuid)}
            onCancel={onClose}
            footer={null}
            centered
            closeIcon={<X className="size-4" />}
            className="workspace-modal library-modal libtv-work-detail-dialog"
            styles={{ mask: { backdropFilter: "none", WebkitBackdropFilter: "none" } }}
        >
            {templateUuid ? <WorkDetailPane key={templateUuid} templateUuid={templateUuid} onClose={onClose} /> : null}
        </AppModal>
    );
}
