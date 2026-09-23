import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { validateSetup } from '../src/config.mjs';
import { applyPlan, planInstall } from '../src/install.mjs';

const templates = fileURLToPath(new URL('../template/', import.meta.url));
function store() {
  const map = new Map();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, value),
    removeItem: (key) => map.delete(key),
  };
}
async function modules() {
  const target = await mkdtemp(path.join(tmpdir(), 'edge-flow-'));
  await writeFile(path.join(target, 'package.json'), '{"type":"module"}');
  const setup = validateSetup({
    version: 1,
    features: ['cart-checkout'],
    productSource: 'existing-pdp',
    site: { storeView: 'en', locale: 'en-US', currency: 'USD', country: 'US' },
    api: { origin: 'https://api.example.com', org: 'org', site: 'store' },
    routes: {
      cart: '/cart',
      checkout: '/checkout',
      review: '/review',
      complete: '/complete',
      cancel: '/cancel',
    },
    paypal: { clientId: 'public-test-id' },
  });
  await applyPlan(await planInstall({ templates, target, setup }));
  const load = (name) => import(pathToFileURL(path.join(target, 'scripts/commerce', name)).href);
  return { load };
}
const product = (options = []) => ({
  sku: 'SKU-1',
  path: '/products/sku-1',
  name: 'Sample',
  quantity: 1,
  price: { final: '25.00', currency: 'USD' },
  selectedOptions: options,
});

test('cart keeps selected variants separate, rebases mutations, and projects only API fields', async () => {
  const { load } = await modules();
  const { createCart, lineId } = await load('cart.js');
  const storage = store();
  const first = createCart({ storage });
  const second = createCart({ storage });
  const a = first.add(product([{ id: 'color', value: 'red' }]));
  const b = second.add(product([{ id: 'color', value: 'blue' }]));
  assert.notEqual(a, b);
  first.refresh();
  assert.equal(first.count, 2);
  first.setQuantity(a, 3);
  second.remove(b);
  first.refresh();
  assert.equal(first.count, 3);
  assert.equal(lineId(first.items[0]), a);
  assert.deepEqual(first.getOrderItems()[0].price, { final: '25.00', currency: 'USD' });
  assert.throws(() => first.add({ ...product(), quantity: 0 }), /Invalid cart item/);
  assert.throws(() => first.setQuantity(a, -1), /Invalid quantity/);
  assert.throws(
    () => first.add({ ...product(), price: { final: '', currency: 'USD' } }),
    /Invalid cart item/,
  );
  const corrupted = store();
  corrupted.setItem(
    'edge-commerce:cart:v1:en',
    JSON.stringify({ version: 1, items: [{ ...product(), quantity: -5 }] }),
  );
  assert.equal(createCart({ storage: corrupted }).count, 0);
  assert.doesNotThrow(() => first.add({ ...product(), price: { final: '0', currency: 'USD' } }));
});

test('standard flow previews exact order, reuses idempotency key on retry, and never treats approval as completion', async () => {
  const { load } = await modules();
  const { createCart } = await load('cart.js');
  const { createCheckoutFlow } = await load('checkout-flow.js');
  const cart = createCart({ storage: store() });
  cart.add(product());
  const calls = [];
  let fail = true;
  const api = {
    estimateShipping: async () => ({ rates: [{ id: 'standard', label: 'Standard' }] }),
    preview: async (payload) => {
      calls.push(['preview', payload]);
      return { estimateToken: 'token', total: '30.00' };
    },
    createOrder: async (payload) => {
      calls.push(['create', payload]);
      return { order: { id: 'order-1' } };
    },
    initiate: async (id, data) => {
      calls.push(['initiate', id, data]);
      if (fail) throw Error('network');
      return { action: 'redirect', redirectUrl: 'https://www.sandbox.paypal.com/checkout' };
    },
  };
  const flow = createCheckoutFlow({ api, cart, storage: store(), id: () => 'same-key' });
  const input = {
    customer: { firstName: 'Sam', lastName: 'Buyer', email: 'sam@example.com' },
    shipping: { country: 'us', state: 'CA', zip: '90001', city: 'LA', address1: 'Main' },
    shippingMethod: 'standard',
  };
  assert.equal((await flow.shippingMethods(input.shipping)).length, 1);
  await flow.preview(input);
  await assert.rejects(flow.place(input), /network/);
  fail = false;
  assert.equal((await flow.place(input)).orderId, 'order-1');
  assert.equal(calls.filter(([name]) => name === 'create').length, 1);
  assert.deepEqual(
    calls.filter(([name]) => name === 'initiate').map(([, , body]) => body.idempotencyKey),
    ['same-key', 'same-key'],
  );
  assert.equal(calls.find(([name]) => name === 'create')[1].estimateToken, 'token');
  cart.add(product());
  await assert.rejects(flow.place(input), /changed/);
});

