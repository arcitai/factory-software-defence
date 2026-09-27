import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { lstatSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync, readlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SourceAdmissionStore, restoreRetainedCheckout } from '../factory/source-admission.mjs';
import { hostGitEnvironment, runCandidateGit, runCandidateGitRaw } from '../factory/git-environment.mjs';
import { advanceAndPruneSourceFixture, createRetainedSourceFixture } from '../scripts/retained-source-fixture.mjs';

const rawGit = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

function repository(path, filename, contents) {
  mkdirSync(path);
  execFileSync('git', ['-C', path, 'init', '--quiet', '-b', 'main']);
  writeFileSync(join(path, filename), contents);
  rawGit('-C', path, 'add', '-A');
  execFileSync('git', ['-C', path, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '--quiet', '-m', 'Fixture base']);
  return rawGit('-C', path, 'rev-parse', 'HEAD');
}

test('host Git operations ignore hostile repository, index, object and config environment overrides', t => {
  const root = mkdtempSync(join(tmpdir(), 'sdf-host-git-context-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const sourceRepo = join(root, 'source'), operatorRepo = join(root, 'operator'), state = join(root, 'state');
  const sourceSha = repository(sourceRepo, 'source.txt', 'source A\n');
  const operatorSha = repository(operatorRepo, 'tracked.txt', 'operator base\n');
  const operatorSentinel = join(operatorRepo, 'operator-sentinel.txt');
  writeFileSync(operatorSentinel, 'preserve this untracked file\n');
  const operatorSnapshot = {
    head: operatorSha,
    index: readFileSync(join(operatorRepo, '.git', 'index')),
    tracked: readFileSync(join(operatorRepo, 'tracked.txt'), 'utf8'),
    sentinel: readFileSync(operatorSentinel, 'utf8'),
    status: rawGit('-C', operatorRepo, 'status', '--porcelain'),
  };
  const hostileGlobalConfig = join(root, 'hostile.gitconfig');
  writeFileSync(hostileGlobalConfig, `[core]\n\tworktree = ${operatorRepo}\n`);

  const previousGitEnvironment = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^GIT_/i.test(key)));
  for (const key of Object.keys(process.env)) if (/^GIT_/i.test(key)) delete process.env[key];
  Object.assign(process.env, {
    GIT_DIR: join(operatorRepo, '.git'),
    GIT_WORK_TREE: operatorRepo,
    GIT_INDEX_FILE: join(operatorRepo, '.git', 'index'),
    GIT_COMMON_DIR: join(operatorRepo, '.git'),
    GIT_OBJECT_DIRECTORY: join(operatorRepo, '.git', 'objects'),
    GIT_ALTERNATE_OBJECT_DIRECTORIES: join(operatorRepo, '.git', 'objects'),
    GIT_NAMESPACE: 'hostile-namespace',
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'core.worktree',
    GIT_CONFIG_VALUE_0: operatorRepo,
    GIT_CONFIG_GLOBAL: hostileGlobalConfig,
    GIT_CONFIG_SYSTEM: hostileGlobalConfig,
    GIT_CONFIG_NOSYSTEM: '0',
    GIT_CONFIG_PARAMETERS: `'core.worktree'='${operatorRepo}'`,
    GIT_CEILING_DIRECTORIES: operatorRepo,
  });
  t.after(() => {
    for (const key of Object.keys(process.env)) if (/^GIT_/i.test(key)) delete process.env[key];
    Object.assign(process.env, previousGitEnvironment);
  });

  const safeEnvironment = hostGitEnvironment();
  for (const key of Object.keys(process.env)) {
    if (/^GIT_/i.test(key) && !['GIT_CONFIG_NOSYSTEM', 'GIT_CONFIG_GLOBAL', 'GIT_TERMINAL_PROMPT'].includes(key))
      assert.equal(Object.hasOwn(safeEnvironment, key), false, `${key} is not inherited by host Git`);
  }
  assert.equal(safeEnvironment.GIT_CONFIG_NOSYSTEM, '1');
  assert.equal(safeEnvironment.GIT_CONFIG_GLOBAL, '/dev/null');

  const jobId = `job_${'a'.repeat(24)}`;
  const admission = new SourceAdmissionStore(state, sourceRepo, 'main').admit(jobId);
  assert.equal(admission.resolved_sha, sourceSha);
  const candidate = join(root, 'candidate');
  restoreRetainedCheckout(state, jobId, admission, candidate);

  const candidateBase = runCandidateGit(candidate, 'rev-parse', 'HEAD');
  assert.deepEqual(runCandidateGitRaw(candidate, 'rev-parse', 'HEAD'), Buffer.from(sourceSha + '\n'));
  assert.equal(candidateBase, sourceSha, 'candidate initialization uses the admitted source');
  writeFileSync(join(candidate, 'source.txt'), 'candidate change\n');
  writeFileSync(join(candidate, 'new-file.txt'), 'candidate addition\n');
  assert.match(runCandidateGit(candidate, 'status', '--porcelain'), /source\.txt|new-file\.txt/);
  runCandidateGit(candidate, 'add', '-A');
  assert.match(runCandidateGit(candidate, 'diff', '--cached', '--stat'), /source\.txt/);
  runCandidateGit(candidate, '-c', 'user.name=Factory fixture', '-c', 'user.email=factory@localhost', 'commit', '--no-verify', '-m', 'Candidate change');
  const candidateHead = runCandidateGit(candidate, 'rev-parse', 'HEAD');
  assert.equal(runCandidateGit(candidate, 'rev-parse', 'HEAD^'), candidateBase, 'candidate commit remains based on the admitted source');
  assert.match(runCandidateGit(candidate, 'diff', '--binary', candidateBase, candidateHead), /candidate change/);

  writeFileSync(join(candidate, 'candidate-cache'), 'remove only from candidate');
  writeFileSync(join(candidate, 'candidate-untracked'), 'remove only from candidate');
  runCandidateGit(candidate, 'clean', '-fdx');
  assert.equal(existsSync(join(candidate, 'candidate-cache')), false);
  assert.equal(existsSync(join(candidate, 'candidate-untracked')), false);
  assert.equal(runCandidateGit(candidate, 'status', '--porcelain'), '');
  assert.equal(runCandidateGit(candidate, 'rev-parse', 'HEAD'), candidateHead);

  assert.equal(runCandidateGit(operatorRepo, 'rev-parse', 'HEAD'), operatorSnapshot.head);
  assert.deepEqual(readFileSync(join(operatorRepo, '.git', 'index')), operatorSnapshot.index);
  assert.equal(readFileSync(join(operatorRepo, 'tracked.txt'), 'utf8'), operatorSnapshot.tracked);
  assert.equal(readFileSync(operatorSentinel, 'utf8'), operatorSnapshot.sentinel);
  assert.equal(rawGit('-C', operatorRepo, 'status', '--porcelain'), operatorSnapshot.status);
});

