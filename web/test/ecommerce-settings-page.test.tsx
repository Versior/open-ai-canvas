import { expect, test } from "bun:test";
import React, { act, type ReactNode } from "react";
import { reconciler } from "@react-three/fiber";
import { App } from "antd";
import { createMemoryRouter, RouterProvider } from "react-router";
import { DEFAULT_ECOMMERCE_SETTING, type EcommerceSetting } from "../src/services/api/ecommerce-canvas";
import { apiClient } from "../src/services/api/request";
Object.defineProperty(globalThis, "__APP_VERSION__", { configurable: true, value: "test" });
const { default: EcommerceSettingsPage } = await import("../src/pages/admin/settings/ecommerce-settings-page");

type Props = { children?: ReactNode; actions?: ReactNode; items?: { children?: ReactNode }[]; "aria-label"?: string; value?: string; placeholder?: string; onChange?: (value: any) => void; onClick?: () => unknown; disabled?: boolean; checked?: boolean };
function find(tree: ReactNode, predicate: (props: Props) => boolean): Props | undefined {
    if (Array.isArray(tree)) {
        for (const child of tree) {
            const result = find(child, predicate);
            if (result) return result;
        }
        return;
    }
    if (!React.isValidElement<Props>(tree)) return;
    if (predicate(tree.props)) return tree.props;
    const children = [tree.props.children, tree.props.actions, ...(tree.props.items?.map((item) => item.children) ?? [])];
    for (const child of children.flatMap((value) => React.Children.toArray(value))) {
        const found = find(child, predicate);
        if (found) return found;
    }
}

test("studio settings page edits only the dossier capability, keeps failed drafts and serializes saves", async () => {
    const originalRequest = apiClient.request;
    const originalApp = App.useApp;
    const originalAct = Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT");
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    const storage = new Map<string, string>();
    Object.defineProperty(globalThis, "window", { configurable: true, value: Object.assign(new EventTarget(), { localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) } }) });
    Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
    const errors: unknown[] = [];
    let confirmation: { onOk: () => unknown } | undefined;
    App.useApp = (() => ({
        message: {
            success() {},
            info() {},
            error(error: unknown) {
                errors.push(error);
            },
        },
        modal: {
            confirm(options: typeof confirmation) {
                confirmation = options;
                return { destroy() {} };
            },
        },
    })) as unknown as typeof App.useApp;
    const writes: EcommerceSetting[] = [];
    let previousReads = 0;
    let failSave = true;
    let release!: () => void;
    const gate = () =>
        new Promise<void>((resolve) => {
            release = resolve;
        });
    let pending: Promise<void> | undefined;
    let defaultsReads = 0;
    apiClient.request = (async (config) => {
        if (config.url?.endsWith("/defaults")) {
            defaultsReads++;
            return { data: { code: 0, data: { defaults: defaultsReads === 1 ? {} : { "cap:dossier": "Complete dossier instruction" } }, msg: "ok" }, status: 200, headers: {} };
        }
        let setting: EcommerceSetting = structuredClone(DEFAULT_ECOMMERCE_SETTING);
        if (config.method === "put") {
            writes.push(structuredClone(config.data));
            await pending;
            if (failSave) throw new Error("save unavailable");
            setting = { ...config.data, revision: "saved" };
        } else if (config.url?.endsWith("/previous")) {
            previousReads++;
            setting = { ...setting, revision: "old", autoBindEnabled: false };
        }
        return { data: { code: 0, data: { setting }, msg: "ok" }, status: 200, headers: {} };
    }) as typeof apiClient.request;
    let tree: ReactNode;
    function Probe() {
        tree = EcommerceSettingsPage();
        return null;
    }
    const router = createMemoryRouter([{ path: "/", element: <Probe /> }]);
    const uncaught: unknown[] = [];
    const fail = (error: unknown) => {
        uncaught.push(error);
    };
    const root = reconciler.createContainer({} as never, 1, null, false, null, "", fail, fail, fail, null);
    const button = (label: string) => {
        const props = find(tree, (props) => props.children === label);
        if (!props) throw new Error("Missing button: " + label);
        return props;
    };
    const labelled = (label: string) => {
        const props = find(tree, (props) => props["aria-label"] === label);
        if (!props) throw new Error("Missing control: " + label);
        return props;
    };
    try {
        await act(async () => {
            reconciler.updateContainer(<RouterProvider router={router} />, root, null, null);
        });
        expect(uncaught).toEqual([]);
        expect(button("保存修改").disabled).toBe(true);
        // 旧画布的能力、功能开关与公共模特不再出现在页面上。
        expect(find(tree, (props) => props["aria-label"] === "智能规划私有分析指令")).toBeUndefined();
        expect(find(tree, (props) => props["aria-label"] === "电商画布")).toBeUndefined();
        expect(find(tree, (props) => props["aria-label"] === "模特库")).toBeUndefined();
        expect(labelled("商品档案私有分析指令").placeholder).not.toBe("正在读取内置指令…");
        await act(async () => {
            await button("重试读取默认指令").onClick!();
        });
        expect(labelled("商品档案私有分析指令").value).toBe("Complete dossier instruction");
        await act(async () => {
            labelled("商品档案私有分析指令").onChange!({ target: { value: "Custom dossier" } });
        });
        expect(labelled("商品档案私有分析指令").value).toBe("Custom dossier");
        expect(button("保存修改").disabled).toBe(false);
        await act(async () => {
            button("恢复内置默认").onClick!();
        });
        expect(labelled("商品档案私有分析指令").value).toBe("Complete dossier instruction");
        expect(button("保存修改").disabled).toBe(true);
        await act(async () => {
            labelled("商品档案开放使用").onChange!(false);
        });
        await act(async () => {
            button("保存修改").onClick!();
        });
        expect(errors).toContain("save unavailable");
        expect(button("保存修改").disabled).toBe(false);
        expect(labelled("商品档案开放使用").checked).toBe(false);
        failSave = false;
        pending = gate();
        const save = button("保存修改").onClick!;
        await act(async () => {
            save();
            save();
        });
        expect(writes).toHaveLength(2);
        await act(async () => {
            release();
            await pending;
        });
        expect(button("保存修改").disabled).toBe(true);
        // 保存仍提交整份设置：页面不编辑的字段按读取到的原样带回。
        const submitted = writes.at(-1)!;
        expect(submitted.capabilities?.dossier).toEqual({ enabled: false, directorPrompt: "" });
        expect(submitted.capabilities?.planning).toEqual({ enabled: true, directorPrompt: "" });
        expect({ ...submitted, capabilities: undefined }).toEqual({ ...DEFAULT_ECOMMERCE_SETTING, capabilities: undefined });
        await act(async () => {
            labelled("商品档案开放使用").onChange!(true);
        });
        await act(async () => {
            button("载入上一版").onClick!();
        });
        expect(previousReads).toBe(0);
        expect(confirmation).toBeDefined();
        await act(async () => {
            await confirmation!.onOk();
        });
        expect(previousReads).toBe(1);
        expect(button("保存修改").disabled).toBe(false);
        expect(uncaught).toEqual([]);
    } finally {
        await act(async () => {
            reconciler.updateContainer(null, root, null, null);
        });
        router.dispose();
        apiClient.request = originalRequest;
        App.useApp = originalApp;
        for (const [key, descriptor] of [
            ["window", originalWindow],
            ["IS_REACT_ACT_ENVIRONMENT", originalAct],
        ] as const) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else Reflect.deleteProperty(globalThis, key);
        }
    }
});
