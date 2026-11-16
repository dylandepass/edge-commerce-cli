import assert from 'node:assert/strict';
import { test } from 'node:test';
import { access, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { validateSetup } from '../src/config.mjs';
import { planInstall, applyPlan } from '../src/install.mjs';

const templates = fileURLToPath(new URL('../template/', import.meta.url));
const checkoutSetup = (paypalClientId) => ({
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
  paypal: { clientId: paypalClientId },
});
async function installed(paypalClientId = 'none', setup = checkoutSetup(paypalClientId)) {
  const target = await mkdtemp(path.join(tmpdir(), 'edge-block-'));
  await writeFile(path.join(target, 'package.json'), '{"type":"module"}');
  await applyPlan(await planInstall({ templates, target, setup: validateSetup(setup) }));
  const load = (relative) => import(pathToFileURL(path.join(target, relative)).href);
  load.target = target;
  load.widget = async (name) => {
    const widget = document.createElement('div');
    widget.className = name;
    widget.innerHTML = await readFile(path.join(target, `widgets/${name}/${name}.html`), 'utf8');
    return widget;
  };
  return load;
}
function browser(
  url = 'https://store.example.com/products/example',
  html = '<main><div class="pdp"><div><div>PDP</div></div></div></main>',
) {
  const dom = new JSDOM(html, { url });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.location = dom.window.location;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.sessionStorage = dom.window.sessionStorage;
  globalThis.CustomEvent = dom.window.CustomEvent;
  globalThis.DOMParser = dom.window.DOMParser;
  return dom;
}
const response = (value, ok = true) => ({ ok, json: async () => value });

// A Product Pipeline page: SKU meta, Product JSON-LD and the rendered summary.
function pipelineHtml(product) {
  return `<html><head><meta name="sku" content="${product.sku}">
    <script type="application/ld+json">${JSON.stringify(product)}</script></head>
    <body><main>
      <div><h1>${product.name}</h1><p>$12</p>
        <p><picture><img src="./media_1.jpg" alt="Product"></picture></p>
        <p><picture><img src="./media_2.jpg" alt="Detail"></picture></p></div>
      <div><p>Description</p></div>
      <div class="section" data-sku="red"><h2>Red</h2></div>
    </main></body></html>`;
}
function offer(sku, price, availability) {
  return {
    '@type': 'Offer',
    sku,
    name: sku,
    price,
    priceCurrency: 'USD',
    ...(availability ? { availability: `https://schema.org/${availability}` } : {}),
  };
}
const noFetch = async () => {
  throw new Error('The PDP must not fetch product data');
};
async function pipelinePdp(load, product) {
  const { buildPDPBlock } = await load('scripts/commerce/pdp-page.js');
  buildPDPBlock(document.querySelector('main'));
  const block = document.querySelector('.pdp');
  const { default: decorate } = await load('blocks/pdp/pdp.js');
  await decorate(block);
  return block;
}

test('PDP reads the page JSON-LD and requires a selected in-stock variant', async () => {
  const product = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    sku: 'parent',
    name: 'Product',
    offers: [
      offer('red', '12', 'InStock'),
      offer('blue', '13', 'OutOfStock'),
      offer('unknown', '13'),
      offer('bad-price', 'NaN', 'InStock'),
    ],
  };
  const dom = browser(undefined, pipelineHtml(product));
  const load = await installed();
  globalThis.fetch = noFetch;
  const block = await pipelinePdp(load, product);

  assert.equal(block.querySelectorAll('h1').length, 1);
  assert.equal(block.querySelector('.pdp-media picture img').loading, 'eager');
  assert.equal(block.querySelectorAll('.pdp-media picture').length, 2);
  assert(!block.textContent.includes('$12'), 'the pipeline price is replaced');
  assert.equal(document.querySelector('[data-sku]'), null, 'variant sections are removed');
  assert.match(document.querySelector('main').textContent, /Description/);

  const select = block.querySelector('select');
  const button = block.querySelector('button');
  assert.equal(button.disabled, true);
  select.value = '0';
  select.dispatchEvent(new dom.window.Event('change'));
  assert.equal(button.disabled, false);
  assert.match(block.querySelector('.pdp-price').textContent, /\$12\.00/);
  button.click();
  assert.match(block.textContent, /Added to cart/);
  assert.equal(localStorage.length, 1);
  for (const value of ['1', '2', '3']) {
    select.value = value;
    select.dispatchEvent(new dom.window.Event('change'));
    assert.equal(button.disabled, true);
  }
  dom.window.close();
});

