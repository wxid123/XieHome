import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  PRESET_SPECS,
  composePatch,
  loadProject,
  parseMetadata,
  parsePluginList,
  resolvePackagePath,
  validateManifest,
  validatePresets,
} from '../scripts/preset-lib.mjs';

const require = createRequire(import.meta.url);
const YAML = require('yaml');
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const JS_TAG = 'tag:yaml.org,2002:js';
const CHILD = 'conductor-child';
const PARENT = 'conductor';
let cachedProject;

function project() {
  cachedProject ??= loadProject(ROOT);
  return cachedProject;
}

// All negative fixtures start with the real sources. Mutations affect the YAML
// AST, then refresh rows from that same AST: no fabricated rows/document pairs.
function fixtures() {
  return project().presets.map((preset) => {
    const document = preset.document.clone();
    return { ...preset, meta: { ...preset.meta }, document, rows: document.toJS() };
  });
}

function presetById(presets, id) {
  const preset = presets.find((entry) => entry.id === id);
  assert.ok(preset, `fixture preset ${id} exists`);
  return preset;
}

function rowNode(preset, id) {
  function find(sequence) {
    if (!YAML.isSeq(sequence)) return undefined;
    for (const row of sequence.items) {
      if (!YAML.isMap(row)) continue;
      if (row.get('id') === id) return row;
      if (row.get('group') === true) {
        const nested = find(row.get('config', true));
        if (nested) return nested;
      }
    }
    return undefined;
  }
  const row = find(preset.document.contents);
  assert.ok(row, `fixture row ${id} exists in ${preset.id}`);
  return row;
}

function sync(preset) {
  preset.rows = preset.document.toJS();
  return preset;
}

function changed(id, mutate) {
  const presets = fixtures();
  const preset = presetById(presets, id);
  mutate(preset, presets);
  sync(preset);
  return presets;
}

function allRows(rows) {
  return rows.flatMap((row) => [row, ...(row.group === true ? allRows(row.config) : [])]);
}

function rowValue(presets, presetId, rowId) {
  const row = allRows(presetById(presets, presetId).rows).find((entry) => entry.id === rowId);
  assert.ok(row, `fixture value ${presetId}/${rowId} exists`);
  return row;
}

function tagged(expression) {
  const scalar = new YAML.Scalar(expression);
  scalar.tag = JS_TAG;
  return scalar;
}

function jsExpressions(document) {
  const result = [];
  YAML.visit(document, {
    Scalar(_key, node) {
      if (node.tag === JS_TAG) result.push(node.value);
    },
  });
  return result;
}

function patchDocument(presets) {
  const document = YAML.parseDocument(composePatch(presets), {
    customTags: [{ tag: JS_TAG, resolve: (value) => value }],
  });
  assert.deepEqual(document.errors, []);
  assert.deepEqual(document.warnings, []);
  return document;
}

function declarations(presets) {
  return patchDocument(presets).toJS()[0].insert;
}

function rejectChange(id, mutate) {
  const presets = changed(id, mutate);
  assert.throws(() => validatePresets(presets));
}

function manifestFixture() {
  return structuredClone(project().manifest);
}

test('metadata: quoted strings are decoded rather than quoted twice', () => {
  assert.deepEqual(parseMetadata(`name: 'Conductor: "quoted" # title'
description: "A colon: and an escaped \\"quote\\""
order: 21.1
`, 'quoted metadata'), {
    name: 'Conductor: "quoted" # title',
    description: 'A colon: and an escaped "quote"',
    order: 21.1,
  });
});

test('metadata: literal block descriptions retain line breaks', () => {
  assert.deepEqual(parseMetadata(`name: 'Block title'
description: |
  First line: # still text
  Second line
order: 22
`), {
    name: 'Block title',
    description: 'First line: # still text\nSecond line\n',
    order: 22,
  });
});

test('metadata: folded block descriptions follow YAML semantics', () => {
  const meta = parseMetadata(`name: Folded
description: >-
  first line
  second line
order: 22.5
`);
  assert.equal(meta.description, 'first line second line');
  assert.equal(typeof meta.order, 'number');
});

