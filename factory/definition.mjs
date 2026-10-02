import { createHash } from 'node:crypto';
import { constants, openSync, closeSync, fstatSync, lstatSync, readSync, readFileSync, realpathSync, opendirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { TextDecoder } from 'node:util';
import { isAlias, isMap, isSeq, LineCounter, parseAllDocuments } from 'yaml';

// One owner for the supported shape and limits; the packaged schema is data,
// not a schema engine. Filesystem and YAML checks add the non-JSON constraints.
export const definitionSchema = freeze(JSON.parse(readFileSync(new URL('./definition.schema.json', import.meta.url), 'utf8')));
const limits = definitionSchema['x-factory-limits'];
const snapshots = new WeakMap();
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const contributorHash = hash(readFileSync(new URL('../AGENTS.md', import.meta.url)));

export class DefinitionError extends Error {
  constructor(code, message, file, line = 1, column = 1) {
    super(`${file}:${line}:${column}: ${message}`);
    this.result = { valid: false, errors: [{ code, message, file, line, column }] };
  }
}
function fail(code, message, file, location) {
  throw new DefinitionError(code, message, file, location?.line, location?.col);
}
function utf8(bytes, file, location) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { fail('UTF8', 'Expected valid UTF-8.', file, location); }
}
function identity(a, b) { return a.dev === b.dev && a.ino === b.ino; }
function readRegular(path, maxBytes, file, location, expected) {
  let fd;
  try {
    const before = expected || lstatSync(path);
    if (!before.isFile() || before.isSymbolicLink()) fail('REFERENCE_TYPE', 'Expected a regular file without symlinks.', file, location);
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (!stat.isFile() || !identity(before, stat)) fail('INPUT_CHANGED', 'File changed while being read.', file, location);
    if (stat.size < 1) fail('EMPTY_FILE', 'Selected files must be nonempty.', file, location);
    if (stat.size > maxBytes) fail('SIZE_LIMIT', `File exceeds ${maxBytes} bytes.`, file, location);
    const bytes = Buffer.alloc(stat.size + 1);
    let length = 0, count;
    while (length < bytes.length && (count = readSync(fd, bytes, length, bytes.length - length, null)) > 0) length += count;
    const after = fstatSync(fd);
    if (length !== stat.size || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs)
      fail('INPUT_CHANGED', 'File changed while being read.', file, location);
    return bytes.subarray(0, length);
  } catch (error) {
    if (error instanceof DefinitionError) throw error;
    fail('READ_FILE', 'Cannot read the selected regular file.', file, location);
  } finally { if (fd !== undefined) closeSync(fd); }
}
function freeze(value) {
  if (value && typeof value === 'object') { for (const item of Object.values(value)) freeze(item); Object.freeze(value); }
  return value;
}

