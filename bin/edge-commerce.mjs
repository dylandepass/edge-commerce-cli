#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command, CommanderError } from 'commander';
import { CliError, pdpDefaults, siteDefaults, validateSetup } from '../src/config.mjs';
import { installedGuidance } from '../src/integration-guide.mjs';
import {
  applyPlan,
  applyRemoval,
  checkInstall,
  planInstall,
  planRemoval,
} from '../src/install.mjs';

const templates = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../template');
const jsonRequested = process.argv.includes('--json');
function output(result, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }

  process.stdout.write(
    `${result.outcome.toUpperCase()}: ${result.operations?.length ?? 0} file(s)\n`,
  );
  for (const op of result.operations ?? []) {
    process.stdout.write(
      `  ${op.action.padEnd(9)} ${op.path}${op.action === 'conflict' ? ` (${op.reason})` : ''}\n`,
    );
    if (op.diff) process.stdout.write(`${op.diff}\n`);
  }

  for (const step of result.nextSteps ?? []) process.stdout.write(`Next: ${step}\n`);
}
const codeFor = (code) =>
  ({ INVALID_INPUT: 2, CONFLICT: 3, OPERATION: 4, CANCELLED: 130 })[code] ?? 4;

async function wizard(setup, interactive) {
  if (!interactive) return setup;

  const prompts = await import('@clack/prompts');
  const ask = async (message, initialValue, defaultValue) => {
    const answer = await prompts.text({ message, initialValue, defaultValue });
    if (prompts.isCancel(answer)) throw new CliError('CANCELLED', 'Setup cancelled.');
    return answer;
  };

  prompts.intro('Edge Commerce setup');

  if (!setup.features) {
    const choice = await prompts.select({
      message: 'Which feature?',
      options: [
        { label: 'Cart and checkout', value: 'cart-checkout' },
        { label: 'PDP only', value: 'pdp' },
        { label: 'Both', value: 'both' },
      ],
    });
    if (prompts.isCancel(choice)) throw new CliError('CANCELLED', 'Setup cancelled.');
    setup.features = choice === 'both' ? ['cart-checkout', 'pdp'] : [choice];
  }

  setup.version ??= 1;
  setup.site ??= {};

  // A catalog-only PDP has no prices or cart, so cart questions are skipped.
  const pdpOnly = setup.features.includes('pdp') && !setup.features.includes('cart-checkout');
  if (pdpOnly && !setup.pdp?.mode) {
    const mode = await prompts.select({
      message: 'Product page mode',
      options: [
        { label: 'Sell online (prices and add to cart)', value: 'cart' },
        { label: 'Catalog only (no prices or cart)', value: 'catalog' },
      ],
    });
    if (prompts.isCancel(mode)) throw new CliError('CANCELLED', 'Setup cancelled.');
    setup.pdp = { ...setup.pdp, mode };
  }
  const catalog = setup.pdp?.mode === 'catalog';

  for (const [key, label, fallback] of [
    ['storeView', 'Cart storage namespace (default: default)', siteDefaults.storeView],
    ['locale', 'Shopper locale (default: en-US; change for other markets)', siteDefaults.locale],
    ['currency', 'Currency (e.g. USD)'],
  ]) {
    if (catalog && key !== 'locale') {
      continue;
    }
    setup.site[key] ??= await ask(label, fallback, fallback);
  }

  setup.productSource ??= await ask(
    'Product source: existing-pdp or starter-pdp',
    setup.features.includes('pdp') ? 'starter-pdp' : 'existing-pdp',
  );

  if (pdpOnly && !catalog && !setup.site.cartDestination && !setup.site.cartBehavior) {
    const dest = await ask('Existing cart path (blank to stay on page)');
    if (dest) {
      setup.site.cartDestination = dest;
    } else {
      setup.site.cartBehavior = 'stay';
    }
  }

  if (setup.features.includes('pdp') && setup.pdp?.previewProxyKey === undefined) {
    prompts.note(
      'Branch previews (*.aem.page, *.aem.live) do not serve Product Pipeline pages. With a CORS proxy key, product paths load the page from the main *.aem.network origin. The key is public and visible in browser code.',
      'PDP preview',
    );
    const key = await ask('Preview CORS proxy key (blank to skip)');
    setup.pdp = { ...setup.pdp };
    if (key) {
      setup.pdp.previewProxyKey = key;
      setup.pdp.previewProductPath ??= await ask(
        'Product page path segment',
        pdpDefaults.previewProductPath,
        pdpDefaults.previewProductPath,
      );
    }
  }

  if (setup.features.includes('cart-checkout')) {
    setup.site.country ??= await ask('Checkout country (e.g. US)');
    prompts.note(
      'AEM preview/live and localhost use the staging Commerce API; custom domains use production. To override, provide a public api.origin in setup JSON.',
      'API routing',
    );
    setup.api ??= {};

    for (const [key, label] of [
      ['org', 'Commerce API org'],
      ['site', 'Commerce API site'],
    ]) {
      setup.api[key] ??= await ask(label);
    }

    setup.routes ??= {};
    for (const [key, example] of [
      ['cart', '/cart'],
      ['checkout', '/checkout'],
      ['review', '/order/review'],
      ['complete', '/order/complete'],
      ['cancel', '/order/cancel'],
    ]) {
      setup.routes[key] ??= await ask(`${key} page route`, example);
    }

    setup.paypal ??= {};
    setup.paypal.clientId ??= await ask('Public PayPal client ID (never enter a secret)');
  }

  return setup;
}

