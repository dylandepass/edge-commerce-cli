import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { validateSetup } from '../src/config.mjs';
import {
  planInstall,
  applyPlan,
  checkInstall,
  planRemoval,
  applyRemoval,
} from '../src/install.mjs';

const base = {
  version: 1,
  features: ['cart-checkout'],
  site: { storeView: 'en', locale: 'en-US', currency: 'USD', country: 'US' },
  productSource: 'existing-pdp',
  api: { origin: 'https://commerce.example.com', org: 'example', site: 'store' },
  routes: {
    cart: '/cart',
    checkout: '/checkout',
    review: '/order/review',
    complete: '/order/complete',
    cancel: '/order/cancel',
  },
  paypal: { clientId: 'public-sandbox-id' },
};

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'edge-commerce-'));
  const templates = path.join(root, 'template');
  const target = path.join(root, 'storefront');
  await mkdir(target);
  for (const [feature, file] of [
    ['cart-core', 'scripts/commerce/cart.js'],
    ['cart-checkout', 'widgets/cart/cart.js'],
    ['pdp', 'blocks/pdp/pdp.js'],
  ]) {
    const dest = path.join(templates, feature, file);
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, `// ${feature}\n`);
  }
  return { templates, target };
}

function valid(input = {}) {
  return validateSetup({ ...structuredClone(base), ...input });
}

test('validation rejects missing, unsafe, unknown and secret inputs without copying them', () => {
  assert.deepEqual(valid().features, ['cart-checkout']);
  for (const [input, field] of [
    [{ version: 2 }, 'version'],
    [{ features: ['other'] }, 'features'],
    [{ paypal: { clientSecret: 'do-not-copy', clientId: 'id' } }, 'paypal.clientSecret'],
    [{ routes: { ...base.routes, review: '/cart' } }, 'routes.review'],
    [{ api: { ...base.api, origin: 'https://commerce.example.com/path' } }, 'api.origin'],
    [{ site: { ...base.site, currency: 'US' } }, 'site.currency'],
  ]) {
    assert.throws(
      () => valid(input),
      (error) => error.code === 'INVALID_INPUT' && error.fields.some((f) => f.path === field),
    );
  }
  const pdp = valid({
    features: ['pdp'],
    site: { storeView: 'en', locale: 'en-US', currency: 'USD', cartBehavior: 'stay' },
    api: undefined,
    routes: undefined,
    paypal: undefined,
  });
  assert.deepEqual(pdp.features, ['pdp']);
});

test('missing or blank site values use visible defaults without changing explicit settings', () => {
  const setup = valid({
    site: { currency: 'USD', country: 'US' },
    api: { org: 'example', site: 'store' },
  });
  assert.equal(setup.site.storeView, 'default');
  assert.equal(setup.site.locale, 'en-US');
  assert.deepEqual(setup.api, { org: 'example', site: 'store' });

  const blank = valid({
    site: { ...base.site, storeView: ' ', locale: '' },
  });
  assert.equal(blank.site.storeView, 'default');
  assert.equal(blank.site.locale, 'en-US');

  const pdp = valid({
    features: ['pdp'],
    site: { currency: 'EUR', cartBehavior: 'stay' },
    api: undefined,
    routes: undefined,
    paypal: undefined,
  });
  assert.equal(pdp.site.storeView, 'default');
  assert.equal(pdp.site.locale, 'en-US');

  const custom = valid({
    site: { ...base.site, storeView: 'canada', locale: 'fr-CA' },
    api: { ...base.api, origin: 'https://api-stage.adobecommerce.live' },
  });
  assert.equal(custom.site.storeView, 'canada');
  assert.equal(custom.site.locale, 'fr-CA');
  assert.equal(custom.api.origin, 'https://api-stage.adobecommerce.live');

  for (const [site, field] of [
    [{ ...base.site, storeView: null }, 'site.storeView'],
    [{ ...base.site, locale: 5 }, 'site.locale'],
  ]) {
    assert.throws(
      () => valid({ site }),
      (error) =>
        error.code === 'INVALID_INPUT' &&
        error.fields.filter((entry) => entry.path === field).length === 1,
    );
  }
  for (const origin of ['http://api.example.com', 'https://api.example.com/path', '']) {
    assert.throws(
      () => valid({ api: { ...base.api, origin } }),
      (error) =>
        error.code === 'INVALID_INPUT' && error.fields.some((entry) => entry.path === 'api.origin'),
    );
  }
});