test('PDP refuses missing/unavailable product instead of making up price or inventory', async () => {
  const product = {
    '@type': 'Product',
    sku: 'p',
    name: 'No price',
    offers: { '@type': 'Offer', availability: 'https://schema.org/OutOfStock' },
  };
  const dom = browser(undefined, pipelineHtml(product));
  const load = await installed();
  globalThis.fetch = noFetch;
  const block = await pipelinePdp(load, product);
  assert.equal(block.querySelector('button').disabled, true);
  assert(!block.textContent.includes('$'));
  dom.window.close();
});

test('catalog PDP shows no price or cart and installs no cart core', async () => {
  const product = {
    '@type': 'Product',
    sku: 'engine',
    name: 'Engine',
    offers: [offer('engine', '99', 'InStock')],
  };
  const dom = browser(undefined, pipelineHtml(product));
  const load = await installed(undefined, {
    version: 1,
    features: ['pdp'],
    productSource: 'starter-pdp',
    site: { locale: 'en-GB' },
    pdp: { mode: 'catalog' },
  });
  globalThis.fetch = noFetch;
  await assert.rejects(access(path.join(load.target, 'scripts/commerce/cart.js')));
  const block = await pipelinePdp(load, product);
  assert.equal(block.querySelector('h1').textContent, 'Engine');
  assert.equal(block.querySelectorAll('picture').length, 2);
  assert.equal(block.querySelector('select, button, input, .pdp-price'), null);
  assert(!block.textContent.includes('$'));
  dom.window.close();
});

test('the PDP auto-block only wraps the document main of a pipeline page', async () => {
  const product = { '@type': 'Product', sku: 'p', name: 'Product', offers: [] };
  const load = await installed();
  const { buildPDPBlock, findProduct } = await load('scripts/commerce/pdp-page.js');

  let dom = browser(undefined, pipelineHtml(product).replace(/<meta name="sku"[^>]*>/, ''));
  buildPDPBlock(document.querySelector('main'));
  assert.equal(document.querySelector('.pdp'), null, 'no SKU meta, no block');
  dom.window.close();

  dom = browser(undefined, pipelineHtml(product));
  const fragment = document.createElement('main');
  fragment.innerHTML = '<div><h1>Fragment</h1></div>';
  buildPDPBlock(fragment);
  assert.equal(fragment.querySelector('.pdp'), null, 'fragments are not product pages');
  buildPDPBlock(document.querySelector('main'));
  buildPDPBlock(document.querySelector('main'));
  assert.equal(document.querySelectorAll('.pdp').length, 1);
  dom.window.close();

  assert.equal(findProduct({ '@graph': [{ '@type': 'BreadcrumbList' }, product] }), product);
  assert.equal(findProduct([{ '@type': ['Thing', 'Product'], sku: 'x' }]).sku, 'x');
  assert.equal(findProduct({ '@type': 'Organization' }), null);
});

test('branch previews load the pipeline page through the configured CORS proxy', async () => {
  const product = { '@type': 'Product', sku: 'p', name: 'Product', offers: [] };
  const previewSetup = {
    version: 1,
    features: ['pdp'],
    productSource: 'starter-pdp',
    site: {},
    pdp: { mode: 'catalog', previewProxyKey: 'public-key-123', previewProductPath: '/products/' },
  };
  const load = await installed(undefined, previewSetup);
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(url);
    return { ok: true, text: async () => pipelineHtml(product) };
  };

  const dom = browser(
    'https://feature--site--org.aem.page/en/products/example',
    '<html><head></head><body><main><div><p>authored</p></div></main></body></html>',
  );
  const { loadPDPPreview } = await load('scripts/commerce/pdp-page.js');
  assert.equal(await loadPDPPreview(), true);
  const proxied = new URL(requests[0]);
  assert.equal(proxied.origin, 'https://fcors.org');
  assert.equal(
    proxied.searchParams.get('url'),
    'https://main--site--org.aem.network/en/products/example',
  );
  assert.equal(proxied.searchParams.get('key'), 'public-key-123');
  assert(document.querySelector('meta[name="sku"]'));
  assert.equal(
    document.querySelector('main img').getAttribute('src'),
    'https://main--site--org.aem.network/en/products/media_1.jpg',
  );
  assert.match(document.querySelector('main').lastElementChild.textContent, /authored/);
  dom.window.close();

  for (const url of [
    'https://www.example.com/en/products/example',
    'https://feature--site--org.aem.page/en/about',
  ]) {
    const other = browser(url, '<main><div><p>page</p></div></main>');
    assert.equal(await loadPDPPreview(), false);
    other.window.close();
  }
  assert.equal(requests.length, 1);

  const withoutKey = await installed();
  const plain = browser('https://feature--site--org.aem.page/en/products/example');
  const { loadPDPPreview: disabled } = await withoutKey('scripts/commerce/pdp-page.js');
  assert.equal(await disabled(), false);
  assert.equal(requests.length, 1);
  plain.window.close();
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
  assert.deepEqual(
    [...widget.querySelectorAll('.checkout-section h2')].map((heading) => heading.textContent),
    ['Contact information', 'Shipping address', 'Shipping method', 'Payment'],
  );
  assert.equal(widget.querySelectorAll('.checkout-summary-item').length, 1);
  assert.match(widget.querySelector('.checkout-summary-total').textContent, /Review totals first/);
  assert.equal(
    [...widget.querySelectorAll('button')].find(
      (button) => button.textContent === 'Continue to PayPal',
    ).disabled,
    true,
  );
  dom.window.close();
});

