import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App, ConfigProvider } from "antd";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReplicationHome } from "@/pages/video-replication/replication-home";
import { useConfigStore, createModelChannel, defaultConfig, encodeChannelModel } from "@/stores/use-config-store";
import { defaultModelCapabilityConfig } from "@/lib/model-capabilities";
import { setActiveUserScope } from "@/lib/user-scope";
import { useUserStore } from "@/stores/use-user-store";
import { getAntThemeConfig } from "@/lib/app-theme";
import { applySkinTheme, DEFAULT_CLASSIC_SKIN } from "@/lib/skin-themes";
import "@/styles/globals.css";
import "@/pages/video-replication/video-replication.css";

setActiveUserScope("synthetic-browser-owner");
document.body.classList.add("app-user-overlays");
const dark = new URLSearchParams(location.search).get("theme") === "dark";
document.documentElement.classList.toggle("dark", dark);
applySkinTheme(DEFAULT_CLASSIC_SKIN, dark ? "dark" : "light");
const channel = createModelChannel({ id: "synthetic-video", name: "Synthetic video", baseUrl: "/api", apiKey: "", interfaceType: "volcengine-ark-video", models: ["test-video"] });
channel.modelCosts = [{ model: "test-video", capabilityConfig: defaultModelCapabilityConfig("volcengine-ark-video") }];
const model = encodeChannelModel(channel.id, "test-video");
useConfigStore.setState({ config: { ...defaultConfig, channels: [channel], videoModel: model, model } });
useUserStore.setState((state) => ({ features: { ...state.features, customChannelsEnabled: true, creditsEnabled: false } }));
const config = useConfigStore.getState().config;
// 隔离上传与付费渠道；渲染生产首页、生产弹窗和生产视频流程。
createRoot(document.getElementById("root")!).render(
    <StrictMode>
        <ConfigProvider theme={getAntThemeConfig(dark, DEFAULT_CLASSIC_SKIN)} button={{ autoInsertSpace: false }}>
            <QueryClientProvider client={new QueryClient()}>
                <App>
                    <ReplicationHome
                        composer={{ config, model, onModelChange: () => {}, transcribe: false, transcribeNote: "", onTranscribeChange: () => {}, limits: undefined, linkImportEnabled: false, busy: false, run: null, onStart: () => {} }}
                        records={[]}
                        loading={false}
                        error=""
                        activeRun={null}
                        onOpen={() => {}}
                        tabs={null}
                        tab="new"
                        works={null}
                        referenceId=""
                        onReferenceChange={() => {}}
                        onRemake={async () => {}}
                        creating={false}
                        onCreative={async () => {}}
                    />
                </App>
            </QueryClientProvider>
        </ConfigProvider>
    </StrictMode>,
);
