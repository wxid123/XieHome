#!/usr/bin/env node
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
function run(args) {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit', env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
try {
  for (const file of readdirSync(resolve(root, 'scripts')).filter((file) => file.endsWith('.mjs')))
    run(['--check', `scripts/${file}`]);
  run(['scripts/compose-bundle-patch.mjs', '--check']);
  run(['scripts/check-package.mjs']);
  const tests = readdirSync(resolve(root, 'test')).filter((file) => file.endsWith('.test.mjs')).sort();
  if (!tests.length) throw new Error('no regression tests found');
  run(['--test', ...tests.map((file) => `test/${file}`)]);
  console.log('OK: unified local / CI / prepack / prepublish verification passed');
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
}
