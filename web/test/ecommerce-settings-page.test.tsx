import { expect, test } from 'bun:test';
import React, { act, type ReactNode, type ReactElement } from 'react';
import { reconciler } from '@react-three/fiber';
import { App } from 'antd';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { DEFAULT_ECOMMERCE_SETTING, type EcommerceSetting } from '../src/services/api/ecommerce';
import { apiClient } from '../src/services/api/request';
import { useEcommerceSettings } from '../src/stores/use-ecommerce-settings';
Object.defineProperty(globalThis, '__APP_VERSION__', { configurable: true, value: 'test' });
const { default: EcommerceSettingsPage } = await import('../src/pages/admin/settings/ecommerce-settings-page');

type Props = { children?: ReactNode; actions?: ReactNode; items?: { children?: ReactNode }[]; 'aria-label'?: string; onChange?: (value: boolean) => void; onClick?: () => unknown; disabled?: boolean };
function find(tree: ReactNode, predicate: (props: Props) => boolean): Props | undefined {
    if (!React.isValidElement<Props>(tree)) return;
    if (predicate(tree.props)) return tree.props;
    const children = [tree.props.children, tree.props.actions, ...tree.props.items?.map(item => item.children) ?? []];
    for (const child of children.flatMap(value => React.Children.toArray(value))) {
        const found = find(child, predicate);
        if (found) return found;
    }
}

test('admin page keeps failed drafts, serializes saves and confirms replacing a dirty draft', async () => {
    const originalRequest = apiClient.request;
    const originalApp = App.useApp;
    const originalAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    const originalState = useEcommerceSettings.getState();
    const storage = new Map<string, string>();
    Object.defineProperty(globalThis, 'window', { configurable: true, value: Object.assign(new EventTarget(), { localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) } }) });
    Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
    const errors: unknown[] = [];
    let confirmation: { onOk: () => unknown } | undefined;
    App.useApp = (() => ({ message: { success() {}, info() {}, error(error: unknown) { errors.push(error); } }, modal: { confirm(options: typeof confirmation) { confirmation = options; return { destroy() {} }; } } })) as unknown as typeof App.useApp;
    let writes = 0;
    let previousReads = 0;
    let failSave = true;
    let release!: () => void;
    const gate = () => new Promise<void>(resolve => { release = resolve; });
    let pending: Promise<void> | undefined;
    apiClient.request = (async (config) => {
        let setting: EcommerceSetting = structuredClone(DEFAULT_ECOMMERCE_SETTING);
        if (config.method === 'put') {
            writes++;
            await pending;
            if (failSave) throw new Error('save unavailable');
            setting = { ...config.data, revision: 'saved' };
        } else if (config.url?.endsWith('/previous')) {
            previousReads++;
            setting = { ...setting, revision: 'old', autoBindEnabled: false };
        }
        return { data: { code: 0, data: { setting }, msg: 'ok' }, status: 200, headers: {} };
    }) as typeof apiClient.request;
    let tree: ReactNode;
    function Probe() { tree = EcommerceSettingsPage(); return null; }
    const router = createMemoryRouter([{ path: '/', element: <Probe /> }]);
    const uncaught: unknown[] = [];
    const fail = (error: unknown) => { uncaught.push(error); };
    const root = reconciler.createContainer({} as never, 1, null, false, null, '', fail, fail, fail, null);
    const button = (label: string) => {
        const props = find(tree, props => props.children === label);
        if (!props) throw new Error('Missing button: ' + label);
        return props;
    };
    const toggle = (label: string) => {
        const props = find(tree, props => props['aria-label'] === label);
        if (!props) throw new Error('Missing switch: ' + label);
        return props;
    };
    try {
        await act(async () => { reconciler.updateContainer(<RouterProvider router={router} />, root, null, null); });
        expect(uncaught).toEqual([]);
        expect(button('保存修改').disabled).toBe(true);
        await act(async () => { toggle('电商画布').onChange!(false); });
        await act(async () => { button('保存修改').onClick!(); });
        expect(errors).toContain('save unavailable');
        expect(button('保存修改').disabled).toBe(false);
        failSave = false;
        pending = gate();
        const save = button('保存修改').onClick!;
        await act(async () => { save(); save(); });
        expect(writes).toBe(2);
        await act(async () => { release(); await pending; });
        expect(button('保存修改').disabled).toBe(true);
        expect(useEcommerceSettings.getState().setting).toMatchObject({ enabled: false, revision: 'saved' });
        await act(async () => { toggle('模特库').onChange!(false); });
        await act(async () => { button('载入上一版').onClick!(); });
        expect(previousReads).toBe(0);
        expect(confirmation).toBeDefined();
        await act(async () => { await confirmation!.onOk(); });
        expect(previousReads).toBe(1);
        expect(button('保存修改').disabled).toBe(false);
        expect(uncaught).toEqual([]);
    } finally {
        await act(async () => { reconciler.updateContainer(null, root, null, null); });
        router.dispose();
        apiClient.request = originalRequest;
        App.useApp = originalApp;
        useEcommerceSettings.setState(originalState, true);
        for (const [key, descriptor] of [['window', originalWindow], ['IS_REACT_ACT_ENVIRONMENT', originalAct]] as const) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else Reflect.deleteProperty(globalThis, key);
        }
    }
});
