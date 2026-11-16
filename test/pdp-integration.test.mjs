import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, symlink, rm } from 'node:fs/promises';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { validateSetup } from '../src/config.mjs';
import {
  planInstall,
  applyPlan,
  checkInstall,
  planRemoval,
  applyRemoval,
} from '../src/install.mjs';

const templates = fileURLToPath(new URL('../template', import.meta.url));
const setup = validateSetup({
  version: 1,
  features: ['pdp'],
  site: {},
  productSource: 'starter-pdp',
  pdp: { mode: 'catalog' },
});
const boilerplate = `// Storefront license stays intact.
import { record, decorateMain } from './aem.js';

function buildAutoBlocks(main) {
  record('auto', main);
}

async function loadEager(doc) {
  record('eager', doc);
  const main = doc.querySelector('main');
  buildAutoBlocks(main);
  decorateMain(main);
}
export { loadEager };
`;

async function fixture(t, source = boilerplate) {
  const target = await mkdtemp(path.join(tmpdir(), 'edge-pdp-hooks-'));
  t.after(() => rm(target, { recursive: true, force: true }));
  await mkdir(path.join(target, 'scripts'));
  if (source !== null) await writeFile(path.join(target, 'scripts/scripts.js'), source);
  return { target, file: path.join(target, 'scripts/scripts.js'), templates, setup };
}

// Missing either inserted call breaks the observed execution order, not just source text.
test('PDP install previews an integration diff and runs preview before decoration and PDP before auto-blocking', async (t) => {
  const options = await fixture(t);
  const plan = await planInstall(options);
  const op = plan.operations.find((item) => item.path === 'scripts/scripts.js');
  assert.equal(op?.action, 'update');
  assert.match(op.diff, /\+.*buildPDPBlock\(main\)/);
  assert.equal(await readFile(options.file, 'utf8'), boilerplate);
  await applyPlan(plan);

  // Replace installed browser helpers with observable boundaries. Execute the actual patched module.
  await writeFile(path.join(options.target, 'package.json'), '{"type":"module"}');
  await writeFile(
    path.join(options.target, 'scripts/aem.js'),
    `
    export function record(event) { globalThis.pdpEvents.push(event); }
    export function decorateMain() { record('decorate'); }
  `,
  );
  await writeFile(
    path.join(options.target, 'scripts/commerce/pdp-page.js'),
    `
    export function buildPDPBlock() { globalThis.pdpEvents.push('pdp'); }
    export async function loadPDPPreview() {
      await new Promise((resolve) => setTimeout(resolve, 5));
      globalThis.pdpEvents.push('preview');
    }
  `,
  );
  globalThis.pdpEvents = [];
  t.after(() => delete globalThis.pdpEvents);
  const mod = await import(pathToFileURL(options.file).href);
  await mod.loadEager({ querySelector: () => ({}) });
  assert.deepEqual(globalThis.pdpEvents, ['preview', 'eager', 'pdp', 'auto', 'decorate']);
});

test('repeat install and upgrade do not duplicate hooks or treat unrelated scripts edits as drift', async (t) => {
  const options = await fixture(t);
  await applyPlan(await planInstall(options));
  const installed = await readFile(options.file, 'utf8');
  assert.notEqual(installed, boilerplate);
  const custom = `${installed}\n// Customer analytics integration\n`;
  await writeFile(options.file, custom);
  assert.equal((await checkInstall(options)).outcome, 'ready');
  for (const mode of ['init', 'upgrade']) {
    const plan = await planInstall({ ...options, mode });
    assert(plan.operations.every((op) => op.action === 'unchanged'));
    await applyPlan(plan);
    assert.equal(await readFile(options.file, 'utf8'), custom);
  }
});

test('removal strips only managed regions and keeps surrounding customer changes byte-for-byte', async (t) => {
  const options = await fixture(t, boilerplate.replaceAll('\n', '\r\n'));
  await applyPlan(await planInstall(options));
  const installed = await readFile(options.file, 'utf8');
  assert.notEqual(installed, boilerplate.replaceAll('\n', '\r\n'));
  await writeFile(options.file, `${installed}\r\n// analytics\r\n`);
  const plan = await planRemoval({ target: options.target, features: ['pdp'] });
  assert.equal(plan.operations.find((op) => op.path === 'scripts/scripts.js')?.action, 'update');
  await applyRemoval(plan);
  assert.equal(
    await readFile(options.file, 'utf8'),
    `${boilerplate.replaceAll('\n', '\r\n')}\r\n// analytics\r\n`,
  );
  await assert.rejects(readFile(path.join(options.target, 'scripts/commerce/pdp-page.js')));
});

