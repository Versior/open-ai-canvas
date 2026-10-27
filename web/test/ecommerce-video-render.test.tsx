import { expect, test } from "bun:test";
import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { CanvasNodeActionContext } from "../src/components/canvas/canvas-node-action-context";
import { CanvasNodeGraphContext } from "../src/components/canvas/canvas-node-graph-context";
import { EcommerceVideoNodeContent } from "../src/components/canvas/nodes/ecommerce-video-node";
import { canvasThemes } from "../src/lib/canvas-theme";
import { ECOMMERCE_VIDEO_CREATIVE_PLAN_RESULT_TITLE, createEcommerceVideo, createEcommerceVideoShot } from "../src/lib/ecommerce/ecommerce-video";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";

const image: CanvasNodeData = {
    id: "image-1",
    type: CanvasNodeType.Image,
    title: "商品图",
    position: { x: 0, y: 0 },
    metadata: { content: "/product.png" },
};
const referenceVideo: CanvasNodeData = {
    id: "reference-video",
    type: CanvasNodeType.Video,
    title: "参考视频",
    position: { x: 0, y: 0 },
    metadata: { content: "/reference.mp4" },
};
const videoNode: CanvasNodeData = {
    id: "video-1",
    type: CanvasNodeType.EcommerceVideo,
    title: "商品视频",
    position: { x: 0, y: 0 },
    metadata: { ecommerceVideo: { ...createEcommerceVideo("商品视频"), shots: [createEcommerceVideoShot(image.id)] } },
};

test("video timeline keeps native button semantics inside a labelled group", () => {
    const html = renderToStaticMarkup(
        <CanvasNodeActionContext.Provider value={{ updateMetadata() {} }}>
            <CanvasNodeGraphContext.Provider value={{ getUpstreamNodes: () => [image] }}>
                <EcommerceVideoNodeContent node={videoNode} theme={canvasThemes.dark} />
            </CanvasNodeGraphContext.Provider>
        </CanvasNodeActionContext.Provider>,
    );

    expect(html).toContain('class="ecom-video-timeline" role="group" aria-label="镜头时间轴"');
    expect(html).not.toContain('role="listitem"');
    expect(html).toMatch(/<button[^>]*class="ecom-video-cell"/);
});

test("disabled Creative Plan action exposes a visible linked reason", async () => {
    const { Window } = await import("happy-dom");
    const dom = new Window({ url: "http://localhost/" });
    const originals = new Map<string, PropertyDescriptor | undefined>();
    for (const [key, value] of Object.entries({
        window: dom,
        document: dom.document,
        navigator: dom.navigator,
        HTMLElement: dom.HTMLElement,
        Element: dom.Element,
        Node: dom.Node,
        SVGElement: dom.SVGElement,
        getComputedStyle: dom.getComputedStyle.bind(dom),
        IS_REACT_ACT_ENVIRONMENT: true,
    })) {
        originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
        Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    }
    const { createRoot } = await import("react-dom/client");
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    try {
        await act(async () =>
            root.render(
                <CanvasNodeActionContext.Provider value={{ updateMetadata() {} }}>
                    <CanvasNodeGraphContext.Provider value={{ getUpstreamNodes: () => [image, referenceVideo] }}>
                        <EcommerceVideoNodeContent node={videoNode} theme={canvasThemes.dark} />
                    </CanvasNodeGraphContext.Provider>
                </CanvasNodeActionContext.Provider>,
            ),
        );
        const edit = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("编排"));
        expect(edit).not.toBeUndefined();
        await act(async () => edit!.click());

        const apply = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("确认应用为镜头表"));
        expect(apply?.disabled).toBe(true);
        const reasonId = apply?.getAttribute("aria-describedby");
        expect(reasonId).toBeTruthy();
        const reason = host.querySelector<HTMLElement>(`#${reasonId}`);
        expect(reason?.textContent).toBe("先完成拆解或把 Creative Plan 修正为有效 JSON");
        expect(reason?.getAttribute("hidden")).toBeNull();
                expect(host.querySelector<HTMLInputElement>('[aria-label="时长（秒）"]')?.classList.contains("ecom-video-duration-input")).toBe(true);

        const creativePlan = JSON.stringify({
            hook: "前 2 秒点明痛点",
            rhythm: "快节奏",
            shots: [{ startSeconds: 0, endSeconds: 2, purpose: "痛点 Hook", motion: "push", caption: "省时", transition: "cut" }],
            cta: "立即购买",
        });
        const staleResult: CanvasNodeData = {
            id: "creative-plan-result",
            type: CanvasNodeType.Text,
            title: ECOMMERCE_VIDEO_CREATIVE_PLAN_RESULT_TITLE,
            position: { x: 0, y: 0 },
            metadata: {
                status: "success",
                content: creativePlan,
                ecommerceVideoCreativePlanSource: { targetNodeId: videoNode.id, referenceVideoId: referenceVideo.id, signature: "old-signature" },
            },
        };
        const staleVideoNode: CanvasNodeData = {
            ...videoNode,
            metadata: {
                ecommerceVideo: {
                    ...videoNode.metadata!.ecommerceVideo!,
                    replica: { name: "旧方案", mode: "structure-only", aspects: ["rhythm"], notes: creativePlan, planSourceSignature: "old-signature", extraExclude: "" },
                },
            },
        };
        await act(async () =>
            root.render(
                <CanvasNodeActionContext.Provider value={{ updateMetadata() {} }}>
                    <CanvasNodeGraphContext.Provider value={{ getUpstreamNodes: () => [image, referenceVideo, staleResult] }}>
                        <EcommerceVideoNodeContent node={staleVideoNode} theme={canvasThemes.dark} />
                    </CanvasNodeGraphContext.Provider>
                </CanvasNodeActionContext.Provider>,
            ),
        );
        const staleApply = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("确认应用为镜头表"));
        expect(host.textContent).toContain("方案已过期");
        expect(staleApply?.disabled).toBe(true);
        expect(host.querySelector<HTMLElement>(`#${staleApply?.getAttribute("aria-describedby")}`)?.textContent).toContain("商品、参考视频、平台或语言已变化");
    } finally {
        await act(async () => root.unmount());
        host.remove();
        dom.happyDOM.abort();
        for (const [key, value] of originals) {
            if (value) Object.defineProperty(globalThis, key, value);
            else Reflect.deleteProperty(globalThis, key);
        }
    }
});

test("video controls keep readable duration text, focus rings, reduced motion, and 44px coarse targets", async () => {
    const css = await Bun.file(new URL("../src/components/canvas/nodes/canvas-ecommerce-node-card.css", import.meta.url)).text();
    expect(css).toMatch(/\.ecom-video-duration-input\s*\{[\s\S]*?font-size: 12px;/);
    expect(css).toMatch(/\.ecom-video-card[^}]*:focus-visible[\s\S]*?outline: 2px solid currentColor;/);
    const coarse = css.slice(css.indexOf("@media (pointer: coarse)"));
    expect(coarse).toMatch(/\.ecom-video-card \.ecom-action,[\s\S]*?\.ecom-video-card \.ecom-video-duration-input\s*\{[\s\S]*?min-width: 44px;[\s\S]*?min-height: 44px;/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\.ecom-video-card[\s\S]*?transition: none;/);
});