for (const [label, text] of [
  ['missing name', 'description: d\norder: 1\n'],
  ['missing description', 'name: n\norder: 1\n'],
  ['missing order', 'name: n\ndescription: d\n'],
  ['non-numeric order', 'name: n\ndescription: d\norder: nope\n'],
  ['quoted numeric order', 'name: n\ndescription: d\norder: "21.1"\n'],
  ['infinite order', 'name: n\ndescription: d\norder: .inf\n'],
  ['NaN order', 'name: n\ndescription: d\norder: .nan\n'],
  ['unknown metadata field', 'name: n\ndescription: d\norder: 1\nextra: value\n'],
  ['Loader expression in metadata', 'name: !!js "\'title\'"\ndescription: d\norder: 1\n'],
  ['non-string name', 'name: [n]\ndescription: d\norder: 1\n'],
  ['non-string description', 'name: n\ndescription: {text: d}\norder: 1\n'],
  ['duplicate mapping key', 'name: n\nname: duplicate\ndescription: d\norder: 1\n'],
]) {
  test(`metadata: rejects ${label}`, () => {
    assert.throws(() => parseMetadata(text, `invalid ${label}`));
  });
}

test('metadata: parse diagnostics retain the caller-provided label', () => {
  assert.throws(() => parseMetadata('name: [unterminated', 'metadata-fixture-label'),
    /metadata-fixture-label/);
});

test('plugins: blank lines do not attach the next config to a removed row', () => {
  const { document, rows } = parsePluginList(`
# leading comment
- id: group
  name: cordis:group
  group: true
  config:
    - id: first
      name: '@deepseek-ai/dsh-tool-todo'

      config:
        allowParallelInProgress: true

    - id: second
      name: '@deepseek-ai/dsh-agent-instructions'
      config:
        maxBytes: 32768

- id: third
  name: '@deepseek-ai/dsh-persona'
  config:
    prefix: 'third row'
`);
  assert.deepEqual(rows, document.toJS());
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0].config.map((row) => row.id), ['first', 'second']);
  assert.deepEqual(rows[0].config[0].config, { allowParallelInProgress: true });
  assert.deepEqual(rows[0].config[1].config, { maxBytes: 32768 });
  assert.equal(rows[1].config.prefix, 'third row');
});

test('plugins: persona block text containing fake row markers is one scalar', () => {
  const { rows } = parsePluginList(`- id: persona
  name: '@deepseek-ai/dsh-persona'
  config:
    prefix: |
      Instructions can mention YAML examples:
      - id: tool-workflow
        name: '@deepseek-ai/dsh-tool-workflow'
      - id: persona
- id: actual-tool
  name: '@deepseek-ai/dsh-tool-todo'
`);
  assert.deepEqual(allRows(rows).map((row) => row.id), ['persona', 'actual-tool']);
  assert.match(rows[0].config.prefix, /- id: tool-workflow/);
});

for (const [label, text] of [
  ['mapping instead of entry list', 'id: wrong-root\n'],
  ['invalid YAML', '- id: [unterminated\n'],
  ['duplicate mapping key', '- id: a\n  id: b\n  name: plugin\n'],
  ['multiple YAML documents', '- id: a\n  name: plugin\n---\n- id: b\n  name: plugin\n'],
  ['unsupported !js shorthand', '- id: a\n  name: plugin\n  disabled: !js false\n'],
  ['unknown tag', '- id: a\n  name: plugin\n  disabled: !unknown false\n'],
  ['empty source', ''],
  ['scalar row', '- not-a-row\n'],
  ['missing row ID', '- name: plugin\n'],
  ['missing package name', '- id: a\n'],
  ['non-string row ID', '- id: 7\n  name: plugin\n'],
  ['non-string package name', '- id: a\n  name: 7\n'],
  ['non-list group config', '- id: g\n  name: cordis:group\n  group: true\n  config: {a: b}\n'],
  ['group using another package', '- id: g\n  name: other-package\n  group: true\n  config: []\n'],
  ['string disabled', '- id: a\n  name: plugin\n  disabled: "false"\n'],
  ['numeric disabled', '- id: a\n  name: plugin\n  disabled: 1\n'],
  ['mapping disabled', '- id: a\n  name: plugin\n  disabled: {unexpected: true}\n'],
  ['sequence disabled', '- id: a\n  name: plugin\n  disabled: [false]\n'],
  ['YAML alias', '- id: a\n  name: plugin\n  config:\n    source: &source [1]\n    copy: *source\n'],
]) {
  test(`plugins: rejects ${label}`, () => {
    assert.throws(() => parsePluginList(text, `invalid ${label}`));
  });
}