test('cart hides express checkout while the public PayPal ID is a setup placeholder', async () => {
  const dom = browser('https://store.example.com/cart');
  const load = await installed('your-public-sandbox-client-id');
  const { getCart } = await load('scripts/commerce/cart.js');
  getCart().add({
    sku: 'p',
    path: '/p',
    name: 'Product',
    quantity: 1,
    price: { final: '10', currency: 'USD' },
  });
  const widget = await load.widget('cart');
  const { default: decorate } = await load('widgets/cart/cart.js');
  decorate(widget);
  assert.equal(widget.querySelector('.commerce-cart-express'), null);
  assert.equal(widget.querySelectorAll('.commerce-cart-summary a').length, 1);
  dom.window.close();
});

test('checkout summary tracks cart changes without inventing a payment total', async () => {
  const dom = browser('https://store.example.com/checkout');
  const load = await installed();
  const { getCart } = await load('scripts/commerce/cart.js');
  const cart = getCart();
  cart.add({
    sku: 'p',
    path: '/p',
    name: 'Product',
    quantity: 1,
    price: { final: '10', currency: 'USD' },
  });
  const widget = await load.widget('checkout');
  const { default: decorate } = await load('widgets/checkout/checkout.js');
  decorate(widget);
  assert.match(widget.querySelector('.checkout-summary-totals').textContent, /\$10/);
  assert.match(widget.querySelector('.checkout-summary-total').textContent, /Review totals first/);

  cart.add({
    sku: 'q',
    path: '/q',
    name: 'Second',
    quantity: 1,
    price: { final: '20', currency: 'USD' },
  });
  assert.equal(widget.querySelectorAll('.checkout-summary-item').length, 2);
  assert.match(widget.querySelector('.checkout-summary-totals').textContent, /\$30/);
  assert.equal(widget.querySelector('.checkout-primary-action').disabled, true);
  cart.clear();
  assert.equal(widget.querySelector('.commerce-checkout-summary').hidden, true);
  assert.match(widget.querySelector('.checkout-message').textContent, /cart is empty/);
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
  assert.equal(widget.querySelectorAll('.cart-line-stepper').length, 2);
  assert.equal(widget.querySelector('.cart-line-option').textContent, 'color: red');
  widget.querySelector('[aria-label="Increase quantity for Red"]').click();
  assert.equal(cart.items[0].quantity, 2);
  assert.match(widget.querySelector('.commerce-cart-summary').textContent, /Subtotal: \$30/);
  widget.querySelector('[aria-label="Decrease quantity for Red"]').click();
  assert.equal(cart.items[0].quantity, 1);
  const quantity = widget.querySelector('.cart-line-stepper input');
  quantity.value = '0';
  quantity.dispatchEvent(new dom.window.Event('change'));
  assert.equal(cart.items.length, 2);
  assert.equal(quantity.value, '1');
  widget.querySelectorAll('.cart-line-remove')[1].click();
  assert.equal(cart.items.length, 1);
  assert.equal(cart.items[0].selectedOptions[0].value, 'red');
  assert.equal(widget.querySelectorAll('.cart-line').length, 1);
  assert.match(widget.querySelector('.commerce-cart-summary').textContent, /Subtotal: \$10/);
  widget.querySelector('.cart-line-remove').click();
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
