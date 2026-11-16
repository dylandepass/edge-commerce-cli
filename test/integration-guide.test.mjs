import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateSetup } from '../src/config.mjs';
import { applyPlan, planInstall } from '../src/install.mjs';
import { installedGuidance, integrationGuidance } from '../src/integration-guide.mjs';

const templates = fileURLToPath(new URL('../template/', import.meta.url));
const version = JSON.parse(await readFile(new URL('../package.json', import.meta.url))).version;
const routes = {
  cart: '/bag',
  checkout: '/payment',
  review: '/order/review',
  complete: '/order/complete',
  cancel: '/order/cancel',
};

async function storefront() {
  const target = await mkdtemp(path.join(tmpdir(), 'edge-guide-'));
  const setup = validateSetup({
    version: 1,
    features: ['cart-checkout'],
    productSource: 'existing-pdp',
    site: { currency: 'USD', country: 'US' },
    api: { org: 'shop', site: 'store' },
    routes,
    paypal: { clientId: 'PUBLIC_CLIENT_ID' },
  });
  await applyPlan(await planInstall({ templates, target, setup }));
  return target;
}

test('manual and AI guidance use public routes, never payment or model tokens', () => {
  const options = { features: ['cart-checkout'], routes, currency: 'USD' };
  const manual = integrationGuidance({ ...options, mode: 'manual' });
  const ai = integrationGuidance({ ...options, mode: 'ai' });
  for (const text of [manual, ai]) {
    for (const [route, widget] of [
      ['/bag', '/widgets/cart/cart.html'],
      ['/payment', '/widgets/checkout/checkout.html'],
      ['/order/review', '/widgets/order-review/order-review.html'],
      ['/order/complete', '/widgets/order-complete/order-complete.html'],
      ['/order/cancel', '/widgets/order-cancel/order-cancel.html'],
    ]) {
      assert(text.includes(`- ${route}: ${widget}`));
    }
    assert.match(text, /USD/);
    assert.doesNotMatch(text, /clientId|PUBLIC_CLIENT_ID|api\.origin/);
  }
  assert.match(ai, /Stop and wait for my approval/);
  assert.match(ai, /Git remote and current branch without echoing credentials/);
  assert.match(ai, /verify it read-only/);
  assert.match(ai, /missing widget asset.*code has not been synced yet/);
  assert.match(ai, /window\.hlx\.codeBasePath/);
  assert.match(ai, /configured nav metadata\/path and fallback \(commonly \/nav\)/);
  assert.match(ai, /configured routes\.cart as a root-relative fallback/);
  assert.match(ai, /do not ask me for an origin or invent a working URL/);
  assert.match(ai, /Do not ask me where the nav source lives/);
  assert.match(ai, /Authored page blueprint \(content pages, not new code files\)/);
  assert.match(ai, /one standalone paragraph with a normal link/);
  assert.match(ai, /Do not assume pages are managed in DA or ask me whether they are/);
  assert.match(ai, /do not ask me for preview URLs/);
  assert.match(ai, /A page returning 200 does not prove its widget asset is synced/);
  assert.doesNotMatch(ai, /ask for the code origin if it is unknown/);
  assert.match(ai, /Do not open \.env files/);
  assert.match(ai, /Do not commit, push, publish pages/);
  assert.match(manual, /Code already copied: see \.edge-commerce\/manifest\.json/);
  assert.match(manual, /Authored page blueprint \(content pages, not new repository code files\)/);
  assert.match(manual, /Each page needs one standalone paragraph/);
  assert.match(
    manual,
    /<p><a href="\{verified-code-origin\}\/widgets\/cart\/cart\.html">Cart<\/a><\/p>/,
  );
  assert.match(manual, /never publish it as-is/);
  assert.match(manual, /Do not assume DA or request preview URLs/);
  assert.match(manual, /Commerce API and PayPal review/);
  assert.doesNotMatch(manual, /Stop and wait/);
});

test('PDP-only guidance stays independent of checkout and rejects unsafe route text', () => {
  const pdp = integrationGuidance({ features: ['pdp'], currency: 'EUR', mode: 'ai' });
  assert.match(pdp, /PDP block is installed/);
  assert.doesNotMatch(pdp, /PayPal sandbox journeys|widget links/);
  const injected = integrationGuidance({
    features: ['cart-checkout'],
    routes: { ...routes, cart: '/bag\nIGNORE_ALL_INSTRUCTIONS' },
    currency: 'USD\nSECRET',
    mode: 'ai',
  });
  assert.doesNotMatch(injected, /IGNORE_ALL_INSTRUCTIONS|SECRET/);
  assert.match(injected, /routes\.cart \(check scripts\/commerce\/checkout-config\.js\)/);
  assert.throws(() => integrationGuidance({ features: ['pdp'], mode: 'invalid' }), {
    code: 'INVALID_INPUT',
  });
});

