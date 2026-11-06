#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProject } from './preset-lib.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
try {
  const project = loadProject(root);
  if (process.argv.includes('--check')) {
    const existing = readFileSync(project.patchPath, 'utf8').replace(/\r\n/g, '\n');
    if (existing !== project.patchText)
      throw new Error('bundle patch differs from the independent preset sources; run npm run compose');
    console.log('OK: parsed preset definitions, references and generated patch match');
  } else {
    // Observe an existing generated file before replacing it; source definitions are never written.
    try { readFileSync(project.patchPath, 'utf8'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (dirname(project.patchPath) !== dirname(fileURLToPath(new URL('../package.json', import.meta.url))))
      throw new Error('generated bundle patch must be in the package root');
    writeFileSync(project.patchPath, project.patchText, 'utf8');
    console.log(`OK: wrote ${project.manifest.dsh.bundle.patch}; parent and child sources unchanged`);
  }
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
}