test('cart destinations stay on the storefront for checkout and PDP-only setups', () => {
  const pdp = {
    features: ['pdp'],
    site: { storeView: 'en', locale: 'en-US', currency: 'USD' },
    productSource: 'starter-pdp',
    api: undefined,
    routes: undefined,
    paypal: undefined,
  };

  for (const setup of [base, pdp]) {
    for (const cartDestination of ['//other', '///other', null]) {
      assert.throws(
        () => valid({ ...setup, site: { ...setup.site, cartDestination } }),
        (error) =>
          error.code === 'INVALID_INPUT' &&
          error.fields.some((field) => field.path === 'site.cartDestination'),
      );
    }
    assert.equal(
      valid({ ...setup, site: { ...setup.site, cartDestination: '/cart' } }).site.cartDestination,
      '/cart',
    );
  }
});

test('profiles install in either order without rewriting the core or adding checkout for PDP alone', async () => {
  const { templates, target } = await fixture();
  const pdp = valid({
    features: ['pdp'],
    site: { storeView: 'en', locale: 'en-US', currency: 'USD', cartBehavior: 'stay' },
    api: undefined,
    routes: undefined,
    paypal: undefined,
  });
  const first = await planInstall({ templates, target, setup: pdp });
  assert.equal(first.outcome, 'ready');
  assert(first.operations.every((op) => !op.path.includes('checkout')));
  await applyPlan(first);
  const core = await readFile(path.join(target, 'scripts/commerce/site-config.js'), 'utf8');
  const second = await planInstall({ templates, target, setup: valid() });
  assert.equal(second.outcome, 'ready');
  assert(
    second.operations.some(
      (op) => op.path === 'scripts/commerce/site-config.js' && op.action === 'unchanged',
    ),
  );
  await applyPlan(second);
  assert.equal(await readFile(path.join(target, 'scripts/commerce/site-config.js'), 'utf8'), core);
  assert.equal((await checkInstall({ target })).outcome, 'ready');
  const repeat = await planInstall({ templates, target, setup: valid() });
  assert(repeat.operations.every((op) => op.action === 'unchanged'));
});

test('checkout first then PDP adds only PDP files and keeps checkout and shared core', async () => {
  const { templates, target } = await fixture();
  await applyPlan(await planInstall({ templates, target, setup: valid() }));
  const core = await readFile(path.join(target, 'scripts/commerce/site-config.js'), 'utf8');
  const pdp = valid({
    features: ['pdp'],
    site: { storeView: 'en', locale: 'en-US', currency: 'USD', cartBehavior: 'stay' },
    api: undefined,
    routes: undefined,
    paypal: undefined,
  });
  const plan = await planInstall({ templates, target, setup: pdp });
  assert.equal(plan.outcome, 'ready');
  await applyPlan(plan);
  assert.equal(await readFile(path.join(target, 'scripts/commerce/site-config.js'), 'utf8'), core);
  await readFile(path.join(target, 'widgets/cart/cart.js'));
  await readFile(path.join(target, 'blocks/pdp/pdp.js'));
  assert.deepEqual((await checkInstall({ target })).features, ['cart-checkout', 'pdp']);
});

