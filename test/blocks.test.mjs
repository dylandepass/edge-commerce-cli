import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { validateSetup } from '../src/config.mjs';
import { planInstall, applyPlan } from '../src/install.mjs';

const templates = fileURLToPath(new URL('../template/', import.meta.url));
async function installed() {
  const target = await mkdtemp(path.join(tmpdir(), 'edge-block-'));
  await writeFile(path.join(target, 'package.json'), '{"type":"module"}');
  await applyPlan(
    await planInstall({
      templates,
      target,
      setup: validateSetup({
        version: 1,
        features: ['cart-checkout', 'pdp'],
        productSource: 'starter-pdp',
        site: {
          storeView: 'en',
          locale: 'en-US',
          currency: 'USD',
          country: 'US',
          cartBehavior: 'stay',
        },
        api: { origin: 'https://api.example.com', org: 'example', site: 'store' },
        routes: {
          cart: '/cart',
          checkout: '/checkout',
          review: '/review',
          complete: '/complete',
          cancel: '/cancel',
        },
        paypal: { clientId: 'public-id' },
      }),
    }),
  );
  return (relative) => import(pathToFileURL(path.join(target, relative)).href);
}
function browser(url = 'https://store.example.com/products/example') {
  const dom = new JSDOM('<main><div class="pdp"><div><div>PDP</div></div></div></main>', { url });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.location = dom.window.location;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.sessionStorage = dom.window.sessionStorage;
  globalThis.CustomEvent = dom.window.CustomEvent;
  return dom;
}
const response = (value, ok = true) => ({ ok, json: async () => value });

test('PDP only renders catalog-backed offer and requires a selected variant', async () => {
  const dom = browser();
  const load = await installed();
  const block = document.querySelector('.pdp');
  globalThis.fetch = async () =>
    response({
      sku: 'parent',
      name: 'Product',
      price: { final: '10', currency: 'USD' },
      variants: [
        {
          sku: 'red',
          name: 'Red',
          price: { final: '12', currency: 'USD' },
          availability: 'InStock',
        },
        {
          sku: 'blue',
          name: 'Blue',
          price: { final: '13', currency: 'USD' },
          availability: 'OutOfStock',
        },
        { sku: 'unknown', name: 'Unknown', price: { final: '13', currency: 'USD' } },
        {
          sku: 'bad-price',
          name: 'Bad price',
          price: { final: 'NaN', currency: 'USD' },
          availability: 'InStock',
        },
      ],
    });
  const { default: decorate } = await load('blocks/pdp/pdp.js');
  await decorate(block);
  const select = block.querySelector('select');
  const button = block.querySelector('button');
  assert.equal(button.disabled, true);
  select.value = '0';
  select.dispatchEvent(new dom.window.Event('change'));
  assert.equal(button.disabled, false);
  button.click();
  assert.match(block.textContent, /Added to cart/);
  assert.equal(localStorage.length, 1);
  select.value = '1';
  select.dispatchEvent(new dom.window.Event('change'));
  assert.equal(button.disabled, true);
  select.value = '2';
  select.dispatchEvent(new dom.window.Event('change'));
  assert.equal(button.disabled, true);
  select.value = '3';
  select.dispatchEvent(new dom.window.Event('change'));
  assert.equal(button.disabled, true);
  dom.window.close();
});

test('PDP refuses missing/unavailable product instead of making up price or inventory', async () => {
  const dom = browser();
  const load = await installed();
  globalThis.fetch = async () =>
    response({ sku: 'p', name: 'No price', availability: 'OutOfStock' });
  const { default: decorate } = await load('blocks/pdp/pdp.js');
  const block = document.querySelector('.pdp');
  await decorate(block);
  assert.equal(block.querySelector('button').disabled, true);
  assert(!block.textContent.includes('$'));
  dom.window.close();
});

test('checkout restores tab-scoped form without declaring payment success', async () => {
  const dom = browser('https://store.example.com/checkout');
  const load = await installed();
  const { getCart } = await load('scripts/commerce/cart.js');
  getCart().add({
    sku: 'p',
    path: '/p',
    name: 'P',
    quantity: 1,
    price: { final: '10', currency: 'USD' },
  });
  sessionStorage.setItem(
    'edge-commerce:checkout-form:v1:en',
    JSON.stringify({ firstName: 'Sam', email: 'sam@example.com' }),
  );
  const block = document.createElement('div');
  const { default: decorate } = await load('blocks/checkout/checkout.js');
  decorate(block);
  assert.equal(block.querySelector('[name="firstName"]').value, 'Sam');
  assert.equal(block.querySelector('[name="email"]').value, 'sam@example.com');
  assert.equal(block.querySelector('select').disabled, true);
  assert.equal(
    [...block.querySelectorAll('button')].find(
      (button) => button.textContent === 'Continue to PayPal',
    ).disabled,
    true,
  );
  dom.window.close();
});