test('express previews default and selected shipping, rejects cart drift, and enters review', async () => {
  const { load } = await modules();
  const { createCart } = await load('cart.js');
  const { createExpressFlow } = await load('checkout-flow.js');
  const cart = createCart({ storage: store() });
  cart.add(product());
  const previews = [];
  let walletOption = 'fast';
  const api = {
    createSession: async () => ({ paypalOrderId: 'pp-1' }),
    patchSession: async (id, payload) =>
      payload.type === 'address'
        ? {
            shippingMethods: [
              { id: 'slow', rate: '5' },
              { id: 'fast', rate: '10' },
            ],
          }
        : {},
    preview: async (payload) => {
      previews.push(payload);
      return { estimateToken: `token-${previews.length}` };
    },
    getSession: async () => ({
      payer: { email: 'payer@example.com', firstName: 'P', lastName: 'B' },
      selectedOptionId: walletOption,
      shippingAddress: { address1: 'Main', city: 'LA', zip: '90001', country: 'us' },
    }),
    createOrder: async (payload) => {
      assert.equal(payload.estimateToken, 'token-2');
      assert.equal(payload.shippingMethod.id, 'fast');
      return { order: { id: 'order-1' } };
    },
    initiate: async (id, body) => {
      assert.equal(body.provider, 'paypal-express');
      return { action: 'review' };
    },
  };
  const flow = createExpressFlow({ api, cart, storage: store(), id: () => 'retry-key' });
  await flow.start();
  await flow.setAddress({ countryCode: 'US', state: 'CA', postalCode: '90001' });
  assert.equal(previews[0].shippingMethod.id, 'slow');
  await flow.setShippingOption('fast');
  assert.equal(previews[1].shippingMethod.id, 'fast');
  assert.equal((await flow.approve('pp-1')).reviewUrl, '/review?orderId=order-1');
  walletOption = 'slow';
  await assert.rejects(flow.approve('pp-1'), /shipping option changed/);
  cart.add(product());
  await assert.rejects(flow.approve('pp-1'), /changed/);
});

test('Express resumes a tab-scoped PayPal return without creating another session', async () => {
  const { load } = await modules();
  const { createCart } = await load('cart.js');
  const { createExpressFlow } = await load('checkout-flow.js');
  const cart = createCart({ storage: store() });
  cart.add(product());
  const storage = store();
  let creations = 0;
  const api = {
    createSession: async () => {
      creations += 1;
      return { paypalOrderId: 'pp-1' };
    },
    patchSession: async () => ({ shippingMethods: [{ id: 'standard' }] }),
    preview: async () => ({ estimateToken: 'token' }),
    getSession: async () => ({
      payer: { email: 'p@example.com', firstName: 'P', lastName: 'B' },
      shippingAddress: { address1: 'Main', city: 'LA', state: 'CA', zip: '90001', country: 'us' },
      selectedOptionId: 'standard',
    }),
    createOrder: async () => ({ order: { id: 'one' } }),
    initiate: async () => ({ action: 'review' }),
  };
  const first = createExpressFlow({ api, cart, storage, id: () => 'key' });
  await first.start();
  await first.setAddress({ countryCode: 'US', state: 'CA', postalCode: '90001' });
  const resumed = createExpressFlow({ api, cart, storage, id: () => 'key' });
  assert.equal((await resumed.approve('pp-1')).reviewUrl, '/review?orderId=one');
  assert.equal(creations, 1);
  assert.equal(storage.getItem('edge-commerce:express-session'), null);
});

