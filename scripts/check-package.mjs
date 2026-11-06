#!/usr/bin/env node
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { basename, dirname, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadProject, resolvePackagePath } from './preset-lib.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function publishedFiles(root, manifest) {
  const files = new Set(['package.json']);
  const realRoot = realpathSync(root);
  function walk(file) {
    const info = lstatSync(file);
    assert(!info.isSymbolicLink(), `distribution entry must not be a symbolic link: ${file}`);
    const rel = relative(realRoot, realpathSync(file));
    assert(rel !== '..' && !rel.startsWith(`..${sep}`), `distribution entry leaves package: ${file}`);
    if (info.isDirectory()) {
      for (const name of readdirSync(file).sort()) walk(resolve(file, name));
    } else {
      assert(info.isFile(), `distribution entry must be a regular file: ${file}`);
      files.add(relative(root, file).split(sep).join('/'));
    }
  }
  for (const entry of manifest.files) {
    assert(!/[*!?\[\]{}]/.test(entry), `use literal files or directories in files: ${entry}`);
    walk(resolvePackagePath(root, entry));
  }
  return files;
}

function tar(tarball, args) {
  // GNU tar interprets C: as a remote host; a local cwd + basename works on Windows and POSIX.
  const result = spawnSync('tar', [...args, `./${basename(tarball)}`], {
    cwd: dirname(tarball), encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error) throw new Error(`tar is required to inspect a packed archive: ${result.error.message}`);
  assert(result.status === 0, `archive inspection failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}

function readPacked(tarball, member, encoding = 'utf8') {
  const result = spawnSync('tar', ['-xOf', `./${basename(tarball)}`, member], {
    cwd: dirname(tarball), encoding, maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  assert(result.status === 0, `packed member is missing: ${member}`);
  return result.stdout;
}

export function checkPackage(root, tarball) {
  const { manifest, patchPath, patchText } = loadProject(root);
  const expected = publishedFiles(root, manifest);
  const patchRelative = relative(root, patchPath).split(sep).join('/');
  assert(expected.has(patchRelative), 'declared bundle patch is missing from files');
  assert(readFileSync(patchPath, 'utf8').replace(/\r\n/g, '\n') === patchText, 'declared bundle patch is stale');
  for (const required of ['README.md', 'CHANGELOG.md', 'LICENSE', 'docs/PUBLISHING.md',
    'icon.svg', 'locale/en.json', 'locale/zh.json', 'scripts/preset-lib.mjs', 'test/presets.test.mjs'])
    assert(expected.has(required), `required distribution resource is missing: ${required}`);
  assert(manifest.exports?.['./icon'] === './icon.svg', 'missing exported icon');
  assert(manifest.exports?.['./locale/*.json'] === './locale/*.json', 'missing exported locale resources');
  for (const language of ['en', 'zh']) {
    const resource = JSON.parse(readFileSync(resolve(root, 'locale', `${language}.json`), 'utf8'));
    for (const key of ['title', 'description'])
      assert(typeof resource.meta?.[key] === 'string' && resource.meta[key].trim(), `locale ${language} is missing meta.${key}`);
  }
  const icon = readFileSync(resolve(root, 'icon.svg'));
  assert(icon.length <= 256 * 1024 && /<svg\b/.test(icon.toString('utf8')) && /<\/svg>/.test(icon.toString('utf8')),
    'icon must be an SVG within the DSH 256 KiB limit');
  assert(manifest.scripts?.check === 'node scripts/check.mjs', 'check must use the unified verification entry');
  for (const hook of ['prepack', 'prepublishOnly'])
    assert(manifest.scripts[hook] === manifest.scripts.check, `${hook} must use the same verification gate as check`);
  const lock = JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8'));
  assert(lock.name === manifest.name && lock.version === manifest.version, 'lockfile package identity differs from manifest');
  assert(JSON.stringify(lock.packages?.['']?.devDependencies) === JSON.stringify(manifest.devDependencies),
    'lockfile development dependencies differ from manifest');
  for (const [name, version] of Object.entries(manifest.devDependencies ?? {}))
    assert(lock.packages?.[`node_modules/${name}`]?.version === version, `lockfile does not pin ${name}`);

  if (tarball) {
    const archive = resolve(root, tarball);
    const lines = tar(archive, ['-tzf']).split(/\r?\n/).filter((line) => line && !line.endsWith('/'));
    const actual = new Set();
    for (const member of lines) {
      assert(member.startsWith('package/'), `unexpected archive member: ${member}`);
      const memberPath = member.slice('package/'.length);
      resolvePackagePath(root, memberPath);
      assert(!actual.has(memberPath), `duplicate archive member: ${memberPath}`);
      actual.add(memberPath);
    }
    for (const name of expected) assert(actual.has(name), `packed archive is missing ${name}`);
    for (const name of actual) assert(expected.has(name), `unexpected packed file: ${name}`);
    const packedManifest = JSON.parse(readPacked(archive, 'package/package.json'));
    assert(packedManifest.name === manifest.name && packedManifest.version === manifest.version, 'packed identity differs from source');
    assert(packedManifest.dsh?.bundle?.patch === manifest.dsh.bundle.patch, 'packed bundle entry differs from source');
    for (const key of ['./icon', './locale/*.json'])
      assert(packedManifest.exports?.[key] === manifest.exports[key], `packed resource export differs: ${key}`);
    for (const name of expected) {
      // Package managers may normalize package.json; all other files must match byte-for-byte.
      if (name === 'package.json') continue;
      assert(readPacked(archive, `package/${name}`, null).equals(readFileSync(resolve(root, name))),
        `packed file differs from source: ${name}`);
    }
    console.log(`OK: actual packed archive verified (${actual.size} files, entry and source bytes): ${tarball}`);
  } else {
    console.log(`OK: source distribution manifest and resources verified (${expected.size} files); archive not inspected`);
  }
  return expected;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const root = fileURLToPath(new URL('../', import.meta.url));
    const args = process.argv.slice(2).filter((arg) => arg !== '--check');
    let tarball;
    if (args[0] === '--packed-dir') {
      if (!args[1]) throw new Error('--packed-dir requires a directory');
      const { manifest } = loadProject(root);
      const filename = `${manifest.name.replace(/^@/, '').replaceAll('/', '-')}-${manifest.version}.tgz`;
      tarball = resolve(args[1], filename);
    } else {
      tarball = args[0] === '--tarball' ? args[1] : args[0];
      if (args[0] === '--tarball' && !tarball) throw new Error('--tarball requires an archive path');
      if (tarball?.startsWith('--')) throw new Error(`unknown option ${tarball}`);
    }
    checkPackage(root, tarball);
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exitCode = 1;
  }
}