for (const disabled of ['true', 'false', 'null']) {
  test(`plugins: accepts literal disabled ${disabled}`, () => {
    const { rows } = parsePluginList(`- id: a\n  name: plugin\n  disabled: ${disabled}\n`);
    assert.equal(rows[0].disabled, JSON.parse(disabled));
  });
}

test('plugins: parse diagnostics retain the caller-provided label', () => {
  assert.throws(() => parsePluginList('- id: [unterminated', 'plugins-fixture-label'),
    /plugins-fixture-label/);
});

test('project: real sources and manifest satisfy the public validation APIs', () => {
  const { presets, manifest, patchPath, patchText } = project();
  assert.deepEqual(PRESET_SPECS.map((entry) => entry.id), [CHILD, PARENT]);
  assert.deepEqual(presets.map((entry) => entry.id), [CHILD, PARENT]);
  assert.equal(patchPath, resolvePackagePath(ROOT, manifest.dsh.bundle.patch));
  assert.ok(patchText === readFileSync(patchPath, 'utf8').replace(/\r\n/g, '\n'),
    'loadProject patchText matches the checked-in patch');
  assert.doesNotThrow(() => validateManifest(manifest));
  assert.doesNotThrow(() => validatePresets(presets));
  for (const preset of presets) assert.deepEqual(preset.rows, preset.document.toJS());
});

test('validation: independent child persona, compaction and maxBytes are accepted', () => {
  const presets = changed(CHILD, (child) => {
    rowNode(child, 'persona').setIn(['config', 'prefix'], 'An independently maintained child persona.');
    rowNode(child, 'agent-instructions').setIn(['config', 'maxBytes'], 32768);
    rowNode(child, 'tool-result-pruner').setIn(['config', 'thresholdChars'], 16384);
    rowNode(child, 'tool-result-pruner').setIn(['config', 'headChars'], 2048);
  });
  assert.doesNotThrow(() => validatePresets(presets));
  const [child, parent] = declarations(presets);
  const childRows = allRows(child.config.plugins);
  const parentRows = allRows(parent.config.plugins);
  assert.equal(childRows.find((row) => row.id === 'persona').config.prefix,
    'An independently maintained child persona.');
  assert.equal(childRows.find((row) => row.id === 'agent-instructions').config.maxBytes, 32768);
  assert.equal(childRows.find((row) => row.id === 'tool-result-pruner').config.thresholdChars, 16384);
  assert.equal(childRows.find((row) => row.id === 'tool-result-pruner').config.headChars, 2048);
  assert.notEqual(childRows.find((row) => row.id === 'persona').config.prefix,
    parentRows.find((row) => row.id === 'persona').config.prefix);
  assert.equal(rowValue(presets, PARENT, 'agent-instructions').config.maxBytes,
    rowValue(project().presets, PARENT, 'agent-instructions').config.maxBytes);
});

test('validation: blank lines and fake persona row markers do not change plugin identity', () => {
  const presets = changed(CHILD, (child) => {
    rowNode(child, 'persona').setIn(['config', 'prefix'], [
      'Literal examples, not plugin declarations:',
      '- id: tool-workflow',
      '  name: @deepseek-ai/dsh-tool-workflow',
      '- id: persona',
    ].join('\n'));
    const reparsed = parsePluginList(String(child.document).replace(/\n(?=- id:)/g, '\n\n\n'));
    child.document = reparsed.document;
  });
  assert.doesNotThrow(() => validatePresets(presets));
  assert.equal(allRows(presetById(presets, CHILD).rows).filter((row) => row.id === 'persona').length, 1);
});

