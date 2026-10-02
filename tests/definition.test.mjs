import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { DefinitionError, definitionFiles, definitionSchema, validateDefinition } from '../factory/definition.mjs';
import { exportKit } from '../scripts/export-kit.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const yaml = `schemaVersion: factory/v1alpha1
name: example
project:
  vision: briefs/VISION.md
  instructions: instructions.md
harness: codex
method:
  skills:
    - skills/review
`;
function fixture(t) {
  const base = mkdtempSync(join(tmpdir(), 'factory-definition-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const repo = join(base, 'repo'), file = join(base, 'config/factory.yaml'), output = join(base, 'kit');
  const write = (path, bytes) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, bytes); };
  const put = (path, bytes) => write(join(repo, path), bytes);
  put('briefs/VISION.md', '# Approved brief\n');
  put('instructions.md', '# Project instructions\n');
  put('skills/review/SKILL.md', '# Review\n');
  put('skills/review/assets/reference.bin', Buffer.from([0, 255, 128, 1]));
  put('unrelated.txt', 'Untouched\n');
  write(file, yaml);
  return { base, repo, file, output, put, set: bytes => write(file, bytes), validate: () => validateDefinition({ file, repo }) };
}
function invalid(f, code) {
  assert.throws(f.validate, error => {
    assert.ok(error instanceof DefinitionError);
    const located = error.result.errors[0];
    assert.equal(located.code, code);
    assert.equal(located.file, f.file);
    assert.ok(located.line >= 1 && located.column >= 1);
    return true;
  });
  assert.equal(existsSync(f.output), false);
}

test('explicit repo rooting, raw byte digests, bounded snapshots and unqualified desired state', t => {
  const f = fixture(t), result = f.validate();
  assert.equal(result.valid, true);
  assert.equal(result.schemaVersion, 'factory/v1alpha1');
  assert.equal(result.definitionDigest, digest(readFileSync(f.file)));
  assert.equal(result.execution.qualified, false);
  assert.match(result.execution.reason, /native setup/);
  assert.ok(!JSON.stringify(result).includes(f.base), 'projection excludes host paths and bytes');
  assert.equal(result.references.length, 4);
  for (const ref of result.references) {
    const bytes = readFileSync(join(f.repo, ref.path));
    assert.equal(ref.sha256, digest(bytes)); assert.equal(ref.bytes, bytes.length);
  }
  assert.throws(() => { result.definition.harness = 'claude'; }, TypeError);
  const copied = definitionFiles(result);
  copied.get('project/instructions.md').fill(0);
  assert.equal(definitionFiles(result).get('project/instructions.md').toString(), '# Project instructions\n');
  f.set(`# Comment changes the desired digest\n${yaml}`);
  const changed = f.validate();
  assert.notEqual(changed.definitionDigest, result.definitionDigest);
  assert.notEqual(changed.snapshotDigest, result.snapshotDigest);
  assert.deepEqual(changed.definition, result.definition);
});

test('all syntax errors are rejected before recovered YAML can become desired data', async t => {
  const cases = [
    ['duplicate', `${yaml}name: replacement\n`, 'YAML_DUPLICATE_KEY'],
    ['nested duplicate', yaml.replace('  vision:', '  instructions: other.md\n  vision:'), 'YAML_DUPLICATE_KEY'],
    ['malformed', yaml.replace('name: example', 'name: [broken'), 'YAML_BAD_INDENT'],
    ['documents', `${yaml}---\n${yaml}`, 'YAML_DOCUMENTS'],
    ['empty document', '# only comment\n', 'YAML_DOCUMENTS'],
    ['tag', yaml.replace('name: example', 'name: !!str example'), 'YAML_TAG'],
    ['executable tag', yaml.replace('name: example', 'name: !<tag:yaml.org,2002:js/function> example'), 'YAML_TAG_RESOLVE_FAILED'],
    ['anchor', yaml.replace('name: example', 'name: &shared example'), 'YAML_ALIAS'],
    ['alias', yaml.replace('name: example', 'name: &shared example').replace('harness: codex', 'harness: *shared'), 'YAML_ALIAS'],
    ['directive', `%YAML 1.2\n---\n${yaml}`, 'YAML_DIRECTIVE'],
    ['tag directive', `%TAG ! tag:custom:\n---\n${yaml}`, 'YAML_DIRECTIVE'],
    ['redundant tag directive', `%TAG !! tag:yaml.org,2002:\n---\n${yaml}`, 'YAML_DIRECTIVE'],
    ['deep input', `${yaml}extra: ${'['.repeat(20)}0${']'.repeat(20)}\n`, 'DEPTH_LIMIT'],
  ];
  for (const [name, source, code] of cases) await t.test(name, t => { const f = fixture(t); f.set(source); invalid(f, code); });
});

