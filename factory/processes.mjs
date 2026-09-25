import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, closeSync, readFileSync, renameSync, rmSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { ROOT, configAt, run, json, save, stopContainers, sleep } from './lib.mjs';
import { withRequestedModel, executionProfile } from './execution-profile.mjs';
import { parseCodexJsonl, emptyUsage, usageFields } from './usage.mjs';

const MAX_LEGACY_LOG_BYTES = 1024 * 1024;

const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; } };
// Older queues did not retain the verdict. Only recover it from the exact
// attempt's controller-exported review, bound to its checked candidate/policy.
export function retainedReviewVerdict(state, job, attempt) {
  try {
    const folder = join(state, 'jobs', job.id);
    const read = path => { const stat = lstatSync(path); if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) return null; return json(path); };
    const review = read(join(folder, 'artifacts', attempt.id, 'review.json'));
    const candidate = read(join(folder, 'candidate.json')), checks = read(join(folder, 'checks.json'));
    if (review?.head && review.policyHash && review.head === candidate?.head && checks?.passed === true
      && checks.head === review.head && checks.policyHash === review.policyHash) return review.verdict;
  } catch { /* Missing or malformed legacy evidence cannot grant a revision action. */ }
}

// Prior BoundedLog files merge stdout and stderr. A historical completion
// event is attributable to stdout only when the retained footer proves stderr
// was empty. All paths come from the persisted job/attempt IDs and are read
// once through the bounded per-controller cache below.
export function retainedCodexUsage(state, job, attempt) {
  try {
    if (!/^job_[a-z0-9]+$/.test(job?.id || '') || !/^run_[a-z0-9]+$/.test(attempt?.id || '')
      || !['build', 'review', 'defence'].includes(attempt.command)) return null;
    const folder = join(state, 'jobs', job.id), runFolder = join(folder, attempt.id);
    const artifactFolder = join(folder, 'artifacts', attempt.id);
    const directory = path => { const stat = lstatSync(path); return stat.isDirectory() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0; };
    if (![join(state, 'jobs'), folder, runFolder, join(folder, 'artifacts'), artifactFolder].every(directory)) return null;
    const readPrivate = (path, limit) => {
      const stat = lstatSync(path);
      if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || stat.size > limit) return null;
      return readFileSync(path);
    };
    const profileBytes = readPrivate(join(artifactFolder, 'execution.json'), 16 * 1024);
    if (!profileBytes) return null;
    const profile = JSON.parse(profileBytes.toString('utf8'));
    if (profile?.version !== 1 || profile.executor !== 'codex' || profile.phase !== attempt.command
      || !/^[a-f0-9]{64}$/.test(profile.policyHash || '')
      || (attempt.execution && !isDeepStrictEqual(attempt.execution, profile))) return null;
    const bytes = readPrivate(join(runFolder, `${attempt.command}.log`), MAX_LEGACY_LOG_BYTES);
    if (!bytes) return null;
    const text = bytes.toString('utf8');
    const footer = /\[factory process exit: code=[^\]\r\n]+ signal=[^\]\r\n]+; stdout=(\d+) bytes stderr=(\d+) bytes; omitted=(\d+) bytes\]\s*$/.exec(text);
    if (!footer || Number(footer[2]) !== 0) return null;
    const usage = parseCodexJsonl([Buffer.from(text.slice(0, footer.index))], { truncated: Number(footer[3]) > 0 });
    return usage ? { ...usage, source: 'legacy_codex_log' } : null;
  } catch { return null; }
}

function usageForAttempt(state, job, attempt) {
  const stored = usageFields(attempt.usage, attempt.execution, attempt.command);
  if (stored.usage.status !== 'unknown') return stored;
  const recovered = retainedCodexUsage(state, job, attempt);
  return recovered ? usageFields(recovered, attempt.execution, attempt.command) : stored;
}