test('cart mutation during asynchronous preview cannot be paid with the old estimate', async () => {
  const { load } = await modules();
  const { createCart } = await load('cart.js');
  const { createCheckoutFlow } = await load('checkout-flow.js');
  const cart = createCart({ storage: store() });
  cart.add(product());
  const input = {
    customer: { firstName: 'A', lastName: 'B', email: 'a@example.com' },
    shipping: { country: 'us', state: 'CA', zip: '90001', city: 'LA', address1: 'Main' },
    shippingMethod: 'slow',
  };
  const flow = createCheckoutFlow({
    cart,
    storage: store(),
    api: {
      preview: async () => {
        cart.add(product());
        return { estimateToken: 'old-token' };
      },
      createOrder: async () => {
        throw Error('must not create');
      },
    },
  });
  await flow.preview(input);
  await assert.rejects(flow.place(input), /changed/);
});

test('failed Express shipping update invalidates a previously previewed method', async () => {
  const { load } = await modules();
  const { createCart } = await load('cart.js');
  const { createExpressFlow } = await load('checkout-flow.js');
  const cart = createCart({ storage: store() });
  cart.add(product());
  const api = {
    createSession: async () => ({ paypalOrderId: 'pp-1' }),
    patchSession: async (id, payload) => {
      if (payload.type === 'option') throw Error('shipping update rejected');
      return { shippingMethods: [{ id: 'default' }, { id: 'other' }] };
    },
    preview: async () => ({ estimateToken: 'token' }),
  };
  const flow = createExpressFlow({ api, cart, storage: store() });
  await flow.start();
  await flow.setAddress({ countryCode: 'US', state: 'CA', postalCode: '90001' });
  await assert.rejects(flow.setShippingOption('other'), /rejected/);
  await assert.rejects(flow.approve('pp-1'), /changed/);
});

test('review retries same confirm key; pending and lookup failure cannot show success or clear cart', async () => {
  const { load } = await modules();
  const { createReviewFlow } = await load('review-flow.js');
  let state = 'payment_requires_confirmation';
  const keys = [];
  let cleared = 0;
  const storage = store();
  storage.setItem(
    'edge-commerce:order',
    JSON.stringify({ orderId: 'one', email: 'p@example.com', cartSnapshot: 'expected' }),
  );
  const api = {
    order: async (email, id) => ({ order: { id, state } }),
    confirm: async (orderId, key) => {
      keys.push(key);
      return { status: 'completed' };
    },
    cancel: async () => ({ status: 'cancelled' }),
  };
  const flow = createReviewFlow({
    api,
    storage,
    cart: {
      snapshot: () => 'expected',
      clear: () => {
        cleared += 1;
      },
    },
    id: () => 'one-key',
  });
  assert.equal(await flow.confirm('one'), 'pending');
  assert.equal(cleared, 0);
  state = 'payment_completed';
  assert.equal((await flow.completion('one')).state, 'completed');
  assert.equal(cleared, 0);
  assert.equal(await flow.confirm('one'), 'completed');
  assert.equal(cleared, 1);
  await assert.rejects(flow.confirm('other'), /proof/);
  state = 'payment_requires_confirmation';
  assert.equal(await flow.confirm('one'), 'pending');
  assert.deepEqual(keys, ['one-key', 'one-key']);
  assert.equal(await flow.cancel('one'), 'cancelled');
  assert.equal(cleared, 1);
});