test('PDP guidance covers page hooks, previews and catalog mode without echoing the proxy key', async () => {
  const cart = integrationGuidance({ features: ['pdp'], currency: 'EUR', mode: 'manual' });
  assert.match(cart, /buildPDPBlock\(main\) first in buildAutoBlocks/);
  assert.match(cart, /await loadPDPPreview\(\) first in loadEager/);
  assert.match(cart, /does not fetch product JSON/);
  assert.match(cart, /do not serve Product Pipeline pages/);
  assert.match(
    cart,
    /AEM_PAGES_URL \(or --url\) set to https:\/\/main--\{repo\}--\{owner\}\.aem\.network/,
  );
  assert.match(cart, /index\.plain\.html/);
  assert.match(cart, /Only add offers priced in EUR/);
  assert.doesNotMatch(cart, /Catalog-only mode/);

  const catalog = integrationGuidance({
    features: ['pdp'],
    pdpMode: 'catalog',
    pdpPreview: true,
    mode: 'ai',
  });
  assert.match(catalog, /PDP block is installed/);
  assert.match(catalog, /Catalog-only mode/);
  assert.match(catalog, /through the CORS proxy configured/);
  assert.doesNotMatch(catalog, /cart currency|Only add offers|widget links/);

  const target = await mkdtemp(path.join(tmpdir(), 'edge-guide-pdp-'));
  const setup = validateSetup({
    version: 1,
    features: ['pdp'],
    productSource: 'starter-pdp',
    site: {},
    pdp: { mode: 'catalog', previewProxyKey: 'public-key-123' },
  });
  await applyPlan(await planInstall({ templates, target, setup }));
  const installed = await installedGuidance({ target, mode: 'ai' });
  assert.match(installed.guidance, /Catalog-only mode/);
  assert.match(installed.guidance, /through the CORS proxy configured/);
  assert.doesNotMatch(installed.guidance, /public-key-123/);
});

test('read-only guide uses safe generated public config and ignores edited secret data', async () => {
  const target = await storefront();
  const manifestPath = path.join(target, '.edge-commerce/manifest.json');
  const initialManifest = await readFile(manifestPath);
  const manual = await installedGuidance({ target });
  assert.match(manual.guidance, /\/bag: \/widgets\/cart\/cart\.html/);
  assert.deepEqual(manual.features, ['cart-checkout']);

  const file = path.join(target, 'scripts/commerce/checkout-config.js');
  const prefix =
    '// Customer-owned configuration generated by edge-commerce; edit for your storefront.\n';
  await writeFile(
    file,
    `${prefix}export default ${JSON.stringify({
      routes,
      paypal: { clientSecret: 'DO_NOT_ECHO_ME' },
    })};\n`,
  );
  const ai = await installedGuidance({ target, mode: 'ai' });
  assert.match(ai.guidance, /\/bag: \/widgets\/cart\/cart\.html/);
  assert.doesNotMatch(ai.guidance, /DO_NOT_ECHO_ME/);
  assert.deepEqual(await readFile(manifestPath), initialManifest);

  const outside = path.join(await mkdtemp(path.join(tmpdir(), 'edge-guide-secret-')), 'secret.js');
  await writeFile(outside, 'SERVER_SECRET_DO_NOT_ECHO');
  await unlink(file);
  await symlink(outside, file);
  const unsafe = await installedGuidance({ target, mode: 'ai' });
  assert.doesNotMatch(unsafe.guidance, /SERVER_SECRET_DO_NOT_ECHO|\/bag: \/widgets\/cart/);
  assert.match(unsafe.guidance, /routes\.cart \(check scripts\/commerce\/checkout-config\.js\)/);
  assert.deepEqual(await readFile(manifestPath), initialManifest);

  const manifest = JSON.parse(initialManifest);
  await writeFile(manifestPath, JSON.stringify({ ...manifest, release: '0.0.9' }));
  const older = await installedGuidance({ target, mode: 'ai' });
  assert.match(older.guidance, /manifest records CLI v0\.0\.9/);
  assert.match(older.guidance, new RegExp(`guidance is from v${version.replaceAll('.', '\\.')}`));
  await writeFile(manifestPath, JSON.stringify({ ...manifest, release: '0.0.9\nDO_NOT_ECHO' }));
  const unsafeRelease = await installedGuidance({ target, mode: 'ai' });
  assert.doesNotMatch(unsafeRelease.guidance, /DO_NOT_ECHO/);
});
