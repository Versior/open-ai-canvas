import type { ReactNode } from "react";
import { useRequireLogin } from "@/hooks/use-require-login";
import { useUserStore } from "@/stores/use-user-store";

/** 文件入口共用捕获：在浏览器打开文件选择器或页面读取拖入文件之前要求登录。 */
export function GuestWorkspaceActions({ children }: { children: ReactNode }) {
    const user = useUserStore((state) => state.user);
    const requireLogin = useRequireLogin();
    return (
        <div
            className="contents"
            onClickCapture={(event) => {
                if (user) return;
                if (!(event.target instanceof Element) || !event.target.closest('input[type="file"], [data-requires-login]')) return;
                event.preventDefault();
                event.stopPropagation();
                requireLogin();
            }}
            onDropCapture={(event) => {
                if (user) return;
                if (!event.dataTransfer.types.includes("Files")) return;
                event.preventDefault();
                event.stopPropagation();
                requireLogin();
            }}
            onPasteCapture={(event) => {
                if (user) return;
                if (!event.clipboardData.files.length) return;
                event.preventDefault();
                event.stopPropagation();
                requireLogin();
            }}
        >
            {children}
        </div>
    );
}
