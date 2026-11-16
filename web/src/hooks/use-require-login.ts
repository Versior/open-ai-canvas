import { useCallback } from "react";
import { useAuthEntry } from "@/hooks/use-auth-entry";
import { useUserStore } from "@/stores/use-user-store";

/** 放在使用入口，先登录再读取文件、生成或保存；保留页面上尚未提交的内容。 */
export function useRequireLogin() {
    const { openAuth } = useAuthEntry();
    return useCallback(() => {
        if (useUserStore.getState().user) return true;
        openAuth({ preferDialog: true });
        return false;
    }, [openAuth]);
}
