import { createRoot } from "react-dom/client";
import { App, ConfigProvider } from "antd";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import VideoReplicationPage from "@/pages/video-replication";
import { useConfigStore, createModelChannel, defaultConfig, encodeChannelModel } from "@/stores/use-config-store";
import { defaultModelCapabilityConfig } from "@/lib/model-capabilities";
import { setActiveUserScope } from "@/lib/user-scope";
import { useUserStore } from "@/stores/use-user-store";
import { getAntThemeConfig } from "@/lib/app-theme";
import { applySkinTheme, DEFAULT_CLASSIC_SKIN } from "@/lib/skin-themes";
import "@/styles/globals.css";

// 真实复刻页面的浏览器入口；网络与生成接口由浏览器测试隔离，不接触真实作品或付费渠道。
setActiveUserScope("remake-browser-fixture");
document.body.classList.add("app-user-overlays");
const params = new URLSearchParams(location.search);
const dark = params.get("theme") === "dark";
document.documentElement.classList.toggle("dark", dark);
applySkinTheme(DEFAULT_CLASSIC_SKIN, dark ? "dark" : "light");
const channel = createModelChannel({ id: "synthetic-video", name: "测试视频渠道", baseUrl: "/api", apiKey: "", interfaceType: "volcengine-ark-video", models: ["test-video"] });
channel.modelCosts = [{ model: "test-video", capabilityConfig: defaultModelCapabilityConfig("volcengine-ark-video") }];
const model = encodeChannelModel(channel.id, "test-video");
useConfigStore.setState({ config: { ...defaultConfig, channels: [channel], videoModel: model, model } });
useUserStore.setState((state) => ({ features: { ...state.features, customChannelsEnabled: true, creditsEnabled: false } }));
const route = `/video-replication?remake=browser-work${params.get("step") ? `&step=${params.get("step")}` : ""}`;
createRoot(document.getElementById("root")!).render(
    <ConfigProvider theme={getAntThemeConfig(dark, DEFAULT_CLASSIC_SKIN)} button={{ autoInsertSpace: false }}>
        <QueryClientProvider client={new QueryClient()}>
            <App>
                <MemoryRouter initialEntries={[route]}>
                    <div style={{ height: "100dvh" }}>
                        <VideoReplicationPage />
                    </div>
                </MemoryRouter>
            </App>
        </QueryClientProvider>
    </ConfigProvider>,
);
