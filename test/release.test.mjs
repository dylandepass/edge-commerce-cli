import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import config from '../release.config.mjs';

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const workflow = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');

test('automatic releases keep main on the preview channel', () => {
  assert.deepEqual(config.branches, [{ name: 'main', channel: 'preview' }]);
  assert.equal(config.tagFormat, 'v${version}');
  assert.deepEqual(config.plugins, [
    '@semantic-release/commit-analyzer',
    '@semantic-release/release-notes-generator',
    '@semantic-release/npm',
  ]);
  assert.equal(manifest.publishConfig.tag, 'preview');
  assert.equal(manifest.scripts.release, 'semantic-release');
});

test('only main pushes release; GitHub releases follow an npm publish as prereleases', () => {
  assert.match(workflow, /push:\s+branches: \[main\]/);
  assert.doesNotMatch(workflow, /push:\s+tags:/);
  assert.match(workflow, /environment: npm-release/);
  assert.match(workflow, /id-token: write/);
  assert.match(workflow, /fetch-depth: 0/);
  assert.match(workflow, /npm run release -- --dry-run[\s\S]+npm run release\n/);
  assert.match(workflow, /npm view "edge-commerce-cli@\$\{tag#v\}"/);
  assert.match(
    workflow,
    /gh release create "\$tag" --verify-tag --generate-notes --prerelease --latest=false/,
  );
});