test('retained-source qualification fixture prunes only its source under hostile Git context', t => {
  const root = mkdtempSync(join(tmpdir(), 'sdf-retained-source-fixture-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const cleanEnvironment = hostGitEnvironment();
  const cleanGit = (...args) => execFileSync('git', args, { encoding: 'utf8', env: cleanEnvironment }).trim();
  const gitPathMissing = (...args) => {
    try { execFileSync('git', args, { env: cleanEnvironment, stdio: ['ignore', 'ignore', 'ignore'] }); return false; }
    catch { return true; }
  };
  const operatorRepo = join(root, 'operator');
  mkdirSync(operatorRepo);
  cleanGit('-C', operatorRepo, 'init', '--quiet', '-b', 'operator-main');
  writeFileSync(join(operatorRepo, 'tracked.txt'), 'operator tracked content\n');
  cleanGit('-C', operatorRepo, 'add', '-A');
  cleanGit('-C', operatorRepo, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '--quiet', '-m', 'Operator base');
  cleanGit('-C', operatorRepo, 'tag', 'operator-tag');
  writeFileSync(join(operatorRepo, 'operator-sentinel.txt'), 'must remain untracked\n');

  const snapshot = () => {
    const status = cleanGit('-C', operatorRepo, 'status', '--porcelain');
    const paths = cleanGit('-C', operatorRepo, 'ls-files', '--cached', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean);
    const files = Object.fromEntries(paths.map(path => {
      const fullPath = join(operatorRepo, path), stat = lstatSync(fullPath);
      return [path, {
        mode: stat.mode & 0o7777,
        content: stat.isSymbolicLink() ? { symlink: readlinkSync(fullPath) } : readFileSync(fullPath),
      }];
    }));
    return {
      branch: cleanGit('-C', operatorRepo, 'symbolic-ref', '--short', 'HEAD'),
      head: cleanGit('-C', operatorRepo, 'rev-parse', 'HEAD'),
      status,
      index: readFileSync(join(operatorRepo, '.git', 'index')),
      files,
      refs: cleanGit('-C', operatorRepo, 'for-each-ref', '--format=%(refname) %(objectname)'),
      objects: cleanGit('-C', operatorRepo, 'cat-file', '--batch-all-objects', '--batch-check=%(objectname)').split('\n').filter(Boolean).sort(),
    };
  };
  const before = snapshot();
  assert.deepEqual(before.branch, 'operator-main');
  assert.ok(before.files['tracked.txt']);
  assert.ok(before.files['operator-sentinel.txt']);

  const hostileGlobalConfig = join(root, 'hostile.gitconfig');
  writeFileSync(hostileGlobalConfig, `[core]\n\tworktree = ${operatorRepo}\n`);
  const previousGitEnvironment = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^GIT_/i.test(key)));
  for (const key of Object.keys(process.env)) if (/^GIT_/i.test(key)) delete process.env[key];
  Object.assign(process.env, {
    GIT_DIR: join(operatorRepo, '.git'),
    GIT_WORK_TREE: operatorRepo,
    GIT_INDEX_FILE: join(operatorRepo, '.git', 'index'),
    GIT_COMMON_DIR: join(operatorRepo, '.git'),
    GIT_OBJECT_DIRECTORY: join(operatorRepo, '.git', 'objects'),
    GIT_ALTERNATE_OBJECT_DIRECTORIES: join(operatorRepo, '.git', 'objects'),
    GIT_NAMESPACE: 'qualification-hostile-namespace',
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'core.worktree',
    GIT_CONFIG_VALUE_0: operatorRepo,
    GIT_CONFIG_GLOBAL: hostileGlobalConfig,
    GIT_CONFIG_SYSTEM: hostileGlobalConfig,
    GIT_CONFIG_NOSYSTEM: '0',
    GIT_CONFIG_PARAMETERS: `'core.worktree'='${operatorRepo}'`,
    GIT_CEILING_DIRECTORIES: operatorRepo,
  });
  t.after(() => {
    for (const key of Object.keys(process.env)) if (/^GIT_/i.test(key)) delete process.env[key];
    Object.assign(process.env, previousGitEnvironment);
  });

  const proofState = join(root, 'qualification');
  mkdirSync(proofState);
  const fixture = createRetainedSourceFixture(proofState);
  const state = join(root, 'factory-state'), jobId = `job_${'b'.repeat(24)}`;
  const admission = new SourceAdmissionStore(state, fixture.repo, 'main').admit(jobId);
  assert.equal(admission.resolved_sha, fixture.sourceA);

  const operator = advanceAndPruneSourceFixture(fixture);
  assert.equal(operator.branch, 'operator-b');
  assert.equal(cleanGit('-C', fixture.repo, 'rev-parse', 'HEAD'), operator.head);
  assert.equal(cleanGit('-C', fixture.repo, 'status', '--porcelain'), operator.status);
  assert.equal(gitPathMissing('-C', fixture.repo, 'rev-parse', '--verify', 'refs/heads/main'), true);
  assert.equal(gitPathMissing('-C', fixture.repo, 'cat-file', '-e', `${fixture.sourceA}^{commit}`), true);

  const candidate = join(root, 'candidate');
  restoreRetainedCheckout(state, jobId, admission, candidate);
  assert.equal(runCandidateGit(candidate, 'rev-parse', 'HEAD'), fixture.sourceA);
  assert.deepEqual(snapshot(), before, 'the hostile context did not change the second checkout, its index, refs or objects');
});