async function runInit(options, mode = 'init') {
  const interactive = Boolean(process.stdin.isTTY && options.input !== false && !options.json);

  if (mode === 'upgrade' && !options.config) {
    throw new CliError('INVALID_INPUT', 'Upgrade requires the public --config input.', [
      { path: 'config', message: 'Provide the setup JSON used for this site' },
    ]);
  }

  let setup = {};
  if (options.config) {
    try {
      setup = JSON.parse(await readFile(options.config, 'utf8'));
    } catch (error) {
      throw new CliError('INVALID_INPUT', `Cannot read setup JSON: ${error.message}`, [
        { path: 'config', message: 'Read a valid JSON file' },
      ]);
    }
  }

  if (options.feature?.length) {
    if (
      setup.features &&
      JSON.stringify([...setup.features].sort()) !== JSON.stringify([...options.feature].sort())
    ) {
      throw new CliError('INVALID_INPUT', 'Feature flags disagree with config.', [
        { path: 'features', message: 'Make config and flags agree' },
      ]);
    }
    setup.features = options.feature;
  }

  if (!interactive && !options.dryRun && !options.yes) {
    throw new CliError('INVALID_INPUT', 'Non-interactive apply requires --yes.', [
      { path: 'yes', message: 'Pass --yes after reviewing --dry-run' },
    ]);
  }

  if (interactive && !options.target) {
    const prompts = await import('@clack/prompts');
    const target = await prompts.text({
      message: 'Existing EDS storefront directory',
      initialValue: process.cwd(),
    });
    if (prompts.isCancel(target)) throw new CliError('CANCELLED', 'Setup cancelled.');
    options.target = target;
  }

  setup = validateSetup(await wizard(setup, interactive));
  const plan = await planInstall({ templates, target: options.target || '.', setup, mode });

  if (plan.outcome === 'blocked' || options.dryRun) {
    output(plan, options.json);
    if (plan.outcome === 'blocked') process.exitCode = 3;
    return;
  }

  if (!options.json) output(plan, false);
  if (interactive && !options.yes) {
    const prompts = await import('@clack/prompts');
    const yes = await prompts.confirm({
      message: 'Apply the displayed plan, including any scripts.js integration diff?',
    });
    if (prompts.isCancel(yes) || !yes) throw new CliError('CANCELLED', 'Setup cancelled.');
  }

  const result = await applyPlan(plan);
  output(result, options.json);
  if (
    mode === 'init' &&
    interactive &&
    process.stdout.isTTY &&
    result.operations.some((op) => op.action === 'add')
  ) {
    try {
      const guide = await installedGuidance({ target: options.target || '.', mode: 'manual' });
      process.stdout.write(`\n${guide.guidance}\n`);
    } catch {
      // Guidance is optional; a read error cannot undo a successful install.
      process.stdout.write('\nOptional setup blueprint could not be shown.\n');
    }
    process.stdout.write(
      '\nOptional copyable AI prompt: edge-commerce guide --mode ai (run from the storefront directory, or pass --target)\n',
    );
  }
}

const program = new Command();
program.exitOverride();
program.configureOutput({
  writeErr: (text) => {
    if (!jsonRequested) process.stderr.write(text);
  },
});
program
  .name('edge-commerce')
  .description('Copy customer-owned commerce source into an EDS storefront')
  .version(JSON.parse(await readFile(new URL('../package.json', import.meta.url))).version)
  .addHelpText(
    'after',
    '\nDefaults: cart storage namespace default; shopper locale en-US (US English).\nAPI routing: *.aem.page, *.aem.live, and localhost use staging; custom domains use production.\nExamples:\n  edge-commerce init --target ./site --dry-run\n  edge-commerce init --target ./site --config ./commerce-setup.json --no-input --dry-run --json\n  edge-commerce init --target ./site --config ./commerce-setup.json --no-input --yes --json\n  edge-commerce guide --target ./site --mode ai\n',
  );
