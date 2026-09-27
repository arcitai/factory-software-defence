import { parseDocument } from 'yaml';

const UNKNOWN = Symbol('unknown');
const TOP_KEYS = new Set(['name', 'run-name', 'on', 'permissions', 'concurrency', 'env', 'defaults', 'jobs']);
const JOB_KEYS = new Set(['name', 'needs', 'if', 'runs-on', 'permissions', 'environment', 'env', 'outputs', 'defaults',
  'timeout-minutes', 'strategy', 'continue-on-error', 'concurrency', 'steps', 'uses', 'with', 'secrets', 'container', 'services']);
const STEP_KEYS = new Set(['name', 'id', 'if', 'uses', 'run', 'with', 'env', 'shell', 'working-directory', 'continue-on-error', 'timeout-minutes']);
const SUPPORTED_EVENTS = new Set(['push', 'pull_request', 'pull_request_target', 'workflow_dispatch']);
const HOSTED_RUNNERS = new Set([
  'ubuntu-latest', 'ubuntu-22.04', 'ubuntu-24.04', 'ubuntu-26.04',
  'windows-latest', 'windows-2022', 'windows-2025',
  'macos-latest', 'macos-14', 'macos-15', 'macos-26',
]);
const PR_TYPES = new Set(['assigned', 'auto_merge_disabled', 'auto_merge_enabled', 'closed', 'converted_to_draft', 'demilestoned',
  'dequeued', 'edited', 'enqueued', 'labeled', 'locked', 'milestoned', 'opened', 'ready_for_review', 'reopened',
  'review_request_removed', 'review_requested', 'synchronize', 'unassigned', 'unlabeled', 'unlocked']);
const MAX_WORKFLOWS = 64;
const MAX_WORKFLOW_BYTES = 256 * 1024;
const MAX_TOTAL_WORKFLOW_BYTES = 1024 * 1024;

class QualificationError extends Error {}
const fail = message => { throw new QualificationError(message); };
const isMap = value => value instanceof Map;
const workflowDefinitionPath = path => /^\.github\/workflows\/.+\.(?:yml|yaml)$/i.test(path);
const workflowDirectoryPath = path => path === '.github' || path === '.github/workflows';

function report(reason) {
  return { state: 'blocked', qualified: false,
    reason: `${reason} Trusted PR delivery is unavailable; keep the patch-only/manual path or revise the base workflows to the supported subset.` };
}

function mapKeys(value, allowed, where) {
  if (!isMap(value)) fail(`${where} must be a literal YAML mapping.`);
  for (const key of value.keys()) {
    if (typeof key !== 'string' || !allowed.has(key)) fail(`${where} contains an unsupported field.`);
  }
}

function staticString(value, where, { max = 4096, allowEmpty = false } = {}) {
  if (typeof value !== 'string' || Buffer.byteLength(value) > max || (!allowEmpty && !value.trim()))
    fail(`${where} must be a bounded literal string.`);
  if (value.includes('${{') || value.includes('}}')) fail(`${where} contains an unsupported expression.`);
  return value;
}

function staticScalar(value, where) {
  if (typeof value === 'string') return staticString(value, where, { allowEmpty: true });
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  fail(`${where} must be a literal scalar.`);
}

function staticMap(value, where) {
  if (!isMap(value)) fail(`${where} must be a literal YAML mapping.`);
  for (const [key, item] of value) {
    if (typeof key !== 'string') fail(`${where} contains an unsupported key.`);
    staticScalar(item, `${where}.${key}`);
  }
}

function workflowText(value, where, { max = 4096, allowEmpty = false } = {}) {
  if (typeof value !== 'string' || Buffer.byteLength(value) > max || (!allowEmpty && !value.trim()))
    fail(`${where} must be a bounded string.`);
  return value;
}

