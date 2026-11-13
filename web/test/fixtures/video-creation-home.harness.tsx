import { afterAll, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import "fake-indexeddb/auto";
import type { ComponentProps } from "react";
import type { RemakeProduct } from "@/lib/remake/job";
import type { StudioSetEntry } from "@/lib/ecommerce-studio/runs";

const dom = new Window({ url: "http://localhost/" });
Object.defineProperty(dom, "indexedDB", { configurable: true, value: indexedDB });
for (const key of ["window", "document", "navigator", "localStorage", "HTMLElement", "SVGElement", "ShadowRoot", "Element", "Node", "Event", "CustomEvent", "MutationObserver", "ResizeObserver"]) {
    Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? dom : key === "document" ? dom.document : dom[key as keyof Window] });
}
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
Object.defineProperty(globalThis, "getComputedStyle", { configurable: true, value: dom.getComputedStyle.bind(dom) });
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { App } = await import("antd");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { useUserStore } = await import("@/stores/use-user-store");
const { defaultConfig, createModelChannel, encodeChannelModel } = await import("@/stores/use-config-store");
const { defaultModelCapabilityConfig } = await import("@/lib/model-capabilities");
const { creativeFactsInput } = await import("@/lib/remake/creative");
const { setActiveUserScope, getActiveUserScope } = await import("@/lib/user-scope");
const { useAgentPetPrefsStore } = await import("@/stores/use-agent-pet-prefs-store");
mock.module("@/hooks/use-active-agent-pet", () => ({ useActiveAgentPet: () => ({ pet: null, pending: false }) }));
const channel = createModelChannel({ id: "test-text", name: "测试", interfaceType: "openai", baseUrl: "/api", apiKey: "", models: ["gpt-4o", "gpt-3.5-turbo"] });
channel.modelCosts = channel.models.map((model) => {
    const capabilityConfig = defaultModelCapabilityConfig("openai", model);
    if (model === "gpt-4o") capabilityConfig.text!.references.maxImages = 4;
    return { model, capabilityConfig };
});
const model = encodeChannelModel(channel.id, "gpt-4o");
const textOnlyModel = encodeChannelModel(channel.id, "gpt-3.5-turbo");
const config = { ...defaultConfig, channels: [channel], textModel: model };
const product: RemakeProduct = { name: "测试杯", sellingPoints: "蓝色杯身", images: [{ id: "photo", resourceId: "product_image", name: "商品实拍" }] };
mock.module("@/components/fashion/fashion-video-workbench", () => ({
    FashionVideoWorkbench: ({ onClose }: { onClose: () => void }) => (
        <div>
            既有人物处理工作台<button onClick={onClose}>返回对话</button>
        </div>
    ),
}));
mock.module("@/pages/video-replication/replication-composer", () => ({ ReplicationComposer: () => <span>既有参考视频输入</span> }));
mock.module("@/pages/video-replication/replication-recent", () => ({ ReplicationRecent: () => null }));
mock.module("@/pages/video-replication/use-replication-runner", () => ({ REPLICATION_STAGE_LABELS: {}, videoReplicationKeys: { detail: (scope: string, id: string) => ["reference", scope, id] } }));
mock.module("@/components/model-picker", () => ({
    ModelPicker: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
        <select aria-label="测试导演模型" value={value} onChange={(event) => onChange(event.target.value)}>
            <option value="">未选择</option>
            <option value={model}>图文模型</option>
            <option value={textOnlyModel}>纯文本模型</option>
        </select>
    ),
}));
let applyMaterial: (value: import("@/lib/remake/materials").CreativeMaterialSuggestion) => void;
let analysisPaused = false;
mock.module("@/pages/video-replication/use-material-analysis", () => ({
    useMaterialAnalysis: ({ onResult, paused }: { onResult: typeof applyMaterial; paused: boolean }) => {
        applyMaterial = onResult;
        analysisPaused = paused;
        return { busy: false, error: "", questions: [], recognized: false, retry: () => {} };
    },
}));
let rejectBoard = false;
let serverWebBoard = false;
mock.module("@/services/api/video-trends", () => ({
    getVideoTrends: async (source: string) => {
        if (rejectBoard) throw new Error("平台刷新暂时失败");
        if (serverWebBoard && source === "douhot")
            return { source, status: "web_api", description: "热点宝近24小时视频榜 · 网页接口", topics: [{ title: "服务器热点标题", url: "https://www.douyin.com/video/789", rank: 1 }], fetchedAt: new Date().toISOString() };
        if (source === "qianchuan") return { source, status: "api", description: "千川素材灵感", topics: [{ title: "接口测试素材", url: "https://www.douyin.com/video/456", rank: 1 }], fetchedAt: new Date().toISOString() };
        if (source === "douhot") return { source, status: "web_api", topics: [{ title: "实拍杯身教程", url: "https://www.douyin.com/video/123", rank: 1 }], fetchedAt: new Date().toISOString() };
        return { source, status: "unavailable", topics: [] };
    },
}));
mock.module("@/pages/video-replication/remake/remake-product-picker", () => ({ RemakeProductPicker: ({ onPick }: { onPick: (value: RemakeProduct) => void }) => <button onClick={() => onPick(product)}>选择测试商品</button> }));
const { ReplicationHome } = await import("@/pages/video-replication/replication-home");
const host = document.createElement("div");
document.body.append(host);
const root = createRoot(host);
const client = new QueryClient();
const submitted: Parameters<ComponentProps<typeof ReplicationHome>["onCreative"]>[] = [];
const noop = () => {};
const props: ComponentProps<typeof ReplicationHome> = {
    composer: {
        config,
        model,
        onModelChange: (next) => {
            props.composer.model = next;
            paint();
        },
        transcribe: false,
        transcribeNote: "",
        onTranscribeChange: noop,
        limits: undefined,
        linkImportEnabled: false,
        busy: false,
        run: null,
        onStart: noop,
    },
    records: [],
    loading: false,
    error: "",
    activeRun: null,
    onOpen: noop,
    tabs: null,
    tab: "new",
    works: null,
    creating: false,
    referenceId: "",
    onReferenceChange: noop,
    onRemake: async () => {},
    onCreative: async (...args) => {
        submitted.push(structuredClone(args));
    },
};
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.getAttribute("aria-label") === text || item.textContent?.trim() === text)!;
function paint() {
    root.render(
        <QueryClientProvider client={client}>
            <App>
                <ReplicationHome key={getActiveUserScope()} {...props} />
            </App>
        </QueryClientProvider>,
    );
}
async function render() {
    await act(async () => paint());
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
}
async function click(text: string) {
    await act(async () => button(text).click());
}
async function fill(label: string, value: string) {
    const field =
        document.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`[aria-label="${label}"]`) ||
        [...document.querySelectorAll("label")].find((item) => item.textContent?.trim().startsWith(label))!.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input,textarea,select")!;
    const prototype = Object.getPrototypeOf(field);
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(field, value);
    await act(async () => field.dispatchEvent(new dom.Event(field.tagName === "SELECT" ? "change" : "input", { bubbles: true })));
}
async function confirmFacts() {
    await act(async () => host.querySelector<HTMLInputElement>('.vchat-next input[type="checkbox"]')!.click());
    expect(host.querySelector<HTMLInputElement>('.vchat-next input[type="checkbox"]')!.checked).toBe(true);
}
const closeSettings = () => act(async () => document.querySelector<HTMLButtonElement>(".ant-drawer-close")!.click());
async function scene(value: string) {
    await click("视频要求");
    await fill("视频用途", value);
    await closeSettings();
}
async function inspiration() {
    await click("热点与投放灵感");
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
    });
}