test('conflicts block every write, including generated config and guidance', async () => {
  const { templates, target } = await fixture();
  await mkdir(path.join(target, 'widgets/cart'), { recursive: true });
  await writeFile(path.join(target, 'widgets/cart/cart.js'), 'customer edits');
  const plan = await planInstall({ templates, target, setup: valid() });
  assert.equal(plan.outcome, 'blocked');
  assert(plan.operations.some((op) => op.action === 'conflict'));
  await assert.rejects(applyPlan(plan), { code: 'CONFLICT' });
  await assert.rejects(readFile(path.join(target, 'scripts/commerce/cart.js')));
});

test('a changed destination or a symlink escaping the target fails closed', async () => {
  const { templates, target } = await fixture();
  const plan = await planInstall({ templates, target, setup: valid() });
  await mkdir(path.join(target, 'widgets/cart'), { recursive: true });
  await writeFile(path.join(target, 'widgets/cart/cart.js'), 'changed since plan');
  await assert.rejects(applyPlan(plan), { code: 'CONFLICT' });
  await assert.rejects(readFile(path.join(target, 'scripts/commerce/cart.js')));
  const other = await fixture();
  await symlink(path.dirname(other.target), path.join(other.target, 'scripts'));
  const unsafe = await planInstall({
    templates: other.templates,
    target: other.target,
    setup: valid(),
  });
  assert.equal(unsafe.outcome, 'blocked');
  assert(unsafe.operations.some((op) => op.action === 'conflict'));
});

test('remove preserves customer edits and retains shared core while another feature remains', async () => {
  const { templates, target } = await fixture();
  const both = valid({ features: ['cart-checkout', 'pdp'] });
  await applyPlan(await planInstall({ templates, target, setup: both }));
  const edited = path.join(target, 'blocks/pdp/pdp.js');
  await writeFile(edited, '// customer PDP\n');
  const plan = await planRemoval({ target, features: ['pdp'] });
  assert(plan.operations.some((op) => op.path === 'blocks/pdp/pdp.js' && op.action === 'preserve'));
  await applyRemoval(plan);
  assert.equal(await readFile(edited, 'utf8'), '// customer PDP\n');
  await readFile(path.join(target, 'scripts/commerce/cart.js'));
  assert.equal((await checkInstall({ target })).outcome, 'ready');
  await applyRemoval(await planRemoval({ target, features: ['cart-checkout'] }));
  await assert.rejects(readFile(path.join(target, 'scripts/commerce/cart.js')));
  assert.equal(await readFile(edited, 'utf8'), '// customer PDP\n');
});

test('upgrade previews a source diff and updates only an unchanged installed file', async () => {
  const { templates, target } = await fixture();
  await applyPlan(await planInstall({ templates, target, setup: valid() }));
  const templateFile = path.join(templates, 'cart-checkout/widgets/cart/cart.js');
  await writeFile(templateFile, '// revised checkout widget\n');
  const upgrade = await planInstall({ templates, target, setup: valid(), mode: 'upgrade' });
  const changed = upgrade.operations.find((op) => op.path === 'widgets/cart/cart.js');
  assert.equal(changed.action, 'update');
  assert.match(changed.diff, /revised checkout widget/);
  assert.equal(
    await readFile(path.join(target, 'widgets/cart/cart.js'), 'utf8'),
    '// cart-checkout\n',
  );
  await applyPlan(upgrade);
  assert.equal(
    await readFile(path.join(target, 'widgets/cart/cart.js'), 'utf8'),
    '// revised checkout widget\n',
  );
  assert.equal((await checkInstall({ target })).outcome, 'ready');
  await writeFile(path.join(target, 'widgets/cart/cart.js'), '// customer edits\n');
  const blocked = await planInstall({ templates, target, setup: valid(), mode: 'upgrade' });
  assert.equal(blocked.outcome, 'blocked');
  await assert.rejects(applyPlan(blocked), { code: 'CONFLICT' });
});

