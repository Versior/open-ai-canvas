import { useEffect } from "react";
import { STUDIO_AGENT_CHANGE_EVENT, type StudioAgentChange } from "@/services/agent-studio-sync";
import { useGlobalAgentStore } from "@/stores/use-global-agent-store";
import { useStudioStore } from "./use-studio-store";

/**
 * 把当前打开的商品交给全局助手：发消息时这一轮绑定该商品（contextScope=studio）。
 * 助手写入商品后面板会广播变化，这里取回服务端最新版本；本地未保存的修改会重新套用。
 */
export function useStudioAgentBridge(productId: string, productName: string) {
    const setStudio = useGlobalAgentStore((state) => state.setStudio);

    // 还没保存到服务器的新商品不交给助手：服务端找不到它，绑定会直接报错。
    useEffect(() => {
        setStudio(productId ? { productId, productName } : null);
    }, [productId, productName, setStudio]);

    useEffect(
        () => () => {
            const store = useGlobalAgentStore.getState();
            if (productId && store.studio?.productId === productId) store.setStudio(null);
        },
        [productId],
    );

    useEffect(() => {
        if (!productId) return;
        const refresh = () =>
            void useStudioStore
                .getState()
                .refresh(productId)
                .catch((error) => console.warn("生图台商品刷新失败", error));
        // 打开商品时先对齐一次：离开期间助手或另一个窗口可能改过它。
        refresh();
        let timer: ReturnType<typeof setTimeout> | undefined;
        const onChange = (event: Event) => {
            if ((event as CustomEvent<StudioAgentChange>).detail?.productId !== productId) return;
            clearTimeout(timer);
            timer = setTimeout(refresh, 150);
        };
        window.addEventListener(STUDIO_AGENT_CHANGE_EVENT, onChange);
        return () => {
            clearTimeout(timer);
            window.removeEventListener(STUDIO_AGENT_CHANGE_EVENT, onChange);
        };
    }, [productId]);
}

/** 打开助手并把一句话填进输入框，由用户确认后发送。 */
export function askStudioAgent(productId: string, productName: string, text: string) {
    const store = useGlobalAgentStore.getState();
    store.setStudio({ productId, productName, prefillRequest: { id: Date.now(), text } });
    store.openAgent();
}
