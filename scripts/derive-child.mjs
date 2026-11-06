#!/usr/bin/env node
/**
 * Compatibility entry point. Parent and child are independent source definitions.
 * This command only validates; it never derives, deletes or rewrites child content.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadProject } from './preset-lib.mjs';

try {
  const project = loadProject(fileURLToPath(new URL('../', import.meta.url)));
  const existing = readFileSync(project.patchPath, 'utf8').replace(/\r\n/g, '\n');
  if (existing !== project.patchText)
    throw new Error('bundle patch is stale; edit either preset independently, then run npm run compose');
  console.log('OK: independent presets validated; no child files were written');
  console.log('NOTE: derive-child is a validation-only compatibility command; use npm run check');
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
}