afterAll(async () => {
    await act(async () => root.unmount());
    client.clear();
    await dom.happyDOM.abort();
});

test("全部视频功能紧凑悬浮在输入框上方，开始对话后仍能切换", async () => {
    setActiveUserScope("home-visible-functions");
    await render();
    expect(host.querySelectorAll(".vchat-replies button")).toHaveLength(12);
    expect(button("视频换头")).toBeDefined();
    expect(button("多模特同款视频")).toBeDefined();
    expect(button("更多")).toBeUndefined();
    expect(host.querySelectorAll(".vchat-turns .vchat-replies")).toHaveLength(0);
    expect(host.querySelector(".vchat-replies")!.nextElementSibling === host.querySelector(".vchat-composer")).toBe(true);
    expect(host.querySelector(".vchat-replies small")).toBeNull();
    await click("用图片拍一条");
    expect(host.querySelectorAll(".vchat-replies button")).toHaveLength(12);
    await click("视频换头");
    expect(host.textContent).toContain("准备视频换头素材");
});

test("刷新恢复消息、输入草稿与素材，历史切换不重新识别素材", async () => {
    setActiveUserScope("home-history");
    props.composer.model = model;
    await render();
    await click("用图片拍一条");
    await click("从生图台选择商品");
    await click("选择测试商品");
    await fill("告诉导演你的创作要求", "保留这份未发送草稿");
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    await act(() => root.render(null));
    await render();
    expect(host.querySelector<HTMLTextAreaElement>(".vchat-composer textarea")!.value).toBe("保留这份未发送草稿");
    expect(host.querySelector('img[alt="商品实拍"]')).not.toBeNull();
    expect(host.querySelectorAll(".vchat-user").length).toBeGreaterThan(0);
    expect(analysisPaused).toBe(true);
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="新建视频对话"]')!.click());
    expect(host.querySelectorAll(".vchat-user")).toHaveLength(0);
    await click("对话历史");
    const old = [...document.querySelectorAll<HTMLButtonElement>(".vchat-history button")].find((item) => item.textContent?.includes("用图片拍一条"))!;
    await act(async () => old.click());
    expect(host.querySelector<HTMLTextAreaElement>(".vchat-composer textarea")!.value).toBe("保留这份未发送草稿");
    expect(analysisPaused).toBe(true);
});