test('strict supported fields, versions and desired harness; no role/model/security DSL', async t => {
  const cases = [
    ['version', yaml.replace('factory/v1alpha1', 'factory/v999'), 'SCHEMA_VERSION'],
    ['root key', `${yaml}model: anything\n`, 'UNKNOWN_FIELD'],
    ['project key', yaml.replace('  vision:', '  remote: https://example.invalid/project\n  vision:'), 'UNKNOWN_FIELD'],
    ['method key', `${yaml}  roles: []\n`, 'UNKNOWN_FIELD'],
    ['harness', yaml.replace('harness: codex', 'harness: claude'), 'UNQUALIFIED_HARNESS'],
    ['missing', yaml.replace('name: example\n', ''), 'MISSING_FIELD'],
    ['null mapping', yaml.replace(/project:[\s\S]*?harness:/, 'project: null\nharness:'), 'FIELD_TYPE'],
    ['numeric name', yaml.replace('name: example', 'name: 123'), 'FIELD_VALUE'],
    ['empty name', yaml.replace('name: example', 'name: ""'), 'FIELD_VALUE'],
    ['invalid name', yaml.replace('name: example', 'name: "${ENV}"'), 'FIELD_VALUE'],
    ['newline name', yaml.replace('name: example', 'name: "example\\n"'), 'FIELD_VALUE'],
    ['long name', yaml.replace('name: example', `name: ${'x'.repeat(81)}`), 'FIELD_VALUE'],
    ['skills empty', yaml.replace('skills:\n    - skills/review', 'skills: []'), 'FIELD_TYPE'],
    ['skills scalar', yaml.replace('skills:\n    - skills/review', 'skills: skills/review'), 'FIELD_TYPE'],
    ['too many skills', yaml.replace('    - skills/review', Array(17).fill('    - skills/review').join('\n')), 'FIELD_TYPE'],
    ['duplicate skills', `${yaml}    - skills/review\n`, 'SKILL_OVERLAP'],
    ['overlap', `${yaml}    - skills/review/assets\n`, 'SKILL_OVERLAP'],
    ['complex key', `${yaml}? [a, b]\n: ignored\n`, 'UNKNOWN_FIELD'],
  ];
  for (const [name, source, code] of cases) await t.test(name, t => { const f = fixture(t); f.set(source); invalid(f, code); });
});

test('portable local paths refuse traversal, URLs, interpolation, absolute and private paths', async t => {
  for (const path of ['../brief.md', 'briefs/../VISION.md', '/absolute.md', 'C:/brief.md', 'briefs\\VISION.md', './instructions.md', 'a//b.md', 'https://example.invalid/a.md', '${HOME}/brief.md', '.git/config.md', '.codex/instructions.md', '.factory/native.json', 'native.json', 'auth.json', 'factory.yaml/brief.md', 'instructions.md\n']) {
    await t.test(JSON.stringify(path), t => {
      const f = fixture(t); f.set(yaml.replace('briefs/VISION.md', JSON.stringify(path))); invalid(f, 'FIELD_VALUE');
    });
  }
});

