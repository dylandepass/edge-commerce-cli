import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const temp = mkdtempSync(path.join(tmpdir(), 'edge-commerce-pack-'));
const required = [
  'LICENSE',
  'README.md',
  'package.json',
  'bin/edge-commerce.mjs',
  'src/config.mjs',
  'src/install.mjs',
  'template/cart-core/scripts/commerce/cart.js',
  'template/cart-checkout/blocks/checkout/checkout.js',
  'template/pdp/blocks/pdp/pdp.js',
];
const allowed = (file) =>
  ['LICENSE', 'README.md', 'package.json'].includes(file) ||
  ['bin/', 'src/', 'template/', 'examples/'].some((prefix) => file.startsWith(prefix));

try {
  assert.notEqual(pkg.private, true, 'The npm package must be publishable');

  const packed = JSON.parse(
    execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', temp], {
      cwd: root,
      encoding: 'utf8',
    }),
  )[0];
  const files = new Set(packed.files.map((file) => file.path));

  assert.equal(packed.name, pkg.name);
  assert.equal(packed.version, pkg.version);
  for (const file of required) {
    assert.ok(files.has(file), `Missing published file: ${file}`);
  }
  for (const file of files) {
    assert.ok(allowed(file), `Unexpected published file: ${file}`);
  }

  // Test the installed tarball, not the working-tree binary or templates.
  const consumer = path.join(temp, 'consumer');
  const storefront = path.join(temp, 'storefront');
  mkdirSync(consumer);
  mkdirSync(path.join(storefront, 'scripts'), { recursive: true });
  writeFileSync(path.join(storefront, 'scripts/scripts.js'), '// EDS storefront fixture\n');

  execFileSync(
    'npm',
    [
      'install',
      '--prefix',
      consumer,
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      path.join(temp, packed.filename),
    ],
    { encoding: 'utf8' },
  );

  const binary = path.join(consumer, 'node_modules/.bin/edge-commerce');
  assert.ok(existsSync(binary), 'The published CLI binary is missing');
  assert.equal(execFileSync(binary, ['--version'], { encoding: 'utf8' }).trim(), pkg.version);

  const plan = JSON.parse(
    execFileSync(
      binary,
      [
        'init',
        '--target',
        storefront,
        '--config',
        path.join(root, 'examples/commerce-setup.json'),
        '--no-input',
        '--dry-run',
        '--json',
      ],
      { encoding: 'utf8' },
    ),
  );
  assert.equal(plan.outcome, 'ready');
  assert.ok(plan.operations.some((file) => file.path === 'blocks/checkout/checkout.js'));
  assert.ok(!existsSync(path.join(storefront, 'blocks/checkout/checkout.js')));

  console.log(`Verified ${packed.name}@${packed.version} (${files.size} packaged files)`);
} finally {
  rmSync(temp, { recursive: true, force: true });
}