test("商品展示直接要求图片，选商品只回填，不提前创建作品", async () => {
    setActiveUserScope("home-fixture");
    await act(async () => useUserStore.getState().setUser({ id: "home-fixture", username: "test", displayName: "测试", role: "user", status: "active" }));
    useUserStore.setState((state) => ({ features: { ...state.features, customChannelsEnabled: true } }));
    await render();
    expect(host.querySelectorAll(".vchat-replies button")).toHaveLength(12);
    expect(host.querySelectorAll(".vchat-composer textarea")).toHaveLength(1);
    await click("用图片拍一条");
    expect(host.querySelector('[aria-label="上传主体图片"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="从素材库选择主体图片"]')).not.toBeNull();
    await click("从生图台选择商品");
    await click("选择测试商品");
    expect(submitted).toHaveLength(0);
    expect(host.querySelector<HTMLInputElement>(".vchat-fields input")!.value).toBe("测试杯");
    expect(host.querySelector('img[alt="商品实拍"]')).not.toBeNull();
    expect(button("好，开始策划").disabled).toBe(true);
    await confirmFacts();
    expect(button("好，开始策划").disabled).toBe(false);
});

test("口播带货在首页展示人物场景和声音，缺身份时不能策划", async () => {
    await scene("selling");
    expect(host.textContent).toContain("出镜人物 · 必填");
    expect(host.querySelector('[aria-label="上传模特图"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="从模特库选择模特"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="上传背景图"]')).not.toBeNull();
    expect(host.textContent).toContain("人物口播");
    expect(host.textContent).toContain("身份参考");
    expect(button("好，开始策划").disabled).toBe(true);
    await scene("showcase");
    expect(button("好，开始策划").disabled).toBe(false);
});
test("导演入口强校验图文模型，修改主体资料与图片后需要重新核对", async () => {
    await fill("测试导演模型", "");
    expect(button("好，开始策划").disabled).toBe(true);
    expect(host.textContent).toContain("请选择");
    await fill("测试导演模型", textOnlyModel);
    expect(button("好，开始策划").disabled).toBe(true);
    expect(host.textContent).toContain("导演模型需要支持参考图片");
    await fill("测试导演模型", model);
    await fill("主体名称", "新杯名");
    expect(host.querySelector<HTMLInputElement>('.vchat-next input[type="checkbox"]')!.checked).toBe(false);
    expect(button("好，开始策划").disabled).toBe(true);
    await confirmFacts();
    await fill("已确认的主体资料", "新确认资料");
    expect(button("好，开始策划").disabled).toBe(true);
    await click("从生图台选择商品");
    await click("选择测试商品");
    expect(button("好，开始策划").disabled).toBe(true);
    await confirmFacts();
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="移除这张主体图片"]')!.click());
    expect(button("好，开始策划")).toBeUndefined();
    await click("从生图台选择商品");
    await click("选择测试商品");
});