test('missing, empty, nonfile and malformed UTF-8 input/reference failures', async t => {
  const cases = [
    ['empty YAML', f => f.set(''), 'EMPTY_FILE'],
    ['malformed UTF8 YAML', f => f.set(Buffer.from([0xc3, 0x28])), 'UTF8'],
    ['missing YAML', f => rmSync(f.file), 'READ_FILE'],
    ['YAML directory', f => { rmSync(f.file); mkdirSync(f.file); }, 'REFERENCE_TYPE'],
    ['YAML symlink', f => { rmSync(f.file); symlinkSync(join(f.repo, 'instructions.md'), f.file); }, 'REFERENCE_TYPE'],
    ['missing brief', f => rmSync(join(f.repo, 'briefs/VISION.md')), 'REFERENCE_MISSING'],
    ['empty brief', f => f.put('briefs/VISION.md', ''), 'EMPTY_FILE'],
    ['whitespace brief', f => f.put('briefs/VISION.md', ' \n'), 'EMPTY_FILE'],
    ['malformed UTF8 instructions', f => f.put('instructions.md', Buffer.from([0xff])), 'UTF8'],
    ['non Markdown', f => f.set(yaml.replace('instructions.md', 'unrelated.txt')), 'REFERENCE_TYPE'],
    ['brief directory', f => { rmSync(join(f.repo, 'briefs/VISION.md')); mkdirSync(join(f.repo, 'briefs/VISION.md')); }, 'REFERENCE_TYPE'],
    ['missing SKILL', f => rmSync(join(f.repo, 'skills/review/SKILL.md')), 'REFERENCE_MISSING'],
    ['empty SKILL', f => f.put('skills/review/SKILL.md', ''), 'EMPTY_FILE'],
    ['malformed UTF8 SKILL', f => f.put('skills/review/SKILL.md', Buffer.from([0xff])), 'UTF8'],
    ['malformed UTF8 supporting Markdown', f => f.put('skills/review/assets/notes.md', Buffer.from([0xff])), 'UTF8'],
    ['empty supporting file', f => f.put('skills/review/assets/empty.bin', ''), 'EMPTY_FILE'],
    ['hidden private support', f => f.put('skills/review/.codex/auth.json', '{}'), 'REFERENCE_PATH'],
    ['private support', f => f.put('skills/review/native.json', '{}'), 'REFERENCE_PATH'],
    ['source contributor copy', f => f.put('instructions.md', readFileSync(join(root, 'AGENTS.md'))), 'SOURCE_ONLY'],
  ];
  for (const [name, alter, code] of cases) await t.test(name, t => { const f = fixture(t); alter(f); invalid(f, code); });
  await t.test('missing repo', t => { const f = fixture(t); assert.throws(() => validateDefinition({ file: f.file, repo: join(f.base, 'missing') }), /existing project directory/); });
});

test('symlinks at leaf, ancestor and supporting-file boundaries are refused', async t => {
  for (const mode of ['absolute leaf', 'relative escape', 'internal leaf', 'ancestor', 'skill directory', 'supporting file']) {
    await t.test(mode, t => {
      const f = fixture(t);
      writeFileSync(join(f.base, 'outside.md'), '# Outside\n');
      if (mode.includes('leaf') || mode === 'relative escape') {
        rmSync(join(f.repo, 'instructions.md'));
        symlinkSync(mode === 'absolute leaf' ? join(f.base, 'outside.md') : mode === 'relative escape' ? '../outside.md' : 'briefs/VISION.md', join(f.repo, 'instructions.md'));
      } else if (mode === 'ancestor') {
        rmSync(join(f.repo, 'briefs'), { recursive: true });
        symlinkSync(f.base, join(f.repo, 'briefs'));
      } else if (mode === 'skill directory') {
        rmSync(join(f.repo, 'skills/review'), { recursive: true });
        symlinkSync(f.base, join(f.repo, 'skills/review'));
      } else symlinkSync(join(f.base, 'outside.md'), join(f.repo, 'skills/review/assets/link.md'));
      invalid(f, 'SYMLINK');
    });
  }
});

