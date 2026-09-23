import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

async function list(root) {
  const results = [];
  for (const item of await readdir(root, { withFileTypes: true })) {
    if (item.name === 'node_modules' || item.name === '.git') continue;
    const name = path.join(root, item.name);
    if (item.isDirectory()) results.push(...(await list(name)));
    else if (/\.[cm]?js$/.test(item.name)) results.push(name);
  }
  return results;
}
for (const file of await list('.')) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) process.exitCode = 1;
}