export function executors(state) {
  const children = new Map();
  const usageCache = new Map();
  function presentedUsage(job, attempt) {
    const key = `${job.id}/${attempt.id}/${attempt.state}`;
    if (usageCache.has(key)) return usageCache.get(key);
    const value = usageForAttempt(state, job, attempt);
    usageCache.set(key, value);
    if (usageCache.size > 512) usageCache.delete(usageCache.keys().next().value);
    return value;
  }
  function prepare(job, attempt) {
    const config = withRequestedModel(configAt(state), job.model);
    // Resolve tags before admission so the recorded image is the one actually run.
    config.image = run('docker', ['image', 'inspect', '--format', '{{.Id}}', config.image]);
    if (!/^sha256:[a-f0-9]{64}$/.test(config.image)) throw new Error('Expected an immutable Docker image ID');
    const profile = executionProfile(config, attempt.command), folder = join(state, 'jobs', job.id);
    save(join(folder, attempt.id, 'execution-config.json'), config);
    save(join(folder, 'artifacts', attempt.id, 'execution.json'), profile);
    return profile;
  }
  async function stop(jobId) {
    const running = children.get(jobId);
    if (running) {
      try { process.kill(-running.child.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      await Promise.race([running.done, sleep(2000)]);
      if (alive(-running.child.pid)) {
        try { process.kill(-running.child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
        await running.done;
      }
    }
    stopContainers(state, jobId);
    if (running && !alive(-running.child.pid)) rmSync(join(state, 'jobs', jobId, 'active.json'), { force: true });
  }
  async function reconcile(jobId, phase) {
    if (children.has(jobId)) throw new Error('Previous executor is still finishing');
    stopContainers(state, jobId);
    const folder = join(state, 'jobs', jobId), lock = join(folder, 'active.json');
    if (existsSync(lock)) {
      const previous = json(lock);
      if (!Number.isSafeInteger(previous.pid) || alive(previous.pid)) throw new Error('Previous executor is still present or unknown');
      if (!Number.isSafeInteger(previous.pgid) || run('ps', ['-axo', 'pgid=']).split('\n').map(Number).includes(previous.pgid))
        throw new Error('Previous process group is still present or unknown');
      rmSync(lock);
    }
    if (['build', 'defence'].includes(phase) && existsSync(join(folder, 'checkout')))
      renameSync(join(folder, 'checkout'), join(folder, `previous-checkout-${Date.now()}`));
  }
  async function execute(job, attempt) {
    const config = json(join(state, 'jobs', job.id, attempt.id, 'execution-config.json')), output = join(state, 'jobs', job.id, 'artifacts', attempt.id);
    mkdirSync(output, { recursive: true, mode: 0o700 });
    const resultPath = join(output, 'result.json'), fd = openSync(join(output, 'executor.log'), 'a', 0o600);
    const child = spawn(process.execPath, [join(ROOT, 'factory/executor.mjs'), state, attempt.command], {
      detached: true, stdio: ['pipe', fd, fd], env: { ...process.env, SDF_JOB_ID: job.id, SDF_RUN_ID: attempt.id, SDF_OUTPUT_DIR: output, SDF_STEP_RESULT_PATH: resultPath },
    }); closeSync(fd);
    let finish;
    const done = new Promise(resolve => { finish = resolve; });
    children.set(job.id, { child, done });
    child.on('error', error => finish({ error }));
    child.on('close', code => finish({ code }));
    child.stdin.on('error', error => { if (error.code !== 'EPIPE') finish({ error }); }); child.stdin.end(job.prompt);
    const deadline = setTimeout(() => { stop(job.id).catch(error => console.error(error.message)); }, (config.timeoutSeconds + 30) * 1000);
    let exit;
    try { exit = await done; }
    finally { clearTimeout(deadline); children.delete(job.id); }
    if (exit.error) throw exit.error;
    const recovered = retainedCodexUsage(state, job, attempt);
    if (!existsSync(resultPath)) return { outcome: 'blocked', ...usageFields(recovered || emptyUsage(attempt.execution, attempt.command), attempt.execution, attempt.command), summary: `Executor exited ${exit.code} without a result` };
    let outcome;
    try { outcome = JSON.parse(readFileSync(resultPath, 'utf8')); }
    catch { return { outcome: 'blocked', ...usageFields(recovered || emptyUsage(attempt.execution, attempt.command), attempt.execution, attempt.command), summary: 'Executor result was malformed' }; }
    const reportedUsage = outcome.usage?.status === 'unknown' ? recovered || outcome.usage : outcome.usage || recovered;
    const usage = usageFields(reportedUsage, attempt.execution, attempt.command);
    if (exit.code !== 0 || outcome.outcome !== 'complete') return { outcome: 'blocked', ...usage, summary: outcome.summary || `Executor exited ${exit.code}`, review_verdict: outcome.review_verdict };
    return { ...outcome, ...usage };
  }
  return { prepare, execute, stop, reconcile, reviewVerdict: (job, attempt) => retainedReviewVerdict(state, job, attempt), usage: presentedUsage };
}
