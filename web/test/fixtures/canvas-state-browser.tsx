import { useState } from "react";
import { createRoot } from "react-dom/client";
import { App, ConfigProvider } from "antd";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CanvasNode } from "@/components/canvas/canvas-node";
import { CanvasNodeType } from "@/types/canvas";
import { useThemeStore } from "@/stores/use-theme-store";
import { getAntThemeConfig } from "@/lib/app-theme";
import { applySkinTheme, DEFAULT_CLASSIC_SKIN } from "@/lib/skin-themes";
import "@/styles/globals.css";

const dark = new URLSearchParams(location.search).get("theme") !== "light";
document.documentElement.classList.toggle("dark", dark);
applySkinTheme(DEFAULT_CLASSIC_SKIN, dark ? "dark" : "light");
useThemeStore.setState({ theme: dark ? "dark" : "light" });
const noop = () => {};

function StateCheck() {
    const [factor, setFactor] = useState(1);
    const [scale, setScale] = useState(1);
    const [status, setStatus] = useState("empty");
    return (
        <>
            <nav style={{ display: "flex", gap: 16, padding: 16 }}>
                <button onClick={() => setFactor(factor === 1 ? 8 : 1)}>节点尺寸：{factor}倍</button>
                <button onClick={() => setScale(scale === 1 ? 0.2 : 1)}>画布缩放：{Math.round(scale * 100)}%</button>
                <select aria-label="节点状态" value={status} onChange={(e) => setStatus(e.target.value)}>
                    <option value="empty">空图片</option>
                    <option value="loading">生成中</option>
                    <option value="error">生成失败</option>
                    <option value="preview">简化预览</option>
                </select>
            </nav>
            <div style={{ position: "relative", margin: 24, width: 900, height: 700 }}>
                <div style={{ transform: `scale(${scale})`, transformOrigin: "top left" }}>
                    <CanvasNode
                        data={{
                            id: "state-check",
                            title: "图片节点",
                            type: CanvasNodeType.Image,
                            position: { x: 0, y: 0 },
                            width: 340 * factor,
                            height: 420 * factor,
                            metadata: { status: status === "loading" || status === "error" ? status : undefined, errorDetails: status === "error" ? "测试错误，请重试" : undefined },
                        }}
                        renderLOD={status === "preview" ? "preview" : "full"}
                        scale={scale}
                        isSelected={false}
                        isRelated={false}
                        isFocusRelated={false}
                        isConnectionTarget={false}
                        showImageInfo={false}
                        onMouseDown={noop}
                        onHoverStart={noop}
                        onHoverEnd={noop}
                        onConnectStart={noop}
                        onResize={noop}
                        onContentChange={noop}
                        onContextMenu={noop}
                    />
                </div>
            </div>
        </>
    );
}
createRoot(document.getElementById("root")!).render(
    <ConfigProvider theme={getAntThemeConfig(dark, DEFAULT_CLASSIC_SKIN)}>
        <QueryClientProvider client={new QueryClient()}>
            <App>
                <StateCheck />
            </App>
        </QueryClientProvider>
    </ConfigProvider>,
);
