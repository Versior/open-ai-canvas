import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import { readFileSync } from "node:fs";
import { emptyEcommerceDraft, type EcommercePlan } from "@/services/api/ecommerce";
import type { AiConfig } from "@/stores/use-config-store";

const dom = new Window({ url: "https://commerce.example.com/ecommerce" });
const globals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    location: dom.location,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    Element: dom.Element,
    Node: dom.Node,
    SVGElement: dom.SVGElement,
    ShadowRoot: dom.ShadowRoot,
    Event: dom.Event,
    MouseEvent: dom.MouseEvent,
    DOMParser: dom.DOMParser,
    ResizeObserver: dom.ResizeObserver,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    globals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { CommerceDirectionCards } = await import("@/pages/ecommerce/direction-cards");
const { CommerceResultImage } = await import("@/pages/ecommerce/result-image");
const { EcommerceResultGallery } = await import("@/pages/ecommerce/result-gallery");
const { EcommerceAgentFeed } = await import("@/pages/ecommerce/agent-feed");
const { StudioShotList } = await import("@/pages/ecommerce-studio/studio-shot-list");
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot> | undefined;
async function render(element: React.ReactNode) {
    if (!root) {
        host = document.createElement("div");
        document.body.append(host);
        root = createRoot(host);
    }
    await act(async () => root!.render(element));
}
afterEach(async () => {
    await act(async () => root?.unmount());
    root = undefined;
    host?.remove();
});
afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, value] of globals) {
        if (value) Object.defineProperty(globalThis, key, value);
        else Reflect.deleteProperty(globalThis, key);
    }
});

test("studio editor displays and selects shared catalog compositions", async () => {
    const edit = mock(() => {});
    await render(
        <StudioShotList
            entries={[{ key: "screen", planIndex: 0, title: "镜框细节", role: "detail-closeup", included: true, purpose: "观察前框", layout: "editorial", composition: "sidebar", copy: { headline: "清透前框", subline: "", lines: [] } }]}
            unit="屏"
            onToggle={() => {}}
            onMove={() => {}}
            onEditPlan={edit}
        />,
    );
    expect(host.textContent).toContain("杂志编辑");
    expect(host.textContent).toContain("窄栏编辑");
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="修改这一屏：镜框细节"]')!.click());
    const control = host.querySelector('[aria-label="这一屏的图文构图"]')!.closest(".ant-select")!;
    await act(async () => control.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    const option = [...document.querySelectorAll<HTMLElement>(".ant-select-item-option")].find((item) => item.textContent === "框景留白");
    expect(option).toBeDefined();
    await act(async () => option!.click());
    expect(edit).toHaveBeenCalledWith(0, { composition: "window" });
});

test("style selection is reviewable and only confirmation starts generation", async () => {
    const directions = ["赛博朋克", "潮流穿搭", "潮酷电音", "日系唱片"].map((name, index) => ({ id: String(index), name, summary: "独立的字体、场景与美术规则", tags: ["9:16"] }));
    const choose = mock(() => {});
    await render(<CommerceDirectionCards directions={directions} followup={false} disabled={false} degraded={false} onChoose={choose} onRefresh={() => {}} />);
    const confirm = () => host.querySelector<HTMLButtonElement>(".commerce-direction-confirm")!;
    expect(confirm().disabled).toBe(true);
    expect(confirm().textContent).toContain("先选择一个方向");
    await act(async () => host.querySelectorAll<HTMLButtonElement>(".flylep-direction-card")[1].click());
    expect(choose).not.toHaveBeenCalled();
    expect(confirm().disabled).toBe(false);
    expect(confirm().textContent).toContain("按此风格生成");
    expect(host.querySelector('[aria-pressed="true"]')?.textContent).toContain("潮流穿搭");
    await act(async () => confirm().click());
    expect(choose).toHaveBeenCalledWith(directions[1]);
    await render(<CommerceDirectionCards directions={directions.map((item) => ({ ...item, id: `new-${item.id}` }))} followup disabled={false} degraded={false} onChoose={choose} onRefresh={() => {}} />);
    expect(confirm().disabled).toBe(true);
});