test('validation: plugin IDs may repeat across distinct preset scopes', () => {
  const presets = fixtures();
  assert.ok(rowValue(presets, CHILD, 'persona'));
  assert.ok(rowValue(presets, PARENT, 'persona'));
  assert.doesNotThrow(() => validatePresets(presets));
});

test('validation: rejects duplicate IDs in one plugin list', () => {
  rejectChange(CHILD, (child) => {
    child.document.contents.add(rowNode(child, 'persona').clone());
  });
});

test('validation: rejects collisions between a top-level and nested plugin ID', () => {
  rejectChange(CHILD, (child) => {
    const collision = rowNode(child, 'tool-todo').clone();
    collision.set('id', 'persona');
    rowNode(child, 'delegation').get('config', true).add(collision);
  });
});

test('validation: rejects duplicate preset IDs', () => {
  const presets = fixtures();
  presetById(presets, CHILD).id = PARENT;
  assert.throws(() => validatePresets(presets));
});

test('validation: rejects duplicate declaration row IDs', () => {
  const presets = fixtures();
  presetById(presets, CHILD).rowId = presetById(presets, PARENT).rowId;
  assert.throws(() => validatePresets(presets));
});

for (const presetId of [PARENT, CHILD]) {
  test(`validation: rejects legacy toolFilter in ${presetId} spawn config`, () => {
    rejectChange(presetId, (preset) => {
      rowNode(preset, 'tool-subagent').setIn(['config', 'toolFilter'], ['bash']);
    });
  });
}

test('validation: rejects a missing parent spawn agentPreset', () => {
  rejectChange(PARENT, (parent) => {
    rowNode(parent, 'tool-subagent').deleteIn(['config', 'agentPreset']);
  });
});

test('validation: agentPreset on another row does not satisfy the parent spawn requirement', () => {
  rejectChange(PARENT, (parent) => {
    rowNode(parent, 'tool-subagent').deleteIn(['config', 'agentPreset']);
    rowNode(parent, 'tool-subagent-fork').setIn(['config', 'agentPreset'], CHILD);
  });
});

for (const target of [PARENT, 'missing-preset']) {
  test(`validation: rejects parent spawn pointing to ${target}`, () => {
    rejectChange(PARENT, (parent) => {
      rowNode(parent, 'tool-subagent').setIn(['config', 'agentPreset'], target);
    });
  });
}

for (const [field, value] of [['provider', 'fork'], ['toolName', 'other-tool'], ['maxDepth', 2]]) {
  test(`validation: rejects a parent spawn with incorrect ${field}`, () => {
    rejectChange(PARENT, (parent) => {
      rowNode(parent, 'tool-subagent').setIn(['config', field], value);
    });
  });
}

test('validation: rejects a disabled parent spawn row', () => {
  rejectChange(PARENT, (parent) => rowNode(parent, 'tool-subagent').set('disabled', true));
});

for (const maxDepth of [0, 2, 'provider-managed']) {
  test(`validation: rejects child spawn maxDepth ${maxDepth}`, () => {
    rejectChange(CHILD, (child) => {
      rowNode(child, 'tool-subagent').setIn(['config', 'maxDepth'], maxDepth);
    });
  });
}

test('validation: rejects child spawn self-reference', () => {
  rejectChange(CHILD, (child) => {
    rowNode(child, 'tool-subagent').setIn(['config', 'agentPreset'], CHILD);
  });
});

