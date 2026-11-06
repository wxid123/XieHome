import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { isAbsolute, relative, resolve, win32 } from 'node:path';

const require = createRequire(import.meta.url);
export const YAML = require('yaml');
const JS_TAG = 'tag:yaml.org,2002:js';
const YAML_OPTIONS = {
  customTags: [{ tag: JS_TAG, resolve: (value) => value }],
  uniqueKeys: true,
  strict: true,
};

// Stable identities; declarations are emitted dependency-first, not by display order.
export const PRESET_SPECS = Object.freeze([
  Object.freeze({ dir: 'conductor-child', id: 'conductor-child', rowId: 'preset-conductor-child' }),
  Object.freeze({ dir: 'conductor', id: 'conductor', rowId: 'preset-conductor' }),
]);
const FORBIDDEN_CHILD_TOOLS = new Set(['subagent_fork', 'workflow', 'ralph']);
const FORBIDDEN_CHILD_PACKAGES = new Set([
  '@deepseek-ai/dsh-tool-workflow',
  '@deepseek-ai/dsh-tool-ralph',
]);
const FORBIDDEN_CHILD_ROWS = new Set(['tool-subagent-fork', 'tool-workflow', 'tool-ralph']);

function fail(label, message) {
  throw new Error(`${label}: ${message}`);
}

function parseDocument(text, label) {
  if (typeof text !== 'string') fail(label, 'expected YAML text');
  const document = YAML.parseDocument(text.replace(/\r\n/g, '\n'), YAML_OPTIONS);
  const diagnostics = [...document.errors, ...document.warnings];
  if (diagnostics.length) fail(label, diagnostics.map((item) => item.message).join('\n'));
  // Aliases are deliberately excluded from this self-contained bundle format.
  checkTags(document.contents, label, true);
  document.toJS({ maxAliasCount: 0 });
  return document;
}

function checkTags(node, label, allowJs) {
  if (!node) return;
  if (YAML.isAlias(node)) fail(label, 'YAML aliases are not supported');
  if (node.tag === JS_TAG && !allowJs) fail(label, '!!js is allowed only in plugin config or disabled');
  if (YAML.isMap(node)) {
    for (const pair of node.items) {
      if (!YAML.isScalar(pair.key) || typeof pair.key.value !== 'string')
        fail(label, 'mapping keys must be literal strings');
      checkTags(pair.key, label, false);
      checkTags(pair.value, label, allowJs);
    }
  } else if (YAML.isSeq(node)) {
    for (const item of node.items) checkTags(item, label, allowJs);
  }
}

export function parseMetadata(text, label = '<metadata>') {
  const document = parseDocument(text, label);
  checkTags(document.contents, label, false);
  if (!YAML.isMap(document.contents)) fail(label, 'metadata must be a mapping');
  const meta = document.toJS({ maxAliasCount: 0 });
  for (const key of Object.keys(meta))
    if (!['name', 'description', 'order'].includes(key)) fail(label, `unknown metadata field ${key}`);
  for (const key of ['name', 'description'])
    if (typeof meta[key] !== 'string' || !meta[key].trim()) fail(label, `${key} must be a non-empty string`);
  if (typeof meta.order !== 'number' || !Number.isFinite(meta.order)) fail(label, 'order must be a finite number');
  return meta;
}

function inspectRows(node, label, ids = new Set()) {
  if (!YAML.isSeq(node)) fail(label, 'plugins must be a YAML sequence');
  const flattened = [];
  for (const rowNode of node.items) {
    if (!YAML.isMap(rowNode)) fail(label, 'every plugin row must be a mapping');
    for (const pair of rowNode.items) {
      const key = pair.key?.value;
      if (typeof key !== 'string') fail(label, 'plugin fields must have literal string keys');
      checkTags(pair.key, label, false);
      if (key !== 'config' && key !== 'disabled') checkTags(pair.value, label, false);
    }
    const row = rowNode.toJSON();
    if (typeof row.id !== 'string' || !row.id.trim()) fail(label, 'plugin row requires a literal id');
    if (typeof row.name !== 'string' || !row.name.trim()) fail(label, `${row.id} requires a literal package name`);
    if (ids.has(row.id)) fail(label, `duplicate plugin id ${row.id}`);
    ids.add(row.id);
    const disabled = rowNode.get('disabled', true);
    if (disabled && disabled.tag !== JS_TAG &&
        (!YAML.isScalar(disabled) || (disabled.value != null && typeof disabled.value !== 'boolean')))
      fail(label, `${row.id}.disabled must be boolean, null or !!js`);
    flattened.push(row);
    if (row.group === true) {
      if (row.name !== 'cordis:group') fail(label, `${row.id}: group rows must use cordis:group`);
      flattened.push(...inspectRows(rowNode.get('config', true), `${label}/${row.id}`, ids));
    } else {
      checkTags(rowNode.get('config', true), `${label}/${row.id}`, true);
      if (row.config && Object.hasOwn(row.config, 'toolFilter'))
        fail(label, `${row.id}: legacy toolFilter is not supported; use an explicit child preset`);
    }
  }
  return flattened;
}

export function parsePluginList(text, label = '<plugins>') {
  const document = parseDocument(text, label);
  inspectRows(document.contents, label);
  return { document, rows: document.toJS({ maxAliasCount: 0 }) };
}

function presetRows(preset) {
  if (!preset.document?.contents) fail(preset.id, 'missing parsed plugin document');
  return inspectRows(preset.document.contents, preset.id);
}

function references(preset) {
  return presetRows(preset)
    .filter((row) => row.disabled !== true && typeof row.config?.agentPreset === 'string')
    .map((row) => row.config.agentPreset);
}

