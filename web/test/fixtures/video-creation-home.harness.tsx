import { afterAll, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import type { ComponentProps } from "react";
import type { RemakeProduct } from "@/lib/remake/job";
import type { StudioSetEntry } from "@/lib/ecommerce-studio/runs";

const dom = new Window({ url: "http://localhost/" });
for (const key of ["window", "document", "navigator", "HTMLElement", "SVGElement", "ShadowRoot", "Element", "Node", "Event", "CustomEvent", "MutationObserver", "ResizeObserver"]) {
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
mock.module("@/components/fashion/fashion-video-workbench", () => ({ FashionVideoWorkbench: () => <span>既有人物处理工作台</span> }));
mock.module("@/pages/video-replication/replication-composer", () => ({ ReplicationComposer: () => <span>既有参考视频输入</span> }));
mock.module("@/pages/video-replication/replication-recent", () => ({ ReplicationRecent: () => null }));
mock.module("@/pages/video-replication/use-replication-runner", () => ({ REPLICATION_STAGE_LABELS: {} }));
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
mock.module("@/pages/video-replication/use-material-analysis", () => ({
    useMaterialAnalysis: ({ onResult }: { onResult: typeof applyMaterial }) => {
        applyMaterial = onResult;
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
            void render();
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
    onCreative: async (...args) => {
        submitted.push(structuredClone(args));
    },
};
const button = (text: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.trim() === text)!;
async function render() {
    await act(async () =>
        root.render(
            <QueryClientProvider client={client}>
                <App>
                    <ReplicationHome {...props} />
                </App>
            </QueryClientProvider>,
        ),
    );
}
async function click(text: string) {
    await act(async () => button(text).click());
}
async function fill(label: string, value: string) {
    const field = host.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`[aria-label="${label}"]`)!;
    const prototype = Object.getPrototypeOf(field);
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(field, value);
    await act(async () => field.dispatchEvent(new dom.Event(field.tagName === "SELECT" ? "change" : "input", { bubbles: true })));
}
async function confirmFacts() {
    await act(async () => host.querySelector<HTMLInputElement>('.vc-director input[type="checkbox"]')!.click());
    expect(host.querySelector<HTMLInputElement>('.vc-director input[type="checkbox"]')!.checked, host.querySelector(".vc-editor-footer")!.textContent || "").toBe(true);
}

afterAll(async () => {
    await act(async () => root.unmount());
    client.clear();
    await dom.happyDOM.abort();
});

test("商品展示直接要求图片，选商品只回填，不提前创建作品", async () => {
    await act(async () => useUserStore.getState().setUser({ id: "home-fixture", username: "test", role: "user", status: "active" }));
    useUserStore.setState((state) => ({ features: { ...state.features, customChannelsEnabled: true } }));
    await render();
    await click("商品展示");
    expect(host.querySelector('[aria-label="上传商品图"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="从素材库选择商品图"]')).not.toBeNull();
    expect(button("导演分析与策划").disabled).toBe(true);
    await click("从生图台选商品");
    await click("选择测试商品");
    expect(submitted).toHaveLength(0);
    expect(host.querySelector<HTMLInputElement>('[aria-label="商品名称"]')!.value).toBe("测试杯");
    expect(host.querySelector('img[alt="商品实拍"]')).not.toBeNull();
    expect(button("导演分析与策划").disabled).toBe(true);
    await confirmFacts();
    expect(button("导演分析与策划").disabled, host.querySelector(".vc-editor-footer")!.textContent || "").toBe(false);
});

test("口播带货在首页展示人物场景和声音，缺身份时不能策划", async () => {
    await click("口播带货");
    expect(host.textContent).toContain("出镜人物 · 必填");
    expect(host.querySelector('[aria-label="上传模特图"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="从模特库选择模特"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="上传背景图"]')).not.toBeNull();
    expect(host.textContent).toContain("人物口播");
    expect(host.textContent).toContain("身份参考");
    expect(button("导演分析与策划").disabled).toBe(true);
    await click("商品展示");
    expect(button("导演分析与策划").disabled).toBe(false);
});
test("导演入口强校验图文模型，修改主体资料与图片后需要重新核对", async () => {
    await fill("测试导演模型", "");
    expect(button("导演分析与策划").disabled).toBe(true);
    expect(host.textContent).toContain("请选择导演策划模型");
    await fill("测试导演模型", textOnlyModel);
    expect(button("导演分析与策划").disabled).toBe(true);
    expect(host.textContent).toContain("导演分析需要支持参考图片");
    await fill("测试导演模型", model);
    await fill("商品名称", "新杯名");
    expect(host.querySelector<HTMLInputElement>('.vc-director input[type="checkbox"]')!.checked).toBe(false);
    expect(button("导演分析与策划").disabled).toBe(true);
    await confirmFacts();
    await fill("商品卖点", "新确认资料");
    expect(button("导演分析与策划").disabled).toBe(true);
    await click("从生图台选商品");
    await click("选择测试商品");
    expect(button("导演分析与策划").disabled).toBe(true);
    await confirmFacts();
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="移除这张商品图"]')!.click());
    expect(host.querySelector<HTMLInputElement>('.vc-director input[type="checkbox"]')!.checked).toBe(false);
    expect(button("导演分析与策划").disabled).toBe(true);
    await click("从生图台选商品");
    await click("选择测试商品");
});

test("切换用途与流程保留素材，创建时一次交接所有输入", async () => {
    await click("参考视频复刻");
    expect(host.textContent).toContain("既有参考视频输入");
    await click("人物与服装处理");
    expect(host.textContent).toContain("既有人物处理工作台");
    await click("素材创作");
    await click("创意广告");
    await fill("创作要求", "展示杯身与使用动作");
    await fill("创作画幅", "16:9");
    await fill("创作片长", "30");
    await click("导演分析与策划");
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
    await click("人物与服装处理");
    await click("实拍杯身教程");
    expect(button("素材创作").getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector(".vc-editor-footer")?.textContent).toContain("选题：实拍杯身教程");
    expect(host.querySelector(".vc-creative-topic")).toBeNull();
    await click("导演分析与策划");
    expect(submitted[1][0].topic?.title).toBe("实拍杯身教程");
});

test("创建期间不能换流程，账号变化清除上一账号的素材和要求", async () => {
    props.creating = true;
    await render();
    expect(button("参考视频复刻").disabled).toBe(true);
    expect(button("正在提交导演策划…").disabled).toBe(true);
    props.creating = false;
    await act(async () => useUserStore.getState().setUser({ id: "next_user", username: "test", displayName: "测试账号", role: "user", status: "active" }));
    await render();
    expect(host.querySelector('img[alt="商品实拍"]')).toBeNull();
    expect(host.querySelector<HTMLInputElement>('[aria-label="商品名称"]')!.value).toBe("");
    expect(host.querySelector<HTMLTextAreaElement>('[aria-label="创作要求"]')!.value).toBe("");
    expect(button("导演分析与策划").disabled).toBe(true);
    expect(host.querySelector<HTMLInputElement>('.vc-director input[type="checkbox"]')!.checked).toBe(false);
});

test("前台只读共享选题并用于策划，没有授权与凭据表单", async () => {
    expect(host.textContent).not.toContain("扩展");
    expect(host.textContent).not.toContain("扫码连接");
    expect(host.textContent).not.toContain("专用窗口");
    await click("巨量千川");
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(host.textContent).not.toContain("授权");
    expect(host.querySelector('input[type="password"]')).toBeNull();
    expect(host.querySelector(".vc-api-form")).toBeNull();
    expect(host.querySelector('[aria-label="导入热点数据"]')).toBeNull();
    expect(host.textContent).toContain("千川素材灵感");
    await click("接口测试素材");
    expect(host.querySelector(".vc-editor-footer")?.textContent).toContain("选题：接口测试素材");
    rejectBoard = true;
    await act(async () => {
        await client.invalidateQueries({ queryKey: ["video-trends"], refetchType: "active" });
        await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(host.textContent).toContain("暂时无法更新选题，保留上次的内容");
    expect(button("接口测试素材")).toBeDefined();
    rejectBoard = false;
    await act(async () => useUserStore.getState().setUser({ id: "another_user", username: "other", displayName: "另一个测试账号", role: "user", status: "active" }));
    expect(host.querySelector(".vc-editor-footer")?.textContent).not.toContain("选题：接口测试素材");
});

test("未发布来源仅展示简洁空态，不向用户显示配置入口", async () => {
    await click("巨量创意");
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(host.textContent).toContain("选题正在准备中");
    expect(host.textContent).not.toContain("接入广告项目推荐");
    expect(document.querySelector(".ant-drawer")).toBeNull();
});

test("热点宝服务器网页接口标明来源并能选择主题，不标成官方OAuth", async () => {
    serverWebBoard = true;
    await click("热点宝");
    await act(async () => {
        await client.invalidateQueries({ queryKey: ["video-trends"], refetchType: "active" });
        await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(host.textContent).toContain("热点宝近24小时视频榜");
    expect(host.textContent).not.toContain("OAuth");
    await click("服务器热点标题");
    expect(host.querySelector(".vc-editor-footer")?.textContent).toContain("选题：服务器热点标题");
    serverWebBoard = false;
});

test("AI回填未修改字段，保留手动输入与商品档案资料", async () => {
    await click("从生图台选商品");
    await click("选择测试商品");
    await fill("创作要求", "保留我的要求");
    await act(async () => applyMaterial({ name: "AI杯", sellingPoints: "AI卖点", audience: "桌面收纳爱好者", objective: "了解外观", brand: "柔和光线", note: "AI拍法", tone: "natural", questions: [] }));
    expect(host.querySelector<HTMLInputElement>('[aria-label="商品名称"]')!.value).toBe("测试杯");
    expect(host.querySelector<HTMLTextAreaElement>('[aria-label="商品卖点"]')!.value).toBe("蓝色杯身");
    expect(host.querySelector<HTMLTextAreaElement>('[aria-label="创作要求"]')!.value).toBe("保留我的要求");
    expect(host.querySelector<HTMLInputElement>('[aria-label="创作观众"]')!.value).toBe("桌面收纳爱好者");
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
