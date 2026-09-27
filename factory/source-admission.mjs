import { randomBytes, createHash } from 'node:crypto';
import { chmodSync, lstatSync, mkdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { runCandidateGit, runHostGit } from './git-environment.mjs';
import { isDeepStrictEqual } from 'node:util';
import { readPrivateJson, assertPrivateDirectory } from './execution-evidence.mjs';
import { readProjectLinks } from './project-links.mjs';

const REF_NAME = 'refs/heads/factory-source';

export class SourceAdmissionError extends Error {
  constructor(message, status = 409) { super(message); this.status = status; }
}

function git(repo, ...args) {
  return runCandidateGit(repo, ...args);
}

function privateDirectory(path) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new SourceAdmissionError('Private source retention path is not a real directory.', 503);
  chmodSync(path, 0o700);
}

function validJobId(jobId) {
  if (!/^job_[a-f0-9]{24}$/.test(jobId || '')) throw new SourceAdmissionError('Invalid job identity.', 400);
}

function validRequestedRef(ref) {
  return typeof ref === 'string' && ref.length > 0 && Buffer.byteLength(ref) <= 256
    && !/[\u0000-\u001f\u007f]/.test(ref);
}

function objectId(value, format) {
  return new RegExp(`^[a-f0-9]{${format === 'sha256' ? 64 : 40}}$`).test(value || '');
}

function checkRef(repo, requestedRef, format) {
  if (!validRequestedRef(requestedRef)) throw new SourceAdmissionError('Source ref must be a nonempty Git ref under 256 bytes.', 400);
  const normalizedRef = /^[a-fA-F0-9]{40}$/.test(requestedRef) || /^[a-fA-F0-9]{64}$/.test(requestedRef)
    ? requestedRef.toLowerCase() : requestedRef;
  if (normalizedRef !== 'HEAD' && !objectId(normalizedRef, format)) {
    try { git(repo, 'check-ref-format', '--allow-onelevel', normalizedRef); }
    catch { throw new SourceAdmissionError('Source ref must be a valid branch, tag, full commit ID, or HEAD.', 400); }
  }
  let sha;
  try { sha = git(repo, 'rev-parse', '--verify', '--end-of-options', `${normalizedRef}^{commit}`).toLowerCase(); }
  catch { throw new SourceAdmissionError(`Could not resolve source ref "${requestedRef}" to a commit.`, 400); }
  if (!objectId(sha, format)) throw new SourceAdmissionError('Resolved source object has an unsupported ID format.', 409);
  return sha;
}

function repositoryIdentity(repo) {
  let root, commonDir, objectFormat;
  try {
    root = realpathSync(git(repo, 'rev-parse', '--show-toplevel'));
    commonDir = realpathSync(resolve(repo, git(repo, 'rev-parse', '--git-common-dir')));
    objectFormat = git(repo, 'rev-parse', '--show-object-format');
  } catch { throw new SourceAdmissionError('Configured source is not an available Git repository root.', 409); }
  if (root !== repo || !['sha1', 'sha256'].includes(objectFormat)) throw new SourceAdmissionError('Configured source must be the Git root using SHA-1 or SHA-256 objects.', 409);
  const identity = createHash('sha256').update(`${root}\0${commonDir}\0${objectFormat}`).digest('hex');
  return { identity: `sha256:${identity}`, path: root, common_dir: commonDir, object_format: objectFormat };
}

function sourceLocation(state, jobId, record) {
  validJobId(jobId);
  if (!record || record.status !== 'retained' || record.version !== 1
    || !/^sources\/retained_[a-f0-9]{24}\.git$/.test(record.retained_repo || '')
    || !['sha1', 'sha256'].includes(record.object_format)
    || !objectId(record.resolved_sha, record.object_format)
    || !/^sha256:[a-f0-9]{64}$/.test(record.repository_identity || '')
    || !validRequestedRef(record.requested_ref)
    || !['configured', 'explicit'].includes(record.ref_source)
    || record.retained_ref !== REF_NAME)
    throw new SourceAdmissionError('This job has no usable retained source record.', 409);
  const folder = join(state, 'jobs', jobId), sources = join(folder, 'sources');
  for (const directory of [join(state, 'jobs'), folder, sources]) {
    const stat = lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0)
      throw new SourceAdmissionError('Retained source storage is missing or not private.', 409);
  }
  const path = join(folder, record.retained_repo);
  if (!path.startsWith(sources + sep)) throw new SourceAdmissionError('Retained source path is invalid.', 409);
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0)
    throw new SourceAdmissionError('Retained source objects are missing or not private.', 409);
  return path;
}