test('YAML, selected bytes/files, directory-entry and directory-depth limits are enforced', async t => {
  const limits = definitionSchema['x-factory-limits'];
  const cases = [
    ['YAML size', f => f.set(`${yaml}#${'x'.repeat(limits.definitionBytes)}`), 'SIZE_LIMIT'],
    ['file size', f => f.put('skills/review/assets/large', Buffer.alloc(limits.fileBytes + 1, 65)), 'SIZE_LIMIT'],
    ['aggregate bytes', f => { for (let i = 0; i < 8; i++) f.put(`skills/review/assets/large-${i}`, Buffer.alloc(limits.fileBytes, 65)); }, 'SELECTION_LIMIT'],
    ['file count', f => { for (let i = 0; i < limits.selectedFiles; i++) f.put(`skills/review/assets/f-${i}`, 'x'); }, 'SELECTION_LIMIT'],
    ['entry count', f => { for (let i = 0; i < limits.selectedEntries; i++) mkdirSync(join(f.repo, `skills/review/d-${i}`)); }, 'SELECTION_LIMIT'],
    ['directory depth', f => f.put(`skills/review/${'d/'.repeat(18)}resource`, 'x'), 'DEPTH_LIMIT'],
  ];
  for (const [name, alter, code] of cases) await t.test(name, t => { const f = fixture(t); alter(f); invalid(f, code); });
});

test('adversarial changes after validation cannot create a partially staged kit', async t => {
  const cases = [
    ['definition', f => f.set(yaml.replace('name: example', 'name: changed'))],
    ['brief same byte length', f => f.put('briefs/VISION.md', '# Modified brief\n')],
    ['binary', f => f.put('skills/review/assets/reference.bin', Buffer.from([1, 255, 128, 1]))],
    ['new support', f => f.put('skills/review/assets/new.bin', 'added')],
    ['removed support', f => rmSync(join(f.repo, 'skills/review/assets/reference.bin'))],
    ['escaping replacement', f => { rmSync(join(f.repo, 'instructions.md')); symlinkSync('../config/factory.yaml', join(f.repo, 'instructions.md')); }],
    ['invalid replacement', f => f.set(`${yaml}name: duplicate\n`)],
  ];
  for (const [name, alter] of cases) await t.test(name, async t => {
    const f = fixture(t), snapshot = f.validate();
    alter(f);
    await assert.rejects(exportKit({ output: f.output, definition: snapshot }), error => error.result?.errors[0]?.code === 'INPUT_CHANGED');
    assert.equal(existsSync(f.output), false);
  });
});

test('selected kit is coherent, byte preserving and fresh-only; project/private files stay unchanged', async t => {
  const f = fixture(t);
  const outside = join(f.base, 'native.json'); writeFileSync(outside, '{"private":"unchanged"}');
  const snapshot = f.validate();
  const result = await exportKit({ output: f.output, definition: snapshot });
  assert.equal(result.definition.snapshotDigest, snapshot.snapshotDigest);
  const manifest = JSON.parse(readFileSync(join(f.output, '.factory-kit/manifest.json'), 'utf8'));
  assert.deepEqual(manifest.definition, snapshot);
  for (const ref of snapshot.references) assert.deepEqual(readFileSync(join(f.output, 'project', ref.path)), readFileSync(join(f.repo, ref.path)));
  for (const item of manifest.files) assert.equal(digest(readFileSync(join(f.output, item.path))), item.sha256);
  const staged = validateDefinition({ file: join(f.output, 'project/factory.yaml'), repo: join(f.output, 'project') });
  assert.deepEqual(staged, snapshot);
  for (const path of ['AGENTS.md', 'VISION.md', '.agents', '.github', 'project/unrelated.txt', 'native.json'])
    assert.equal(existsSync(join(f.output, path)), false, path);
  assert.equal(readFileSync(outside, 'utf8'), '{"private":"unchanged"}');
  assert.equal(readFileSync(join(f.repo, 'unrelated.txt'), 'utf8'), 'Untouched\n');
  const before = readFileSync(join(f.output, '.factory-kit/manifest.json'));
  await assert.rejects(exportKit({ output: f.output, definition: f.validate() }), /EEXIST/);
  assert.deepEqual(readFileSync(join(f.output, '.factory-kit/manifest.json')), before);
  const app = f.repo;
  await assert.rejects(exportKit({ output: app, definition: f.validate() }), /EEXIST/);
  assert.equal(readFileSync(join(app, 'instructions.md'), 'utf8'), '# Project instructions\n');
  assert.equal(existsSync(join(app, '.factory-kit')), false);
});