test("切换用途与流程保留素材，创建时一次交接所有输入", async () => {
    await click("复刻镜头结构");
    expect(host.textContent).toContain("上传参考视频");
    await click("我想换脸");
    await click("加素材");
    expect(host.textContent).toContain("既有人物处理工作台");
    await click("返回对话");
    await click("用图片拍一条");
    await click("视频要求");
    expect(document.body.textContent).toContain("导演会参考这些要求继续对话，并用于后续策划");
    await fill("视频用途", "creative-ad");
    await fill("拍摄要求", "展示杯身与使用动作");
    await fill("画幅", "16:9");
    await fill("目标时长", "30");
    await closeSettings();
    await click("好，开始策划");
    expect(submitted).toHaveLength(1);
    expect(submitted[0]).toEqual([
        expect.objectContaining({ scene: "creative-ad", seconds: 30 }),
        "展示杯身与使用动作",
        "16:9",
        product,
        { model, confirmedInput: creativeFactsInput({ product }) },
        expect.objectContaining({ people: "none", audio: "mute", models: [], backgrounds: [] }),
    ]);
});

test("人物流程点击热点会切回素材创作并带入主题，不静默失效", async () => {
    await click("我想换脸");
    await inspiration();
    await click("实拍杯身教程");
    expect(host.querySelector(".vchat-toolbar")?.textContent).toContain("素材创作");
    expect(host.textContent).toContain("实拍杯身教程");
    await click("好，开始策划");
    expect(submitted[1][0].topic?.title).toBe("实拍杯身教程");
});

test("创建期间不能换流程，账号变化清除上一账号的素材和要求", async () => {
    props.creating = true;
    await render();
    expect(button("热点与投放灵感").disabled).toBe(true);
    expect(button("正在准备方案…").disabled).toBe(true);
    props.creating = false;
    setActiveUserScope("next_user");
    await act(async () => useUserStore.getState().setUser({ id: "next_user", username: "test", displayName: "测试账号", role: "user", status: "active" }));
    await render();
    expect(host.querySelector('img[alt="商品实拍"]')).toBeNull();
    expect(host.querySelectorAll(".vchat-user")).toHaveLength(0);
    expect(host.querySelector<HTMLTextAreaElement>(".vchat-composer textarea")!.value).toBe("");
    expect(button("好，开始策划")).toBeUndefined();
});

