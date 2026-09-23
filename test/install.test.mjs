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
    ['cart-checkout', 'blocks/cart/cart.js'],
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
  await readFile(path.join(target, 'blocks/cart/cart.js'));
  await readFile(path.join(target, 'blocks/pdp/pdp.js'));
  assert.deepEqual((await checkInstall({ target })).features, ['cart-checkout', 'pdp']);
});

test('conflicts block every write, including generated config and guidance', async () => {
  const { templates, target } = await fixture();
  await mkdir(path.join(target, 'blocks/cart'), { recursive: true });
  await writeFile(path.join(target, 'blocks/cart/cart.js'), 'customer edits');
  const plan = await planInstall({ templates, target, setup: valid() });
  assert.equal(plan.outcome, 'blocked');
  assert(plan.operations.some((op) => op.action === 'conflict'));
  await assert.rejects(applyPlan(plan), { code: 'CONFLICT' });
  await assert.rejects(readFile(path.join(target, 'scripts/commerce/cart.js')));
});

test('a changed destination or a symlink escaping the target fails closed', async () => {
  const { templates, target } = await fixture();
  const plan = await planInstall({ templates, target, setup: valid() });
  await mkdir(path.join(target, 'blocks/cart'), { recursive: true });
  await writeFile(path.join(target, 'blocks/cart/cart.js'), 'changed since plan');
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
  const templateFile = path.join(templates, 'cart-checkout/blocks/cart/cart.js');
  await writeFile(templateFile, '// revised checkout block\n');
  const upgrade = await planInstall({ templates, target, setup: valid(), mode: 'upgrade' });
  const changed = upgrade.operations.find((op) => op.path === 'blocks/cart/cart.js');
  assert.equal(changed.action, 'update');
  assert.match(changed.diff, /revised checkout block/);
  assert.equal(
    await readFile(path.join(target, 'blocks/cart/cart.js'), 'utf8'),
    '// cart-checkout\n',
  );
  await applyPlan(upgrade);
  assert.equal(
    await readFile(path.join(target, 'blocks/cart/cart.js'), 'utf8'),
    '// revised checkout block\n',
  );
  assert.equal((await checkInstall({ target })).outcome, 'ready');
  await writeFile(path.join(target, 'blocks/cart/cart.js'), '// customer edits\n');
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