for (const [toolName, rowId] of [
  ['subagent_fork', 'tool-subagent-fork'],
  ['workflow', 'tool-workflow'],
  ['ralph', 'tool-ralph'],
]) {
  for (const renamed of [false, true]) {
    test(`validation: rejects child ${toolName}${renamed ? ' even with a renamed row ID' : ''}`, () => {
      rejectChange(CHILD, (child, presets) => {
        const forbidden = rowNode(presetById(presets, PARENT), rowId).clone();
        if (renamed) forbidden.set('id', `renamed-${rowId}`);
        rowNode(child, 'delegation').get('config', true).add(forbidden);
      });
    });
  }
  test(`validation: rejects forbidden toolName ${toolName} under an otherwise allowed row`, () => {
    rejectChange(CHILD, (child) => {
      rowNode(child, 'tool-subagent').setIn(['config', 'toolName'], toolName);
    });
  });
}

test('tags: existing platform and skill-directory expressions retain their AST tags', () => {
  for (const preset of project().presets) {
    assert.equal(rowNode(preset, 'tool-bash').get('disabled', true).tag, JS_TAG);
    assert.equal(rowNode(preset, 'tool-pwsh').get('disabled', true).tag, JS_TAG);
    assert.equal(rowNode(preset, 'skill-filesystem').getIn(['config', 'customSkillDirs', 0], true).tag,
      JS_TAG);
    assert.equal(jsExpressions(preset.document).length, 3);
  }
});

test('tags: parsing, validation and composition preserve !!js without executing it', () => {
  const key = '__conductorPresetTestExpressionExecuted__';
  const expression = `(() => { globalThis.${key} = true; return false; })()`;
  const configExpression = `(() => { globalThis.${key} = true; return 'persona'; })()`;
  assert.equal(Object.hasOwn(globalThis, key), false);
  try {
    const presets = changed(CHILD, (child) => {
      rowNode(child, 'tool-bash').set('disabled', tagged(expression));
      rowNode(child, 'persona').setIn(['config', 'prefix'], tagged(configExpression));
      const parsed = parsePluginList(String(child.document), 'inert-js-fixture');
      child.document = parsed.document;
    });
    assert.equal(Object.hasOwn(globalThis, key), false);
    assert.doesNotThrow(() => validatePresets(presets));
    assert.equal(Object.hasOwn(globalThis, key), false);
    const output = patchDocument(presets);
    assert.ok(jsExpressions(output).includes(expression));
    assert.ok(jsExpressions(output).includes(configExpression));
    assert.equal(Object.hasOwn(globalThis, key), false);
  } finally {
    delete globalThis[key];
  }
});

for (const field of ['id', 'name', 'group', 'isolate']) {
  test(`tags: rejects !!js in row metadata ${field}`, () => {
    rejectChange(CHILD, (child) => {
      rowNode(child, 'tool-todo').set(field, tagged('false'));
    });
  });
}

test('compose: real patch equals deterministic composition from the two sources', () => {
  const presets = fixtures();
  const before = presets.map((preset) => String(preset.document));
  const first = composePatch(presets);
  assert.equal(first, composePatch(presets));
  assert.ok(first === readFileSync(project().patchPath, 'utf8').replace(/\r\n/g, '\n'),
    'checked-in patch equals deterministic composition');
  assert.ok(first.endsWith('\n'));
  assert.deepEqual(presets.map((preset) => String(preset.document)), before);
});

test('compose: child declaration precedes the parent even with reversed input', () => {
  const rows = declarations(fixtures().reverse());
  assert.deepEqual(rows.map((row) => row.id), ['preset-conductor-child', 'preset-conductor']);
  assert.deepEqual(rows.map((row) => row.config.id), [CHILD, PARENT]);
  for (const row of rows) assert.equal(row.name, '@deepseek-ai/dsh-agent-preset');
});

test('compose: quoted and multiline metadata round-trip without literal quote pollution', () => {
  const presets = fixtures();
  const child = presetById(presets, CHILD);
  child.meta = parseMetadata(`name: 'Child: "quoted"'
description: |
  First line with a colon: value
  Second line with # text
order: 21.1
`);
  const composed = declarations(presets).find((row) => row.config.id === CHILD);
  assert.equal(composed.config.name, child.meta.name);
  assert.equal(composed.config.description, child.meta.description);
  assert.equal(composed.config.order, child.meta.order);
});

