import { assertPrivateDirectory } from './execution-evidence.mjs';
import { lstatSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { digest } from './lib.mjs';

const MAX_PATCH_BYTES = 8 * 1024 * 1024;
const MAX_TREE_BYTES = 8 * 1024 * 1024;

function readPrivateFile(path, limit) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || stat.size > limit)
    throw new Error('Protected candidate patch is missing, unsafe or too large.');
  return readFileSync(path);
}
function runGitCommand(args) {
  const env = {
    PATH: process.env.PATH || '/usr/bin:/bin', HOME: '/nonexistent',
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0',
  };
  const result = spawnSync('git', args, { env, encoding: 'utf8', maxBuffer: MAX_TREE_BYTES + MAX_PATCH_BYTES + 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error('Could not prepare private candidate reconstruction storage.');
  return result.stdout.trim();
}
function runGit(repo, args, { input, binary = false } = {}) {
  // Delivery reconstruction runs only trusted Git operations in a newly made
  // bare repository. Candidate hooks, filters, global config and credentials
  // are unavailable to these subprocesses.
  const env = {
    PATH: process.env.PATH || '/usr/bin:/bin',
    HOME: '/nonexistent',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_TERMINAL_PROMPT: '0',
    GIT_OPTIONAL_LOCKS: '0',
  };
  const result = spawnSync('git', ['--git-dir', repo, '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', ...args], {
    env, input, encoding: binary ? null : 'utf8', maxBuffer: MAX_TREE_BYTES + MAX_PATCH_BYTES + 1024 * 1024,
  });
  if (result.error || result.status !== 0) throw new Error('Could not reconstruct the accepted candidate from retained Git objects.');
  return binary ? result.stdout : result.stdout.trim();
}
// Shared acceptance/publication boundary. Only the original retained base and
// exact protected patch bytes enter new, private bare storage. The callback may
// inspect reconstructed objects; cleanup removes only this invocation's scratch.
export function withReconstructedCandidate({ state, jobId, sourcePath, objectFormat, candidate }, inspect = () => {}) {
  const oid = new RegExp(`^[a-f0-9]{${objectFormat === 'sha256' ? 64 : 40}}$`);
  if (!['sha1', 'sha256'].includes(objectFormat) || !oid.test(candidate.base || '') || !oid.test(candidate.tree || ''))
    throw new Error('Candidate has an unsupported Git object identity.');
  const folder = join(state, 'jobs', jobId);
  const patchPath = join(folder, 'delivery-input', 'candidate.patch');
  assertPrivateDirectory(join(state, 'jobs'));
  assertPrivateDirectory(folder);
  assertPrivateDirectory(join(folder, 'delivery-input'));
  const patch = readPrivateFile(patchPath, MAX_PATCH_BYTES);
  if (!patch.length || digest(patch) !== candidate.patch_sha256) throw new Error('Accepted patch digest does not match the approval record.');
  const scratchRoot = mkdtempSync(join(folder, 'delivery-work-'));
  const repo = join(scratchRoot, 'candidate.git');
  try {
    runGitCommand(['init', '--bare', '--quiet', '--template=', `--object-format=${objectFormat}`, repo]);
    runGit(repo, ['fetch', '--quiet', '--no-tags', '--', sourcePath, `${candidate.base}:refs/heads/factory-base`]);
    if (runGit(repo, ['rev-parse', '--verify', `${candidate.base}^{commit}`]) !== candidate.base)
      throw new Error('Accepted base differs from the retained source commit.');
    runGit(repo, ['read-tree', candidate.base]);
    runGit(repo, ['apply', '--cached', '--binary', '--whitespace=nowarn', '-'], { input: patch });
    const tree = runGit(repo, ['write-tree']);
    if (tree !== candidate.tree) throw new Error('Protected patch does not reproduce the accepted candidate tree.');
    return inspect({ repo, patch, tree, git: runGit });
  } finally {
    rmSync(scratchRoot, { recursive: true, force: true });
  }
}