export function validateDefinition({ file, repo }) {
  const source = resolve(file);
  const bytes = readRegular(source, limits.definitionBytes, file);
  const text = utf8(bytes, file);
  const lines = new LineCounter();
  let docs;
  try { docs = parseAllDocuments(text, { schema: 'core', version: '1.2', uniqueKeys: true, strict: true, lineCounter: lines }); }
  catch { fail('YAML_PARSE', 'Cannot parse the bounded YAML document.', file); }
  if (docs.length !== 1) fail('YAML_DOCUMENTS', 'Use exactly one YAML document.', file);
  const doc = docs[0];
  // YAML recovery can still produce data from broken input. Never convert it.
  const parserError = doc.errors[0] || doc.warnings[0];
  if (parserError) fail(`YAML_${parserError.code}`, parserError.message.split('\n')[0], file, lines.linePos(parserError.pos[0]));
  if (/^%/m.test(text))
    fail('YAML_DIRECTIVE', 'YAML directives are unsupported.', file);
  const at = node => lines.linePos(node?.range?.[0] || 0);
  function inspect(node, depth = 0) {
    if (!node) return;
    if (depth > limits.yamlDepth) fail('DEPTH_LIMIT', `YAML exceeds depth ${limits.yamlDepth}.`, file, at(node));
    if (isAlias(node) || node.anchor) fail('YAML_ALIAS', 'Anchors and aliases are unsupported.', file, at(node));
    if (node.tag) fail('YAML_TAG', 'Explicit YAML tags are unsupported.', file, at(node));
    if (isMap(node)) for (const pair of node.items) {
      if (typeof pair.key?.value !== 'string') fail('UNKNOWN_FIELD', 'Mapping keys must be field names.', file, at(pair.key));
      inspect(pair.key, depth + 1); inspect(pair.value, depth + 1);
    }
    if (isSeq(node)) for (const item of node.items) inspect(item, depth + 1);
  }
  inspect(doc.contents);
  const data = doc.toJS({ maxAliasCount: 0 });
  function fields(value, node, schema, label) {
    if (!isMap(node) || !value || typeof value !== 'object' || Array.isArray(value))
      fail('FIELD_TYPE', `${label} must be a mapping.`, file, at(node));
    for (const pair of node.items) {
      if (typeof pair.key?.value !== 'string' || !Object.hasOwn(schema.properties, pair.key.value))
        fail('UNKNOWN_FIELD', `Unsupported field ${JSON.stringify(pair.key?.value)} in ${label}.`, file, at(pair.key));
    }
    for (const key of schema.required) if (!Object.hasOwn(value, key)) fail('MISSING_FIELD', `${label}.${key} is required.`, file, at(node));
  }
  const nodeFor = (map, key) => map.items.find(pair => pair.key.value === key)?.value;
  function string(value, rule, node, label) {
    if (typeof value !== 'string' || value.length < rule.minLength || value.length > rule.maxLength || !new RegExp(rule.pattern).test(value))
      fail('FIELD_VALUE', `Invalid ${label}.`, file, at(node));
  }
  fields(data, doc.contents, definitionSchema, 'definition');
  const prop = key => nodeFor(doc.contents, key);
  if (data.schemaVersion !== definitionSchema.properties.schemaVersion.const)
    fail('SCHEMA_VERSION', 'Supported schemaVersion is factory/v1alpha1.', file, at(prop('schemaVersion')));
  string(data.name, definitionSchema.properties.name, prop('name'), 'name');
  if (data.harness !== definitionSchema.properties.harness.const)
    fail('UNQUALIFIED_HARNESS', 'Only the codex desired harness is supported; other harnesses are unqualified.', file, at(prop('harness')));
  const projectNode = prop('project'), methodNode = prop('method');
  fields(data.project, projectNode, definitionSchema.properties.project, 'project');
  fields(data.method, methodNode, definitionSchema.properties.method, 'method');
  const skillsNode = nodeFor(methodNode, 'skills'), skillsRule = definitionSchema.properties.method.properties.skills;
  if (!Array.isArray(data.method.skills) || data.method.skills.length < skillsRule.minItems || data.method.skills.length > skillsRule.maxItems)
    fail('FIELD_TYPE', `method.skills must contain ${skillsRule.minItems}–${skillsRule.maxItems} paths.`, file, at(skillsNode));
  const pathRule = definitionSchema.$defs.localPath;
  const locations = new Map();
  function reference(path, node, markdown = false) {
    string(path, pathRule, node, 'local reference path');
    if (markdown && !new RegExp(definitionSchema.$defs.markdown.allOf[1].pattern).test(path))
      fail('REFERENCE_TYPE', 'Project references must be Markdown (.md).', file, at(node));
    locations.set(path, at(node));
  }
  for (const key of ['vision', 'instructions']) reference(data.project[key], nodeFor(projectNode, key), true);
  data.method.skills.forEach((path, index) => reference(path, skillsNode.items[index]));
  for (let i = 0; i < data.method.skills.length; i++) {
    const path = data.method.skills[i];
    if (data.method.skills.some((other, j) => j !== i && (other === path || other.startsWith(`${path}/`))))
      fail('SKILL_OVERLAP', 'Selected skills must be distinct, nonoverlapping directories.', file, locations.get(path));
  }
  let root;
  try { root = realpathSync(resolve(repo)); if (!lstatSync(root).isDirectory()) throw new Error(); }
  catch { fail('REPO_PATH', '--repo must identify an existing project directory.', file); }
  function checked(path, location) {
    let stat, current = root;
    try {
      for (const part of path.split('/')) {
        current = join(current, part); stat = lstatSync(current);
        if (stat.isSymbolicLink()) fail('SYMLINK', `Symlink references are unsupported: ${path}.`, file, location);
      }
      return stat;
    } catch (error) {
      if (error instanceof DefinitionError) throw error;
      fail('REFERENCE_MISSING', `Cannot resolve local reference: ${path}.`, file, location);
    }
  }
  const files = new Map();
  let total = bytes.length, entries = 0;
  function add(path, location, markdown = false) {
    if (files.has(path)) return;
    const stat = checked(path, location);
    const content = readRegular(join(root, path), limits.fileBytes, file, location, stat);
    if (markdown) {
      if (!utf8(content, file, location).trim()) fail('EMPTY_FILE', `Markdown is empty: ${path}.`, file, location);
    }
    if (hash(content) === contributorHash) fail('SOURCE_ONLY', 'Factory source contributor instructions cannot be exported.', file, location);
    total += content.length;
    if (total > limits.selectedBytes || files.size >= limits.selectedFiles)
      fail('SELECTION_LIMIT', 'Selected material exceeds the aggregate byte/file limit.', file, location);
    files.set(path, content);
  }
  for (const key of ['vision', 'instructions']) add(data.project[key], locations.get(data.project[key]), true);
  function walk(path, location, depth = 0) {
    if (depth > limits.directoryDepth) fail('DEPTH_LIMIT', 'Skill directory nesting exceeds the limit.', file, location);
    if (!checked(path, location).isDirectory()) fail('REFERENCE_TYPE', `Expected a skill directory: ${path}.`, file, location);
    let directory;
    try { directory = opendirSync(join(root, path)); }
    catch { fail('READ_DIRECTORY', `Cannot read skill directory: ${path}.`, file, location); }
    try {
      let entry;
      while ((entry = directory.readSync()) !== null) {
        if (++entries > limits.selectedEntries) fail('SELECTION_LIMIT', 'Selected directories exceed the entry limit.', file, location);
        const child = `${path}/${entry.name}`;
        if (entry.name.startsWith('.') || !new RegExp(pathRule.pattern).test(child) || child.length > pathRule.maxLength)
          fail('REFERENCE_PATH', 'Unsupported supporting file path in selected skill.', file, location);
        const stat = checked(child, location);
        if (stat.isDirectory()) walk(child, location, depth + 1);
        else add(child, location, /\.md$/i.test(entry.name));
      }
    } finally { directory.closeSync(); }
  }
  for (const path of data.method.skills) {
    add(`${path}/SKILL.md`, locations.get(path), true);
    walk(path, locations.get(path));
  }
  const orderedFiles = new Map([...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
  const references = [...orderedFiles]
    .map(([path, content]) => ({ path, bytes: content.length, sha256: hash(content) }));
  const definitionDigest = hash(bytes);
  const snapshotDigest = hash(JSON.stringify({ definitionDigest, references }));
  const result = freeze({ valid: true, schemaVersion: data.schemaVersion, definitionDigest, snapshotDigest,
    definition: data, references, execution: { qualified: false, reason: 'Desired syntax/references only; native setup, discovery, login, permissions and output acceptance are unqualified by this check.' } });
  snapshots.set(result, { file: source, repo: root, bytes, files: orderedFiles });
  return result;
}

// Reconcile all inputs before creating the destination, then stage captured bytes.
// The WeakMap keeps byte snapshots private and prevents callers modifying them.
export function definitionFiles(result) {
  const snapshot = snapshots.get(result);
  if (!snapshot) throw new Error('Use a freshly validated definition snapshot.');
  let current;
  try { current = validateDefinition(snapshot); }
  catch { fail('INPUT_CHANGED', 'Definition or references changed after validation; validate again.', snapshot.file); }
  if (current.snapshotDigest !== result.snapshotDigest)
    fail('INPUT_CHANGED', 'Definition or references changed after validation; validate again.', snapshot.file);
  return new Map([['project/factory.yaml', Buffer.from(snapshot.bytes)],
    ...[...snapshot.files].map(([path, bytes]) => [`project/${path}`, Buffer.from(bytes)])]);
}