test("前台只读共享选题并用于策划，没有授权与凭据表单", async () => {
    expect(host.textContent).not.toContain("扩展");
    expect(host.textContent).not.toContain("扫码连接");
    expect(host.textContent).not.toContain("专用窗口");
    await inspiration();
    await click("巨量千川");
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(host.textContent).not.toContain("授权");
    expect(host.querySelector('input[type="password"]')).toBeNull();
    expect(host.querySelector(".vc-api-form")).toBeNull();
    expect(host.querySelector('[aria-label="导入热点数据"]')).toBeNull();
    expect(document.body.textContent).toContain("千川素材灵感");
    await click("接口测试素材");
    expect(host.textContent).toContain("接口测试素材");
    await inspiration();
    await click("巨量千川");
    rejectBoard = true;
    await act(async () => {
        await client.invalidateQueries({ queryKey: ["video-trends"], refetchType: "active" });
        await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(document.body.textContent).toContain("暂时无法更新选题，保留上次的内容");
    expect(button("接口测试素材")).toBeDefined();
    rejectBoard = false;
    setActiveUserScope("another_user");
    await render();
    expect(host.textContent).not.toContain("接口测试素材");
    await inspiration();
});

test("未发布来源仅展示简洁空态，不向用户显示配置入口", async () => {
    await click("巨量创意");
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(document.body.textContent).toContain("选题正在准备中");
    expect(document.body.textContent).not.toContain("接入广告项目推荐");
});

test("热点宝服务器网页接口标明来源并能选择主题，不标成官方OAuth", async () => {
    serverWebBoard = true;
    await click("热点宝");
    await act(async () => {
        await client.invalidateQueries({ queryKey: ["video-trends"], refetchType: "active" });
        await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(document.body.textContent).toContain("热点宝近24小时视频榜");
    expect(document.body.textContent).not.toContain("OAuth");
    await click("服务器热点标题");
    expect(host.textContent).toContain("服务器热点标题");
    serverWebBoard = false;
});

test("AI回填未修改字段，保留手动输入与商品档案资料", async () => {
    await click("从生图台选择商品");
    await click("选择测试商品");
    await click("视频要求");
    await fill("拍摄要求", "保留我的要求");
    await act(async () => applyMaterial({ name: "AI杯", sellingPoints: "AI卖点", audience: "桌面收纳爱好者", objective: "了解外观", brand: "柔和光线", note: "AI拍法", tone: "natural", questions: [] }));
    expect(host.querySelector<HTMLInputElement>(".vchat-fields input")!.value).toBe("测试杯");
    expect(host.querySelector<HTMLTextAreaElement>(".vchat-fields textarea")!.value).toBe("蓝色杯身");
    expect(document.querySelector<HTMLTextAreaElement>(".ant-drawer textarea")!.value).toBe("保留我的要求");
    expect([...document.querySelectorAll<HTMLInputElement>(".ant-drawer input")].some((field) => field.value === "桌面收纳爱好者")).toBe(true);
    await closeSettings();
});

test("视频对话沿用智能体皮肤偏好与共同的气泡输入框样式", async () => {
    for (const skin of ["cloud", "paper", "terminal", "aurora", "site"] as const) {
        await act(async () => useAgentPetPrefsStore.getState().setSkin(skin));
        expect(host.querySelector(".agent-chat-theme")?.getAttribute("data-skin")).toBe(skin);
        expect(host.querySelector(".vchat-user.agent-message-user")).not.toBeNull();
        expect(host.querySelector(".vchat-composer.agent-composer-surface")).not.toBeNull();
        expect(host.querySelector('[aria-label="发送创作要求"]')?.classList.contains("agent-composer-send")).toBe(true);
    }
    await act(async () => useAgentPetPrefsStore.getState().setSkin("auto"));
    expect(host.querySelector(".agent-chat-theme")?.getAttribute("data-skin")).toBe("cloud");
});

test("首页导演任务显示实际进度，离开后才提供恢复，使用提交时选择的模型", async () => {
    const { CreativePlanner } = await import("@/pages/video-replication/remake/creative-planner");
    const { createCreativeJob } = await import("@/lib/remake/creative");
    const job = createCreativeJob("planner-progress", product);
    job.creative!.confirmedInput = creativeFactsInput(job);
    job.creative!.run = { id: "run-progress", kind: "plan", model, count: 4, input: "fixture", prompt: "fixture", imageResourceIds: ["product_image"], status: "running", settled: false };
    const paint = (running: boolean) =>
        root.render(
            <App>
                <CreativePlanner job={job} config={{ ...config, textModel: textOnlyModel }} edit={noop} disabled={false} running={running} flush={async () => {}} onBusy={noop} />
            </App>,
        );
    await act(async () => paint(true));
    expect(host.querySelector('[aria-label="视频策划"]')!.getAttribute("aria-busy")).toBe("true");
    expect(host.querySelector<HTMLSelectElement>('[aria-label="测试导演模型"]')!.value).toBe(model);
    expect(host.textContent).toContain("导演正在结合素材");
    expect(host.textContent).not.toContain("恢复上次策划");
    expect(button("生成脚本方案").disabled).toBe(true);
    await act(async () => paint(false));
    expect(host.textContent).toContain("恢复上次策划");
    expect(button("恢复上次策划").disabled).toBe(false);
    job.creative!.run = { ...job.creative!.run, status: "succeeded", settled: true };
    await act(async () => paint(false));
    expect(host.textContent).not.toContain("恢复上次策划");
    expect(button("生成脚本方案").disabled).toBe(false);
});

test("生图前的首屏编辑器同样显示两条预算并保留超限原文", async () => {
    const { StudioShotList } = await import("@/pages/ecommerce-studio/studio-shot-list");
    let entry: StudioSetEntry = { key: "p0", planIndex: 0, role: "detail-hero", title: "首屏", purpose: "识别", layout: "poster", included: true, copy: { headline: "蓝色杯身", subline: "可见把手", lines: [] } };
    const paint = () =>
        root.render(
            <App>
                <StudioShotList
                    entries={[entry]}
                    unit="屏"
                    onToggle={noop}
                    onMove={noop}
                    onEditPlan={(_index, patch) => {
                        entry = { ...entry, copy: { ...entry.copy!, ...patch } };
                        paint();
                    }}
                />
            </App>,
        );
    await act(async () => paint());
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="修改这一屏：首屏"]')!.click());
    expect(host.textContent).toContain("最多 2 条");
    const field = host.querySelector<HTMLTextAreaElement>("#es-plan-p0-lines")!;
    const raw = Array.from({ length: 7 }, (_, index) => `要点${index + 1}`).join("\n");
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), "value")!.set!.call(field, raw);
    await act(async () => field.dispatchEvent(new dom.Event("input", { bubbles: true })));
    expect(host.querySelector<HTMLTextAreaElement>("#es-plan-p0-lines")!.value).toBe(raw);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("信息过密");
});