test('complete page requires verified payment and only then clears cart', async () => {
  const dom = browser('https://store.example.com/complete?orderId=one');
  const load = await installed();
  const { getCart } = await load('scripts/commerce/cart.js');
  const cart = getCart();
  cart.add({
    sku: 'p',
    path: '/p',
    name: 'P',
    quantity: 1,
    price: { final: '10', currency: 'USD' },
  });
  sessionStorage.setItem(
    'edge-commerce:order',
    JSON.stringify({ orderId: 'one', email: 'sam@example.com', cartSnapshot: cart.snapshot() }),
  );
  let state = 'payment_pending';
  globalThis.fetch = async () => response({ order: { id: 'one', state } });
  const block = document.createElement('div');
  const { default: decorate } = await load('blocks/order-complete/order-complete.js');
  await decorate(block);
  assert.equal(cart.count, 1);
  assert(!block.textContent.includes('Thank you'));
  state = 'payment_completed';
  await decorate(block);
  assert.equal(cart.count, 0);
  assert.match(block.textContent, /Thank you/);
  cart.add({
    sku: 'another',
    path: '/another',
    name: 'Another',
    quantity: 1,
    price: { final: '5', currency: 'USD' },
  });
  await decorate(block);
  assert.equal(
    cart.count,
    1,
    'a cart changed after purchase must not be cleared by the success page',
  );
  dom.window.close();
});

test('cancel page distinguishes buyer cancellation without echoing internal reasons', async () => {
  const dom = browser('https://store.example.com/cancel?reason=customer_cancelled');
  const load = await installed();
  const { default: decorate } = await load('blocks/order-cancel/order-cancel.js');
  const block = document.createElement('div');
  decorate(block);
  assert.match(block.textContent, /You cancelled/);
  dom.window.history.replaceState({}, '', '/cancel?reason=INTERNAL_PROVIDER_ERROR');
  decorate(block);
  assert(!block.textContent.includes('INTERNAL_PROVIDER_ERROR'));
  assert.match(block.textContent, /could not be completed/);
  dom.window.close();
});

test('cart UI updates the intended variant line, and API URL is scoped to org/site', async () => {
  const dom = browser('https://store.example.com/cart');
  const load = await installed();
  const { getCart } = await load('scripts/commerce/cart.js');
  const cart = getCart();
  cart.add({
    sku: 'p',
    path: '/p',
    name: 'Red',
    quantity: 1,
    price: { final: '10', currency: 'USD' },
    selectedOptions: [{ id: 'color', value: 'red' }],
  });
  cart.add({
    sku: 'p',
    path: '/p',
    name: 'Blue',
    quantity: 1,
    price: { final: '10', currency: 'USD' },
    selectedOptions: [{ id: 'color', value: 'blue' }],
  });
  const block = document.createElement('div');
  const { default: decorate } = await load('blocks/cart/cart.js');
  decorate(block);
  assert.equal(block.querySelectorAll('.cart-line').length, 2);
  block.querySelectorAll('.cart-line button')[1].click();
  assert.equal(cart.items.length, 1);
  assert.equal(cart.items[0].selectedOptions[0].value, 'red');
  const { createApi } = await load('scripts/commerce/api.js');
  let called;
  const api = createApi({
    fetcher: async (url, options) => {
      called = { url, options };
      return response({ rates: [] });
    },
  });
  await api.estimateShipping({ country: 'us', state: 'CA' }, cart.getOrderItems(), {
    locale: 'en-US',
  });
  assert.equal(called.url, 'https://api.example.com/example/sites/store/estimate/shipping');
  assert.equal(JSON.parse(called.options.body).items[0].selectedOptions[0].value, 'red');
  const failing = createApi({
    fetcher: async () => ({
      ok: false,
      status: 422,
      json: async () => ({ code: 'INVALID_ORDER', message: 'Rejected' }),
    }),
  });
  await assert.rejects(
    failing.preview({}),
    (error) => error.status === 422 && error.code === 'INVALID_ORDER',
  );
  dom.window.close();
});