export function publicSourceAdmission(record) {
  if (record?.status !== 'retained') return {
    status: 'legacy_unknown',
    repository_identity: null,
    requested_ref: null,
    resolved_sha: null,
    object_format: null,
    retained_at: null,
    note: 'Admission-time source revision was not recorded for this job.',
  };
  return {
    status: 'retained',
    repository_identity: record.repository_identity,
    source_repository: record.source_repository || null,
    requested_ref: record.requested_ref,
    ref_source: record.ref_source,
    resolved_sha: record.resolved_sha,
    object_format: record.object_format,
    retained_at: record.retained_at,
  };
}

export class SourceAdmissionStore {
  constructor(state, repository, defaultRef = 'HEAD') {
    this.state = state;
    this.repository = repository;
    this.defaultRef = defaultRef ?? 'HEAD';
  }

  admit(jobId, requestedRef, expectedRepositoryIdentity) {
    validJobId(jobId);
    let repository;
    try { repository = realpathSync(this.repository); }
    catch { throw new SourceAdmissionError('Configured source repository is unavailable.', 409); }
    const identity = repositoryIdentity(repository);
    if (expectedRepositoryIdentity && identity.identity !== expectedRepositoryIdentity)
      throw new SourceAdmissionError('Configured repository identity changed; submit a new job for a different repository.', 409);
    const explicit = requestedRef !== undefined;
    const requested = explicit ? requestedRef : this.defaultRef;
    const sha = checkRef(repository, requested, identity.object_format);
    const jobDir = join(this.state, 'jobs', jobId), sources = join(jobDir, 'sources');
    try {
      privateDirectory(join(this.state, 'jobs'));
      privateDirectory(jobDir);
      privateDirectory(sources);
    } catch (error) {
      if (error instanceof SourceAdmissionError) throw error;
      throw new SourceAdmissionError('Could not prepare private source retention storage.', 503);
    }
    const nonce = randomBytes(12).toString('hex');
    const temporary = join(sources, `.pending_${nonce}.git`);
    const retained = join(sources, `retained_${nonce}.git`);
    const retainedRelative = relative(jobDir, retained).split(sep).join('/');
    try {
      runHostGit(['init', '--quiet', '--bare', `--object-format=${identity.object_format}`, temporary]);
      git(temporary, 'config', 'gc.auto', '0');
      git(temporary, 'fetch', '--no-tags', '--', repository, `${sha}:${REF_NAME}`);
      if (git(temporary, 'rev-parse', '--verify', `${REF_NAME}^{commit}`).toLowerCase() !== sha)
        throw new Error('Fetched ref does not match the resolved source commit.');
      git(temporary, 'cat-file', '-e', `${sha}^{tree}`);
      git(temporary, 'fsck', '--strict', '--connectivity-only', '--no-reflogs', '--no-dangling', sha);
      renameSync(temporary, retained);
      chmodSync(retained, 0o700);
      const record = {
        version: 1,
        status: 'retained',
        repository_identity: identity.identity,
        repository_path: identity.path,
        repository_common_dir: identity.common_dir,
        // Expose only the canonical public repository URL, never the original
        // transport which may contain credentials. This identity is pinned at
        // admission so a later remote rename cannot redirect delivery.
        source_repository: readProjectLinks(repository)?.repository || null,
        object_format: identity.object_format,
        requested_ref: requested,
        ref_source: explicit ? 'explicit' : 'configured',
        resolved_sha: sha,
        retained_repo: retainedRelative,
        retained_ref: REF_NAME,
        retained_at: new Date().toISOString(),
      };
      assertRetainedSource(this.state, jobId, record);
      return record;
    } catch (error) {
      rmSync(temporary, { recursive: true, force: true });
      rmSync(retained, { recursive: true, force: true });
      if (error instanceof SourceAdmissionError) throw error;
      throw new SourceAdmissionError('Could not retain and verify the resolved source commit; no job was admitted.', 503);
    }
  }

