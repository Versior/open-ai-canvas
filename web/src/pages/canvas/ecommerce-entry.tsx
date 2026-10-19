import { App, Button } from "antd";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { ecommerceCanvasPreset, ecommerceCanvasTitle } from "@/lib/ecommerce/ecommerce-canvas-preset";
import { createCanvasProjectWithRemoteSync } from "@/services/user-data-sync";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useEcommerceSettings } from "@/stores/use-ecommerce-settings";

export default function EcommerceEntry() {
    const navigate = useNavigate();
    const { message } = App.useApp();
    const hydrated = useCanvasStore(state => state.hydrated);
    const creation = useRef<ReturnType<typeof createCanvasProjectWithRemoteSync> | null>(null);
    const [error, setError] = useState("");
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        if (!hydrated) return;
        let active = true;
        creation.current ??= (async () => {
            const setting = await useEcommerceSettings.getState().load();
            if (!setting.enabled) throw new Error("管理员已停用新建电商画布");
            const titles = useCanvasStore.getState().projects.map(project => project.title);
            return createCanvasProjectWithRemoteSync(ecommerceCanvasTitle(titles), undefined, { ...ecommerceCanvasPreset(), kind: "ecommerce" });
        })();
        void creation.current.then(({ id, syncError }) => {
            if (!active) return;
            if (syncError) message.warning("电商画布已在本地创建，云端同步失败，请稍后重试同步");
            navigate(`/canvas/${id}`, { replace: true });
        }).catch(reason => {
            if (active) setError(reason instanceof Error ? reason.message : "创建电商画布失败");
        });
        return () => { active = false; };
    }, [attempt, hydrated, message, navigate]);

    return <main className="flex h-full flex-col items-center justify-center gap-4 text-sm" aria-live="polite">
        <p>{error || "正在打开电商创作…"}</p>
        {error ? <Button onClick={() => { creation.current = null; setError(""); setAttempt(value => value + 1); }}>重试</Button> : null}
        <Link to="/canvas" className="text-muted-foreground underline">返回画布列表</Link>
    </main>;
}