program
  .command('init')
  .description('Plan or install cart/checkout (default) and optional PDP')
  .option('--target <directory>', 'EDS storefront directory (defaults to current directory)')
  .option('--config <file>', 'public, versioned JSON setup input')
  .option(
    '--feature <name>',
    'cart-checkout or pdp; repeat for both',
    (value, previous) => [...previous, value],
    [],
  )
  .option('--dry-run', 'show file changes without writing')
  .option('--no-input', 'never prompt')
  .option('--yes', 'accept conflict-free installation plan')
  .option('--json', 'print one JSON result; disables prompts')
  .action((options) => runInit(options, 'init'));
program
  .command('upgrade')
  .description('Preview or apply conflict-free upstream source updates')
  .requiredOption('--config <file>', 'public, versioned JSON setup input')
  .option('--target <directory>', 'EDS storefront directory (defaults to current directory)')
  .option('--dry-run', 'show changes and diffs without writing')
  .option('--no-input', 'never prompt')
  .option('--yes', 'apply unchanged installed files and safe managed PDP hooks')
  .option('--json', 'print one JSON result; disables prompts')
  .action((options) => runInit(options, 'upgrade'));
program
  .command('remove')
  .description('Remove selected installed features while preserving edited files')
  .requiredOption(
    '--feature <name>',
    'cart-checkout or pdp; repeat for both',
    (value, previous) => [...previous, value],
    [],
  )
  .option('--target <directory>', 'EDS storefront directory', '.')
  .option('--dry-run', 'show deletions and preserved edits without writing')
  .option('--no-input', 'never prompt')
  .option('--yes', 'accept safe deletion of unmodified installed files')
  .option('--json', 'print one JSON result; disables prompts')
  .action(async (options) => {
    const plan = await planRemoval({ target: options.target, features: options.feature });
    if (plan.outcome === 'blocked' || options.dryRun) {
      output(plan, options.json);
      if (plan.outcome === 'blocked') process.exitCode = 3;
      return;
    }
    const interactive = Boolean(process.stdin.isTTY && options.input !== false && !options.json);
    if (!interactive && !options.yes)
      throw new CliError('INVALID_INPUT', 'Non-interactive removal requires --yes.', [
        { path: 'yes', message: 'Review --dry-run first' },
      ]);
    if (!options.json) output(plan, false);
    if (interactive && !options.yes) {
      const prompts = await import('@clack/prompts');
      const yes = await prompts.confirm({
        message:
          'Remove unchanged installed files and managed PDP hooks? Other edits will be preserved.',
      });
      if (prompts.isCancel(yes) || !yes) throw new CliError('CANCELLED', 'Removal cancelled.');
    }
    output(await applyRemoval(plan), options.json);
  });
program
  .command('guide')
  .description('Show read-only manual or AI integration guidance for an installed storefront')
  .option('--target <directory>', 'EDS storefront directory', '.')
  .option('--mode <manual|ai>', 'manual checklist or copyable AI prompt', 'manual')
  .option('--json', 'print one machine-readable result; never prompts')
  .action(async (options) => {
    const result = await installedGuidance({ target: options.target, mode: options.mode });
    process.stdout.write(`${options.json ? JSON.stringify(result) : result.guidance}\n`);
  });
program
  .command('check')
  .description('Check installed files against their manifest')
  .option('--target <directory>', 'EDS storefront directory', '.')
  .option('--json', 'print machine-readable result')
  .action(async (options) => {
    const result = await checkInstall({ target: options.target });
    output(result, options.json);
    if (result.outcome === 'blocked') process.exitCode = 3;
  });
try {
  await program.parseAsync();
} catch (error) {
  if (error instanceof CommanderError && error.exitCode === 0) process.exitCode = 0;
  else {
    const result = {
      version: 1,
      outcome: 'blocked',
      features: [],
      operations: [],
      errors: error.fields?.length ? error.fields : [{ path: '$', message: error.message }],
      nextSteps: ['Check edge-commerce --help and correct the input'],
    };
    if (jsonRequested) output(result, true);
    else if (!(error instanceof CommanderError))
      process.stderr.write(
        `edge-commerce: ${error.message}\n${result.errors.map((item) => `  ${item.path}: ${item.message}`).join('\n')}\n`,
      );
    process.exitCode = error instanceof CommanderError ? 2 : codeFor(error.code);
  }
}