  validate(jobId, record) { return assertRetainedSource(this.state, jobId, record); }

  retainCheckpoint(job, selected) {
    assertRetainedSource(this.state, job.id, job.source_admission);
    const folder = join(this.state, 'jobs', job.id), workspace = join(folder, 'checkout');
    const record = { version: 1, job_id: job.id, ...selected,
      object_format: job.source_admission.object_format, retained_ref: 'refs/heads/factory-checkpoint',
      retained_repo: `checkpoints/retained_${randomBytes(12).toString('hex')}.git`,
      retained_at: new Date().toISOString() };
    if (![record.head, record.tree, record.original_base].every(value => objectId(value, record.object_format)))
      throw new SourceAdmissionError('Reviewed checkpoint has invalid object identities.');
    assertCheckpointTree(workspace, record);
    if (git(workspace, 'rev-parse', 'HEAD') !== record.head || git(workspace, 'status', '--porcelain'))
      throw new SourceAdmissionError('Reviewed checkout changed; preserve the work and reload before continuing.');
    privateDirectory(join(folder, 'checkpoints'));
    const path = join(folder, record.retained_repo), temporary = path + '.pending';
    try {
      runHostGit(['init', '--quiet', '--bare', `--object-format=${record.object_format}`, temporary]);
      chmodSync(temporary, 0o700);
      git(temporary, 'config', 'gc.auto', '0');
      git(temporary, 'fetch', '--no-tags', '--', workspace, `${record.head}:${record.retained_ref}`);
      assertCheckpointTree(temporary, record);
      writeFileSync(join(temporary, 'checkpoint.json'), JSON.stringify(record), { flag: 'wx', mode: 0o600 });
      renameSync(temporary, path);
      assertRetainedCheckpoint(this.state, job.id, job.source_admission, record, record.policy_hash);
      return record;
    } catch (error) {
      rmSync(temporary, { recursive: true, force: true });
      // Retained objects are never removed on a failed transition.
      throw new SourceAdmissionError(`Could not retain reviewed checkpoint; prior work is preserved. ${error.message}`);
    }
  }

  validateCheckpoint(jobId, source, record, policyHash) {
    return assertRetainedCheckpoint(this.state, jobId, source, record, policyHash);
  }

  release(jobId, record) {
    if (!record?.retained_repo || !/^sources\/retained_[a-f0-9]{24}\.git$/.test(record.retained_repo || '')) return;
    const folder = join(this.state, 'jobs', jobId), path = join(folder, record.retained_repo);
    if (path.startsWith(join(folder, 'sources') + sep)) rmSync(path, { recursive: true, force: true });
  }
}

export function assertRetainedSource(state, jobId, record) {
  let path;
  try { path = sourceLocation(state, jobId, record); }
  catch (error) {
    if (error instanceof SourceAdmissionError) throw error;
    throw new SourceAdmissionError('Retained source storage is missing or unreadable; the current checkout was not substituted.', 409);
  }
  try {
    const format = git(path, 'rev-parse', '--show-object-format');
    const pinned = git(path, 'rev-parse', '--verify', `${record.retained_ref}^{commit}`).toLowerCase();
    if (format !== record.object_format || pinned !== record.resolved_sha) throw new Error('retained ref mismatch');
    git(path, 'cat-file', '-e', `${record.resolved_sha}^{commit}`);
    git(path, 'cat-file', '-e', `${record.resolved_sha}^{tree}`);
    git(path, 'fsck', '--strict', '--connectivity-only', '--no-reflogs', '--no-dangling', record.resolved_sha);
  } catch { throw new SourceAdmissionError('Retained source commit or required objects are unavailable; the current checkout was not substituted.', 409); }
  return { path, sha: record.resolved_sha };
}

