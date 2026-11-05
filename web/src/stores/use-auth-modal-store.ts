import { create } from "zustand";

export type AuthModalTab = "login" | "register";

type AuthModalStore = {
    open: boolean;
    tab: AuthModalTab;
    openAuthModal: (tab?: AuthModalTab) => void;
    closeAuthModal: () => void;
    setTab: (tab: AuthModalTab) => void;
};

/** 游客登录弹窗的开合状态。生成、上传、保存等需要账号的操作统一从这里唤起，不再各自维护登录框。 */
export const useAuthModalStore = create<AuthModalStore>((set) => ({
    open: false,
    tab: "login",
    openAuthModal: (tab = "login") => set({ open: true, tab }),
    closeAuthModal: () => set({ open: false }),
    setTab: (tab) => set({ tab }),
}));

export function openAuthModal(tab?: AuthModalTab) {
    useAuthModalStore.getState().openAuthModal(tab);
}