test('edited managed hooks block upgrade and removal before any dependent files are deleted', async (t) => {
  const options = await fixture(t);
  await applyPlan(await planInstall(options));
  const installed = await readFile(options.file, 'utf8');
  assert.notEqual(installed, boilerplate);
  await writeFile(options.file, installed.replace('await loadPDPPreview();', 'loadPDPPreview();'));
  assert.equal((await checkInstall(options)).outcome, 'blocked');
  const upgrade = await planInstall({ ...options, mode: 'upgrade' });
  assert.equal(upgrade.outcome, 'blocked');
  await assert.rejects(applyPlan(upgrade), { code: 'CONFLICT' });
  const removal = await planRemoval({ target: options.target, features: ['pdp'] });
  assert.equal(removal.outcome, 'blocked');
  await assert.rejects(applyRemoval(removal), { code: 'CONFLICT' });
  await readFile(path.join(options.target, 'scripts/commerce/pdp-page.js'));
});

test('a customer edit after planning is never overwritten by install or removal', async (t) => {
  const options = await fixture(t);
  const plan = await planInstall(options);
  const changed = `${boilerplate}// concurrently edited\n`;
  await writeFile(options.file, changed);
  await assert.rejects(applyPlan(plan), { code: 'CONFLICT' });
  assert.equal(await readFile(options.file, 'utf8'), changed);
  await assert.rejects(readFile(path.join(options.target, 'blocks/pdp/pdp.js')));
  await applyPlan(await planInstall(options));
  const removal = await planRemoval({ target: options.target, features: ['pdp'] });
  const installed = `${await readFile(options.file, 'utf8')}// edited again\n`;
  await writeFile(options.file, installed);
  await assert.rejects(applyRemoval(removal), { code: 'CONFLICT' });
  assert.equal(await readFile(options.file, 'utf8'), installed);
});

test('custom or ambiguous storefront loaders fall back to manual integration without changing them', async (t) => {
  const cases = [
    null,
    'not valid JavaScript {',
    boilerplate.replace('async function loadEager', 'function loadEager'),
    boilerplate.replace('function buildAutoBlocks(main)', 'function buildAutoBlocks({ main })'),
    boilerplate.replace('function buildAutoBlocks(main)', 'function customize(main)'),
    `${boilerplate}\nfunction outer() { function loadEager(doc) {} }`,
    // Perkins-style product metadata detection.
    boilerplate.replace(
      "record('auto', main);",
      `if (document.querySelector('meta[name="sku"]')) { main.append(buildBlock('pdp', [])); }`,
    ),
    // Vitamix-style existing PDP helper.
    `import { buildPDPBlock } from './pdp.js';\n${boilerplate}`,
    `import { buildPDPBlock, loadPDPPreview } from './commerce/pdp-page.js';\n${boilerplate}`,
    boilerplate.replace("  record('auto', main);", "  buildBlock('pdp', main);"),
    boilerplate.replace(
      "  record('auto', main);",
      '  document.querySelector(\'meta[name="sku"]\');',
    ),
    `${boilerplate}\nfunction custom() { function loadEager(doc) {} }\n`,
    boilerplate.replace('function buildAutoBlocks(main)', 'function buildAutoBlocks({ main })'),
  ];
  for (const source of cases) {
    const options = await fixture(t, source);
    const plan = await planInstall(options);
    assert.equal(plan.outcome, 'ready');
    assert(!plan.operations.some((op) => op.path === 'scripts/scripts.js'));
    assert(plan.nextSteps.some((step) => /PDP.*manual/i.test(step)));
    await applyPlan(plan);
    if (source !== null) assert.equal(await readFile(options.file, 'utf8'), source);
    else await assert.rejects(readFile(options.file));
  }
});

test('a symlinked scripts.js is never followed or patched', async (t) => {
  const options = await fixture(t, null);
  const outside = path.join(options.target, 'customer.js');
  await writeFile(outside, boilerplate);
  await symlink(outside, options.file);
  const plan = await planInstall(options);
  assert(!plan.operations.some((op) => op.path === 'scripts/scripts.js' && op.action === 'update'));
  await applyPlan(plan);
  assert.equal(await readFile(outside, 'utf8'), boilerplate);
});

test('parser handles comments, exported functions, renamed parameters and directives without replacing customer text', async (t) => {
  const source = `#!/usr/bin/env node
// function loadEager(doc) { } is only a comment.
export function buildAutoBlocks(content) { 'use strict'; globalThis.auto = content; }
export async function loadEager(page) { 'use strict'; globalThis.page = page; }
`;
  const options = await fixture(t, source);
  const plan = await planInstall(options);
  assert.equal(plan.operations.find((op) => op.path === 'scripts/scripts.js')?.action, 'update');
  await applyPlan(plan);
  const installed = await readFile(options.file, 'utf8');
  assert(installed.startsWith('#!/usr/bin/env node\n'));
  assert.match(installed, /buildPDPBlock\(content\)/);
  assert.match(installed, /'use strict';\s*\/\/ edge-commerce:pdp/);
  await applyRemoval(await planRemoval({ target: options.target, features: ['pdp'] }));
  assert.equal(await readFile(options.file, 'utf8'), source);
});

