import { expect, test } from 'bun:test';
import { ecommerceBindingKey, finishEcommerceBinding } from '../src/lib/ecommerce/ecommerce-binding';
import { buildEcommerceDeliveryEntry, createEcommerceDelivery, createEcommerceDeliveryTarget, ecommerceDeliveryCsv, ecommerceDeliverySummary } from '../src/lib/ecommerce/ecommerce-delivery';
import { ecommerceCanvasPreset, ecommerceSuiteTargets } from '../src/lib/ecommerce/ecommerce-canvas-preset';
import { ECOMMERCE_ONE_CLICK_FLOWS } from '../src/lib/ecommerce/ecommerce-oneclick';
import { DEFAULT_ECOMMERCE_SETTING, ecommerceSettingsEqual, parseEcommerceSetting } from '../src/services/api/ecommerce';
import { CanvasNodeType, type CanvasNodeData } from '../src/types/canvas';

test('an old binding completion cannot clear a newer run; failure remains retryable', () => {
    const product = ecommerceCanvasPreset().nodes[0];
    const oldPlan = { flow: 'detail', slotIds: ['a'], nodeIds: ['image-a'], runId: 'old' };
    const plan = { ...oldPlan, runId: 'new' };
    const nodes = [{ ...product, metadata: { ...product.metadata, ecommerceOneClick: plan } }];
    const oldKey = ecommerceBindingKey(product.id, oldPlan);
    const newKey = ecommerceBindingKey(product.id, plan);
    expect(finishEcommerceBinding(nodes, product.id, oldKey)[0]).toBe(nodes[0]);
    const failed = finishEcommerceBinding(nodes, product.id, newKey, 'encoding failed');
    expect(failed[0].metadata?.ecommerceOneClick).toMatchObject({ runId: 'new', status: 'failed', error: 'encoding failed' });
    expect(finishEcommerceBinding(failed, product.id, newKey)[0].metadata?.ecommerceOneClick).toBeUndefined();
    const next = [{ ...nodes[0], metadata: { ecommerceOneClick: { ...plan, runId: 'next' } } }];
    expect(finishEcommerceBinding(next, product.id, ecommerceBindingKey(product.id, next[0].metadata.ecommerceOneClick))[0].metadata?.ecommerceOneClick).toBeUndefined();
});

test('delivery uses original dimensions and bytes, independent of canvas resizing', () => {
    const delivery = createEcommerceDelivery();
    const target = createEcommerceDeliveryTarget('shopify', 'main');
    const image: CanvasNodeData = { id: 'image', type: CanvasNodeType.Image, position: { x: 0, y: 0 }, width: 120, height: 80, metadata: { naturalWidth: 2048, naturalHeight: 2048, bytes: 123456 } };
    const entry = buildEcommerceDeliveryEntry(image, delivery, target, 1);
    expect(entry).toMatchObject({ width: 2048, height: 2048, bytes: 123456, issues: [] });
    expect(buildEcommerceDeliveryEntry({ ...image, width: 900, height: 600 }, delivery, target, 1)).toEqual(entry);
    const oversized = buildEcommerceDeliveryEntry({ ...image, metadata: { ...image.metadata, bytes: 20 * 1024 * 1024 } }, delivery, createEcommerceDeliveryTarget('amazon', 'main'), 1);
    expect(oversized.issues.some(issue => issue.level === 'block' && issue.message.includes('文件'))).toBe(true);
});

test('missing image measurements and visual checks never turn into a green pass', () => {
    const image: CanvasNodeData = { id: 'image', type: CanvasNodeType.Image, position: { x: 0, y: 0 }, width: 2048, height: 2048 };
    const entry = buildEcommerceDeliveryEntry(image, createEcommerceDelivery(), createEcommerceDeliveryTarget('amazon', 'main'), 1);
    expect(entry.issues.every(issue => issue.level === 'warn')).toBe(true);
    expect(entry.issues.map(issue => issue.message)).toContain('未检测：原图尺寸与比例');
    expect(entry.issues.map(issue => issue.message)).toContain('未检测：纯白背景');
    expect(ecommerceDeliverySummary([entry]).clean).toBe(0);
    expect(ecommerceDeliveryCsv([entry])).toContain('未检测');
    expect(ecommerceDeliveryCsv([entry])).not.toContain('NaN');
});

test('another product with the same slot does not shift the current product outputs', () => {
    const product = ecommerceCanvasPreset().nodes[0];
    const flow = ECOMMERCE_ONE_CLICK_FLOWS[0];
    const suite = { flow: flow.id, rows: [{ slotId: 'detail-1', title: 'Hero', duty: 'Show', prompt: 'Draw' }], source: 'draft' as const, updatedAt: '' };
    const create = () => { let id = 0; return () => `new-${++id}`; };
    const baseline = ecommerceSuiteTargets(product, flow, suite, { nodes: [product], connections: [] }, {}, create());
    const unrelated: CanvasNodeData = { id: 'other-result', type: CanvasNodeType.Image, position: { x: 0, y: 0 }, metadata: { ecommerceProductId: 'other-product', ecommerceShotId: 'detail-1' } };
    const result = ecommerceSuiteTargets(product, flow, suite, { nodes: [product, unrelated], connections: [] }, {}, create());
    expect(result.spawned[0].position).toEqual(baseline.spawned[0].position);
    expect(result.spawned[0].metadata?.ecommerceProductId).toBe(product.id);
});

test('settings comparison ignores JSON key order and only optionally ignores revisions', () => {
    const value = structuredClone(DEFAULT_ECOMMERCE_SETTING);
    const reordered = { ...value, flows: { wear: value.flows.wear, seed: value.flows.seed, main: value.flows.main, detail: value.flows.detail }, revision: 'saved' };
    expect(ecommerceSettingsEqual(value, reordered, true)).toBe(true);
    expect(ecommerceSettingsEqual(value, reordered)).toBe(false);
    reordered.flows.detail = { ...value.flows.detail, enabled: false };
    expect(ecommerceSettingsEqual(value, reordered, true)).toBe(false);
});

test('settings parser rejects incomplete, duplicate and enabled empty models', () => {
    const model = { id: 'public', name: 'Test', enabled: true, tags: [], resourceIds: ['image'] };
    expect(parseEcommerceSetting(DEFAULT_ECOMMERCE_SETTING)).toEqual(DEFAULT_ECOMMERCE_SETTING);
    for (const models of [null, [model, model], [{ ...model, resourceIds: [] }], [{ ...model, tags: null }]]) {
        expect(() => parseEcommerceSetting({ ...DEFAULT_ECOMMERCE_SETTING, models })).toThrow();
    }
});
