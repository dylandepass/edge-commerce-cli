import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const bin = path.join(root, 'bin/edge-commerce.mjs');
const config = path.join(root, 'examples/commerce-setup.json');
const run = (...args) => {
  const result = spawnSync(process.execPath, [bin, ...args], {
    cwd: root,
    input: '',
    encoding: 'utf8',
    timeout: 10000,
  });
  return { ...result, json: result.stdout.trim() ? JSON.parse(result.stdout) : null };
};

test('CLI is scriptable: dry run writes nothing, apply/check output one JSON object', async () => {
  const target = await mkdtemp(path.join(tmpdir(), 'edge-cli-'));
  await writeFile(path.join(target, 'AGENTS.md'), 'Customer root guidance');
  const dry = run('init', '--target', target, '--config', config, '--dry-run', '--json');
  assert.equal(dry.status, 0);
  assert.equal(dry.json.outcome, 'ready');
  assert.equal(dry.stdout.trim().split('\n').length, 1);
  await assert.rejects(access(path.join(target, 'blocks/cart/cart.js')));
  const applied = run('init', '--target', target, '--config', config, '--yes', '--json');
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(applied.json.outcome, 'applied');
  assert.equal(applied.stdout.trim().split('\n').length, 1);
  assert.equal(await readFile(path.join(target, 'AGENTS.md'), 'utf8'), 'Customer root guidance');
  assert.equal(run('check', '--target', target, '--json').json.outcome, 'ready');
  const repeat = run('init', '--target', target, '--config', config, '--yes', '--json');
  assert.equal(repeat.status, 0, repeat.stderr);
  assert(repeat.json.operations.every((op) => op.action === 'unchanged'));
  const upgrade = run('upgrade', '--target', target, '--config', config, '--dry-run', '--json');
  assert.equal(upgrade.status, 0, upgrade.stderr);
  assert(upgrade.json.operations.every((op) => op.action === 'unchanged'));
  const removal = run(
    'remove',
    '--target',
    target,
    '--feature',
    'cart-checkout',
    '--dry-run',
    '--json',
  );
  assert.equal(removal.status, 0, removal.stderr);
  assert(
    removal.json.operations.some(
      (op) => op.path === 'scripts/commerce/cart.js' && op.action === 'delete',
    ),
  );
  const unapproved = run('init', '--target', target, '--config', config, '--json');
  assert.equal(unapproved.status, 2);
  assert.equal(unapproved.json.errors[0].path, 'yes');
  const unknownFlag = run('init', '--unknown', '--json');
  assert.equal(unknownFlag.status, 2);
  assert.equal(unknownFlag.json.errors[0].path, '$');
  assert.equal(unknownFlag.stdout.trim().split('\n').length, 1);
});

test('CLI rejects missing fields/secrets on non-TTY and --yes cannot override a conflict', async () => {
  const target = await mkdtemp(path.join(tmpdir(), 'edge-cli-bad-'));
  const missing = run('init', '--target', target, '--dry-run', '--json');
  assert.equal(missing.status, 2);
  assert(missing.json.errors.some((field) => field.path === 'site.storeView'));
  assert.equal(missing.stdout.trim().split('\n').length, 1);
  const raw = JSON.parse(await readFile(config, 'utf8'));
  raw.paypal.clientSecret = 'never-write-this';
  const file = path.join(target, 'bad.json');
  await writeFile(file, JSON.stringify(raw));
  const invalid = run('init', '--target', target, '--config', file, '--yes', '--json');
  assert.equal(invalid.status, 2);
  assert(!invalid.stdout.includes('never-write-this'));
  assert.equal(invalid.json.errors[0].path, 'paypal.clientSecret');
  await writeFile(path.join(target, 'blocks'), 'customer file');
  const conflict = run('init', '--target', target, '--config', config, '--yes', '--json');
  assert.equal(conflict.status, 3);
  assert.equal(conflict.json.outcome, 'blocked');
  await assert.rejects(access(path.join(target, '.edge-commerce/manifest.json')));
});

test('existing subtree AGENTS.md blocks install and leaves customer instructions intact', async () => {
  const target = await mkdtemp(path.join(tmpdir(), 'edge-agents-'));
  const owned = path.join(target, 'scripts/commerce');
  await mkdir(owned, { recursive: true });
  await writeFile(path.join(owned, 'AGENTS.md'), '# Customer guidance\n');
  const result = run('init', '--target', target, '--config', config, '--yes', '--json');
  assert.equal(result.status, 3);
  assert(
    result.json.operations.some(
      (op) => op.path === 'scripts/commerce/AGENTS.md' && op.action === 'conflict',
    ),
  );
  assert(result.json.nextSteps.some((step) => step.includes('conflicts manually')));
  assert.equal(await readFile(path.join(owned, 'AGENTS.md'), 'utf8'), '# Customer guidance\n');
  await assert.rejects(access(path.join(target, 'blocks/cart/cart.js')));
});

test('real PDP-only install excludes checkout and supports adding checkout later', async () => {
  const target = await mkdtemp(path.join(tmpdir(), 'edge-cli-pdp-'));
  const pdp = {
    version: 1,
    features: ['pdp'],
    site: { storeView: 'en', locale: 'en-US', currency: 'USD', cartBehavior: 'stay' },
    productSource: 'starter-pdp',
  };
  const pdpConfig = path.join(target, 'setup.json');
  await writeFile(pdpConfig, JSON.stringify(pdp));
  assert.equal(run('init', '--target', target, '--config', pdpConfig, '--yes', '--json').status, 0);
  await access(path.join(target, 'blocks/pdp/pdp.js'));
  await assert.rejects(access(path.join(target, 'blocks/checkout/checkout.js')));
  await assert.rejects(access(path.join(target, 'scripts/commerce/payments/paypal.js')));
  const core = await readFile(path.join(target, 'scripts/commerce/site-config.js'), 'utf8');
  const later = run('init', '--target', target, '--config', config, '--yes', '--json');
  assert.equal(later.status, 0, later.stderr);
  assert.equal(await readFile(path.join(target, 'scripts/commerce/site-config.js'), 'utf8'), core);
  await access(path.join(target, 'blocks/checkout/checkout.js'));
});

test('copied JS relative imports resolve within each installed profile', async () => {
  const target = await mkdtemp(path.join(tmpdir(), 'edge-cli-imports-'));
  const setup = JSON.parse(await readFile(config, 'utf8'));
  setup.features = ['cart-checkout', 'pdp'];
  const file = path.join(target, 'setup.json');
  await writeFile(file, JSON.stringify(setup));
  const result = run('init', '--target', target, '--config', file, '--yes', '--json');
  assert.equal(result.status, 0, result.stderr);
  for (const item of result.json.operations.filter((op) => op.path.endsWith('.js'))) {
    const source = path.join(target, item.path);
    const text = await readFile(source, 'utf8');
    for (const [, relative] of text.matchAll(/from ['"]([^'"]+)['"]/g)) {
      assert(relative.startsWith('.'), `browser module must not import npm runtime: ${relative}`);
      await access(path.resolve(path.dirname(source), relative));
    }
  }
  assert.match(execFileSync(process.execPath, [bin, '--help'], { encoding: 'utf8' }), /init/);
});