test('public config edits remain untouched and check reports changes', async () => {
  const { templates, target } = await fixture();
  await applyPlan(await planInstall({ templates, target, setup: valid() }));
  const file = path.join(target, 'scripts/commerce/site-config.js');
  await writeFile(file, '// customer config');
  const check = await checkInstall({ target });
  assert.equal(check.outcome, 'blocked');
  assert(
    check.operations.some(
      (op) => op.path === 'scripts/commerce/site-config.js' && op.action === 'modified',
    ),
  );
  const plan = await planInstall({ templates, target, setup: valid() });
  assert.equal(plan.outcome, 'blocked');
  assert.equal(await readFile(file, 'utf8'), '// customer config');
});

test('PDP setup validates catalog mode and public preview settings', () => {
  const pdpOnly = (pdp, site = { locale: 'en-GB' }) =>
    validateSetup({ version: 1, features: ['pdp'], productSource: 'starter-pdp', site, pdp });
  const catalog = pdpOnly({ mode: 'catalog' });
  assert.deepEqual(catalog.pdp, { mode: 'catalog' });
  assert.equal(catalog.site.currency, undefined);
  assert.deepEqual(pdpOnly({ mode: 'catalog', previewProxyKey: 'public-key-123' }).pdp, {
    mode: 'catalog',
    previewProxyKey: 'public-key-123',
    previewProductPath: '/products/',
  });
  assert.deepEqual(valid({ features: ['cart-checkout', 'pdp'] }).pdp, { mode: 'cart' });
  assert.equal(valid().pdp, undefined);
  for (const [input, field] of [
    [{ pdp: { mode: 'catalog' } }, 'pdp'],
    [{ features: ['cart-checkout', 'pdp'], pdp: { mode: 'catalog' } }, 'pdp.mode'],
    [{ features: ['cart-checkout', 'pdp'], pdp: { mode: 'shop' } }, 'pdp.mode'],
    [
      { features: ['cart-checkout', 'pdp'], pdp: { previewProxyKey: 'short' } },
      'pdp.previewProxyKey',
    ],
    [
      { features: ['cart-checkout', 'pdp'], pdp: { previewProductPath: '/p/' } },
      'pdp.previewProductPath',
    ],
    [
      {
        features: ['cart-checkout', 'pdp'],
        pdp: { previewProxyKey: 'public-key-123', previewProductPath: 'products' },
      },
      'pdp.previewProductPath',
    ],
    [{ features: ['cart-checkout', 'pdp'], pdp: { theme: 'dark' } }, 'pdp.theme'],
  ]) {
    assert.throws(
      () => valid(input),
      (error) => error.code === 'INVALID_INPUT' && error.fields.some((f) => f.path === field),
    );
  }
  assert.throws(
    () => pdpOnly({ mode: 'cart' }, { cartBehavior: 'stay' }),
    (error) => error.fields.some((f) => f.path === 'site.currency'),
  );
});

test('catalog-only PDP skips the cart core and generates its PDP config', async () => {
  const { templates, target } = await fixture();
  const setup = validateSetup({
    version: 1,
    features: ['pdp'],
    productSource: 'starter-pdp',
    site: {},
    pdp: { mode: 'catalog', previewProxyKey: 'public-key-123' },
  });
  const plan = await planInstall({ templates, target, setup });
  assert.deepEqual(
    plan.operations.map((op) => op.path),
    ['blocks/pdp/pdp.js', 'scripts/commerce/pdp-config.js', 'scripts/commerce/site-config.js'],
  );
  await applyPlan(plan);
  const config = await readFile(path.join(target, 'scripts/commerce/pdp-config.js'), 'utf8');
  assert.match(config, /"mode": "catalog"/);
  assert.match(config, /"proxyKey": "public-key-123"/);
  assert.match(config, /"productPath": "\/products\/"/);
  assert.deepEqual((await checkInstall({ target })).features, ['pdp']);
  await applyRemoval(await planRemoval({ target, features: ['pdp'] }));
  await assert.rejects(readFile(path.join(target, 'scripts/commerce/site-config.js')));
  await assert.rejects(readFile(path.join(target, 'scripts/commerce/pdp-config.js')));
});