test('compose: every !!js expression survives the patch round-trip', () => {
  const presets = fixtures();
  const output = patchDocument(presets);
  assert.deepEqual(jsExpressions(output), presets.flatMap((preset) => jsExpressions(preset.document)));
  for (const [index, preset] of presets.entries()) {
    const pluginNode = output.getIn([0, 'insert', index, 'config', 'plugins'], true);
    const pluginDocument = new YAML.Document(undefined, {
      customTags: [{ tag: JS_TAG, resolve: (value) => value }],
    });
    pluginDocument.contents = pluginNode.clone();
    const roundTrip = parsePluginList(pluginDocument.toString(), `composed ${preset.id}`);
    assert.deepEqual(roundTrip.rows, preset.rows);
  }
});

test('manifest: real declaration validates', () => {
  assert.doesNotThrow(() => validateManifest(manifestFixture()));
});

for (const [label, mutate] of [
  ['missing name', (manifest) => { delete manifest.name; }],
  ['empty name', (manifest) => { manifest.name = ' '; }],
  ['invalid version', (manifest) => { manifest.version = 'not-semver'; }],
  ['missing files whitelist', (manifest) => { delete manifest.files; }],
  ['non-array files whitelist', (manifest) => { manifest.files = 'cordis.patch.yml'; }],
  ['non-string files whitelist item', (manifest) => { manifest.files = ['cordis.patch.yml', 1]; }],
  ['missing bundle declaration', (manifest) => { delete manifest.dsh.bundle; }],
  ['missing patch entry', (manifest) => { delete manifest.dsh.bundle.patch; }],
  ['non-string patch entry', (manifest) => { manifest.dsh.bundle.patch = 123; }],
  ['empty patch entry', (manifest) => { manifest.dsh.bundle.patch = ''; }],
  ['escaping patch entry', (manifest) => { manifest.dsh.bundle.patch = '../outside.patch.yml'; }],
]) {
  test(`manifest: rejects ${label}`, () => {
    const manifest = manifestFixture();
    mutate(manifest);
    assert.throws(() => validateManifest(manifest));
  });
}

for (const relative of ['cordis.patch.yml', './cordis.patch.yml', 'presets/conductor/preset.yml']) {
  test(`package paths: resolves in-package entry ${relative}`, () => {
    assert.equal(resolvePackagePath(ROOT, relative), resolve(ROOT, relative));
  });
}

for (const relative of [
  '', '..', '../outside.yml', '../../outside.yml', '..\\outside.yml',
  '/outside.yml', 'C:/outside.yml', 'C:\\outside.yml', 'C:outside.yml',
  '//server/share/outside.yml', '\\\\server\\share\\outside.yml',
  'https://example.invalid/outside.yml', 'file:///outside.yml',
]) {
  test(`package paths: rejects escape or absolute entry ${JSON.stringify(relative)}`, () => {
    assert.throws(() => resolvePackagePath(ROOT, relative));
  });
}

for (const script of ['scripts/compose-bundle-patch.mjs', 'scripts/check-package.mjs']) {
  test(`CLI: ${script} --check succeeds without rewriting project inputs`, () => {
    const paths = [
      'package.json', 'cordis.patch.yml',
      'presets/conductor/preset.yml', 'presets/conductor/agent.cordis.yml',
      'presets/conductor-child/preset.yml', 'presets/conductor-child/agent.cordis.yml',
    ];
    const snapshot = () => paths.map((path) => {
      const absolute = resolve(ROOT, path);
      return { path, text: readFileSync(absolute, 'utf8'), mtimeMs: statSync(absolute).mtimeMs };
    });
    const before = snapshot();
    const result = spawnSync(process.execPath, [resolve(ROOT, script), '--check'], {
      cwd: ROOT,
      env: process.env,
      encoding: 'utf8',
      timeout: 30_000,
      windowsHide: true,
    });
    assert.deepEqual(snapshot(), before);
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.signal, null);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  });
}