test('existing file and symlink destinations are refused unchanged', async t => {
  const f = fixture(t), snapshot = f.validate();
  writeFileSync(f.output, 'existing');
  await assert.rejects(exportKit({ output: f.output, definition: snapshot }), /EEXIST/);
  assert.equal(readFileSync(f.output, 'utf8'), 'existing');
  rmSync(f.output); symlinkSync(f.repo, f.output);
  await assert.rejects(exportKit({ output: f.output, definition: snapshot }), /EEXIST/);
  assert.equal(readFileSync(join(f.repo, 'instructions.md'), 'utf8'), '# Project instructions\n');
});

test('write failure removes only the newly created kit, preserving source and siblings', async t => {
  const f = fixture(t), snapshot = f.validate();
  const sibling = join(f.base, 'keep'); mkdirSync(sibling); writeFileSync(join(sibling, 'file'), 'keep');
  const original = fs.writeFileSync;
  let wrote = 0;
  fs.writeFileSync = (path, ...args) => {
    if (String(path).startsWith(`${f.output}/`) && ++wrote === 3) throw new Error('Injected staging write failure');
    return original(path, ...args);
  };
  syncBuiltinESMExports();
  try { await assert.rejects(exportKit({ output: f.output, definition: snapshot }), /Injected staging write failure/); }
  finally { fs.writeFileSync = original; syncBuiltinESMExports(); }
  assert.equal(wrote, 3);
  assert.equal(existsSync(f.output), false);
  assert.equal(readFileSync(join(sibling, 'file'), 'utf8'), 'keep');
  assert.equal(readFileSync(join(f.repo, 'instructions.md'), 'utf8'), '# Project instructions\n');
});

test('default kit still exports the six-skill method and existing phase assets without a definition', async t => {
  const f = fixture(t);
  await exportKit({ output: f.output });
  assert.equal(readdirSync(join(f.output, '.agents/skills')).length, 6);
  assert.ok(existsSync(join(f.output, '.factory-kit/lifecycle.json')));
  assert.ok(existsSync(join(f.output, '.github/ISSUE_TEMPLATE/factory-task.yml')));
  assert.equal(existsSync(join(f.output, 'project')), false);
  assert.equal(existsSync(join(f.output, 'AGENTS.md')), false);
  const manifest = JSON.parse(readFileSync(join(f.output, '.factory-kit/manifest.json'), 'utf8'));
  assert.equal(Object.hasOwn(manifest, 'definition'), false);
  for (const item of manifest.files) assert.equal(digest(readFileSync(join(f.output, item.path))), item.sha256);
});

test('packaged schema and software/content/design examples use the supported contract', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.ok(pkg.files.includes('factory/') && pkg.files.includes('adlc/') && pkg.files.includes('docs/'));
  assert.equal(definitionSchema.additionalProperties, false);
  assert.equal(definitionSchema.properties.project.additionalProperties, false);
  assert.equal(definitionSchema.properties.method.additionalProperties, false);
  for (const name of ['software', 'content', 'design']) {
    const result = validateDefinition({ file: join(root, `adlc/examples/definitions/${name}/factory.yaml`), repo: root });
    assert.deepEqual(Object.keys(result.definition).sort(), definitionSchema.required.slice().sort());
    assert.equal(result.definition.schemaVersion, definitionSchema.properties.schemaVersion.const);
    assert.equal(result.definition.harness, definitionSchema.properties.harness.const);
    assert.equal(result.execution.qualified, false);
    assert.equal(result.definition.method.skills.length, 3);
    assert.ok(result.references.every(ref => !ref.path.startsWith('.agents/') && ref.path !== 'AGENTS.md'));
  }
});