export function restoreRetainedCheckout(state, jobId, record, workspace) {
  const retained = assertRetainedSource(state, jobId, record);
  try {
    runHostGit(['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', 'clone', '--no-hardlinks', '--no-checkout', '--', retained.path, workspace]);
    git(workspace, 'checkout', '--detach', retained.sha);
    if (git(workspace, 'rev-parse', 'HEAD').toLowerCase() !== retained.sha) throw new Error('checkout head mismatch');
    git(workspace, 'remote', 'remove', 'origin');
  } catch { rmSync(workspace, { recursive: true, force: true }); throw new SourceAdmissionError('Could not build the checkout from this job’s retained source commit.', 409); }
  return { path: workspace, sha: retained.sha };
}

function assertCheckpointTree(path, record) {
  try {
    if (git(path, 'rev-parse', '--show-object-format') !== record.object_format
      || git(path, 'rev-parse', `${record.head}^{tree}`) !== record.tree
      || (record.head !== record.original_base && git(path, 'rev-list', '--parents', '-n', '1', record.head) !== `${record.head} ${record.original_base}`))
      throw new Error('head, tree or parent mismatch');
    git(path, 'fsck', '--strict', '--no-reflogs', '--no-dangling', record.head);
  } catch { throw new SourceAdmissionError('Reviewed checkpoint objects are missing or tampered; prior code and evidence were preserved.'); }
}

export function publicContinuation(record) {
  if (!record) return null;
  const { version, job_id, head, tree, original_base, build_run_id, checks_run_id, review_run_id,
    policy_hash, repository_identity, retained_at } = record;
  return { version, job_id, head, tree, original_base, build_run_id, checks_run_id, review_run_id,
    policy_hash, repository_identity, retained_at };
}

export function assertRetainedCheckpoint(state, jobId, source, record, policyHash) {
  validJobId(jobId);
  if (!record || record.version !== 1 || record.job_id !== jobId
    || record.original_base !== source?.resolved_sha || record.repository_identity !== source?.repository_identity
    || record.object_format !== source?.object_format || record.policy_hash !== policyHash
    || !/^[a-f0-9]{64}$/.test(record.policy_hash || '')
    || !['build_run_id', 'checks_run_id', 'review_run_id'].every(key => /^run_[a-z0-9]+$/.test(record[key] || ''))
    || !objectId(record.head, record.object_format) || !objectId(record.tree, record.object_format)
    || !objectId(record.original_base, record.object_format)
    || !/^checkpoints\/retained_[a-f0-9]{24}\.git$/.test(record.retained_repo || '')
    || record.retained_ref !== 'refs/heads/factory-checkpoint')
    throw new SourceAdmissionError('Checkpoint is foreign or incompatible with the original source/current policy; start fresh explicitly.');
  assertRetainedSource(state, jobId, source);
  const folder = join(state, 'jobs', jobId), path = join(folder, record.retained_repo);
  try {
    for (const dir of [join(state, 'jobs'), folder, join(folder, 'checkpoints'), path]) assertPrivateDirectory(dir);
    if (!isDeepStrictEqual(readPrivateJson(join(path, 'checkpoint.json')), record)
      || git(path, 'rev-parse', `${record.retained_ref}^{commit}`) !== record.head) throw new Error('record mismatch');
    assertCheckpointTree(path, record);
  } catch { throw new SourceAdmissionError('Retained checkpoint is missing, unsafe or tampered; restore its private storage before retrying.'); }
  return { path, sha: record.head, tree: record.tree };
}

// HEAD stays at the original base while the selected tree is staged. The normal
// Build commit therefore aggregates every change into one child of that base.
export function restoreBuildCheckout(state, jobId, source, workspace, continuation, policyHash) {
  const checkpoint = continuation ? assertRetainedCheckpoint(state, jobId, source, continuation, policyHash) : null;
  const retained = restoreRetainedCheckout(state, jobId, source, workspace);
  if (checkpoint) {
    git(workspace, 'fetch', '--no-tags', '--', checkpoint.path, checkpoint.sha);
    git(workspace, 'read-tree', '--reset', '-u', checkpoint.tree);
    if (git(workspace, 'write-tree') !== checkpoint.tree || git(workspace, 'rev-parse', 'HEAD') !== retained.sha)
      throw new SourceAdmissionError('Could not seed the reviewed checkpoint on its original base.');
  }
  return retained;
}
