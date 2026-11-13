import { expect, test } from "bun:test";
import React, { act, type ReactNode, type ReactElement } from "react";
import { reconciler } from "@react-three/fiber";
import { EcommerceTemplateCatalog } from "../src/components/canvas/ecommerce-template-catalog";
import { apiClient } from "../src/services/api/request";
import type { EcommerceSuiteTemplate } from "../src/services/api/ecommerce-canvas";

type Props = { children?: ReactNode; "aria-label"?: string; "aria-pressed"?: boolean; disabled?: boolean; onClick?: () => void; onChange?: (event: { target: { value: string } }) => void };
function find(tree: ReactNode, predicate: (props: Props) => boolean): Props | undefined {
    for (const element of React.Children.toArray(tree)) {
        if (!React.isValidElement<Props>(element)) continue;
        if (predicate(element.props)) return element.props;
        const result = find(element.props.children, predicate);
        if (result) return result;
    }
}

test("catalog searches, retries details without losing selection, clones applied templates and cancels stale reads", async () => {
    const original = apiClient.request;
    const actDescriptor = Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT");
    Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
    const template: EcommerceSuiteTemplate = { id: "suite", name: "Cup suite", flow: "detail", enabled: true, category: "Cups", source: "MIT", style: "Light studio", shots: [{ title: "Hero", duty: "Camera, lighting and full reference prompt" }] };
    let detailReads = 0,
        listReads = 0;
    let lastSignal: AbortSignal | undefined;
    let lastQuery: string | undefined = "";
    let lastCategory: string | undefined;
    let lastPage: number | undefined;
    let failList = false;
    let holdList = false;
    const heldRequests: Array<() => void> = [];
    apiClient.request = (async (config) => {
        let data;
        if (config.url === "/ecommerce/templates") {
            listReads++;
            lastSignal = config.signal as AbortSignal;
            lastQuery = config.params.q;
            lastCategory = config.params.category;
            lastPage = config.params.page;
            if (failList) throw new Error("catalog unavailable");
            data = {
                items: [{ id: template.id, name: template.name, category: "Cups / Mugs", description: "Double wall", count: 1 }],
                total: 21,
                categories: [
                    { name: "Cups", count: 21 },
                    { name: "Bowls", count: 3 },
                ],
                page: config.params.page,
                pageSize: 20,
            };
        } else if (config.url === "/ecommerce/templates/suite") {
            if (++detailReads === 1) throw new Error("detail unavailable");
            data = { template };
        } else throw new Error("Unexpected request");
        if (holdList && config.url === "/ecommerce/templates") await new Promise<void>((resolve) => heldRequests.push(resolve));
        return { data: { code: 0, data, msg: "ok" }, status: 200, headers: {} };
    }) as typeof apiClient.request;
    let tree: ReactNode, applied: EcommerceSuiteTemplate | undefined;
    function Probe() {
        tree = EcommerceTemplateCatalog({
            onApply: (value) => {
                applied = value;
            },
        });
        return null;
    }
    const fail = (error: unknown) => {
        throw error;
    };
    const root = reconciler.createContainer({} as never, 1, null, false, null, "", fail, fail, fail, null);
    const click = async (label: string) => {
        await act(async () => {
            const button = find(tree, (props) => props.children === label);
            expect(button).toBeDefined();
            button!.onClick!();
        });
    };
    const settle = async () => {
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 280));
        });
    };
    try {
        await act(async () => {
            reconciler.updateContainer(<Probe />, root, null, null);
        });
        await settle();
        expect(listReads).toBe(1);
        // 列表读完自动选中第一套去读详情；详情失败时保留选中，重试只重读详情。
        await settle();
        expect(detailReads).toBe(1);
        expect(find(tree, (props) => props["aria-pressed"] === true)).toBeDefined();
        await click("重新读取模板详情");
        expect(detailReads).toBe(2);
        expect(listReads).toBe(1);
        await click("使用此套图");
        expect(applied?.shots[0].duty).toBe(template.shots[0].duty);
        applied!.shots[0].duty = "Edited";
        expect(template.shots[0].duty).not.toBe("Edited");
        // 类目栏来自接口的 categories；点一个类目带上 category 并回到第一页。
        await act(async () => {
            find(tree, (props) => props["aria-label"] === "Cups，21 套")!.onClick!();
        });
        await settle();
        expect(listReads).toBe(2);
        expect(lastCategory).toBe("Cups");
        expect(lastPage).toBe(1);
        // 保持旧页请求在途，再检查搜索变化是否取消它；完成请求会移除取消监听。
        holdList = true;
        await click("下一页");
        await settle();
        const oldSignal = lastSignal!;
        holdList = false;
        await act(async () => {
            find(tree, (props) => props["aria-label"] === "搜索内置套图库")!.onChange!({ target: { value: "cup" } });
        });
        expect(oldSignal.aborted).toBe(true);
        heldRequests.forEach((release) => release());
        await settle();
        expect(lastQuery).toBe("cup");
        expect(lastCategory).toBe("Cups");
        // 同一套还在新列表里，不重读详情。
        expect(detailReads).toBe(2);
        failList = true;
        await click("下一页");
        await settle();
        expect(find(tree, (props) => props.children === "重新读取套图库")).toBeDefined();
        failList = false;
        await click("重新读取套图库");
        await settle();
        expect(find(tree, (props) => props.children === "重新读取套图库")).toBeUndefined();
        holdList = true;
        await act(async () => {
            find(tree, (props) => props["aria-label"] === "搜索内置套图库")!.onChange!({ target: { value: "pending" } });
        });
        await settle();
    } finally {
        await act(async () => {
            reconciler.updateContainer(null, root, null, null);
        });
        const aborted = lastSignal?.aborted;
        apiClient.request = original;
        if (actDescriptor) Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", actDescriptor);
        else Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
        heldRequests.forEach((release) => release());
        expect(aborted).toBe(true);
    }
}, 10000);