function workflowValueMap(value, where) {
  if (!isMap(value)) fail(`${where} must be a YAML mapping.`);
  for (const [key, item] of value) {
    if (typeof key !== 'string' || !(typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean' || item === null))
      fail(`${where} must contain only scalar values.`);
  }
}

function parseWorkflow(path, bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length > MAX_WORKFLOW_BYTES) fail(`Base workflow ${path} exceeds the supported size.`);
  let source;
  try { source = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { fail(`Base workflow ${path} is not valid UTF-8.`); }
  let doc, root;
  try {
    doc = parseDocument(source, { schema: 'core', uniqueKeys: true });
    if (doc.errors.length || doc.warnings.length) fail(`Base workflow ${path} is malformed or uses unsupported YAML.`);
    root = doc.toJS({ mapAsMap: true, maxAliasCount: 0 });
  } catch (error) {
    if (error instanceof QualificationError) throw error;
    fail(`Base workflow ${path} is malformed or uses unsupported YAML.`);
  }
  mapKeys(root, TOP_KEYS, `Base workflow ${path}`);
  if (!root.has('on') || !root.has('jobs')) fail(`Base workflow ${path} must declare literal triggers and jobs.`);
  return root;
}

function entries(value, where) {
  if (typeof value === 'string') return [[value, null]];
  if (Array.isArray(value)) {
    if (!value.length || value.some(event => typeof event !== 'string' || !event.trim())) fail(`${where} must list literal GitHub event names.`);
    if (new Set(value).size !== value.length) fail(`${where} contains a duplicate event.`);
    return value.map(event => [event, null]);
  }
  if (isMap(value)) return [...value.entries()];
  fail(`${where} must be a literal event name, list or mapping.`);
}

function literalList(value, where) {
  if (!Array.isArray(value) || value.length === 0) fail(`${where} must be a nonempty literal list.`);
  return value.map((entry, index) => staticString(entry, `${where}[${index}]`, { max: 512 }));
}

function triggerConfig(value, event) {
  if (value === null) return new Map();
  const allowed = event === 'push'
    ? new Set(['branches', 'branches-ignore', 'paths', 'paths-ignore', 'tags', 'tags-ignore'])
    : new Set(['branches', 'branches-ignore', 'paths', 'paths-ignore', 'types']);
  mapKeys(value, allowed, `${event} trigger`);
  if (value.has('branches') && value.has('branches-ignore')) fail(`${event} cannot combine branches with branches-ignore in the supported subset.`);
  if (value.has('paths') && value.has('paths-ignore')) fail(`${event} cannot combine paths with paths-ignore in the supported subset.`);
  for (const key of ['branches', 'branches-ignore', 'paths', 'paths-ignore', 'tags', 'tags-ignore'])
    if (value.has(key)) literalList(value.get(key), `${event}.${key}`);
  if (value.has('types')) {
    const types = literalList(value.get('types'), `${event}.types`);
    if (event === 'push' || types.some(type => !PR_TYPES.has(type))) fail(`${event}.types contains an unsupported activity type.`);
  }
  if (event === 'push' && value.has('tags') && value.has('tags-ignore')) fail('push cannot combine tags with tags-ignore.');
  return value;
}

function canMatchBranchFilter(config, branch) {
  const include = config.get('branches');
  if (include) {
    const patterns = literalList(include, 'branches');
    const hasOnlySimpleLiterals = patterns.every(isSimpleBranchLiteral);
    if (hasOnlySimpleLiterals && !patterns.includes(branch)) return false;
  }
  const exclude = config.get('branches-ignore');
  if (exclude) {
    const patterns = literalList(exclude, 'branches-ignore');
    if (patterns.some(pattern => isSimpleBranchLiteral(pattern) && pattern === branch)) return false;
  }
  // Only simple exact literals can prove a branch filter excludes this event.
  // GitHub glob and escape syntax is deliberately not interpreted here.
  return true;
}

function isSimpleBranchLiteral(pattern) {
  // Keep the literal subset explicit. Every other character may participate
  // in a GitHub glob or escape pattern and therefore cannot prove exclusion.
  return /^[A-Za-z0-9._/-]+$/.test(pattern);
}

function triggerScenarios(root, branch, target, path) {
  const raw = entries(root.get('on'), `Base workflow ${path} on`);
  const names = new Set(raw.map(([event]) => event));
  if ([...names].some(event => !SUPPORTED_EVENTS.has(event)))
    fail(`Base workflow ${path} has an unsupported trigger; only push, pull_request, pull_request_target and workflow_dispatch are qualified.`);
  const scenarios = [];
  for (const [event, rawConfig] of raw) {
    if (event === 'workflow_dispatch') {
      if (rawConfig !== null) {
        mapKeys(rawConfig, new Set(), 'workflow_dispatch trigger');
      }
      // A manual dispatch can select the newly published branch as its ref.
      // Evaluate that ref so a privileged job cannot hide behind an event that
      // is absent from the initial push/PR sequence.
      scenarios.push({ event_name: event, ref: `refs/heads/${branch}`, head_ref: '', base_ref: '' });
      continue;
    }
    const config = triggerConfig(rawConfig, event);
    if (event === 'push') {
      const hasTagFilters = config.has('tags') || config.has('tags-ignore');
      const hasBranchFilters = config.has('branches') || config.has('branches-ignore');
      // Tag filters suppress branch pushes only when no branch category is
      // declared. branches-ignore is just as significant here as branches.
      if (hasTagFilters && !hasBranchFilters) continue;
      if (canMatchBranchFilter(config, branch)) scenarios.push({ event_name: 'push', ref: `refs/heads/${branch}`, head_ref: '', base_ref: '' });
      continue;
    }
    if (config.has('tags') || config.has('tags-ignore')) fail(`${event} does not support tag filters in the supported subset.`);
    // Do not use activity-type filters to assume a PR workflow is irrelevant:
    // later events for the published PR can still run it on that candidate.
    if (canMatchBranchFilter(config, target)) {
      const eventName = event;
      scenarios.push({ event_name: eventName, ref: eventName === 'pull_request' ? UNKNOWN : `refs/heads/${target}`, head_ref: branch, base_ref: target });
    }
  }
  return scenarios;
}

function parsePermissions(value, where) {
  if (value === undefined) return { explicit: false, safe: false };
  if (typeof value === 'string') {
    const scalar = staticString(value, where);
    if (['read-all', 'write-all'].includes(scalar)) return { explicit: true, safe: false };
    fail(`${where} must use a literal permission mapping in the supported subset.`);
  }
  if (!isMap(value)) fail(`${where} must use a literal permission mapping.`);
  const permissions = new Map();
  for (const [key, permission] of value) {
    if (typeof key !== 'string' || typeof permission !== 'string' || !['none', 'read', 'write'].includes(permission))
      fail(`${where} contains a dynamic or unsupported permission.`);
    permissions.set(key, permission);
  }
  return { explicit: true, safe: [...permissions].every(([key, permission]) => key === 'contents' && ['none', 'read'].includes(permission)) };
}

function parseGuard(value, where) {
  if (value === undefined) return () => true;
  if (typeof value === 'boolean') return () => value;
  if (typeof value !== 'string') fail(`${where} must be a literal Boolean guard or supported comparison.`);
  let source = value.trim();
  if (source.startsWith('${{') || source.endsWith('}}')) {
    if (!source.startsWith('${{') || !source.endsWith('}}') || source.indexOf('}}') !== source.length - 2)
      fail(`${where} uses an unsupported expression.`);
    source = source.slice(3, -2).trim();
  }
  if (source === 'true') return () => true;
  if (source === 'false') return () => false;
  if (!source || source.includes('||') || /[()]/.test(source)) fail(`${where} is not a supported literal conjunction; privileged jobs must be guarded by simple literal comparisons.`);
  const atoms = source.split(/\s*&&\s*/);
  const parsed = atoms.map(atom => {
    const match = atom.match(/^([A-Za-z_][A-Za-z0-9_.]*)\s*(==|!=)\s*(['"])([^'"\\]*)\3$/);
    if (!match) fail(`${where} is not a supported literal conjunction; privileged jobs must be guarded by simple literal comparisons.`);
    const [, context, operator, , literal] = match;
    if (!['github.ref', 'github.event_name', 'github.head_ref', 'github.base_ref'].includes(context)
      && !/^vars\.[A-Za-z_][A-Za-z0-9_]*$/.test(context))
      fail(`${where} uses a context the workflow qualifier cannot prove.`);
    return { context, operator, literal };
  });
  return scenario => {
    let unknown = false;
    for (const atom of parsed) {
      let actual = atom.context.startsWith('vars.') ? UNKNOWN : scenario[atom.context.slice('github.'.length)];
      if (actual === UNKNOWN) {
        // The future PR number/ref is unknown. Do not infer inactivity from
        // today's usual refs/pull/<number>/merge shape.
        unknown = true;
        continue;
      }
      const equal = githubStringEqual(actual, atom.literal);
      if (equal === UNKNOWN) {
        unknown = true;
        continue;
      }
      if (atom.operator === '==' ? !equal : equal) return false;
    }
    return unknown ? UNKNOWN : true;
  };
}

function githubStringEqual(actual, literal) {
  if (actual === literal) return true;
  // GitHub compares strings without ASCII case sensitivity. Avoid guessing at
  // Unicode folding: a non-ASCII mismatch stays unknown and unsafe jobs fail
  // closed. All supported scenario values and common ref/event names are ASCII.
  if (!/^[\x00-\x7f]*$/.test(actual) || !/^[\x00-\x7f]*$/.test(literal)) return UNKNOWN;
  const foldAscii = value => value.replace(/[A-Z]/g, character => character.toLowerCase());
  return foldAscii(actual) === foldAscii(literal);
}

function expressionList(value, where, onString) {
  if (typeof value === 'string') {
    const spans = [...value.matchAll(/\$\{\{([\s\S]*?)\}\}/g)];
    const residue = value.replace(/\$\{\{[\s\S]*?\}\}/g, '');
    if (residue.includes('${{') || residue.includes('}}')) fail(`${where} contains an unmatched expression marker.`);
    for (const [, expression] of spans) onString(expression.trim(), where, value);
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => expressionList(item, `${where}[${index}]`, onString));
  } else if (isMap(value)) {
    for (const [key, item] of value) expressionList(item, `${where}.${String(key)}`, onString);
  }
}

function staticObject(value, where, { allowMap = false } = {}) {
  if (typeof value === 'string') return staticString(value, where, { allowEmpty: true });
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  if (Array.isArray(value)) return value.map((item, index) => staticObject(item, `${where}[${index}]`, { allowMap }));
  if (allowMap && isMap(value)) {
    const output = new Map();
    for (const [key, item] of value) {
      if (typeof key !== 'string') fail(`${where} contains an unsupported key.`);
      output.set(key, staticObject(item, `${where}.${key}`, { allowMap }));
    }
    return output;
  }
  fail(`${where} contains unsupported workflow data.`);
}

function matrixNames(job, where) {
  if (!job.has('strategy')) return new Set();
  const strategy = job.get('strategy');
  mapKeys(strategy, new Set(['matrix', 'fail-fast', 'max-parallel']), `${where}.strategy`);
  for (const key of ['fail-fast', 'max-parallel']) if (strategy.has(key)) {
    const value = strategy.get(key);
    if (key === 'fail-fast' ? typeof value !== 'boolean' : !Number.isSafeInteger(value) || value < 1)
      fail(`${where}.strategy.${key} must be a literal value.`);
  }
  if (!strategy.has('matrix')) return new Set();
  const matrix = strategy.get('matrix');
  if (!isMap(matrix)) fail(`${where}.strategy.matrix must be a literal mapping.`);
  const names = new Set();
  for (const [key, value] of matrix) {
    if (typeof key !== 'string') fail(`${where}.strategy.matrix contains an unsupported key.`);
    if (key === 'include' || key === 'exclude') {
      if (!Array.isArray(value)) fail(`${where}.strategy.matrix.${key} must be a literal list.`);
      value.forEach((row, index) => staticObject(row, `${where}.strategy.matrix.${key}[${index}]`, { allowMap: true }));
      continue;
    }
    if (!Array.isArray(value) || !value.length) fail(`${where}.strategy.matrix.${key} must be a nonempty literal list.`);
    value.forEach((item, index) => staticScalar(item, `${where}.strategy.matrix.${key}[${index}]`));
    names.add(key);
  }
  return names;
}

function validateWorkflowShape(root, path) {
  for (const key of ['name', 'run-name']) if (root.has(key)) staticString(root.get(key), `Base workflow ${path}.${key}`, { allowEmpty: true });
  if (root.has('env')) staticMap(root.get('env'), `Base workflow ${path}.env`);
  if (root.has('defaults')) {
    const defaults = root.get('defaults');
    mapKeys(defaults, new Set(['run']), `Base workflow ${path}.defaults`);
    if (defaults.has('run')) {
      const run = defaults.get('run');
      mapKeys(run, new Set(['shell', 'working-directory']), `Base workflow ${path}.defaults.run`);
      for (const [key, value] of run) staticString(value, `Base workflow ${path}.defaults.run.${key}`, { allowEmpty: true });
    }
  }
  parsePermissions(root.get('permissions'), `Base workflow ${path}.permissions`);
  if (root.has('concurrency')) {
    const concurrency = root.get('concurrency');
    if (typeof concurrency === 'string') {
      expressionList(concurrency, `Base workflow ${path}.concurrency`, (expression) => {
        if (expression !== 'github.ref') fail(`Base workflow ${path}.concurrency uses an unsupported expression.`);
      });
    } else {
      mapKeys(concurrency, new Set(['group', 'cancel-in-progress']), `Base workflow ${path}.concurrency`);
      if (typeof concurrency.get('group') !== 'string') fail(`Base workflow ${path}.concurrency.group must be a literal string.`);
      expressionList(concurrency.get('group'), `Base workflow ${path}.concurrency.group`, expression => {
        if (expression !== 'github.ref') fail(`Base workflow ${path}.concurrency.group uses an unsupported expression.`);
      });
      if (concurrency.has('cancel-in-progress') && typeof concurrency.get('cancel-in-progress') !== 'boolean')
        fail(`Base workflow ${path}.concurrency.cancel-in-progress must be a literal Boolean.`);
    }
  }
  const jobs = root.get('jobs');
  if (!isMap(jobs) || jobs.size === 0) fail(`Base workflow ${path}.jobs must be a nonempty literal mapping.`);
  for (const [id, job] of jobs) {
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(id) || id === '__proto__') fail(`Base workflow ${path} has an invalid job ID.`);
    mapKeys(job, JOB_KEYS, `Base workflow ${path} job ${id}`);
    if (job.has('runs-on')) {
      const runner = job.get('runs-on');
      if (typeof runner === 'string') staticString(runner, `${path} job ${id}.runs-on`);
      else if (Array.isArray(runner)) runner.forEach((value, index) => staticString(value, `${path} job ${id}.runs-on[${index}]`));
      else fail(`Base workflow ${path} job ${id}.runs-on must be a literal runner.`);
    }
    parsePermissions(job.get('permissions'), `${path} job ${id}.permissions`);
    if (job.has('needs')) {
      const needs = typeof job.get('needs') === 'string' ? [job.get('needs')] : job.get('needs');
      if (!Array.isArray(needs) || needs.some(value => typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(value)))
        fail(`${path} job ${id}.needs must be a literal job ID or list.`);
    }
    if (job.has('environment')) {
      const environment = job.get('environment');
      if (typeof environment === 'string') workflowText(environment, `${path} job ${id}.environment`);
      else {
        mapKeys(environment, new Set(['name', 'url']), `${path} job ${id}.environment`);
        for (const [key, value] of environment) workflowText(value, `${path} job ${id}.environment.${key}`, { allowEmpty: true });
      }
    }
    if (job.has('env')) workflowValueMap(job.get('env'), `${path} job ${id}.env`);
    if (job.has('defaults')) {
      const defaults = job.get('defaults');
      mapKeys(defaults, new Set(['run']), `${path} job ${id}.defaults`);
      if (defaults.has('run')) {
        const run = defaults.get('run');
        mapKeys(run, new Set(['shell', 'working-directory']), `${path} job ${id}.defaults.run`);
        for (const [key, value] of run) staticString(value, `${path} job ${id}.defaults.run.${key}`, { allowEmpty: true });
      }
    }
    if (job.has('continue-on-error') && typeof job.get('continue-on-error') !== 'boolean') fail(`${path} job ${id}.continue-on-error must be a literal Boolean.`);
    if (job.has('timeout-minutes') && (!Number.isSafeInteger(job.get('timeout-minutes')) || job.get('timeout-minutes') < 1))
      fail(`${path} job ${id}.timeout-minutes must be a positive integer.`);
    matrixNames(job, `${path} job ${id}`);
    if (job.has('concurrency')) {
      const concurrency = job.get('concurrency');
      if (typeof concurrency === 'string') workflowText(concurrency, `${path} job ${id}.concurrency`);
      else {
        mapKeys(concurrency, new Set(['group', 'cancel-in-progress']), `${path} job ${id}.concurrency`);
        if (typeof concurrency.get('group') !== 'string') fail(`${path} job ${id}.concurrency.group must be a string.`);
        if (concurrency.has('cancel-in-progress') && typeof concurrency.get('cancel-in-progress') !== 'boolean')
          fail(`${path} job ${id}.concurrency.cancel-in-progress must be a literal Boolean.`);
      }
    }
    if (job.has('steps')) {
      if (!Array.isArray(job.get('steps')) || job.get('steps').length === 0) fail(`${path} job ${id}.steps must be a nonempty list.`);
      for (const [index, step] of job.get('steps').entries()) {
        mapKeys(step, STEP_KEYS, `${path} job ${id} step ${index + 1}`);
        if (step.has('run') === step.has('uses')) fail(`${path} job ${id} step ${index + 1} must have exactly one of run or uses.`);
        for (const key of ['run', 'uses', 'name', 'id', 'shell', 'working-directory']) if (step.has(key))
          (key === 'run' ? workflowText : staticString)(step.get(key), `${path} job ${id} step ${index + 1}.${key}`, { allowEmpty: key === 'name' });
        for (const key of ['env', 'with']) if (step.has(key)) {
          workflowValueMap(step.get(key), `${path} job ${id} step ${index + 1}.${key}`);
        }
        if (step.has('if') && typeof step.get('if') !== 'string' && typeof step.get('if') !== 'boolean')
          fail(`${path} job ${id} step ${index + 1}.if must be a literal Boolean guard or string.`);
        if (step.has('continue-on-error') && typeof step.get('continue-on-error') !== 'boolean')
          fail(`${path} job ${id} step ${index + 1}.continue-on-error must be a literal Boolean.`);
        if (step.has('timeout-minutes') && (!Number.isSafeInteger(step.get('timeout-minutes')) || step.get('timeout-minutes') < 1))
          fail(`${path} job ${id} step ${index + 1}.timeout-minutes must be a positive integer.`);
      }
    }
    if (!job.has('steps') && !job.has('uses')) fail(`${path} job ${id} must declare steps or a reusable workflow.`);
    if (job.has('uses')) staticString(job.get('uses'), `${path} job ${id}.uses`);
    for (const key of ['outputs', 'with', 'secrets']) if (job.has(key)) {
      const values = job.get(key);
      if (!isMap(values)) fail(`${path} job ${id}.${key} must be a mapping.`);
      for (const [name, value] of values) {
        if (typeof name !== 'string' || !(typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null))
          fail(`${path} job ${id}.${key} must contain only scalar values.`);
      }
    }
  }
  return jobs;
}

function validateExpressions(value, where, matrixKeys, { concurrency = false } = {}) {
  expressionList(value, where, (expression, context, full) => {
    if (/\bsecrets(?:\.|\s|\[)|\bgithub\.token\b|\bgithub\.event\b/i.test(expression))
      fail(`${context} uses secrets, the GitHub token or untrusted event data.`);
    if (concurrency && expression === 'github.ref') return;
    const matrix = expression.match(/^matrix\.([A-Za-z_][A-Za-z0-9_]*)$/);
    if (matrix && matrixKeys.has(matrix[1]) && full.trim() === '${{ ' + expression + ' }}') return;
    fail(`${context} contains a dynamic expression outside the supported workflow subset.`);
  });
}

function runnerSafe(job) {
  const value = job.get('runs-on');
  return HOSTED_RUNNERS.has(value) || (Array.isArray(value) && value.length === 1 && HOSTED_RUNNERS.has(value[0]));
}

function safePermissions(job, rootPermissions) {
  const effective = job.has('permissions') ? parsePermissions(job.get('permissions'), 'job permissions') : rootPermissions;
  return effective.explicit && effective.safe;
}

function guardResults(job, scenarios, path, id) {
  const guard = parseGuard(job.get('if'), `Base workflow ${path} job ${id}.if`);
  return scenarios.map(scenario => guard(scenario));
}

function activateWorkflow(root, path, branch, target) {
  const scenarios = triggerScenarios(root, branch, target, path);
  const jobs = validateWorkflowShape(root, path);
  const rootPermissions = parsePermissions(root.get('permissions'), `Base workflow ${path}.permissions`);
  if (root.has('env')) validateExpressions(root.get('env'), `Base workflow ${path}.env`, new Set());
  if (root.has('concurrency')) {
    const group = isMap(root.get('concurrency')) ? root.get('concurrency').get('group') : root.get('concurrency');
    validateExpressions(group, `Base workflow ${path}.concurrency.group`, new Set(), { concurrency: true });
  }
  if (scenarios.length === 0) return;
  for (const [id, job] of jobs) {
    const results = guardResults(job, scenarios, path, id);
    const alwaysInactive = results.length > 0 && results.every(result => result === false);
    if (alwaysInactive) continue;

    const matrixKeys = matrixNames(job, `${path} job ${id}`);
    const unsafe = [];
    if (!runnerSafe(job)) unsafe.push('runner is not a known GitHub-hosted runner');
    if (!safePermissions(job, rootPermissions)) unsafe.push('effective permissions are not explicitly limited to contents:read/none');
    if (job.has('environment')) unsafe.push('job uses a GitHub environment');
    if (job.has('secrets')) unsafe.push('job passes secrets to a reusable workflow');
    if (job.has('uses')) unsafe.push('job calls an unqualified reusable workflow');
    if (job.has('container') || job.has('services')) unsafe.push('job uses an unsupported container or service');

    validateExpressions(job.get('env'), `${path} job ${id}.env`, matrixKeys);
    validateExpressions(job.get('outputs'), `${path} job ${id}.outputs`, matrixKeys);
    if (job.has('concurrency')) {
      const concurrency = job.get('concurrency');
      const group = typeof concurrency === 'string' ? concurrency : isMap(concurrency) ? concurrency.get('group') : null;
      if (typeof concurrency !== 'string' && !isMap(concurrency)) fail(`${path} job ${id}.concurrency must be a literal group.`);
      if (isMap(concurrency)) mapKeys(concurrency, new Set(['group', 'cancel-in-progress']), `${path} job ${id}.concurrency`);
      validateExpressions(group, `${path} job ${id}.concurrency.group`, matrixKeys, { concurrency: true });
    }
    if (job.has('steps')) for (const [index, step] of job.get('steps').entries()) {
      const label = `${path} job ${id} step ${index + 1}`;
      if (step.has('if')) {
        const stepResults = guardResults(new Map([['if', step.get('if')]]), scenarios, path, `${id} step ${index + 1}`);
        if (stepResults.some(result => result === UNKNOWN)) fail(`${label}.if uses a context the workflow qualifier cannot prove.`);
      }
      validateExpressions(step.get('run'), `${label}.run`, matrixKeys);
      validateExpressions(step.get('env'), `${label}.env`, matrixKeys);
      validateExpressions(step.get('with'), `${label}.with`, matrixKeys);
      if (step.has('uses')) {
        const uses = step.get('uses');
        const pinned = uses.startsWith('./')
          || /^docker:\/\/[^@\s]+@sha256:[a-f0-9]{64}$/.test(uses)
          || /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[^@\s]+)?@[a-f0-9]{40}$/.test(uses);
        if (!pinned) unsafe.push(`step ${index + 1} uses an action that is not local or immutable SHA-pinned`);
      }
    }
    if (unsafe.length) {
      if (results.some(result => result === UNKNOWN))
        fail(`Base workflow ${path} privileged job ${id} has an ambiguous or unsupported guard and may run for the generated branch push, selected-ref dispatch or PR event (${unsafe[0]}).`);
      fail(`Base workflow ${path} job ${id} can run for the generated branch push, selected-ref dispatch or PR event but ${unsafe[0]}.`);
    }
  }
}

export function qualifyGitHubActions({ baseEntries, candidateEntries, readBlob, branch, target }) {
  try {
    const allPaths = new Set([...baseEntries.keys(), ...candidateEntries.keys()]);
    const workflowFiles = new Set([...allPaths].filter(workflowDefinitionPath));
    const paths = new Set([...workflowFiles, ...[...allPaths].filter(workflowDirectoryPath)]);
    for (const path of paths) {
      const before = baseEntries.get(path), after = candidateEntries.get(path);
      if (workflowDirectoryPath(path) && !workflowDefinitionPath(path)) {
        if (before?.mode === '120000' || after?.mode === '120000') fail(`GitHub Actions directory ${path} is a symlink and cannot be qualified.`);
        continue;
      }
      if (!before || !after || before.type !== after.type || before.mode !== after.mode || before.sha !== after.sha)
        fail(`Candidate adds, changes or deletes GitHub Actions workflow ${path}; workflow definitions must remain unchanged from the admitted base.`);
      if (before.mode === '120000') fail(`Base workflow ${path} is a symlink and cannot be qualified.`);
      if (before.type !== 'blob' || !['100644', '100755'].includes(before.mode)) fail(`Base workflow ${path} is not a regular file.`);
    }
    if (workflowFiles.size > MAX_WORKFLOWS) fail('The admitted base has too many GitHub Actions workflows for bounded qualification.');
    let totalBytes = 0;
    for (const path of [...workflowFiles].sort()) {
      const entry = baseEntries.get(path), bytes = readBlob(entry.sha);
      totalBytes += bytes.length;
      if (totalBytes > MAX_TOTAL_WORKFLOW_BYTES) fail('The admitted base GitHub Actions workflows exceed the bounded qualification size.');
      const workflow = parseWorkflow(path, bytes);
      activateWorkflow(workflow, path, branch, target);
    }
    const reason = workflowFiles.size
      ? 'The accepted candidate leaves base workflow definitions unchanged; every supported workflow that can run for its generated branch push, selected-ref dispatch or PR event has explicit read-only contents permissions, no secret/environment access and a known hosted runner.'
      : 'The admitted base has no GitHub Actions workflow definitions that can run for this candidate.';
    return { state: 'qualified', qualified: true, reason };
  } catch (error) {
    if (error instanceof QualificationError) return report(error.message);
    return report('The admitted GitHub Actions workflow set could not be safely inspected.');
  }
}