test("image loading reveals on load, stops on failure, and resets for a new result", async () => {
    await render(<CommerceResultImage key="a" src="/a.png" ratio={9 / 16} alt="作品" />);
    expect(host.textContent).toContain("正在载入作品");
    await act(async () => host.querySelector("img")!.dispatchEvent(new Event("load")));
    expect(host.querySelector(".is-loaded")).not.toBeNull();
    expect(host.querySelector('[role="status"]')).toBeNull();
    await render(<CommerceResultImage key="b" src="/b.png" ratio={9 / 16} alt="作品" />);
    expect(host.querySelector(".is-loading")).not.toBeNull();
    await act(async () => host.querySelector("img")!.dispatchEvent(new Event("error")));
    expect(host.textContent).toContain("图片加载失败");
    expect(host.querySelector(".commerce-progress-orbit")).toBeNull();
});

test("resized and rotated result frames keep the entire artwork visible", async () => {
    const style = document.createElement("style");
    style.textContent = readFileSync(new URL("../src/pages/ecommerce/result-image.css", import.meta.url), "utf8");
    document.head.append(style);
    try {
        for (const rotation of [0, 90, 180, 270]) {
            await render(<CommerceResultImage src="/wide.png" ratio={9 / 16} frameRatio={1 / 2} rotation={rotation} alt="作品" />);
            const img = host.querySelector("img")!;
            Object.defineProperties(img, { naturalWidth: { configurable: true, value: 1536 }, naturalHeight: { configurable: true, value: 1024 } });
            await act(async () => img.dispatchEvent(new Event("load")));
            expect(getComputedStyle(img).objectFit).toBe("contain");
            expect(parseFloat((host.querySelector(".commerce-result-image-shell") as HTMLElement).style.aspectRatio)).toBe(0.5);
            expect(img.style.transform).toContain(`rotate(${rotation}deg)`);
        }
    } finally {
        style.remove();
    }
});

test("all nine slots animate before submission and while task receipts recover", async () => {
    const draft = { ...emptyEcommerceDraft(), imageType: "detail", count: 9, ratio: "9:16" };
    const plan: EcommercePlan = {
        productSummary: "耳机",
        confirmedFacts: [],
        uncertainFacts: [],
        visualStrategy: "街头",
        qualityChecks: [],
        images: Array.from({ length: 9 }, (_, index) => ({
            id: `image-${index}`,
            imageType: "detail",
            platform: "taobao",
            language: "zh-CN",
            goal: "真实设计",
            theme: "日常",
            composition: "大字",
            mainVisual: "耳机",
            verifiedClaims: "",
            copy: "自己的节奏",
            lighting: "日光",
            fidelity: "原色",
            prompt: "保持真实商品",
            negativePrompt: "黑条",
            imageModel: "image",
            ratio: "9:16",
            resolution: "2k",
            ...(index === 0 ? { taskId: "recovering" } : {}),
        })),
    };
    await render(
        <EcommerceResultGallery
            config={{} as AiConfig}
            draft={draft}
            plan={plan}
            tasks={{}}
            selected={new Set()}
            imageModels={[]}
            generationPending
            onSelect={() => {}}
            onFocus={() => {}}
            onDownload={() => {}}
            onCanvas={() => {}}
            onRemove={async () => {}}
            onRegenerate={async () => {}}
            onRetry={() => {}}
        />,
    );
    expect(host.querySelectorAll(".is-generating")).toHaveLength(9);
    expect(host.querySelectorAll(".commerce-generating")).toHaveLength(9);
    expect(host.textContent).not.toContain("等待确认生成");
    expect(host.textContent).toContain("排队中");
    await render(
        <EcommerceAgentFeed
            direction={null}
            config={{} as AiConfig}
            draft={draft}
            plan={plan}
            tasks={{ recovering: { id: "recovering", type: "canvas_image", status: "failed", prompt: "", attempts: 1, createdAt: "", updatedAt: "", error: "服务暂不可用", canRecoverMedia: true } }}
            imageModels={[]}
            imageCost={1}
            onRegenerate={async () => {}}
            onRetry={() => {}}
            onFocus={() => {}}
        />,
    );
    expect(host.textContent).not.toContain("AI 生成中");
    expect(host.textContent).toContain("第 1 张未完成");
    expect(host.textContent).toContain("重新保存（不扣费）");
});
