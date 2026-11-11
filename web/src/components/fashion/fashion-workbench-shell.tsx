import type { ReactNode } from "react";
import { AppModal } from "@/components/ui/product/app-modal";

/** 同一工作台可嵌在功能目录中，也可由素材页独立打开。 */
export function FashionWorkbenchShell({ inline, width, onClose, children }: { inline?: boolean; width: number; onClose: () => void; children: ReactNode }) {
    return inline ? (
        <div className="fashion-inline">{children}</div>
    ) : (
        <AppModal open centered closable={false} onCancel={onClose} footer={null} width={width} flush title={null} rootClassName="fashion-modal">
            {children}
        </AppModal>
    );
}
