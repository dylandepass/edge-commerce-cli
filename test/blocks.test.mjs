import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
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
        paypal: { clientId: 'none' },
      }),
    }),
  );
  const load = (relative) => import(pathToFileURL(path.join(target, relative)).href);
  load.widget = async (name) => {
    const widget = document.createElement('div');
    widget.className = name;
    widget.innerHTML = await readFile(path.join(target, `widgets/${name}/${name}.html`), 'utf8');
    return widget;
  };
  return load;
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
  const widget = await load.widget('checkout');
  const { default: decorate } = await load('widgets/checkout/checkout.js');
  decorate(widget);
  assert.equal(widget.querySelector('[name="firstName"]').value, 'Sam');
  assert.equal(widget.querySelector('[name="email"]').value, 'sam@example.com');
  assert.equal(widget.querySelector('select').disabled, true);
  assert.equal(
    [...widget.querySelectorAll('button')].find(
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
  const widget = await load.widget('order-complete');
  const { default: decorate } = await load('widgets/order-complete/order-complete.js');
  await decorate(widget);
  assert.equal(cart.count, 1);
  assert(!widget.textContent.includes('Thank you'));
  state = 'payment_completed';
  await decorate(widget);
  assert.equal(cart.count, 0);
  assert.match(widget.textContent, /Thank you/);
  cart.add({
    sku: 'another',
    path: '/another',
    name: 'Another',
    quantity: 1,
    price: { final: '5', currency: 'USD' },
  });
  await decorate(widget);
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
  const { default: decorate } = await load('widgets/order-cancel/order-cancel.js');
  const widget = await load.widget('order-cancel');
  decorate(widget);
  assert.match(widget.textContent, /You cancelled/);
  dom.window.history.replaceState({}, '', '/cancel?reason=INTERNAL_PROVIDER_ERROR');
  decorate(widget);
  assert(!widget.textContent.includes('INTERNAL_PROVIDER_ERROR'));
  assert.match(widget.textContent, /could not be completed/);
  dom.window.close();
});

test('widget links match the copied self-contained page shells', async () => {
  const html = await readFile(
    new URL('./fixtures/pages/commerce.plain.html', import.meta.url),
    'utf8',
  );
  const page = new JSDOM(html);
  globalThis.document = page.window.document;
  const links = [...page.window.document.querySelectorAll('a[href*="/widgets/"]')];
  assert.deepEqual(
    links.map((link) => new URL(link.href).pathname),
    [
      '/widgets/cart/cart.html',
      '/widgets/checkout/checkout.html',
      '/widgets/order-review/order-review.html',
      '/widgets/order-complete/order-complete.html',
      '/widgets/order-cancel/order-cancel.html',
    ],
  );
  const load = await installed();
  for (const link of links) {
    const name = link.href.split('/').at(-2);
    const widget = await load.widget(name);
    assert.equal(widget.querySelectorAll('h1').length, 1);
  }
  page.window.close();
});

test('review widget retains its heading and never shows a confirmation without order proof', async () => {
  const dom = browser('https://store.example.com/review?orderId=unknown');
  const load = await installed();
  const widget = await load.widget('order-review');
  const { default: decorate } = await load('widgets/order-review/order-review.js');
  await decorate(widget);
  assert.match(widget.querySelector('h1').textContent, /Order review/);
  assert.match(widget.textContent, /Order lookup failed/);
  assert.equal(widget.querySelectorAll('button').length, 0);
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
    imageUrl: 'https://media.example.com/red.webp',
    productUrl: 'https://store.example.com/p?variant=red',
    selectedOptions: [{ id: 'color', value: 'red' }],
  });
  cart.add({
    sku: 'p',
    path: '/p',
    name: 'Blue',
    quantity: 1,
    price: { final: '10', currency: 'USD' },
    productUrl: 'javascript:alert(1)',
    imageUrl: 'data:image/svg+xml,not-safe',
    selectedOptions: [{ id: 'color', value: 'blue' }],
  });
  const widget = await load.widget('cart');
  const { default: decorate } = await load('widgets/cart/cart.js');
  decorate(widget);
  assert.equal(widget.querySelectorAll('.cart-line').length, 2);
  assert.equal(widget.querySelectorAll('.cart-line-total').length, 2);
  assert.match(widget.querySelector('.cart-line-total').textContent, /\$10/);
  const links = [...widget.querySelectorAll('.cart-line-product a')];
  assert.equal(links[0].href, 'https://store.example.com/p?variant=red');
  assert.equal(links[1].href, 'https://store.example.com/p');
  assert.equal(widget.querySelectorAll('.cart-line-product img').length, 1);
  assert.equal(widget.querySelector('.cart-line-product img').alt, '');
  assert.equal(widget.querySelectorAll('.commerce-cart-summary').length, 1);
  assert.equal(widget.querySelectorAll('.commerce-cart-summary a').length, 1);
  assert(!widget.textContent.includes('PayPal is unavailable'));
  widget.querySelectorAll('.cart-line button')[1].click();
  assert.equal(cart.items.length, 1);
  assert.equal(cart.items[0].selectedOptions[0].value, 'red');
  assert.equal(widget.querySelectorAll('.cart-line').length, 1);
  assert.match(widget.querySelector('.commerce-cart-summary').textContent, /Subtotal: \$10/);
  widget.querySelector('.cart-line button').click();
  assert.equal(widget.querySelectorAll('.cart-line').length, 0);
  assert.equal(widget.querySelector('.commerce-cart-summary').hidden, true);
  assert.match(widget.textContent, /Your cart is empty/);
  cart.add({
    sku: 'p',
    path: '/p',
    name: 'Red',
    quantity: 1,
    price: { final: '10', currency: 'USD' },
    selectedOptions: [{ id: 'color', value: 'red' }],
  });
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
