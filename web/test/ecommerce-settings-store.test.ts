import { expect, test } from 'bun:test';
import { DEFAULT_ECOMMERCE_SETTING, type EcommerceSetting } from '../src/services/api/ecommerce';
import { apiClient } from '../src/services/api/request';
import { useEcommerceSettings } from '../src/stores/use-ecommerce-settings';
import { getActiveUserScope } from '../src/lib/user-scope';

test('a pending configuration read cannot overwrite a newly committed save', async () => {
    const original = apiClient.request;
    const state = useEcommerceSettings.getState();
    let resolve!: (value: unknown) => void;
    let calls = 0;
    apiClient.request = (async () => {
        calls++;
        return await new Promise((yes) => { resolve = yes; });
    }) as typeof apiClient.request;
    try {
        useEcommerceSettings.setState({ setting: structuredClone(DEFAULT_ECOMMERCE_SETTING), scope: getActiveUserScope(), loadedAt: 0 });
        const first = useEcommerceSettings.getState().load();
        const second = useEcommerceSettings.getState().load();
        expect(calls).toBe(1);
        const saved: EcommerceSetting = { ...structuredClone(DEFAULT_ECOMMERCE_SETTING), enabled: false, revision: 'new-save' };
        useEcommerceSettings.getState().commit(saved);
        resolve({ data: { code: 0, data: { setting: DEFAULT_ECOMMERCE_SETTING }, msg: 'ok' }, status: 200, headers: {} });
        expect(await first).toBe(saved);
        expect(await second).toBe(saved);
        expect(useEcommerceSettings.getState().setting).toBe(saved);
        expect(await useEcommerceSettings.getState().load()).toBe(saved);
        expect(calls).toBe(1);
    } finally {
        apiClient.request = original;
        useEcommerceSettings.setState(state, true);
    }
});
