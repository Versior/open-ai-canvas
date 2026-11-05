import { useAuthDialogStore } from "@/stores/use-auth-dialog-store";
export type AuthModalTab = "login" | "register";
/**
 * 游客做需要账号的操作（生成、上传、保存等）时从这里唤起登录弹窗。
 * 弹窗由上游的全局 AuthDialogHost 渲染；始终用弹窗、留在当前页，页面上没提交的内容不会丢。
 */
export function openAuthModal(tab: AuthModalTab = "login") {
    useAuthDialogStore.getState().openDialog(tab, null);
}
