import { run } from './lib.mjs';

// Git reads repository and configuration overrides from its environment before
// considering -C. Host operations must therefore start from a bounded context
// rather than inherit the controller's arbitrary GIT_* variables.
export function hostGitEnvironment(inherited = process.env) {
  const env = { ...inherited };
  for (const key of Object.keys(env)) if (/^GIT_/i.test(key)) delete env[key];
  env.GIT_CONFIG_NOSYSTEM = '1';
  env.GIT_CONFIG_GLOBAL = '/dev/null';
  env.GIT_TERMINAL_PROMPT = '0';
  return env;
}

export function runHostGit(args, options = {}) {
  return run('git', args, { ...options, env: hostGitEnvironment() });
}

function candidateGit(workspace, args, options) {
  return runHostGit([
    '-c', 'core.hooksPath=/dev/null',
    '-c', 'core.fsmonitor=false',
    '-C', workspace,
    ...args,
  ], options);
}

// Scalar queries retain their historical trimming. Byte-bearing output must
// explicitly opt into Buffer stdout, with identical environment and limits.
export function runCandidateGit(workspace, ...args) {
  return candidateGit(workspace, args);
}

export function runCandidateGitRaw(workspace, ...args) {
  return candidateGit(workspace, args, { encoding: null });
}