function dependencyOrder(presets) {
  const byId = new Map(presets.map((preset) => [preset.id, preset]));
  const visiting = new Set();
  const done = new Set();
  const ordered = [];
  function visit(preset) {
    if (visiting.has(preset.id)) fail(preset.id, 'cyclic agentPreset reference');
    if (done.has(preset.id)) return;
    visiting.add(preset.id);
    for (const target of references(preset)) {
      if (!byId.has(target)) fail(preset.id, `agentPreset references missing preset ${target}`);
      visit(byId.get(target));
    }
    visiting.delete(preset.id);
    done.add(preset.id);
    ordered.push(preset);
  }
  for (const preset of presets) visit(preset);
  return ordered;
}

export function validatePresets(presets) {
  if (!Array.isArray(presets) || presets.length !== PRESET_SPECS.length)
    fail('presets', 'expected conductor and conductor-child definitions');
  const ids = new Set();
  const rowIds = new Set();
  for (const preset of presets) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(preset.id ?? '')) fail('presets', 'invalid preset id');
    if (ids.has(preset.id)) fail('presets', `duplicate preset id ${preset.id}`);
    if (typeof preset.rowId !== 'string' || !preset.rowId || rowIds.has(preset.rowId))
      fail('presets', `invalid or duplicate declaration id ${preset.rowId}`);
    ids.add(preset.id);
    rowIds.add(preset.rowId);
    parseMetadata(YAML.stringify(preset.meta), `${preset.id}/metadata`);
    presetRows(preset);
  }
  const parent = presets.find((preset) => preset.id === 'conductor');
  const child = presets.find((preset) => preset.id === 'conductor-child');
  if (!parent || !child) fail('presets', 'expected conductor and conductor-child definitions');
  const spawn = presetRows(parent).find((row) => row.id === 'tool-subagent');
  if (!spawn || spawn.name !== '@deepseek-ai/dsh-tool-subagent' || spawn.disabled === true ||
      spawn.config?.provider !== 'spawn' || spawn.config?.toolName !== 'subagent' ||
      spawn.config?.agentPreset !== child.id || spawn.config?.maxDepth !== 1)
    fail(parent.id, 'tool-subagent spawn must select conductor-child with maxDepth: 1');
  for (const row of presetRows(child)) {
    if (FORBIDDEN_CHILD_ROWS.has(row.id) || FORBIDDEN_CHILD_PACKAGES.has(row.name) ||
        FORBIDDEN_CHILD_TOOLS.has(row.config?.toolName) ||
        (row.name === '@deepseek-ai/dsh-tool-subagent' && row.config?.provider === 'fork'))
      fail(child.id, `forbidden child delegation tool ${row.id}`);
    if (row.name === '@deepseek-ai/dsh-tool-subagent' && row.config?.provider === 'spawn') {
      if (row.config?.agentPreset != null || row.config?.maxDepth !== 1)
        fail(child.id, 'child spawn must inherit its preset and retain maxDepth: 1');
    }
  }
  dependencyOrder(presets);
}

export function composePatch(presets) {
  validatePresets(presets);
  const rows = dependencyOrder(presets).map((preset) => ({
    id: preset.rowId,
    name: '@deepseek-ai/dsh-agent-preset',
    config: { id: preset.id, ...preset.meta, plugins: preset.document.contents.clone() },
  }));
  const output = new YAML.Document([{ insert: rows }], YAML_OPTIONS);
  output.commentBefore = [
    ' dsh-preset-conductor — generated bundle patch; edit presets/, not this file.',
    ' conductor and conductor-child are independently maintained source definitions.',
    ' Child declarations precede parents. Loader expressions are preserved, never evaluated here.',
    ' Rebuild: npm run compose; verify: npm run check.',
  ].join('\n');
  return output.toString({ lineWidth: 0 });
}

export function resolvePackagePath(root, value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('\0') ||
      isAbsolute(value) || win32.isAbsolute(value) || /^[a-z][a-z\d+.-]*:/i.test(value) || value.split('/').includes('..'))
    fail('package', `expected an in-package relative path: ${String(value)}`);
  const absolute = resolve(root, value);
  const rel = relative(resolve(root), absolute);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) fail('package', `path escapes package: ${value}`);
  return absolute;
}

export function validateManifest(manifest) {
  if (!manifest || typeof manifest.name !== 'string' || !manifest.name.trim()) fail('manifest', 'missing package name');
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(manifest.version ?? ''))
    fail('manifest', 'version must be a semantic version');
  const patch = manifest.dsh?.bundle?.patch;
  if (typeof patch !== 'string' || !patch.trim()) fail('manifest', 'missing dsh.bundle.patch');
  resolvePackagePath('/package-root', patch);
  if (!Array.isArray(manifest.files) || !manifest.files.every((item) => typeof item === 'string'))
    fail('manifest', 'files must be a string array');
  return manifest;
}

export function loadProject(root) {
  const manifest = validateManifest(JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')));
  const presets = PRESET_SPECS.map((spec) => {
    const directory = resolve(root, 'presets', spec.dir);
    const meta = parseMetadata(readFileSync(resolve(directory, 'preset.yml'), 'utf8'), `${spec.id}/preset.yml`);
    const plugins = parsePluginList(readFileSync(resolve(directory, 'agent.cordis.yml'), 'utf8'), `${spec.id}/agent.cordis.yml`);
    return { ...spec, meta, ...plugins };
  });
  return {
    manifest,
    presets,
    patchPath: resolvePackagePath(root, manifest.dsh.bundle.patch),
    patchText: composePatch(presets),
  };
}
