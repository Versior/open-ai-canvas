import { useEffect } from "react";
import { useLocation } from "react-router";
import { useAuthLoginMode } from "@/hooks/use-auth-entry";
import { isGuestWorkspacePath } from "@/lib/guest-workspace";
import { openAuthModal } from "@/stores/use-auth-modal-store";
import { useUserStore } from "@/stores/use-user-store";
/** 每个浏览器会话只自动弹出一次；关闭后需要账号的操作仍会再次唤起。 */
const AUTO_OPEN_STORAGE_KEY = "yingce:auth-modal-shown";
function claimAutoOpen() {
    try {
        if (window.sessionStorage.getItem(AUTO_OPEN_STORAGE_KEY)) return false;
        window.sessionStorage.setItem(AUTO_OPEN_STORAGE_KEY, "1");
        return true;
    } catch (error) {
        // 会话存储不可用时无法保证「只弹一次」，宁可不自动弹，避免每次刷新都打断游客。
        console.warn("会话存储不可用，跳过登录弹窗自动弹出", error);
        return false;
    }
}
/**
 * 游客打开网站时自动弹出一次登录弹窗。弹窗本身由全局 AuthDialogHost 渲染，登录成功后自动收起。
 * 后台把登录入口设成「独立页面」时不自动弹，游客点需要账号的操作时再进入登录。
 */
export function GuestAuthModalHost() {
    const user = useUserStore((state) => state.user);
    const hydrated = useUserStore((state) => state.hydrated);
    const loginMode = useAuthLoginMode();
    const location = useLocation();
    useEffect(() => {
        if (!hydrated || user || loginMode !== "modal" || !isGuestWorkspacePath(location.pathname)) return;
        if (claimAutoOpen()) openAuthModal("login");
    }, [hydrated, user, loginMode, location.pathname]);
    return null;
}
