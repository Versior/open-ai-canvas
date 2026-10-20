import { expect, test } from "bun:test";
import { DEFAULT_ECOMMERCE_SETTING, type EcommerceSetting } from "../src/services/api/ecommerce";
import { apiClient } from "../src/services/api/request";
import { useEcommerceSettings } from "../src/stores/use-ecommerce-settings";
import { getActiveUserScope } from "../src/lib/user-scope";

test("a pending configuration read cannot overwrite a newly committed save", async () => {
    const original = apiClient.request;
    const state = useEcommerceSettings.getState();
    let resolve!: (value: unknown) => void;
    let calls = 0;
    apiClient.request = (async () => {
        calls++;
        return await new Promise((yes) => {
            resolve = yes;
        });
    }) as typeof apiClient.request;
    try {
        useEcommerceSettings.setState({ setting: structuredClone(DEFAULT_ECOMMERCE_SETTING), scope: getActiveUserScope(), loadedAt: 0 });
        const first = useEcommerceSettings.getState().load();
        const second = useEcommerceSettings.getState().load();
        expect(calls).toBe(1);
        const saved: EcommerceSetting = { ...structuredClone(DEFAULT_ECOMMERCE_SETTING), enabled: false, revision: "new-save" };
        useEcommerceSettings.getState().commit(saved);
        resolve({ data: { code: 0, data: { setting: DEFAULT_ECOMMERCE_SETTING }, msg: "ok" }, status: 200, headers: {} });
        expect(await first).toEqual(saved);
        expect(await second).toEqual(saved);
        expect(useEcommerceSettings.getState().setting).toEqual(saved);
        expect(await useEcommerceSettings.getState().load()).toEqual(saved);
        expect(calls).toBe(1);
    } finally {
        apiClient.request = original;
        useEcommerceSettings.setState(state, true);
    }
});

test("administrator instructions and unpublished models never enter the canvas store", () => {
    const state = useEcommerceSettings.getState();
    try {
        const privateSetting = structuredClone(DEFAULT_ECOMMERCE_SETTING);
        privateSetting.flows.detail.directorPrompt = "private administrator instruction";
        privateSetting.models = [{ id: "draft", name: "Draft", enabled: false, tags: [], resourceIds: [] }];
        useEcommerceSettings.getState().commit(privateSetting);
        expect(useEcommerceSettings.getState().setting.flows.detail.directorPrompt).toBe("");
        expect(useEcommerceSettings.getState().setting.models).toEqual([]);
        expect(privateSetting.flows.detail.directorPrompt).toBe("private administrator instruction");
    } finally {
        useEcommerceSettings.setState(state, true);
    }
});