test('managed hooks removed manually do not prevent later CLI removal', async (t) => {
  const options = await fixture(t);
  await applyPlan(await planInstall(options));
  assert.notEqual(await readFile(options.file, 'utf8'), boilerplate);
  await writeFile(options.file, boilerplate);
  assert.equal((await checkInstall(options)).outcome, 'blocked');
  const removal = await planRemoval({ target: options.target, features: ['pdp'] });
  assert.equal(removal.outcome, 'ready');
  await applyRemoval(removal);
  assert.equal(await readFile(options.file, 'utf8'), boilerplate);
});

test('moved hooks or renamed parameters require manual review, even with unchanged region text', async (t) => {
  for (const change of [
    (source) =>
      source.replace('function buildAutoBlocks(main)', 'function buildAutoBlocks(content)'),
    (source) =>
      source.replace(
        'async function loadEager(doc) {',
        "async function loadEager(doc) { console.log('too early');",
      ),
  ]) {
    const options = await fixture(t);
    await applyPlan(await planInstall(options));
    await writeFile(options.file, change(await readFile(options.file, 'utf8')));
    assert.equal((await checkInstall(options)).outcome, 'blocked');
    assert.equal(
      (await planRemoval({ target: options.target, features: ['pdp'] })).outcome,
      'blocked',
    );
  }
});

test('a conflict in a copied file prevents the scripts.js patch too', async (t) => {
  const options = await fixture(t);
  await mkdir(path.join(options.target, 'blocks/pdp'), { recursive: true });
  await writeFile(path.join(options.target, 'blocks/pdp/pdp.js'), '// customer PDP');
  const plan = await planInstall(options);
  assert.equal(plan.outcome, 'blocked');
  await assert.rejects(applyPlan(plan), { code: 'CONFLICT' });
  assert.equal(await readFile(options.file, 'utf8'), boilerplate);
});

test('a failed manifest write rolls back the scripts.js patch and all newly copied files', async (t) => {
  const options = await fixture(t);
  const plan = await planInstall(options);
  const realRename = fs.rename;
  t.mock.method(fs, 'rename', async (from, to) => {
    if (to === path.join(options.target, '.edge-commerce/manifest.json')) {
      throw Object.assign(new Error('injected manifest failure'), { code: 'EIO' });
    }
    return realRename(from, to);
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  await assert.rejects(applyPlan(plan), { code: 'EIO' });
  assert.equal(await readFile(options.file, 'utf8'), boilerplate);
  await assert.rejects(readFile(path.join(options.target, 'blocks/pdp/pdp.js')));
  await assert.rejects(readFile(path.join(options.target, 'scripts/commerce/pdp-page.js')));
  await assert.rejects(readFile(path.join(options.target, '.edge-commerce/manifest.json')));
});

test('failed removal restores deleted modules and the managed hooks together', async (t) => {
  const options = await fixture(t);
  await applyPlan(await planInstall(options));
  const installed = await readFile(options.file, 'utf8');
  const plan = await planRemoval({ target: options.target, features: ['pdp'] });
  const realRm = fs.rm;
  t.mock.method(fs, 'rm', async (name, ...args) => {
    if (name === path.join(options.target, '.edge-commerce/manifest.json')) {
      throw Object.assign(new Error('injected manifest failure'), { code: 'EIO' });
    }
    return realRm(name, ...args);
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  await assert.rejects(applyRemoval(plan), { code: 'EIO' });
  assert.equal(await readFile(options.file, 'utf8'), installed);
  assert.equal((await checkInstall(options)).outcome, 'ready');
  await readFile(path.join(options.target, 'scripts/commerce/pdp-page.js'));
});

test('a checkout-only upgrade and removal keep the separately tracked PDP hooks', async (t) => {
  const options = await fixture(t);
  const checkout = validateSetup(
    JSON.parse(await readFile(new URL('../examples/commerce-setup.json', import.meta.url))),
  );
  options.setup = validateSetup({ ...checkout, features: ['pdp', 'cart-checkout'] });
  await applyPlan(await planInstall(options));
  const installed = await readFile(options.file, 'utf8');
  assert.notEqual(installed, boilerplate);
  await applyPlan(await planInstall({ ...options, setup: checkout, mode: 'upgrade' }));
  await applyRemoval(await planRemoval({ target: options.target, features: ['cart-checkout'] }));
  assert.equal(await readFile(options.file, 'utf8'), installed);
  assert.equal((await checkInstall(options)).outcome, 'ready');
  await applyRemoval(await planRemoval({ target: options.target, features: ['pdp'] }));
  assert.equal(await readFile(options.file, 'utf8'), boilerplate);
});
