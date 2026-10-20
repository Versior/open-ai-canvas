import { expect, test } from "bun:test";
import React, { act, type ReactNode, type ReactElement } from "react";
import { reconciler } from "@react-three/fiber";
import { EcommerceTemplateCatalog } from "../src/components/canvas/ecommerce-template-catalog";
import { apiClient } from "../src/services/api/request";
import type { EcommerceSuiteTemplate } from "../src/services/api/ecommerce";

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
    let lastQuery = "";
    let failList = false;
    apiClient.request = (async (config) => {
        let data;
        if (config.url === "/ecommerce/templates") {
            listReads++;
            lastSignal = config.signal as AbortSignal;
            lastQuery = config.params.q;
            if (failList) throw new Error("catalog unavailable");
            data = { items: [{ id: template.id, name: template.name, category: template.category, description: "", count: 1 }], total: 21, page: config.params.page, pageSize: 20 };
        } else if (config.url === "/ecommerce/templates/suite") {
            if (++detailReads === 1) throw new Error("detail unavailable");
            data = { template };
        } else throw new Error("Unexpected request");
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
        await act(async () => {
            find(tree, (props) => props["aria-pressed"] === false)!.onClick!();
        });
        await click("重新读取模板详情");
        expect(detailReads).toBe(2);
        expect(listReads).toBe(1);
        await click("使用此套图");
        expect(applied?.shots[0].duty).toBe(template.shots[0].duty);
        applied!.shots[0].duty = "Edited";
        expect(template.shots[0].duty).not.toBe("Edited");
        const oldSignal = lastSignal!;
        await act(async () => {
            find(tree, (props) => props["aria-label"] === "搜索内置套图库")!.onChange!({ target: { value: "cup" } });
        });
        expect(oldSignal.aborted).toBe(true);
        await settle();
        expect(lastQuery).toBe("cup");
        failList = true;
        await click("下一页");
        await settle();
        expect(find(tree, (props) => props.children === "重新读取套图库")).toBeDefined();
        failList = false;
        await click("重新读取套图库");
        await settle();
        expect(find(tree, (props) => props.children === "重新读取套图库")).toBeUndefined();
    } finally {
        await act(async () => {
            reconciler.updateContainer(null, root, null, null);
        });
        expect(lastSignal?.aborted).toBe(true);
        apiClient.request = original;
        if (actDescriptor) Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", actDescriptor);
        else Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
    }
}, 10000);
