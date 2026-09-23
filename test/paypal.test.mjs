import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { validateSetup } from '../src/config.mjs';
import { planInstall, applyPlan } from '../src/install.mjs';

const templates = fileURLToPath(new URL('../template/', import.meta.url));
test('PayPal SDK v6 adapter uses public ID, default/changed shipping callbacks, review only', async () => {
  const target = await mkdtemp(path.join(tmpdir(), 'edge-paypal-'));
  await writeFile(path.join(target, 'package.json'), '{"type":"module"}');
  const setup = validateSetup({
    version: 1,
    features: ['cart-checkout'],
    productSource: 'existing-pdp',
    site: { storeView: 'en', locale: 'en-US', currency: 'USD', country: 'US' },
    api: { origin: 'https://api.example.com', org: 'org', site: 'shop' },
    routes: {
      cart: '/cart',
      checkout: '/checkout',
      review: '/review',
      complete: '/complete',
      cancel: '/cancel',
    },
    paypal: { clientId: 'public-client' },
  });
  await applyPlan(await planInstall({ templates, target, setup }));
  const { createExpressButton } = await import(
    pathToFileURL(path.join(target, 'scripts/commerce/payments/paypal.js')).href
  );
  const calls = [];
  let callbacks;
  const sdk = {
    createInstance: async (options) => {
      calls.push(['init', options]);
      return {
        findEligibleMethods: async () => ({ isEligible: () => true }),
        createPayPalOneTimePaymentSession(optionsArg) {
          callbacks = optionsArg;
          return {
            hasReturned: () => true,
            async resume() {
              calls.push(['resume']);
            },
            async start(options, promise) {
              calls.push(['start', options, await promise]);
            },
          };
        },
      };
    },
  };
  const flow = {
    start: async () => ({ orderId: 'pp-1' }),
    setAddress: async (address) => calls.push(['address', address]),
    setShippingOption: async (id) => calls.push(['option', id]),
    approve: async () => ({ reviewUrl: '/review?orderId=one' }),
    cancel: () => calls.push(['cancel']),
  };
  const start = await createExpressButton({
    sdk,
    flow,
    onReview: (url) => calls.push(['review', url]),
  });
  assert.equal(start.hasReturned(), true);
  await start.resume();
  await start();
  await callbacks.onShippingAddressChange({ shippingAddress: { countryCode: 'US' } });
  await callbacks.onShippingOptionsChange({ selectedShippingOption: { id: 'fast' } });
  await callbacks.onApprove({ orderId: 'pp-1' });
  assert.equal(calls[0][1].clientId, 'public-client');
  assert.deepEqual(calls[1], ['resume']);
  assert.deepEqual(calls[2], ['start', { presentationMode: 'auto' }, { orderId: 'pp-1' }]);
  assert.deepEqual(calls[4], ['option', 'fast']);
  assert.deepEqual(calls[5], ['review', '/review?orderId=one']);
  callbacks.onCancel();
  assert.deepEqual(calls[6], ['cancel']);
  assert(!calls.some(([name]) => name === 'complete'));
});
